/**
 * SIX-WORKSTREAM UNION — interaction matrix: Report 1 composition and the D3 boundary.
 *
 * Each describe block names the workstreams whose invariants must BOTH survive
 * integration, and asserts the property that only holds if they do. Every workstream's
 * own suite proves its invariant in isolation; none can prove two workstreams still
 * agree once they share a codebase.
 *
 * Covers I3 (D3 × DG-001), I5 (D3 × D8), I7 (D8 × D3) and I10 (DG-001 × D3). The full matrix is I1–I10 across unionMatrixEvidence,
 * unionMatrixReport1, unionMatrixSources and unionSerpRouting; the 17-mutation battery
 * in scripts/union-matrix-mutations.js proves these tests actually constrain what they
 * claim.
 *
 * SECRETS: all synthetic. No network, no credential, no provider call.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

// One controllable table source; tests that need specific rows swap them in.
const genericQuery = () => {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.in = jest.fn(() => query);
  query.order = jest.fn(() => query);
  query.limit = jest.fn(() => Promise.resolve({ data: [], error: null }));
  query.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
  query.upsert = jest.fn(() => Promise.resolve({ data: null, error: null }));
  return query;
};
const mockFrom = jest.fn((_table: string) => genericQuery());
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

jest.mock('axios', () => ({ get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })) }));

// The canonical outbound seam. Every provider fails unless a test says otherwise, so
// any value that reaches a payload had to come from code, not from a provider.
const safeFetch = jest.fn(async (..._args: unknown[]) => ({ ok: false }) as never);
const readCapped = jest.fn(async (_r: unknown) => Buffer.from(''));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => safeFetch(...args),
  readCapped: (response: unknown) => readCapped(response),
}));

import * as fs from 'fs';

import {
  provenanceForDecisionService,
  partitionDecisionsForReport1,
} from '../../services/evidenceProvenance';
import { buildSearchFeatures } from '../../services/snapshotReport/searchFeatureHelpers';
import { featureOwnership } from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { resolveCompetitorMetrics } from '../../services/competitor/competitorMetricsEvidence';
import type { ComparisonMetrics } from '../../services/reportCompetitorIntelligenceServiceModel';
import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import {
  GSC,
  GSC_FINGERPRINTS,
  gscDecision,
  publicDecision,
  resolvedInput,
  executable,
} from '../helpers/unionMatrixFixtures';

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => genericQuery());
  safeFetch.mockReset();
  safeFetch.mockImplementation(async () => ({ ok: false }) as never);
  readCapped.mockReset();
  readCapped.mockImplementation(async () => Buffer.from(''));
});

// ── I3 — D3 × DG-001 ────────────────────────────────────────────────────────

describe('I3 — D3 × DG-001: SERP evidence stays public; GSC stays out of Report 1', () => {
  it('the boundary classifies GSC as connected and SERP-derived findings as public', () => {
    expect(provenanceForDecisionService('seoIntelligenceService')).toBe('CONNECTED_SOURCE');
    expect(provenanceForDecisionService('reportCompetitorIntelligenceService')).toBe('PUBLIC_OBSERVED');
    const { publicEvidence, connectedEvidence } = partitionDecisionsForReport1([gscDecision(), publicDecision()]);
    expect(publicEvidence.map((d) => d.id)).toEqual(['pub-1']);
    expect(connectedEvidence.map((d) => d.id)).toEqual(['gsc-1']);
  });

  it('Report 1 withholds GSC while the SERP feature block is still assembled', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision(), publicDecision()],
      resolvedInput: null,
      publicAudit: null,
    });
    const payload = JSON.stringify(report);

    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(1);
    for (const fingerprint of GSC_FINGERPRINTS) expect(payload).not.toContain(fingerprint);
    expect(payload).not.toContain(GSC.keyword);
  });

  it('the Report 1 search surface is typed PUBLIC_OBSERVED, never CONNECTED_SOURCE', () => {
    const types = executable(fs.readFileSync('backend/services/snapshotReportTypes.ts', 'utf8'));
    const surface = types.slice(types.indexOf('export type SnapshotSearchVisibility'));
    const block = surface.slice(0, surface.indexOf('\n};'));
    expect(block).toContain("provenance: 'PUBLIC_OBSERVED'");
    expect(block).not.toContain('CONNECTED_SOURCE');
  });
});


// ── I5 — D3 × D8 ────────────────────────────────────────────────────────────

describe('I5 — D3 × D8: a competitor never inherits the customer’s (or GSC’s) numbers', () => {
  const HIGH: ComparisonMetrics = {
    content_depth: 95, authority_score: 95, publishing_frequency: 95,
    engagement_score: 95, seo_coverage: 95, geo_presence: 95, aeo_readiness: 95,
  };

  it('an unobserved competitor stays null however strong the customer’s own evidence is', () => {
    for (const outcome of ['not_attempted', 'client_error', 'server_error', 'transport_failure', 'timeout'] as const) {
      const resolution = resolveCompetitorMetrics({ signals: null, crawlOutcome: outcome, companyMetrics: HIGH });
      expect(resolution.metrics).toBeNull();
      expect(resolution.state).toBe('unavailable');
    }
  });

  it('Report 1 with GSC evidence present: competitors unobserved, no gaps, GSC withheld', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision(), publicDecision()],
      resolvedInput: resolvedInput(['Wysa', 'Woebot Health']),
      publicAudit: null,
    });
    const intelligence = report.competitor_intelligence;
    const entries = intelligence?.comparison?.competitors ?? [];

    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(1);
    // Guard against a vacuous pass: the loop below must actually inspect competitors.
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.metrics).toBeNull();
      expect(entry.deltas_vs_company).toBeNull();
      expect(entry.metrics_state).toBe('unavailable');
    }
    // No gap may be manufactured when nothing about a competitor was observed.
    expect(intelligence?.generated_gaps ?? []).toEqual([]);
    for (const fingerprint of GSC_FINGERPRINTS) expect(JSON.stringify(report)).not.toContain(fingerprint);
  });
});


// ── I7 — D8 × D3 ────────────────────────────────────────────────────────────

describe('I7 — D8 × D3: the partition runs before any competitor consumer', () => {
  it('the boundary is applied to the submitted decisions before competitor intelligence reads them', () => {
    const composer = executable(fs.readFileSync('backend/services/snapshotReportService.ts', 'utf8'));
    const body = composer.slice(composer.indexOf('export async function composeSnapshotReportFromDecisions'));
    const partitionAt = body.indexOf('partitionDecisionsForReport1(submittedDecisions)');
    const competitorAt = body.indexOf('buildCompetitorIntelligence({');
    expect(partitionAt).toBeGreaterThan(-1);
    expect(competitorAt).toBeGreaterThan(-1);
    expect(partitionAt).toBeLessThan(competitorAt);
    // And the competitor engine is fed the partitioned set, not the raw submission.
    expect(body.slice(competitorAt, competitorAt + 200)).toContain('decisions: baseCombined');
    // `submittedDecisions` is read exactly once after it is declared: by the partition.
    expect((body.match(/submittedDecisions/g) ?? []).length).toBe(2);
  });

  it('a GSC decision cannot rank, cannot be narrated, and cannot price an action in Report 1', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision(), publicDecision()],
      resolvedInput: resolvedInput(['Wysa']),
      publicAudit: null,
    });
    const serialized = JSON.stringify(report);

    // The GSC decision carried impact_traffic 100 from private impressions. Had it
    // survived, it would have won rankByImpactConfidence outright.
    const titles = (report.top_priorities ?? []).map((p: { title?: string }) => p.title ?? '');
    expect(titles.join(' ')).not.toContain(GSC.keyword);
    expect(serialized).not.toContain('Keyword impressions are not turning into clicks');
    for (const fingerprint of GSC_FINGERPRINTS) expect(serialized).not.toContain(fingerprint);
    expect(report.pipeline_audit.final_decisions).toBeGreaterThanOrEqual(1);
  });
});


// ── I10 — DG-001 × D3 ───────────────────────────────────────────────────────

describe('I10 — DG-001 × D3: SERP features are built from SERP rows and nothing else', () => {
  it('feature observations carry only SERP-origin fields — no GSC value can be expressed', () => {
    const features = buildSearchFeatures([
      { query: 'q', result_type: 'people_also_ask', position: null, url: null, domain: null, title: 'What is Drishik?', ownedByCompany: null },
      { query: 'q', result_type: 'local', position: 2, url: 'https://drishik.com/x', domain: 'drishik.com', title: 'Drishik', ownedByCompany: true },
    ], 1, 'ok');

    expect(features.state).toBe('measured');
    for (const observation of features.observed) {
      expect(Object.keys(observation).sort())
        .toEqual(['domain', 'ownedByCompany', 'position', 'query', 'result_type', 'title', 'url']);
    }
    const serialized = JSON.stringify(features);
    for (const field of ['impressions', 'clicks', 'ctr', 'avg_position', 'search_volume', 'demand']) {
      expect(serialized).not.toContain(field);
    }
  });

  it('when SERP never ran, the block says so — GSC presence does not fill it', () => {
    const features = buildSearchFeatures([], 0, 'unavailable');
    expect(features.state).toBe('unavailable');
    expect(features.observed).toEqual([]);
    expect(features.counts).toEqual({});
  });

  it('ownership is established only from a SERP domain, never assumed', () => {
    expect(featureOwnership(null, 'drishik.com')).toBeNull();
    expect(featureOwnership('drishik.com', 'drishik.com')).toBe(true);
    expect(featureOwnership('rival.test', 'drishik.com')).toBe(false);
  });

  it('Report 1 with a GSC decision and no SERP: no features invented, no GSC figure in the payload', async () => {
    const report = await composeSnapshotReportFromDecisions({
      companyId: 'c1',
      snapshotDecisions: [gscDecision()],
      resolvedInput: null,
      publicAudit: null,
    });
    const serialized = JSON.stringify(report);
    for (const fingerprint of GSC_FINGERPRINTS) expect(serialized).not.toContain(fingerprint);
    expect(serialized).not.toContain('"avg_position":12.4');
    expect(serialized).not.toContain('"impressions":12000');
  });

  it('the feature builder has no dependency on the connected-source vocabulary', () => {
    const source = executable(fs.readFileSync('backend/services/snapshotReport/searchFeatureHelpers.ts', 'utf8'));
    expect(source).not.toMatch(/seoIntelligenceService|gsc|CONNECTED_SOURCE|impressions/i);
  });
});
