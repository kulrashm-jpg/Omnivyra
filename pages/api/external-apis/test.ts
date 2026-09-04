import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
// Canonical credential resolution so Test Connection exercises the real active credential.
import { resolveAccountForRequest } from '../../../backend/services/providerAccountService';
import { buildExternalApiRequest, executeExternalApiRequest, validatePlatformConfig } from '../../../backend/services/externalApiService';
import { buildCacheKey, getCacheStats, getCachedResponse, setCachedResponse } from '../../../backend/services/redisExternalApiCache';
import { normalizeExternalTrends } from '../../../backend/services/trendNormalizationService';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { Role } from '../../../backend/services/rbacService';
import { withRBAC } from '../../../backend/middleware/withRBAC';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_CHARS = 2000;

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

    // ── Test the credential the RUNTIME will actually use ─────────────────────
    //
    // This previously built the request from the submitted `api_key_env_name` alone and
    // never consulted the provider's active account. "Connection OK" therefore proved
    // nothing about the credential a real request would use — which is precisely how
    // SerpAPI reported OK while returning 401 in production.
    //
    // When testing a SAVED provider (`api_source_id` supplied), resolve its active account
    // through the canonical resolver and hand the resulting credential to the request
    // builder, exactly as `execution.ts` does. `buildExternalApiRequest` already accepts
    // `accountCredentials` and gives it precedence, so no new mechanism is introduced.
    //
    // An UNSAVED secret is accepted transiently for a pre-activation test: it is used for
    // this request only, is never persisted, never returned, and never logged. It reaches
    // the request builder through the same `accountCredentials` seam.
    let accountCredentials: Awaited<ReturnType<typeof resolveAccountForRequest>>['credentials'] = null;
    const apiSourceId = typeof input.api_source_id === 'string' ? input.api_source_id.trim() : '';
    if (apiSourceId) {
      const resolved = await resolveAccountForRequest(apiSourceId).catch(() => null);
      accountCredentials = resolved?.credentials ?? null;
    }
    const transientSecret = typeof input.api_key_value === 'string' ? input.api_key_value.trim() : '';
    if (transientSecret) {
      accountCredentials = {
        source: 'account',
        accountId: accountCredentials?.accountId ?? null,
        api_key_env_name: accountCredentials?.api_key_env_name ?? null,
        api_key_value: transientSecret,
        oauth_client_id: accountCredentials?.oauth_client_id ?? null,
        oauth_client_secret: accountCredentials?.oauth_client_secret ?? null,
      };
    }

    const request = buildExternalApiRequest(source, {
      accountCredentials,
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
      normalized_trends: normalizedTrends,
      response: {
        ok: responseOk,
        status: responseStatus,
        statusText: responseStatusText,
        body: parsed,
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
