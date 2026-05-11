/**
 * PUT    /api/provider-accounts/[id]  — update credentials, limits, priority
 * DELETE /api/provider-accounts/[id]  — soft delete (is_active = false)
 *
 * SUPER_ADMIN only. No tenant access.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import {
  updateProviderAccount,
  deactivateProviderAccount,
} from '../../../backend/services/providerAccountService';
import { encryptCredential } from '../../../backend/auth/credentialEncryption';
import { supabase } from '../../../backend/db/supabaseClient';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE } from '../../../shared/contracts/security';

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    // Re-encrypt updated credentials if provided
    if (credentials && typeof credentials === 'object') {
      const credToStore: Record<string, string> = {};

      if (credentials.api_key_env_name)
        credToStore.api_key_env_name = String(credentials.api_key_env_name);
      if (credentials.api_key_value)
        credToStore.api_key_value = String(credentials.api_key_value);

      if (credentials.oauth_client_id && !credentials.oauth_client_id_ref) {
        try {
          credToStore.oauth_client_id_ref = encryptCredential(String(credentials.oauth_client_id));
        } catch {
          return res.status(500).json({ error: 'Failed to encrypt oauth_client_id' });
        }
      } else if (credentials.oauth_client_id_ref) {
        credToStore.oauth_client_id_ref = String(credentials.oauth_client_id_ref);
      }

      if (credentials.oauth_client_secret && !credentials.oauth_client_secret_ref) {
        try {
          credToStore.oauth_client_secret_ref = encryptCredential(String(credentials.oauth_client_secret));
        } catch {
          return res.status(500).json({ error: 'Failed to encrypt oauth_client_secret' });
        }
      } else if (credentials.oauth_client_secret_ref) {
        credToStore.oauth_client_secret_ref = String(credentials.oauth_client_secret_ref);
      }

      if (Object.keys(credToStore).length > 0) {
        patch.credentials_encrypted = JSON.stringify(credToStore);
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
