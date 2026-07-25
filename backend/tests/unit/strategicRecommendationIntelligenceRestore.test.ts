/**
 * PRODUCT-RESTORE-001 — Strategic Recommendation Intelligence restoration.
 *
 * Explicit regression coverage that the six strategic fields are PRODUCED, that the
 * producer is deterministic and LLM-free, that the feature flag is default-OFF, and
 * — critically — that the producer remains WIRED INTO the recommendation engine.
 * That last guard is the one that would have caught the original silent loss
 * (the producer was deleted in a bulk commit and nothing failed).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  enrichRecommendationIntelligence,
  strategicRecommendationIntelligenceEnabled,
  STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR,
  type StrategicRecommendationIntelligence,
} from '../../services/strategicRecommendationIntelligenceService';
import type { CompanyProfile } from '../../services/companyProfileService';

const SIX_FIELDS: Array<keyof StrategicRecommendationIntelligence> = [
  'problem_being_solved',
  'gap_being_filled',
  'why_now',
  'authority_reason',
  'expected_transformation',
  'campaign_angle',
];

const profile = {
  target_audience: 'B2B founders',
  core_problem_statement: 'inconsistent content prioritization',
  desired_transformation: 'a predictable authority engine',
  life_with_problem: 'scattered ad-hoc posting',
  authority_domains: ['content strategy'],
  awareness_gap: 'how compounding beats volume',
} as unknown as CompanyProfile;

const rec = {
  topic: 'content prioritization',
  polished_title: 'Content Prioritization',
  volume: 100,
  diamond_score: 0.8,
  polish_flags: { diamond_candidate: true, authority_elevated: true, is_generic_reframed: false },
};

describe('PRODUCT-RESTORE-001 — producer restored', () => {
  it('produces ALL SIX strategic fields (none null/empty) — the capability is alive', () => {
    const [out] = enrichRecommendationIntelligence([rec], profile);
    for (const field of SIX_FIELDS) {
      expect(out.intelligence[field]).toBeTruthy();
    }
  });

  // Rules D and B were intentionally superseded by D′ (PRODUCT-IMPLEMENTATION-002) and
  // B′ (PRODUCT-IMPLEMENTATION-003). Rules A, C, E and F remain historically verbatim
  // and are still pinned exactly; B′/D′ are pinned to their new exact values below.
  it('reproduces the historical deterministic rules A/C/E/F exactly (B → B′, D → D′)', () => {
    const [out] = enrichRecommendationIntelligence([rec], profile);
    expect(out.intelligence).toEqual({
      // RULE A — audience + core_problem_statement, topic-aware
      problem_being_solved:
        'Helping B2B founders overcome inconsistent content prioritization — with focus on Content Prioritization',
      // RULE B′ (PRODUCT-IMPLEMENTATION-003) — historical core (awareness_gap wins over the
      // diamond/default branches) + per-recommendation qualifier + topic anchor.
      gap_being_filled: 'Audience lacks awareness of: how compounding beats volume — demand is already concentrated for Content Prioritization.',
      // RULE C — volume >= 50% of volumeMax ⇒ popularity branch
      why_now: 'Audience attention already exists; opportunity is differentiation.',
      // RULE D′ (PRODUCT-IMPLEMENTATION-002) — most-relevant domain + topic anchor.
      // Historically this was `domains[0]` with no topic: 'Company has credibility in content strategy.'
      authority_reason: 'Company has credibility in content strategy — directly relevant to Content Prioritization.',
      // RULE E — life_with_problem → desired_transformation, topic-aware
      expected_transformation:
        'Move audience from scattered ad-hoc posting toward a predictable authority engine through Content Prioritization',
      // RULE F — diamond_candidate mapping
      campaign_angle: 'Gap exposure → Education → Conversion',
    });
  });

  it('is deterministic — identical input yields identical output', () => {
    const a = enrichRecommendationIntelligence([rec], profile);
    const b = enrichRecommendationIntelligence([rec], profile);
    expect(a).toEqual(b);
  });

  it('performs NO network/LLM call', async () => {
    const spy = jest.spyOn(global, 'fetch' as never).mockImplementation((() => {
      throw new Error('producer must not perform network I/O');
    }) as never);
    expect(() => enrichRecommendationIntelligence([rec], profile)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still populates all six with a null profile (non-null guarantee preserved)', () => {
    const [out] = enrichRecommendationIntelligence([rec], null);
    for (const field of SIX_FIELDS) {
      if (field === 'authority_reason') continue; // legitimately null without a profile
      expect(out.intelligence[field]).toBeTruthy();
    }
  });

  it('returns [] for an empty input set', () => {
    expect(enrichRecommendationIntelligence([], profile)).toEqual([]);
  });
});

describe('PRODUCT-IMPLEMENTATION-003 — B′ recommendation-aware gap_being_filled', () => {
  const p = (over: Record<string, unknown> = {}) => ({
    target_audience: 'B2B founders', core_problem_statement: 'x', desired_transformation: 'y', ...over,
  } as unknown as CompanyProfile);
  const card = (title: string, over: Record<string, unknown> = {}) => ({
    topic: title.toLowerCase(), polished_title: title, volume: 10, diamond_score: 0.1,
    polish_flags: { diamond_candidate: false, authority_elevated: false, is_generic_reframed: false },
    ...over,
  });

  it('preserves the historical CORE selection (awareness_gap > diamond > default)', () => {
    const withGap = enrichRecommendationIntelligence([card('T')], p({ awareness_gap: 'hidden switching cost' }));
    expect(withGap[0].intelligence.gap_being_filled).toContain('Audience lacks awareness of: hidden switching cost');

    const diamond = enrichRecommendationIntelligence(
      [card('T', { polish_flags: { diamond_candidate: true, authority_elevated: false, is_generic_reframed: false } })], p());
    expect(diamond[0].intelligence.gap_being_filled).toContain('Underserved but high-alignment opportunity');

    const dflt = enrichRecommendationIntelligence([card('T')], p());
    expect(dflt[0].intelligence.gap_being_filled).toContain('Existing demand lacking clear authority-driven guidance');
  });

  it('produces DIFFERENT gap narrative across cards of the same company (the fix)', () => {
    // Same company-level awareness_gap — historically identical on every card.
    const out = enrichRecommendationIntelligence([
      card('Alpha Report', { volume: 100, sources: ['a', 'b', 'c'] }),
      card('Beta Review', { volume: 5 }),
      card('Gamma Guide', { volume: 5, polish_flags: { diamond_candidate: true, authority_elevated: false, is_generic_reframed: false } }),
    ], p({ awareness_gap: 'hidden switching cost' }));
    const values = out.map((o) => o.intelligence.gap_being_filled);
    expect(new Set(values).size).toBe(3);
    expect(values.every((v) => v!.includes('hidden switching cost'))).toBe(true); // core still grounded
  });

  it('uses only MEASURED signals for the qualifier (corroboration count is real)', () => {
    const [out] = enrichRecommendationIntelligence([card('T', { sources: ['a', 'b', 'c', 'd'] })], p());
    expect(out.intelligence.gap_being_filled).toContain('corroborated across 4 sources');
  });

  it('falls back through the qualifier chain deterministically', () => {
    // Demand is RELATIVE to volumeMax, so a low-demand card needs a higher-volume sibling
    // (with a single recommendation, volume === volumeMax and the demand branch always wins —
    // the same relative-banding property the historical RULE C already had).
    const out = enrichRecommendationIntelligence([
      card('High Demand', { volume: 100 }),
      card('Reframed', { volume: 1, polish_flags: { diamond_candidate: false, authority_elevated: false, is_generic_reframed: true } }),
      card('Thin', { volume: 1 }),
    ], p());
    expect(out[0].intelligence.gap_being_filled).toContain('demand is already concentrated');
    expect(out[1].intelligence.gap_being_filled).toContain('the framing is crowded');
    expect(out[2].intelligence.gap_being_filled).toContain('coverage is thin relative to intent');
  });

  it('is deterministic and never empty', () => {
    const run = () => enrichRecommendationIntelligence([card('T', { sources: ['a', 'b'] })], p({ awareness_gap: 'g' }))[0].intelligence.gap_being_filled;
    expect(run()).toBe(run());
    expect(String(run()).length).toBeGreaterThan(0);
  });
});

describe('PRODUCT-IMPLEMENTATION-002 — D′ recommendation-aware authority_reason', () => {
  const multi = (domains: string[]) => ({
    target_audience: 'B2B founders',
    core_problem_statement: 'x', desired_transformation: 'y',
    authority_domains: domains,
  } as unknown as CompanyProfile);

  const card = (title: string) => ({
    topic: title.toLowerCase(), polished_title: title, volume: 10, diamond_score: 0.1,
    polish_flags: { diamond_candidate: false, authority_elevated: true, is_generic_reframed: false },
  });

  it('selects the authority domain that MATCHES the recommendation topic', () => {
    const profileMulti = multi(['supply chain analytics', 'content strategy', 'pricing science']);
    const [a] = enrichRecommendationIntelligence([card('Content Strategy Playbook')], profileMulti);
    const [b] = enrichRecommendationIntelligence([card('Pricing Science Benchmarks')], profileMulti);
    expect(a.intelligence.authority_reason).toContain('content strategy');
    expect(b.intelligence.authority_reason).toContain('pricing science');
  });

  it('produces DIFFERENT authority reasoning across cards of the same company (the fix)', () => {
    const profileMulti = multi(['supply chain analytics', 'content strategy']);
    const out = enrichRecommendationIntelligence(
      [card('Content Strategy Playbook'), card('Supply Chain Analytics Review')],
      profileMulti,
    );
    const values = out.map((o) => o.intelligence.authority_reason);
    expect(new Set(values).size).toBe(2); // previously both were identical (domains[0])
  });

  it('breaks ties deterministically via stable hash (no randomness)', () => {
    const profileMulti = multi(['alpha domain', 'beta domain', 'gamma domain']); // none overlap the topic
    const runs = Array.from({ length: 5 }, () =>
      enrichRecommendationIntelligence([card('Unrelated Topic')], profileMulti)[0].intelligence.authority_reason);
    expect(new Set(runs).size).toBe(1);                       // stable across runs
    expect(runs[0]).toMatch(/alpha domain|beta domain|gamma domain/); // and a real domain
  });

  it('is unchanged for a single-domain company (strict generalization of domains[0])', () => {
    const [out] = enrichRecommendationIntelligence([card('Anything At All')], multi(['content strategy']));
    expect(out.intelligence.authority_reason).toBe(
      'Company has credibility in content strategy — directly relevant to Anything At All.');
  });

  it('emits the HISTORICAL sentence verbatim when no topic is available', () => {
    const [out] = enrichRecommendationIntelligence(
      [{ topic: '', polished_title: '', polish_flags: { diamond_candidate: false, authority_elevated: true, is_generic_reframed: false } }],
      multi(['content strategy']),
    );
    expect(out.intelligence.authority_reason).toBe('Company has credibility in content strategy.');
  });

  it('preserves null-return conditions exactly (load-bearing for stage assignment)', () => {
    const notElevated = { ...card('T'), polish_flags: { diamond_candidate: false, authority_elevated: false, is_generic_reframed: false } };
    expect(enrichRecommendationIntelligence([notElevated], multi(['content strategy']))[0].intelligence.authority_reason).toBeNull();
    expect(enrichRecommendationIntelligence([card('T')], multi([]))[0].intelligence.authority_reason).toBeNull();
    expect(enrichRecommendationIntelligence([card('T')], multi(['   ']))[0].intelligence.authority_reason).toBeNull();
    expect(enrichRecommendationIntelligence([card('T')], null)[0].intelligence.authority_reason).toBeNull();
  });
});

describe('PRODUCT-RESTORE-001 — feature flag', () => {
  const prev = process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
  afterEach(() => {
    if (prev === undefined) delete process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
    else process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR] = prev;
  });

  it('defaults OFF (restoration lands dark)', () => {
    delete process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR];
    expect(strategicRecommendationIntelligenceEnabled()).toBe(false);
  });

  it('enables only on the exact string "true"', () => {
    process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR] = 'true';
    expect(strategicRecommendationIntelligenceEnabled()).toBe(true);
    for (const v of ['1', 'yes', 'on', 'TRUE', '']) {
      process.env[STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENV_VAR] = v;
      expect(strategicRecommendationIntelligenceEnabled()).toBe(false);
    }
  });
});

describe('PRODUCT-RESTORE-001 — engine wiring guard (anti-silent-loss)', () => {
  const engineSrc = readFileSync(
    join(__dirname, '../../services/recommendationEngine/engine.ts'),
    'utf8',
  );

  it('the recommendation engine imports the restored producer', () => {
    expect(engineSrc).toContain('strategicRecommendationIntelligenceService');
    expect(engineSrc).toContain('enrichRecommendationIntelligence');
  });

  it('the engine calls the producer on BOTH the primary and fallback paths', () => {
    const calls = engineSrc.match(/enrichRecommendationIntelligence\s*\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('the engine no longer contains the "removed upstream" no-op markers', () => {
    expect(engineSrc).not.toContain('Intelligence enrichment was removed upstream');
    expect(engineSrc).not.toContain('Intelligence enrichment removed upstream');
  });
});
