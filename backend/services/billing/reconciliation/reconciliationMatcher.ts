/**
 * Pure, deterministic reconciliation matcher.
 *
 * Given normalized provider invoice lines + estimated-cost aggregates
 * read from our `usage_events` (per (organization_id, period_day, model)),
 * produces a deterministic set of `cost_reconciliation_adjustments` rows.
 *
 * MATCHING MODEL (faithful, non-speculative):
 *  - OpenAI's invoice attributes spend to OUR OpenAI account, NOT to OUR
 *    customer org. So we aggregate the invoice up to `(period_day, model)`
 *    and reconcile against the SUM of customer-attributed usage_events for
 *    the same bucket.
 *  - For each `(period_day, model)` bucket we compute variance via the
 *    existing pure `computeReconciliationVariance`.
 *  - If our customer-attributed estimated USD > 0 for that bucket we
 *    PRO-RATA the bucket's variance back to orgs by their share of the
 *    bucket's estimated USD — deterministic, replay-safe, no speculation.
 *  - Orgs with zero estimated for the bucket receive no per-org adjustment.
 *  - If the bucket has no customer-attributed usage at all (estimated == 0)
 *    we emit a platform-level (organization_id=null) adjustment marked
 *    `reason='missing_attribution'` so spend is never lost.
 *  - If a customer-attributed bucket exists with no matching invoice row,
 *    we emit a platform-level adjustment `reason='missing_provider_event'`
 *    with adjustment_usd = -estimated (signals over-estimate to investigate).
 */

import { computeReconciliationVariance, type ReconciliationSeverity } from '../reconciliationVariance';
import type { NormalizedInvoiceLine } from './openaiAdapter';

export interface UsageAggregate {
  organization_id: string;
  period_day: string;
  model: string;
  estimated_usd: number;
  /** Optional anchor used for adjustment lineage (HOLD id from Task 6). */
  ledger_hold_transaction_id?: string | null;
}

export interface AdjustmentRow {
  organization_id: string | null;
  /** Free-form provider tag (e.g. 'openai', 'anthropic'). */
  provider: string;
  action_key: string | null;
  ledger_hold_transaction_id: string | null;
  estimated_usd: number;
  actual_usd: number;
  /** Convenience; the DB column is GENERATED. */
  adjustment_usd: number;
  reason: 'variance' | 'missing_attribution' | 'missing_provider_event' | 'rounding';
  severity: ReconciliationSeverity;
  metadata: Record<string, unknown>;
}

export interface MatchResult {
  adjustments: AdjustmentRow[];
  /** Bucket-level summary for the run header / dashboard. */
  buckets: Array<{
    period_day: string;
    model: string;
    invoice_usd: number;
    estimated_usd: number;
    severity: ReconciliationSeverity;
  }>;
  /** Sum totals for the cost_reconciliation_runs header. */
  totals: { estimated_usd_sum: number; actual_usd_sum: number };
}

type BucketKey = string; // `${day}|${model}`
const bk = (day: string, model: string): BucketKey => `${day}|${model}`;

function roundCents(n: number): number {
  // Numeric stability for jsonb / numeric storage.
  return Math.round(n * 1e10) / 1e10;
}

/**
 * Pure matcher. Deterministic: same inputs (after stable sort) → same output.
 */
/**
 * Generic provider matcher core. Used by `reconcileOpenAi` (legacy alias)
 * and per-provider adapters. Pure, deterministic, replay-safe.
 */
export function reconcileProviderInvoice(args: {
  /** Provider tag carried into every adjustment row (e.g. 'openai' | 'anthropic'). */
  provider: string;
  invoiceLines: NormalizedInvoiceLine[];
  usageAggregates: UsageAggregate[];
}): MatchResult {
  // Aggregate invoice to (day, model).
  const invoice: Map<BucketKey, { invoice_usd: number; n_requests: number; provider_org_id: string | null }> = new Map();
  for (const l of args.invoiceLines) {
    const key = bk(l.period_day, l.model);
    const existing = invoice.get(key) ?? { invoice_usd: 0, n_requests: 0, provider_org_id: l.provider_org_id };
    invoice.set(key, {
      invoice_usd: existing.invoice_usd + (Number.isFinite(l.total_usd) ? l.total_usd : 0),
      n_requests:  existing.n_requests + (l.n_requests || 0),
      provider_org_id: existing.provider_org_id ?? l.provider_org_id,
    });
  }

  // Group customer-attributed usage by (day, model) and remember per-org shares.
  const usageByBucket: Map<BucketKey, { estimated_total: number; orgs: UsageAggregate[] }> = new Map();
  for (const u of args.usageAggregates) {
    const key = bk(u.period_day, u.model);
    const slot = usageByBucket.get(key) ?? { estimated_total: 0, orgs: [] };
    slot.estimated_total += Math.max(0, u.estimated_usd || 0);
    slot.orgs.push(u);
    usageByBucket.set(key, slot);
  }

  const adjustments: AdjustmentRow[] = [];
  const buckets: MatchResult['buckets'] = [];
  let estimatedSum = 0;
  let actualSum = 0;

  // Stable iteration: sort the union of keys.
  const allKeys = Array.from(new Set([...invoice.keys(), ...usageByBucket.keys()])).sort();

  for (const key of allKeys) {
    const [period_day, model] = key.split('|');
    const inv = invoice.get(key);
    const u = usageByBucket.get(key);

    const actual_usd = inv?.invoice_usd ?? 0;
    const estimated_usd = u?.estimated_total ?? 0;
    actualSum += actual_usd;
    estimatedSum += estimated_usd;

    const v = computeReconciliationVariance({ estimated_usd, actual_usd });
    buckets.push({ period_day, model, invoice_usd: actual_usd, estimated_usd, severity: v.severity });

    if (!u || estimated_usd === 0) {
      // Invoice has spend in this bucket but no customer-attributed usage —
      // platform-level adjustment so spend is captured (not lost).
      if (actual_usd > 0) {
        adjustments.push({
          organization_id: null,
          provider: args.provider,
          action_key: null,
          ledger_hold_transaction_id: null,
          estimated_usd: 0,
          actual_usd: roundCents(actual_usd),
          adjustment_usd: roundCents(actual_usd),
          reason: 'missing_attribution',
          severity: v.severity,
          metadata: { period_day, model, n_requests: inv?.n_requests ?? 0, provider_org_id: inv?.provider_org_id ?? null },
        });
      }
      continue;
    }

    if (!inv) {
      // Our usage existed but no invoice row matched — flag a single
      // platform-level row signaling over-estimate / missing provider event.
      adjustments.push({
        organization_id: null,
        provider: args.provider,
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: roundCents(estimated_usd),
        actual_usd: 0,
        adjustment_usd: roundCents(-estimated_usd),
        reason: 'missing_provider_event',
        severity: v.severity,
        metadata: { period_day, model, org_count: u.orgs.length },
      });
      continue;
    }

    // Matched bucket. Pro-rata variance back to orgs by estimated-share.
    const bucketAdjUsd = actual_usd - estimated_usd;
    // Deterministic order: by org id then by hold anchor.
    const sortedOrgs = [...u.orgs].sort((a, b) => {
      const c = a.organization_id.localeCompare(b.organization_id);
      if (c !== 0) return c;
      return String(a.ledger_hold_transaction_id ?? '').localeCompare(String(b.ledger_hold_transaction_id ?? ''));
    });
    for (const orgAgg of sortedOrgs) {
      const share = orgAgg.estimated_usd / estimated_usd; // guarded: estimated_usd > 0 in this branch
      const orgEstimated = orgAgg.estimated_usd;
      const orgActual    = orgEstimated + bucketAdjUsd * share; // pro-rata actual
      adjustments.push({
        organization_id: orgAgg.organization_id,
        provider: args.provider,
        action_key: null,
        ledger_hold_transaction_id: orgAgg.ledger_hold_transaction_id ?? null,
        estimated_usd: roundCents(orgEstimated),
        actual_usd:    roundCents(orgActual),
        adjustment_usd: roundCents(orgActual - orgEstimated),
        reason: v.severity === 'none' ? 'rounding' : 'variance',
        severity: v.severity,
        metadata: { period_day, model, share },
      });
    }
  }

  return {
    adjustments,
    buckets,
    totals: { estimated_usd_sum: roundCents(estimatedSum), actual_usd_sum: roundCents(actualSum) },
  };
}

/**
 * Back-compat alias for the OpenAI-only entry. Internally delegates to the
 * generic `reconcileProviderInvoice` with provider='openai'. Keeps existing
 * callers/tests unchanged.
 */
export function reconcileOpenAi(args: {
  provider: 'openai';
  invoiceLines: NormalizedInvoiceLine[];
  usageAggregates: UsageAggregate[];
}): MatchResult {
  return reconcileProviderInvoice(args);
}
