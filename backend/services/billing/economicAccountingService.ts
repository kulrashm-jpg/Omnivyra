/**
 * Phase 8F — Super-admin ECONOMIC ACCOUNTING (read-only, backend only).
 *
 * A complete economic visibility layer built ENTIRELY on already-existing
 * tables — no migration, no new accounting logic, no settlement/HOLD/CONFIRM/
 * RELEASE/admission change. Read-only.
 *
 * Sources of truth (reused, not duplicated):
 *   • unified_transactions — analytics-primary row per provider call:
 *       organization_id, action_key, source_type, provider_name, model_name,
 *       total_tokens, api_cost_usd (provider USD), credits_charged,
 *       credits_value_usd, margin_usd (GENERATED = credits_value_usd − api_cost_usd).
 *     → provider cost, tokens, credits value, and MARGIN come straight from here
 *       (margin is never recomputed — we just sum the column).
 *   • credit_transactions — the immutable settlement ledger:
 *       reference_type (= the activity/CreditAction), execution_phase
 *       (hold/confirm/release), credits_delta.
 *     → credits_reserved (hold), effective_credits (confirm − release).
 *
 * Customer vs platform spend is the source_type partition:
 *   CUSTOMER  = llm | embedding | external_api | automation_execution
 *   PLATFORM  = system   (AI-visibility probes, system evaluations, internal
 *                         model checks, non-customer provider spend)
 *   ZERO-COST = cache | internal  (no provider charge; excluded from cost)
 * Platform spend is EXCLUDED from company billing and surfaced ONLY here
 * (super-admin), per Phase 8F TASK 3.
 *
 * The aggregation math lives in PURE functions (no I/O) so it is exhaustively
 * unit-testable; the async fetchers are thin wrappers that read the tables and
 * delegate. The pure functions assume numeric inputs (callers coerce Postgres
 * numeric strings to numbers at the fetch boundary).
 */

import { supabase } from '../../db/supabaseClient';

// ── Source-type partition ─────────────────────────────────────────────────────
export const CUSTOMER_SOURCE_TYPES = ['llm', 'embedding', 'external_api', 'automation_execution'] as const;
export const PLATFORM_SOURCE_TYPES = ['system'] as const;

export type SpendType = 'customer' | 'platform' | 'zero_cost';
export function classifySpendType(sourceType: string | null | undefined): SpendType {
  if (sourceType === 'system') return 'platform';
  if (sourceType && (CUSTOMER_SOURCE_TYPES as readonly string[]).includes(sourceType)) return 'customer';
  return 'zero_cost'; // cache / internal / unknown → no provider charge attributed
}

// ── Row shapes (numbers already coerced at the fetch boundary) ─────────────────
export interface UnifiedTxnRow {
  organization_id: string | null;
  action_key: string | null;
  source_type: string | null;
  provider_name: string | null;
  model_name: string | null;
  total_tokens: number;
  api_cost_usd: number;
  credits_charged: number;
  credits_value_usd: number;
  margin_usd: number;
}
export interface CreditPhaseRow {
  organization_id: string | null;
  reference_type: string | null; // = the activity (CreditAction)
  execution_phase: string | null;
  credits_delta: number;
}

// ── Outputs ────────────────────────────────────────────────────────────────────
export interface ActivityLedgerRow {
  activity: string;
  organizationId: string;
  provider: string | null;          // dominant (highest-cost) provider for the activity
  model: string | null;             // dominant model
  tokens: number;
  providerCostUsd: number;
  creditsReserved: number;          // from ledger HOLD rows
  creditsConsumed: number;          // from ledger CONFIRM (fallback: credits_charged)
  effectiveCredits: number;         // CONFIRM − RELEASE
  creditsValueUsd: number;
  marginUsd: number;                // reused from unified_transactions.margin_usd
  creditToCostRatio: number | null; // creditsValueUsd / providerCostUsd
  period: string;
  providerBreakdown: Array<{ provider: string | null; model: string | null; providerCostUsd: number; tokens: number }>;
}

export interface ProfitabilityRow {
  key: string;                      // provider / activity / organization id
  events: number;
  tokens: number;
  providerCostUsd: number;
  creditsValueUsd: number;
  marginUsd: number;
  creditToCostRatio: number | null;
}

export interface PlatformCostAccounting {
  totalPlatformCostUsd: number;
  events: number;
  byProvider: ProfitabilityRow[];
  byActivity: ProfitabilityRow[];
}

function ratio(creditsValueUsd: number, providerCostUsd: number): number | null {
  return providerCostUsd > 0 ? creditsValueUsd / providerCostUsd : null;
}

// ── Pure aggregators ────────────────────────────────────────────────────────────

/** Split rows into customer / platform / zero-cost buckets by source_type. */
export function partitionBySpendType(rows: UnifiedTxnRow[]): {
  customer: UnifiedTxnRow[];
  platform: UnifiedTxnRow[];
  zeroCost: UnifiedTxnRow[];
} {
  const customer: UnifiedTxnRow[] = [];
  const platform: UnifiedTxnRow[] = [];
  const zeroCost: UnifiedTxnRow[] = [];
  for (const r of rows) {
    const t = classifySpendType(r.source_type);
    if (t === 'platform') platform.push(r);
    else if (t === 'customer') customer.push(r);
    else zeroCost.push(r);
  }
  return { customer, platform, zeroCost };
}

interface CreditAgg { reserved: number; confirmed: number; released: number; }
/** Per (org|activity) ledger phase totals from credit_transactions. */
export function aggregateCreditPhases(rows: CreditPhaseRow[]): Map<string, CreditAgg> {
  const m = new Map<string, CreditAgg>();
  for (const r of rows) {
    if (!r.organization_id || !r.reference_type) continue;
    const key = `${r.organization_id}|${r.reference_type}`;
    const a = m.get(key) ?? { reserved: 0, confirmed: 0, released: 0 };
    const mag = Math.abs(r.credits_delta ?? 0);
    if (r.execution_phase === 'hold') a.reserved += mag;
    else if (r.execution_phase === 'confirm') a.confirmed += mag;
    else if (r.execution_phase === 'release') a.released += mag;
    m.set(key, a);
  }
  return m;
}

/**
 * Unified per-activity economic ledger (TASK 1). One row per (organization,
 * activity). provider/model = the dominant (highest provider-cost) pair, with a
 * full providerBreakdown for transparency. Credits come from the ledger when
 * present, falling back to metered credits_charged.
 */
export function aggregateActivityLedger(
  customerRows: UnifiedTxnRow[],
  creditRows: CreditPhaseRow[],
  period: string,
): ActivityLedgerRow[] {
  const credit = aggregateCreditPhases(creditRows);

  interface Acc {
    tokens: number; providerCostUsd: number; creditsCharged: number;
    creditsValueUsd: number; marginUsd: number;
    providers: Map<string, { provider: string | null; model: string | null; providerCostUsd: number; tokens: number }>;
  }
  const groups = new Map<string, Acc>();

  for (const r of customerRows) {
    if (!r.organization_id || !r.action_key) continue;
    const key = `${r.organization_id}|${r.action_key}`;
    const acc = groups.get(key) ?? {
      tokens: 0, providerCostUsd: 0, creditsCharged: 0, creditsValueUsd: 0, marginUsd: 0,
      providers: new Map(),
    };
    acc.tokens += r.total_tokens ?? 0;
    acc.providerCostUsd += r.api_cost_usd ?? 0;
    acc.creditsCharged += r.credits_charged ?? 0;
    acc.creditsValueUsd += r.credits_value_usd ?? 0;
    acc.marginUsd += r.margin_usd ?? 0;
    const pmKey = `${r.provider_name ?? ''}|${r.model_name ?? ''}`;
    const pm = acc.providers.get(pmKey) ?? { provider: r.provider_name, model: r.model_name, providerCostUsd: 0, tokens: 0 };
    pm.providerCostUsd += r.api_cost_usd ?? 0;
    pm.tokens += r.total_tokens ?? 0;
    acc.providers.set(pmKey, pm);
    groups.set(key, acc);
  }

  const out: ActivityLedgerRow[] = [];
  for (const [key, acc] of groups) {
    const [organizationId, activity] = key.split('|');
    const c = credit.get(key);
    const breakdown = Array.from(acc.providers.values()).sort((a, b) => b.providerCostUsd - a.providerCostUsd);
    const dominant = breakdown[0] ?? { provider: null, model: null };
    const creditsConsumed = c ? c.confirmed : acc.creditsCharged;
    const effectiveCredits = c ? c.confirmed - c.released : acc.creditsCharged;
    out.push({
      activity,
      organizationId,
      provider: dominant.provider,
      model: dominant.model,
      tokens: acc.tokens,
      providerCostUsd: acc.providerCostUsd,
      creditsReserved: c?.reserved ?? 0,
      creditsConsumed,
      effectiveCredits,
      creditsValueUsd: acc.creditsValueUsd,
      marginUsd: acc.marginUsd,
      creditToCostRatio: ratio(acc.creditsValueUsd, acc.providerCostUsd),
      period,
      providerBreakdown: breakdown,
    });
  }
  return out.sort((a, b) => b.providerCostUsd - a.providerCostUsd);
}

/** Generic profitability rollup over a key extractor (provider/activity/org). */
function aggregateProfitability(rows: UnifiedTxnRow[], keyOf: (r: UnifiedTxnRow) => string | null): ProfitabilityRow[] {
  const m = new Map<string, ProfitabilityRow>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const a = m.get(k) ?? { key: k, events: 0, tokens: 0, providerCostUsd: 0, creditsValueUsd: 0, marginUsd: 0, creditToCostRatio: null };
    a.events += 1;
    a.tokens += r.total_tokens ?? 0;
    a.providerCostUsd += r.api_cost_usd ?? 0;
    a.creditsValueUsd += r.credits_value_usd ?? 0;
    a.marginUsd += r.margin_usd ?? 0;
    m.set(k, a);
  }
  const out = Array.from(m.values());
  for (const a of out) a.creditToCostRatio = ratio(a.creditsValueUsd, a.providerCostUsd);
  return out.sort((a, b) => b.providerCostUsd - a.providerCostUsd);
}

/** Provider profitability (margin by provider, credit-to-cost ratio) — TASK 4. */
export function aggregateProviderProfitability(rows: UnifiedTxnRow[]): ProfitabilityRow[] {
  return aggregateProfitability(rows, (r) => r.provider_name);
}
/** Activity profitability (margin by activity) — TASK 4. */
export function aggregateActivityProfitability(rows: UnifiedTxnRow[]): ProfitabilityRow[] {
  return aggregateProfitability(rows, (r) => r.action_key);
}
/** Organization profitability — TASK 4. */
export function aggregateOrganizationProfitability(rows: UnifiedTxnRow[]): ProfitabilityRow[] {
  return aggregateProfitability(rows, (r) => r.organization_id);
}

/** Platform-cost accounting (system spend only) — TASK 3. Never in company billing. */
export function aggregatePlatformCost(platformRows: UnifiedTxnRow[]): PlatformCostAccounting {
  return {
    totalPlatformCostUsd: platformRows.reduce((s, r) => s + (r.api_cost_usd ?? 0), 0),
    events: platformRows.length,
    byProvider: aggregateProviderProfitability(platformRows),
    byActivity: aggregateActivityProfitability(platformRows),
  };
}

// ── Thin read-only fetchers ─────────────────────────────────────────────────────

const MAX_ROWS = 50_000;

interface Window { since: string; until?: string; organizationId?: string; }

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function fetchUnifiedRows(w: Window): Promise<UnifiedTxnRow[]> {
  let q = supabase
    .from('unified_transactions')
    .select('organization_id, action_key, source_type, provider_name, model_name, total_tokens, api_cost_usd, credits_charged, credits_value_usd, margin_usd')
    .eq('final_attempt', true)
    .gte('created_at', w.since)
    .limit(MAX_ROWS);
  if (w.until) q = q.lte('created_at', w.until);
  if (w.organizationId) q = q.eq('organization_id', w.organizationId);
  const { data, error } = await q;
  if (error) throw new Error(`[economicAccounting] unified_transactions read failed: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    organization_id: r.organization_id ?? null,
    action_key: r.action_key ?? null,
    source_type: r.source_type ?? null,
    provider_name: r.provider_name ?? null,
    model_name: r.model_name ?? null,
    total_tokens: num(r.total_tokens),
    api_cost_usd: num(r.api_cost_usd),
    credits_charged: num(r.credits_charged),
    credits_value_usd: num(r.credits_value_usd),
    margin_usd: num(r.margin_usd),
  }));
}

async function fetchCreditPhaseRows(w: Window): Promise<CreditPhaseRow[]> {
  let q = supabase
    .from('credit_transactions')
    .select('organization_id, reference_type, execution_phase, credits_delta')
    .in('execution_phase', ['hold', 'confirm', 'release'])
    .gte('created_at', w.since)
    .limit(MAX_ROWS);
  if (w.until) q = q.lte('created_at', w.until);
  if (w.organizationId) q = q.eq('organization_id', w.organizationId);
  const { data, error } = await q;
  if (error) throw new Error(`[economicAccounting] credit_transactions read failed: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    organization_id: r.organization_id ?? null,
    reference_type: r.reference_type ?? null,
    execution_phase: r.execution_phase ?? null,
    credits_delta: num(r.credits_delta),
  }));
}

/** Per-activity unified economic ledger (customer activities). TASK 1. */
export async function getActivityEconomicLedger(w: Window & { period?: string }): Promise<ActivityLedgerRow[]> {
  const [unified, credits] = await Promise.all([fetchUnifiedRows(w), fetchCreditPhaseRows(w)]);
  const { customer } = partitionBySpendType(unified);
  return aggregateActivityLedger(customer, credits, w.period ?? w.since);
}

export interface ProfitabilityReport {
  byProvider: ProfitabilityRow[];
  byActivity: ProfitabilityRow[];
  byOrganization: ProfitabilityRow[];
}
/** Provider/activity/organization profitability + credit-to-cost ratios. TASK 4. */
export async function getProfitabilityReport(w: Window): Promise<ProfitabilityReport> {
  const unified = await fetchUnifiedRows(w);
  const { customer } = partitionBySpendType(unified);
  return {
    byProvider: aggregateProviderProfitability(customer),
    byActivity: aggregateActivityProfitability(customer),
    byOrganization: aggregateOrganizationProfitability(customer),
  };
}

/**
 * Platform-global (null-org) system rows from usage_events. These are
 * non-customer provider costs (e.g. AI-visibility probes — Phase 8G-B) that
 * carry no organization and therefore never reach unified_transactions
 * (organization_id NOT NULL). Disjoint from the org-attributed system rows in
 * unified_transactions, so combining the two never double-counts. activity =
 * reference_type (falls back to process_type); margin = −cost (pure platform
 * spend, no credit value). Excluded when an org filter is set (these belong to
 * no org).
 */
async function fetchPlatformGlobalUsageRows(w: Window): Promise<UnifiedTxnRow[]> {
  if (w.organizationId) return [];
  let q = supabase
    .from('usage_events')
    .select('process_type, reference_type, provider_name, provider, model_name, model, total_tokens, total_cost_usd')
    .eq('source_type', 'system')
    .is('organization_id', null)
    .gte('created_at', w.since)
    .limit(MAX_ROWS);
  if (w.until) q = q.lte('created_at', w.until);
  const { data, error } = await q;
  if (error) throw new Error(`[economicAccounting] platform usage_events read failed: ${error.message}`);
  return (data ?? []).map((r: any) => {
    const cost = num(r.total_cost_usd);
    return {
      organization_id: null,
      action_key: r.reference_type ?? r.process_type ?? null,
      source_type: 'system',
      provider_name: r.provider_name ?? r.provider ?? null,
      model_name: r.model_name ?? r.model ?? null,
      total_tokens: num(r.total_tokens),
      api_cost_usd: cost,
      credits_charged: 0,
      credits_value_usd: 0,
      margin_usd: -cost,
    };
  });
}

/** Platform (system / non-customer) cost accounting. TASK 3 — super-admin only. */
export async function getPlatformCostAccounting(w: Window): Promise<PlatformCostAccounting> {
  const [unified, platformGlobal] = await Promise.all([
    fetchUnifiedRows(w),
    fetchPlatformGlobalUsageRows(w),
  ]);
  const { platform } = partitionBySpendType(unified); // org-attributed system spend
  return aggregatePlatformCost([...platform, ...platformGlobal]);
}
