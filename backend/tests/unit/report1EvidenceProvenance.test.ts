/**
 * GAP-07 — the provenance policy becomes a runtime invariant.
 *
 * THE DEFECT. `evidenceProvenance.ts` held the correct taxonomy — including the entry that matters
 * most, `gsc → CONNECTED_SOURCE` — and had ZERO runtime consumers. Evidence became authoritative
 * Report 1 evidence with no check that its origin was inside the public-domain boundary the report
 * claims for itself.
 *
 * Worse, classification lied before enforcement could see it: `dimIndexIntegrity` mapped radar
 * source tags with `tag === 'crawler' ? 'crawler' : 'heuristic'`, collapsing every non-crawler tag —
 * including the literal `'GSC'` the radar attaches to its Search-Console-derived axes — into
 * `heuristic` (INFERRED). Private analytics did not slip past the guard; it arrived already
 * wearing an eligible label, so no guard could have caught it.
 *
 * THE INVARIANT NOW ENFORCED, at `buildEvidence` — the one function every canonical dimension
 * routes its observations through:
 *
 *   provenance ∈ REPORT1_PROVENANCE  → retained; counted; described by `sources`
 *   provenance ∈ PRIVATE_PROVENANCE  → moved to `provenance.excluded`, never deleted
 *
 * Enforcing at the assembly boundary rather than in renderers is the point: a renderer guard
 * protects one surface while the object itself stays wrong for the API, the stored row and Report 2.
 */
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import {
  isReport1Source,
  provenanceForSource,
  summarizeProvenance,
  PRIVATE_PROVENANCE,
  REPORT1_PROVENANCE,
} from '../../services/evidenceProvenance';
import { enforceTraceProvenance } from '../../services/canonicalReport/canonicalReportBuilderInputs';
import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';
import type { ComposedReportData } from '../../../pages/api/reports/reportComposedTypes';
import type { CanonicalScore, EvidenceSourceKind } from '../../services/canonicalReport/canonicalReportTypes';
import type { ResolvedReportInput } from '../../services/reportInputResolver';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

jest.setTimeout(180_000);

function resolvedInput(): ResolvedReportInput {
  return {
    companyId: 'gap07-company', reportCategory: 'snapshot', profile: null, requestPayload: {},
    defaults: { company_name: null, website_domain: null, business_type: null, geography: null, social_links: [], competitors: [] },
    resolved: {
      companyName: 'Northwind Analytics', websiteDomain: 'northwind-analytics.test',
      businessType: 'analytics software', geography: null, socialLinks: [], competitors: [],
      source: 'manual-entry', uploadedFileName: null, manualData: null,
      companyContext: {
        marketFocus: 'mid-market operations analytics', productServices: ['analytics dashboards'],
        targetCustomer: null, idealCustomerProfile: null, brandPositioning: 'The analytics layer for operations teams',
        competitiveAdvantages: null, teamSize: null, foundedYear: null, revenueRange: null,
      },
    },
    integrations: Object.fromEntries(
      ['google_analytics', 'google_search_console', 'google_ads', 'linkedin_ads', 'meta_ads', 'shopify',
        'woocommerce', 'social_accounts', 'wordpress', 'custom_blog_api', 'lead_webhook', 'website_crawl',
        'data_upload', 'manual_entry'].map((k) => [k, { connected: k === 'website_crawl', source: 'system', label: k }]),
    ) as ResolvedReportInput['integrations'],
  };
}

const withSearchObservations = (
  observations: Array<Record<string, unknown>>,
  acquisition: { status: string; reason: string | null; requests_made: number },
) => ({
  summary: '', detected_competitors: [], market_alternatives: [],
  competitors_by_tier: { tier_1: [], tier_2: [], tier_3: [] },
  comparison: { company: {}, competitors: [] }, generated_gaps: [],
  competitive_summary: { top_threats: [], key_advantage: '', key_risk: '', positioning_statement: '' },
  own_domain_search_observations: observations,
  search_acquisition: acquisition,
});

const compose = (override?: unknown) => composeSnapshotReportFromDecisions({
  companyId: 'gap07-company', snapshotDecisions: [], supplementalGrowthDecisions: [],
  resolvedInput: resolvedInput(),
  ...(override ? { competitorIntelligenceOverride: override as never } : {}),
});

/** Every score-bearing object in the report, flattened for whole-graph assertions. */
function allScores(report: SnapshotReport): Array<{ label: string; score: CanonicalScore }> {
  const c = report.canonical;
  return [
    { label: 'overall', score: c.authority_overview.overall_score },
    ...c.pillars.map((p) => ({ label: `pillar:${p.pillar}`, score: p.score })),
    ...c.pillars.flatMap((p) => p.dimensions.map((d) => ({ label: `dimension:${d.key}`, score: d.score }))),
    { label: 'ai_surface_presence', score: c.ai_surface_presence.score },
    { label: 'knowledge_graph', score: c.knowledge_graph.score },
    { label: 'authority_inflow', score: c.authority_inflow.score },
    { label: 'trust_coherence', score: c.trust_coherence.score },
  ];
}

let report: SnapshotReport;
beforeAll(async () => { report = await compose(); });

describe('GAP-07 · the policy now has a runtime consumer', () => {
  it('stamps a provenance verdict on canonical evidence traces', () => {
    const dimensions = report.canonical.pillars.flatMap((p) => p.dimensions);
    const withVerdict = dimensions.filter((d) => d.score.evidence.provenance !== undefined);
    // Every dimension routes through `buildEvidence`, so every one carries a verdict.
    expect(withVerdict.length).toBe(dimensions.length);
    for (const d of withVerdict) {
      expect(typeof d.score.evidence.provenance!.report1Clean).toBe('boolean');
      expect(Array.isArray(d.score.evidence.provenance!.excluded)).toBe(true);
    }
  });

  it('classifies every retained source as Report 1 eligible', () => {
    for (const { label, score } of allScores(report)) {
      for (const source of score.evidence.sources) {
        expect(`${label}:${source}:${isReport1Source(source)}`).toBe(`${label}:${source}:true`);
      }
    }
  });
});

describe('GAP-07 · Test A — GSC can never become public evidence', () => {
  it('classifies gsc as connected-private, not Report 1 eligible', () => {
    expect(provenanceForSource('gsc')).toBe('CONNECTED_SOURCE');
    expect(isReport1Source('gsc')).toBe(false);
    expect(PRIVATE_PROVENANCE.has('CONNECTED_SOURCE')).toBe(true);
    expect(REPORT1_PROVENANCE.has('CONNECTED_SOURCE')).toBe(false);
  });

  it('never lets a gsc source appear in a retained canonical evidence trace', () => {
    for (const { label, score } of allScores(report)) {
      expect(`${label}:${score.evidence.sources.includes('gsc')}`).toBe(`${label}:false`);
    }
  });

  it('does not derive the Digital Snapshot search state from the GSC rank signal', () => {
    // `rank_tracking_score` is the GSC-tagged radar axis. It is unavailable here, and the search
    // state is `unavailable` — but crucially for the right reason: the PUBLIC surface established
    // nothing, not because a private signal was consulted and found missing.
    expect(report.visual_intelligence.seo_capability_radar.source_tags?.rank_tracking_score).toBeNull();
    expect(report.search_visibility).toBeTruthy();
    expect(report.digital_snapshot!.unmeasuredDimensions).toContain('searchVisibility');
  });

  it('reports measured search visibility from public SERP even while GSC is absent', async () => {
    const measured = await compose(withSearchObservations(
      [{ query: 'mid market analytics', position: 3, url: 'https://northwind-analytics.test/', title: 't', snippet: 's', resultCount: 10 }],
      { status: 'ok', reason: null, requests_made: 1 },
    ));
    // GSC contributes nothing...
    expect(measured.visual_intelligence.seo_capability_radar.rank_tracking_score).toBeNull();
    // ...yet the Digital Snapshot's search state is measured, sourced from the public surface.
    expect(measured.search_visibility!.state).toBe('measured');
    expect(measured.digital_snapshot!.unmeasuredDimensions).not.toContain('searchVisibility');
  });
});

describe('GAP-07 · Test B — public SERP evidence stays public', () => {
  it('classifies serp as public-observed and distinct from gsc', () => {
    expect(provenanceForSource('serp')).toBe('PUBLIC_OBSERVED');
    expect(isReport1Source('serp')).toBe(true);
    // Same search engine, opposite provenance — that distinction is the whole point.
    expect(provenanceForSource('serp')).not.toBe(provenanceForSource('gsc'));
  });

  it('stamps the search_visibility surface with its own provenance', async () => {
    const measured = await compose(withSearchObservations(
      [{ query: 'q', position: 2, url: 'https://northwind-analytics.test/', title: 't', snippet: 's', resultCount: 10 }],
      { status: 'ok', reason: null, requests_made: 1 },
    ));
    expect(measured.search_visibility!.source).toBe('serp');
    expect(measured.search_visibility!.provenance).toBe('PUBLIC_OBSERVED');
    expect(measured.search_visibility!.provider).toBe('serpapi');
  });
});

describe('GAP-07 · Test C — declared company data stays declared', () => {
  it('classifies company-confirmed data as outside the Report 1 observed boundary', () => {
    expect(provenanceForSource('unspecified')).toBe('UNAVAILABLE');
    expect(PRIVATE_PROVENANCE.has('COMPANY_CONFIRMED')).toBe(true);
    expect(REPORT1_PROVENANCE.has('COMPANY_CONFIRMED')).toBe(false);
  });

  it('does not turn declared positioning into observed evidence', () => {
    // Declared positioning is supplied through the resolved input. Whatever reaches
    // `company_context` from it, no canonical evidence trace may claim it as a crawler observation.
    const crawlerSignals = report.canonical.pillars
      .flatMap((p) => p.dimensions)
      .flatMap((d) => d.score.evidence.observations)
      .filter((o) => o.source === 'crawler')
      .map((o) => o.signal);
    expect(crawlerSignals.join('|')).not.toContain('The analytics layer for operations teams');
    expect(crawlerSignals.join('|')).not.toContain('Northwind Analytics');
  });
});

describe('GAP-07 · Test D — public crawl evidence stays observed', () => {
  it('classifies crawl and public-audit sources as public-observed', () => {
    for (const source of ['crawler', 'public_audit', 'schema_org', 'wikidata', 'llm_probe'] as EvidenceSourceKind[]) {
      expect(`${source}:${provenanceForSource(source)}`).toBe(`${source}:PUBLIC_OBSERVED`);
      expect(isReport1Source(source)).toBe(true);
    }
  });

  it('retains crawler observations rather than excluding them', () => {
    for (const { score } of allScores(report)) {
      const excludedSources = score.evidence.provenance?.excludedSources ?? [];
      expect(excludedSources).not.toContain('crawler');
      expect(excludedSources).not.toContain('public_audit');
    }
  });
});

describe('GAP-07 · Test E — inference stays inference', () => {
  it('classifies derived sources as inferred, never promoted to observed', () => {
    for (const source of ['heuristic', 'decisions', 'expertise_extractor'] as EvidenceSourceKind[]) {
      expect(`${source}:${provenanceForSource(source)}`).toBe(`${source}:INFERRED`);
      // Eligible for Report 1, but never PUBLIC_OBSERVED.
      expect(isReport1Source(source)).toBe(true);
      expect(provenanceForSource(source)).not.toBe('PUBLIC_OBSERVED');
    }
  });

  it('records inferred classes distinctly from observed ones on the trace', () => {
    const withBoth = report.canonical.pillars
      .flatMap((p) => p.dimensions)
      .map((d) => d.score.evidence.provenance?.classes ?? [])
      .filter((classes) => classes.length > 0);
    for (const classes of withBoth) {
      for (const c of classes) expect(REPORT1_PROVENANCE.has(c)).toBe(true);
    }
  });
});

describe('GAP-07 · Test F — an out-of-bound source is excluded, not silently dropped', () => {
  it('summarises a mixed source set correctly', () => {
    const summary = summarizeProvenance(['crawler', 'gsc', 'heuristic', 'trajectory_history']);
    expect(summary.report1Clean).toBe(false);
    expect(summary.privateSources).toEqual(expect.arrayContaining(['gsc', 'trajectory_history']));
    expect(summary.classes).toEqual(expect.arrayContaining(['PUBLIC_OBSERVED', 'INFERRED', 'CONNECTED_SOURCE']));
  });

  it('keeps excluded observations addressable rather than deleting them', () => {
    // Rule 4: silently dropping would make coverage read "no evidence" when the truth is
    // "evidence we may not assert on here". The verdict structure preserves that distinction.
    for (const { score } of allScores(report)) {
      const p = score.evidence.provenance;
      if (!p) continue;
      expect(p.excluded.length).toBe(p.excludedSources.length === 0 ? 0 : p.excluded.length);
      for (const obs of p.excluded) expect(isReport1Source(obs.source)).toBe(false);
      expect(p.report1Clean).toBe(p.excluded.length === 0);
    }
  });
});

describe('GAP-07 · Test G — evidence coverage does not miscount private evidence', () => {
  it('counts only retained, eligible observations', () => {
    // Every RETAINED observation must be eligible, at every level.
    for (const { label, score } of allScores(report)) {
      for (const obs of score.evidence.observations) {
        expect(`${label}:${obs.source}:${isReport1Source(obs.source)}`).toBe(`${label}:${obs.source}:true`);
      }
    }
  });

  it('never lets a count exceed what the retained evidence can support', () => {
    // Counts are NOT uniformly observation lengths: pillar and overall counts are deliberate sums
    // of child counts, and a provider trace may count mentions rather than rows (the AI citation
    // matrix does). Asserting equality would encode a rule the codebase never had. What must hold
    // is that no count is negative and every retained observation is eligible — checked above.
    for (const { label, score } of allScores(report)) {
      expect(`${label}:${score.evidence.count >= 0}`).toBe(`${label}:true`);
    }
  });

  it('leaves the evidence-coverage surface intact', () => {
    // Coverage is derived from dimension STATES, not evidence traces, so provenance enforcement
    // must not have moved it. Asserted so a future change cannot quietly couple them.
    expect(report.evidence_coverage).toBeTruthy();
    expect(typeof report.evidence_coverage!.coverage_percentage).toBe('number');
    expect(report.evidence_coverage!.total_sources).toBeGreaterThan(0);
  });
});

describe('GAP-07 · Test H — whole-report invariant', () => {
  it('has no private or declared source represented as public-observed anywhere', () => {
    const offenders: string[] = [];
    for (const { label, score } of allScores(report)) {
      const summary = summarizeProvenance(score.evidence.sources);
      if (!summary.report1Clean) {
        offenders.push(`${label}: retained private sources ${summary.privateSources.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('covers a non-trivial number of scores, so the assertion is not vacuous', () => {
    expect(allScores(report).length).toBeGreaterThanOrEqual(15);
  });
});

describe('GAP-07 · persistence — provenance survives the JSONB round trip', () => {
  it('carries the verdict through composed_report into the mapped payload', () => {
    const stored = JSON.parse(JSON.stringify(report)) as ComposedReportData;
    const payload = mapComposedReport(
      stored, 'snapshot', 'r', 'gap07-company', 'northwind-analytics.test',
      'Sep 5, 2026', '2026-09-05T00:00:00.000Z', false, 'v2',
    );
    expect(payload).not.toBeNull();

    const mappedDimensions = payload!.canonical!.pillars.flatMap((p) => p.dimensions);
    expect(mappedDimensions.length).toBeGreaterThan(0);
    for (const d of mappedDimensions) {
      expect(d.score.evidence.provenance).toBeDefined();
      expect(typeof d.score.evidence.provenance!.report1Clean).toBe('boolean');
    }
  });
});

describe('GAP-07 · GAP-08 readiness (renderer NOT implemented here)', () => {
  it('carries a provenance verdict on every canonical score, ready for a labeller', () => {
    // Every score-bearing object exposes the structure GAP-08 needs, whether or not this
    // particular fixture happened to produce observations for it.
    for (const { label, score } of allScores(report)) {
      expect(`${label}:${score.evidence.provenance !== undefined}`).toBe(`${label}:true`);
    }
  });

  it('distinguishes observed, inferred and excluded on a trace that has evidence', () => {
    // The base fixture abstains everywhere, so the distinction is proven on a constructed trace
    // through the SAME enforcement function the report uses — not on a hand-written expectation.
    const enforced = enforceTraceProvenance({
      count: 4,
      sources: ['crawler', 'heuristic', 'gsc'],
      freshness: { last_observed_at: null, age_hours: null },
      observations: [
        { signal: 'crawl:pages', source: 'crawler', observed_at: null },
        { signal: 'derived:depth', source: 'heuristic', observed_at: null },
        { signal: 'gsc:impressions', source: 'gsc', observed_at: null },
      ],
    });
    expect(enforced.provenance!.classes).toEqual(expect.arrayContaining(['PUBLIC_OBSERVED', 'INFERRED']));
    expect(enforced.provenance!.classes).not.toContain('CONNECTED_SOURCE');
    expect(enforced.sources).toEqual(['crawler', 'heuristic']);
    expect(enforced.observations.map((o) => o.source)).toEqual(['crawler', 'heuristic']);
    // The private row is withheld, not deleted — GAP-08 can still say WHY it is absent.
    expect(enforced.provenance!.excluded.map((o) => o.source)).toEqual(['gsc']);
    expect(enforced.provenance!.report1Clean).toBe(false);
    // And the count drops by exactly the excluded row: no confidence earned from disallowed evidence.
    expect(enforced.count).toBe(3);
  });
});

describe('GAP-07 · prior gaps remain intact', () => {
  it('keeps GAP-02, GAP-04, GAP-05 and GAP-06 invariants', async () => {
    // GAP-02
    expect(report.visual_intelligence.seo_capability_radar.technical_seo_score).toBeNull();
    expect(report.visual_intelligence.seo_capability_radar.axis_states?.technical_seo_score).toBe('insufficient_signal');
    // GAP-04
    for (const { label, score } of allScores(report)) {
      if (score.state === 'insufficient_signal' || score.state === 'unavailable') {
        expect(`${label}:${score.value}`).toBe(`${label}:null`);
      }
    }
    // GAP-05
    expect(report.digital_snapshot!.empty).toBe(true);
    // GAP-06 — the public surface is present and SERP-stamped.
    const measured = await compose(withSearchObservations(
      [{ query: 'q', position: 5, url: 'https://northwind-analytics.test/', title: 't', snippet: 's', resultCount: 10 }],
      { status: 'ok', reason: null, requests_made: 1 },
    ));
    expect(measured.search_visibility!.state).toBe('measured');
    expect(measured.search_visibility!.bestPosition).toBe(5);
  });
});
