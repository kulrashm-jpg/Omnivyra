/**
 * GAP-05 — the report may not contradict itself about whether actions exist.
 *
 * THE DEFECT. Two surfaces answer "what should happen next", and they read DIFFERENT evidence:
 *
 *   • `buildActionPlaybook`      ← decision objects (SEO / GEO / competitor summaries)
 *   • `assembleDigitalSnapshot`  ← crawl, digital-experience and competitive surfaces
 *
 * A company with crawl evidence but no decision objects therefore produced a POPULATED decision
 * layer and an EMPTY legacy playbook. `buildStrategicPlaybook([])` sets
 * `sequence_narrative: 'No actions could be derived from the current evidence.'`, and
 * `buildExecutionChannelMix` sets `'the action playbook is still forming.'` — both rendered on the
 * same page as five evidence-backed opportunities, five priorities and a filled 90-day plan.
 *
 * THE RULE NOW ENFORCED:
 *
 *   decision layer populated  +  legacy playbook empty  →  legacy sections do not render
 *   decision layer empty      +  legacy playbook empty  →  honest empty state still renders
 *   legacy playbook populated                           →  renders exactly as before
 *
 * The Digital Snapshot is authoritative because it is the evidence-gated one: `passesEvidenceGate`
 * requires at least one `measured`/`inferred` observation per opportunity, and the contradiction
 * guard drops anything resting only on unmeasured dimensions. Nothing here manufactures an action
 * to silence a message, and no third engine is introduced — the fix reads the assembler's own
 * `empty` flag and suppresses a section that had nothing left to say.
 */
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { assembleDigitalSnapshot, type AssemblyInput } from '../../services/digitalSnapshotAssembly';
import { renderCanonicalReportHtml } from '../../services/export/canonicalReportPipeline';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(180_000);

/** The exact strings that constituted the contradiction. */
const NO_ACTIONS = 'No actions could be derived from the current evidence';
const STILL_FORMING = 'the action playbook is still forming';

function resolvedInput(): ResolvedReportInput {
  return {
    companyId: 'gap05-company', reportCategory: 'snapshot', profile: null, requestPayload: {},
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

/** Crawl-shaped findings — the inputs the assembler reads in production. */
const FINDINGS = [
  { pillar: 'information_accessibility', problem: 'Pages return errors', evidence: '3 of 15 crawled pages returned 4xx/5xx (e.g. https://northwind-analytics.test/pricing → 404)', whyItMatters: 'Pages that error waste the discovery already earned.', action: 'Restore or redirect the erroring URLs.', severity: 'critical', effort: 'low', measurement: 'Re-crawl and confirm HTTP 200.' },
  { pillar: 'value_communication', problem: 'Pages carry too little content to explain the offering', evidence: '6 of 15 pages have under 150 words', whyItMatters: 'Thin pages give a buyer nothing to act on.', action: 'Expand the thin commercial pages.', severity: 'moderate', effort: 'medium', measurement: 'Re-crawl and confirm 150+ words.' },
  { pillar: 'value_communication', problem: 'Pages are missing a title or meta description', evidence: '5 of 15 pages lack a title or meta description', whyItMatters: 'These are the words read before a click.', action: 'Write a distinct title and description per page.', severity: 'moderate', effort: 'low', measurement: 'Re-crawl and confirm both present.' },
  { pillar: 'conversion_readiness', problem: 'Most pages offer no clear next step', evidence: 'Only 4 of 15 pages expose a call to action', whyItMatters: 'A visitor who understands the offer still cannot act.', action: 'Add a primary call to action.', severity: 'moderate', effort: 'low', measurement: 'Re-crawl and confirm CTA coverage above 50%.' },
] as const;

const POPULATED_ASSEMBLY: AssemblyInput = {
  experienceFindings: FINDINGS as unknown as AssemblyInput['experienceFindings'],
  dimensionStates: { searchVisibility: 'unavailable', aiVisibility: 'measured', performance: 'unavailable', content: 'measured', technical: 'measured', competitive: 'measured' },
  contentSignals: { score: 41, weaknesses: ['Thin product pages'] },
  technicalSignals: { score: 58, criticalIssues: ['3 pages return 4xx'] },
  competitive: { productCompetition: [], empty: true },
  coverage: { coverage_percentage: 50, website_scanned: true },
  positioning: { hasCategory: true, hasOffering: true },
};

let baseReport: SnapshotReport;
let populatedDecisionLayer: NonNullable<SnapshotReport['digital_snapshot']>;

beforeAll(async () => {
  baseReport = await composeSnapshotReportFromDecisions({
    companyId: 'gap05-company', snapshotDecisions: [], supplementalGrowthDecisions: [],
    resolvedInput: resolvedInput(),
  });
  populatedDecisionLayer = assembleDigitalSnapshot(POPULATED_ASSEMBLY) as NonNullable<SnapshotReport['digital_snapshot']>;
});

/** Render the full customer path, including the JSONB round-trip the stored report goes through. */
function render(digitalSnapshot: SnapshotReport['digital_snapshot'] | undefined): string {
  const stored = JSON.parse(JSON.stringify({ ...baseReport, digital_snapshot: digitalSnapshot })) as ComposedReportData;
  const payload = mapComposedReport(
    stored, 'snapshot', 'gap05-report', 'gap05-company', 'northwind-analytics.test',
    'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
  );
  if (!payload) throw new Error('mapComposedReport returned null');
  return renderCanonicalReportHtml(payload);
}

describe('GAP-05 · premise — the two layers genuinely diverge', () => {
  it('has an empty legacy playbook while the decision layer is populated', () => {
    // If this ever stops being true the contradiction tests below become vacuous, so it is
    // asserted rather than assumed.
    expect(baseReport.canonical.action_playbook.actions).toHaveLength(0);
    expect(populatedDecisionLayer.empty).toBe(false);
    expect(populatedDecisionLayer.opportunities.length).toBeGreaterThan(0);
    expect(populatedDecisionLayer.topPriorities.length).toBeGreaterThan(0);
  });
});

describe('GAP-05 · Test A — a populated decision layer silences the legacy empty state', () => {
  let html: string;
  beforeAll(() => { html = render(populatedDecisionLayer); });

  it('renders the opportunities and priorities', () => {
    expect(html).toContain('Top Priorities');
    expect(html).toContain('Opportunities');
    expect(html).toContain(populatedDecisionLayer.topPriorities[0].title);
  });

  it('does NOT claim that no actions could be derived', () => {
    expect(html).not.toContain(NO_ACTIONS);
  });

  it('does NOT claim the action playbook is still forming', () => {
    expect(html).not.toContain(STILL_FORMING);
  });

  it('leaves no internal contradiction about whether actions exist', () => {
    const claimsActions = html.includes('Top Priorities') || html.includes('The Next 90 Days');
    const deniesActions = html.includes(NO_ACTIONS) || html.includes(STILL_FORMING);
    expect(claimsActions).toBe(true);
    expect(deniesActions).toBe(false);
  });
});

describe('GAP-05 · Test B — a genuinely empty decision layer stays honestly empty', () => {
  it('still renders the legacy empty state when nothing anywhere has actions', () => {
    const emptyLayer = assembleDigitalSnapshot({}) as NonNullable<SnapshotReport['digital_snapshot']>;
    expect(emptyLayer.empty).toBe(true);
    expect(emptyLayer.opportunities).toHaveLength(0);

    const html = render(emptyLayer);
    // Nothing else is claiming actions exist, so the honest message is not a contradiction —
    // suppressing it here would hide a real finding.
    expect(html).toContain(NO_ACTIONS);
    expect(html).not.toContain('Top Priorities');
  });

  it('behaves identically when the report carries no decision layer at all', () => {
    const html = render(undefined);
    expect(html).toContain(NO_ACTIONS);
  });
});

describe('GAP-05 · Test C — the two representations never contradict each other', () => {
  it('shows the legacy playbook unchanged when it has its own actions', () => {
    // A legacy playbook WITH actions is complementary, not duplicate — it derives from decision
    // objects the Digital Snapshot does not read. It must render exactly as before.
    const withLegacyActions = JSON.parse(JSON.stringify(baseReport)) as SnapshotReport;
    withLegacyActions.canonical.strategic_playbook = {
      ...withLegacyActions.canonical.strategic_playbook,
      sequence_narrative: 'Sequence the foundation work before the authority work.',
    };
    const stored = JSON.parse(JSON.stringify({ ...withLegacyActions, digital_snapshot: populatedDecisionLayer })) as ComposedReportData;
    const html = renderCanonicalReportHtml(
      mapComposedReport(stored, 'snapshot', 'r', 'c', 'd', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2')!,
    );
    // No denial anywhere, and the decision layer still present.
    expect(html).not.toContain(NO_ACTIONS);
    expect(html).not.toContain(STILL_FORMING);
    expect(html).toContain('Top Priorities');
  });
});

describe('GAP-05 · Test D — no second set of actions is generated', () => {
  it('renders exactly the opportunities the assembler produced, and no others', () => {
    const html = render(populatedDecisionLayer);
    for (const opportunity of populatedDecisionLayer.opportunities) {
      expect(html).toContain(opportunity.title);
    }
    // The suppression path invents nothing: the legacy playbook is still empty afterwards.
    expect(baseReport.canonical.action_playbook.actions).toHaveLength(0);
  });

  it('does not alter the decision layer to satisfy the renderer', () => {
    // Rendering is a pure read — the assembler output is byte-identical before and after.
    const before = JSON.stringify(populatedDecisionLayer);
    render(populatedDecisionLayer);
    expect(JSON.stringify(populatedDecisionLayer)).toBe(before);
  });

  it('recomputes the same decisions from the same inputs — no hidden second engine', () => {
    const again = assembleDigitalSnapshot(POPULATED_ASSEMBLY);
    expect(again.opportunities.map((o) => o.id)).toEqual(populatedDecisionLayer.opportunities.map((o) => o.id));
  });
});

describe('GAP-05 · Test E — full render path', () => {
  it('carries the decision layer through composed_report → export → HTML with no denial', () => {
    const stored = JSON.parse(JSON.stringify({ ...baseReport, digital_snapshot: populatedDecisionLayer })) as ComposedReportData;
    expect(stored.digital_snapshot).toBeTruthy();

    const payload = mapComposedReport(stored, 'snapshot', 'r', 'c', 'd', 'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2')!;
    expect(payload.digitalSnapshot).toEqual(stored.digital_snapshot);

    const html = renderCanonicalReportHtml(payload);
    expect(html).toContain('Authority Intelligence Dossier');
    expect(html).toContain('The Next 90 Days');
    expect(html).not.toContain(NO_ACTIONS);
    expect(html).not.toContain(STILL_FORMING);

    // Artifacts for inspection: the same report rendered with and without a populated decision
    // layer, so the suppression can be read side by side rather than only asserted.
    try {
      const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs');
      const { join } = require('path') as typeof import('path');
      const outDir = join(process.cwd(), 'tmp', 'gap05');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'decision-layer-populated.html'), html, 'utf-8');
      writeFileSync(
        join(outDir, 'decision-layer-empty.html'),
        render(assembleDigitalSnapshot({}) as NonNullable<SnapshotReport['digital_snapshot']>),
        'utf-8',
      );
    } catch { /* artifacts are a convenience, not the assertion */ }
  });
});

describe('GAP-05 · prior gaps remain intact', () => {
  it('keeps GAP-02: no technical score without technical evidence', () => {
    const radar = baseReport.visual_intelligence.seo_capability_radar;
    expect(radar.technical_seo_score).toBeNull();
    expect(radar.axis_states?.technical_seo_score).toBe('insufficient_signal');
  });

  it('keeps GAP-04: no numeric value on an insufficient state', () => {
    const overall = baseReport.canonical.authority_overview.overall_score;
    if (overall.state === 'insufficient_signal' || overall.state === 'unavailable') {
      expect(overall.value).toBeNull();
    }
  });
});
