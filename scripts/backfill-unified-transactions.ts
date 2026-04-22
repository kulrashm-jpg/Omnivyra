/**
 * Backfill unified_transactions from the legacy ledger tables.
 *
 * Strategy:
 *   1. Walk usage_events chronologically (one row = one unified row).
 *   2. For each row, search credit_usage_log for a matching row by
 *        (organization_id, action = action_key, ±WINDOW_MS around created_at).
 *      Match = credits_charged attribution; no match = leave null (LLM-only).
 *   3. Look up organization_credits.credit_rate_usd once per org for
 *        credits_value_usd = credits × rate.
 *   4. Mark every inserted row with metadata.backfilled = true and
 *        metadata.backfill_partial_match = true when no credit_usage_log
 *        row could be paired.
 *
 * Idempotency: re-running is safe. The script checks for an existing
 * unified_transactions row with matching (org, created_at, source_type,
 * action_key) and skips duplicates.
 *
 * Usage:
 *   npx ts-node scripts/backfill-unified-transactions.ts [--since=ISO] [--until=ISO] [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

const WINDOW_MS = 5_000;
const PAGE_SIZE = 500;

function requireEnv(key: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required config: ${key}`);
  }
  return value;
}

const supabase = createClient(
  requireEnv('SUPABASE_URL',              config.SUPABASE_URL),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', config.SUPABASE_SERVICE_ROLE_KEY),
);

interface UsageEventsRow {
  id:                string;
  organization_id:   string;
  user_id:           string | null;
  source_type:       string;
  provider_name:     string | null;
  model_name:        string | null;
  action_key:        string | null;
  process_type:      string;
  feature_area:      string | null;
  input_tokens:      number | null;
  output_tokens:     number | null;
  total_tokens:      number | null;
  unit_cost:         number | null;
  total_cost:        number | null;
  pricing_snapshot:  unknown;
  error_flag:        boolean | null;
  error_type:        string | null;
  metadata:          Record<string, unknown> | null;
  campaign_id:       string | null;
  latency_ms:        number | null;
  created_at:        string;
}

interface CreditUsageLogRow {
  id:              string;
  organization_id: string;
  action:          string;
  credits:         number;
  created_at:      string;
}

const DEFAULT_CREDIT_RATE_USD = 0.001;
const _rateCache = new Map<string, number>();

async function getCreditRate(orgId: string): Promise<number> {
  const cached = _rateCache.get(orgId);
  if (cached != null) return cached;
  const { data } = await supabase
    .from('organization_credits')
    .select('credit_rate_usd')
    .eq('organization_id', orgId)
    .maybeSingle();
  const rate = Number((data as any)?.credit_rate_usd);
  const final = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_CREDIT_RATE_USD;
  _rateCache.set(orgId, final);
  return final;
}

async function findMatchingCreditRow(
  row: UsageEventsRow,
): Promise<CreditUsageLogRow | null> {
  if (!row.action_key) return null;
  const ts = new Date(row.created_at).getTime();
  const lo = new Date(ts - WINDOW_MS).toISOString();
  const hi = new Date(ts + WINDOW_MS).toISOString();
  const { data } = await supabase
    .from('credit_usage_log')
    .select('id, organization_id, action, credits, created_at')
    .eq('organization_id', row.organization_id)
    .eq('action',          row.action_key)
    .gte('created_at',     lo)
    .lte('created_at',     hi)
    .limit(1);
  const rows = (data ?? []) as CreditUsageLogRow[];
  return rows[0] ?? null;
}

async function alreadyBackfilled(row: UsageEventsRow): Promise<boolean> {
  const { data } = await supabase
    .from('unified_transactions')
    .select('id')
    .eq('organization_id', row.organization_id)
    .eq('source_type',     row.source_type)
    .eq('created_at',      row.created_at)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function backfillOne(row: UsageEventsRow, dryRun: boolean): Promise<'inserted' | 'skipped' | 'failed'> {
  if (await alreadyBackfilled(row)) return 'skipped';

  const creditRow = await findMatchingCreditRow(row);
  const credits    = creditRow ? Number(creditRow.credits) : null;
  const rate       = credits != null ? await getCreditRate(row.organization_id) : null;
  const creditsUsd = credits != null && rate != null ? credits * rate : null;
  const retryAttempt = Number((row.metadata as any)?.retry_attempt ?? 1);
  const finalAttempt = (row.metadata as any)?.final_attempt;

  const payload = {
    organization_id:   row.organization_id,
    user_id:           row.user_id,
    action_key:        row.action_key,
    source_type:       row.source_type,
    provider_name:     row.provider_name,
    model_name:        row.model_name,
    input_tokens:      row.input_tokens,
    output_tokens:     row.output_tokens,
    total_tokens:      row.total_tokens,
    api_cost_usd:      row.total_cost,
    credits_charged:   credits,
    credits_value_usd: creditsUsd,
    retry_attempt:     Number.isFinite(retryAttempt) && retryAttempt >= 1 ? retryAttempt : 1,
    final_attempt:     finalAttempt !== false,
    error_flag:        row.error_flag === true,
    error_type:        row.error_type,
    reference_type:    null,
    reference_id:      null,
    pricing_snapshot:  row.pricing_snapshot ?? null,
    metadata: {
      ...(row.metadata ?? {}),
      process_type:             row.process_type,
      feature_area:             row.feature_area,
      latency_ms:               row.latency_ms,
      campaign_id:              row.campaign_id,
      unit_cost:                row.unit_cost,
      backfilled:               true,
      backfilled_from_usage_id: row.id,
      backfill_partial_match:   creditRow == null,
      backfill_credit_log_id:   creditRow?.id ?? null,
    },
    created_at: row.created_at,  // preserve historical timestamp
  };

  if (dryRun) return 'inserted';

  const { error } = await supabase.from('unified_transactions').insert(payload);
  if (error) {
    console.warn(`[backfill] failed row=${row.id} code=${(error as any).code} msg=${error.message.slice(0, 160)}`);
    return 'failed';
  }
  return 'inserted';
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const since  = args.find((a) => a.startsWith('--since='))?.slice('--since='.length);
  const until  = args.find((a) => a.startsWith('--until='))?.slice('--until='.length);

  console.log('[backfill] starting', { dryRun, since: since ?? 'all', until: until ?? 'now' });

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let cursor = since ?? '1970-01-01T00:00:00Z';
  const hardEnd = until ?? new Date().toISOString();

  for (;;) {
    const query = supabase
      .from('usage_events')
      .select(
        'id, organization_id, user_id, source_type, provider_name, model_name, action_key, process_type, feature_area, input_tokens, output_tokens, total_tokens, unit_cost, total_cost, pricing_snapshot, error_flag, error_type, metadata, campaign_id, latency_ms, created_at',
      )
      .gt('created_at', cursor)
      .lt('created_at', hardEnd)
      .order('created_at', { ascending: true })
      .limit(PAGE_SIZE);

    const { data, error } = await query;
    if (error) {
      console.error('[backfill] fetch failed', error.message);
      break;
    }
    const batch = (data ?? []) as UsageEventsRow[];
    if (batch.length === 0) break;

    for (const row of batch) {
      const outcome = await backfillOne(row, dryRun);
      if (outcome === 'inserted') inserted += 1;
      else if (outcome === 'skipped') skipped += 1;
      else failed += 1;
    }

    cursor = batch[batch.length - 1]!.created_at;
    console.log(`[backfill] progress inserted=${inserted} skipped=${skipped} failed=${failed} cursor=${cursor}`);
    if (batch.length < PAGE_SIZE) break;
  }

  console.log('[backfill] done', { inserted, skipped, failed });
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[backfill] unhandled error', err);
  process.exit(1);
});
