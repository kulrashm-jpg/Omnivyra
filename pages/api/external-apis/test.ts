import { NextApiRequest, NextApiResponse } from 'next';
import { buildExternalApiRequest, executeExternalApiRequest, validatePlatformConfig } from '../../../backend/services/externalApiService';
import { buildCacheKey, getCacheStats, getCachedResponse, setCachedResponse } from '../../../backend/services/externalApiCacheService';
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

  const { defaultCompanyId: companyId } = await resolveUserContext(req);
  if (!companyId) {
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
      company_id: companyId,
    };

    const request = buildExternalApiRequest(source);
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
      const { response } = await executeExternalApiRequest({
        source,
        request: request.details,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      cacheHit = false;
      responseStatus = response.status;
      responseStatusText = response.statusText;
      responseOk = response.ok;
      const contentType = response.headers.get('content-type') || '';
      const rawText = await response.text();
      const truncated = truncate(rawText);
      if (contentType.includes('application/json')) {
        try {
          parsed = JSON.parse(truncated);
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
    return res.status(500).json({ error: normalizeError(error) });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
