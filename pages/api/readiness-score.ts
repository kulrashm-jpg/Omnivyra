
/**
 * GET /api/readiness-score
 * 
 * Returns readiness score (0-100) based on feature completion
 * Optionally includes breakdown and recommendations
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from '@supabase/ssr';
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

// Optional: Simple in-memory cache (for 5-10 min cache pattern)
// In production, use Redis or similar
const scoreCache = new Map<
  string,
  { data: ReadinessScoreResponse; timestamp: number }
>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(companyId: string): string {
  return `readiness-score:${companyId}`;
}

function getCachedScore(companyId: string):
  | { data: ReadinessScoreResponse; cached: true }
  | { data: null; cached: false } {
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
export default async function handler(
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
    // Authenticate user
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => Object.entries(req.cookies).map(([name, value]) => ({ name, value: value ?? '' })),
          setAll: () => {},
        },
      }
    );
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
    }

    // Get user's company
    const { data: userCompanyRole } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', session.user.id)
      .single();

    const companyId = userCompanyRole?.company_id;

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
      const cached = getCachedScore(companyId);
      if (cached.cached) {
        scoreData = cached.data;
        wasCached = true;
      }
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
