/**
 * Consumption Analytics Service
 * Aggregates LLM and external API usage from usage_events and usage_meter_monthly.
 * Three access tiers:
 *   - super_admin : full cost data, all orgs, model-level detail
 *   - company_admin: expense view for their own org (cost as credits/USD)
 *   - user        : high-level token counts only, no cost figures
 */

import { supabase } from '../db/supabaseClient';
import { createCredit, makeIdempotencyKey, executeWithCredits } from './creditExecutionService';
import type { CreditAction } from './creditDeductionService';

export type ConsumptionTier = 'super_admin' | 'company_admin' | 'user';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LlmModelRow {
  model_name: string;
  provider_name: string;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_latency_ms: number | null;
  error_count: number;
  // cost fields — only populated for company_admin+ tiers
  total_cost_usd?: number | null;
  avg_cost_per_call?: number | null;
}

export interface LlmByOperation {
  process_type: string;
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

export interface LlmByFeatureArea {
  feature_area: string;
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

export interface LlmByUser {
  user_id: string | null;
  email?: string | null;
  user_type: 'member' | 'guest' | 'system';
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

export interface LlmByCampaign {
  campaign_id: string | null;
  call_count: number;
  total_tokens: number;
  total_cost_usd?: number | null;
}

export interface LlmConsumptionSummary {
  organization_id: string;
  period: { year: number; month: number };
  totals: {
    call_count: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    error_count: number;
    total_cost_usd?: number | null;
  };
  by_model: LlmModelRow[];
  by_operation?: LlmByOperation[];      // company_admin+
  by_feature_area?: LlmByFeatureArea[]; // company_admin+ — grouped by product feature
  by_user?: LlmByUser[];                // super_admin only
  by_campaign?: LlmByCampaign[];        // company_admin+
}

export interface ApiUsageRow {
  source_name: string;
  source_type: string;
  call_count: number;
  error_count: number;
  avg_latency_ms: number | null;
  total_cost_usd?: number | null;
}

export interface ApiConsumptionSummary {
  organization_id: string;
  period: { year: number; month: number };
  totals: {
    call_count: number;
    error_count: number;
    total_cost_usd?: number | null;
  };
  by_source: ApiUsageRow[];
}

export interface OrgConsumptionRow {
  organization_id: string;
  org_name?: string | null;
  llm_calls: number;
  llm_tokens: number;
  llm_cost_usd: number;
  api_calls: number;
  api_cost_usd: number;
  total_cost_usd: number;
  credit_balance?: number | null;
}

export interface CreditTransaction {
  id: string;
  transaction_type: string;
  credits_delta: number;
  balance_after: number;
  usd_equivalent: number | null;
  reference_type: string | null;
  note: string | null;
  created_at: string;
}

export interface OrgCreditSummary {
  organization_id: string;
  balance_credits: number;
  lifetime_purchased: number;
  lifetime_consumed: number;
  credit_rate_usd: number;
  balance_usd_equivalent: number;
  recent_transactions: CreditTransaction[];
}

// ─── Year/Month helpers ───────────────────────────────────────────────────────

function currentYearMonth(monthsAgo = 0): { year: number; month: number } {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// ─── LLM Consumption ─────────────────────────────────────────────────────────

export async function getLlmConsumption(
  organizationId: string,
  tier: ConsumptionTier,
  opts: { year?: number; month?: number } = {}
): Promise<LlmConsumptionSummary> {
  const { year, month } = opts.year
    ? { year: opts.year, month: opts.month ?? currentYearMonth().month }
    : currentYearMonth();

  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

  // Base query — LLM events for this org and period
  // Use * so missing optional columns (e.g. feature_area pre-migration) don't crash the query.
  const { data: events, error } = await supabase
    .from('usage_events')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('source_type', 'llm')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  if (error) throw new Error(`[consumptionAnalytics] LLM query failed: ${error.message}`);

  const rows = (events ?? []) as unknown as Array<{
    model_name: string | null;
    provider_name: string | null;
    process_type: string | null;
    feature_area: string | null;
    user_id: string | null;
    campaign_id: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    latency_ms: number | null;
    error_flag: boolean | null;
    total_cost: number | null;
  }>;

  // Aggregate by model
  const modelMap = new Map<string, LlmModelRow>();
  let totalCalls = 0, totalInput = 0, totalOutput = 0, totalTokens = 0, totalErrors = 0;
  let totalCostUsd = 0;

  for (const r of rows) {
    const key = `${r.provider_name ?? 'unknown'}::${r.model_name ?? 'unknown'}`;
    const existing = modelMap.get(key) ?? {
      model_name: r.model_name ?? 'unknown',
      provider_name: r.provider_name ?? 'unknown',
      call_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      avg_latency_ms: null,
      error_count: 0,
      total_cost_usd: 0,
      avg_cost_per_call: null,
      _latency_sum: 0,
      _latency_count: 0,
    } as any;

    existing.call_count += 1;
    existing.input_tokens += r.input_tokens ?? 0;
    existing.output_tokens += r.output_tokens ?? 0;
    existing.total_tokens += r.total_tokens ?? 0;
    if (r.error_flag) existing.error_count += 1;
    if (r.latency_ms != null) { existing._latency_sum += r.latency_ms; existing._latency_count += 1; }
    existing.total_cost_usd = (existing.total_cost_usd ?? 0) + (r.total_cost ?? 0);
    modelMap.set(key, existing);

    totalCalls += 1;
    totalInput += r.input_tokens ?? 0;
    totalOutput += r.output_tokens ?? 0;
    totalTokens += r.total_tokens ?? 0;
    if (r.error_flag) totalErrors += 1;
    totalCostUsd += r.total_cost ?? 0;
  }

  const byModel: LlmModelRow[] = Array.from(modelMap.values()).map((m: any) => ({
    model_name: m.model_name,
    provider_name: m.provider_name,
    call_count: m.call_count,
    input_tokens: m.input_tokens,
    output_tokens: m.output_tokens,
    total_tokens: m.total_tokens,
    avg_latency_ms: m._latency_count > 0 ? Math.round(m._latency_sum / m._latency_count) : null,
    error_count: m.error_count,
    ...(tier !== 'user' ? {
      total_cost_usd: Math.round((m.total_cost_usd ?? 0) * 1_000_000) / 1_000_000,
      avg_cost_per_call: m.call_count > 0 ? (m.total_cost_usd ?? 0) / m.call_count : null,
    } : {}),
  }));

  const result: LlmConsumptionSummary = {
    organization_id: organizationId,
    period: { year, month },
    totals: {
      call_count: totalCalls,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      total_tokens: totalTokens,
      error_count: totalErrors,
      ...(tier !== 'user' ? { total_cost_usd: Math.round(totalCostUsd * 1_000_000) / 1_000_000 } : {}),
    },
    by_model: byModel,
  };

  // company_admin+ also gets by_operation, by_feature_area, and by_campaign
  if (tier !== 'user') {
    const opMap = new Map<string, LlmByOperation>();
    const featureMap = new Map<string, LlmByFeatureArea>();
    const campMap = new Map<string, LlmByCampaign>();
    for (const r of rows) {
      const op = r.process_type ?? 'unknown';
      const opRow = opMap.get(op) ?? { process_type: op, call_count: 0, total_tokens: 0, total_cost_usd: 0 };
      opRow.call_count += 1;
      opRow.total_tokens += r.total_tokens ?? 0;
      opRow.total_cost_usd = (opRow.total_cost_usd ?? 0) + (r.total_cost ?? 0);
      opMap.set(op, opRow);

      const fa = r.feature_area ?? 'Other';
      const faRow = featureMap.get(fa) ?? { feature_area: fa, call_count: 0, total_tokens: 0, total_cost_usd: 0 };
      faRow.call_count += 1;
      faRow.total_tokens += r.total_tokens ?? 0;
      faRow.total_cost_usd = (faRow.total_cost_usd ?? 0) + (r.total_cost ?? 0);
      featureMap.set(fa, faRow);

      const camp = r.campaign_id ?? 'none';
      const campRow = campMap.get(camp) ?? { campaign_id: r.campaign_id, call_count: 0, total_tokens: 0, total_cost_usd: 0 };
      campRow.call_count += 1;
      campRow.total_tokens += r.total_tokens ?? 0;
      campRow.total_cost_usd = (campRow.total_cost_usd ?? 0) + (r.total_cost ?? 0);
      campMap.set(camp, campRow);
    }
    result.by_operation = Array.from(opMap.values()).sort((a, b) => b.call_count - a.call_count);
    result.by_feature_area = Array.from(featureMap.values()).sort((a, b) => (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0));
    result.by_campaign = Array.from(campMap.values()).sort((a, b) => b.total_tokens - a.total_tokens);
  }

  // super_admin also gets by_user — with email resolution and membership type
  if (tier === 'super_admin') {
    const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
    const userMap = new Map<string, LlmByUser>();
    for (const r of rows) {
      const uid = r.user_id ?? '__system__';
      const isSystem = !r.user_id || r.user_id === ZERO_UUID;
      const uRow = userMap.get(uid) ?? {
        user_id: r.user_id,
        user_type: isSystem ? 'system' : 'guest', // default guest; upgraded to 'member' below
        call_count: 0,
        total_tokens: 0,
        total_cost_usd: 0,
      };
      uRow.call_count += 1;
      uRow.total_tokens += r.total_tokens ?? 0;
      uRow.total_cost_usd = (uRow.total_cost_usd ?? 0) + (r.total_cost ?? 0);
      userMap.set(uid, uRow);
    }

    // Resolve emails via auth.admin
    const realUserIds = Array.from(userMap.keys()).filter(uid => uid !== '__system__' && uid !== ZERO_UUID);
    if (realUserIds.length > 0) {
      try {
        const { data: authData } = await (supabase.auth as any).admin.listUsers({ perPage: 1000 });
        const authUsers: Array<{ id: string; email?: string }> = authData?.users ?? [];
        const emailMap = new Map(authUsers.map((u: { id: string; email?: string }) => [u.id, u.email ?? null]));
        for (const uid of realUserIds) {
          const row = userMap.get(uid);
          if (row) row.email = emailMap.get(uid) ?? null;
        }
      } catch { /* auth.admin unavailable — emails stay null */ }

      // Resolve membership type: users with a role row in this org are 'member'; others are 'guest'
      const { data: roleRows } = await supabase
        .from('user_company_roles')
        .select('user_id')
        .eq('company_id', organizationId)
        .in('user_id', realUserIds);
      const memberSet = new Set((roleRows ?? []).map((r: { user_id: string }) => r.user_id));
      for (const uid of realUserIds) {
        const row = userMap.get(uid);
        if (row) row.user_type = memberSet.has(uid) ? 'member' : 'guest';
      }
    }

    result.by_user = Array.from(userMap.values()).sort((a, b) => (b.total_cost_usd ?? 0) - (a.total_cost_usd ?? 0));
  }

  return result;
}

// ─── API Consumption ──────────────────────────────────────────────────────────

export async function getApiConsumption(
  organizationId: string,
  tier: ConsumptionTier,
  opts: { year?: number; month?: number } = {}
): Promise<ApiConsumptionSummary> {
  const { year, month } = opts.year
    ? { year: opts.year, month: opts.month ?? currentYearMonth().month }
    : currentYearMonth();

  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

  const { data: events, error } = await supabase
    .from('usage_events')
    .select('source_name, source_type, latency_ms, error_flag, total_cost')
    .eq('organization_id', organizationId)
    .eq('source_type', 'external_api')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  if (error) throw new Error(`[consumptionAnalytics] API query failed: ${error.message}`);

  const rows = (events ?? []) as unknown as Array<{
    source_name: string | null;
    source_type: string | null;
    latency_ms: number | null;
    error_flag: boolean | null;
    total_cost: number | null;
  }>;

  const sourceMap = new Map<string, ApiUsageRow & { _latency_sum: number; _latency_count: number }>();
  let totalCalls = 0, totalErrors = 0, totalCostUsd = 0;

  for (const r of rows) {
    const key = r.source_name ?? 'unknown';
    const existing = sourceMap.get(key) ?? {
      source_name: key,
      source_type: r.source_type ?? 'external_api',
      call_count: 0,
      error_count: 0,
      avg_latency_ms: null,
      total_cost_usd: 0,
      _latency_sum: 0,
      _latency_count: 0,
    };
    existing.call_count += 1;
    if (r.error_flag) existing.error_count += 1;
    if (r.latency_ms != null) { existing._latency_sum += r.latency_ms; existing._latency_count += 1; }
    existing.total_cost_usd = (existing.total_cost_usd ?? 0) + (r.total_cost ?? 0);
    sourceMap.set(key, existing);
    totalCalls += 1;
    if (r.error_flag) totalErrors += 1;
    totalCostUsd += r.total_cost ?? 0;
  }

  const bySource: ApiUsageRow[] = Array.from(sourceMap.values()).map((s) => ({
    source_name: s.source_name,
    source_type: s.source_type,
    call_count: s.call_count,
    error_count: s.error_count,
    avg_latency_ms: s._latency_count > 0 ? Math.round(s._latency_sum / s._latency_count) : null,
    ...(tier !== 'user' ? { total_cost_usd: Math.round((s.total_cost_usd ?? 0) * 1_000_000) / 1_000_000 } : {}),
  }));

  return {
    organization_id: organizationId,
    period: { year, month },
    totals: {
      call_count: totalCalls,
      error_count: totalErrors,
      ...(tier !== 'user' ? { total_cost_usd: Math.round(totalCostUsd * 1_000_000) / 1_000_000 } : {}),
    },
    by_source: bySource.sort((a, b) => b.call_count - a.call_count),
  };
}

// ─── Super Admin: All-Orgs Overview ──────────────────────────────────────────

export async function getAllOrgsConsumption(
  opts: { year?: number; month?: number } = {}
): Promise<OrgConsumptionRow[]> {
  const { year, month } = opts.year
    ? { year: opts.year, month: opts.month ?? currentYearMonth().month }
    : currentYearMonth();

  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

  const { data: events, error } = await supabase
    .from('usage_events')
    .select('organization_id, source_type, total_tokens, total_cost')
    .gte('created_at', startDate)
    .lt('created_at', endDate);

  if (error) throw new Error(`[consumptionAnalytics] all-orgs query failed: ${error.message}`);

  const orgMap = new Map<string, OrgConsumptionRow>();

  for (const r of (events ?? []) as Array<{ organization_id: string; source_type: string; total_tokens: number | null; total_cost: number | null }>) {
    const oid = r.organization_id;
    const row = orgMap.get(oid) ?? { organization_id: oid, llm_calls: 0, llm_tokens: 0, llm_cost_usd: 0, api_calls: 0, api_cost_usd: 0, total_cost_usd: 0 };
    if (r.source_type === 'llm') {
      row.llm_calls += 1;
      row.llm_tokens += r.total_tokens ?? 0;
      row.llm_cost_usd += r.total_cost ?? 0;
    } else if (r.source_type === 'external_api') {
      row.api_calls += 1;
      row.api_cost_usd += r.total_cost ?? 0;
    }
    row.total_cost_usd = row.llm_cost_usd + row.api_cost_usd;
    orgMap.set(oid, row);
  }

  // Fetch org names
  const orgIds = Array.from(orgMap.keys());
  if (orgIds.length > 0) {
    const { data: profiles } = await supabase
      .from('company_profiles')
      .select('company_id, company_name')
      .in('company_id', orgIds);
    for (const p of (profiles ?? []) as Array<{ company_id: string; company_name: string }>) {
      const row = orgMap.get(p.company_id);
      if (row) row.org_name = p.company_name;
    }

    // Fetch credit balances
    const { data: credits } = await supabase
      .from('organization_credits')
      .select('organization_id, free_balance, paid_balance, incentive_balance')
      .in('organization_id', orgIds);
    for (const c of (credits ?? []) as Array<{ organization_id: string; free_balance: number; paid_balance: number; incentive_balance: number }>) {
      const row = orgMap.get(c.organization_id);
      if (row) row.credit_balance = (c.free_balance ?? 0) + (c.paid_balance ?? 0) + (c.incentive_balance ?? 0);
    }
  }

  return Array.from(orgMap.values()).sort((a, b) => b.total_cost_usd - a.total_cost_usd);
}

// ─── Credits ─────────────────────────────────────────────────────────────────

export async function getOrgCreditSummary(organizationId: string): Promise<OrgCreditSummary | null> {
  const { data: credit } = await supabase
    .from('organization_credits')
    .select('free_balance, paid_balance, incentive_balance, lifetime_purchased, lifetime_consumed, credit_rate_usd')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!credit) return null;

  const { data: txRows } = await supabase
    .from('credit_transactions')
    .select('id, transaction_type, credits_delta, balance_after, usd_equivalent, reference_type, note, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const c = credit as {
    free_balance: number;
    paid_balance: number;
    incentive_balance: number;
    lifetime_purchased: number;
    lifetime_consumed: number;
    credit_rate_usd: number;
  };

  const totalBalance = (c.free_balance ?? 0) + (c.paid_balance ?? 0) + (c.incentive_balance ?? 0);

  return {
    organization_id: organizationId,
    balance_credits: totalBalance,
    lifetime_purchased: c.lifetime_purchased,
    lifetime_consumed: c.lifetime_consumed,
    credit_rate_usd: c.credit_rate_usd,
    balance_usd_equivalent: totalBalance * c.credit_rate_usd,
    recent_transactions: (txRows ?? []) as CreditTransaction[],
  };
}

export async function grantCredits(params: {
  organizationId: string;
  credits: number;
  usdEquivalent?: number;
  note?: string;
  performedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  // Time-bucketed idempotency key (minute precision) — allows multiple distinct
  // grants per org per admin, while making retries within 1 minute safe.
  const minuteBucket = new Date().toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'
  try {
    await createCredit({
      orgId:          params.organizationId,
      amount:         params.credits,
      category:       'paid',
      referenceType:  'manual_grant',
      referenceId:    `${params.organizationId}:${minuteBucket}`,
      note:           params.note ?? undefined,
      performedBy:    params.performedBy,
      idempotencyKey: makeIdempotencyKey(
        params.performedBy,
        'manual_grant',
        `${params.organizationId}:${minuteBucket}`,
      ),
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function adjustCredits(params: {
  organizationId: string;
  credits: number;  // positive = add credit, negative = deduct credit
  note: string;
  performedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const minuteBucket = new Date().toISOString().slice(0, 16);
  const refId = `adj:${params.organizationId}:${minuteBucket}`;

  if (params.credits > 0) {
    // Positive adjustment — grant path
    try {
      await createCredit({
        orgId:          params.organizationId,
        amount:         params.credits,
        category:       'paid',
        referenceType:  'manual_adjustment',
        referenceId:    refId,
        note:           params.note,
        performedBy:    params.performedBy,
        idempotencyKey: makeIdempotencyKey(params.performedBy, 'manual_adjustment', refId),
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  } else if (params.credits < 0) {
    // Negative adjustment — deduction path via executeWithCredits with no-op executor
    const result = await executeWithCredits({
      userId:         params.performedBy,
      orgId:          params.organizationId,
      action:         'content_basic' as CreditAction, // smallest valid action key
      referenceType:  'manual_adjustment',
      referenceId:    refId,
      idempotencyKey: makeIdempotencyKey(params.performedBy, 'manual_adjustment', refId),
      amountOverride: Math.abs(params.credits),
      note:           params.note,
      executor:       async () => {},
    });
    if (result.status === 'executed' || result.status === 'already_confirmed') return { ok: true };
    return { ok: false, error: `adjustment failed: ${result.status}` };
  }

  return { ok: true }; // zero credits — no-op
}

export async function updateOrgCreditRate(params: {
  organizationId: string;
  creditRateUsd: number;
  performedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('organization_credits')
    .upsert({
      organization_id: params.organizationId,
      credit_rate_usd: params.creditRateUsd,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
