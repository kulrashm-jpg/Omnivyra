/**
 * Economic Observability — Phase 1: Shadow Economic Service (READ-ONLY).
 *
 * Re-derives ACTUAL provider economic cost from already-captured telemetry
 * (`usage_events` tokens + the existing `llm_model_pricing` table) and computes
 * SHADOW settlement diagnostics (reserved vs actual-cost vs shadow-settlement).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SAFETY (Phase brief Section I) — STRICTLY READ-ONLY. Only SELECTs. Never
 * writes usage_events / credit_transactions / organization_credits / pricing.
 * Never changes balances, reservations, confirmations, releases, settlement,
 * credits, subscriptions, pricing, or billing. Reuses the existing pricing
 * table (no duplicate pricing logic). Computes everything on-read; persists
 * nothing (no migration needed).
 * ───────────────────────────────────────────────────────────────────────────
 */

import { supabase } from '@/backend/db/supabaseClient';
import { resolveFeatureFromProcessType } from '@/shared/monetization/featureRegistry';
import { moduleForActionKey } from '@/backend/services/creditAdvisor/creditAdvisorTaxonomy';
import type {
  CostDerivation,
  CoverageStats,
  ShadowEconomicRecord,
  ShadowEconomicReport,
  ShadowGroupAggregate,
} from './economicObservabilityTypes';

const DAY_MS = 86_400_000;
const DEFAULT_CREDIT_RATE_USD = 0.01;

interface Price {
  in_per_1k: number;
  out_per_1k: number;
}

async function loadPricing(): Promise<Map<string, Price>> {
  const { data } = await supabase
    .from('llm_model_pricing')
    .select('model_name, input_per_1k_usd, output_per_1k_usd, is_active')
    .eq('is_active', true);
  const map = new Map<string, Price>();
  for (const r of (data ?? []) as any[]) {
    map.set(r.model_name, {
      in_per_1k: Number(r.input_per_1k_usd ?? 0),
      out_per_1k: Number(r.output_per_1k_usd ?? 0),
    });
  }
  return map;
}

async function loadCostConfig(): Promise<Map<string, number>> {
  const { data } = await supabase.from('credit_cost_config').select('action_type, credits');
  const map = new Map<string, number>();
  for (const r of (data ?? []) as any[]) map.set(r.action_type, Number(r.credits ?? 0));
  return map;
}

async function loadOrgRate(orgId: string | null): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let q = supabase.from('organization_credits').select('organization_id, credit_rate_usd');
  if (orgId) q = q.eq('organization_id', orgId);
  const { data } = await q;
  for (const r of (data ?? []) as any[]) map.set(r.organization_id, Number(r.credit_rate_usd ?? DEFAULT_CREDIT_RATE_USD));
  return map;
}

function deriveCost(row: any, prices: Map<string, Price>): { cost: number | null; method: CostDerivation } {
  const total = row.total_cost_usd != null ? Number(row.total_cost_usd) : null;
  if (total != null && Number.isFinite(total)) return { cost: total, method: 'persisted_total_cost' };

  const inTok = row.input_tokens != null ? Number(row.input_tokens) : null;
  const outTok = row.output_tokens != null ? Number(row.output_tokens) : null;
  const totTok = Number(row.total_tokens ?? 0);
  const price = prices.get(row.model_name) ?? prices.get('gpt-4o-mini');

  if (price && inTok != null && outTok != null && inTok + outTok > 0) {
    return { cost: (inTok * price.in_per_1k + outTok * price.out_per_1k) / 1000, method: 'derived_io_pricing' };
  }
  if (row.unit_cost != null && totTok > 0) {
    return { cost: Number(row.unit_cost) * totTok, method: 'persisted_unit_cost' };
  }
  if (price && totTok > 0) {
    const blended = (price.in_per_1k + price.out_per_1k) / 2;
    return { cost: (totTok * blended) / 1000, method: 'derived_blended' };
  }
  return { cost: null, method: 'unavailable' };
}

function actionKeyOf(row: any): string | null {
  if (row.action_key) return row.action_key;
  const feat = row.process_type ? resolveFeatureFromProcessType(row.process_type) : null;
  return feat?.pricing_keys?.usage_action_key ?? feat?.pricing_keys?.action_key ?? row.process_type ?? null;
}

function holdIdOf(row: any): string | null {
  if (row.ledger_hold_transaction_id) return row.ledger_hold_transaction_id;
  const m = row.metadata;
  return (m && typeof m === 'object' && m.ledger_hold_transaction_id) || null;
}

/**
 * Build the shadow economic report. `orgId=null` → all orgs (admin/diagnostic).
 */
export async function getShadowEconomicReport(
  orgId: string | null,
  windowDays = 90,
  limit = 20_000,
): Promise<ShadowEconomicReport> {
  const days = Math.min(Math.max(7, windowDays), 365);
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS).toISOString();

  const [prices, costConfig, rates] = await Promise.all([loadPricing(), loadCostConfig(), loadOrgRate(orgId)]);

  let q = supabase
    .from('usage_events')
    .select(
      'organization_id, user_id, campaign_id, process_type, action_key, model_name, source_type, input_tokens, output_tokens, total_tokens, total_cost_usd, unit_cost, ledger_hold_transaction_id, metadata, created_at',
    )
    .gte('created_at', from)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (orgId) q = q.eq('organization_id', orgId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];

  const records: ShadowEconomicRecord[] = rows.map((row) => {
    const { cost, method } = deriveCost(row, prices);
    const action_key = actionKeyOf(row);
    const module = moduleForActionKey(action_key ?? undefined);
    const reserved = action_key && costConfig.has(action_key) ? (costConfig.get(action_key) as number) : null;
    const rate = rates.get(row.organization_id) ?? DEFAULT_CREDIT_RATE_USD;
    const shadow = cost != null && rate > 0 ? Math.ceil((cost / rate) * 100) / 100 : null;
    const diff = reserved != null && shadow != null ? Math.round((reserved - shadow) * 100) / 100 : null;
    return {
      organization_id: row.organization_id,
      user_id: row.user_id ?? null,
      campaign_id: row.campaign_id ?? null,
      process_type: row.process_type ?? null,
      action_key,
      module,
      model: row.model_name ?? null,
      source_type: row.source_type ?? null,
      total_tokens: Number(row.total_tokens ?? 0),
      actual_economic_cost_usd: cost != null ? Math.round(cost * 1_000_000) / 1_000_000 : null,
      cost_derivation: method,
      estimated_reserved_credits: reserved,
      shadow_settlement_credits: shadow,
      difference_from_reserved: diff,
      ledger_hold_transaction_id: holdIdOf(row),
      created_at: row.created_at,
    };
  });

  // ── Aggregations ──────────────────────────────────────────────────────────
  const agg = (keyOf: (r: ShadowEconomicRecord) => string): ShadowGroupAggregate[] => {
    const m = new Map<string, ShadowGroupAggregate>();
    for (const r of records) {
      const key = keyOf(r) || '(none)';
      let g = m.get(key);
      if (!g) {
        g = {
          key,
          label: key,
          events: 0,
          total_tokens: 0,
          actual_economic_cost_usd: 0,
          estimated_reserved_credits: 0,
          shadow_settlement_credits: 0,
          difference_from_reserved: 0,
          reserve_to_cost_ratio: null,
        };
        m.set(key, g);
      }
      g.events += 1;
      g.total_tokens += r.total_tokens;
      g.actual_economic_cost_usd += r.actual_economic_cost_usd ?? 0;
      g.estimated_reserved_credits += r.estimated_reserved_credits ?? 0;
      g.shadow_settlement_credits += r.shadow_settlement_credits ?? 0;
      g.difference_from_reserved += r.difference_from_reserved ?? 0;
    }
    for (const g of m.values()) {
      g.actual_economic_cost_usd = Math.round(g.actual_economic_cost_usd * 1_000_000) / 1_000_000;
      g.reserve_to_cost_ratio =
        g.shadow_settlement_credits > 0
          ? Math.round((g.estimated_reserved_credits / g.shadow_settlement_credits) * 100) / 100
          : null;
    }
    return Array.from(m.values()).sort((a, b) => b.actual_economic_cost_usd - a.actual_economic_cost_usd);
  };

  // ── Coverage ──────────────────────────────────────────────────────────────
  const n = records.length || 1;
  const pct = (c: number) => Math.round((c / n) * 1000) / 10;
  const withTokens = records.filter((r) => r.total_tokens > 0).length;
  const withPersisted = records.filter((r) => r.cost_derivation === 'persisted_total_cost').length;
  const withDerived = records.filter((r) => r.actual_economic_cost_usd != null).length;
  const coverage: CoverageStats = {
    total_events: records.length,
    with_tokens: withTokens,
    with_persisted_cost: withPersisted,
    with_derived_cost: withDerived,
    cost_coverage_pct: pct(withDerived),
    token_coverage_pct: pct(withTokens),
    attribution: {
      org_pct: pct(records.filter((r) => r.organization_id).length),
      user_pct: pct(records.filter((r) => r.user_id).length),
      campaign_pct: pct(records.filter((r) => r.campaign_id).length),
      activity_pct: pct(records.filter((r) => r.process_type || r.action_key).length),
      hold_linked_pct: pct(records.filter((r) => r.ledger_hold_transaction_id).length),
    },
  };

  const totals = records.reduce(
    (t, r) => {
      t.events += 1;
      t.total_tokens += r.total_tokens;
      t.actual_economic_cost_usd += r.actual_economic_cost_usd ?? 0;
      t.estimated_reserved_credits += r.estimated_reserved_credits ?? 0;
      t.shadow_settlement_credits += r.shadow_settlement_credits ?? 0;
      t.difference_from_reserved += r.difference_from_reserved ?? 0;
      return t;
    },
    { events: 0, total_tokens: 0, actual_economic_cost_usd: 0, estimated_reserved_credits: 0, shadow_settlement_credits: 0, difference_from_reserved: 0 },
  );
  totals.actual_economic_cost_usd = Math.round(totals.actual_economic_cost_usd * 1_000_000) / 1_000_000;

  const newest = records[0]?.created_at ?? null;
  const events30d = records.filter((r) => new Date(r.created_at).getTime() >= now.getTime() - 30 * DAY_MS).length;

  return {
    organization_id: orgId,
    generated_at: now.toISOString(),
    window_days: days,
    coverage,
    by_module: agg((r) => r.module),
    by_activity: agg((r) => r.process_type ?? '(none)'),
    by_model: agg((r) => r.model ?? '(none)'),
    totals,
    examples: records.filter((r) => r.actual_economic_cost_usd != null).slice(0, 8),
    pipeline: {
      newest_event_at: newest,
      events_last_30d: events30d,
      stale: events30d === 0,
    },
    notes: [
      'Read-only shadow layer: actual cost re-derived from captured tokens × existing llm_model_pricing. No billing/ledger/pricing/write-path changes.',
      'shadow_settlement_credits = actual_economic_cost_usd ÷ org credit_rate_usd (diagnostic only — NOT charged).',
      'difference_from_reserved = estimated_reserved_credits − shadow_settlement_credits (positive = fixed reserve exceeds actual cost).',
    ],
  };
}
