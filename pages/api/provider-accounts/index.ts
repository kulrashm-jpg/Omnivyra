/**
 * POST /api/provider-accounts         — create account for an API
 * GET  /api/provider-accounts?api_source_id=  — list accounts for a provider
 *
 * SUPER_ADMIN only. No tenant access.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../../backend/services/superAdminSession';
import { isPlatformSuperAdmin, isSuperAdmin } from '../../../backend/services/rbacService';
import {
  createProviderAccount,
  listAccountsForApi,
} from '../../../backend/services/providerAccountService';
import { encryptCredential } from '../../../backend/auth/credentialEncryption';

// ── Auth guard ─────────────────────────────────────────────────────────────────

async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<{ userId: string } | null> {
  const legacy = getLegacySuperAdminSession(req);
  if (legacy) return { userId: legacy.userId };

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  if ((await isPlatformSuperAdmin(user.id)) || (await isSuperAdmin(user.id))) {
    return { userId: user.id };
  }
  res.status(403).json({ error: 'SUPER_ADMIN_ONLY' });
  return null;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── GET: list accounts for a provider ──────────────────────────────────────
  if (req.method === 'GET') {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const { api_source_id } = req.query;
    if (!api_source_id || typeof api_source_id !== 'string') {
      return res.status(400).json({ error: 'api_source_id required' });
    }

    const accounts = await listAccountsForApi(api_source_id);
    // Strip credentials from list response — never expose to client
    const safe = accounts.map(({ credentials_encrypted: _creds, ...rest }) => rest);
    return res.status(200).json({ accounts: safe });
  }

  // ── POST: create account ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const {
      api_source_id,
      account_name,
      credentials,          // plain object — we serialize + optionally encrypt
      rate_limit_per_min,
      rate_limit_per_day,
      priority,
    } = req.body ?? {};

    if (!api_source_id || typeof api_source_id !== 'string') {
      return res.status(400).json({ error: 'api_source_id required' });
    }
    if (!account_name || typeof account_name !== 'string' || !account_name.trim()) {
      return res.status(400).json({ error: 'account_name required' });
    }
    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({ error: 'credentials object required' });
    }

    // Validate shape — must have at least one usable field
    const hasApiKey =
      (typeof credentials.api_key_env_name === 'string' && credentials.api_key_env_name.trim()) ||
      (typeof credentials.api_key_value === 'string' && credentials.api_key_value.trim());
    const hasOauth =
      (typeof credentials.oauth_client_id === 'string' && credentials.oauth_client_id.trim()) ||
      (typeof credentials.oauth_client_id_ref === 'string' && credentials.oauth_client_id_ref.trim());
    if (!hasApiKey && !hasOauth && Object.keys(credentials).length > 0 === false) {
      return res.status(400).json({ error: 'credentials must contain at least one credential field' });
    }

    // Encrypt any raw OAuth fields before storing
    const credToStore: Record<string, string> = {};
    if (credentials.api_key_env_name) credToStore.api_key_env_name = String(credentials.api_key_env_name);
    if (credentials.api_key_value)    credToStore.api_key_value    = String(credentials.api_key_value);

    if (credentials.oauth_client_id && !credentials.oauth_client_id_ref) {
      // Encrypt the raw value and store as a ref-style blob
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

    try {
      const account = await createProviderAccount({
        api_source_id,
        account_name: account_name.trim(),
        credentials_encrypted: JSON.stringify(credToStore),
        rate_limit_per_min: typeof rate_limit_per_min === 'number' ? rate_limit_per_min : null,
        rate_limit_per_day: typeof rate_limit_per_day === 'number' ? rate_limit_per_day : null,
        priority: typeof priority === 'number' ? priority : 1,
      });

      const { credentials_encrypted: _creds, ...safe } = account;
      return res.status(201).json({ account: safe });
    } catch (err: any) {
      console.error('createProviderAccount failed', err?.message);
      return res.status(500).json({ error: err?.message || 'Failed to create account' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
