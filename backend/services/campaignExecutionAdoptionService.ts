/**
 * campaignExecutionAdoptionService.ts
 *
 * READ-ONLY, deterministic intelligence on adoption DEPTH of Omnivyra's execution
 * capabilities (content/campaign/publishing/reports/market-pulse VOLUME) after activation.
 * Pure functions over the already-loaded value-signal counts (no new DB reads).
 * Evidence-only, no inference, no causality, no writes.
 *
 * Engagement/community usage is organization_id-keyed (per 14E) → not company-attributable
 * → excluded (UNKNOWN), not counted as zero.
 */

import type { ValueCompany, ValueCategory } from './customerValueRealizationService';
import { VALUE_CATEGORIES } from './customerValueRealizationService';

export type ExecutionStatus = 'NO_EXECUTION' | 'EARLY_EXECUTION' | 'ACTIVE_EXECUTION' | 'SUSTAINED_EXECUTION' | 'UNKNOWN';
export type ExecutionStage = 'ACTIVATED' | 'FIRST_CONTENT' | 'FIRST_CAMPAIGN' | 'FIRST_PUBLICATION' | 'REPEATED_EXECUTION' | 'SUSTAINED_EXECUTION';
export type ValueBucket = 'NO_VALUE' | 'EARLY_VALUE' | 'REALIZED_VALUE';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const REPEAT_VOLUME = 2;     // > 1 execution = repeat
const SUSTAINED_VOLUME = 10; // high volume
const SUSTAINED_BREADTH = 3; // or ≥ 3 categories

const breadth = (c: ValueCompany) => VALUE_CATEGORIES.filter((cat) => (c.signals[cat] ?? 0) > 0).length;
const frequency = (c: ValueCompany) => VALUE_CATEGORIES.reduce((a, cat) => a + (c.signals[cat] ?? 0), 0);
const valueBucketOf = (c: ValueCompany): ValueBucket => { const b = breadth(c); return b === 0 ? 'NO_VALUE' : b === 1 ? 'EARLY_VALUE' : 'REALIZED_VALUE'; };

export interface ExecutionClassification {
  company_id: string; company_name: string;
  execution_score: number; execution_status: ExecutionStatus;
  execution_signals: ValueCategory[]; execution_frequency: number;
  confidence: Confidence; evidence: string;
}

/** Pure: per-company execution depth classification. */
export function classifyExecution(c: ValueCompany): ExecutionClassification {
  const base = { company_id: c.company_id, company_name: c.company_name };
  if (!c.read_ok) return { ...base, execution_score: 0, execution_status: 'UNKNOWN', execution_signals: [], execution_frequency: 0, confidence: 'UNKNOWN', evidence: 'execution sources unreadable' };
  const signals = VALUE_CATEGORIES.filter((cat) => (c.signals[cat] ?? 0) > 0);
  const freq = frequency(c);
  const b = signals.length;
  const execution_score = Math.round((b / VALUE_CATEGORIES.length) * 100);
  const execution_status: ExecutionStatus =
    freq === 0 ? 'NO_EXECUTION' :
    (freq >= SUSTAINED_VOLUME || b >= SUSTAINED_BREADTH) ? 'SUSTAINED_EXECUTION' :
    (freq >= REPEAT_VOLUME || b >= 2) ? 'ACTIVE_EXECUTION' : 'EARLY_EXECUTION';
  return { ...base, execution_score, execution_status, execution_signals: signals, execution_frequency: freq, confidence: 'HIGH', evidence: VALUE_CATEGORIES.map((k) => `${k}=${c.signals[k] ?? 0}`).join(', ') };
}

export interface StageReach { stage: ExecutionStage; reached: number; lost: number; conversion_pct: number | null; }
export interface ExecutionPattern { pattern: string; count: number; value_realized: number; value_rate: number | null; }
export interface VolumeBand { band: string; count: number }

export interface ExecutionAdoptionResult {
  total: number;
  funnel: StageReach[];
  by_status: Record<ExecutionStatus, number>;
  mean_execution_score: number | null;
  depth: {
    single_use: number; repeat: number; sustained: number;
    frequency_bands: VolumeBand[];
    content_volume_bands: VolumeBand[];
    campaign_volume_bands: VolumeBand[];
    report_volume_bands: VolumeBand[];
  };
  concentration: { total_volume: number; top1_share_pct: number | null; top3_share_pct: number | null; top_companies: Array<{ company_name: string; volume: number }> };
  patterns: { realized: ExecutionPattern[]; early: ExecutionPattern[]; no_value: ExecutionPattern[] };
  classifications: ExecutionClassification[];
  unknown_gaps: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const band = (n: number): string => (n === 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 20 ? '6-20' : '20+');
function bandStats(values: number[]): VolumeBand[] {
  const order = ['0', '1', '2-5', '6-20', '20+'];
  const m = new Map<string, number>(order.map((b) => [b, 0]));
  for (const v of values) m.set(band(v), (m.get(band(v)) ?? 0) + 1);
  return order.map((b) => ({ band: b, count: m.get(b) ?? 0 }));
}

/** Pure: full execution-adoption analysis. */
export function analyzeCampaignExecution(companies: ValueCompany[]): ExecutionAdoptionResult {
  const total = companies.length;
  const activated = companies.filter((c) => c.is_active).length;
  const has = (c: ValueCompany, cat: ValueCategory) => (c.signals[cat] ?? 0) > 0;

  const funnel: StageReach[] = [
    { stage: 'ACTIVATED', reached: activated, lost: 0, conversion_pct: pct(activated, total) },
    { stage: 'FIRST_CONTENT', reached: companies.filter((c) => has(c, 'CONTENT')).length, lost: 0, conversion_pct: null },
    { stage: 'FIRST_CAMPAIGN', reached: companies.filter((c) => has(c, 'CAMPAIGN')).length, lost: 0, conversion_pct: null },
    { stage: 'FIRST_PUBLICATION', reached: companies.filter((c) => has(c, 'PUBLISHING')).length, lost: 0, conversion_pct: null },
    { stage: 'REPEATED_EXECUTION', reached: companies.filter((c) => frequency(c) >= REPEAT_VOLUME).length, lost: 0, conversion_pct: null },
    { stage: 'SUSTAINED_EXECUTION', reached: companies.filter((c) => frequency(c) >= SUSTAINED_VOLUME || breadth(c) >= SUSTAINED_BREADTH).length, lost: 0, conversion_pct: null },
  ];
  for (const s of funnel) s.conversion_pct = pct(s.reached, total);

  const classifications = companies.map(classifyExecution);
  const by_status: Record<ExecutionStatus, number> = { NO_EXECUTION: 0, EARLY_EXECUTION: 0, ACTIVE_EXECUTION: 0, SUSTAINED_EXECUTION: 0, UNKNOWN: 0 };
  for (const c of classifications) by_status[c.execution_status] += 1;
  const scored = classifications.filter((c) => c.execution_status !== 'UNKNOWN');
  const mean_execution_score = scored.length ? Math.round((scored.reduce((a, c) => a + c.execution_score, 0) / scored.length) * 10) / 10 : null;

  const freqs = companies.map(frequency);
  const total_volume = freqs.reduce((a, b) => a + b, 0);
  const ranked = companies.map((c) => ({ company_name: c.company_name, volume: frequency(c) })).sort((a, b) => b.volume - a.volume || a.company_name.localeCompare(b.company_name));

  const sig = (c: ValueCompany) => VALUE_CATEGORIES.filter((cat) => has(c, cat)).join('+') || 'NONE';
  const patternStats = (bucket: ValueBucket): ExecutionPattern[] => {
    const subset = companies.filter((c) => valueBucketOf(c) === bucket);
    const m = new Map<string, { count: number; vr: number }>();
    for (const c of subset) { const k = sig(c); const e = m.get(k) ?? { count: 0, vr: 0 }; e.count += 1; if (breadth(c) >= 1) e.vr += 1; m.set(k, e); }
    return Array.from(m.entries()).map(([pattern, v]) => ({ pattern, count: v.count, value_realized: v.vr, value_rate: pct(v.vr, v.count) })).sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern)).slice(0, 5);
  };

  return {
    total, funnel, by_status, mean_execution_score,
    depth: {
      single_use: companies.filter((c) => frequency(c) === 1).length,
      repeat: companies.filter((c) => { const f = frequency(c); return f >= REPEAT_VOLUME && f < SUSTAINED_VOLUME; }).length,
      sustained: companies.filter((c) => frequency(c) >= SUSTAINED_VOLUME).length,
      frequency_bands: bandStats(freqs),
      content_volume_bands: bandStats(companies.map((c) => c.signals.CONTENT ?? 0)),
      campaign_volume_bands: bandStats(companies.map((c) => c.signals.CAMPAIGN ?? 0)),
      report_volume_bands: bandStats(companies.map((c) => c.signals.REPORTS ?? 0)),
    },
    concentration: {
      total_volume,
      top1_share_pct: pct(ranked[0]?.volume ?? 0, total_volume),
      top3_share_pct: pct(ranked.slice(0, 3).reduce((a, x) => a + x.volume, 0), total_volume),
      top_companies: ranked.filter((x) => x.volume > 0).slice(0, 5),
    },
    patterns: { realized: patternStats('REALIZED_VALUE'), early: patternStats('EARLY_VALUE'), no_value: patternStats('NO_VALUE') },
    classifications,
    unknown_gaps: [
      'engagement + community usage are organization_id-keyed → not company-attributable (excluded)',
      'execution frequency is lifetime volume (no per-period cadence) → SUSTAINED is volume/breadth proxy, not time-based recurrence',
      'value concentration is driven by a tiny active core (see top_companies)',
    ],
  };
}
