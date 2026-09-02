import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * PUT    /api/provider-accounts/[id]  — update credentials, limits, priority
 * DELETE /api/provider-accounts/[id]  — soft delete (is_active = false)
 *
 * SUPER_ADMIN only. No tenant access.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  buildCredentialEnvelope,
  updateProviderAccount,
  deactivateProviderAccount,
} from '../../../backend/services/providerAccountService';
// Remediation: shared env-var-name validation; encryption lives in the envelope builder.
import { describeRejectedEnvVarName, isEnvVarName } from '../../../backend/security/credentialSafety';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE } from '../../../shared/contracts/security';

// ── Handler ────────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Account ID required' });
  }

  // Phase 2 mutation gate. PUT/DELETE on provider-accounts mutates
  // encrypted OAuth credentials → same blast radius as platform OAuth.
  // Bridge principals receive 403 CAPABILITY_NOT_HELD.
  const guard = await requireCapability(req, res, {
    capability: INTEGRATION_PLATFORM_OAUTH_MANAGE,
    reason: `provider-account ${req.method} for ${id}`,
    resourceId: id,
  });
  if (guard.ok !== true) return;
  const session = { userId: guard.principal.userId };
  void session; // reserved for future audit linkage

  // Verify account exists
  const { data: existing, error: fetchError } = await supabase
    .from('api_provider_accounts')
    .select('id, api_source_id, account_name')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return res.status(500).json({ error: fetchError.message });
  }
  if (!existing) {
    return res.status(404).json({ error: 'Account not found' });
  }

  // ── DELETE (soft) ──────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      await deactivateProviderAccount(id);
      return res.status(200).json({ success: true, id });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to deactivate account' });
    }
  }

  // ── PUT: update ────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const {
      account_name,
      credentials,
      rate_limit_per_min,
      rate_limit_per_day,
      priority,
      is_active,
    } = req.body ?? {};

    const patch: Record<string, unknown> = {};

    if (typeof account_name === 'string' && account_name.trim()) {
      patch.account_name = account_name.trim();
    }
    if (typeof rate_limit_per_min === 'number') patch.rate_limit_per_min = rate_limit_per_min;
    if (rate_limit_per_min === null)             patch.rate_limit_per_min = null;
    if (typeof rate_limit_per_day === 'number')  patch.rate_limit_per_day = rate_limit_per_day;
    if (rate_limit_per_day === null)              patch.rate_limit_per_day = null;
    if (typeof priority === 'number')            patch.priority = priority;
    if (typeof is_active === 'boolean')          patch.is_active = is_active;

    // ── Credential update — MERGE, never replace ──────────────────────────────
    //
    // REMEDIATION (two defects fixed here):
    //
    //  1. DESTRUCTIVE REPLACE. This previously built a fresh object and assigned
    //     `credentials_encrypted = JSON.stringify(credToStore)`. Editing an account and
    //     submitting only `api_key_env_name` silently DESTROYED the stored secret, with no
    //     warning and no way to recover it. `buildCredentialEnvelope` now merges onto the
    //     existing envelope, so only fields the caller actually supplied change.
    //  2. PLAINTEXT. `api_key_value` was stored verbatim; it is now encrypted by the same
    //     shared builder used on create.
    if (credentials && typeof credentials === 'object') {
      // Server-side env-var-name validation — the client is not the security boundary.
      if (credentials.api_key_env_name && !isEnvVarName(credentials.api_key_env_name)) {
        return res.status(400).json({
          error: 'INVALID_ENV_VAR_NAME',
          detail: describeRejectedEnvVarName(credentials.api_key_env_name),
        });
      }

      // Read the CURRENT envelope so unsupplied fields survive the update.
      const { data: current } = await supabase
        .from('api_provider_accounts')
        .select('credentials_encrypted')
        .eq('id', id)
        .maybeSingle();

      try {
        const merged = buildCredentialEnvelope({
          existing: (current as { credentials_encrypted?: string } | null)?.credentials_encrypted ?? null,
          supplied: credentials,
        });
        if (merged && merged !== '{}') patch.credentials_encrypted = merged;
      } catch {
        // Fail CLOSED — never downgrade to storing plaintext.
        return res.status(500).json({ error: 'Failed to encrypt credentials' });
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    try {
      const updated = await updateProviderAccount(
        id,
        patch as Parameters<typeof updateProviderAccount>[1],
      );
      const { credentials_encrypted: _creds, ...safe } = updated;
      return res.status(200).json({ account: safe });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Failed to update account' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/provider-accounts/:id' });
