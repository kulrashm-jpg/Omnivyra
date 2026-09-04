import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
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
  buildCredentialEnvelope,
  createProviderAccount,
  listAccountsForApi,
} from '../../../backend/services/providerAccountService';
// Remediation: server-side env-var-name validation (no secrets in a name field).
import { describeRejectedEnvVarName, isEnvVarName } from '../../../backend/security/credentialSafety';
import { requireCapability } from '../../../backend/security/requireCapability';
import { INTEGRATION_PLATFORM_OAUTH_MANAGE } from '../../../shared/contracts/security';

// ── Auth guards ────────────────────────────────────────────────────────────────
//
// READ guard: bridge accepted via centralized helper (signature-validated +
// dry-run-aware). Mutations gate on `requireCapability` below.

async function requireSuperAdminRead(
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

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── GET: list accounts for a provider ──────────────────────────────────────
  if (req.method === 'GET') {
    const session = await requireSuperAdminRead(req, res);
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
    // Phase 2 mutation gate. Provider-account creation writes encrypted
    // OAuth credentials to api_provider_accounts — same blast radius as
    // platform-OAuth-configs writes. Bridge principals are explicitly
    // rejected; canonical SUPER_ADMIN with phishing-resistant +
    // trusted-device step-up is required.
    const guard = await requireCapability(req, res, {
      capability: INTEGRATION_PLATFORM_OAUTH_MANAGE,
      reason: 'provider-account credential creation',
    });
    if (guard.ok !== true) return;
    const session = { userId: guard.principal.userId };

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

    // REMEDIATION: reject a secret pasted into the env-var-NAME field. Server-side, because
    // the client is not the security boundary — this is the exact path by which live provider
    // secrets reached a readable column.
    if (credentials.api_key_env_name && !isEnvVarName(credentials.api_key_env_name)) {
      return res.status(400).json({
        error: 'INVALID_ENV_VAR_NAME',
        // Describes the shape; never echoes the submitted value.
        detail: describeRejectedEnvVarName(credentials.api_key_env_name),
      });
    }

    // REMEDIATION: one shared envelope builder encrypts `api_key_value` with the same
    // `encryptCredential` already used for OAuth. Previously this endpoint wrote the raw key
    // verbatim into a column named `credentials_encrypted`.
    let credentialsEncrypted: string;
    try {
      credentialsEncrypted = buildCredentialEnvelope({ existing: null, supplied: credentials });
    } catch {
      // Fail CLOSED — never fall back to storing plaintext.
      return res.status(500).json({ error: 'Failed to encrypt credentials' });
    }

    try {
      const account = await createProviderAccount({
        api_source_id,
        account_name: account_name.trim(),
        credentials_encrypted: credentialsEncrypted,
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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/provider-accounts' });
