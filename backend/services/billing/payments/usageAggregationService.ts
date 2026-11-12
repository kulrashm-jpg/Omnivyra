/**
 * Usage Aggregation Service — Phase E
 *
 * Materializes a `usage_billing_snapshots` row from `credit_transactions`
 * over a period. The snapshot is the canonical input to invoicing; once
 * written it is immutable (DB trigger on usage_billing_snapshots).
 *
 * Snapshots are addressable by (organization_id, period_start, period_end)
 * — UNIQUE on the DB side. Re-running the aggregator for the same period
 * is a no-op (ON CONFLICT DO NOTHING).
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { CONSUMPTION_PHASES } from '../ledgerPhases';
import { loadCurrentCreditRateUsd, needsDerivedUsd, rowUsd } from '../ledgerUsd';

export interface UsageSnapshotArgs {
  organizationId: string;
  periodStart:    string;
  periodEnd:      string;
}

export interface UsageSnapshotResult {
  ok:              boolean;
  snapshotId?:     string;
  totalCredits:    number;
  totalUsd:        number;
  llmInputTokens:  number;
  llmOutputTokens: number;
  byAction:        Record<string, { credits: number; usd: number; count: number; usdEstimated?: boolean }>;
  /** true when part of totalUsd was derived at read time (e9 ruling b); per action in byAction. */
  usdEstimated?:   boolean;
  alreadyExists?:  boolean;
  error?:          string;
}

export async function takeUsageSnapshot(args: UsageSnapshotArgs): Promise<UsageSnapshotResult> {
  // 1. Idempotent: detect existing snapshot for this period.
  // MONEY: a snapshot is the frozen billing basis for its period. Every read
  // that feeds it is checked; a failure returns ok:false and writes nothing.
  const { data: existing, error: existingErr } = await supabase
    .from('usage_billing_snapshots')
    .select('id, total_credits, total_usd_equivalent, llm_input_tokens, llm_output_tokens, by_action')
    .eq('organization_id', args.organizationId)
    .eq('period_start', args.periodStart)
    .eq('period_end', args.periodEnd)
    .maybeSingle();
  if (existingErr) {
    logger.error('usage_snapshot_existing_read_failed', { org: args.organizationId, message: existingErr.message });
    return { ok: false, totalCredits: 0, totalUsd: 0, llmInputTokens: 0, llmOutputTokens: 0, byAction: {}, error: existingErr.message };
  }

  if (existing) {
    const e = existing as Record<string, unknown>;
    return {
      ok:              true,
      snapshotId:      String(e.id),
      totalCredits:    Number(e.total_credits ?? 0),
      totalUsd:        Number(e.total_usd_equivalent ?? 0),
      llmInputTokens:  Number(e.llm_input_tokens ?? 0),
      llmOutputTokens: Number(e.llm_output_tokens ?? 0),
      byAction:        (e.by_action ?? {}) as Record<string, { credits: number; usd: number; count: number; usdEstimated?: boolean }>,
      usdEstimated:    Object.values((e.by_action ?? {}) as Record<string, { usdEstimated?: boolean }>).some((a) => a?.usdEstimated === true),
      alreadyExists:   true,
    };
  }

  // 2. Aggregate CONSUMPTION rows (confirm + confirm_partial) in the period.
  const { data: confirmRows, error: confirmErr } = await supabase
    .from('credit_transactions')
    .select('credits_delta, usd_equivalent, reference_type')
    .eq('organization_id', args.organizationId)
    .in('execution_phase', [...CONSUMPTION_PHASES])
    .gte('created_at', args.periodStart)
    .lte('created_at', args.periodEnd);

  if (confirmErr) {
    return { ok: false, totalCredits: 0, totalUsd: 0, llmInputTokens: 0, llmOutputTokens: 0, byAction: {}, error: confirmErr.message };
  }
  const txns = (confirmRows ?? []) as Array<{ credits_delta: number; usd_equivalent: number | null; reference_type: string | null }>;

  // A charge with no recorded USD is priced at read time and marked estimated
  // (the flag is stored per action in by_action, so it survives the snapshot).
  let rate = 0;
  if (needsDerivedUsd(txns)) {
    try { rate = await loadCurrentCreditRateUsd(args.organizationId); } catch (e) {
      return { ok: false, totalCredits: 0, totalUsd: 0, llmInputTokens: 0, llmOutputTokens: 0, byAction: {}, error: (e as Error).message };
    }
  }
  let totalCredits = 0;
  let totalUsd = 0;
  let usdEstimated = false;
  const byAction: Record<string, { credits: number; usd: number; count: number; usdEstimated?: boolean }> = {};
  for (const r of txns) {
    const credits = Math.abs(Number(r.credits_delta ?? 0));
    const u       = rowUsd(r, rate);
    const key     = r.reference_type ?? 'unknown';
    totalCredits += credits;
    totalUsd     += u.usd;
    byAction[key] = byAction[key] ?? { credits: 0, usd: 0, count: 0 };
    byAction[key].credits += credits;
    byAction[key].usd     += u.usd;
    byAction[key].count   += 1;
    if (u.estimated) { byAction[key].usdEstimated = true; usdEstimated = true; }
  }

  // 3. Pull LLM token rollup if usage_meter_monthly exists for this period.
  let llmInputTokens = 0;
  let llmOutputTokens = 0;
  try {
    const yearStart = Number(args.periodStart.slice(0, 4));
    const monthStart = Number(args.periodStart.slice(5, 7));
    const { data: meter, error: meterErr } = await supabase
      .from('usage_meter_monthly')
      .select('llm_input_tokens, llm_output_tokens')
      .eq('organization_id', args.organizationId)
      .eq('year', yearStart)
      .eq('month', monthStart)
      .maybeSingle();
    // The meter table is optional (42P01 = not deployed here -> 0 tokens, as
    // documented). Any OTHER failure must not freeze 0 tokens into the snapshot.
    if (meterErr && (meterErr as { code?: string }).code !== '42P01') {
      logger.error('usage_snapshot_token_rollup_failed', { org: args.organizationId, message: meterErr.message });
      return { ok: false, totalCredits: 0, totalUsd: 0, llmInputTokens: 0, llmOutputTokens: 0, byAction: {}, error: meterErr.message };
    }
    if (meter) {
      llmInputTokens  = Number((meter as { llm_input_tokens?: number }).llm_input_tokens ?? 0);
      llmOutputTokens = Number((meter as { llm_output_tokens?: number }).llm_output_tokens ?? 0);
    }
  } catch (err) {
    logger.warn('usage_snapshot_token_rollup_unavailable', { org: args.organizationId, message: err instanceof Error ? err.message : String(err) });
  }

  // 4. Insert snapshot (ON CONFLICT DO NOTHING — concurrent writers collapse).
  const { data: inserted, error: insErr } = await supabase
    .from('usage_billing_snapshots')
    .insert({
      organization_id:       args.organizationId,
      period_start:          args.periodStart,
      period_end:            args.periodEnd,
      total_credits:         totalCredits,
      total_usd_equivalent:  totalUsd,
      llm_input_tokens:      llmInputTokens,
      llm_output_tokens:     llmOutputTokens,
      by_action:             byAction,
    })
    .select('id')
    .maybeSingle();

  if (insErr) {
    // Unique violation: another writer beat us — re-fetch
    if (/duplicate key/i.test(insErr.message) || (insErr as { code?: string }).code === '23505') {
      const { data: again, error: againErr } = await supabase
        .from('usage_billing_snapshots')
        .select('id')
        .eq('organization_id', args.organizationId)
        .eq('period_start', args.periodStart)
        .eq('period_end', args.periodEnd)
        .maybeSingle();
      if (againErr || !(again as { id?: string } | null)?.id) {
        // The winner's snapshot exists but could not be read back: never report
        // it with THIS writer's totals and no id.
        logger.error('usage_snapshot_refetch_failed', { org: args.organizationId, message: againErr?.message ?? 'no row' });
        return { ok: false, totalCredits: 0, totalUsd: 0, llmInputTokens: 0, llmOutputTokens: 0, byAction: {}, error: againErr?.message ?? 'snapshot_refetch_failed' };
      }
      return {
        ok: true, snapshotId: (again as { id?: string } | null)?.id, totalCredits, totalUsd,
        llmInputTokens, llmOutputTokens, byAction, alreadyExists: true,
      };
    }
    logger.error('usage_snapshot_insert_failed', { org: args.organizationId, message: insErr.message });
    return { ok: false, totalCredits, totalUsd, llmInputTokens, llmOutputTokens, byAction, error: insErr.message };
  }

  return {
    ok: true, snapshotId: (inserted as { id?: string } | null)?.id,
    totalCredits, totalUsd, llmInputTokens, llmOutputTokens, byAction, usdEstimated,
  };
}
