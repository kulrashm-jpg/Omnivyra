/** Part of super-admin users API (Agent-B split — backend module, not a route). */
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import { Role, ALL_ROLES } from '../../services/rbacService';
import { createAndSendInvitation } from '../../services/invitationService';
import { requireAdminRateLimit } from '../../services/requestAccessService';
import { withIdempotency } from '../../middleware/withIdempotency';
import { logger } from '../../services/logger';
import { logAuthEvent } from '../../../lib/auth/auditLog';
import { saveDomainRecord, reassignDomain } from '../../services/domainRecordService';
import { insertAuditLogStrict, SYSTEM_USER_ID } from '../../services/auditActorService';
import { logDomainUnverifiedUsageForCompany } from '../../services/domainVerificationService';
import { requireCapability } from '../../security/requireCapability';
import {
  IDENTITY_ADMIN_ASSIGN,
  IDENTITY_ADMIN_DELETE,
  SUPER_ADMIN_DASHBOARD_VIEW,
} from '../../../shared/contracts/security';

const ALLOWED_OVERRIDE_TYPES = ['no_website', 'domain_exception', 'manual_assignment'] as const;
import { OverrideType, isAllowedOverrideType, requireSuperAdminAccess, allowedRoles, isAllowedRole, findOrCreateUserByEmail, optionalRoleColumns, upsertUserCompanyRole, insertAuditLog } from './usersShared';

export async function handleUsersPost(req: NextApiRequest, res: NextApiResponse): Promise<unknown> {
  if (req.method === 'POST') {
    try {
      const {
        email,
        companyId,
        role,
        override_domain,
        override_reason,
        override_type,
        domain,
        confirm_reassignment,
      } = req.body || {};
      // Validate required parameters
      if (!email) {
        return res.status(400).json({
          error: 'MISSING_REQUIRED_PARAMETER',
          details: 'email is required to invite a user',
          required_fields: ['email', 'companyId']
        });
      }

      // Wave 2C-B: capability + step-up gate. identity.admin.assign is
      // policy-marked phishing-resistant + trusted-device. Bridge
      // principals are rejected.
      const guard = await requireCapability(req, res, {
        capability: IDENTITY_ADMIN_ASSIGN,
        reason: `super-admin invites/assigns role to user (${email})`,
        organizationId: companyId,
        resourceId: email,
      });
      // Denied: requireCapability already wrote the response. Report HANDLED so
      // the route shell does not fall through to its trailing 405 (2Z-AF).
      if (guard.ok !== true) return true;

      if (!companyId) {
        return res.status(400).json({
          error: 'MISSING_REQUIRED_PARAMETER',
          details: 'companyId is required to invite a user',
          required_fields: ['email', 'companyId']
        });
      }

      // Override flag — additive. When false/absent, behavior is unchanged.
      // When true, override_reason + override_type are REQUIRED, and a
      // company_domains row is written via saveDomainRecord with
      // verification_status='admin_override'. If the input domain is already
      // claimed by another company, the request must additionally pass
      // confirm_reassignment=true to authorize moving the domain.
      const overrideEnabled = override_domain === true;
      const overrideReasonText =
        typeof override_reason === 'string' ? override_reason.trim() : '';
      const overrideTypeValue: OverrideType | null =
        overrideEnabled && isAllowedOverrideType(override_type)
          ? override_type
          : null;
      const confirmReassignment = confirm_reassignment === true;

      if (overrideEnabled && !overrideReasonText) {
        return res.status(400).json({
          error: 'OVERRIDE_REASON_REQUIRED',
          details: 'override_reason must be a non-empty string when override_domain is true',
        });
      }
      if (overrideEnabled && !overrideTypeValue) {
        return res.status(400).json({
          error: 'OVERRIDE_TYPE_REQUIRED',
          details: 'override_type must be one of: no_website, domain_exception, manual_assignment',
          allowed: ALLOWED_OVERRIDE_TYPES,
        });
      }

      // Phase: Platform Authority Legacy Facade Elimination.
      // Reuse the principal from the IDENTITY_ADMIN_ASSIGN guard above —
      // we already authoritatively resolved them. Avoids a second pass
      // through the legacy `requireSuperAdminUser` Bearer-only check.
      const actorUserId: string = guard.principal.userId || SYSTEM_USER_ID;

      const normalizedEmail = String(email).trim().toLowerCase();
      const desiredRole = String(role || Role.COMPANY_ADMIN).toUpperCase();
      if (!isAllowedRole(desiredRole)) {
        return res.status(400).json({ error: 'ROLE_NOT_ALLOWED' });
      }

      // 0. Validate that the target company actually exists.
      //    A missing companies row means the company was never properly created
      //    (dangling company_profiles artefact) — assigning a role to it would
      //    create an orphaned role that breaks the user's onboarding.
      const { data: companyRow, error: companyCheckErr } = await supabase
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle();
      if (companyCheckErr) {
        return res.status(500).json({ error: 'FAILED_TO_VALIDATE_COMPANY', details: companyCheckErr.message });
      }
      if (!companyRow) {
        return res.status(404).json({ error: 'COMPANY_NOT_FOUND', details: `Company ${companyId} does not exist. The company must be created first before users can be assigned to it.` });
      }

      // 1. Find or create user row by email (no Supabase auth.admin)
      const { id: userId, error: userErr } = await findOrCreateUserByEmail(normalizedEmail);
      if (userErr === 'ACCOUNT_DELETED') {
        return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
      }
      if (userErr || !userId) {
        return res.status(500).json({ error: 'FAILED_TO_SAVE_USER', details: userErr });
      }
      // 2. Create/update company role
      const roleResult = await upsertUserCompanyRole(userId, companyId, desiredRole);
      if (!roleResult.ok) {
        return res.status(500).json({ error: 'FAILED_TO_ASSIGN_ROLE', details: roleResult.error });
      }

      const invitation = await createAndSendInvitation({
        email: normalizedEmail,
        companyId,
        role: desiredRole,
        invitedBy: null,
        idempotencyKey: String(req.headers['idempotency-key'] ?? ''),
      });

      // Override path: record the override domain on company_domains via the
      // shared writer. We keep this OUTSIDE the user-creation path so the
      // existing flow is byte-for-byte preserved when override_domain is false.
      //
      // If the domain is already claimed by another company, saveDomainRecord
      // returns a structured DOMAIN_ALREADY_CLAIMED conflict. We escalate to
      // reassignDomain ONLY when confirm_reassignment === true; otherwise the
      // request is rejected so reassignment can never happen silently.
      let overrideDomainSaved: { ok: boolean; error?: string; id?: string } | null = null;
      let overrideInputDomain: string | null = null;
      const affectedCompanyIds: string[] = [];

      if (overrideEnabled) {
        overrideInputDomain = String(
          domain || normalizedEmail.split('@')[1] || '',
        ).trim().toLowerCase();

        if (overrideInputDomain) {
          const firstAttempt = await saveDomainRecord({
            company_id:          companyId,
            input_domain:        overrideInputDomain,
            final_domain:        overrideInputDomain,
            redirect_chain:      null,
            is_forwarding:       false,
            verification_status: 'admin_override',
            created_via:         'admin',
            override_reason:     overrideReasonText,
            is_primary:          false,
          });

          if (firstAttempt.ok) {
            overrideDomainSaved = firstAttempt;
            affectedCompanyIds.push(companyId);
          } else if (firstAttempt.conflict?.code === 'DOMAIN_ALREADY_CLAIMED') {
            const existingCompanyId = firstAttempt.conflict.existing_company_id;
            affectedCompanyIds.push(existingCompanyId, companyId);

            if (!confirmReassignment) {
              await insertAuditLogStrict({
                actorUserId: actorUserId,
                action: 'SUPER_ADMIN_INVITE_REJECTED',
                targetUserId: userId,
                companyId,
                metadata: {
                  reason:                'DOMAIN_ALREADY_CLAIMED',
                  override:              true,
                  override_type:         overrideTypeValue,
                  override_reason:       overrideReasonText,
                  input_domain:          overrideInputDomain,
                  final_domain:          overrideInputDomain,
                  affected_company_ids:  affectedCompanyIds,
                  existing_company_id:   existingCompanyId,
                },
              });
              return res.status(409).json({
                error: 'DOMAIN_ALREADY_CLAIMED',
                details:
                  'This domain is currently claimed by another company. ' +
                  'Pass confirm_reassignment=true to authorize moving it.',
                existing_company_id: existingCompanyId,
                required_field: 'confirm_reassignment',
              });
            }

            const reassignResult = await reassignDomain({
              domain:               overrideInputDomain,
              from_company_id:      existingCompanyId,
              to_company_id:        companyId,
              reason:                overrideReasonText,
              actor_user_id:         actorUserId,
              confirm_reassignment:  true,
            });
            overrideDomainSaved = reassignResult;
            if (!reassignResult.ok) {
              logger.warn('super_admin_users_override_reassign_failed', {
                companyId,
                from_company_id: existingCompanyId,
                input_domain: overrideInputDomain,
                error: reassignResult.error,
              });
            }
          } else {
            overrideDomainSaved = firstAttempt;
            logger.warn('super_admin_users_override_domain_save_failed', {
              companyId,
              input_domain: overrideInputDomain,
              error: firstAttempt.error,
            });
          }
        }
      }

      // Audit — actor_user_id is guaranteed non-null via insertAuditLogStrict.
      await insertAuditLogStrict({
        actorUserId: actorUserId,
        action: 'SUPER_ADMIN_INVITE',
        targetUserId: userId,
        companyId,
        metadata: {
          role: desiredRole,
          invitationId: invitation.id,
          override: overrideEnabled,
          override_type:        overrideEnabled ? overrideTypeValue : null,
          override_reason:      overrideEnabled ? overrideReasonText : null,
          input_domain:         overrideEnabled ? overrideInputDomain : null,
          final_domain:         overrideEnabled ? overrideInputDomain : null,
          affected_company_ids: overrideEnabled ? affectedCompanyIds : null,
          confirm_reassignment: overrideEnabled ? confirmReassignment : null,
          domain_record_saved:  overrideDomainSaved?.ok ?? null,
        },
      });

      // Soft-enforcement signal — logs when an invitation is issued for a
      // company whose domain is not yet verified/admin_override. Never blocks.
      void logDomainUnverifiedUsageForCompany({
        company_id: companyId,
        operation:  'super_admin_invite',
        metadata:   { invitationId: invitation.id, target_user_id: userId, role: desiredRole },
      });

      return res.status(201).json({
        user: {
          id: userId,
          email: normalizedEmail,
          company_id: companyId,
          role: desiredRole,
        },
      });
    } catch (error: any) {
      logger.error('super_admin_users_post_failed', { message: error?.message || String(error) });
      return res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        details: error?.message || String(error),
      });
    }
  }
  return false;
}

export async function handleUsersDelete(req: NextApiRequest, res: NextApiResponse): Promise<unknown> {
  if (req.method === 'DELETE') {
    const { userId, companyId } = req.body || {};
    // Validate required parameter
    if (!userId) {
      return res.status(400).json({
        error: 'MISSING_REQUIRED_PARAMETER',
        details: 'userId is required to delete a user',
      });
    }

    // Wave 2C-A: enforce capability + step-up on the delete path.
    // identity.admin.delete is policy-marked as requiring phishing-resistant
    // step-up on a trusted device (StepUpPolicyRegistry). Bridge principals
    // cannot satisfy this and are rejected automatically.
    const guard = await requireCapability(req, res, {
      capability: IDENTITY_ADMIN_DELETE,
      reason: 'super-admin deletes a user (auth + DB soft-delete + role deactivation)',
      resourceId: userId,
      organizationId: companyId,
    });
    // Denied: requireCapability already wrote the response. Report HANDLED so
    // the route shell does not fall through to its trailing 405 (2Z-AF).
    if (guard.ok !== true) return true;

    // Route 1: Delete user from specific company
    if (companyId) {
      const { data, error } = await supabase
        .from('user_company_roles')
        .delete()
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .select('user_id, company_id');

      if (error) {
        logger.error('super_admin_users_delete_company_failed', { userId, companyId, message: error.message });
        return res.status(500).json({ 
          error: 'FAILED_TO_DELETE_USER',
          details: error.message
        });
      }
      
      if (!data || data.length === 0) {
        return res.status(404).json({ 
          error: 'USER_NOT_FOUND',
          details: `No user record found for userId: ${userId} in companyId: ${companyId}`,
        });
      }

      await insertAuditLog({
        actorUserId: null,
        action: 'SUPER_ADMIN_USER_DELETE',
        targetUserId: userId,
        companyId,
      });

      return res.status(200).json({ success: true, message: 'User removed from company' });
    }

    // Route 2: Delete unassigned user entirely from the system.
    // Order of operations is critical for consistency:
    //   1. Look up supabase_uid from DB
    //   2. Delete from Supabase Auth first (abort if it fails — prevents ghost sessions)
    //   3. Soft-delete the users row
    //   4. Deactivate every user_company_roles row for the user
    try {
      // Step A: look up the user row to get the auth identity
      const { data: userRecord, error: lookupError } = await supabase
        .from('users')
        .select('id, supabase_uid')
        .eq('id', userId)
        .maybeSingle();

      if (lookupError) {
        logger.error('super_admin_users_delete_lookup_failed', { userId, message: lookupError.message });
        return res.status(500).json({ error: 'FAILED_TO_DELETE_USER', details: lookupError.message });
      }

      const supabaseUid: string | null = (userRecord as any)?.supabase_uid ?? null;

      // Step B: delete from Supabase Auth.
      //   Removes the auth account entirely so the user cannot sign in.
      //   Tolerates user-not-found (idempotent — already gone).
      if (supabaseUid) {
        try {
          const { error: authError } = await supabase.auth.admin.deleteUser(supabaseUid);
          if (authError && !authError.message?.includes('not found')) {
            logger.error('super_admin_users_delete_auth_failed', { userId, supabaseUid, message: authError.message });
            return res.status(500).json({
              error: 'FAILED_TO_DELETE_FROM_AUTH',
              details: authError.message,
            });
          }
        } catch (authError: any) {
          logger.error('super_admin_users_delete_auth_exception', { userId, supabaseUid, message: authError.message });
          return res.status(500).json({
            error: 'FAILED_TO_DELETE_FROM_AUTH',
            details: authError.message,
          });
        }
      }

      // Step C: soft-delete the users row (preserves audit trail, blocks re-signup)
      const now = new Date().toISOString();
      const { data: userData, error: userError } = await supabase
        .from('users')
        .update({ is_deleted: true, deleted_at: now })
        .eq('id', userId)
        .select('id');

      const updatedInTable = !userError && userData && userData.length > 0;
      if (userError) {
        // CRITICAL: Supabase Auth user was deleted but the DB soft-delete failed.
        // The user cannot sign in (auth account gone), but the DB row still appears active.
        // This row must be manually soft-deleted to restore data consistency.
        logger.error('super_admin_users_delete_soft_delete_failed', {
          userId,
          supabaseUid,
          message: userError.message,
          action: `Manual fix: UPDATE users SET is_deleted=true, deleted_at=now() WHERE id='${userId}'`,
        });
        return res.status(500).json({ error: 'FAILED_TO_DELETE_USER', details: userError.message });
      }

      if (!updatedInTable && !supabaseUid) {
        return res.status(404).json({
          error: 'USER_NOT_FOUND',
          details: `User ${userId} not found in users table or Supabase Auth`,
        });
      }

      // Step D: deactivate all company roles so the user loses access to every company
      const { error: rolesError } = await supabase
        .from('user_company_roles')
        .update({ status: 'inactive', deactivated_at: now, updated_at: now })
        .eq('user_id', userId);

      if (rolesError) {
        // Non-fatal: auth + users row are already handled; log and continue.
        logger.error('super_admin_users_delete_role_deactivate_failed', { userId, message: rolesError.message });
        return res.status(500).json({ error: 'FAILED_TO_DEACTIVATE_USER_ROLES', details: rolesError.message });
      }

      await insertAuditLog({
        actorUserId: null,
        action: 'SUPER_ADMIN_USER_DELETE_UNASSIGNED',
        targetUserId: userId,
      });
      void logAuthEvent('user_deleted', {
        userId,
        metadata: { deleted_by: 'super_admin', supabase_uid: supabaseUid },
      });

      return res.status(200).json({ success: true, message: 'User deleted from system' });
    } catch (err: any) {
      logger.error('super_admin_users_delete_unassigned_failed', { userId, message: err.message });
      return res.status(500).json({
        error: 'FAILED_TO_DELETE_UNASSIGNED_USER',
        details: err.message,
      });
    }
  }
  return false;
}
