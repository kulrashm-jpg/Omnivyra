import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { saveProfile } from '../../../backend/services/companyProfileService';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import {
  SUPER_ADMIN_DASHBOARD_VIEW,
  IDENTITY_ADMIN_ASSIGN,
  ORGANIZATION_DELETE,
} from '../../../shared/contracts/security';
import type { Capability } from '../../../shared/contracts/security';
import {
  cascadeDisableCompany,
  softDeleteCompanyWithCascade,
} from '../../../backend/services/lifecycleGovernance';
import {
  insertAuditLogStrict,
  SYSTEM_USER_ID,
} from '../../../backend/services/auditActorService';
import { logger } from '../../../backend/services/logger';

const normalizeWebsite = (value: string): string => {
  const trimmed = value.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  return withoutScheme.replace(/\/+$/, '');
};

/**
 * Phase: Platform Authority Legacy Facade Elimination.
 * Per-method canonical capability gate replaces the legacy
 * `requireSuperAdminUser` Bearer-only check.
 *   - GET    → SUPER_ADMIN_DASHBOARD_VIEW (read; bridge satisfies for compat)
 *   - POST   → IDENTITY_ADMIN_ASSIGN      (tenant provisioning; phishing-resistant + trusted-device step-up)
 *   - PATCH  → IDENTITY_ADMIN_ASSIGN      (tenant lifecycle mutation; same policy)
 *   - DELETE → ORGANIZATION_DELETE        (most-destructive; same policy)
 */
function capabilityForMethod(method: string | undefined): Capability {
  if (method === 'DELETE') return ORGANIZATION_DELETE;
  if (method === 'POST' || method === 'PATCH') return IDENTITY_ADMIN_ASSIGN;
  return SUPER_ADMIN_DASHBOARD_VIEW;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:companies', 20, 60))) return;
  const guard = await requireCapability(req, res, {
    capability: capabilityForMethod(req.method),
    reason: `super-admin companies (${req.method})`,
  });
  if (guard.ok !== true) return;

  if (req.method === 'GET') {
    // Phase 2.B — by default exclude soft-deleted rows. Opt in with
    // ?include_deleted=true for the operator-restore screen.
    const includeDeleted =
      typeof req.query.include_deleted === 'string'
      && req.query.include_deleted.toLowerCase() === 'true';

    let companiesQuery = supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (!includeDeleted) {
      companiesQuery = companiesQuery.is('deleted_at', null);
    }

    const { data, error } = await companiesQuery;

    if (error) {
      return res.status(500).json({ error: 'FAILED_TO_LIST_COMPANIES' });
    }

    const companies = data || [];
    const companyIds = new Set(companies.map((company) => company.id));

    // Enrich existing companies with profile data (name/industry from company_profiles).
    // Profiles whose company_id has NO matching companies row are incomplete onboarding
    // artefacts — do NOT synthesize ghost company entries from them (they have no users,
    // no roles, and cannot be properly managed or deleted).
    const { data: profileRows } = await supabase
      .from('company_profiles')
      .select('company_id,name,industry,website_url,created_at')
      .in('company_id', companies.length > 0 ? Array.from(companyIds) : ['__none__']);

    const profileByCompanyId = (profileRows || []).reduce<Record<string, typeof profileRows[0]>>((acc, p) => {
      if (p.company_id) acc[p.company_id] = p;
      return acc;
    }, {});

    const enriched = companies.map((company) => {
      const profile = profileByCompanyId[company.id];
      return {
        ...company,
        name: company.name || profile?.name || profile?.website_url || 'Unnamed company',
        industry: company.industry || profile?.industry || null,
        website: company.website || profile?.website_url || '',
      };
    });

    return res.status(200).json({ companies: enriched });
  }

  if (req.method === 'POST') {
    const { name, website, industry } = req.body || {};
    if (!name || !website) {
      return res.status(400).json({ error: 'name and website are required' });
    }

    const normalizedWebsite = normalizeWebsite(String(website));
    if (!normalizedWebsite) {
      return res.status(400).json({ error: 'website is invalid' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('companies')
      .select('id')
      .eq('website', normalizedWebsite)
      .limit(1);

    if (existingError) {
      return res.status(500).json({ error: 'FAILED_TO_VALIDATE_WEBSITE' });
    }
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'WEBSITE_ALREADY_EXISTS' });
    }

    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: String(name).trim(),
        website: normalizedWebsite,
        industry: industry ? String(industry).trim() : null,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: 'FAILED_TO_CREATE_COMPANY' });
    }

    const profileWebsite = String(website || '').trim() || normalizedWebsite;
    await saveProfile({
      company_id: data.id,
      name: data.name,
      industry: data.industry || undefined,
      website_url: profileWebsite,
    });

    return res.status(201).json({ company: data });
  }

  if (req.method === 'PATCH') {
    const { companyId, status, reason } = req.body || {};
    if (!companyId || !status) {
      return res.status(400).json({ error: 'companyId and status are required' });
    }
    if (!['active', 'inactive'].includes(String(status))) {
      return res.status(400).json({ error: 'INVALID_STATUS' });
    }

    const actorUserId = guard.principal.userId || SYSTEM_USER_ID;
    const reasonText =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim().slice(0, 500)
        : `super-admin sets company status=${status}`;

    // Phase 2.B — disable cascades. Enabling does NOT auto-unrevoke roles
    // or sessions (revocations are intentionally one-way; affected users
    // re-establish access via sign-in or by being re-invited).
    if (String(status) === 'inactive') {
      // Pre-check existence + previous state for the audit row.
      const { data: previous } = await supabase
        .from('companies')
        .select('id, name, status, deleted_at')
        .eq('id', companyId)
        .maybeSingle();
      if (!previous) {
        return res.status(404).json({ error: 'COMPANY_NOT_FOUND' });
      }
      if ((previous as any).deleted_at) {
        return res.status(409).json({
          error: 'COMPANY_DELETED',
          details: 'Company is already soft-deleted; cannot be disabled.',
        });
      }

      let cascade;
      try {
        cascade = await cascadeDisableCompany(companyId, actorUserId, `disable:${reasonText}`);
      } catch (err: any) {
        logger.error('super_admin_company_disable_cascade_failed', {
          companyId,
          message: err?.message ?? String(err),
        });
        return res.status(500).json({
          error: 'CASCADE_FAILED',
          details: err?.message ?? String(err),
        });
      }

      const { data: updated } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .maybeSingle();

      await insertAuditLogStrict({
        actorUserId,
        action: 'SUPER_ADMIN_COMPANY_DISABLE',
        targetUserId: null,
        companyId,
        metadata: {
          capability: IDENTITY_ADMIN_ASSIGN,
          reason: reasonText,
          before: { status: (previous as any).status ?? 'active' },
          after: { status: 'inactive' },
          affected_users: cascade.affectedUsers,
          revoked_roles: cascade.revokedRoles,
          revoked_sessions: cascade.revokedSessions,
        },
      });

      return res.status(200).json({
        company: updated ?? { id: companyId, status: 'inactive' },
        cascade,
      });
    }

    // status === 'active' — simple toggle, no cascade.
    const { data: previousActive } = await supabase
      .from('companies')
      .select('status, deleted_at')
      .eq('id', companyId)
      .maybeSingle();
    if (previousActive && (previousActive as any).deleted_at) {
      return res.status(409).json({
        error: 'COMPANY_DELETED',
        details: 'Soft-deleted companies cannot be re-activated through PATCH.',
      });
    }

    const { data, error } = await supabase
      .from('companies')
      .update({ status: 'active' })
      .eq('id', companyId)
      .select('*')
      .single();

    if (error || !data) {
      return res.status(500).json({ error: 'FAILED_TO_UPDATE_COMPANY' });
    }

    await insertAuditLogStrict({
      actorUserId,
      action: 'SUPER_ADMIN_COMPANY_ENABLE',
      targetUserId: null,
      companyId,
      metadata: {
        capability: IDENTITY_ADMIN_ASSIGN,
        reason: reasonText,
        before: { status: (previousActive as any)?.status ?? 'inactive' },
        after: { status: 'active' },
      },
    });

    return res.status(200).json({ company: data });
  }

  if (req.method === 'DELETE') {
    const { companyId, reason, hard } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const actorUserId = guard.principal.userId || SYSTEM_USER_ID;
    const reasonText =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim().slice(0, 500)
        : 'super-admin company delete';

    // Phase 2.B default: SOFT delete via soft_delete_company RPC. The
    // cascade deactivates memberships, revokes sessions, and bumps each
    // affected user's session_revoked_after. Data is preserved.
    //
    // Hard delete is an opt-in escape hatch for cleanup of empty/test
    // companies. It preserves the legacy behavior (DELETE FROM ...) and
    // is gated by an explicit `hard=true` body flag in addition to the
    // ORGANIZATION_DELETE capability.
    if (hard === true) {
      const { error: rolesError } = await supabase
        .from('user_company_roles')
        .delete()
        .eq('company_id', companyId);
      if (rolesError) {
        return res.status(500).json({ error: 'FAILED_TO_DELETE_COMPANY_USERS' });
      }

      const { error: profileError } = await supabase
        .from('company_profiles')
        .delete()
        .eq('company_id', companyId);
      if (profileError) {
        return res.status(500).json({ error: 'FAILED_TO_DELETE_COMPANY_PROFILE' });
      }

      const { error: companyError } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId);
      if (companyError) {
        return res.status(500).json({ error: 'FAILED_TO_DELETE_COMPANY' });
      }

      await insertAuditLogStrict({
        actorUserId,
        action: 'SUPER_ADMIN_COMPANY_HARD_DELETE',
        targetUserId: null,
        companyId,
        metadata: {
          capability: ORGANIZATION_DELETE,
          reason: reasonText,
          mode: 'hard',
        },
      });

      return res.status(200).json({ success: true, mode: 'hard' });
    }

    // Soft delete (default).
    const { data: previous } = await supabase
      .from('companies')
      .select('id, name, status, deleted_at')
      .eq('id', companyId)
      .maybeSingle();
    if (!previous) {
      return res.status(404).json({ error: 'COMPANY_NOT_FOUND' });
    }
    if ((previous as any).deleted_at) {
      return res.status(200).json({ success: true, mode: 'soft', already_deleted: true });
    }

    let cascade;
    try {
      cascade = await softDeleteCompanyWithCascade(companyId, actorUserId, `delete:${reasonText}`);
    } catch (err: any) {
      logger.error('super_admin_company_soft_delete_failed', {
        companyId,
        message: err?.message ?? String(err),
      });
      return res.status(500).json({
        error: 'SOFT_DELETE_FAILED',
        details: err?.message ?? String(err),
      });
    }

    await insertAuditLogStrict({
      actorUserId,
      action: 'SUPER_ADMIN_COMPANY_SOFT_DELETE',
      targetUserId: null,
      companyId,
      metadata: {
        capability: ORGANIZATION_DELETE,
        reason: reasonText,
        mode: 'soft',
        before: { status: (previous as any).status ?? 'active', deleted_at: null },
        after: { status: 'inactive', deleted_at_set: true },
        affected_users: cascade.affectedUsers,
        revoked_roles: cascade.revokedRoles,
        revoked_sessions: cascade.revokedSessions,
      },
    });

    return res.status(200).json({ success: true, mode: 'soft', cascade });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
