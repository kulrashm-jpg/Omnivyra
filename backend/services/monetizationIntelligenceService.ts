/**
 * monetizationIntelligenceService.ts
 *
 * READ-ONLY, deterministic intelligence on how monetization aligns (or fails to) with
 * activation, execution, and value realization. Pure functions over already-loaded data
 * (no new DB reads). Evidence-only, no inference, no causality, no writes, no billing actions.
 *
 * IMPORTANT: actual REVENUE (per-company amounts) is NOT available — plan assignments are
 * empty and credits are org-keyed. Revenue/credit concentration is reported as UNKNOWN and
 * NEVER estimated. Only the paying flag (billing readiness), plan NAME, and activity VOLUME
 * are observable.
 */

export type MonetizationStatus =
  | 'PAYING_ACTIVE_VALUE' | 'PAYING_ACTIVE_NO_VALUE' | 'PAYING_INACTIVE'
  | 'FREE_ACTIVE_VALUE' | 'FREE_ACTIVE_NO_VALUE' | 'FREE_INACTIVE' | 'UNKNOWN';
export type MonetizationStage = 'COMPANY_CREATED' | 'BILLING_ACTIVE' | 'ACTIVATED' | 'EXECUTING' | 'VALUE_REALIZED';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface MonetizationCompany {
  company_id: string; company_name: string; plan: string;
  is_paying: boolean; is_active: boolean; has_value: boolean; is_executing: boolean;
  activity_volume: number; read_ok: boolean;
}

export interface MonetizationClassification {
  company_id: string; company_name: string;
  monetization_status: MonetizationStatus;
  billing_status: 'PAYING' | 'FREE'; activation_status: 'ACTIVE' | 'INACTIVE';
  value_status: 'VALUE' | 'NO_VALUE'; execution_status: 'EXECUTING' | 'NO_EXECUTION';
  confidence: Confidence; evidence: string;
}

/** Pure: per-company monetization classification. */
export function classifyMonetization(c: MonetizationCompany): MonetizationClassification {
  const base = { company_id: c.company_id, company_name: c.company_name };
  if (!c.read_ok) return { ...base, monetization_status: 'UNKNOWN', billing_status: 'FREE', activation_status: 'INACTIVE', value_status: 'NO_VALUE', execution_status: 'NO_EXECUTION', confidence: 'UNKNOWN', evidence: 'sources unreadable' };
  const status: MonetizationStatus =
    c.is_paying && c.is_active && c.has_value ? 'PAYING_ACTIVE_VALUE' :
    c.is_paying && c.is_active && !c.has_value ? 'PAYING_ACTIVE_NO_VALUE' :
    c.is_paying && !c.is_active ? 'PAYING_INACTIVE' :
    !c.is_paying && c.is_active && c.has_value ? 'FREE_ACTIVE_VALUE' :
    !c.is_paying && c.is_active && !c.has_value ? 'FREE_ACTIVE_NO_VALUE' : 'FREE_INACTIVE';
  return {
    ...base, monetization_status: status,
    billing_status: c.is_paying ? 'PAYING' : 'FREE', activation_status: c.is_active ? 'ACTIVE' : 'INACTIVE',
    value_status: c.has_value ? 'VALUE' : 'NO_VALUE', execution_status: c.is_executing ? 'EXECUTING' : 'NO_EXECUTION',
    confidence: 'HIGH', evidence: `plan=${c.plan}; paying=${c.is_paying}; active=${c.is_active}; value=${c.has_value}; volume=${c.activity_volume}`,
  };
}

export interface StageReach { stage: MonetizationStage; reached: number; lost: number; conversion_pct: number | null; }
export interface Cohort { cohort: string; count: number; pct: number | null }
export interface Concentration { metric: string; available: boolean; total: number | null; top1_pct: number | null; top3_pct: number | null; top5_pct: number | null; note?: string }

export interface MonetizationResult {
  total: number;
  funnel: StageReach[];
  by_status: Record<MonetizationStatus, number>;
  revenue_alignment: Cohort[];
  billing_value_alignment: { aligned: number; misaligned: number; alignment_pct: number | null; misalignment_pct: number | null; cohorts: Cohort[]; largest_cohort: Cohort | null };
  concentration: { revenue: Concentration; credits: Concentration; plan: Concentration; value: Concentration; execution: Concentration };
  classifications: MonetizationClassification[];
  unknown_gaps: string[];
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function shareConcentration(metric: string, volumes: number[]): Concentration {
  const total = volumes.reduce((a, b) => a + b, 0);
  const sorted = [...volumes].sort((a, b) => b - a);
  const topN = (n: number) => sorted.slice(0, n).reduce((a, b) => a + b, 0);
  return { metric, available: true, total, top1_pct: pct(topN(1), total), top3_pct: pct(topN(3), total), top5_pct: pct(topN(5), total) };
}

/** Pure: full monetization analysis. */
export function analyzeMonetization(companies: MonetizationCompany[]): MonetizationResult {
  const total = companies.length;
  const paying = companies.filter((c) => c.is_paying);
  const funnel: StageReach[] = [
    { stage: 'COMPANY_CREATED', reached: total, lost: 0, conversion_pct: 100 },
    { stage: 'BILLING_ACTIVE', reached: paying.length, lost: 0, conversion_pct: pct(paying.length, total) },
    { stage: 'ACTIVATED', reached: companies.filter((c) => c.is_active).length, lost: 0, conversion_pct: null },
    { stage: 'EXECUTING', reached: companies.filter((c) => c.is_executing).length, lost: 0, conversion_pct: null },
    { stage: 'VALUE_REALIZED', reached: companies.filter((c) => c.has_value).length, lost: 0, conversion_pct: null },
  ];
  for (let i = 1; i < funnel.length; i++) { funnel[i].lost = funnel[i - 1].reached - funnel[i].reached; funnel[i].conversion_pct = pct(funnel[i].reached, total); }

  const classifications = companies.map(classifyMonetization);
  const by_status: Record<MonetizationStatus, number> = { PAYING_ACTIVE_VALUE: 0, PAYING_ACTIVE_NO_VALUE: 0, PAYING_INACTIVE: 0, FREE_ACTIVE_VALUE: 0, FREE_ACTIVE_NO_VALUE: 0, FREE_INACTIVE: 0, UNKNOWN: 0 };
  for (const c of classifications) by_status[c.monetization_status] += 1;

  const cohort = (name: string, n: number): Cohort => ({ cohort: name, count: n, pct: pct(n, total) });
  const revenue_alignment: Cohort[] = [
    cohort('paying', paying.length),
    cohort('paying_active', companies.filter((c) => c.is_paying && c.is_active).length),
    cohort('paying_executing', companies.filter((c) => c.is_paying && c.is_executing).length),
    cohort('paying_value', companies.filter((c) => c.is_paying && c.has_value).length),
    cohort('paying_no_value', companies.filter((c) => c.is_paying && !c.has_value).length),
    cohort('free_value', companies.filter((c) => !c.is_paying && c.has_value).length),
  ];

  const bv = {
    billing_value: companies.filter((c) => c.is_paying && c.has_value).length,
    billing_no_value: companies.filter((c) => c.is_paying && !c.has_value).length,
    value_no_billing: companies.filter((c) => !c.is_paying && c.has_value).length,
    none: companies.filter((c) => !c.is_paying && !c.has_value).length,
  };
  const aligned = bv.billing_value + bv.none; // billing↔value agree (both present or both absent)
  const misaligned = bv.billing_no_value + bv.value_no_billing;
  const bvCohorts: Cohort[] = [
    cohort('billing+value (aligned)', bv.billing_value),
    cohort('billing+no_value (misaligned)', bv.billing_no_value),
    cohort('value+no_billing (misaligned)', bv.value_no_billing),
    cohort('no_billing+no_value (aligned)', bv.none),
  ].sort((a, b) => b.count - a.count);

  // Plan concentration = company-count share by plan name (NOT revenue).
  const planVolumes = Array.from(companies.reduce((m, c) => m.set(c.plan, (m.get(c.plan) ?? 0) + 1), new Map<string, number>()).values());

  return {
    total, funnel, by_status, revenue_alignment,
    billing_value_alignment: { aligned, misaligned, alignment_pct: pct(aligned, total), misalignment_pct: pct(misaligned, total), cohorts: bvCohorts, largest_cohort: bvCohorts[0] ?? null },
    concentration: {
      revenue: { metric: 'revenue', available: false, total: null, top1_pct: null, top3_pct: null, top5_pct: null, note: 'UNKNOWN — no per-company revenue amount (plan assignments empty; never estimated)' },
      credits: { metric: 'credits', available: false, total: null, top1_pct: null, top3_pct: null, top5_pct: null, note: 'UNKNOWN — organization_credits is org-keyed, not company-attributable' },
      plan: { ...shareConcentration('plan (company-count share by plan name)', planVolumes), note: 'company-count share, NOT revenue' },
      value: shareConcentration('value (activity volume)', companies.map((c) => (c.has_value ? c.activity_volume : 0))),
      execution: shareConcentration('execution (activity volume)', companies.map((c) => c.activity_volume)),
    },
    classifications,
    unknown_gaps: [
      'actual revenue is UNKNOWN (no per-company payment amount) — never estimated',
      'credits are organization_id-keyed → not company-attributable',
      'execution/value volume is dominated by the vendor org + QA (per 14G) — distribution is not customer-representative',
    ],
  };
}

/** Build monetization companies from readiness tenants + value-signal counts (no new DB reads). */
export function buildMonetizationCompanies(
  tenants: Array<{ company_id: string; company_name: string; plan: string; tenant_status: string; billing_ready: string }>,
  valueByCompany: Map<string, { value_present: boolean; volume: number }>,
): MonetizationCompany[] {
  return tenants.map((t) => {
    const v = valueByCompany.get(t.company_id);
    return {
      company_id: t.company_id, company_name: t.company_name, plan: t.plan,
      is_paying: t.billing_ready === 'READY', is_active: t.tenant_status === 'ACTIVE',
      has_value: v?.value_present ?? false, is_executing: (v?.volume ?? 0) > 0, activity_volume: v?.volume ?? 0, read_ok: true,
    };
  });
}
