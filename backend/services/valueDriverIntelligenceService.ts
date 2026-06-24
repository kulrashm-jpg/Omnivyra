/**
 * valueDriverIntelligenceService.ts
 *
 * READ-ONLY, deterministic association analysis: which measurable behaviors are associated
 * with value-realizing companies. **ASSOCIATION IS NOT CAUSATION.** Pure functions over
 * already-computed readiness + value-realization data (no new DB reads). No writes.
 *
 * CRITICAL: the VALUE signals (content/campaign/publishing/reports/market-pulse) are
 * CONSTITUENTS of the value outcome — associating them with value is circular/definitional.
 * Only CAPABILITY signals (profile/domain/GA/.../billing/activated) are genuine candidate
 * drivers; value-constituent signals are computed but flagged `circular` and excluded from
 * driver ranking.
 */

export type CapabilitySignal = 'PROFILE_READY' | 'DOMAIN_VERIFIED' | 'GA_CONNECTED' | 'GSC_CONNECTED' | 'SOCIAL_CONNECTED' | 'TEAM_ESTABLISHED' | 'BILLING_ACTIVE' | 'ACTIVATED';
export type ValueSignal = 'CONTENT_CREATED' | 'CONTENT_PUBLISHED' | 'CAMPAIGN_CREATED' | 'REPORT_GENERATED' | 'MARKET_PULSE_USED';
export type AnySignal = CapabilitySignal | ValueSignal;
export type AssociationStrength = 'STRONG_ASSOCIATION' | 'MODERATE_ASSOCIATION' | 'WEAK_ASSOCIATION' | 'INSUFFICIENT_DATA' | 'UNKNOWN';
export type ValueBucket = 'NO_VALUE' | 'EARLY_VALUE' | 'REALIZED_VALUE';

export const CAPABILITY_SIGNALS: CapabilitySignal[] = ['PROFILE_READY', 'DOMAIN_VERIFIED', 'GA_CONNECTED', 'GSC_CONNECTED', 'SOCIAL_CONNECTED', 'TEAM_ESTABLISHED', 'BILLING_ACTIVE', 'ACTIVATED'];
export const VALUE_SIGNALS: ValueSignal[] = ['CONTENT_CREATED', 'CONTENT_PUBLISHED', 'CAMPAIGN_CREATED', 'REPORT_GENERATED', 'MARKET_PULSE_USED'];
const MIN_POP = 3; // below this either side → INSUFFICIENT_DATA

export interface DriverCompany {
  company_id: string; company_name: string;
  signals: Record<AnySignal, boolean>;
  value_category_count: number; // # of value categories present (the value outcome basis)
}

export const valueBucketOf = (count: number): ValueBucket => (count === 0 ? 'NO_VALUE' : count === 1 ? 'EARLY_VALUE' : 'REALIZED_VALUE');
const isValueRealizing = (c: DriverCompany) => c.value_category_count >= 1; // outcome: any measurable value

export interface DriverAssociation {
  signal: AnySignal; kind: 'CAPABILITY' | 'VALUE_CONSTITUENT'; circular: boolean;
  population_with: number; population_without: number;
  value_with: number; value_without: number;
  rate_with: number | null; rate_without: number | null;
  lift: number | null; support: number | null; delta: number | null;
  strength: AssociationStrength; evidence: string;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Pure: association of one signal with the value outcome. */
export function computeAssociation(signal: AnySignal, circular: boolean, companies: DriverCompany[]): DriverAssociation {
  const total = companies.length;
  const withS = companies.filter((c) => c.signals[signal]);
  const withoutS = companies.filter((c) => !c.signals[signal]);
  const value_with = withS.filter(isValueRealizing).length;
  const value_without = withoutS.filter(isValueRealizing).length;
  const rate_with = pct(value_with, withS.length);
  const rate_without = pct(value_without, withoutS.length);
  const lift = rate_with != null && rate_without != null && rate_without > 0 ? Math.round((rate_with / rate_without) * 100) / 100 : null;
  const delta = rate_with != null && rate_without != null ? Math.round((rate_with - rate_without) * 10) / 10 : null;
  const support = pct(withS.length, total);

  let strength: AssociationStrength;
  if (withS.length < MIN_POP || withoutS.length < MIN_POP) strength = 'INSUFFICIENT_DATA';
  else if (delta == null) strength = 'INSUFFICIENT_DATA';
  else if ((lift != null && lift >= 2 && delta >= 30) || (rate_without === 0 && delta >= 30)) strength = 'STRONG_ASSOCIATION';
  else if ((lift != null && lift >= 1.5 && delta >= 15) || (rate_without === 0 && delta >= 15)) strength = 'MODERATE_ASSOCIATION';
  else strength = 'WEAK_ASSOCIATION';

  return {
    signal, kind: circular ? 'VALUE_CONSTITUENT' : 'CAPABILITY', circular,
    population_with: withS.length, population_without: withoutS.length, value_with, value_without,
    rate_with, rate_without, lift, support, delta, strength,
    evidence: `with=${withS.length} (val ${value_with}), without=${withoutS.length} (val ${value_without})${circular ? ' [circular: constitutes outcome]' : ''}`,
  };
}

export interface DriverPath { path: string; count: number; value_realized: number; value_rate: number | null; }
export interface CapabilityGap { capability: CapabilitySignal; presence_realized: number | null; presence_no_value: number | null; delta: number | null; }

export interface ValueDriverResult {
  total: number; value_realizing: number;
  associations: DriverAssociation[]; // capability drivers, ranked
  value_constituents: DriverAssociation[]; // circular — reported separately, not ranked
  ranking: {
    top_positive: DriverAssociation[];
    neutral: DriverAssociation[];
    insufficient_data: AnySignal[];
    never_observed: AnySignal[];
    observed_never_with_value: AnySignal[];
  };
  paths: { realized: DriverPath[]; early: DriverPath[]; no_value: DriverPath[] };
  gap_comparison: { gaps: CapabilityGap[]; largest_gaps: CapabilityGap[]; smallest_gaps: CapabilityGap[]; shared_behaviors: CapabilitySignal[]; unique_to_realized: CapabilitySignal[] };
  unknown_gaps: string[];
}

const STRENGTH_RANK: Record<AssociationStrength, number> = { STRONG_ASSOCIATION: 4, MODERATE_ASSOCIATION: 3, WEAK_ASSOCIATION: 2, INSUFFICIENT_DATA: 1, UNKNOWN: 0 };

/** Pure: full value-driver analysis. */
export function analyzeValueDrivers(companies: DriverCompany[]): ValueDriverResult {
  const total = companies.length;
  const value_realizing = companies.filter(isValueRealizing).length;

  const associations = CAPABILITY_SIGNALS.map((s) => computeAssociation(s, false, companies))
    .sort((a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] || (b.delta ?? -999) - (a.delta ?? -999) || b.population_with - a.population_with || a.signal.localeCompare(b.signal));
  const value_constituents = VALUE_SIGNALS.map((s) => computeAssociation(s, true, companies));

  const observed = (s: AnySignal) => companies.some((c) => c.signals[s]);
  const ranking = {
    top_positive: associations.filter((a) => a.strength === 'STRONG_ASSOCIATION' || a.strength === 'MODERATE_ASSOCIATION'),
    neutral: associations.filter((a) => a.strength === 'WEAK_ASSOCIATION'),
    insufficient_data: associations.filter((a) => a.strength === 'INSUFFICIENT_DATA').map((a) => a.signal),
    never_observed: CAPABILITY_SIGNALS.filter((s) => !observed(s)),
    observed_never_with_value: CAPABILITY_SIGNALS.filter((s) => observed(s) && companies.filter((c) => c.signals[s]).every((c) => !isValueRealizing(c))),
  };

  // Paths = capability signature, grouped by value bucket.
  const capSig = (c: DriverCompany) => CAPABILITY_SIGNALS.filter((s) => c.signals[s]).join('+') || 'NONE';
  const pathStats = (bucket: ValueBucket): DriverPath[] => {
    const subset = companies.filter((c) => valueBucketOf(c.value_category_count) === bucket);
    const m = new Map<string, { count: number; vr: number }>();
    for (const c of subset) { const k = capSig(c); const e = m.get(k) ?? { count: 0, vr: 0 }; e.count += 1; if (isValueRealizing(c)) e.vr += 1; m.set(k, e); }
    return Array.from(m.entries()).map(([path, v]) => ({ path, count: v.count, value_realized: v.vr, value_rate: pct(v.vr, v.count) })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, 5);
  };

  // Gap comparison: REALIZED (≥2) vs NO_VALUE (0).
  const realized = companies.filter((c) => valueBucketOf(c.value_category_count) === 'REALIZED_VALUE');
  const noValue = companies.filter((c) => valueBucketOf(c.value_category_count) === 'NO_VALUE');
  const gaps: CapabilityGap[] = CAPABILITY_SIGNALS.map((capability) => {
    const pr = pct(realized.filter((c) => c.signals[capability]).length, realized.length);
    const pn = pct(noValue.filter((c) => c.signals[capability]).length, noValue.length);
    return { capability, presence_realized: pr, presence_no_value: pn, delta: pr != null && pn != null ? Math.round((pr - pn) * 10) / 10 : null };
  });
  const ranked = [...gaps].filter((g) => g.delta != null).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));

  return {
    total, value_realizing,
    associations, value_constituents, ranking,
    paths: { realized: pathStats('REALIZED_VALUE'), early: pathStats('EARLY_VALUE'), no_value: pathStats('NO_VALUE') },
    gap_comparison: {
      gaps,
      largest_gaps: ranked.slice(0, 3),
      smallest_gaps: ranked.slice(-3).reverse(),
      shared_behaviors: CAPABILITY_SIGNALS.filter((s) => realized.length > 0 && noValue.length > 0 && realized.every((c) => c.signals[s]) && noValue.some((c) => c.signals[s])),
      unique_to_realized: CAPABILITY_SIGNALS.filter((s) => realized.length > 0 && realized.every((c) => c.signals[s]) && noValue.every((c) => !c.signals[s])),
    },
    unknown_gaps: [
      'value-constituent signals are circular with the outcome — reported separately, excluded from driver ranking',
      'small populations (n ≤ 3) → INSUFFICIENT_DATA for most capabilities',
      'engagement/community value invisible (org-keyed, per 14E) — drivers of unseen value cannot be assessed',
    ],
  };
}

/** Build driver companies from readiness tenants + 14E value classifications (no new DB reads). */
export function buildDriverCompanies(
  tenants: Array<{ company_id: string; company_name: string; tenant_status: string; company_profile_ready: string; website_ready: string; ga_ready: string; gsc_ready: string; social_ready: string; team_ready: string; billing_ready: string }>,
  valueByCompany: Map<string, { value_signals: string[] }>,
): DriverCompany[] {
  return tenants.map((t) => {
    const vs = valueByCompany.get(t.company_id)?.value_signals ?? [];
    const has = (cat: string) => vs.includes(cat);
    return {
      company_id: t.company_id, company_name: t.company_name,
      value_category_count: vs.length,
      signals: {
        PROFILE_READY: t.company_profile_ready === 'READY', DOMAIN_VERIFIED: t.website_ready === 'READY',
        GA_CONNECTED: t.ga_ready === 'READY', GSC_CONNECTED: t.gsc_ready === 'READY', SOCIAL_CONNECTED: t.social_ready === 'READY',
        TEAM_ESTABLISHED: t.team_ready === 'READY', BILLING_ACTIVE: t.billing_ready === 'READY', ACTIVATED: t.tenant_status === 'ACTIVE',
        CONTENT_CREATED: has('CONTENT'), CONTENT_PUBLISHED: has('PUBLISHING'), CAMPAIGN_CREATED: has('CAMPAIGN'),
        REPORT_GENERATED: has('REPORTS'), MARKET_PULSE_USED: has('MARKET_PULSE'),
      },
    };
  });
}
