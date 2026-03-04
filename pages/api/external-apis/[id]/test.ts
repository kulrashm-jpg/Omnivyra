import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { buildExternalApiRequest, executeExternalApiRequest } from '../../../../backend/services/externalApiService';
import { buildCacheKey, getCacheStats, getCachedResponse, setCachedResponse } from '../../../../backend/services/externalApiCacheService';
import { updateApiHealth } from '../../../../backend/services/externalApiHealthService';
import { normalizeExternalTrends } from '../../../../backend/services/trendNormalizationService';
import { resolveUserContext } from '../../../../backend/services/userContextService';
import { Role } from '../../../../backend/services/rbacService';
import { withRBAC } from '../../../../backend/middleware/withRBAC';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_CHARS = 2000;

const normalizeError = (error: any) => {
  if (error?.name === 'AbortError') return 'Request timed out';
  return error?.message || 'Request failed';
};

const truncate = (value: string) =>
  value.length > MAX_RESPONSE_CHARS ? `${value.slice(0, MAX_RESPONSE_CHARS)}...` : value;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'API ID is required' });
  }
  const platformScopeRequested = req.query?.scope === 'platform';
  const { defaultCompanyId } = await resolveUserContext(req);
  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (platformScopeRequested ? undefined : defaultCompanyId);
  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    let query = supabase
      .from('external_api_sources')
      .select('*')
      .eq('id', id);
    if (!platformScopeRequested) {
      query = query.eq('company_id', companyId);
    }
    const { data, error } = await query.single();
    if (error || !data) {
      return res.status(404).json({ error: 'API source not found' });
    }

    const request = buildExternalApiRequest(data);
    if (request.missingEnv.length > 0) {
      console.warn('EXTERNAL_API_TEST_MISSING_ENV', { source: data.name, missing: request.missingEnv });
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

    const cacheKey = buildCacheKey({ apiId: data.id, geo: undefined, category: undefined });
    const cached = getCachedResponse<any>(cacheKey, data.id);
    let parsed: any = cached;
    let cacheHit = Boolean(cached);
    let responseStatus = 200;
    let responseStatusText = 'Cached';
    let responseOk = true;
    let healthSnapshot = null;
    let latencyMs = 0;
    const testedAt = new Date().toISOString();

    if (!cached) {
      const result = await executeExternalApiRequest({
        source: data,
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
      const successResult = result as { response: Response; latencyMs: number };
      latencyMs = successResult.latencyMs;
      const { response } = successResult;
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
      healthSnapshot = await updateApiHealth({
        apiId: data.id,
        success: response.ok,
        latencyMs,
        last_test_status: response.ok ? 'SUCCESS' : 'FAILED',
        last_test_at: testedAt,
      });
      if (response.ok) {
        setCachedResponse(cacheKey, parsed, DEFAULT_TIMEOUT_MS);
      }
    }

    const normalizedTrends = normalizeExternalTrends({
      source: data,
      payload: parsed,
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
      health: healthSnapshot,
      normalized_trends: normalizedTrends,
      response: {
        ok: responseOk,
        status: responseStatus,
        statusText: responseStatusText,
        body: parsed,
      },
      latency_ms: latencyMs,
      tested_at: testedAt,
    });
  } catch (error: any) {
    return res.status(500).json({ error: normalizeError(error) });
  }
}

export default withRBAC(handler, [Role.SUPER_ADMIN]);
