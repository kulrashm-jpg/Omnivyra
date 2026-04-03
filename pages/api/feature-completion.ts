
/**
 * GET /api/feature-completion
 * 
 * Retrieves feature completion status for authenticated user's company
 * Optionally auto-syncs latest data before returning
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from '@supabase/ssr';
import { getFeatureCompletionStatus, getFeatureCompletionSummary, syncFeatureCompletion } from '../../backend/services/featureCompletionSyncService';
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

    const userId = session.user.id;

    // Get user's company (from context or header)
    // This depends on your company context implementation
    // Example: get from user_company_roles table
    const { data: userCompanyRole } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', userId)
      .single();

    const companyId = userCompanyRole?.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'Company not found for user',
      });
    }

    // Check if auto-sync requested
    const shouldSync = req.query.sync === 'true';

    if (shouldSync) {
      try {
        await syncFeatureCompletion(companyId, userId);
      } catch (err) {
        console.error('[feature-completion] Sync error:', err);
        // Don't fail the request, just log the error
      }
    }

    // Get feature completion status
    const features = await getFeatureCompletionStatus(companyId);
    const summary = await getFeatureCompletionSummary(companyId);

    // Transform to API response format
    const response: FeatureCompletionResponse = {
      features: features.map(f => ({
        key: f.feature_key as FeatureKey,
        status: f.status as any,
        completedAt: f.completed_at,
      })),
      summary: {
        total: summary.total,
        completed: summary.completed,
        percentage: summary.percentage,
      },
    };

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
    return res.status(500).json({
      success: false,
      error: `Failed to fetch feature completion: ${(err as Error).message}`,
    });
  }
}
