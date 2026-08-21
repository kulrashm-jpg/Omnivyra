import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
import { appendServerTiming, createTimingSink, flushTimingSink, timeStage } from '../../lib/platform/serverTiming';

/**
 * GET /api/feature-completion
 * 
 * Retrieves feature completion status for authenticated user's company
 * Optionally auto-syncs latest data before returning
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../backend/services/supabaseAuthService';
import { supabase } from '../../backend/db/supabaseClient';
import { getFeatureCompletionSummary, syncFeatureCompletion } from '../../backend/services/featureCompletionSyncService';
import { FeatureKey, FeatureCompletionResponse } from '../../backend/types/featureCompletion';

interface ApiResponse {
  success: boolean;
  data?: FeatureCompletionResponse;
  error?: string;
  meta?: {
    syncedAt?: string;
    companyId?: string;
  };
}

/**
 * GET handler
 * 
 * Query parameters:
 * - sync=true: Force sync before returning (auto-compute latest)
 * - company_id: Optional to override (requires admin)
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  // Server-Timing for this handler — same helper and conventions as
  // /api/reports and /api/company-profile?mode=list. Stages wrap the calls
  // where they already sit; nothing is reordered, split or made conditional.
  const handlerStart = Date.now();
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
    // `auth` is the outer boundary; the sink decomposes it into the two IO
    // operations inside the resolver — auth_validate (GoTrue db.auth.getUser)
    // and auth_user (the users row keyed on the validated supabaseUid). Both
    // are already wrapped in timeInto(); without a sink those calls are a no-op
    // and the stage stays opaque, which is why 46.7% of this request was
    // unattributable. Same helper and same pattern as company-profile?mode=list.
    //
    // Observability only: an absent sink is zero-overhead, and supplying one
    // only appends Server-Timing entries. No auth behaviour changes.
    const authTiming = createTimingSink();
    const { user } = await timeStage(res, 'auth', () => getSupabaseUserFromRequest(req, authTiming));
    flushTimingSink(res, authTiming);
    if (!user) {
      appendServerTiming(res, 'total', Date.now() - handlerStart);
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const userId = user.id; // public.users.id — user_company_roles.user_id references this

    const requestedCompanyId =
      typeof req.query.company_id === 'string' ? req.query.company_id.trim() : '';

    const { data: activeRoles } = await timeStage(res, 'roles', async () => supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false }));

    const allowedCompanyIds = (activeRoles || []).map((role) => role.company_id).filter(Boolean);
    const companyId = requestedCompanyId && allowedCompanyIds.includes(requestedCompanyId)
      ? requestedCompanyId
      : allowedCompanyIds[0];

    if (!companyId) {
      appendServerTiming(res, 'total', Date.now() - handlerStart);
      return res.status(400).json({
        success: false,
        error: 'Company not found for user',
      });
    }

    // Check if auto-sync requested
    const shouldSync = req.query.sync === 'true';

    if (shouldSync) {
      try {
        await timeStage(res, 'sync', () => syncFeatureCompletion(companyId, userId));
      } catch (err) {
        console.error('[feature-completion] Sync error:', err);
        // Don't fail the request, just log the error
      }
    }

    // One read of feature_completion, not two.
    //
    // getFeatureCompletionSummary calls getFeatureCompletionStatus internally
    // and returns those same rows on `.features`, so the separate `features`
    // stage that used to sit here issued a byte-identical second query against
    // feature_completion and discarded nothing. It was a duplicate sequential
    // hop on the response critical path — measured median 427ms (min 287,
    // max 2,846) against a ~270ms cross-region floor.
    //
    // `features` below is the exact same data the removed call produced, so
    // the response payload is unchanged.
    const summary = await timeStage(res, 'summary', () => getFeatureCompletionSummary(companyId));
    const features = summary.features;

    // Transform to API response format
    const response: FeatureCompletionResponse = {
      features: features.map(f => ({
        key: f.feature_key as FeatureKey,
        status: f.status as any,
        score: typeof f.metadata?.score === 'number' ? f.metadata.score : (f.status === 'completed' ? 1 : 0),
        completedAt: f.completed_at,
      })),
      summary: {
        total: summary.total,
        completed: summary.completed,
        percentage: summary.percentage,
      },
    };

    appendServerTiming(res, 'total', Date.now() - handlerStart);
    return res.status(200).json({
      success: true,
      data: response,
      meta: {
        syncedAt: new Date().toISOString(),
        companyId,
      },
    });
  } catch (err) {
    console.error('[feature-completion] Error:', err);
    appendServerTiming(res, 'total', Date.now() - handlerStart);
    return res.status(500).json({
      success: false,
      error: `Failed to fetch feature completion: ${(err as Error).message}`,
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/feature-completion' });
