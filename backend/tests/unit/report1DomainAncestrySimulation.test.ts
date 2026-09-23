/**
 * 3AH-182 — Report 1 domain-ancestry simulation: compose → map → view payload → HTML / PDF / view.
 *
 * A company that CHANGED WEBSITES keeps the previous site's crawl (canonical_pages) and the
 * decisions that crawl produced. Another tenant sits on the same host as the current site. This
 * suite runs the REAL `composeSnapshotReport` over that state and follows the output through every
 * customer surface, in the order `pages/api/reports/[reportId].ts` runs it:
 *
 *   composeSnapshotReport → mapComposedReport → attachProgressComparison → sanitizeReportViewPayload
 *     → renderCanonicalReportHtml                      (?format=html)
 *     → renderCanonicalReportPdf → renderPdfFromHtml    (?format=pdf; the HTML handed to Chromium)
 *     → view page: <div class="report-page"> extraction + sanitizeHtml(…, 'document') + DOM text
 *
 * Only the edges are replaced: the database (an in-memory PostgREST model, see the fixture helper),
 * the decision store read (`composeDecisionIntelligence`, answered per tier), the network (every
 * request refused) and the Chromium launch (the HTML it would print is captured). Every ranking,
 * section, narrative, scope resolution and render step is production code.
 *
 * Markers: CURRENTPAGE / OLDPAGE / OTHERTENANT (page rows), CURRENTDECISION / STALEDECISION /
 * LEGACYDECISION (contentAuthorityService decisions for d-cur / d-old / no domain_id), UNRELATED
 * (a publicDomainAuditService decision the domain filter must not touch).
 *
 * ── CONTENT-AUTHORITY DOMAIN GATE ──────────────────────────────────────────────────────────────
 * The "[domain-gate]" block pins the 3AH-182 contract: `composeSnapshotReport` keeps a
 * contentAuthorityService decision only when `evidence.domain_id === domainScope.domainId`. Without
 * it the stale and legacy decisions pass straight through and — because all three share one signal
 * key and Report 1 caps reuse of a signal at two — they also CROWD OUT the current domain's decision.
 * The contamination control at the end proves the fixture leaks when both boundaries are removed.
 */
import type { SnapshotReport } from '../../services/snapshotReportTypes';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { ReportViewPayload } from '../../../pages/api/reports/reportViewPayloadTypes';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';
import type { ReadEntry } from '../helpers/report1DomainAncestryFixture';

jest.mock('../../db/supabaseClient', () => require('../helpers/report1DomainAncestryFixture').supabaseModule());
jest.mock('../../../lib/security/safeFetch', () => require('../helpers/hermeticNetwork').hermeticSafeFetchModule());
jest.mock('axios', () => {
  const refuse = async () => { throw new Error('axios refused (hermetic suite)'); };
  const client = { get: refuse, post: refuse };
  return { __esModule: true, default: { ...client, create: () => client }, ...client };
});

// jest.config maps `isomorphic-dompurify` to plain `dompurify`, which has no window under the node
// environment, so the fail-closed sanitizer returns ''. Bind DOMPurify to a jsdom window exactly as
// the package's node build (dist/index.js) does, so `sanitizeHtml` runs its real allow-list here.
jest.mock('isomorphic-dompurify', () => {
  const createDOMPurify = jest.requireActual('dompurify');
  const { JSDOM: Dom } = require('jsdom');
  const purify = (createDOMPurify.default ?? createDOMPurify)(new Dom('<!DOCTYPE html>').window);
  return { __esModule: true, default: purify, sanitize: purify.sanitize, addHook: purify.addHook };
});

// The decision store read. Answered per tier exactly as `listDecisionObjects` would answer the
// snapshot_view / growth_view reads; the rest of the composer module stays real.
const mockComposeCalls: Array<{ companyId: string; reportTier: string }> = [];
let mockDecisionsByTier: Record<string, PersistedDecisionObject[]> = { snapshot: [], growth: [] };
jest.mock('../../services/decisionComposerService', () => ({
  ...jest.requireActual('../../services/decisionComposerService'),
  composeDecisionIntelligence: async (params: { companyId: string; reportTier: string }) => {
    mockComposeCalls.push(params);
    return { decisions: mockDecisionsByTier[params.reportTier] ?? [] };
  },
}));

// Chromium cannot launch here. The renderer's INPUT is the whole question for parity: capture it.
const mockPdfInputs: string[] = [];
jest.mock('../../services/export/htmlToPdfRenderer', () => ({
  renderPdfFromHtml: async (html: string) => { mockPdfInputs.push(html); return Buffer.from('%PDF-1.7 captured'); },
}));

const { installHermeticFetch } = require('../helpers/hermeticNetwork');
const fx = require('../helpers/report1DomainAncestryFixture');
const { composeSnapshotReport, composeSnapshotReportFromDecisions } = require('../../services/snapshotReportService');
const { buildPublicDomainAuditDecisions } = require('../../services/publicDomainAuditService');
const { mapComposedReport } = require('../../../pages/api/reports/reportComposedMapper');
const { attachProgressComparison } = require('../../../pages/api/reports/reportComparisonAttachment');
const { sanitizeReportViewPayload } = require('../../services/reportContentSanitizationService');
const { renderCanonicalReportHtml, renderCanonicalReportPdf } = require('../../services/export/canonicalReportPipeline');
const { sanitizeHtml } = require('../../../lib/security/htmlSanitizer');
const { resolvedInput: baseResolvedInput } = require('../helpers/unionMatrixFixtures');
const { JSDOM } = require('jsdom');

const network = installHermeticFetch(() => undefined);
afterAll(() => network.restore());

jest.setTimeout(240_000);

const COMPANY = 'sim-co';
const CURRENT_HOST = 'current-sim.test';
const BROKEN_CURRENT_URL = `https://${CURRENT_HOST}/currentpage-marker-3`;

const LEAK_PAGE_MARKERS = ['OLDPAGE-MARKER', 'oldpage-marker', 'old-sim.test', 'OTHERTENANT-MARKER', 'othertenant-marker'];

/** Section headings every Report 1 render of this fixture carries. */
const REPORT1_SECTIONS = [
  'Top Priorities', 'Opportunities', 'The Next 90 Days', 'Website Evidence', 'Website Checks',
  'AI Discoverability', 'Trust &amp; Consistency', 'Company Profile', 'Public Search Visibility',
  'Strategic Action Plan', 'Where every value in this report comes from',
];

function simInput(): ResolvedReportInput {
  const input = baseResolvedInput() as ResolvedReportInput;
  input.companyId = COMPANY;
  input.resolved.websiteDomain = CURRENT_HOST;
  input.resolved.companyName = 'Sim Co';
  return input;
}

type Surfaces = {
  report: SnapshotReport;
  json: string;
  payload: ReportViewPayload;
  html: string;
  pdfInput: string;
  pdfBytes: Buffer;
  viewHtml: string;
  viewText: string;
};

/** The customer path of `pages/api/reports/[reportId].ts`, then the view page's own handling. */
async function surfaces(report: SnapshotReport): Promise<Surfaces> {
  const mapped = mapComposedReport(report, 'snapshot', 'r-sim', COMPANY, CURRENT_HOST, 'Sep 20, 2026', '2026-09-20T00:00:00.000Z', false, 'v2');
  if (!mapped) throw new Error('mapComposedReport returned null');
  const withComparison = attachProgressComparison({ currentPayload: mapped, type: 'snapshot', timelineReports: [], mapStoredReportToPayload: () => null });
  const payload: ReportViewPayload = sanitizeReportViewPayload(withComparison);
  const html: string = renderCanonicalReportHtml(payload);

  mockPdfInputs.length = 0;
  const pdfBytes: Buffer = await renderCanonicalReportPdf(payload);
  expect(mockPdfInputs).toHaveLength(1);

  // pages/reports/view/[reportId].tsx: extract the report-page markup, sanitize it as 'document'.
  const pageMatch = html.match(/<div class="report-page">([\s\S]*?)<\/div>\s*<\/body>/i);
  const viewHtml = `<div class="report-page">${sanitizeHtml(pageMatch?.[1] ?? html, 'document')}</div>`;
  const viewText: string = new JSDOM(viewHtml).window.document.body.textContent ?? '';
  return { report, json: JSON.stringify(report), payload, html, pdfInput: mockPdfInputs[0], pdfBytes, viewHtml, viewText };
}

/** Every representation a marker could reach the customer through. */
const representations = (s: Surfaces): Record<string, string> => ({
  composedJson: s.json, html: s.html, pdfInputHtml: s.pdfInput, viewHtml: s.viewHtml, viewText: s.viewText,
});

function expectAbsentEverywhere(s: Surfaces, marker: string): void {
  const leaks = Object.entries(representations(s)).filter(([, text]) => text.includes(marker)).map(([name]) => name);
  expect({ marker, leaks }).toEqual({ marker, leaks: [] });
}

function expectPresentEverywhere(s: Surfaces, marker: string): void {
  const missing = Object.entries(representations(s)).filter(([, text]) => !text.includes(marker)).map(([name]) => name);
  expect({ marker, missing }).toEqual({ marker, missing: [] });
}

/** True when `marker` renders at or after the `<h2>` section heading `heading`. */
function rendersUnder(html: string, heading: string, marker: string): boolean {
  const at = html.search(new RegExp(`<h2[^>]*>\\s*${heading}\\s*<`));
  return at >= 0 && html.indexOf(marker, at) >= 0;
}

const ALL_DECISIONS = (): Record<string, PersistedDecisionObject[]> => ({
  snapshot: [fx.unrelatedDecision()],
  growth: [fx.currentDecision(), fx.staleDecision(), fx.legacyDecision()],
});

type Run = { surfaces: Surfaces; reads: ReadEntry[] };

async function runComposeSnapshotReport(options: Record<string, unknown>, decisions: Record<string, PersistedDecisionObject[]>): Promise<Run> {
  fx.seedFixture();
  mockDecisionsByTier = decisions;
  mockComposeCalls.length = 0;
  const report: SnapshotReport = await composeSnapshotReport(COMPANY, { resolvedInput: simInput(), ...options });
  const reads: ReadEntry[] = [...fx.readLog];
  return { surfaces: await surfaces(report), reads };
}

let explicitScope: Run;
let resolvedScope: Run;
let composeCallsSeen: Array<{ companyId: string; reportTier: string }> = [];

beforeAll(async () => {
  explicitScope = await runComposeSnapshotReport({ domainScope: { domainId: 'd-cur' } }, ALL_DECISIONS());
  composeCallsSeen = [...mockComposeCalls];
  resolvedScope = await runComposeSnapshotReport({}, ALL_DECISIONS());
});

const RUNS: Array<[string, () => Run]> = [
  ['explicit domainScope d-cur', () => explicitScope],
  ['scope resolved from canonical_domains', () => resolvedScope],
];

describe('3AH-182 · harness — the real composition ran over the fixture', () => {
  it('read both decision tiers through the (mocked) decision store for this company only', () => {
    expect(composeCallsSeen.map((c) => [c.companyId, c.reportTier]).sort()).toEqual([[COMPANY, 'growth'], [COMPANY, 'snapshot']]);
  });

  it('resolved the scope itself to d-cur: this company, this host — never the other tenant or the old site', () => {
    const lookups = resolvedScope.reads.filter((r) => r.table === 'canonical_domains');
    expect(lookups.length).toBeGreaterThan(0);
    for (const lookup of lookups) {
      expect(lookup.filters).toEqual(expect.arrayContaining([
        { op: 'eq', column: 'company_id', value: COMPANY }, { op: 'eq', column: 'primary_domain', value: CURRENT_HOST },
      ]));
      expect(lookup.rows.map((r: Record<string, unknown>) => r.id)).toEqual(['d-cur']);
    }
  });

  it.each(RUNS)('%s: every canonical_pages read is company- AND domain-scoped and receives only current pages', (_n, run) => {
    const pageReads = run().reads.filter((r: { table: string }) => r.table === 'canonical_pages');
    expect(pageReads.length).toBeGreaterThan(0);
    for (const read of pageReads) {
      expect(read.filters).toEqual(expect.arrayContaining([
        { op: 'eq', column: 'company_id', value: COMPANY }, { op: 'eq', column: 'domain_id', value: 'd-cur' },
      ]));
    }
    const received = pageReads.flatMap((r: { rows: Array<Record<string, unknown>> }) => r.rows.map((row) => String(row.id)));
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((id: string) => id.startsWith('cur-'))).toBe(true);
  });

  it('left no request on the network', () => {
    expect(network.answered).toEqual([]);
  });
});

describe.each(RUNS)('3AH-182 · Report 1 output (%s)', (_name, run) => {
  it('renders the expected Report 1 sections in the HTML, the PDF input and the view page', () => {
    const s = run().surfaces;
    for (const section of REPORT1_SECTIONS) {
      expect(s.html).toContain(section);
      expect(s.pdfInput).toContain(section);
      expect(s.viewHtml).toContain(section);
    }
  });

  it('PDF parity: the HTML handed to the PDF renderer is byte-identical to the ?format=html document', () => {
    const s = run().surfaces;
    expect(s.pdfInput).toBe(s.html);
    expect(s.pdfInput).toBe(renderCanonicalReportHtml(s.payload));
    expect(s.pdfBytes.toString()).toBe('%PDF-1.7 captured');
  });

  it('current-domain page evidence renders: CURRENTPAGE-MARKER and the broken current URL', () => {
    const s = run().surfaces;
    expectPresentEverywhere(s, 'CURRENTPAGE-MARKER');
    expectPresentEverywhere(s, BROKEN_CURRENT_URL);
    expect(s.html).toContain(CURRENT_HOST);
    // Where it renders: the crawl's page-level evidence and the observed company positioning.
    expect(rendersUnder(s.html, 'Website Evidence', BROKEN_CURRENT_URL)).toBe(true);
    expect(rendersUnder(s.html, 'Company Profile', 'CURRENTPAGE-MARKER')).toBe(true);
  });

  it.each(LEAK_PAGE_MARKERS)('no page evidence from the old site or the other tenant: %s is absent everywhere', (marker) => {
    expectAbsentEverywhere(run().surfaces, marker);
  });

  it('provenance labels are still rendered (Observed pill, Public Evidence, value-source methodology)', () => {
    const s = run().surfaces;
    for (const label of ['class="ds-pill">Observed<', 'Public Evidence', 'Where every value in this report comes from']) {
      expect(s.html).toContain(label);
      expect(s.viewHtml).toContain(label);
    }
    expect(s.report.pipeline_audit.connected_source_decisions_withheld).toBe(0);
  });

  it('the unrelated publicDomainAuditService decision is unaffected: UNRELATED-MARKER renders everywhere', () => {
    expectPresentEverywhere(run().surfaces, 'UNRELATED-MARKER');
    expect(rendersUnder(run().surfaces.html, 'Strategic Action Plan', 'UNRELATED-MARKER')).toBe(true);
  });
});

// ── content-authority domain gate (3AH-182: evidence.domain_id must match the report's domain) ──
describe.each(RUNS)('3AH-182 · [domain-gate] contentAuthorityService decisions follow the current domain (%s)', (_name, run) => {
  it('[domain-gate] the stale decision (evidence.domain_id d-old) is absent from JSON, HTML, PDF input and view', () => {
    expectAbsentEverywhere(run().surfaces, 'STALEDECISION-MARKER');
  });

  it('[domain-gate] the legacy decision (no evidence.domain_id) is absent from JSON, HTML, PDF input and view', () => {
    expectAbsentEverywhere(run().surfaces, 'LEGACYDECISION-MARKER');
  });

  it('[domain-gate] the current decision (evidence.domain_id d-cur) is no longer crowded out: present everywhere', () => {
    expectPresentEverywhere(run().surfaces, 'CURRENTDECISION-MARKER');
  });
});

describe('3AH-182 · current-decision reachability', () => {
  // Feeds composeSnapshotReport exactly the decision set the domain gate leaves behind. Proves the
  // [domain-gate] "present" expectation is reachable by the real pipeline, not an artefact of this suite.
  let postFix: Run;
  beforeAll(async () => {
    postFix = await runComposeSnapshotReport({ domainScope: { domainId: 'd-cur' } }, {
      snapshot: [fx.unrelatedDecision()], growth: [fx.currentDecision()],
    });
  });

  it('with only the current-domain decision, CURRENTDECISION-MARKER reaches every surface', () => {
    expectPresentEverywhere(postFix.surfaces, 'CURRENTDECISION-MARKER');
    expectPresentEverywhere(postFix.surfaces, 'UNRELATED-MARKER');
    // Decisions reach the document through the canonical action playbook's reasoning.
    expect(rendersUnder(postFix.surfaces.html, 'Strategic Action Plan', 'CURRENTDECISION-MARKER')).toBe(true);
    expect(postFix.surfaces.pdfInput).toBe(postFix.surfaces.html);
  });
});

describe('3AH-182 · contamination control — the fixture WOULD leak without the boundaries', () => {
  // Same fixture, both boundaries removed: the page readers run UNSCOPED (the pre-R1-OPEN-01
  // company-wide read) and the stale/legacy decisions are handed to the composer directly,
  // bypassing composeSnapshotReport's decision filter. If these markers did not appear here, the
  // absence assertions above would be vacuous.
  let control: Surfaces;
  beforeAll(async () => {
    fx.seedFixture();
    const input = simInput();
    const unscopedAudit = await buildPublicDomainAuditDecisions({ companyId: COMPANY, reportTier: 'snapshot', resolvedInput: input });
    const report: SnapshotReport = await composeSnapshotReportFromDecisions({
      companyId: COMPANY,
      snapshotDecisions: [fx.unrelatedDecision(), ...unscopedAudit.decisions],
      supplementalGrowthDecisions: [fx.staleDecision(), fx.legacyDecision(), fx.currentDecision()],
      resolvedInput: input,
      publicAudit: unscopedAudit,
      // domainScope deliberately omitted: the legacy, company-wide read.
    });
    control = await surfaces(report);
  });

  it('unscoped page reads put the OLD site into the report', () => {
    expect(control.json).toContain('OLDPAGE-MARKER');
    expect(control.html).toContain('old-sim.test');
  });

  it('decisions that bypass the filter put the STALE and LEGACY decisions into the report', () => {
    expect(control.json).toContain('STALEDECISION-MARKER');
    expect(control.json).toContain('LEGACYDECISION-MARKER');
    expect(control.html).toContain('STALEDECISION-MARKER');
    expect(control.pdfInput).toContain('STALEDECISION-MARKER');
    expect(control.viewText).toContain('STALEDECISION-MARKER');
  });

  it('tenant isolation holds even unscoped: the other tenant never appears', () => {
    expectAbsentEverywhere(control, 'OTHERTENANT-MARKER');
  });
});
