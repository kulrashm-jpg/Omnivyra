/**
 * W6-6 — deterministic data lifecycle framework (audit B-50 class).
 *
 * A policy REGISTRY + one sweep executor, so retention rules are declared,
 * metered, and killable in one place instead of scattered ad-hoc cleanups.
 * Batch E ships ONE approved policy:
 *
 *   resume-result-retention — prunes `metadata.ai_result` payloads from
 *   billing_operations rows older than RESULT_RETENTION_DAYS (default 30).
 *   STRICTLY metadata-only: the update rewrites the jsonb WITHOUT the
 *   ai_result key and touches NOTHING else — never status, amounts, ledger
 *   rows, or any active business data. The RESUME window for a generation
 *   is minutes-to-days; 30-day-old stored results are pure jsonb bloat
 *   (exactly the unbounded-metadata growth the audit flagged).
 *
 * Rollout: 'data-lifecycle' flag (off = sweep never registered/never runs);
 * per-policy enable via LIFECYCLE_<POLICY>_ENABLED; batch-limited; every
 * sweep records lifecycle.* metrics. Archival hooks: a policy may declare
 * `archive` to receive rows before pruning (none wired in Batch E).
 */
import { supabase } from '../db/supabaseClient';
import { recordRawCounter, recordRawHistogram } from '../observability';
import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';

export const DATA_LIFECYCLE_FLAG = defineRolloutFlag({
  key: 'data-lifecycle',
  description: 'W6-6: registry-driven retention sweeps (audit B-50)',
});

export interface LifecyclePolicy {
  name: string;
  description: string;
  /** Rows handled per sweep (bounded work). */
  batchLimit: number;
  enabled(): boolean;
  /** Optional archival hook — receives rows before pruning. */
  archive?(rows: unknown[]): Promise<void>;
  run(): Promise<{ pruned: number }>;
}

const RESULT_RETENTION_DAYS = Math.max(7, Number(process.env.RESULT_RETENTION_DAYS) || 30);

const resumeResultRetention: LifecyclePolicy = {
  name: 'resume-result-retention',
  description: `prune stored ai_result payloads older than ${RESULT_RETENTION_DAYS}d from billing_operations.metadata`,
  batchLimit: 200,
  enabled: () => !/^(0|false|off|no)$/i.test(String(process.env.LIFECYCLE_RESUME_RESULT_ENABLED ?? '1')),
  async run(): Promise<{ pruned: number }> {
    const cutoff = new Date(Date.now() - RESULT_RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('billing_operations')
      .select('id, metadata')
      .not('metadata->ai_result', 'is', null)
      .lt('metadata->ai_result->>saved_at', cutoff)
      .limit(this.batchLimit);
    if (error || !Array.isArray(data)) return { pruned: 0 };

    let pruned = 0;
    for (const row of data) {
      try {
        const metadata = { ...((row as { metadata?: Record<string, unknown> }).metadata ?? {}) };
        if (!('ai_result' in metadata)) continue;
        delete metadata.ai_result; // metadata-only: every other key preserved
        const { error: updateError } = await supabase
          .from('billing_operations')
          .update({ metadata })
          .eq('id', (row as { id: string }).id);
        if (!updateError) pruned++;
      } catch { /* row-level failure never aborts the sweep */ }
    }
    return { pruned };
  },
};

export const LIFECYCLE_POLICIES: LifecyclePolicy[] = [resumeResultRetention];

/** Execute every enabled policy once. Fail-open per policy; fully metered. */
export async function runLifecycleSweep(): Promise<Record<string, number>> {
  const out: Record<string, number> = { policies: 0, pruned: 0 };
  if (resolveRolloutSync(DATA_LIFECYCLE_FLAG).mode === 'off') return out;
  for (const policy of LIFECYCLE_POLICIES) {
    if (!policy.enabled()) continue;
    const startedAt = Date.now();
    try {
      const { pruned } = await policy.run();
      out.policies++;
      out.pruned += pruned;
      recordRawCounter('lifecycle.pruned', pruned, { policy: policy.name });
      recordRawHistogram('lifecycle.sweep_ms', Date.now() - startedAt, { policy: policy.name });
    } catch (err) {
      recordRawCounter('lifecycle.sweep_error', 1, { policy: policy.name });
      console.warn('[data-lifecycle] policy failed (non-fatal):', policy.name, (err as Error)?.message);
    }
  }
  return out;
}
