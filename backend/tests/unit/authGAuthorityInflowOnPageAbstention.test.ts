/**
 * AUTH-G-003 — ON-PAGE CONTENT CANNOT BECOME BACKLINK EVIDENCE.
 *
 * THE DEFECT, as a chain. `reportCompetitorIntelligenceServiceEngine` computes
 * `authorityProxy = clamp(35 + 2 × count("case study"|"customer"|"trusted"|"review"|
 * "award"|"featured"|"partner") + (schema ? 8 : 0), 20, 95)` from a competitor's page
 * copy. That proxy raised a `competitor_backlink_advantage` decision. `isAuthorityDecision`
 * matches `/authority|backlink|trust|brand/` against issue_type, so that decision then:
 *
 *   1. gated `backlinks_score = scoreByKey.get('authority')` — itself
 *      `100 − mean(severity of on-page findings)` from `reportScoreModelService`; and
 *   2. attached the `backlink_signals` source tag; which
 *   3. `canonicalReportBuilderInputs.evidenceSourceFromTag` promoted to the canonical
 *      `backlink_api` evidence kind.
 *
 * So a count of credibility words in page copy was published on an axis named
 * `backlinks_score`, labelled "Authority Inflow — inbound authority signals", carrying a
 * provenance that said a backlink API had observed it. Nothing inbound was ever observed.
 *
 * AND IT SCORED PROBLEMS, NOT AUTHORITY. `dimensionFromDecisions` returns
 * `insufficient_signal` at zero decisions, so a site with NO authority problem got NO
 * backlink number at all, while a site WITH problems got `100 − severity`. The axis fell as
 * detection improved and existed only where something was wrong.
 *
 * THE CONTRACT UNDER TEST. External authority requires external evidence. The baseline axis
 * abstains (`null` / `unavailable`) with the unlock stated on the dimension, and the ONLY
 * path to a measured Authority Inflow is a real provider through
 * `mergeAuthorityInflowDimension`.
 *
 * SECRETS: all synthetic. No network, no credential, no real property.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import { buildSnapshotVisualIntelligence } from '../../services/snapshotReport/visualIntelligenceHelpers';
import {
  DIMENSION_BUILDERS,
  isMeasured,
  resolveAuthorityInflowState,
} from '../../services/canonicalReport/canonicalReportBuilderInputs';
import { mergeAuthorityInflowDimension } from '../../services/canonicalReport/canonicalReportBuilderAssembly';
import type { AuthorityInflowResult } from '../../services/intelligence/providerInterfaces';

/** An on-page authority finding — exactly what the competitor proxy used to raise. */
const authorityDecision = (issueType: string) => ({
  issue_type: issueType,
  title: 'Competitors are signalling more authority',
  description: 'Credibility-word mentions are lower than the observed competitor average.',
  impact_level: 'high',
  priority: 'high',
  action_payload: {},
});

/**
 * The radar, built with on-page authority decisions present AND a measured `authority`
 * score dimension — i.e. precisely the input that used to yield a backlink number.
 */
const radarWithAuthorityFindings = (issueType = 'competitor_backlink_advantage') =>
  buildSnapshotVisualIntelligence({
    decisions: [authorityDecision(issueType), authorityDecision('authority_deficit')],
    score: {
      dimensions: [
        { key: 'authority', value: 58, state: 'measured' },
        { key: 'content_quality', value: 61, state: 'measured' },
      ],
    },
    competitorIntelligence: { comparison: null },
    publicAudit: null,
  } as never).seo_capability_radar;

/** Build the canonical Authority Inflow dimension from a given radar. */
const authorityInflowDimension = (radar: ReturnType<typeof radarWithAuthorityFindings>) =>
  DIMENSION_BUILDERS.authority_inflow({
    snapshot: {
      visual_intelligence: { seo_capability_radar: radar },
      geo_aeo_visuals: { ai_answer_presence_radar: {} },
    },
  } as never);

// ── 1. THE AXIS ABSTAINS ────────────────────────────────────────────────────

describe('AUTH-G-003 — on-page authority findings produce no backlink number', () => {
  it('backlinks_score is null even with authority decisions and a measured authority score', () => {
    const radar = radarWithAuthorityFindings();
    // THE DEFECT, as it was: 58 — the `authority` dimension's value, i.e.
    // 100 − mean on-page severity, published as a backlink reading.
    expect(radar.backlinks_score).toBeNull();
    expect(radar.backlinks_score).not.toBe(58);
  });

  it('the axis state is unavailable, not measured', () => {
    expect(radarWithAuthorityFindings().axis_states?.backlinks_score).toBe('unavailable');
  });

  it('no `backlink_signals` provenance tag is emitted by any on-page path', () => {
    const radar = radarWithAuthorityFindings();
    expect(radar.source_tags?.backlinks_score ?? null).toBeNull();
    expect(JSON.stringify(radar.source_tags ?? {})).not.toContain('backlink_signals');
  });

  it('the problems-only inversion is gone: with and without findings agree', () => {
    // Previously: no authority decision -> null; an authority decision -> a number that
    // FELL as severity rose. The axis now says the same honest thing either way.
    const withFindings = radarWithAuthorityFindings();
    const withoutFindings = buildSnapshotVisualIntelligence({
      decisions: [],
      score: { dimensions: [{ key: 'authority', value: 58, state: 'measured' }] },
      competitorIntelligence: { comparison: null },
      publicAudit: null,
    } as never).seo_capability_radar;

    expect(withFindings.backlinks_score).toBeNull();
    expect(withoutFindings.backlinks_score).toBeNull();
    expect(withFindings.axis_states?.backlinks_score).toBe(withoutFindings.axis_states?.backlinks_score);
  });

  it('every issue_type that `isAuthorityDecision` matches is equally powerless', () => {
    for (const issueType of ['authority_gap', 'backlink_gap', 'trust_gap', 'brand_trust_gap']) {
      expect(radarWithAuthorityFindings(issueType).backlinks_score).toBeNull();
    }
  });
});

// ── 2. THE CANONICAL DIMENSION ──────────────────────────────────────────────

describe('AUTH-G-003 — the Authority Inflow dimension reports the gap and the unlock', () => {
  it('is unavailable with a null value, so it is excluded from the Authority pillar', () => {
    const dim = authorityInflowDimension(radarWithAuthorityFindings());
    expect(dim.pillar).toBe('authority');
    expect(dim.score.value).toBeNull();
    expect(dim.score.state).toBe('unavailable');
    // `isMeasured` is what `aggregatePillarScore` filters on. An unavailable axis is
    // excluded from the mean rather than entering it as a phantom number.
    expect(isMeasured(dim.score.value, dim.score.state)).toBe(false);
  });

  it('names what it needs instead of describing an on-site proxy', () => {
    const dim = authorityInflowDimension(radarWithAuthorityFindings());
    expect(dim.rationale).toMatch(/on-site content cannot evidence them/i);
    expect(dim.rationale).toMatch(/unlock/i);
    // The old copy sold the defect as the design.
    expect(dim.rationale).not.toMatch(/inferred from on-site authority signals/i);
  });

  it('claims no backlink evidence in its trace', () => {
    const dim = authorityInflowDimension(radarWithAuthorityFindings());
    expect(dim.score.evidence.sources).not.toContain('backlink_api');
  });
});

// ── 3. THE PROVENANCE PROMOTION IS CLOSED ───────────────────────────────────

describe('AUTH-G-003 — `backlink_signals` no longer confers `backlink_api`', () => {
  /** `evidenceSourceFromTag` is private; `dimIndexIntegrity` is its live call site. */
  const sourcesForTag = (tag: string) =>
    DIMENSION_BUILDERS.index_integrity({
      snapshot: {
        visual_intelligence: {
          seo_capability_radar: {
            technical_seo_score: 71,
            axis_states: { technical_seo_score: 'measured' },
            source_tags: { technical_seo_score: [tag] },
          },
        },
        geo_aeo_visuals: { ai_answer_presence_radar: {} },
      },
    } as never).score.evidence.sources;

  it('a `backlink_signals` tag maps to `heuristic`, never `backlink_api`', () => {
    expect(sourcesForTag('backlink_signals')).not.toContain('backlink_api');
    expect(sourcesForTag('backlink_signals')).toContain('heuristic');
  });

  it('non-vacuity: a real `backlink_api` tag still maps to `backlink_api`', () => {
    expect(sourcesForTag('backlink_api')).toContain('backlink_api');
  });

  it('non-vacuity: the other genuine tags are untouched', () => {
    expect(sourcesForTag('crawler')).toContain('crawler');
    expect(sourcesForTag('competitor_intelligence')).toContain('competitor_intelligence');
    // `gsc` still maps to `gsc`, and is then excluded by the pre-existing Report 1
    // provenance boundary (D3/GAP-07 — private analytics may not back a public report),
    // which is why its retained source list is empty rather than `['heuristic']`. The
    // distinction matters: it is denied, not downgraded.
    expect(sourcesForTag('gsc')).not.toContain('heuristic');
    expect(sourcesForTag('gsc')).toEqual([]);
  });
});

// ── 4. NON-VACUITY — A REAL PROVIDER STILL MEASURES AUTHORITY INFLOW ────────

describe('AUTH-G-003 non-vacuity — this is not blanket suppression', () => {
  const providerResult = (over: Partial<AuthorityInflowResult> = {}): AuthorityInflowResult =>
    ({
      state: 'measured',
      profile: {
        referring_domains: 1820,
        total_backlinks: 41_355,
        domain_authority: 64,
        topical_authority: null,
        trust_flow: null,
        spam_score: null,
        freshness: { last_observed_at: '2026-10-01T00:00:00.000Z', age_hours: 1 },
      },
      score: 68,
      evidence: {
        count: 3,
        sources: ['backlink_api'],
        freshness: { last_observed_at: '2026-10-01T00:00:00.000Z', age_hours: 1 },
        observations: [
          { signal: 'ahrefs:domain_rating:64', source: 'backlink_api', observed_at: '2026-10-01T00:00:00.000Z' },
        ],
      },
      reason_unavailable: null,
      ...over,
    }) as AuthorityInflowResult;

  it('a measured backlink provider result REPLACES the abstention with a real score', () => {
    const baseline = authorityInflowDimension(radarWithAuthorityFindings());
    const merged = mergeAuthorityInflowDimension(baseline, providerResult());

    expect(merged.score.state).toBe('measured');
    expect(merged.score.value).toBe(68);
    expect(isMeasured(merged.score.value, merged.score.state)).toBe(true);
    expect(merged.score.evidence.sources).toContain('backlink_api');
  });

  it('an unavailable provider result leaves the honest abstention in place', () => {
    const baseline = authorityInflowDimension(radarWithAuthorityFindings());
    const merged = mergeAuthorityInflowDimension(
      baseline,
      providerResult({ state: 'unavailable', score: null, profile: null }),
    );

    expect(merged.score.state).toBe('unavailable');
    expect(merged.score.value).toBeNull();
  });

  it('BR-H-001 still holds: a real provider tag keeps `measured`, a heuristic does not', () => {
    expect(resolveAuthorityInflowState('measured', ['backlink_api'])).toBe('measured');
    expect(resolveAuthorityInflowState('measured', ['heuristic'])).toBe('inferred');
  });

  it('the on-page findings themselves still surface — only their use as a score is gone', () => {
    // The decisions are untouched inputs; this fix removes a false SCORE, not a finding.
    const radar = radarWithAuthorityFindings();
    expect(radar.content_quality_score).toBe(61);
    expect(radar.axis_states?.content_quality_score).toBe('measured');
  });
});
