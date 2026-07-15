import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
// W4-1/W4-7 (Batch D cache stack): F-12 client + shared flag + SWR headers.
import { registerCacheNamespace } from '../../lib/platform/cacheCore';
import { createCache } from '../../lib/platform/cacheClient';
import { RESPONSE_CACHE_FLAG, setSwrCacheHeaders } from '../../lib/platform/responseCache';
import { resolveRolloutSync } from '../../lib/platform/rollout';

/**
 * GET /api/readiness-score
 * 
 * Returns readiness score (0-100) based on feature completion
 * Optionally includes breakdown and recommendations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../backend/services/supabaseAuthService';
import { supabase } from '../../backend/db/supabaseClient';
import { getFeatureCompletionStatus } from '../../backend/services/featureCompletionSyncService';
import {
  computeReadinessScore,
  generateReadinessReport,
  ReadinessScoreResponse,
} from '../../backend/services/readinessScoreService';

interface ApiResponse {
  success: boolean;
  data?: {
    score: number;
    level: string;
    breakdown?: any[];
    recommendations?: any[];
    completedFeatures?: number;
    totalFeatures?: number;
  };
  error?: string;
  meta?: {
    computedAt?: string;
    cachedAt?: string;
    companyId?: string;
  };
}

// W4-1 (audit B-40): the per-process Map ("In production, use Redis" — its
// own words) is replaced by the F-12 cache client under the shared
// 'response-cache' flag: tenant-isolated Redis keys, 5-min TTL, gzip,
// hit/miss metrics, kill switch CACHE_KILL_OMNIVYRA_RESP_READINESS_SCORE.
// Flag off (default) = the historical in-memory Map, byte-for-byte.
const scoreCache = new Map<
  string,
  { data: ReadinessScoreResponse; timestamp: number }
>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const READINESS_NS = registerCacheNamespace({
  prefix: 'omnivyra:resp:readiness-score',
  description: 'W4-1 readiness score response cache (audit B-40)',
  version: 1,
  defaultTtlSeconds: 300,
  requireTenant: true,
});
const readinessCache = createCache(READINESS_NS);

function redisCacheEnabled(): boolean {
  try {
    return resolveRolloutSync(RESPONSE_CACHE_FLAG).mode !== 'off';
  } catch {
    return false;
  }
}

function getCacheKey(companyId: string): string {
  return `readiness-score:${companyId}`;
}

async function getCachedScore(companyId: string): Promise<
  | { data: ReadinessScoreResponse; cached: true }
  | { data: null; cached: false }
> {
  if (redisCacheEnabled()) {
    const hit = await readinessCache.get<ReadinessScoreResponse>({ tenantId: companyId, parts: ['score'] });
    return hit ? { data: hit, cached: true } : { data: null, cached: false };
  }
  const cacheKey = getCacheKey(companyId);
  const cached = scoreCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { data: cached.data, cached: true };
  }

  // Clean up expired cache
  if (cached) {
    scoreCache.delete(cacheKey);
  }

  return { data: null, cached: false };
}

function setCachedScore(companyId: string, data: ReadinessScoreResponse): void {
  if (redisCacheEnabled()) {
    void readinessCache.set({ tenantId: companyId, parts: ['score'], value: data }).catch(() => {});
    return;
  }
  const cacheKey = getCacheKey(companyId);
  scoreCache.set(cacheKey, { data, timestamp: Date.now() });
}

/**
 * GET handler
 * 
 * Query parameters:
 * - breakdown=true: Include feature breakdown
 * - recommendations=true: Include actionable recommendations
 * - no_cache=true: Skip cache and recompute
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    });
  }

  try {
    // Authenticate via the canonical resolver (Authorization: Bearer OR the Supabase
    // auth-cookie envelope) — the same path every other authenticated API uses. The
    // prior createServerClient + getSession(req.cookies) guard could not read this
    // app's auth cookie and returned 401 on every call (SIM-004 / EXEC-002 defect).
    const { user } = await getSupabaseUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const userId = user.id; // public.users.id — user_company_roles.user_id references this

    // Get user's company
    const requestedCompanyId =
      typeof req.query.company_id === 'string' ? req.query.company_id.trim() : '';

    const { data: activeRoles } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    const allowedCompanyIds = (activeRoles || []).map((role) => role.company_id).filter(Boolean);
    const companyId = requestedCompanyId && allowedCompanyIds.includes(requestedCompanyId)
      ? requestedCompanyId
      : allowedCompanyIds[0];

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'Company not found for user',
      });
    }

    // Check cache (unless explicitly bypassed)
    const noCache = req.query.no_cache === 'true';
    let scoreData: ReadinessScoreResponse | null = null;
    let wasCached = false;

    if (!noCache) {
      const cached = await getCachedScore(companyId);
      if (cached.cached) {
        scoreData = cached.data;
        wasCached = true;
      }
      // W4-7: idempotent per-user readiness read — browser may reuse briefly
      // and revalidate in the background. Never applied on no_cache requests.
      setSwrCacheHeaders(res, { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 });
    }

    // Recompute if not cached
    if (!scoreData) {
      const features = await getFeatureCompletionStatus(companyId);
      scoreData = computeReadinessScore(features);
      setCachedScore(companyId, scoreData);
    }

    // Generate full report if requested
    const includeBreakdown = req.query.breakdown === 'true';
    const includeRecommendations = req.query.recommendations === 'true';

    let reportData = null;
    if (includeRecommendations) {
      reportData = generateReadinessReport(scoreData);
    }

    // Build response
    const response: ApiResponse = {
      success: true,
      data: {
        score: scoreData.score,
        level: reportData ? reportData.level : '',
        ...(includeBreakdown && { breakdown: scoreData.breakdown }),
        ...(includeRecommendations && { recommendations: reportData?.recommendations }),
        completedFeatures: scoreData.completedFeatures,
        totalFeatures: scoreData.totalFeatures,
      },
      meta: {
        computedAt: new Date().toISOString(),
        cachedAt: wasCached ? new Date(Date.now() - CACHE_TTL_MS).toISOString() : undefined,
        companyId,
      },
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('[readiness-score] Error:', err);
    return res.status(500).json({
      success: false,
      error: `Failed to compute readiness score: ${(err as Error).message}`,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/readiness-score' });
