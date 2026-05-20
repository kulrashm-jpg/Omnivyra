/**
 * Image reconciliation orchestrator (DALL·E / generic image-gen providers).
 * Mirrors OpenAI/Anthropic/Gemini/audio orchestrators and reuses the generic
 * `reconcileProviderInvoice` matcher core.
 *
 * Per-provider usage_events filtering:
 *   - providerTag='openai_image' → usage_events.provider_name='openai'
 *                                  AND model_name IN (gpt-image-*, dall-e-*).
 *   - providerTag='image:<name>' (caller supplies usageEventsProviderName)
 *                                → usage_events.provider_name=<name>.
 *
 * The matcher key is (period_day, model), so image rows never collide with
 * the existing OpenAI completion reconciler — DALL·E and gpt-image-* have
 * their own bucket per model. Resolution/quality are preserved in metadata
 * but do NOT participate in the bucket key (consistency with other adapters).
 *
 * REPLAY SAFETY:
 *   - DB-level idempotency via UNIQUE(provider=<providerTag>, provider_invoice_id).
 *   - cost_reconciliation_runs upsert on UNIQUE(provider, period_start, period_end).
 *   - cost_reconciliation_adjustments are append-only (immutability trigger).
 *   - Duplicate invoice short-circuits before any adjustment is written.
 *
 * Runtime status: schema-correct against migrations 20260693/694 which are
 * CREATED BUT NOT APPLIED in this environment. Pure normalizer + matcher
 * fully unit-tested; live operation requires the controlled apply.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import {
  normalizeImageBillingExport,
  normalizeDalleUsageExport,
  normalizeImageUsageExport,
  IMAGE_ADAPTER_VERSION_BILLING,
  IMAGE_ADAPTER_VERSION_DALLE,
  IMAGE_ADAPTER_VERSION_USAGE,
  type ImageNormalizeResult,
} from './imageAdapter';
import type { RateTable } from './openaiAdapter';
import { reconcileProviderInvoice, type UsageAggregate, type MatchResult } from './reconciliationMatcher';

export type ImageProviderTag = 'openai_image' | `image:${string}`;
export type ImagePayloadKind = 'billing' | 'dalle_usage' | 'image_usage';

export interface IngestImageArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  /** Provider tag persisted into provider_invoice_imports / adjustments. */
  providerTag: ImageProviderTag;
  /** When providerTag !== 'openai_image', the usage_events.provider_name to filter on. */
  usageEventsProviderName?: string;
  kind: ImagePayloadKind;
  payload: unknown;
  rates: RateTable;
}

export type IngestOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: MatchResult['totals']; warnings: string[] };

async function readUsageAggregates(
  providerTag: ImageProviderTag,
  usageEventsProviderName: string | undefined,
  periodStart: string,
  periodEnd: string,
): Promise<UsageAggregate[]> {
  let query = supabase
    .from('usage_events')
    .select('organization_id, model_name, total_cost_usd, created_at, ledger_hold_transaction_id')
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (providerTag === 'openai_image') {
    query = query.eq('provider_name', 'openai').or('model_name.like.dall-e%,model_name.like.gpt-image%');
  } else if (usageEventsProviderName) {
    query = query.eq('provider_name', usageEventsProviderName);
  } else {
    // No usage filter we can trust — return empty so reconciliation surfaces
    // platform-level `missing_attribution` rows rather than mis-attributing.
    logger.warn('image_reconcile_missing_provider_filter', { providerTag });
    return [];
  }

  const { data, error } = await query;
  if (error) {
    logger.warn('image_reconcile_usage_read_failed', { message: error.message, providerTag });
    return [];
  }
  const map: Map<string, UsageAggregate> = new Map();
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const org   = String(r.organization_id ?? '');
    const model = String(r.model_name ?? '').trim();
    const ts    = String(r.created_at ?? '');
    if (!org || !model || !ts) continue;
    const day = ts.slice(0, 10);
    const key = `${org}|${day}|${model}`;
    const usd = Math.max(0, Number(r.total_cost_usd ?? 0) || 0);
    const ledgerAnchor = (r.ledger_hold_transaction_id as string | null) ?? null;
    const slot = map.get(key);
    if (!slot) {
      map.set(key, { organization_id: org, period_day: day, model, estimated_usd: usd, ledger_hold_transaction_id: ledgerAnchor });
    } else {
      slot.estimated_usd += usd;
      slot.ledger_hold_transaction_id = slot.ledger_hold_transaction_id ?? ledgerAnchor;
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const c = a.organization_id.localeCompare(b.organization_id); if (c) return c;
    const d = a.period_day.localeCompare(b.period_day);            if (d) return d;
    return a.model.localeCompare(b.model);
  });
}

function adapterVersionFor(kind: ImagePayloadKind): string {
  if (kind === 'dalle_usage') return IMAGE_ADAPTER_VERSION_DALLE;
  if (kind === 'image_usage') return IMAGE_ADAPTER_VERSION_USAGE;
  return IMAGE_ADAPTER_VERSION_BILLING;
}

export async function ingestImageInvoice(args: IngestImageArgs): Promise<IngestOutcome> {
  let norm: ImageNormalizeResult;
  if (args.kind === 'dalle_usage') {
    norm = normalizeDalleUsageExport({ payload: args.payload, rates: args.rates });
  } else if (args.kind === 'image_usage') {
    norm = normalizeImageUsageExport({ payload: args.payload, rates: args.rates });
  } else {
    norm = normalizeImageBillingExport({ payload: args.payload, rates: args.rates });
  }
  const total_actual_usd = norm.lines.reduce((s, l) => s + (Number.isFinite(l.total_usd) ? l.total_usd : 0), 0);

  // 1) Idempotent invoice import.
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: args.providerTag,
    provider_invoice_id: args.providerInvoiceId,
    period_start: args.periodStart,
    period_end:   args.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: norm.lines,
    raw_payload: args.payload ?? {},
    adapter_version: adapterVersionFor(args.kind),
  } as Record<string, unknown>);
  if (insertErr) {
    if (String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
      return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
    }
    logger.warn('image_invoice_import_failed', { message: insertErr.message, providerTag: args.providerTag });
    throw new Error(`image invoice import failed: ${insertErr.message}`);
  }

  // 2) Reconcile against our usage_events for the same window.
  const aggregates = await readUsageAggregates(args.providerTag, args.usageEventsProviderName, args.periodStart, args.periodEnd);
  const match = reconcileProviderInvoice({ provider: args.providerTag, invoiceLines: norm.lines, usageAggregates: aggregates });

  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: args.providerTag,
        period_start: args.periodStart,
        period_end:   args.periodEnd,
        estimated_usd_sum: match.totals.estimated_usd_sum,
        actual_usd_sum:    match.totals.actual_usd_sum,
        status: 'completed',
        started_at:  new Date().toISOString(),
        finished_at: new Date().toISOString(),
        metadata: { adapter_version: norm.adapter_version, warnings: norm.warnings, buckets: match.buckets },
      } as Record<string, unknown>,
      { onConflict: 'provider,period_start,period_end' },
    )
    .select('id')
    .single();
  if (runErr || !runRow) {
    logger.warn('image_reconcile_run_upsert_failed', { message: runErr?.message, providerTag: args.providerTag });
    throw new Error(`image reconcile run upsert failed: ${runErr?.message ?? 'no row'}`);
  }
  const run_id = String((runRow as { id: string }).id);

  // 3) Append-only adjustments.
  const rows = match.adjustments.map((a) => ({
    run_id,
    organization_id: a.organization_id,
    provider: a.provider,
    action_key: a.action_key,
    ledger_hold_transaction_id: a.ledger_hold_transaction_id,
    estimated_usd: a.estimated_usd,
    actual_usd:    a.actual_usd,
    reason: a.reason,
    metadata: { ...a.metadata, severity: a.severity },
  }));
  let adjustments_written = 0;
  if (rows.length > 0) {
    const { error: adjErr } = await supabase.from('cost_reconciliation_adjustments').insert(rows);
    if (adjErr) {
      logger.warn('image_reconcile_adjustments_insert_failed', { message: adjErr.message, providerTag: args.providerTag });
      throw new Error(`image reconcile adjustments insert failed: ${adjErr.message}`);
    }
    adjustments_written = rows.length;
  }

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: norm.warnings };
}
