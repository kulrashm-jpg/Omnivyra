/**
 * GAP-01 — the canonical Report 1 output contract.
 *
 * The audit established that `composeSnapshotReport` produced the Report 1 decision layer
 * (`digital_snapshot`), the Phase 4 website evidence (`digital_experience`), the Phase 2
 * coverage lift (`evidence_coverage`) and the Phase 3 competition views (`competitive_tables`),
 * persisted all of them verbatim in `reports.data.composed_report` — and then dropped every one
 * of them, because `ComposedReportData` did not declare them and the export payload had no slot.
 *
 * These tests hold that chain open. They exercise the REAL producers end to end:
 *
 *   composeSnapshotReportFromDecisions  (real report + real CanonicalReport)
 *     → assembleDigitalSnapshot         (real opportunity engine)
 *       → mapComposedReport             (the contract under repair)
 *         → renderCanonicalReportHtml   (the customer-facing document)
 *
 * Nothing is hand-mocked except the assembler's INPUTS, which stand in for a crawl this unit
 * test does not perform. Every opportunity, priority, plan item, score and evidence state
 * asserted below is computed by production code.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { attachProgressComparison } from '../../../pages/api/reports/reportComparisonAttachment';
import { sanitizeReportViewPayload } from '../../services/reportContentSanitizationService';
import { assembleDigitalSnapshot, type AssemblyInput } from '../../services/digitalSnapshotAssembly';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import { renderCanonicalReportHtml } from '../../services/export/canonicalReportPipeline';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(120_000);

function makeResolvedInput(): ResolvedReportInput {
  return {
    companyId: 'company-gap01',
    reportCategory: 'snapshot',
    profile: null,
    requestPayload: {},
    defaults: {
      company_name: null,
      website_domain: null,
      business_type: null,
      geography: null,
      social_links: [],
      competitors: [],
    },
    resolved: {
      companyName: 'Northwind Analytics',
      websiteDomain: 'northwind-analytics.test',
      businessType: null,
      geography: null,
      socialLinks: [],
      competitors: [],
      source: 'manual-entry',
      uploadedFileName: null,
      manualData: null,
      companyContext: {
        marketFocus: null,
        productServices: [],
        targetCustomer: null,
        idealCustomerProfile: null,
        brandPositioning: null,
        competitiveAdvantages: null,
        teamSize: null,
        foundedYear: null,
        revenueRange: null,
      },
    },
    integrations: {
      google_analytics: { connected: false, source: 'system', label: 'Google Analytics' },
      google_search_console: { connected: false, source: 'system', label: 'Google Search Console' },
      google_ads: { connected: false, source: 'system', label: 'Google Ads' },
      linkedin_ads: { connected: false, source: 'system', label: 'LinkedIn Ads' },
      meta_ads: { connected: false, source: 'system', label: 'Meta Ads' },
      shopify: { connected: false, source: 'system', label: 'Shopify' },
      woocommerce: { connected: false, source: 'system', label: 'WooCommerce' },
      social_accounts: { connected: false, source: 'system', label: 'Social Accounts' },
      wordpress: { connected: false, source: 'system', label: 'WordPress' },
      custom_blog_api: { connected: false, source: 'system', label: 'Custom Blog API' },
      lead_webhook: { connected: false, source: 'system', label: 'Lead Webhook' },
      website_crawl: { connected: true, source: 'system', label: 'Website Crawl' },
      data_upload: { connected: false, source: 'system', label: 'Uploaded Data File' },
      manual_entry: { connected: false, source: 'system', label: 'Manual Data Entry' },
    },
  };
}

/**
 * Assembler inputs standing in for a crawl. These are the SHAPES `composeSnapshotReport` hands
 * the assembler in production (`digitalExperience.findings`, engine scores, competitive tables,
 * dimension states) — the values are a fixture, the assembly logic is production code.
 *
 * Deliberately mixed evidence: `searchVisibility` is unmeasured so the contradiction guard has
 * something to act on, and the competitive rule's measurement is genuinely unavailable so
 * `measurementAvailable: false` is exercised rather than assumed.
 */
const EXPERIENCE_FINDINGS = [
  {
    pillar: 'information_accessibility',
    problem: 'Pages return errors',
    evidence: '3 of 15 crawled pages returned 4xx/5xx (e.g. https://northwind-analytics.test/pricing → 404)',
    whyItMatters: 'Pages that error waste the discovery already earned.',
    action: 'Restore or redirect the erroring URLs.',
    severity: 'critical',
    effort: 'low',
    measurement: 'Re-crawl and confirm those URLs return HTTP 200 or a single 301 to a working page.',
  },
  {
    pillar: 'value_communication',
    problem: 'Pages carry too little content to explain the offering',
    evidence: '6 of 15 pages have under 150 words (e.g. https://northwind-analytics.test/solutions)',
    whyItMatters: 'Thin pages give a buyer nothing to act on.',
    action: 'Expand the thin pages that map to a commercial offering.',
    severity: 'moderate',
    effort: 'medium',
    measurement: 'Re-crawl and confirm the prioritised pages exceed 150 words.',
  },
  {
    pillar: 'value_communication',
    problem: 'Pages are missing a title or meta description',
    evidence: '5 of 15 pages lack a title or meta description',
    whyItMatters: 'These are the words a person reads before deciding whether to click.',
    action: 'Write a distinct title and description for every indexable page.',
    severity: 'moderate',
    effort: 'low',
    measurement: 'Re-crawl and confirm every indexable page has both.',
  },
  {
    pillar: 'conversion_readiness',
    problem: 'Most pages offer no clear next step',
    evidence: 'Only 4 of 15 pages expose a call to action',
    whyItMatters: 'A visitor who understands the offer still cannot act on it.',
    action: 'Add a primary call to action to every commercially relevant page.',
    severity: 'moderate',
    effort: 'low',
    measurement: 'Re-crawl and confirm CTA coverage above 50% of pages.',
  },
] as const;

const COMPETITIVE_TABLES: NonNullable<SnapshotReport['competitive_tables']> = {
  productCompetition: [
    {
      competitor: 'Contoso Insight',
      domain: 'contoso-insight.test',
      productOverlap: 72,
      problemUseCaseOverlap: 68,
      evidence: ['Both publish self-serve dashboards for mid-market operations teams.'],
      classification: 'direct',
      confidence: 'medium',
      state: 'measured',
    },
  ],
  marketCompetition: [
    {
      competitor: 'Contoso Insight',
      domain: 'contoso-insight.test',
      customerIcp: 'Mid-market operations',
      segment: 'mid_market',
      geography: null,
      marketOverlap: 64,
      evidence: ['Same buyer persona named on both pricing pages.'],
      classification: 'same_segment',
      confidence: 'medium',
      state: 'measured',
    },
  ],
  unclassified: [
    { competitor: 'Fabrikam Data', domain: 'fabrikam-data.test', reason: 'Both axes abstained — insufficient public evidence to classify.', signalCount: 1 },
  ],
  summary: { direct: 1, adjacent: 0, substitute: 0, strategic: 0, not_competitive: 0, unclassified: 1 },
  empty: false,
  emptyReason: null,
};

const ASSEMBLY_INPUT: AssemblyInput = {
  experienceFindings: EXPERIENCE_FINDINGS as unknown as AssemblyInput['experienceFindings'],
  dimensionStates: {
    // Deliberately unmeasured: exercises the contradiction guard and the honest limitation.
    searchVisibility: 'unavailable',
    aiVisibility: 'measured',
    performance: 'unavailable',
    content: 'measured',
    technical: 'measured',
    competitive: 'measured',
  },
  contentSignals: { score: 41, weaknesses: ['Thin product pages'] },
  technicalSignals: { score: 58, criticalIssues: ['3 pages return 4xx'] },
  competitive: { productCompetition: COMPETITIVE_TABLES.productCompetition, empty: false },
  coverage: { coverage_percentage: 50, website_scanned: true },
  positioning: { hasCategory: true, hasOffering: true },
};

const DIGITAL_EXPERIENCE: NonNullable<SnapshotReport['digital_experience']> = {
  readiness: 'needs_work',
  state: 'measured',
  coverage: { pagesEvaluated: 15, signalsEvaluated: 9, signalsTotal: 11 },
  pillars: [
    {
      pillar: 'information_accessibility',
      label: 'Information accessibility',
      readiness: 'needs_work',
      state: 'measured',
      coverage: { evaluated: 3, total: 3 },
      findings: [EXPERIENCE_FINDINGS[0]] as unknown as NonNullable<SnapshotReport['digital_experience']>['findings'],
    },
    {
      pillar: 'technical_friction',
      label: 'Technical friction',
      readiness: 'insufficient_evidence',
      state: 'unavailable',
      coverage: { evaluated: 0, total: 2 },
      findings: [],
    },
  ],
  findings: EXPERIENCE_FINDINGS as unknown as NonNullable<SnapshotReport['digital_experience']>['findings'],
  limitations: [
    { kind: 'performance_unavailable', message: 'PageSpeed Insights is not enabled for this environment, so load-experience friction could not be measured.', affects: ['technical_friction'] },
  ],
  describesVisitorBehavior: false,
};

let baseReport: SnapshotReport;
let composed: ComposedReportData;
let digitalSnapshot: NonNullable<SnapshotReport['digital_snapshot']>;

beforeAll(async () => {
  // A REAL report, including a real CanonicalReport built by the canonical builder.
  baseReport = await composeSnapshotReportFromDecisions({
    companyId: 'company-gap01',
    snapshotDecisions: [],
    supplementalGrowthDecisions: [],
    resolvedInput: makeResolvedInput(),
  });

  // The REAL opportunity engine over the fixture inputs above.
  digitalSnapshot = assembleDigitalSnapshot(ASSEMBLY_INPUT) as NonNullable<SnapshotReport['digital_snapshot']>;

  // The stored `composed_report` shape: exactly what `composeSnapshotReport` returns, with the
  // Report 1 surfaces attached the way the composer attaches them.
  composed = {
    ...(baseReport as unknown as ComposedReportData),
    digital_snapshot: digitalSnapshot,
    digital_experience: DIGITAL_EXPERIENCE,
    competitive_tables: COMPETITIVE_TABLES,
  };
});

function map() {
  const payload = mapComposedReport(
    composed,
    'snapshot',
    'report-gap01',
    'company-gap01',
    'northwind-analytics.test',
    'Sep 5, 2026',
    '2026-09-05T00:00:00.000Z',
    false,
    'v2',
  );
  if (!payload) throw new Error('mapComposedReport returned null — the fixture has no sections');
  return payload;
}

describe('GAP-01 · the opportunity engine actually produced something to carry', () => {
  it('assembles cross-source opportunities, priorities and a plan from the fixture evidence', () => {
    expect(digitalSnapshot.empty).toBe(false);
    expect(digitalSnapshot.opportunities.length).toBeGreaterThan(0);
    expect(digitalSnapshot.topPriorities.length).toBeGreaterThan(0);
    expect(digitalSnapshot.topPriorities.length).toBeLessThanOrEqual(5);
    // Guard the premise of every render assertion below: if the assembler stops producing a
    // measurement-unavailable opportunity, the integrity test that depends on it is vacuous.
    expect(digitalSnapshot.opportunities.some((o) => o.measurementAvailable === false)).toBe(true);
    expect(digitalSnapshot.unmeasuredDimensions).toContain('searchVisibility');
  });
});

describe('GAP-01 · contract — the composed report carries the canonical Report 1 surfaces', () => {
  it('maps canonical without an unsafe cast', () => {
    expect(map().canonical).not.toBeNull();
    expect(map().canonical?.authority_overview).toBeDefined();
  });

  it('maps digital_snapshot through unchanged', () => {
    // Deep equality is the assertion that matters: the mapper is pass-through, so ANY
    // difference here means something re-derived, re-ranked or truncated the decision layer.
    expect(map().digitalSnapshot).toEqual(digitalSnapshot);
  });

  it('maps evidence_coverage through unchanged', () => {
    expect(map().evidenceCoverage).toEqual(baseReport.evidence_coverage ?? null);
  });

  it('maps digital_experience through unchanged', () => {
    expect(map().digitalExperience).toEqual(DIGITAL_EXPERIENCE);
  });

  it('maps competitive_tables through unchanged', () => {
    expect(map().competitiveTables).toEqual(COMPETITIVE_TABLES);
  });

  it('maps performance through unchanged', () => {
    expect(map().performanceEvidence).toEqual(baseReport.performance ?? null);
  });

  it('reads the score state from the producer rather than inferring it', () => {
    expect(map().overallScoreState).toBe(baseReport.score.state);
  });

  it('yields null — never an empty object — for a legacy report that never produced these surfaces', () => {
    const legacy: ComposedReportData = { ...composed };
    delete legacy.digital_snapshot;
    delete legacy.digital_experience;
    delete legacy.competitive_tables;
    delete legacy.evidence_coverage;
    delete legacy.performance;
    const payload = mapComposedReport(legacy, 'snapshot', 'r', 'c', 'd', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2');
    expect(payload).not.toBeNull();
    expect(payload!.digitalSnapshot).toBeNull();
    expect(payload!.digitalExperience).toBeNull();
    expect(payload!.competitiveTables).toBeNull();
    expect(payload!.evidenceCoverage).toBeNull();
    expect(payload!.performanceEvidence).toBeNull();
  });
});

describe('GAP-01 · customer output — the intelligence reaches the rendered document', () => {
  let html: string;
  beforeAll(() => { html = renderCanonicalReportHtml(map()); });

  it('renders the Top Priorities section', () => {
    expect(html).toContain('Top Priorities');
    expect(html).toContain(digitalSnapshot.topPriorities[0].title);
  });

  it('renders every assembled opportunity, not a truncated sample', () => {
    expect(html).toContain('Opportunities');
    for (const opportunity of digitalSnapshot.opportunities) {
      expect(html).toContain(opportunity.title);
      expect(html).toContain(opportunity.action);
    }
  });

  it('renders the 30/60/90 plan with all three horizons', () => {
    expect(html).toContain('The Next 90 Days');
    expect(html).toContain('Days 0–30');
    expect(html).toContain('Days 31–60');
    expect(html).toContain('Days 61–90');
  });

  it('renders the page-level website evidence, including the actual failing URL', () => {
    expect(html).toContain('Website Evidence');
    expect(html).toContain('https://northwind-analytics.test/pricing');
    expect(html).toContain('Only 4 of 15 pages expose a call to action');
  });

  it('renders both competition axes separately and never merges them', () => {
    expect(html).toContain('Product competition');
    expect(html).toContain('Market competition');
    expect(html).toContain('Contoso Insight');
  });

  it('lists an unclassifiable competitor as unclassified rather than promoting it', () => {
    expect(html).toContain('Fabrikam Data');
    expect(html).toContain('Both axes abstained');
  });
});

describe('GAP-01 · evidence integrity survives the mapping and the render', () => {
  let html: string;
  beforeAll(() => { html = renderCanonicalReportHtml(map()); });

  it('keeps every opportunity evidence statement attached to its claim', () => {
    for (const opportunity of digitalSnapshot.opportunities) {
      for (const evidence of opportunity.evidence) {
        expect(html).toContain(evidence.statement);
      }
    }
  });

  it('renders unavailable evidence as unobservable — never silently upgraded', () => {
    const unavailable = digitalSnapshot.opportunities
      .flatMap((o) => o.evidence)
      .filter((e) => e.state === 'unavailable');
    expect(unavailable.length).toBeGreaterThan(0);
    for (const evidence of unavailable) {
      expect(html).toContain(evidence.statement);
    }
    expect(html).toContain('Not observable');
  });

  it('states explicitly when an outcome cannot be verified from public evidence', () => {
    expect(html).toContain('Outcome not currently verifiable from public evidence');
  });

  it('preserves the contradiction guard — no opportunity rests only on unmeasured evidence', () => {
    for (const opportunity of digitalSnapshot.opportunities) {
      expect(opportunity.evidence.some((e) => e.state === 'measured' || e.state === 'inferred')).toBe(true);
    }
  });

  it('names the dimensions that could not be measured rather than assuming them weak', () => {
    expect(html).toContain('absent from the plan rather than assumed weak');
    expect(html).toContain('searchVisibility');
  });

  it('renders the crawl limitation the assessor stated instead of implying full coverage', () => {
    expect(html).toContain('PageSpeed Insights is not enabled for this environment');
  });

  it('represents an empty horizon with the assembler\'s own note and no invented filler', () => {
    const emptyHorizon = assembleDigitalSnapshot({
      ...ASSEMBLY_INPUT,
      // Only a high-effort competitive item survives → 0-30 and 31-60 are genuinely empty.
      experienceFindings: null,
      contentSignals: null,
      technicalSignals: null,
    });
    expect(emptyHorizon.plan.days_0_30).toHaveLength(0);
    expect(emptyHorizon.plan.notes.some((n) => n.includes('deliberately left empty'))).toBe(true);

    const emptyHtml = renderCanonicalReportHtml(
      mapComposedReport(
        { ...composed, digital_snapshot: emptyHorizon as NonNullable<SnapshotReport['digital_snapshot']> },
        'snapshot', 'r', 'c', 'd', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
      )!,
    );
    expect(emptyHtml).toContain('deliberately left empty');
    expect(emptyHtml).toContain('left empty deliberately');
  });
});

/**
 * The full customer path, in the order `pages/api/reports/[reportId].ts` runs it.
 *
 * The blocks above prove the mapper and the renderer. This proves the two hops BETWEEN them
 * that the API performs and that a mapper-only test would miss — `attachProgressComparison`
 * (which rebuilds the payload) and `sanitizeReportViewPayload` (which JSON-clones it). A field
 * can survive the mapper and still be dropped there, and that is exactly the class of silent
 * break GAP-01 exists to close.
 *
 * It also writes the rendered document to `tmp/` (gitignored) so the restored intelligence can
 * be inspected as an artifact rather than only asserted on.
 */
describe('GAP-01 · end-to-end — the API path delivers the intelligence to the document', () => {
  it('carries every Report 1 surface through comparison, sanitisation and render', () => {
    const mapped = map();

    const withComparison = attachProgressComparison({
      currentPayload: mapped,
      type: 'snapshot',
      timelineReports: [],
      mapStoredReportToPayload: () => null,
    });
    expect(withComparison.digitalSnapshot).toEqual(mapped.digitalSnapshot);

    const sanitized = sanitizeReportViewPayload(withComparison);
    // The sanitiser deep-clones through JSON and rewrites narrative fields. Every Report 1
    // surface must arrive on the far side byte-identical — it carries no prose the sanitiser owns.
    expect(sanitized.digitalSnapshot).toEqual(mapped.digitalSnapshot);
    expect(sanitized.digitalExperience).toEqual(mapped.digitalExperience);
    expect(sanitized.competitiveTables).toEqual(mapped.competitiveTables);
    expect(sanitized.evidenceCoverage).toEqual(mapped.evidenceCoverage);

    const html = renderCanonicalReportHtml(sanitized);
    expect(html).toContain('Top Priorities');
    expect(html).toContain('The Next 90 Days');
    expect(html).toContain('Website Evidence');
    expect(html).toContain('Product competition');

    // Artifact for inspection. Best-effort: a sandbox without write access must not fail the
    // assertion above, which is the actual proof.
    try {
      const outDir = join(process.cwd(), 'tmp', 'gap01');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'gap01-report1-output.html'), html, 'utf-8');
    } catch { /* artifact is a convenience, not the assertion */ }
  });
});

describe('GAP-01 · regression — a report without Report 1 surfaces is unchanged', () => {
  it('renders no Report 1 section, and no empty placeholder, when the producer abstained', () => {
    const legacy: ComposedReportData = { ...composed };
    delete legacy.digital_snapshot;
    delete legacy.digital_experience;
    delete legacy.competitive_tables;
    const html = renderCanonicalReportHtml(
      mapComposedReport(legacy, 'snapshot', 'r', 'c', 'd', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2')!,
    );
    expect(html).not.toContain('Top Priorities');
    expect(html).not.toContain('The Next 90 Days');
    expect(html).not.toContain('Website Evidence');
    expect(html).not.toContain('Product competition');
    // The pre-GAP-01 document is otherwise intact.
    expect(html).toContain('Authority Intelligence Dossier');
  });
});
