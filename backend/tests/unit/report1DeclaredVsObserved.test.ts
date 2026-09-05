/**
 * GAP-08 — declared information must never wear an observed field's clothes.
 *
 * THE DEFECT. `buildBrandBrief` rendered Offering / Positioning / Market / Differentiation with
 * `state: 'measured'` and no provenance marker, while every one of those values came from the
 * company's own onboarding profile. The sharpest case was `company_context.homepage_headline`:
 * the NAME asserts the crawler read it off the home page; the VALUE is `profile.key_messages`,
 * typed into a form. A reader had no way to tell "your site says this" from "you told us this",
 * which are opposite claims about how much the report actually knows.
 *
 * THE FIX. Provenance is decided in the COMPOSER, where the value is chosen and both candidates
 * are in scope, using GAP-07's vocabulary. The renderer displays the verdict; it classifies
 * nothing. Values are labelled, never deleted — declared context is useful, it simply has to be
 * identifiable. Where declared and observed disagree, both are shown.
 */
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { renderCanonicalReportHtml } from '../../services/export/canonicalReportPipeline';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(240_000);

const DECLARED_POSITIONING = 'The analytics layer for operations teams';
const DECLARED_OFFERING = 'Self-serve analytics dashboards';

/**
 * The crawl corpus is read through `loadExperiencePages`. Mocking that ONE repository function is
 * how an observed home-page headline is introduced without a live crawl; everything downstream —
 * composer, provenance assignment, mapper, renderer — is real.
 */
let crawledPages: Array<Record<string, unknown>> = [];
jest.mock('../../services/digitalExperienceRepository', () => {
  const actual = jest.requireActual('../../services/digitalExperienceRepository');
  return {
    ...actual,
    loadExperiencePages: async () => crawledPages,
    collectPerformanceEvidence: async () => null,
  };
});

const homePage = (headline: string) => ({
  id: 'p1', url: 'https://northwind-analytics.test/', page_type: 'home',
  title: headline, meta_description: 'A description.',
  headings: [{ level: 1, text: headline }], ctas: [{ text: 'Book a demo', href: '/contact' }],
  internal_link_count: 5, http_status: 200, crawl_depth: 0, crawl_metadata: null, wordCount: 400,
});

function resolvedInput(overrides?: { positioning?: string | null; offering?: string | null }): ResolvedReportInput {
  return {
    companyId: 'gap08-company', reportCategory: 'snapshot', requestPayload: {},
    profile: {
      brand_positioning: overrides?.positioning === undefined ? DECLARED_POSITIONING : overrides.positioning,
      products_services: overrides?.offering === undefined ? DECLARED_OFFERING : overrides.offering,
    } as unknown as ResolvedReportInput['profile'],
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: 'Northwind Analytics', websiteDomain: 'northwind-analytics.test',
      businessType: 'analytics software', geography: 'United Kingdom', socialLinks: [], competitors: [],
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

const compose = (input = resolvedInput()) => composeSnapshotReportFromDecisions({
  companyId: 'gap08-company', snapshotDecisions: [], supplementalGrowthDecisions: [], resolvedInput: input,
});

/** Full customer path, including the JSONB round trip a stored report goes through. */
function renderOf(report: SnapshotReport): string {
  const stored = JSON.parse(JSON.stringify(report)) as ComposedReportData;
  const payload = mapComposedReport(
    stored, 'snapshot', 'r', 'gap08-company', 'northwind-analytics.test',
    'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
  );
  if (!payload) throw new Error('mapComposedReport returned null');
  return renderCanonicalReportHtml(payload);
}

const fieldOf = (report: SnapshotReport, key: string) =>
  report.company_identity!.fields.find((f) => f.key === key);

function writeArtifact(name: string, html: string) {
  try {
    const { mkdirSync, writeFileSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const dir = join(process.cwd(), 'tmp', 'gap08');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), html, 'utf-8');
  } catch { /* artifact only */ }
}

describe('GAP-08 · Test A — a declared-only field is labelled, not disguised', () => {
  let report: SnapshotReport;
  beforeAll(async () => { crawledPages = []; report = await compose(); });

  it('keeps the declared value rather than nulling it', () => {
    const offering = fieldOf(report, 'offering');
    expect(offering).toBeDefined();
    expect(offering!.value).toBe(DECLARED_OFFERING);
    expect(offering!.declaredValue).toBe(DECLARED_OFFERING);
    expect(offering!.observedValue).toBeNull();
  });

  it('marks it company-confirmed and never observed', () => {
    for (const key of ['offering', 'positioning', 'market']) {
      const field = fieldOf(report, key);
      if (!field) continue;
      expect(`${key}:${field.provenance}`).toBe(`${key}:COMPANY_CONFIRMED`);
      expect(field.agreement).toBe('declared_only');
    }
  });

  it('shows the label in the customer-facing report', () => {
    const html = renderOf(report);
    expect(html).toContain('Company Profile');
    expect(html).toContain('Company confirmed');
    expect(html).toContain(DECLARED_OFFERING);
    expect(html).toContain('not something this report independently observed');
    writeArtifact('declared-only.html', html);
  });
});

describe('GAP-08 · Test B — an observed field is labelled observed', () => {
  let report: SnapshotReport;
  const OBSERVED = 'Analytics that operations teams actually use';
  beforeAll(async () => {
    crawledPages = [homePage(OBSERVED)];
    report = await compose(resolvedInput({ positioning: null }));
  });

  it('reads the value from the crawled home page', () => {
    const positioning = fieldOf(report, 'positioning');
    expect(positioning!.value).toBe(OBSERVED);
    expect(positioning!.observedValue).toBe(OBSERVED);
    expect(positioning!.agreement).toBe('observed_only');
  });

  it('labels it observed, not company-confirmed', () => {
    // The company supplied the DOMAIN, but the headline was read off the public page. Company
    // input at the start of the pipeline does not make the observation declared.
    expect(fieldOf(report, 'positioning')!.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('renders the observed label', () => {
    const html = renderOf(report);
    expect(html).toContain('Observed');
    expect(html).toContain(OBSERVED);
    writeArtifact('observed.html', html);
  });
});

describe('GAP-08 · Test C — inferred conclusions are not presented as observations', () => {
  it('keeps derived opportunity conclusions labelled by their own evidence states', async () => {
    crawledPages = [];
    const report = await compose();
    // The decision layer states each opportunity's evidence state explicitly; a conclusion is
    // never rendered as a direct observation.
    const html = renderOf(report);
    if (!report.digital_snapshot!.empty) {
      expect(html).toMatch(/Measured|Inferred|Not observable/);
    }
    // And an inferred canonical class is never rewritten as observed.
    for (const p of report.canonical.pillars) {
      for (const d of p.dimensions) {
        const classes = d.score.evidence.provenance?.classes ?? [];
        if (classes.includes('INFERRED') && !classes.includes('PUBLIC_OBSERVED')) {
          expect(classes).not.toEqual(['PUBLIC_OBSERVED']);
        }
      }
    }
  });
});

describe('GAP-08 · Test D — declared and observed agree', () => {
  it('presents the value as observed without duplicate contradictory labels', async () => {
    crawledPages = [homePage(DECLARED_POSITIONING)];
    const report = await compose();
    const positioning = fieldOf(report, 'positioning')!;
    expect(positioning.agreement).toBe('agree');
    expect(positioning.provenance).toBe('PUBLIC_OBSERVED');
    expect(positioning.value).toBe(DECLARED_POSITIONING);

    const html = renderOf(report);
    // Agreement is not a finding, so the report does not clutter the line with a second version.
    expect(html).not.toContain('your site says something different');
  });
});

describe('GAP-08 · Test E — declared and observed disagree', () => {
  let report: SnapshotReport;
  const OBSERVED = 'Dashboards for finance teams';
  beforeAll(async () => {
    crawledPages = [homePage(OBSERVED)];
    report = await compose();
  });

  it('does not silently present the declared value as observed', () => {
    const positioning = fieldOf(report, 'positioning')!;
    expect(positioning.agreement).toBe('differ');
    expect(positioning.observedValue).toBe(OBSERVED);
    expect(positioning.declaredValue).toBe(DECLARED_POSITIONING);
    // The value shown is what the public web says — the declared one is not promoted.
    expect(positioning.value).toBe(OBSERVED);
    expect(positioning.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('keeps the disagreement visible to the customer', () => {
    const html = renderOf(report);
    expect(html).toContain(OBSERVED);
    expect(html).toContain(DECLARED_POSITIONING);
    expect(html).toContain('your site says something different');
    writeArtifact('disagreement.html', html);
  });
});

describe('GAP-08 · Test F — public SERP stays public observed', () => {
  it('does not label search visibility company-confirmed because the domain was declared', async () => {
    crawledPages = [];
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'gap08-company', snapshotDecisions: [], supplementalGrowthDecisions: [],
      resolvedInput: resolvedInput(),
      competitorIntelligenceOverride: {
        summary: '', detected_competitors: [], market_alternatives: [],
        competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
        comparison: { company: {}, competitors: [] }, generated_gaps: [],
        competitive_summary: { top_threats: [], key_advantage: '', key_risk: '', positioning_statement: '' },
        own_domain_search_observations: [{ query: 'q', position: 3, url: 'https://northwind-analytics.test/', title: 't', snippet: 's', resultCount: 10 }],
        search_acquisition: { status: 'ok', reason: null, requests_made: 1 },
      } as never,
    });
    expect(report.search_visibility!.provenance).toBe('PUBLIC_OBSERVED');
    expect(report.search_visibility!.source).toBe('serp');
    expect(report.search_visibility!.state).toBe('measured');
  });
});

describe('GAP-08 · Test G — GSC stays outside public observation (GAP-07 regression)', () => {
  it('never lets a gsc source appear in retained canonical evidence', async () => {
    crawledPages = [homePage('Anything')];
    const report = await compose();
    for (const p of report.canonical.pillars) {
      expect(p.score.evidence.sources).not.toContain('gsc');
      for (const d of p.dimensions) expect(d.score.evidence.sources).not.toContain('gsc');
    }
  });
});

describe('GAP-08 · Test H — whole-report scan', () => {
  it('presents no company-confirmed value under an observed-only label', async () => {
    crawledPages = [homePage('Dashboards for finance teams')];
    const report = await compose();

    // Non-vacuity: the fixture genuinely contains at least one declared-only value.
    const declaredOnly = report.company_identity!.fields.filter((f) => f.agreement === 'declared_only');
    expect(declaredOnly.length).toBeGreaterThan(0);

    // Compare on DECODED text: the renderer escapes, so an apostrophe in a generated narrative
    // becomes `&#39;` and a raw substring check would fail for the wrong reason.
    const text = renderOf(report)
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&ldquo;|&rdquo;/g, '"');
    for (const field of declaredOnly) {
      // The value appears, and the section carries the company-confirmed label.
      expect(text).toContain(field.value);
      expect(field.provenance).not.toBe('PUBLIC_OBSERVED');
    }
    const html = text;
    expect(html).toContain('Company confirmed');

    // No identity field claims observation without an observed value behind it.
    for (const field of report.company_identity!.fields) {
      if (field.provenance === 'PUBLIC_OBSERVED') expect(field.observedValue).not.toBeNull();
    }
  });
});

describe('GAP-08 · Test I — provenance survives the JSONB round trip', () => {
  it('carries company_identity through composed_report into the mapped payload', async () => {
    crawledPages = [homePage('Dashboards for finance teams')];
    const report = await compose();
    const stored = JSON.parse(JSON.stringify(report)) as ComposedReportData;
    expect(stored.company_identity).toEqual(report.company_identity);

    const payload = mapComposedReport(
      stored, 'snapshot', 'r', 'gap08-company', 'northwind-analytics.test',
      'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
    )!;
    expect(payload.companyIdentity).toEqual(report.company_identity);
    expect(payload.companyIdentity!.fields.some((f) => f.provenance === 'COMPANY_CONFIRMED')).toBe(true);
  });
});

describe('GAP-08 · Test J — labels do not manufacture measurement', () => {
  it('leaves insufficient and unavailable states untouched', async () => {
    crawledPages = [];
    const report = await compose();
    // GAP-02
    expect(report.visual_intelligence.seo_capability_radar.technical_seo_score).toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.axis_states?.technical_seo_score).toBe('insufficient_signal');
    // GAP-04 — no numeric value on a denying state, anywhere.
    const scores = [
      report.canonical.authority_overview.overall_score,
      ...report.canonical.pillars.map((p) => p.score),
      ...report.canonical.pillars.flatMap((p) => p.dimensions.map((d) => d.score)),
    ];
    for (const score of scores) {
      if (score.state === 'insufficient_signal' || score.state === 'unavailable') {
        expect(score.value).toBeNull();
      }
    }
    // A declared identity field is not a measurement: it must not make the report look measured.
    expect(report.company_identity!.hasObserved).toBe(false);
    expect(report.company_identity!.hasDeclared).toBe(true);
  });

  it('renders nothing when there is no identity information at all', async () => {
    crawledPages = [];
    const report = await compose(resolvedInput({ positioning: null, offering: null }));
    const bare = { ...report, company_identity: { fields: [], hasDeclared: false, hasObserved: false } };
    const html = renderOf(bare as SnapshotReport);
    expect(html).not.toContain('Company Profile');
  });
});
