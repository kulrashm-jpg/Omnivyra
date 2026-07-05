import { ownedDbTable } from '../db/writeOwner';
/**
 * Feature Completion Sync Engine
 * Upserts computed feature status into database
 * Single source of truth: computations + database writes
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../../config';
import { FeatureKey, FeatureCompletionRecord, BatchComputeResult } from '../types/featureCompletion';
import { computeFeatureCompletion } from './featureCompletionService';

function requireStringConfig(value: unknown, key: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new Error(`Missing or invalid config value: ${key}`);
}

export interface LatchedFeatureState {
  status: string;
  score: number;
  completedAt: Date | string | null;
  retained: boolean;
}

/**
 * Monotonic latch: a feature is never written below what the company already earned.
 * Readiness + mastery are permanent — once a company reaches a score (published a
 * campaign, created content, used a tool), deleting the underlying entity later does
 * NOT revoke the credit. Keeps the higher of prior vs freshly-computed score, and
 * preserves the original completed_at when prior wins.
 */
export function resolveLatchedFeatureState(
  prior: { status: string; score: number; completedAt: Date | string | null } | null | undefined,
  computed: { status: string; score: number },
): LatchedFeatureState {
  const retained = prior != null && prior.score > computed.score;
  if (retained) {
    return { status: prior!.status, score: prior!.score, completedAt: prior!.completedAt, retained: true };
  }
  return {
    status: computed.status,
    score: computed.score,
    completedAt: computed.status === 'completed' ? new Date() : null,
    retained: false,
  };
}

const supabase = createClient(
  requireStringConfig(config.SUPABASE_URL, 'SUPABASE_URL'),
  requireStringConfig(config.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
);

/**
 * Sync feature completion for a company
 * 
 * Steps:
 * 1. Compute current feature status (all 8 features)
 * 2. Upsert each feature into database
 * 3. Return results and change count
 * 
 * @param companyId Company UUID
 * @param userId Optional user UUID for per-user tracking
 * @returns Sync result with changes count
 */
export async function syncFeatureCompletion(
  companyId: string,
  userId?: string
): Promise<BatchComputeResult> {
  const syncStartTime = new Date();

  try {
    // Step 1: Compute features
    const computedFeatures = await computeFeatureCompletion(companyId, userId);

    // Step 1b: Read what this company has ALREADY achieved so a fresh recompute can
    // never revoke earned credit. Readiness + mastery are monotonic: once a feature
    // reaches a score (a campaign published, content created, a tool used), deleting
    // the underlying entity later does NOT drop the score back down — the historical
    // fact that the company did it once is sufficient ("done once = scored forever").
    const { data: existingRows } = await ownedDbTable('feature_completion')
      .select('feature_key, status, completed_at, metadata')
      .eq('company_id', companyId);
    const priorByKey = new Map<string, { status: string; completedAt: Date | string | null; score: number }>();
    for (const row of (existingRows as Array<Record<string, any>> | null) ?? []) {
      const meta = row?.metadata;
      const storedScore =
        meta && typeof meta === 'object' && typeof meta.score === 'number'
          ? meta.score
          : row?.status === 'completed'
            ? 1
            : 0;
      priorByKey.set(row.feature_key, {
        status: row.status,
        completedAt: row.completed_at ?? null,
        score: storedScore,
      });
    }

    // Step 2: Upsert each feature
    let changesCount = 0;

    for (const feature of computedFeatures) {
      const latched = resolveLatchedFeatureState(priorByKey.get(feature.key), feature);

      const upsertData = {
        company_id: companyId,
        user_id: userId || null,
        feature_key: feature.key,
        status: latched.status,
        metadata: {
          reason: latched.retained ? `${feature.reason} (retained — previously achieved)` : feature.reason,
          score: latched.score,
          computedAt: new Date().toISOString(),
          latched: latched.retained,
        },
        completed_at: latched.completedAt,
      };

      const { error, data } = await ownedDbTable('feature_completion')
        .upsert(upsertData, {
          onConflict: 'company_id,feature_key', // Unique constraint
        })
        .select();

      if (error) {
        console.error(
          `[syncFeatureCompletion] Error upserting ${feature.key}:`,
          error
        );
        throw new Error(`Failed to upsert ${feature.key}: ${error.message}`);
      }

      // Count changes (optional: compare old vs new)
      if (data && data.length > 0) {
        changesCount++;
      }
    }

    return {
      companyId,
      features: computedFeatures,
      syncedAt: new Date(),
      changesCount,
    };
  } catch (err) {
    console.error('[syncFeatureCompletion] Sync failed:', err);
    throw new Error(`Feature completion sync failed: ${(err as Error).message}`);
  }
}

/**
 * Sync feature completion for multiple companies (batch)
 * Useful for periodic background jobs or migrations
 * 
 * @param companyIds Array of company UUIDs
 * @param options Optional configuration
 * @returns Array of sync results
 */
export async function syncFeatureCompletionBatch(
  companyIds: string[],
  options?: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<BatchComputeResult[]> {
  const concurrency = options?.concurrency ?? 5;
  const results: BatchComputeResult[] = [];
  let completed = 0;

  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < companyIds.length; i += concurrency) {
    const batch = companyIds.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map(companyId => syncFeatureCompletion(companyId))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error('[syncFeatureCompletionBatch] Error:', result.reason);
      }
      completed++;
      options?.onProgress?.(completed, companyIds.length);
    }
  }

  return results;
}

/**
 * Get current feature completion status (reads from database)
 * 
 * @param companyId Company UUID
 * @returns Array of feature status records
 */
export async function getFeatureCompletionStatus(
  companyId: string
): Promise<FeatureCompletionRecord[]> {
  const { data, error } = await ownedDbTable('feature_completion')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getFeatureCompletionStatus] Error:', error);
    throw new Error(`Failed to fetch feature completion: ${error.message}`);
  }

  return data || [];
}

/**
 * Get feature completion summary (percentage complete)
 * 
 * @param companyId Company UUID
 * @returns Summary with completion percentage
 */
export async function getFeatureCompletionSummary(companyId: string): Promise<{
  total: number;
  completed: number;
  percentage: number;
  features: FeatureCompletionRecord[];
}> {
  const features = await getFeatureCompletionStatus(companyId);

  const completed = features.filter(f => f.status === 'completed').length;
  const total = features.length || Object.keys(FeatureKey).length; // 8 features

  return {
    total,
    completed,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    features,
  };
}

/**
 * Reset feature completion for a company (e.g. for testing)
 * Use with caution!
 * 
 * @param companyId Company UUID
 */
export async function resetFeatureCompletion(companyId: string): Promise<void> {
  const { error } = await ownedDbTable('feature_completion')
    .delete()
    .eq('company_id', companyId);

  if (error) {
    throw new Error(`Failed to reset features: ${error.message}`);
  }
}

/**
 * Schedule periodic sync (useful for background jobs)
 * 
 * @param companyId Company UUID
 * @param intervalMs How often to sync (default: 1 hour)
 * @returns Cleanup function to stop syncing
 */
export function scheduleFeatureCompletionSync(
  companyId: string,
  intervalMs: number = 60 * 60 * 1000 // 1 hour
): () => void {
  const intervalId = setInterval(async () => {
    try {
      await syncFeatureCompletion(companyId);
      console.log(`[scheduleFeatureCompletionSync] Synced ${companyId}`);
    } catch (err) {
      console.error('Feature completion sync error:', err);
    }
  }, intervalMs);

  // Return cleanup function
  return () => clearInterval(intervalId);
}
