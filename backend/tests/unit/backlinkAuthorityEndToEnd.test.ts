/**
 * BACKLINK AUTHORITY — END-TO-END OBJECT FLOW (T2).
 *
 * T1 proved the wiring EXISTS by reading source. This file proves the actual OBJECT FLOW:
 *
 *   composeSnapshotReportFromDecisions   (real producer, real buildCanonicalReport)
 *     → report.canonical.backlink_authority
 *       → buildCanonicalExport           (real payload projection)
 *         → renderExportHtml             (real customer-facing renderer, the one the PDF
 *                                         pipeline calls via renderCanonicalReportHtml)
 *
 * Nothing is hand-mocked on that path. The harness mirrors `report1CanonicalContract.test.ts`,
 * which already drives the same producer offline.
 *
 * NO NETWORK, NO CREDENTIALS, NO PRODUCTION DATA. `WIKIDATA_ENABLED=false` is set before the
 * registry bootstraps because the knowledge-graph slot is keyless and ON by default — left
 * alone it would make a real outbound call. Every other provider slot is credential-gated and
 * no key is set, so each resolves to its `Unavailable*` implementation and returns without I/O.
 * The company is a synthetic `.test` domain.
 *
 * WHY THE MEASURED CASES ARE PROJECTED, NOT PRODUCED. Cases B and C need a backlink provider to
 * have ANSWERED, which cannot happen offline without a credential. They therefore substitute the
 * certified surface into the REAL canonical report and run the REAL projection and REAL
 * renderer. The producer half of those two cases is not exercised; everything downstream is.
 * Case A — unavailable — is the one production reaches today and is exercised end to end.
 */
process.env.WIKIDATA_ENABLED = 'false';
delete process.env.AHREFS_API_KEY;
delete process.env.MOZ_API_KEY;
delete process.env.MAJESTIC_API_KEY;

import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { buildCanonicalExport } from '../../services/intelligence/canonicalExport';
import { renderExportHtml } from '../../services/intelligence/exportRenderer';
import {
  buildBacklinkStrategy,
  summarizeBacklinkObservation,
  type BacklinkStrategyInput,
} from '../../services/canonicalReport/reportBacklinkStrategy';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

jest.setTimeout(180_000);

const COMPANY_ID = 'company-backlink-t2';

function makeResolvedInput(): ResolvedReportInput {
  return {
    companyId: COMPANY_ID,
    reportCategory: 'snapshot',
    profile: null,
    requestPayload: {},
    defaults: {
      company_name: null, website_domain: null, business_type: null,
      geography: null, social_links: [], competitors: [],
    },
    resolved: {
      companyName: 'Northwind Clarity',
      websiteDomain: 'northwind-clarity.test',
      // Declared context — the producer passes these on the `declared` channel.
      businessType: 'decision-support tools',
      geography: 'India',
      socialLinks: [], competitors: [],
      source: 'manual-entry', uploadedFileName: null, manualData: null,
      companyContext: {
        marketFocus: null, productServices: [], targetCustomer: null,
        idealCustomerProfile: null, brandPositioning: null, competitiveAdvantages: null,
        teamSize: null, foundedYear: null, revenueRange: null,
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

let report: SnapshotReport;
let canonical: CanonicalReport;

beforeAll(async () => {
  report = await composeSnapshotReportFromDecisions({
    companyId: COMPANY_ID,
    snapshotDecisions: [],
    supplementalGrowthDecisions: [],
    resolvedInput: makeResolvedInput(),
  });
  canonical = report.canonical as CanonicalReport;
});

/** Project + render the REAL canonical report, optionally with a substituted surface. */
function renderWith(surface?: CanonicalReport['backlink_authority']): string {
  const forExport: CanonicalReport = surface
    ? ({ ...canonical, backlink_authority: surface } as CanonicalReport)
    : canonical;
  const payload = buildCanonicalExport({
    shape: 'executive', tenantId: 'tenant:t2', companyId: COMPANY_ID, report: forExport,
  });
  expect(payload.backlink_authority).toBeDefined();
  return renderExportHtml(payload);
}

/** The External Authority section only — assertions about this surface must not read the
 *  whole document, where the same words appear for unrelated reasons. */
function authoritySection(html: string): string {
  const start = html.indexOf('External Authority');
  expect(start).toBeGreaterThan(-1);
  const rest = html.slice(start);
  const end = rest.indexOf('</section>');
  return end === -1 ? rest : rest.slice(0, end + 10);
}

const surfaceFor = (input: BacklinkStrategyInput): CanonicalReport['backlink_authority'] => ({
  observation: summarizeBacklinkObservation(input),
  strategy: buildBacklinkStrategy(input),
});

const declared = {
  category: 'decision-support tools',
  offering: 'multilingual clarity assistant',
  positioning: 'culturally aware guidance for career decisions',
  target_market: 'individuals making career and life decisions',
  geography: 'India',
};

// ── 3. THE PRODUCER EMITS TWO SEPARATE OBJECTS ──────────────────────────────

describe('canonical producer: observation and strategy are separate objects', () => {
  it('the real canonical report carries both halves', () => {
    expect(canonical.backlink_authority).toBeDefined();
    expect(canonical.backlink_authority!.observation).toBeDefined();
    expect(canonical.backlink_authority!.strategy).toBeDefined();
    expect(canonical.backlink_authority!.observation)
      .not.toBe(canonical.backlink_authority!.strategy);
  });

  it('observation carries no strategic recommendation fields', () => {
    const obs = canonical.backlink_authority!.observation as unknown as Record<string, unknown>;
    for (const key of ['recommendations', 'backlinkType', 'recommendedAsset', 'priority',
      'suggestedAcquisitionMotion']) {
      expect(obs).not.toHaveProperty(key);
    }
  });

  it('strategy never claims to be observed backlink evidence', () => {
    const strategy = canonical.backlink_authority!.strategy;
    expect(strategy.kind).toBe('proposal');
    const s = strategy as unknown as Record<string, unknown>;
    for (const key of ['referring_domains', 'backlinks', 'authority']) {
      expect(s).not.toHaveProperty(key);
    }
  });

  it('no backlink score or health score exists anywhere in the canonical surface', () => {
    const json = JSON.stringify(canonical.backlink_authority);
    for (const token of ['backlink_score', 'backlinkScore', 'backlink_health', 'opportunityScore']) {
      expect(json).not.toContain(token);
    }
  });

  it('declared profile context reached the producer and stayed declared', () => {
    const strategy = canonical.backlink_authority!.strategy;
    if (strategy.recommendations.length > 0) {
      for (const rec of strategy.recommendations) {
        expect(['declared', 'observed', 'inferred']).toContain(rec.evidenceState);
        if (rec.evidenceState === 'declared') expect(rec.provenance).toBe('INFERRED');
      }
    }
  });
});

// ── 5. PAYLOAD PROJECTION ───────────────────────────────────────────────────

describe('canonical export payload', () => {
  it('carries backlink_authority through projection unchanged in meaning', () => {
    const payload = buildCanonicalExport({
      shape: 'executive', tenantId: 'tenant:t2', companyId: COMPANY_ID, report: canonical,
    });
    expect(payload.backlink_authority).toBeDefined();
    expect(JSON.stringify(payload.backlink_authority))
      .toBe(JSON.stringify(canonical.backlink_authority));
  });
});

// ── 4A. UNAVAILABLE — THE CASE PRODUCTION REACHES TODAY ─────────────────────

describe('4A — unavailable measurement, end to end', () => {
  it('the producer reports unavailable with null metrics, never a zero', () => {
    const obs = canonical.backlink_authority!.observation;
    expect(obs.state).not.toBe('measured');
    expect(obs.referring_domains).toBeNull();
    expect(obs.referring_domains).not.toBe(0);
    expect(obs.backlinks).toBeNull();
    expect(obs.limitations.join(' ')).toMatch(/not a finding about this company/i);
  });

  it('the rendered report says not measured, never weak, and shows no zero', () => {
    const html = renderWith();
    expect(html).toContain('Backlink observation');
    expect(html).toContain('not measured');
    expect(html).toMatch(/not a finding about this company/i);
    expect(html).not.toMatch(/your backlinks are weak|backlinks are weak|backlink weakness/i);
    expect(html).not.toMatch(/you need \d+ (referring domains|backlinks)/i);
  });

  it('the strategy is not justified by the provider being absent', () => {
    for (const rec of canonical.backlink_authority!.strategy.recommendations) {
      expect(rec.evidenceBasis.join(' ')).not.toMatch(/unavailable|not measured|not configured/i);
    }
  });
});

// ── 4B/4C. MEASURED ZERO AND MEASURED NON-ZERO (projection + render) ────────

describe('4B/4C — measured observations survive projection and rendering', () => {
  const measurement = (referring: number, links: number) => ({
    state: 'measured' as const, referring_domains: referring, backlinks: links, authority: 30,
    observed_at: '2026-02-01T00:00:00.000Z', source: 'backlink_api' as const,
  });

  it('4B — a genuine measured zero stays 0 and stays a measurement', () => {
    const surface = surfaceFor({ declared, comparabilityKey: 'k', measurement: measurement(0, 0) });
    expect(surface.observation.referring_domains).toBe(0);
    expect(surface.observation.state).toBe('measured');
    const html = renderWith(surface);
    expect(html).toContain('Referring domains');
    expect(html).toMatch(/a reported zero is a measurement/i);
    // Scoped to this section: "not measured" legitimately appears elsewhere in the document
    // (the AI citation matrix explains its unmeasured cells), so a whole-document assertion
    // would pass or fail for unrelated reasons.
    expect(authoritySection(html)).not.toContain('not measured');
  });

  it('4C — a measured non-zero observation survives to the rendered report', () => {
    const surface = surfaceFor({ declared, comparabilityKey: 'k', measurement: measurement(42, 310) });
    const html = renderWith(surface);
    expect(html).toContain('42');
    expect(html).toContain('310');
    // The strategy must not be rendered as if those links already included the recommended types.
    expect(html).toMatch(/not links it already has/i);
  });
});

// ── 4D/4E. DECLARED CONTEXT AND ABSTENTION ──────────────────────────────────

describe('4D/4E — declared strategy and honest abstention', () => {
  it('4D — declared context renders separately and keeps its inference caveat', () => {
    const surface = surfaceFor({ declared });
    const html = renderWith(surface);
    expect(html).toContain('Contextual link strategy');
    expect(html).toContain('From what you told us');
    expect(html).toMatch(/strategic inference, not an observed opportunity/i);
    expect(html.indexOf('Backlink observation')).toBeLessThan(html.indexOf('Contextual link strategy'));
  });

  it('4E — contextless input abstains rather than fabricating recommendations', () => {
    const surface = surfaceFor({});
    expect(surface.strategy.abstained).toBe(true);
    expect(surface.strategy.recommendations).toHaveLength(0);
    const html = renderWith(surface);
    expect(html).toContain('Contextual link strategy');
    expect(html).toMatch(/could not be derived|Generic link-building advice/i);
    expect(html).not.toContain('Start now');
  });
});

// ── 5. HISTORICAL GROWTH THROUGH THE CANONICAL INTEGRATION ──────────────────

describe('5 — growth stays comparability-gated through rendering', () => {
  const measurement = {
    state: 'measured' as const, referring_domains: 42, backlinks: 310, authority: 30,
    observed_at: '2026-02-01T00:00:00.000Z', source: 'backlink_api' as const,
  };

  it('A — no history renders the current profile, not momentum', () => {
    const html = renderWith(surfaceFor({ declared, comparabilityKey: 'k', measurement }));
    expect(html).toMatch(/not growth/i);
    expect(html).not.toMatch(/Change across comparable observations/);
  });

  it('B — non-comparable history renders no delta', () => {
    const html = renderWith(surfaceFor({
      declared, comparabilityKey: 'k', measurement,
      history: [{ referring_domains: 10, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'OTHER' }],
    }));
    expect(html).not.toMatch(/Change across comparable observations/);
  });

  it('C — two comparable observations render a measured delta', () => {
    const html = renderWith(surfaceFor({
      declared, comparabilityKey: 'k', measurement,
      history: [{ referring_domains: 30, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'k' }],
    }));
    expect(html).toMatch(/Change across comparable observations: 12 referring domains/);
  });
});

// ── 6. RENDERING HONESTY IN THE FULL DOCUMENT ───────────────────────────────

describe('6 — the full rendered document keeps the two surfaces honest', () => {
  it('both surfaces appear, distinctly, inside the real export HTML', () => {
    const html = renderWith(surfaceFor({ declared }));
    expect(html).toContain('External Authority');
    expect(html).toContain('Backlink observation');
    expect(html).toContain('Contextual link strategy');
    expect(html).toMatch(/types of external authority worth building/i);
  });

  it('no forbidden claim appears anywhere in the document', () => {
    const html = renderWith(surfaceFor({ declared }));
    expect(html).not.toMatch(/backlinks are weak|backlink weakness|backlink gap/i);
    expect(html).not.toMatch(/contact these|reach out to|these publishers|target list/i);
    expect(html).not.toMatch(/high(er)? domain authority (makes|means)/i);
  });

  it('no raw enum token from this surface leaks into the document', () => {
    const html = renderWith(surfaceFor({ declared }));
    for (const token of ['insufficient_evidence', 'topical_editorial', 'research_data_citation',
      'entity_brand', 'trust_authority', 'near_term', 'regional_authority']) {
      expect(html).not.toContain(token);
    }
  });

  it('no URL or domain-like target is emitted by this surface', () => {
    const html = renderWith(surfaceFor({ declared }));
    const section = html.slice(html.indexOf('External Authority'));
    const upTo = section.slice(0, section.indexOf('</section>') + 10).replace(/<[^>]*>/g, ' ');
    expect(upTo).not.toMatch(/https?:\/\//i);
    expect(upTo).not.toMatch(/\b[a-z0-9-]+\.(com|co|io|net|org|in)\b/i);
  });
});

// ── 14. ABSENCE LEAVES THE REST OF THE REPORT INTACT ────────────────────────

describe('the report renders unchanged when the surface is absent', () => {
  it('omitting backlink_authority removes only that section', () => {
    const without = { ...canonical } as CanonicalReport;
    delete (without as { backlink_authority?: unknown }).backlink_authority;
    const payload = buildCanonicalExport({
      shape: 'executive', tenantId: 'tenant:t2', companyId: COMPANY_ID, report: without,
    });
    const html = renderExportHtml(payload);
    expect(html).not.toContain('Contextual link strategy');
    // The surrounding Authority content still renders.
    expect(html.length).toBeGreaterThan(1000);
  });
});
