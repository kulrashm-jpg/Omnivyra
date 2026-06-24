/**
 * customerPopulationIntegrityService.ts
 *
 * READ-ONLY, deterministic classification of whether Customer Operations analytics reflect
 * real customer behavior or are distorted by INTERNAL / QA / TEST / DEMO tenants. Pure
 * functions, evidence-based rules only — NO fuzzy matching, NO AI, NO guessing. UNKNOWN
 * stays UNKNOWN. No writes, no side effects.
 *
 * Evidence hierarchy (first match wins): TEST > QA > DEMO > INTERNAL > CUSTOMER > UNKNOWN.
 */

export type TenantClass = 'CUSTOMER' | 'INTERNAL' | 'QA' | 'TEST' | 'DEMO' | 'UNKNOWN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

const VENDOR_DOMAINS = ['omnivyra.com'];
const PLACEHOLDER_DOMAINS = ['example.com', 'python.org', 'test.com', 'localhost', 'invalid'];

export interface TenantIdentity { company_id: string; company_name: string; website_domain: string | null; admin_email_domain: string | null; domain_verified: boolean; }
export interface TenantClassification { company_id: string; company_name: string; tenant_class: TenantClass; classification_confidence: Confidence; classification_evidence: string[]; }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const matchDomain = (d: string, list: string[]) => !!d && list.some((x) => d === x || d.endsWith('.' + x));

/** Pure, deterministic, evidence-based tenant classification. */
export function classifyTenant(t: TenantIdentity): TenantClassification {
  const name = norm(t.company_name);
  const wd = norm(t.website_domain);
  const aed = norm(t.admin_email_domain);
  const base = { company_id: t.company_id, company_name: t.company_name };
  const placeholder = matchDomain(wd, PLACEHOLDER_DOMAINS) || matchDomain(aed, PLACEHOLDER_DOMAINS);
  const vendor = matchDomain(wd, VENDOR_DOMAINS) || matchDomain(aed, VENDOR_DOMAINS);

  // 1. TEST — explicit test name OR placeholder domain (strongest non-customer signal).
  if (/\btest\b/.test(name) || /\bwrong tenant\b/.test(name) || placeholder) {
    const ev = [/\btest\b/.test(name) ? 'name contains "test"' : null, /\bwrong tenant\b/.test(name) ? 'name contains "wrong tenant"' : null, placeholder ? `placeholder domain (${wd || aed})` : null].filter(Boolean) as string[];
    return { ...base, tenant_class: 'TEST', classification_confidence: 'HIGH', classification_evidence: ev };
  }
  // 2. QA — explicit QA marker in name.
  if (/\bqa\b/.test(name)) return { ...base, tenant_class: 'QA', classification_confidence: 'HIGH', classification_evidence: [`name contains "QA": "${t.company_name}"`] };
  // 3. DEMO — explicit demo marker.
  if (/\bdemo\b/.test(name)) return { ...base, tenant_class: 'DEMO', classification_confidence: 'HIGH', classification_evidence: [`name contains "demo": "${t.company_name}"`] };
  // 4. INTERNAL — vendor's own domain.
  if (vendor) return { ...base, tenant_class: 'INTERNAL', classification_confidence: t.domain_verified ? 'HIGH' : 'MEDIUM', classification_evidence: [`vendor domain (${wd || aed})`, ...(t.domain_verified ? ['domain verified'] : [])] };
  // 5. CUSTOMER — real registrable domain (not placeholder/vendor), positive evidence required.
  if (wd && !placeholder && !vendor) {
    const confidence: Confidence = t.domain_verified ? 'HIGH' : (aed && aed === wd ? 'MEDIUM' : 'LOW');
    const ev = [`real registrable domain (${wd})`, ...(aed === wd ? ['admin email domain matches website'] : []), ...(t.domain_verified ? ['domain verified'] : ['domain not verified'])];
    return { ...base, tenant_class: 'CUSTOMER', classification_confidence: confidence, classification_evidence: ev };
  }
  // 6. UNKNOWN — no classifying evidence.
  return { ...base, tenant_class: 'UNKNOWN', classification_confidence: 'UNKNOWN', classification_evidence: ['no classifying signal (no real/placeholder/vendor domain, no test/qa/demo marker)'] };
}

export interface PopulationCompany extends TenantIdentity {
  metrics: { readiness_score: number; is_active: boolean; profile_ready: boolean; adoption_score: number; has_value: boolean; execution_volume: number; is_paying: boolean; paying_with_value: boolean };
}

const TENANT_CLASSES: TenantClass[] = ['CUSTOMER', 'INTERNAL', 'QA', 'TEST', 'DEMO', 'UNKNOWN'];
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const mean = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

type DomainMetric = { domain: string; metric: string; fn: (cs: PopulationCompany[]) => number | null };
const DOMAIN_METRICS: DomainMetric[] = [
  { domain: 'READINESS', metric: 'mean readiness score', fn: (cs) => mean(cs.map((c) => c.metrics.readiness_score)) },
  { domain: 'ACTIVATION', metric: '% active', fn: (cs) => pct(cs.filter((c) => c.metrics.is_active).length, cs.length) },
  { domain: 'PROFILE_COMPLETION', metric: '% profile ready', fn: (cs) => pct(cs.filter((c) => c.metrics.profile_ready).length, cs.length) },
  { domain: 'DIGITAL_ADOPTION', metric: 'mean adoption score', fn: (cs) => mean(cs.map((c) => c.metrics.adoption_score)) },
  { domain: 'VALUE_REALIZATION', metric: '% value-realizing', fn: (cs) => pct(cs.filter((c) => c.metrics.has_value).length, cs.length) },
  { domain: 'VALUE_DRIVERS', metric: '% active-with-value', fn: (cs) => pct(cs.filter((c) => c.metrics.is_active && c.metrics.has_value).length, cs.length) },
  { domain: 'EXECUTION_ADOPTION', metric: 'total execution volume', fn: (cs) => cs.reduce((a, c) => a + c.metrics.execution_volume, 0) },
  { domain: 'MONETIZATION', metric: '% paying-with-value', fn: (cs) => pct(cs.filter((c) => c.metrics.paying_with_value).length, cs.length) },
];

export interface ContaminationRow { domain: string; metric: string; all: number | null; customer_only: number | null; internal_only: number | null; qa_only: number | null; test_only: number | null; demo_only: number | null; delta_all_vs_customer: number | null; }
export interface ConfidenceImpactRow { metric: string; confidence_before: number | null; confidence_after: number | null; confidence_delta: number | null; customer_n: number; note: string; }

export interface PopulationIntegrityResult {
  per_company: TenantClassification[];
  portfolio_summary: {
    total_companies: number;
    counts: Record<TenantClass, number>;
    ratios: Record<TenantClass, number | null>;
    population_purity_score: number | null; // customer / total × 100
  };
  contamination: ContaminationRow[];
  confidence_impact: ConfidenceImpactRow[];
  unknown_gaps: string[];
}

/** Pure: full population-integrity analysis. */
export function analyzePopulationIntegrity(companies: PopulationCompany[]): PopulationIntegrityResult {
  const total = companies.length;
  const classOf = new Map<string, TenantClass>();
  const per_company = companies.map((c) => { const cl = classifyTenant(c); classOf.set(c.company_id, cl.tenant_class); return cl; });
  const subset = (cls: TenantClass) => companies.filter((c) => classOf.get(c.company_id) === cls);

  const counts = Object.fromEntries(TENANT_CLASSES.map((cl) => [cl, subset(cl).length])) as Record<TenantClass, number>;
  const ratios = Object.fromEntries(TENANT_CLASSES.map((cl) => [cl, pct(counts[cl], total)])) as Record<TenantClass, number | null>;

  const customerOnly = subset('CUSTOMER');
  const contamination: ContaminationRow[] = DOMAIN_METRICS.map((d) => ({
    domain: d.domain, metric: d.metric,
    all: d.fn(companies), customer_only: d.fn(customerOnly),
    internal_only: d.fn(subset('INTERNAL')), qa_only: d.fn(subset('QA')), test_only: d.fn(subset('TEST')), demo_only: d.fn(subset('DEMO')),
    delta_all_vs_customer: d.fn(companies) != null && d.fn(customerOnly) != null ? Math.round((d.fn(companies)! - d.fn(customerOnly)!) * 10) / 10 : null,
  }));

  // Confidence impact: metric on ALL vs after removing INTERNAL/QA/TEST/DEMO (keep CUSTOMER+UNKNOWN).
  const afterRemoval = companies.filter((c) => { const cl = classOf.get(c.company_id); return cl === 'CUSTOMER' || cl === 'UNKNOWN'; });
  const impactMetrics = DOMAIN_METRICS.filter((d) => ['ACTIVATION', 'VALUE_REALIZATION', 'EXECUTION_ADOPTION', 'MONETIZATION'].includes(d.domain));
  const confidence_impact: ConfidenceImpactRow[] = impactMetrics.map((d) => {
    const before = d.fn(companies), after = d.fn(afterRemoval);
    return { metric: `${d.domain} (${d.metric})`, confidence_before: before, confidence_after: after, confidence_delta: before != null && after != null ? Math.round((before - after) * 10) / 10 : null, customer_n: afterRemoval.length, note: afterRemoval.length < 5 ? 'customer population too small for confident inference' : 'small population — interpret with care' };
  });

  return {
    per_company,
    portfolio_summary: { total_companies: total, counts, ratios, population_purity_score: pct(counts.CUSTOMER, total) },
    contamination, confidence_impact,
    unknown_gaps: [
      'classification uses observable name/domain/verification signals only — no CRM ground truth',
      'CUSTOMER without domain verification is MEDIUM confidence (real domain + matching email, but unverified)',
      'metrics on the customer-only subset (n = small) carry low statistical confidence regardless of contamination',
    ],
  };
}

/** Build population companies from readiness tenants + identity + value-signal volume (no new DB reads). */
export function buildPopulationCompanies(
  tenants: Array<{ company_id: string; company_name: string; tenant_status: string; company_profile_ready: string; overall_readiness_score: number; billing_ready: string }>,
  identityBy: Map<string, { website_domain: string | null; admin_email_domain: string | null; domain_verified: boolean }>,
  adoptionBy: Map<string, number>,
  valueBy: Map<string, { has_value: boolean; volume: number }>,
): PopulationCompany[] {
  return tenants.map((t) => {
    const id = identityBy.get(t.company_id);
    const v = valueBy.get(t.company_id);
    return {
      company_id: t.company_id, company_name: t.company_name,
      website_domain: id?.website_domain ?? null, admin_email_domain: id?.admin_email_domain ?? null, domain_verified: id?.domain_verified ?? false,
      metrics: {
        readiness_score: t.overall_readiness_score, is_active: t.tenant_status === 'ACTIVE', profile_ready: t.company_profile_ready === 'READY',
        adoption_score: adoptionBy.get(t.company_id) ?? 0, has_value: v?.has_value ?? false, execution_volume: v?.volume ?? 0,
        is_paying: t.billing_ready === 'READY', paying_with_value: t.billing_ready === 'READY' && (v?.has_value ?? false),
      },
    };
  });
}
