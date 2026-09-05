/**
 * GAP-02 — a zero-evidence technical audit must not produce a measured Technical SEO score.
 *
 * THE DEFECT. The four technical issue counters in `buildSnapshotVisualIntelligence` are
 * `publicAudit.decisions.filter(...).reduce(fn, 0)`. `reduce` on an EMPTY array returns the
 * initial value — `0`, not `undefined`. `buildPublicDomainAuditDecisions` returns early with
 * `decisions: []` when the company has no crawled pages, so a company that was never crawled
 * produced four zeros, `technicalPenalty = 0`, and therefore:
 *
 *     technicalSeoScore = clamp(100 - 0) = 100      technicalState = 'measured'
 *
 * Absence of evidence was scored as absence of defects, and it propagated
 * `technical_seo_score → index_integrity → Foundation → overall`. Observed live: production
 * reports for a company with `canonical_pages = 0` carried Foundation 100 while the same
 * document stated the website had never been scanned.
 *
 * THE INVARIANT THESE TESTS HOLD:
 *
 *     technical evidence unavailable  → value === null AND state === 'insufficient_signal'
 *     technical evidence available    → the existing scoring path is unchanged
 *
 * Both halves matter. A fix that made Technical SEO permanently unavailable would satisfy the
 * first and destroy the product, so the populated-audit case below is a first-class assertion,
 * not an afterthought.
 *
 * These run through the REAL composer (`composeSnapshotReportFromDecisions`) rather than
 * calling the helper with a hand-built params object, so the whole propagation chain —
 * radar axis → canonical dimension → pillar → overall → rendered document — is exercised as
 * production runs it.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { buildPublicDomainAuditDecisions } from '../../services/publicDomainAuditService';
import { renderCanonicalReportHtml } from '../../services/export/canonicalReportPipeline';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(180_000);

type PublicAudit = NonNullable<Parameters<typeof composeSnapshotReportFromDecisions>[0]['publicAudit']>;

function resolvedInput(): ResolvedReportInput {
  return {
    companyId: 'gap02-company', reportCategory: 'snapshot', profile: null, requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: 'Northwind Analytics', websiteDomain: 'northwind-analytics.test',
      businessType: null, geography: null, socialLinks: [], competitors: [],
      source: 'manual-entry', uploadedFileName: null, manualData: null,
      companyContext: {
        marketFocus: null, productServices: [], targetCustomer: null, idealCustomerProfile: null,
        brandPositioning: null, competitiveAdvantages: null, teamSize: null, foundedYear: null, revenueRange: null,
      },
    },
    integrations: Object.fromEntries(
      ['google_analytics', 'google_search_console', 'google_ads', 'linkedin_ads', 'meta_ads', 'shopify',
        'woocommerce', 'social_accounts', 'wordpress', 'custom_blog_api', 'lead_webhook', 'website_crawl',
        'data_upload', 'manual_entry'].map((k) => [k, { connected: k === 'website_crawl', source: 'system', label: k }]),
    ) as ResolvedReportInput['integrations'],
  };
}

/**
 * The shape `buildPublicDomainAuditDecisions` returns when `pages.length === 0` — every
 * `geo_aeo_context` percentage null and `site_structure.homepage` null, because each is computed
 * as `pages.length > 0 ? … : null`. THIS is the input that produced the false 100.
 */
const ZERO_PAGE_AUDIT: PublicAudit = {
  site_structure: {
    homepage: null, product_pages: [], pricing_pages: [], blog_pages: [],
    contact_pages: [], geo_pages: [], legal_pages: [],
  },
  geo_aeo_context: {
    queries: [], entities: [],
    answerable_content_pct: null, structured_content_pct: null, citation_ready_pct: null,
    answer_coverage_score: null, entity_clarity_score: null, topical_authority_score: null,
    citation_readiness_score: null, content_structure_score: null, freshness_score: null,
  },
  declared_evidence: {
    same_as: { count: 0, domains: [], destination_types: {}, source: 'schema_org' },
    declared_certifications: { count: 0, items: [], source: 'schema_org' },
    legal_transparency: { items: [], present_count: 0, source: 'crawler' },
  },
  decisions: [],
} as unknown as PublicAudit;

function auditDecision(params: {
  id: string; title: string; issueType: string; evidence: Record<string, unknown>;
}): PersistedDecisionObject {
  const now = new Date('2026-09-05T00:00:00.000Z').toISOString();
  return {
    id: params.id, company_id: 'gap02-company', report_tier: 'snapshot', source_service: 'publicDomainAuditService',
    entity_type: 'global', entity_id: null, issue_type: params.issueType as PersistedDecisionObject['issue_type'],
    title: params.title, description: params.title, evidence: params.evidence,
    impact_traffic: 50, impact_conversion: 30, impact_revenue: 20,
    priority_score: 60, effort_score: 20, execution_score: 60, confidence_score: 0.8,
    recommendation: 'Fix it.', action_type: 'improve_content', action_payload: {},
    status: 'open', last_changed_by: 'system', created_at: now, updated_at: now,
    resolved_at: null, ignored_at: null,
  };
}

/**
 * An audit that DID evaluate pages and DID find defects.
 *
 * Penalty formula (unchanged by this fix):
 *   metadata × 2.5 + structure × 4 + internalLink × 5 + crawlDepth × 6
 *   metadata    = 2 missing titles + 1 missing meta = 3   → 7.5
 *   structure   = 2 thin pages + 1 page without H1  = 3   → 12
 *   internalLink= 1 orphan-like page                      → 5
 *   crawlDepth  = 1 status error                          → 6
 *   penalty = 30.5 → score = clamp(round(100 - 30.5)) = 70
 */
const POPULATED_AUDIT: PublicAudit = {
  ...ZERO_PAGE_AUDIT,
  site_structure: { ...ZERO_PAGE_AUDIT.site_structure, homepage: 'https://northwind-analytics.test/' },
  geo_aeo_context: {
    ...ZERO_PAGE_AUDIT.geo_aeo_context,
    answerable_content_pct: 60, structured_content_pct: 55, citation_ready_pct: 20,
    citation_readiness_score: 40, content_structure_score: 50,
  },
  decisions: [
    auditDecision({
      id: 'aud-meta', issueType: 'seo_gap',
      title: 'Metadata coverage is too weak to support strong search visibility',
      evidence: { missing_title_count: 2, missing_meta_count: 1, thin_meta_count: 0, duplicate_meta_title_count: 0 },
    }),
    auditDecision({
      id: 'aud-structure', issueType: 'weak_content_depth',
      title: 'Core pages are too thin or weakly structured to perform well in search',
      evidence: { thin_page_count: 2, pages_without_h1_count: 1 },
    }),
    auditDecision({
      id: 'aud-links', issueType: 'seo_gap',
      title: 'Technical crawlability and internal linking are leaving pages under-supported',
      evidence: { orphan_like_page_count: 1, status_error_count: 1 },
    }),
  ],
} as unknown as PublicAudit;

/** The exact value the pre-fix code produced for POPULATED_AUDIT — the regression anchor. */
const EXPECTED_POPULATED_TECHNICAL_SCORE = 70;

const compose = (publicAudit: PublicAudit | null | undefined) =>
  composeSnapshotReportFromDecisions({
    companyId: 'gap02-company',
    snapshotDecisions: publicAudit?.decisions ?? [],
    supplementalGrowthDecisions: [],
    resolvedInput: resolvedInput(),
    publicAudit,
  });

const radarOf = (report: SnapshotReport) => report.visual_intelligence.seo_capability_radar;
const dimensionOf = (report: SnapshotReport, key: string) =>
  report.canonical.pillars.flatMap((p) => p.dimensions).find((d) => d.key === key);
const pillarOf = (report: SnapshotReport, key: string) =>
  report.canonical.pillars.find((p) => p.pillar === key);

let zeroEvidenceReport: SnapshotReport;
let populatedReport: SnapshotReport;

beforeAll(async () => {
  [zeroEvidenceReport, populatedReport] = await Promise.all([
    compose(ZERO_PAGE_AUDIT),
    compose(POPULATED_AUDIT),
  ]);
});

describe('GAP-02 · Test A — an audit that evaluated no pages yields no technical score', () => {
  it('reports the Technical SEO axis as insufficient signal, not 100', () => {
    const radar = radarOf(zeroEvidenceReport);
    expect(radar.technical_seo_score).toBeNull();
    expect(radar.axis_states?.technical_seo_score).toBe('insufficient_signal');
  });

  it('claims no evidence source for an axis it could not measure', () => {
    expect(radarOf(zeroEvidenceReport).source_tags?.technical_seo_score).toBeNull();
  });

  it('does not let index_integrity claim a value from the absent evidence', () => {
    const dim = dimensionOf(zeroEvidenceReport, 'index_integrity');
    expect(dim).toBeDefined();
    expect(dim!.score.value).toBeNull();
    expect(['insufficient_signal', 'unavailable']).toContain(dim!.score.state);
  });

  it('does not let Foundation claim a measured perfect score', () => {
    const foundation = pillarOf(zeroEvidenceReport, 'foundation');
    expect(foundation).toBeDefined();
    expect(foundation!.score.value).not.toBe(100);
    expect(foundation!.score.value).toBeNull();
    expect(['insufficient_signal', 'unavailable']).toContain(foundation!.score.state);
  });
});

describe('GAP-02 · Test B — the same holds when no audit ran at all', () => {
  it('treats a missing audit exactly like an audit that saw nothing', async () => {
    const noAudit = await compose(null);
    expect(radarOf(noAudit).technical_seo_score).toBeNull();
    expect(radarOf(noAudit).axis_states?.technical_seo_score).toBe('insufficient_signal');
    expect(pillarOf(noAudit, 'foundation')!.score.value).toBeNull();
  });

  it('matches the real early-return shape the audit service produces for an uncrawled company', async () => {
    // The real producer, against a company id that has no `canonical_pages` rows. This proves the
    // fixture above is not an invented shape: it is what production actually hands the helper.
    const realZeroPageAudit = await buildPublicDomainAuditDecisions({
      companyId: '00000000-0000-4000-8000-000000000000',
      reportTier: 'snapshot',
      resolvedInput: resolvedInput(),
    });
    expect(realZeroPageAudit.decisions).toHaveLength(0);
    expect(realZeroPageAudit.site_structure.homepage).toBeNull();
    expect(realZeroPageAudit.geo_aeo_context.answerable_content_pct).toBeNull();
    expect(realZeroPageAudit.geo_aeo_context.structured_content_pct).toBeNull();

    const report = await compose(realZeroPageAudit);
    expect(radarOf(report).technical_seo_score).toBeNull();
    expect(radarOf(report).axis_states?.technical_seo_score).toBe('insufficient_signal');
  });
});

describe('GAP-02 · Test C — the measured path is unchanged', () => {
  it('still scores Technical SEO from a populated audit, at the pre-fix value', () => {
    const radar = radarOf(populatedReport);
    expect(radar.technical_seo_score).toBe(EXPECTED_POPULATED_TECHNICAL_SCORE);
    expect(radar.axis_states?.technical_seo_score).toBe('measured');
    expect(radar.source_tags?.technical_seo_score).toEqual(['crawler']);
  });

  it('still lets index_integrity carry that measured value', () => {
    const dim = dimensionOf(populatedReport, 'index_integrity');
    expect(dim!.score.value).toBe(EXPECTED_POPULATED_TECHNICAL_SCORE);
    expect(dim!.score.state).toBe('measured');
  });

  it('distinguishes "evaluated, no defects found" from "never evaluated"', () => {
    // A crawl that ran and found nothing wrong is a legitimate 100 — the whole point of the fix is
    // that it must stay distinguishable from a crawl that never happened.
    const cleanAudit = { ...POPULATED_AUDIT, decisions: [] } as unknown as PublicAudit;
    return compose(cleanAudit).then((clean) => {
      expect(radarOf(clean).technical_seo_score).toBe(100);
      expect(radarOf(clean).axis_states?.technical_seo_score).toBe('measured');
    });
  });
});

describe('GAP-02 · Test D — the rendered report shows no fabricated 100', () => {
  it('renders no Technical SEO or Foundation 100 built on absent evidence', () => {
    const composed = zeroEvidenceReport as unknown as ComposedReportData;
    const payload = mapComposedReport(
      composed, 'snapshot', 'gap02-report', 'gap02-company', 'northwind-analytics.test',
      'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
    );
    expect(payload).not.toBeNull();
    const html = renderCanonicalReportHtml(payload!);
    // Capture the artifact BEFORE asserting, so a failing run still leaves an inspectable
    // document. (Written after the assertions it would only ever record the passing state,
    // which is exactly when it is least useful.)
    try {
      const outDir = join(process.cwd(), 'tmp', 'gap02');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'zero-evidence-report.html'), html, 'utf-8');
    } catch { /* artifact is a convenience, not the assertion */ }

    // The Foundation pillar must not appear anywhere as a scored 100.
    const foundation = pillarOf(zeroEvidenceReport, 'foundation')!;
    expect(foundation.score.value).toBeNull();
    expect(html).not.toMatch(/Foundation[^<]{0,80}100\s*\/\s*100/i);
    expect(html).not.toMatch(/Index Integrity[^<]{0,120}\b100\b/i);

    // The honest abstention language the report already owns must survive.
    expect(html).toContain('Authority Intelligence Dossier');
    expect(html).toMatch(/not yet|insufficient|has not yet been|cannot yet/i);

  });

  it('keeps rendering a real measured score when the evidence exists', () => {
    const payload = mapComposedReport(
      populatedReport as unknown as ComposedReportData, 'snapshot', 'gap02-report-b', 'gap02-company',
      'northwind-analytics.test', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
    );
    const html = renderCanonicalReportHtml(payload!);
    expect(html).toContain('Authority Intelligence Dossier');
    expect(dimensionOf(populatedReport, 'index_integrity')!.score.value).toBe(EXPECTED_POPULATED_TECHNICAL_SCORE);
  });
});

describe('GAP-02 · invariant — no measured technical score without technical evidence', () => {
  it('holds across every axis state the radar can produce', () => {
    for (const report of [zeroEvidenceReport, populatedReport]) {
      const radar = radarOf(report);
      const value = radar.technical_seo_score;
      const state = radar.axis_states?.technical_seo_score;
      if (state === 'insufficient_signal' || state === 'unavailable') {
        expect(value).toBeNull();
      } else {
        expect(typeof value).toBe('number');
      }
    }
  });
});
