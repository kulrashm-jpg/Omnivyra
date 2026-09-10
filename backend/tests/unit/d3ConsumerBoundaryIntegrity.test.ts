/**
 * D3 CONSUMER FOLLOW-UP — the Report 1 provenance boundary, at every consumer.
 *
 * D3 established the rule (Report 1 presents PUBLICLY OBSERVABLE evidence) and the
 * classifier (`partitionDecisionsForReport1`). It applied them at ONE consumer: the
 * visual-intelligence builder. Nine other consumers in the same composer still received
 * the raw decision list, so connected-source evidence kept reaching Report 1.
 *
 * Reproduced against main before the fix. `seoIntelligenceService` reads the customer's
 * private Search Console property and emits snapshot-tier decisions whose
 * `impact_traffic` and `priority_score` are computed from private impressions
 * (`clamp(48 + impressions/5)` and `clamp(52 + impressions/8)`), carrying
 * `evidence.avg_position`. Through section assembly that reached
 * `evidenceSignalFromDecision`, which printed
 *
 *     "opportunity gap signal; crm software avg position 12.4"
 *
 * verbatim into customer-facing prose; and through `rankByImpactConfidence` →
 * `buildTopPriorities` it led Report 1's recommendation ranking, displacing the public
 * finding entirely.
 *
 * The fix moves the EXISTING boundary upstream of the consumers. There is no second
 * classifier, no per-renderer guard, and no new state vocabulary.
 *
 * SECRETS: all synthetic. No network, no credential, no real property.
 */
jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

jest.mock('../../db/supabaseClient', () => {
  const buildQuery = () => {
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
  return { supabase: { from: jest.fn(() => buildQuery()) } };
});

jest.mock('axios', () => ({ get: jest.fn(() => Promise.resolve({ data: { organic_results: [] } })) }));

import { composeSnapshotReportFromDecisions } from '../../services/snapshotReportService';
import { partitionDecisionsForReport1 } from '../../services/evidenceProvenance';
import type { PersistedDecisionObject } from '../../services/decisionObjectService';

const NOW = new Date('2026-03-31T00:00:00.000Z').toISOString();

/** The private figures a Search Console property yields. Distinctive so they are traceable. */
const GSC_IMPRESSIONS = 12000;
const GSC_CLICKS = 300;
const GSC_CTR = 0.025;
const GSC_AVG_POSITION = 12.4;
/** Distinct keywords so each fixture has a unique fingerprint in the payload. */
const GSC_KEYWORD = 'crm software';
const PUBLIC_KEYWORD = 'buying guide';

function makeDecision(params: {
  id: string;
  service: string;
  issueType: string;
  title: string;
  evidence: Record<string, unknown>;
  impact: number;
  /**
   * The keyword carried in `action_payload`. The GSC and public fixtures MUST use
   * different keywords: `evidenceSignalFromDecision` prints the payload keyword, so a
   * shared one would appear in output for innocent reasons and make "the GSC keyword is
   * absent" unfalsifiable.
   */
  keyword: string;
}): PersistedDecisionObject {
  return {
    id: params.id,
    company_id: 'c1',
    report_tier: 'snapshot',
    source_service: params.service,
    entity_type: 'global',
    entity_id: null,
    issue_type: params.issueType,
    title: params.title,
    description: 'description',
    evidence: params.evidence,
    impact_traffic: params.impact,
    impact_conversion: 10,
    impact_revenue: 10,
    priority_score: params.impact,
    effort_score: 20,
    execution_score: 60,
    confidence_score: 0.8,
    recommendation: 'recommendation',
    action_type: 'improve_content',
    action_payload: { keyword: params.keyword },
    status: 'open',
    last_changed_by: 'system',
    created_at: NOW,
    updated_at: NOW,
    resolved_at: null,
    ignored_at: null,
  } as unknown as PersistedDecisionObject;
}

/**
 * Exactly what `seoIntelligenceService` emits: impact and priority derived from PRIVATE
 * impressions, and the private average position carried in evidence.
 */
const gscDecision = (overrides?: Partial<{ impressions: number; clicks: number; ctr: number; avgPosition: number }>) =>
  makeDecision({
    id: 'gsc-1',
    service: 'seoIntelligenceService',
    issueType: 'keyword_opportunity',
    title: 'Keyword impressions are not turning into clicks',
    keyword: GSC_KEYWORD,
    evidence: {
      keyword: GSC_KEYWORD,
      impressions: overrides?.impressions ?? GSC_IMPRESSIONS,
      clicks: overrides?.clicks ?? GSC_CLICKS,
      ctr: overrides?.ctr ?? GSC_CTR,
      avg_position: overrides?.avgPosition ?? GSC_AVG_POSITION,
    },
    // clamp(48 + 12000/5) and clamp(52 + 12000/8) both saturate at 100.
    impact: 100,
  });

/** A crawl/audit finding — genuinely public evidence, deliberately LOWER impact. */
const publicDecision = () =>
  makeDecision({
    id: 'pub-1',
    service: 'publicDomainAuditService',
    issueType: 'content_gap',
    title: 'Buying-stage content is thin',
    keyword: PUBLIC_KEYWORD,
    evidence: { avg_relevance: 0.62 },
    impact: 40,
  });

async function compose(decisions: PersistedDecisionObject[]) {
  return composeSnapshotReportFromDecisions({
    companyId: 'c1',
    snapshotDecisions: decisions,
    resolvedInput: null,
    publicAudit: null,
  });
}

const serialize = (report: unknown) => JSON.stringify(report);

describe('D3 follow-up — private Search Console values cannot reach Report 1', () => {
  it('case 1: avg_position is never printed in Report 1 prose', async () => {
    const report = await compose([gscDecision(), publicDecision()]);
    const payload = serialize(report);

    // The exact leak: "opportunity gap signal; crm software avg position 12.4".
    expect(payload).not.toMatch(/avg position/i);
    expect(payload).not.toContain(String(GSC_AVG_POSITION));
  });

  it('case 2: impressions cannot populate Report 1 traffic impact', async () => {
    const report = await compose([gscDecision(), publicDecision()]);
    const payload = serialize(report);

    expect(payload).not.toContain(String(GSC_IMPRESSIONS));
    // The decision whose impact_traffic was computed FROM those impressions is absent.
    expect(payload).not.toContain('gsc-1');
    expect(report.pipeline_audit.final_decisions).toBe(1);
  });

  it('case 3: clicks cannot populate Report 1 traffic impact', async () => {
    const report = await compose([gscDecision(), publicDecision()]);
    expect(serialize(report)).not.toContain(String(GSC_CLICKS));
  });

  it('case 4: CTR cannot become public evidence', async () => {
    const report = await compose([gscDecision(), publicDecision()]);
    expect(serialize(report)).not.toContain(String(GSC_CTR));
  });

  it('case 5: GSC-derived priority cannot lead the Report 1 recommendation ranking', async () => {
    // The GSC decision carries impact 100 against the public decision's 40, so before the
    // fix it won `rankByImpactConfidence` outright and became top_priorities[0].
    const report = await compose([gscDecision(), publicDecision()]);

    const titles = (report.top_priorities ?? []).map((priority) => priority.title);
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title).not.toMatch(/impressions are not turning into clicks/i);
      expect(title).not.toMatch(new RegExp(GSC_KEYWORD, 'i'));
    }
  });

  it('case 6: a connected decision never becomes a Report 1 observation, in any section', async () => {
    const report = await compose([gscDecision(), publicDecision()]);

    const fromSections = (report.sections ?? []).flatMap((section) => [
      ...section.insights.map((insight) => insight.title),
      ...section.actions.map((action) => action.title),
    ]);
    for (const title of fromSections) {
      expect(title).not.toMatch(/impressions are not turning into clicks/i);
    }
  });
});

describe('D3 follow-up — public evidence is unaffected', () => {
  it('case 7: a public decision still reaches the Report 1 surface', async () => {
    const report = await compose([publicDecision()]);

    expect(report.pipeline_audit.final_decisions).toBe(1);
    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(0);
    expect((report.sections ?? []).length).toBeGreaterThan(0);
    // The public finding produced real customer-facing output.
    const actions = (report.sections ?? []).flatMap((section) => section.actions);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('case 9: a mixed batch keeps the public half and withholds only the connected half', async () => {
    const report = await compose([gscDecision(), publicDecision()]);

    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(1);
    expect(report.pipeline_audit.final_decisions).toBe(1);
    // The public decision was NOT collateral damage.
    expect((report.sections ?? []).flatMap((section) => section.actions).length).toBeGreaterThan(0);
  });

  it('the engine is not globally disabled — an all-public batch withholds nothing', async () => {
    const report = await compose([publicDecision()]);
    expect(report.pipeline_audit.connected_source_decisions_withheld).toBe(0);
  });
});

describe('D3 follow-up — exclusion degrades honestly, never to zero', () => {
  it('case 10: zero/empty connected data does not become public ZERO evidence', async () => {
    // A GSC property with genuinely zero traffic must not be published as a measured
    // "0 impressions" — that is a public claim derived from private data.
    const report = await compose([
      gscDecision({ impressions: 0, clicks: 0, ctr: 0, avgPosition: 0 }),
      publicDecision(),
    ]);

    const funnel = (report.visual_intelligence as unknown as {
      search_visibility_funnel?: Record<string, unknown>;
    }).search_visibility_funnel;

    expect(funnel).toBeDefined();
    expect(funnel!.impressions).toBeNull();
    expect(funnel!.clicks).toBeNull();
    expect(funnel!.impressions).not.toBe(0);
    expect(funnel!.clicks).not.toBe(0);
  });

  it('case 11: the excluded surface reports its own unavailability rather than a number', async () => {
    const report = await compose([gscDecision(), publicDecision()]);
    const funnel = (report.visual_intelligence as unknown as {
      search_visibility_funnel?: Record<string, unknown>;
    }).search_visibility_funnel;

    // Null volumes at low confidence — the helper's existing honest degradation, reused
    // rather than replaced with a new vocabulary.
    expect(funnel!.impressions).toBeNull();
    expect(funnel!.clicks).toBeNull();
    expect(funnel!.ctr).toBeNull();
    expect(funnel!.confidence).toBe('low');
  });
});

describe('D3 follow-up — the boundary is applied once, upstream of every consumer', () => {
  const fs = require('fs');

  const composerSource = (): string => {
    const source: string = fs.readFileSync('backend/services/snapshotReportService.ts', 'utf8');
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  };

  it('the ungated list is declared, partitioned, and never used again', () => {
    const executable = composerSource();
    expect(executable).toContain('partitionDecisionsForReport1(submittedDecisions)');
    // Declaration + partition. A third mention means a consumer reached back past the gate.
    expect(executable.match(/\bsubmittedDecisions\b/g) ?? []).toHaveLength(2);
  });

  it('no consumer is handed the raw parameter, bypassing the gate entirely', () => {
    const executable = composerSource();
    // Anchored so it cannot be satisfied by the legitimate telemetry line
    // `snapshot_decisions: params.snapshotDecisions.length` — the leading boundary
    // rejects a preceding identifier character.
    expect(executable).not.toMatch(/(?<![_A-Za-z])decisions:\s*params\.snapshotDecisions\b/);
  });

  it('the boundary is applied exactly once — no duplicate gate', () => {
    const executable = composerSource();
    expect(executable.match(/partitionDecisionsForReport1\(/g) ?? []).toHaveLength(1);
  });

  it('case 8: Report 2 keeps its connected-source intelligence, unaffected by this gate', () => {
    // Report 2 reads keyword_metrics / canonical_keywords directly and does not use this
    // composer, so the boundary cannot reach it. Asserted structurally, not assumed.
    const report2: string = fs.readFileSync('backend/services/performanceSearchIntelligenceService.ts', 'utf8');
    expect(report2).toMatch(/keyword_metrics|canonical_keywords/);
    expect(report2).not.toContain('partitionDecisionsForReport1');
    expect(report2).not.toContain('composeSnapshotReportFromDecisions');

    // And the ingestion path that populates it is not gated either.
    const ingestion: string = fs.readFileSync('backend/services/gscIngestionService.ts', 'utf8');
    expect(ingestion).not.toContain('partitionDecisionsForReport1');
  });

  it('no second provenance classifier was introduced by this follow-up', () => {
    const { execSync } = require('child_process');
    const definers = execSync(
      'git grep -l --untracked "export const REPORT1_PROVENANCE\\|export const PRIVATE_PROVENANCE\\|export const CONNECTED_SOURCE_DECISION_SERVICES" -- "backend" "pages" || true',
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((file: string) => !file.includes('/tests/'));
    expect(definers).toEqual(['backend/services/evidenceProvenance.ts']);
  });

  it('the partition still returns the connected half rather than discarding it', () => {
    // The connected evidence remains available to the surfaces entitled to it; a filter
    // that deleted it would invite a caller to re-derive it from somewhere else.
    const { publicEvidence, connectedEvidence } = partitionDecisionsForReport1([
      gscDecision(),
      publicDecision(),
    ]);
    expect(publicEvidence.map((decision) => decision.id)).toEqual(['pub-1']);
    expect(connectedEvidence.map((decision) => decision.id)).toEqual(['gsc-1']);
  });
});
