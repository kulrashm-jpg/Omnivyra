import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { buildExternalApiRequest, executeExternalApiRequest, validatePlatformConfig } from '../../../backend/services/externalApiService';
import { buildCacheKey, getCacheStats, getCachedResponse, setCachedResponse } from '../../../backend/services/redisExternalApiCache';
import { normalizeExternalTrends } from '../../../backend/services/trendNormalizationService';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';
import { assertTestableEnvVarName } from '../../../backend/services/externalApi/testEnvAllowlist';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_CHARS = 2000;

/** Auth types whose request actually carries the resolved credential. */
const AUTH_TYPES_CONSUMING_KEY = new Set(['api_key', 'bearer', 'query', 'header']);

/**
 * Returned instead of the provider body when the request carried a credential.
 *
 * The body is attacker-influenced content: a caller-chosen `base_url` can echo the
 * Authorization header or `apiKey` query parameter straight back, turning a connectivity
 * check into a credential read. Status, ok and latency are enough to diagnose connectivity
 * and cannot carry credential material.
 */
const CREDENTIAL_BODY_WITHHELD =
  'Response body withheld: this request carried a credential, and provider content can reflect it.';

const normalizeError = (error: any) => {
  if (error?.name === 'AbortError') return 'Request timed out';
  return error?.message || 'Request failed';
};

const truncate = (value: string) =>
  value.length > MAX_RESPONSE_CHARS ? `${value.slice(0, MAX_RESPONSE_CHARS)}...` : value;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { defaultCompanyId } = await resolveUserContext(req);
  const platformScopeRequested = req.query?.scope === 'platform';
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (platformScopeRequested ? undefined : defaultCompanyId);
  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId required' });
  }

  const input = req.body || {};
  const validation = validatePlatformConfig({
    name: input.name || 'Ad hoc',
    base_url: input.base_url,
    platform_type: input.platform_type || 'social',
    method: input.method,
    headers: input.headers,
    query_params: input.query_params,
    supported_content_types: input.supported_content_types,
    promotion_modes: input.promotion_modes,
    required_metadata: input.required_metadata,
    posting_constraints: input.posting_constraints,
  });
  if (!validation.ok) {
    return res.status(400).json({ error: validation.message || 'Invalid config' });
  }

  // ── SECURITY: the credential this test may resolve ────────────────────────
  //
  // `api_key_env_name` arrives from the request body and previously reached
  // `process.env[name]` unrestricted, so any server secret could be resolved and sent to
  // the caller's own `base_url`. Only names the application already declares as
  // external-API credentials are testable. See testEnvAllowlist.ts.
  const envDecision = await assertTestableEnvVarName(input.api_key_env_name);
  if (!envDecision.allowed) {
    return res.status(400).json({
      error: 'Unsupported api_key_env_name',
      code: 'ENV_VAR_NOT_TESTABLE',
      detail: envDecision.reason,
    });
  }
  // A credential is only in play when the auth type actually consumes one.
  const authTypeForTest = String(input.auth_type || 'none');
  const credentialInPlay =
    Boolean(envDecision.envName) && AUTH_TYPES_CONSUMING_KEY.has(authTypeForTest);

  try {
    const source = {
      id: 'ad-hoc',
      name: input.name || 'Ad hoc',
      base_url: input.base_url,
      purpose: input.purpose || 'trends',
      category: input.category || null,
      is_active: true,
      method: input.method || 'GET',
      auth_type: input.auth_type || 'none',
      api_key_name: input.api_key_name || null,
      api_key_env_name: input.api_key_env_name || null,
      headers: input.headers || {},
      query_params: input.query_params || {},
      created_at: new Date().toISOString(),
      company_id: companyId ?? null,
    };

    const request = buildExternalApiRequest(source, {
      runtimeValues: {
        category: input.category || '',
        geo: input.geo || '',
      },
    });
    if (request.missingEnv.length > 0) {
      console.warn('EXTERNAL_API_TEST_MISSING_ENV', { missing: request.missingEnv });
      return res.status(400).json({
        error: 'Missing environment variables',
        missing: request.missingEnv,
        request: {
          method: request.details.method,
          url: request.details.maskedUrl,
          headers: request.details.maskedHeaders,
          queryParams: request.details.queryParams,
        },
      });
    }

    const cacheKey = buildCacheKey({ apiId: 'ad-hoc', geo: input.geo, category: input.category });
    const cached = getCachedResponse<any>(cacheKey, 'ad-hoc');
    let parsed: any = cached;
    let cacheHit = Boolean(cached);
    let responseStatus = 200;
    let responseStatusText = 'Cached';
    let responseOk = true;

    if (!cached) {
      const result = await executeExternalApiRequest({
        source,
        request: request.details,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      if ('status' in result && result.status === 'blocked_plan_limit') {
        return res.status(403).json({
          error: 'Plan limit exceeded',
          code: result.error?.code ?? 'PLAN_LIMIT_EXCEEDED',
          ...result.error,
        });
      }
      const { response } = result as { response: Response; latencyMs: number };
      cacheHit = false;
      responseStatus = response.status;
      responseStatusText = response.statusText;
      responseOk = response.ok;
      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      const truncated = truncate(rawText);
      if (contentType.includes('application/json')) {
        try {
          parsed = JSON.parse(rawText);
        } catch (error) {
          parsed = truncated;
        }
      } else {
        parsed = truncated;
      }
      if (response.ok) {
        setCachedResponse(cacheKey, parsed, DEFAULT_TIMEOUT_MS);
      }
    }

    const normalizedTrends = normalizeExternalTrends({
      source,
      payload: parsed,
      geo: input.geo,
      category: input.category,
    });

    return res.status(200).json({
      request: {
        method: request.details.method,
        url: request.details.maskedUrl,
        headers: request.details.maskedHeaders,
        queryParams: request.details.queryParams,
      },
      cache: {
        hit: cacheHit,
        stats: getCacheStats(),
      },
      health: null,
      // SECURITY: derived from the provider payload, so it is withheld on the same
      // condition as the body — reflected content must not re-enter through normalisation.
      normalized_trends: credentialInPlay ? [] : normalizedTrends,
      response: {
        ok: responseOk,
        status: responseStatus,
        statusText: responseStatusText,
        // SECURITY: withheld when the request carried a credential — see
        // CREDENTIAL_BODY_WITHHELD. Unauthenticated tests keep the full body.
        body: credentialInPlay ? CREDENTIAL_BODY_WITHHELD : parsed,
      },
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to test API',
      detail: normalizeError(error),
    });
  }
}

export default __createApiRoute(withRBAC(handler, [Role.SUPER_ADMIN]), { route: '/api/external-apis/test' });
