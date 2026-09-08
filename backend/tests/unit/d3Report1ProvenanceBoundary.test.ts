/**
 * D3 — REPORT 1 GSC PROVENANCE BOUNDARY.
 *
 * WHY THIS SUITE EXISTS. Report 1's stated contract is that it establishes what
 * is PUBLICLY OBSERVABLE about a company — evidence anyone outside it could
 * gather. That is the whole basis of `REPORT1_PROVENANCE` excluding
 * `CONNECTED_SOURCE`, and of the note beside `gsc` in the provenance table
 * calling it "the boundary that keeps Report 1 honest about being a public
 * report".
 *
 * `visual_intelligence` broke that contract. It is built from persisted DECISION
 * OBJECTS rather than EvidenceTraces, so it never passed `enforceTraceProvenance`
 * — the gate that enforces the boundary. `seoIntelligenceService` reads the
 * customer's connected Search Console property and emits snapshot-tier
 * decisions, so its impressions, clicks and CTR flowed into
 * `search_visibility_funnel` at `confidence: 'high'`, into
 * `rank_tracking_score` tagged `['GSC']` with state `measured`, and out through
 * the Report 1 payload.
 *
 * This is NOT a confidentiality leak: the endpoint is authenticated and
 * tenant-scoped, so the customer sees their own data. It is a defect in what the
 * report MEANS. A reader cannot tell which numbers the outside world can see and
 * which come from their own private analytics — and a competitive comparison in
 * which only they have Search Console data is not a comparison.
 *
 * GAP-07 named this exact hazard and closed half of it: Report 1 stopped
 * DERIVING its search-visibility reading from the GSC axis. It never stopped
 * Report 1 SHIPPING the axis. This suite pins the other half.
 *
 * SECRETS: all synthetic. No network, no credential, no real property.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { buildSnapshotVisualIntelligence } from '../../services/snapshotReport/visualIntelligenceHelpers';
import {
  CONNECTED_SOURCE_DECISION_SERVICES,
  isReport1Decision,
  partitionDecisionsForReport1,
  provenanceForDecisionService,
  isReport1Provenance,
  provenanceForSource,
} from '../../services/evidenceProvenance';
import { buildSeoVisuals } from '../../../pages/api/reports/reportViewSectionBuilders';

const decision = (service: string, keyword: string, evidence: Record<string, unknown>) =>
  ({
    id: `d-${service}-${keyword}`,
    company_id: 'c1',
    report_tier: 'snapshot',
    source_service: service,
    issue_type: 'keyword_opportunity',
    title: keyword,
    description: 'd',
    recommendation: 'r',
    action_type: 'optimize',
    action_payload: { keyword },
    evidence,
    severity_score: 60,
    impact_score: 60,
    confidence_score: 60,
    execution_score: 60,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    resolved_at: null,
    ignored_at: null,
  }) as never;

/** Exactly what seoIntelligenceService emits: private Search Console volumes. */
const gscDecision = (keyword: string, impressions = 12000, clicks = 300) =>
  decision('seoIntelligenceService', keyword, {
    keyword, impressions, clicks, ctr: clicks / impressions, avg_position: 12.4,
  });

/** A crawl/audit-derived keyword finding — no private volumes. */
const publicDecision = (keyword: string) =>
  decision('publicDomainAuditService', keyword, { keyword, avg_relevance: 0.62 });

const visualsFor = (decisions: unknown[]) =>
  buildSnapshotVisualIntelligence({
    decisions,
    score: { dimensions: [] },
    competitorIntelligence: {},
    publicAudit: null,
  } as never);

/** The composition boundary as `snapshotReportService` applies it. */
const report1VisualsFor = (decisions: unknown[]) =>
  visualsFor(partitionDecisionsForReport1(decisions as never).publicEvidence);

// ── 1. THE BOUNDARY ─────────────────────────────────────────────────────────

describe('D3 — decision provenance', () => {
  it('a Search Console producer is CONNECTED_SOURCE, and barred from Report 1', () => {
    expect(provenanceForDecisionService('seoIntelligenceService')).toBe('CONNECTED_SOURCE');
    expect(isReport1Decision({ source_service: 'seoIntelligenceService' })).toBe(false);
  });

  it('crawl and audit producers stay PUBLIC_OBSERVED and are allowed', () => {
    for (const service of ['publicDomainAuditService', 'reportCompetitorIntelligenceService', 'contentAuthorityService']) {
      expect(provenanceForDecisionService(service)).toBe('PUBLIC_OBSERVED');
      expect(isReport1Decision({ source_service: service })).toBe(true);
    }
  });

  it('an unattributed decision is UNAVAILABLE, never publicly observed', () => {
    // An untagged decision must not acquire public standing by omission.
    expect(provenanceForDecisionService(null)).toBe('UNAVAILABLE');
    expect(provenanceForDecisionService('')).toBe('UNAVAILABLE');
  });

  it('the decision boundary agrees with the source-kind boundary for GSC', () => {
    // One vocabulary, two entry points — they must not drift.
    expect(provenanceForSource('gsc')).toBe('CONNECTED_SOURCE');
    expect(isReport1Provenance(provenanceForDecisionService('seoIntelligenceService'))).toBe(false);
  });

  it('partition returns BOTH halves rather than discarding the private one', () => {
    const { publicEvidence, connectedEvidence } = partitionDecisionsForReport1([
      gscDecision('crm software'), publicDecision('crm pricing'),
    ] as never);
    expect(publicEvidence).toHaveLength(1);
    expect(connectedEvidence).toHaveLength(1);
    expect(connectedEvidence[0].source_service).toBe('seoIntelligenceService');
  });
});

// ── 2. THE LEAK, CLOSED ─────────────────────────────────────────────────────

describe('D3 — connected-source demand does not reach the Report 1 payload', () => {
  it('GSC impressions and clicks are absent from the funnel', () => {
    // Pre-fix this returned impressions 12000, clicks 300, confidence 'high'.
    const vi = report1VisualsFor([gscDecision('crm software')]);
    expect(vi.search_visibility_funnel.impressions).toBeNull();
    expect(vi.search_visibility_funnel.clicks).toBeNull();
    expect(vi.search_visibility_funnel.ctr).toBeNull();
  });

  it('missing public demand is NULL at low confidence — never zero', () => {
    const vi = report1VisualsFor([gscDecision('crm software')]);
    expect(vi.search_visibility_funnel.estimated_lost_clicks).toBeNull();
    expect(vi.search_visibility_funnel.confidence).toBe('low');
    // A zero would read as "we looked and there is no demand", which we never established.
    expect(vi.search_visibility_funnel.impressions).not.toBe(0);
  });

  it('the GSC-derived rank axis is insufficient_signal, with no score and no tag', () => {
    const vi = report1VisualsFor([gscDecision('crm software')]);
    expect(vi.seo_capability_radar.rank_tracking_score).toBeNull();
    expect(vi.seo_capability_radar.axis_states.rank_tracking_score).toBe('insufficient_signal');
    expect(vi.seo_capability_radar.source_tags.rank_tracking_score).toBeNull();
  });

  it('no surface in the Report 1 payload is tagged GSC', () => {
    // The blunt statement of the acceptance criterion.
    const vi = report1VisualsFor([gscDecision('a'), gscDecision('b'), publicDecision('c')]);
    expect(JSON.stringify(vi)).not.toContain('GSC');
  });

  it('the drop-off distribution stays null rather than collapsing to zero', () => {
    const vi = report1VisualsFor([gscDecision('crm software')]);
    const dist = vi.search_visibility_funnel.drop_off_reason_distribution;
    expect(dist.ranking_issue_pct).toBeNull();
    expect(dist.ctr_issue_pct).toBeNull();
    expect(dist.intent_mismatch_pct).toBeNull();
  });
});

// ── 3. PUBLIC EVIDENCE SURVIVES ─────────────────────────────────────────────

describe('D3 — legitimate public evidence is preserved', () => {
  it('a public keyword finding still produces opportunity coverage', () => {
    // The fix must not delete the surface — only the private evidence in it.
    const vi = report1VisualsFor([gscDecision('crm software'), publicDecision('crm pricing')]);
    expect(vi.opportunity_coverage_matrix.opportunities).toHaveLength(1);
    expect(vi.opportunity_coverage_matrix.opportunities[0].keyword).toBe('crm pricing');
  });

  it('public coverage is tagged by what actually produced it', () => {
    // Pre-fix this was the literal ['GSC','heuristic'] — false in both
    // directions once the boundary exists.
    const vi = report1VisualsFor([publicDecision('crm pricing')]);
    expect(vi.seo_capability_radar.source_tags.keyword_research_score).toEqual(['crawler', 'heuristic']);
  });

  it('the visual_intelligence surface itself is still present', () => {
    const vi = report1VisualsFor([publicDecision('crm pricing')]);
    expect(vi.seo_capability_radar).toBeTruthy();
    expect(vi.opportunity_coverage_matrix).toBeTruthy();
    expect(vi.search_visibility_funnel).toBeTruthy();
  });
});

// ── 4. MIXED SOURCES DO NOT MERGE ───────────────────────────────────────────

describe('D3 — public and connected evidence are never merged into one value', () => {
  it('a mixed corpus yields public-only coverage, not a blended number', () => {
    const mixedVisuals = report1VisualsFor([gscDecision('crm software'), publicDecision('crm pricing')]);
    const publicOnly = report1VisualsFor([publicDecision('crm pricing')]);
    // Adding private evidence changes nothing on the public surface. If the two
    // were blended, the scores would differ.
    expect(mixedVisuals.seo_capability_radar.keyword_research_score)
      .toBe(publicOnly.seo_capability_radar.keyword_research_score);
    expect(mixedVisuals.opportunity_coverage_matrix.opportunities)
      .toEqual(publicOnly.opportunity_coverage_matrix.opportunities);
  });

  it('the connected half retains its evidence intact for surfaces entitled to it', () => {
    const { connectedEvidence } = partitionDecisionsForReport1([gscDecision('crm software')] as never);
    // Not stripped, not relabelled — just not this surface's evidence.
    const held = connectedEvidence[0] as unknown as { evidence: Record<string, unknown>; source_service: string };
    expect(held.evidence.impressions).toBe(12000);
    expect(provenanceForDecisionService(held.source_service)).toBe('CONNECTED_SOURCE');
  });
});

// ── 5. REPORT-FIRST: THE CUSTOMER-FACING VIEW ───────────────────────────────

describe('D3 — the customer-facing view reflects the boundary', () => {
  const viewFor = (decisions: unknown[]) =>
    buildSeoVisuals({ visual_intelligence: report1VisualsFor(decisions) } as never);

  it('a GSC-only corpus renders no rank score and no private volumes', () => {
    const view = viewFor([gscDecision('crm software')]);
    expect(view.seoCapabilityRadar.rank_tracking_score).toBeNull();
    expect(JSON.stringify(view)).not.toContain('12000');
    expect(JSON.stringify(view)).not.toContain('GSC');
  });

  it('the existing absence handling softens confidence rather than inventing one', () => {
    // Reused, not rebuilt: the view builder already degrades confidence when
    // radar signals are missing.
    const view = viewFor([gscDecision('crm software')]);
    expect(['low', 'medium']).toContain(view.seoCapabilityRadar.confidence);
  });

  it('public evidence still reaches the view', () => {
    const view = viewFor([publicDecision('crm pricing')]);
    expect(typeof view.seoCapabilityRadar.keyword_research_score).toBe('number');
  });
});

// ── 6. REPORT 2 IS UNTOUCHED ────────────────────────────────────────────────

describe('D3 — Report 2 keeps its legitimate connected-source intelligence', () => {
  const fs = require('fs');

  it("Report 2's search intelligence reads its own tables, not Report 1's decisions", () => {
    // The remediation is scoped to the Report 1 decision path. Report 2 reads
    // keyword_metrics / canonical_keywords directly, so the boundary cannot
    // reach it — asserted structurally rather than assumed.
    const source: string = fs.readFileSync('backend/services/performanceSearchIntelligenceService.ts', 'utf8');
    expect(source).toMatch(/keyword_metrics|canonical_keywords/);
    expect(source).not.toContain('partitionDecisionsForReport1');
    expect(source).not.toContain('isReport1Decision');
  });

  it('the GSC ingestion path is not gated by this boundary', () => {
    const source: string = fs.readFileSync('backend/services/gscIngestionService.ts', 'utf8');
    expect(source).not.toContain('partitionDecisionsForReport1');
  });
});

// ── 7. ARCHITECTURE GUARD ───────────────────────────────────────────────────

describe('D3 — the boundary cannot be bypassed or drift out of date', () => {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const serviceFiles = (): string[] =>
    execSync('git ls-files --cached --others --exclude-standard -- "backend/services/*.ts"', { encoding: 'utf8' })
      .split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/'));

  /** Reads a connected customer property: Search Console or GA4. */
  const readsConnectedSource = (source: string): boolean =>
    /searchConsoleProviderBridge|gscIngestionService|keyword_metrics|canonical_sessions/.test(source);

  it('every snapshot-tier producer that reads a connected source is registered', () => {
    // THE DRIFT DETECTOR. The boundary keys on `source_service`, so a new service
    // that reads private data and emits snapshot-tier decisions would leak
    // silently. This fails the moment that happens.
    const offenders: string[] = [];
    for (const file of serviceFiles()) {
      const source: string = fs.readFileSync(file, 'utf8');
      if (!source.includes("report_tier: 'snapshot'")) continue;
      if (!readsConnectedSource(source)) continue;
      const declared = source.match(/source_service: '([^']+)'/g) ?? [];
      for (const match of declared) {
        const service = match.replace(/source_service: '|'/g, '');
        if (!CONNECTED_SOURCE_DECISION_SERVICES.has(service)) offenders.push(`${service} (${file})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('Report 1 composition routes decisions through the boundary', () => {
    // A guard at the canonical boundary, not a scattered check: if the composer
    // ever passes raw decisions to the visual-intelligence builder again, the
    // whole surface is unguarded and this fails.
    const source: string = fs.readFileSync('backend/services/snapshotReportService.ts', 'utf8');
    const executable = source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(executable).toContain('partitionDecisionsForReport1(finalDecisions)');
    expect(executable).not.toMatch(/buildSnapshotVisualIntelligence\(\{\s*decisions:\s*finalDecisions/);
  });

  it('no second provenance classifier was introduced', () => {
    // The vocabulary is DEFINED in exactly one module. Consumers are expected and
    // healthy — `canonicalReportBuilderInputs` reads it for `enforceTraceProvenance`
    // — so the guard looks for a second DECLARATION, which is what a rival
    // classifier would be.
    const definers = execSync(
      'git grep -l --untracked "export const REPORT1_PROVENANCE\\|export const PRIVATE_PROVENANCE\\|export const CONNECTED_SOURCE_DECISION_SERVICES" -- "backend" "pages" || true',
      { encoding: 'utf8' },
    ).split('\n').filter(Boolean).filter((f: string) => !f.includes('/tests/'));
    expect(definers).toEqual(['backend/services/evidenceProvenance.ts']);
  });
});
