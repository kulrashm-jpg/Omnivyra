/**
 * Gemini reconciliation orchestrator — mirrors OpenAI/Anthropic.
 * Uses the generic `reconcileProviderInvoice` and the Phase-7 schema; pure
 * normalizer lives in `geminiAdapter`. Schema-correct against migrations
 * 20260693/694 (created, NOT applied); pure modules are unit-test-verified.
 *
 * Replay safety: DB-level UNIQUE(provider='gemini', provider_invoice_id);
 * runs upsert on UNIQUE(provider, period_start, period_end); adjustments
 * append-only via the existing raise_ledger_immutable trigger.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import {
  normalizeGoogleCloudBillingExport,
  normalizeGeminiUsageMetadata,
  GEMINI_ADAPTER_VERSION_BILLING,
  GEMINI_ADAPTER_VERSION_USAGE,
  type GeminiNormalizeResult,
} from './geminiAdapter';
import type { RateTable } from './openaiAdapter';
import { reconcileProviderInvoice, type UsageAggregate, type MatchResult } from './reconciliationMatcher';

export type GeminiPayloadKind = 'gcb_export' | 'usage_metadata';

export interface IngestGeminiArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  kind: GeminiPayloadKind;
  payload: unknown;
  /** Required only for kind='usage_metadata' (Gemini API returns no $). */
  rates?: RateTable;
  /** Optional GCB project_id → customer org_id mapping (no DB I/O here). */
  projectOrgMap?: Record<string, string>;
}

export type IngestOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: MatchResult['totals']; warnings: string[] };

async function readUsageAggregates(periodStart: string, periodEnd: string): Promise<UsageAggregate[]> {
  const { data, error } = await supabase
    .from('usage_events')
    .select('organization_id, model_name, total_cost_usd, created_at, ledger_hold_transaction_id')
    .eq('provider_name', 'gemini')
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);
  if (error) {
    logger.warn('gemini_reconcile_usage_read_failed', { message: error.message });
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

export async function ingestGeminiInvoice(args: IngestGeminiArgs): Promise<IngestOutcome> {
  let norm: GeminiNormalizeResult;
  if (args.kind === 'gcb_export') {
    norm = normalizeGoogleCloudBillingExport({ payload: args.payload, projectOrgMap: args.projectOrgMap });
  } else {
    if (!args.rates) throw new Error('rates required for gemini usage_metadata ingestion');
    norm = normalizeGeminiUsageMetadata({ payload: args.payload, rates: args.rates });
  }
  const total_actual_usd = norm.lines.reduce((s, l) => s + (Number.isFinite(l.total_usd) ? l.total_usd : 0), 0);

  // 1) Idempotent invoice import.
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: 'gemini',
    provider_invoice_id: args.providerInvoiceId,
    period_start: args.periodStart,
    period_end:   args.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: norm.lines,
    raw_payload: args.payload ?? {},
    adapter_version: args.kind === 'gcb_export' ? GEMINI_ADAPTER_VERSION_BILLING : GEMINI_ADAPTER_VERSION_USAGE,
  } as Record<string, unknown>);
  if (insertErr) {
    if (String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
      return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
    }
    logger.warn('gemini_invoice_import_failed', { message: insertErr.message });
    throw new Error(`gemini invoice import failed: ${insertErr.message}`);
  }

  // 2) Reconcile against our usage_events.
  const aggregates = await readUsageAggregates(args.periodStart, args.periodEnd);
  const match = reconcileProviderInvoice({ provider: 'gemini', invoiceLines: norm.lines, usageAggregates: aggregates });

  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: 'gemini',
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
    logger.warn('gemini_reconcile_run_upsert_failed', { message: runErr?.message });
    throw new Error(`gemini reconcile run upsert failed: ${runErr?.message ?? 'no row'}`);
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
      logger.warn('gemini_reconcile_adjustments_insert_failed', { message: adjErr.message });
      throw new Error(`gemini reconcile adjustments insert failed: ${adjErr.message}`);
    }
    adjustments_written = rows.length;
  }

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: norm.warnings };
}
