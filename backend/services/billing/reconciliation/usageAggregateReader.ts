/**
 * Estimated-spend aggregates for provider reconciliation: CUSTOMER spend
 * (usage_events) AND PLATFORM spend (platform_usage_events), per
 * (organization, day, model).
 *
 * WHY BOTH TABLES. A provider invoice covers every call made with OUR provider
 * account: customer calls and platform calls (embeddings, topic indexing, ...)
 * alike. Platform spend is recorded in platform_usage_events (B7.8-C,
 * 20260930120000), never in usage_events. Before this module each reconciler
 * read usage_events ONLY, so the platform share of the invoice was missing from
 * the estimate and the matcher spread it PRO-RATA onto the customers of the
 * same (day, model) bucket as variance; an invoice bucket with only platform
 * spend was reported as `missing_attribution`. Now platform spend is its own
 * aggregate (organization_id = null): it takes its own share of the bucket and
 * its adjustment carries organization_id null, never a company.
 *
 * The all-zero sentinel org (PLATFORM_SENTINEL_ORG, written to usage_events by
 * the gateway when no company is known) is platform spend too, not a company:
 * it is folded into the platform aggregate instead of appearing as a phantom
 * customer.
 *
 * FAIL CLOSED. A failed read THROWS. Returning [] (the previous behaviour)
 * silently turned the whole invoice into variance against whichever side was
 * still readable. Callers read BEFORE importing the invoice, so a failed read
 * writes nothing and the run can simply be retried.
 *
 * Column mapping is explicit: usage_events.total_cost_usd vs
 * platform_usage_events.total_cost (the platform table has no *_usd column).
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import { PLATFORM_SENTINEL_ORG } from '../platformSentinel';
import { compareOrganizationId, type UsageAggregate } from './reconciliationMatcher';

/**
 * Applies the reconciler's provider/model filter. It is applied IDENTICALLY to
 * both tables (both carry provider_name and model_name), so customer and
 * platform spend are selected by the same rule.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UsageFilter = (query: any) => any;

interface SourceSpec {
  table: 'usage_events' | 'platform_usage_events';
  select: string;
  usdColumn: 'total_cost_usd' | 'total_cost';
}

const CUSTOMER: SourceSpec = {
  table: 'usage_events',
  select: 'organization_id, model_name, total_cost_usd, created_at, ledger_hold_transaction_id',
  usdColumn: 'total_cost_usd',
};
const PLATFORM: SourceSpec = {
  table: 'platform_usage_events',
  select: 'model_name, total_cost, created_at',
  usdColumn: 'total_cost',
};

async function readRows(
  tag: string,
  spec: SourceSpec,
  filter: UsageFilter,
  periodStart: string,
  periodEnd: string,
): Promise<Array<Record<string, unknown>>> {
  const query = filter(supabase.from(spec.table).select(spec.select).gte('created_at', periodStart).lt('created_at', periodEnd));
  const { data, error } = await query;
  if (error) {
    logger.error('reconcile_usage_read_failed', { provider: tag, table: spec.table, message: error.message });
    throw new Error(`${tag} reconcile: ${spec.table} read failed: ${error.message}`);
  }
  return (data || []) as Array<Record<string, unknown>>;
}

export async function readEstimatedUsageAggregates(
  tag: string,
  filter: UsageFilter,
  periodStart: string,
  periodEnd: string,
): Promise<UsageAggregate[]> {
  const [customerRows, platformRows] = await Promise.all([
    readRows(tag, CUSTOMER, filter, periodStart, periodEnd),
    readRows(tag, PLATFORM, filter, periodStart, periodEnd),
  ]);

  const map: Map<string, UsageAggregate> = new Map();
  const add = (org: string | null, r: Record<string, unknown>, usdColumn: SourceSpec['usdColumn']) => {
    const model = String(r.model_name ?? '').trim();
    const ts    = String(r.created_at ?? '');
    if (!model || !ts) return;
    const day = ts.slice(0, 10); // YYYY-MM-DD
    // A uuid is never '', so '' can stand for platform in the group key.
    const key = `${org ?? ''}|${day}|${model}`;
    const usd = Math.max(0, Number(r[usdColumn] ?? 0) || 0);
    const ledgerAnchor = org === null ? null : ((r.ledger_hold_transaction_id as string | null) ?? null);
    const slot = map.get(key);
    if (!slot) {
      map.set(key, { organization_id: org, period_day: day, model, estimated_usd: usd, ledger_hold_transaction_id: ledgerAnchor });
    } else {
      slot.estimated_usd += usd;
      // Prefer the first-seen anchor for determinism (matcher will re-sort).
      slot.ledger_hold_transaction_id = slot.ledger_hold_transaction_id ?? ledgerAnchor;
    }
  };

  for (const r of customerRows) {
    const raw = String(r.organization_id ?? '');
    if (!raw) continue; // usage_events.organization_id is NOT NULL; defensive only
    add(raw === PLATFORM_SENTINEL_ORG ? null : raw, r, CUSTOMER.usdColumn);
  }
  for (const r of platformRows) add(null, r, PLATFORM.usdColumn);

  return Array.from(map.values()).sort((a, b) => {
    const c = compareOrganizationId(a.organization_id, b.organization_id); if (c) return c;
    const d = a.period_day.localeCompare(b.period_day);                     if (d) return d;
    return a.model.localeCompare(b.model);
  });
}
