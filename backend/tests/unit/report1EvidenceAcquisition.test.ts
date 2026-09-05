/**
 * GAP-09 — the crawl outcome must be persisted and disclosed.
 *
 * THE DEFECT. `ensureReportCrawlEvidence` runs in `generateReportPayload` before composition and
 * its `ReportCrawlEvidenceResult` — action, pagesBefore/After, lastCrawledAt, durationMs, reason,
 * error — was only ever `console.info`'d. Nothing reached `composed_report`, so a stored report
 * could not answer the one question that decides how to read every abstention in it:
 *
 *     Was the website actually crawled, and what came back?
 *
 * A report where every section reads "insufficient" is trustworthy only if the reader can tell
 * whether that is because the site is thin, or because nothing was ever fetched. Those are
 * opposite conclusions and they looked identical.
 *
 * These tests drive the REAL composer so the record is proven across the whole chain —
 * acquisition result → composition → composed_report → mapper → export payload → rendered
 * document — rather than at an intermediate object.
 *
 * SCOPE. This is observability. It does not make the crawler fetch anything (GAP-03), and a
 * zero-page outcome must survive as a zero-page outcome.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { renderCanonicalReportHtml } from '../../services/export/canonicalReportPipeline';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotCrawlEvidence, SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(180_000);

function resolvedInput(): ResolvedReportInput {
  return {
    companyId: 'gap09-company', reportCategory: 'snapshot', profile: null, requestPayload: {},
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

/** A crawl that ran and fetched pages. Shape is the existing `ReportCrawlEvidenceResult`, narrowed. */
const SUCCESSFUL_CRAWL: SnapshotCrawlEvidence = {
  action: 'crawled', pagesBefore: 0, pagesAfter: 15,
  lastCrawledAt: '2026-09-05T02:00:00.000Z', durationMs: 8421,
  reason: 'no usable stored evidence; first crawl ran',
};

/** The live production condition: the crawl was attempted and returned nothing. */
const ZERO_PAGE_CRAWL: SnapshotCrawlEvidence = {
  action: 'crawled', pagesBefore: 0, pagesAfter: 0,
  lastCrawledAt: null, durationMs: 20114,
  reason: 'crawl completed but persisted no pages',
};

/** A crawl that threw. The error string must survive to the reader. */
const FAILED_CRAWL: SnapshotCrawlEvidence = {
  action: 'failed', pagesBefore: 0, pagesAfter: 0,
  lastCrawledAt: null, durationMs: 3117,
  reason: 'crawl attempted and failed',
  error: 'getaddrinfo ENOTFOUND northwind-analytics.test',
};

const compose = (crawlEvidence: SnapshotCrawlEvidence | null) =>
  composeSnapshotReportFromDecisions({
    companyId: 'gap09-company', snapshotDecisions: [], supplementalGrowthDecisions: [],
    resolvedInput: resolvedInput(), crawlEvidence,
  });

/** The full customer path: composition → composed_report → mapper → renderer. */
function renderOf(report: SnapshotReport): string {
  const payload = mapComposedReport(
    // The DB round-trip is part of the path: `composed_report` is JSONB, so anything that does not
    // survive `JSON.parse(JSON.stringify(...))` never reaches a reader.
    JSON.parse(JSON.stringify(report)) as ComposedReportData,
    'snapshot', 'gap09-report', 'gap09-company', 'northwind-analytics.test',
    'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
  );
  if (!payload) throw new Error('mapComposedReport returned null');
  return renderCanonicalReportHtml(payload);
}

let successReport: SnapshotReport;
let zeroPageReport: SnapshotReport;
let failedReport: SnapshotReport;

beforeAll(async () => {
  [successReport, zeroPageReport, failedReport] = await Promise.all([
    compose(SUCCESSFUL_CRAWL), compose(ZERO_PAGE_CRAWL), compose(FAILED_CRAWL),
  ]);
});

describe('GAP-09 · Test A — a successful crawl is persisted with its real page count', () => {
  it('records the acquisition outcome on the composed report', () => {
    const acq = successReport.evidence_acquisition;
    expect(acq).toBeTruthy();
    expect(acq!.crawl).toEqual(SUCCESSFUL_CRAWL);
    expect(acq!.crawl!.pagesAfter).toBe(15);
    expect(acq!.observedAt).toEqual(expect.any(String));
  });

  it('discloses the page count and observation time to the reader', () => {
    const html = renderOf(successReport);
    expect(html).toContain('Website crawl');
    expect(html).toContain('15 pages available');
    expect(html).toMatch(/Last observed/);
  });
});

describe('GAP-09 · Test B — a zero-page crawl is never dressed up as a success', () => {
  it('persists the zero-page outcome verbatim', () => {
    const acq = zeroPageReport.evidence_acquisition;
    expect(acq!.crawl!.pagesAfter).toBe(0);
    expect(acq!.crawl!.action).toBe('crawled');
    expect(acq!.crawl!.reason).toBe(ZERO_PAGE_CRAWL.reason);
  });

  it('discloses that no pages were obtained, with the reason', () => {
    const html = renderOf(zeroPageReport);
    expect(html).toContain('No pages were obtained');
    expect(html).toContain(ZERO_PAGE_CRAWL.reason);
    // The report completing is not evidence that anything was fetched.
    expect(html).not.toContain('15 pages available');
  });

  it('is distinguishable from a successful crawl in the persisted record', () => {
    expect(zeroPageReport.evidence_acquisition!.crawl!.pagesAfter)
      .not.toBe(successReport.evidence_acquisition!.crawl!.pagesAfter);
  });
});

describe('GAP-09 · Test C — a failed crawl keeps its error', () => {
  it('preserves action and error through the contract', () => {
    const crawl = failedReport.evidence_acquisition!.crawl!;
    expect(crawl.action).toBe('failed');
    expect(crawl.error).toBe(FAILED_CRAWL.error);
  });

  it('tells the reader the crawl failed and why', () => {
    const html = renderOf(failedReport);
    expect(html).toContain('No pages were obtained');
    expect(html).toContain('The crawl failed');
    expect(html).toContain('ENOTFOUND');
  });
});

describe('GAP-09 · Test D — AI coverage is disclosed at its real value', () => {
  it('states measured cells out of total, from the runtime matrix', () => {
    const coverage = zeroPageReport.canonical.ai_surface_presence.citation_matrix?.coverage;
    expect(coverage).toBeTruthy();
    expect(coverage!.total_cells).toBeGreaterThan(0);

    const html = renderOf(zeroPageReport);
    // The actual runtime numbers, not a hard-coded pair.
    expect(html).toContain(
      `${coverage!.measured_cells} of ${coverage!.total_cells} provider × question-type checks returned data`,
    );
  });

  it('never implies full coverage from partial measurement', () => {
    const coverage = zeroPageReport.canonical.ai_surface_presence.citation_matrix!.coverage;
    if (coverage.measured_cells < coverage.total_cells) {
      expect(coverage.measured_cells).not.toBe(coverage.total_cells);
      const html = renderOf(zeroPageReport);
      expect(html).not.toContain(`${coverage.total_cells} of ${coverage.total_cells} provider`);
    }
  });
});

describe('GAP-09 · Test E — SERP acquisition state is disclosed from existing runtime state', () => {
  it('records the state the competitor engine reported', () => {
    const serp = zeroPageReport.evidence_acquisition!.serp;
    expect(['live', 'fallback', 'unavailable']).toContain(serp.status);
    // Mirrors the engine's own discovery_metadata — nothing re-derived here.
    const discovery = zeroPageReport.competitor_intelligence.discovery_metadata;
    expect(serp.status).toBe(discovery?.serp_status ?? 'unavailable');
  });

  it('discloses the live branch with the real query and domain counts', () => {
    // Production currently reports `serp_status: 'live', keyword_count: 10, serp_domains_found: 6`,
    // so the branch that will actually ship is asserted explicitly rather than assumed.
    const stored = JSON.parse(JSON.stringify(zeroPageReport)) as ComposedReportData;
    stored.evidence_acquisition = {
      ...stored.evidence_acquisition!,
      serp: { status: 'live', keywordCount: 10, domainsFound: 6 },
    };
    const html = renderCanonicalReportHtml(
      mapComposedReport(stored, 'snapshot', 'r', 'c', 'd', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2')!,
    );
    expect(html).toContain('Live search results were retrieved across 10 queries, returning 6 distinct domains');
  });

  it('discloses acquisition state independently of the search-visibility surface', () => {
    const html = renderOf(zeroPageReport);
    expect(html).toContain('Search-result acquisition');

    // When this was written GAP-06 did not exist, so the assertion here was that
    // `search_visibility` was absent. GAP-06 has since added it, so that assertion is obsolete —
    // it encoded a temporary scope boundary as a permanent invariant. What still matters, and is
    // asserted instead, is that GAP-09's acquisition disclosure stands on its own runtime state
    // (`discovery_metadata`) rather than depending on the GAP-06 surface.
    const acquisitionSerp = zeroPageReport.evidence_acquisition!.serp;
    expect(['live', 'fallback', 'unavailable']).toContain(acquisitionSerp.status);
    expect(acquisitionSerp.status).toBe(zeroPageReport.competitor_intelligence.discovery_metadata?.serp_status ?? 'unavailable');
  });
});

describe('GAP-09 · Test F — unavailable sources carry their own reasons', () => {
  it('surfaces at least one configured-but-unreadable source with the producer reason', () => {
    const html = renderOf(zeroPageReport);
    expect(html).toMatch(/— unavailable/);

    // The reasons are the producers' own strings, so at least one known class must appear.
    const known = ['Backlink authority — unavailable', 'Reputation / reviews — unavailable',
      'Peer benchmark — unavailable', 'Page performance — unavailable', 'Knowledge graph — unavailable'];
    expect(known.some((label) => html.includes(label))).toBe(true);
  });

  it('quotes the producer reason rather than inventing one', () => {
    const inflowReason = zeroPageReport.canonical.authority_inflow.profile?.reason_unavailable;
    if (inflowReason) expect(renderOf(zeroPageReport)).toContain(inflowReason);
  });
});

describe('GAP-09 · Test G — the record survives the whole real path', () => {
  it('carries acquisition metadata from composition to the rendered document', () => {
    const stored = JSON.parse(JSON.stringify(zeroPageReport)) as ComposedReportData;
    expect(stored.evidence_acquisition).toBeTruthy();

    const payload = mapComposedReport(
      stored, 'snapshot', 'gap09-report', 'gap09-company', 'northwind-analytics.test',
      'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
    )!;
    expect(payload.evidenceAcquisition).toEqual(stored.evidence_acquisition);

    const html = renderCanonicalReportHtml(payload);
    expect(html).toContain('Website crawl');
    expect(html).toContain('Search-result acquisition');
    expect(html).toContain('AI answer-engine coverage');

    try {
      const outDir = join(process.cwd(), 'tmp', 'gap09');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'zero-page-disclosure.html'), html, 'utf-8');
    } catch { /* artifact is a convenience, not the assertion */ }
  });

  it('records null — never a manufactured success — when no crawl ran', async () => {
    const noCrawl = await compose(null);
    expect(noCrawl.evidence_acquisition).toBeTruthy();
    expect(noCrawl.evidence_acquisition!.crawl).toBeNull();
    // No crawl row means no crawl disclosure; the SERP and AI rows still render.
    const html = renderOf(noCrawl);
    expect(html).not.toContain('Website crawl');
    expect(html).toContain('Search-result acquisition');
  });
});

describe('GAP-09 · GAP-02 invariant is untouched', () => {
  it('still reports Technical SEO as insufficient signal with no crawl evidence', () => {
    for (const report of [zeroPageReport, failedReport]) {
      const radar = report.visual_intelligence.seo_capability_radar;
      expect(radar.technical_seo_score).toBeNull();
      expect(radar.axis_states?.technical_seo_score).toBe('insufficient_signal');
      const foundation = report.canonical.pillars.find((p) => p.pillar === 'foundation');
      expect(foundation!.score.value).toBeNull();
    }
  });
});
