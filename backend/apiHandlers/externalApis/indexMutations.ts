/** Part of the external-apis API (Agent-B split — backend module, not a route). */
// Remediation: reject secrets pasted into the env-var-name field (server-side).
import { describeRejectedEnvVarName, isEnvVarName } from '../../security/credentialSafety';
import { requireExternalApiAccess, requirePlatformAdmin, parseUsageUserId } from './indexShared';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../db/supabaseClient';
import {
  getPlatformConfigs,
  getExternalApiRuntimeSnapshot,
  savePlatformConfig,
  validatePlatformConfig,
  VALID_API_CATEGORIES,
} from '../../services/externalApiService';
import { getSupabaseUserFromRequest } from '../../services/supabaseAuthService';
import { getLegacySuperAdminSession } from '../../services/superAdminSession';
import {
  getUserRole,
  getCompanyRoleIncludingInvited,
  hasPermission,
  isPlatformSuperAdmin,
  isSuperAdmin,
  Role,
} from '../../services/rbacService';
import { encryptCredential } from '../../auth/credentialEncryption';
import { checkAndGrantSetupCredits } from '../../services/earnCreditsService';
import { requireCapability } from '../../security/requireCapability';
import { hasCapability } from '../../security/AuthorizationService';
import { resolvePrincipal } from '../../security/IdentityResolver';
import { INTEGRATION_SECRETS_READ } from '../../../shared/contracts/security';
import type { AuthenticatedPrincipal } from '../../../shared/contracts/security';


export async function handleExternalApisPost(req: NextApiRequest, res: NextApiResponse): Promise<unknown> {
  const companyId =
    (req.query?.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const platformScopeRequested = req.query?.scope === 'platform';
  void companyId; void platformScopeRequested;
  if (req.method === 'POST') {
    // Wave 2C-A: platform-scoped POST creates/edits PLATFORM-LEVEL
    // integration configs (with OAuth client_id / client_secret).
    // Gate it on integration.secrets.read with phishing-resistant step-up.
    // Tenant-scoped POSTs use the existing tenant-level access helper
    // and rely on hasCapability(INTEGRATION_SECRETS_READ) for the
    // OAuth-secret persistence decision.
    let elevatedPrincipal: AuthenticatedPrincipal | null = null;
    if (platformScopeRequested && !companyId) {
      const guard = await requireCapability(req, res, {
        capability: INTEGRATION_SECRETS_READ,
        reason: 'super-admin creates / edits a platform-level external API config',
      });
      if (guard.ok !== true) return;
      elevatedPrincipal = guard.principal;
    }

    const access = platformScopeRequested && !companyId
      ? await requirePlatformAdmin(req, res)
      : await requireExternalApiAccess(req, res, companyId, true);
    if (!access) return;

    // Resolve the AuthenticatedPrincipal once for OAuth-secret shaping.
    // Tenant-scoped POSTs reach here without requireCapability; they
    // need their own principal lookup. Bridge cookie principals get a
    // synthetic principal that DOES NOT include INTEGRATION_SECRETS_READ.
    if (!elevatedPrincipal) {
      const r = await resolvePrincipal(req);
      if (r.ok === true) elevatedPrincipal = r.principal;
    }
    const canManageIntegrationSecrets = !!elevatedPrincipal
      && hasCapability(elevatedPrincipal, INTEGRATION_SECRETS_READ);
    const {
      name,
      base_url,
      purpose,
      category,
      is_active,
      method,
      auth_type,
      api_key_name,
      api_key_env_name,
      headers,
      query_params,
      is_preset,
      retry_count,
      timeout_ms,
      rate_limit_per_min,
      platform_type,
      supported_content_types,
      promotion_modes,
      required_metadata,
      posting_constraints,
      requires_admin,
      oauth_client_id,
      oauth_client_secret,
    } = req.body || {};

    const resolvedPlatformType = platform_type || 'social';

    // Wave 2C-C: capability-based OAuth-secret shaping.
    // The integration.secrets.read capability is granted to SUPER_ADMIN
    // (capabilityRegistry) and is the canonical authority for who can
    // submit OAuth credentials. Tenant users (COMPANY_ADMIN +) lack the
    // capability and are rejected if they attempt to submit secrets.
    let oauthClientIdEncrypted: string | null = null;
    let oauthClientSecretEncrypted: string | null = null;
    if (canManageIntegrationSecrets) {
      if (typeof oauth_client_id === 'string' && oauth_client_id.trim()) {
        try {
          oauthClientIdEncrypted = encryptCredential(oauth_client_id.trim());
        } catch (e) {
          console.warn('OAuth client ID encryption failed:', (e as Error)?.message);
        }
      }
      if (typeof oauth_client_secret === 'string' && oauth_client_secret.trim()) {
        try {
          oauthClientSecretEncrypted = encryptCredential(oauth_client_secret.trim());
        } catch (e) {
          console.warn('OAuth client secret encryption failed:', (e as Error)?.message);
        }
      }
    } else if (
      (typeof oauth_client_id === 'string' && oauth_client_id.trim()) ||
      (typeof oauth_client_secret === 'string' && oauth_client_secret.trim())
    ) {
      return res.status(403).json({
        error: 'OAuth credentials can only be configured by users with integration-secrets capability. Use Connect Accounts to authorize social media.',
        code: 'CAPABILITY_NOT_HELD',
      });
    }
    const validation = validatePlatformConfig({
      name,
      base_url,
      platform_type: resolvedPlatformType,
      method,
      headers,
      query_params,
      supported_content_types,
      promotion_modes,
      required_metadata,
      posting_constraints,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message || 'Invalid platform config' });
    }

    // ── Category validation (SuperAdmin paths only — tenant path is forced below) ──
    const resolvedCategory: string | null = (() => {
      if (platformScopeRequested && !companyId) {
        // SuperAdmin creating a platform-level API
        if (category && !VALID_API_CATEGORIES.includes(category as any)) {
          return null; // signals invalid — handled below
        }
        return category || null;
      }
      // Tenant-created API: always forced to 'others', never whitelisted
      return 'others';
    })();

    if (platformScopeRequested && !companyId && category && !VALID_API_CATEGORIES.includes(category as any)) {
      return res.status(400).json({
        error: `Invalid category "${category}". Allowed values: ${VALID_API_CATEGORIES.join(', ')}`,
      });
    }

    // SuperAdmin creating an 'others' API must explicitly whitelist it
    const resolvedIsWhitelisted: boolean = (() => {
      if (platformScopeRequested && !companyId) {
        if (resolvedCategory === 'others') {
          if (!(req.body?.is_whitelisted === true)) {
            return false; // will be caught below
          }
          return true;
        }
        // Non-others preset APIs default to whitelisted
        return req.body?.is_whitelisted ?? true;
      }
      // Tenant APIs: never whitelisted
      return false;
    })();

    if (
      platformScopeRequested && !companyId &&
      resolvedCategory === 'others' &&
      !resolvedIsWhitelisted
    ) {
      return res.status(400).json({
        error: 'APIs with category "others" must have is_whitelisted = true to be usable. Set is_whitelisted: true or choose a different category.',
      });
    }

    // REMEDIATION — server-side env-var-NAME validation.
    //
    // This field is documented as holding the NAME of an environment variable. Nothing
    // enforced that, and four provider rows were found holding live API secrets, which
    // `select('*')` then served to clients. Rejecting here is the primary fix; the read-path
    // redaction in `indexRead` is the backstop for rows written before this existed.
    //
    // The error describes the SHAPE of the problem and never echoes the submitted value.
    const resolvedApiKeyEnv = api_key_env_name || api_key_name || null;
    if (resolvedApiKeyEnv && !isEnvVarName(resolvedApiKeyEnv)) {
      return res.status(400).json({
        error: 'INVALID_ENV_VAR_NAME',
        detail: describeRejectedEnvVarName(resolvedApiKeyEnv),
      });
    }
    if (platformScopeRequested && !companyId) {
      const api = await savePlatformConfig({
        name,
        base_url,
        purpose,
        category: resolvedCategory,
        is_active: is_active ?? true,
        method: method || 'GET',
        auth_type: auth_type || 'none',
        api_key_name: api_key_name || null,
        api_key_env_name: resolvedApiKeyEnv,
        oauth_client_id_encrypted: oauthClientIdEncrypted,
        oauth_client_secret_encrypted: oauthClientSecretEncrypted,
        headers: headers || {},
        query_params: query_params || {},
        is_preset: is_preset ?? false,
        retry_count: retry_count ?? 2,
        timeout_ms: timeout_ms ?? 8000,
        rate_limit_per_min: rate_limit_per_min ?? 60,
        platform_type: resolvedPlatformType,
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
        is_whitelisted: resolvedIsWhitelisted,
        is_enabled_global: req.body?.is_enabled_global ?? true,
        company_id: null,
        created_at: new Date().toISOString(),
      });
      const { oauth_client_id_encrypted: _oid, oauth_client_secret_encrypted: _osec, ...apiSafe } = api as any;
      return res.status(201).json({ api: { ...apiSafe, has_oauth_credentials: !!(_oid && _osec) } });
    }

    // Tenant-created API: force category='others', is_whitelisted=false, is_enabled_global=true
    const { data, error } = await supabase
      .from('external_api_sources')
      .insert({
        name,
        base_url,
        purpose: purpose || 'posting',
        category: 'others',
        is_active: is_active ?? true,
        is_whitelisted: false,
        is_enabled_global: true,
        method: method || 'GET',
        auth_type: auth_type || 'none',
        api_key_name: api_key_name || null,
        api_key_env_name: resolvedApiKeyEnv,
        oauth_client_id_encrypted: oauthClientIdEncrypted,
        oauth_client_secret_encrypted: oauthClientSecretEncrypted,
        headers: headers || {},
        query_params: query_params || {},
        is_preset: is_preset ?? false,
        retry_count: retry_count ?? 2,
        timeout_ms: timeout_ms ?? 8000,
        rate_limit_per_min: rate_limit_per_min ?? 60,
        platform_type: resolvedPlatformType,
        supported_content_types: supported_content_types || [],
        promotion_modes: promotion_modes || [],
        required_metadata: required_metadata || {},
        posting_constraints: posting_constraints || {},
        requires_admin: requires_admin ?? true,
        company_id: companyId,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({
        error: 'Failed to create external API',
        detail: error.message,
      });
    }
    const { oauth_client_id_encrypted: _oid, oauth_client_secret_encrypted: _osec, ...apiSafe } = (data || {}) as any;

    // Mark external_api_connected in setup progress and check earn credits (fire-and-forget)
    if (companyId && access?.userId) {
      Promise.resolve(
        supabase.from('company_setup_progress').upsert(
          { company_id: companyId, external_api_connected: true, updated_at: new Date().toISOString() },
          { onConflict: 'company_id' },
        )
      ).then(() =>
        checkAndGrantSetupCredits(companyId, access.userId)
          .catch(e => console.warn('[external-apis] setup credits check failed:', e?.message))
      ).catch(() => {});
    }

    return res.status(201).json({ api: { ...apiSafe, has_oauth_credentials: !!(_oid && _osec) } });
  }
  return false;
}
