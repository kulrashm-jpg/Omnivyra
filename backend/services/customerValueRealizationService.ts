/**
 * customerValueRealizationService.ts
 *
 * READ-ONLY, deterministic measurement of whether customers realize value after becoming
 * customers. Evidence-only, no inference, no causality, no writes/recommendations.
 *
 * DIRECT value signals are company_id-keyed activity tables (content, campaigns, publishing,
 * market pulse, reports). Engagement/community are organization_id-keyed and NOT
 * company-attributable → excluded (UNKNOWN). Billing is org-keyed with no reliable
 * per-company payment date → value-before/after-payment is NOT_COMPUTABLE.
 */

import { supabase } from '../db/supabaseClient';

export type ValueCategory = 'CONTENT' | 'CAMPAIGN' | 'PUBLISHING' | 'MARKET_PULSE' | 'REPORTS';
export type ValueStatus = 'NO_VALUE' | 'EARLY_VALUE' | 'REALIZED_VALUE' | 'UNKNOWN';
export type ValueStage = 'COMPANY_CREATED' | 'ACTIVATED' | 'VALUE_SIGNAL_PRESENT' | 'MULTIPLE_VALUE_SIGNALS' | 'SUSTAINED_VALUE';
export type ValueSegment = 'PAYING_WITHOUT_VALUE' | 'PAYING_WITH_VALUE' | 'ACTIVE_WITHOUT_VALUE' | 'ACTIVE_WITH_VALUE' | 'NON_PAYING_WITH_VALUE';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export const VALUE_CATEGORIES: ValueCategory[] = ['CONTENT', 'CAMPAIGN', 'PUBLISHING', 'MARKET_PULSE', 'REPORTS'];

export interface ValueCompany {
  company_id: string; company_name: string; is_active: boolean; is_paying: boolean;
  signals: Record<ValueCategory, number>; // counts per category
  read_ok: boolean;
}

export interface ValueClassification {
  company_id: string; company_name: string;
  value_score: number; value_status: ValueStatus;
  value_signals: ValueCategory[]; missing_value_signals: ValueCategory[];
  evidence: string; confidence: Confidence;
}

const present = (c: ValueCompany, cat: ValueCategory) => (c.signals[cat] ?? 0) > 0;

/** Pure: per-company value classification. */
export function classifyValue(c: ValueCompany): ValueClassification {
  if (!c.read_ok) return { company_id: c.company_id, company_name: c.company_name, value_score: 0, value_status: 'UNKNOWN', value_signals: [], missing_value_signals: [], evidence: 'value sources unreadable', confidence: 'UNKNOWN' };
  const value_signals = VALUE_CATEGORIES.filter((cat) => present(c, cat));
  const missing_value_signals = VALUE_CATEGORIES.filter((cat) => !present(c, cat));
  const value_score = Math.round((value_signals.length / VALUE_CATEGORIES.length) * 100);
  const value_status: ValueStatus = value_signals.length === 0 ? 'NO_VALUE' : value_signals.length === 1 ? 'EARLY_VALUE' : 'REALIZED_VALUE';
  return {
    company_id: c.company_id, company_name: c.company_name, value_score, value_status, value_signals, missing_value_signals,
    evidence: `signals: ${VALUE_CATEGORIES.map((k) => `${k}=${c.signals[k] ?? 0}`).join(', ')}`,
    confidence: 'HIGH',
  };
}

const segmentOf = (c: ValueCompany): ValueSegment | null => {
  const hasValue = VALUE_CATEGORIES.some((cat) => present(c, cat));
  if (c.is_paying && !hasValue) return 'PAYING_WITHOUT_VALUE';
  if (c.is_paying && hasValue) return 'PAYING_WITH_VALUE';
  if (c.is_active && !hasValue) return 'ACTIVE_WITHOUT_VALUE';
  if (c.is_active && hasValue) return 'ACTIVE_WITH_VALUE';
  if (!c.is_paying && hasValue) return 'NON_PAYING_WITH_VALUE';
  return null; // non-paying, non-active, no value
};

export interface StageReach { stage: ValueStage; reached: number; lost: number; conversion_pct: number | null; }
export interface SegmentStat { segment: ValueSegment; count: number; pct: number | null; examples: string[]; }

export interface ValueRealizationResult {
  total: number;
  funnel: StageReach[];
  by_status: Record<ValueStatus, number>;
  mean_value_score: number | null;
  segments: SegmentStat[];
  billing_vs_value: {
    paying: number; value_realized: number; paying_without_value: number;
    value_before_payment: number | null; value_after_payment: number | null; note: string;
  };
  category_presence: Array<{ category: ValueCategory; companies_with: number; pct: number | null }>;
  classifications: ValueClassification[];
  unknown_gaps: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: full value-realization analysis. */
export function analyzeValueRealization(companies: ValueCompany[]): ValueRealizationResult {
  const total = companies.length;
  const signalCount = (c: ValueCompany) => VALUE_CATEGORIES.filter((cat) => present(c, cat)).length;
  const activated = companies.filter((c) => c.is_active).length;

  const funnel: StageReach[] = [
    { stage: 'COMPANY_CREATED', reached: total, lost: 0, conversion_pct: 100 },
    { stage: 'ACTIVATED', reached: activated, lost: total - activated, conversion_pct: pct(activated, total) },
    { stage: 'VALUE_SIGNAL_PRESENT', reached: companies.filter((c) => signalCount(c) >= 1).length, lost: 0, conversion_pct: pct(companies.filter((c) => signalCount(c) >= 1).length, total) },
    { stage: 'MULTIPLE_VALUE_SIGNALS', reached: companies.filter((c) => signalCount(c) >= 2).length, lost: 0, conversion_pct: pct(companies.filter((c) => signalCount(c) >= 2).length, total) },
    { stage: 'SUSTAINED_VALUE', reached: companies.filter((c) => signalCount(c) >= 3).length, lost: 0, conversion_pct: pct(companies.filter((c) => signalCount(c) >= 3).length, total) },
  ];
  for (let i = 1; i < funnel.length; i++) funnel[i].lost = funnel[i - 1].reached - funnel[i].reached;

  const classifications = companies.map(classifyValue);
  const by_status: Record<ValueStatus, number> = { NO_VALUE: 0, EARLY_VALUE: 0, REALIZED_VALUE: 0, UNKNOWN: 0 };
  for (const c of classifications) by_status[c.value_status] += 1;
  const scored = classifications.filter((c) => c.value_status !== 'UNKNOWN');
  const mean_value_score = scored.length ? Math.round((scored.reduce((a, c) => a + c.value_score, 0) / scored.length) * 10) / 10 : null;

  const SEGMENTS: ValueSegment[] = ['PAYING_WITH_VALUE', 'PAYING_WITHOUT_VALUE', 'ACTIVE_WITH_VALUE', 'ACTIVE_WITHOUT_VALUE', 'NON_PAYING_WITH_VALUE'];
  const segAssign = companies.map((c) => ({ c, seg: segmentOf(c) }));
  const segments: SegmentStat[] = SEGMENTS.map((segment) => {
    const members = segAssign.filter((x) => x.seg === segment).map((x) => x.c);
    return { segment, count: members.length, pct: pct(members.length, total), examples: members.slice(0, 5).map((m) => m.company_name) };
  });

  const paying = companies.filter((c) => c.is_paying).length;
  const value_realized = companies.filter((c) => signalCount(c) >= 1).length;
  const paying_without_value = companies.filter((c) => c.is_paying && signalCount(c) === 0).length;

  const category_presence = VALUE_CATEGORIES.map((category) => {
    const w = companies.filter((c) => present(c, category)).length;
    return { category, companies_with: w, pct: pct(w, total) };
  });

  return {
    total, funnel, by_status, mean_value_score, segments,
    billing_vs_value: {
      paying, value_realized, paying_without_value,
      value_before_payment: null, value_after_payment: null,
      note: 'value-before/after-payment NOT COMPUTABLE — billing is org-keyed with no reliable per-company payment timestamp',
    },
    category_presence,
    classifications,
    unknown_gaps: [
      'engagement + community usage are organization_id-keyed → not company-attributable (excluded)',
      'readiness-improvement value needs ≥ 2 snapshot days (13B pending)',
      'value-before/after-payment uncomputable (no per-company payment date)',
    ],
  };
}

// ── Read-only loader + orchestrator ──────────────────────────────────────────
const safe = async <T>(fn: () => Promise<T>, fb: T): Promise<T> => { try { return await fn(); } catch { return fb; } };

/** Count company_id occurrences in a table for the given ids. */
async function countByCompany(table: string, ids: string[]): Promise<{ map: Map<string, number>; ok: boolean }> {
  const map = new Map<string, number>();
  const res = await safe(async () => ({ rows: ((await supabase.from(table).select('company_id').in('company_id', ids)).data ?? []) as any[], ok: true }), { rows: [] as any[], ok: false });
  for (const r of res.rows) { const id = String(r.company_id); map.set(id, (map.get(id) ?? 0) + 1); }
  return { map, ok: res.ok };
}

export interface ValueCtxCompany { company_id: string; company_name: string; is_active: boolean; is_paying: boolean; }

export async function loadValueCompanies(ctx: ValueCtxCompany[]): Promise<ValueCompany[]> {
  const ids = ctx.map((c) => c.company_id);
  if (ids.length === 0) return [];
  const blogs = await countByCompany('blogs', ids);
  const creator = await countByCompany('creator_assets', ids);
  const campaigns = await countByCompany('campaigns', ids);
  const publishing = await countByCompany('publishing_jobs', ids);
  const pulse = await countByCompany('market_pulse_runs', ids);
  const reports = await countByCompany('reports', ids);
  const read_ok = blogs.ok && creator.ok && campaigns.ok && publishing.ok && pulse.ok && reports.ok;

  return ctx.map((c) => ({
    company_id: c.company_id, company_name: c.company_name, is_active: c.is_active, is_paying: c.is_paying, read_ok,
    signals: {
      CONTENT: (blogs.map.get(c.company_id) ?? 0) + (creator.map.get(c.company_id) ?? 0),
      CAMPAIGN: campaigns.map.get(c.company_id) ?? 0,
      PUBLISHING: publishing.map.get(c.company_id) ?? 0,
      MARKET_PULSE: pulse.map.get(c.company_id) ?? 0,
      REPORTS: reports.map.get(c.company_id) ?? 0,
    },
  }));
}

export async function getCustomerValueRealization(
  ctx: ValueCtxCompany[],
  deps: { load?: (ctx: ValueCtxCompany[]) => Promise<ValueCompany[]> } = {},
): Promise<ValueRealizationResult> {
  const companies = await (deps.load ?? loadValueCompanies)(ctx);
  return analyzeValueRealization(companies);
}
