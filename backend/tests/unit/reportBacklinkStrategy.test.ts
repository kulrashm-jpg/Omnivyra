/**
 * BACKLINK AUTHORITY + CONTEXTUAL LINK STRATEGY — Report 1
 *
 * Two separable claims are under test, and the tests are deliberately organised around the two
 * ways they get conflated in practice:
 *
 *   OBSERVATION    an unavailable provider must never read as "this company's backlinks are weak",
 *                  and a provider-reported zero must stay a measured zero.
 *   RECOMMENDATION a strategy must come from the company's CONTEXT, must label declared context as
 *                  declared forever, must recommend TYPES rather than targets, and must never cite
 *                  the ABSENCE of backlink data as a reason to pursue a particular type.
 *
 * The structural tests at the end are the ones that survive refactoring: the module's import list
 * is asserted against an allowlist, which is what actually makes "cannot mutate a profile, cannot
 * create a prospect" true rather than merely intended.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  buildBacklinkStrategy,
  summarizeBacklinkObservation,
  assessBacklinkGrowth,
  BACKLINK_TYPE_KEYS,
  RELEVANCE_DIMENSION_KEYS,
  type BacklinkStrategyInput,
  type BacklinkStrategyRecommendation,
} from '../../services/canonicalReport/reportBacklinkStrategy';
import {
  isBacklinkProviderConfigured,
  registerBacklinkProvider,
} from '../../services/backlinkAuthorityProviderBridge';
import { __clearProviderRegistry } from '../../services/evidencePlatform';

const MODULE_PATH = path.join(
  __dirname, '..', '..', 'services', 'canonicalReport', 'reportBacklinkStrategy.ts',
);

/** A company with declared context only — the common real case. */
const declaredOnly: BacklinkStrategyInput = {
  declared: {
    category: 'structured thinking and decision-support tools',
    offering: 'multilingual clarity assistant',
    positioning: 'culturally aware guidance for life and career decisions',
    target_market: 'individuals making career and life decisions',
    geography: 'India',
    business_priorities: 'build credibility in an emerging category',
  },
};

const allText = (rec: BacklinkStrategyRecommendation): string => [
  rec.strategicRole, rec.whyItMatters, rec.companyContext, rec.marketContext ?? '',
  rec.recommendedAsset, rec.suggestedAcquisitionMotion, rec.measurementMethod,
  ...rec.evidenceBasis, ...rec.dependencies, ...rec.caveats,
  ...rec.relevance.map((r) => r.rationale),
].join(' \n ');

// ── 1-3. CONTEXT AWARENESS ──────────────────────────────────────────────────

describe('the strategy is derived from company, market and geographic context', () => {
  it('1 — uses declared company context, and the recommendations reflect it', () => {
    const strategy = buildBacklinkStrategy(declaredOnly);
    expect(strategy.abstained).toBe(false);
    expect(strategy.recommendations.length).toBeGreaterThan(0);
    for (const rec of strategy.recommendations) {
      expect(rec.companyContext).toContain('structured thinking and decision-support tools');
      expect(rec.evidenceBasis.length).toBeGreaterThan(0);
    }
    // It is a proposal at the type level, never a measurement or a decision.
    expect(strategy.kind).toBe('proposal');
    expect(strategy.state).not.toBe('measured');
  });

  it('2 — a publicly observed market signal is carried as observed market context', () => {
    const strategy = buildBacklinkStrategy({
      ...declaredOnly,
      observedMarketSignals: [{ value: 'career decision guidance', source: 'serp' }],
    });
    const rec = strategy.recommendations[0];
    expect(rec.marketContext).toContain('career decision guidance');
    expect(rec.evidenceBasis.join(' ')).toContain('Publicly observed market signals');
  });

  it('3 — regional authority is recommended only when a geography is genuinely established', () => {
    const withGeo = buildBacklinkStrategy(declaredOnly);
    expect(withGeo.recommendations.map((r) => r.backlinkType)).toContain('regional_authority');

    const { geography: _dropped, ...withoutGeography } = declaredOnly.declared ?? {};
    const noGeo = buildBacklinkStrategy({ declared: withoutGeography });
    // No geography established → the geography-driven type abstains rather than guessing a region.
    expect(noGeo.recommendations.map((r) => r.backlinkType)).not.toContain('regional_authority');
  });
});

// ── 4-6. RELEVANCE MODEL ────────────────────────────────────────────────────

describe('the relevance model is reported per dimension, never collapsed', () => {
  it('every recommendation exposes all nine dimensions and no numeric score', () => {
    const rec = buildBacklinkStrategy(declaredOnly).recommendations[0];
    expect(rec.relevance.map((r) => r.dimension).sort()).toEqual([...RELEVANCE_DIMENSION_KEYS].sort());
    // No invented single opportunity score exists on the shape.
    expect(Object.keys(rec)).not.toContain('score');
    expect(Object.keys(rec)).not.toContain('opportunityScore');
    expect(typeof rec.priority).toBe('string');
  });

  it('4 — topical relevance supports a topic-driven type when subject matter is established', () => {
    const rec = buildBacklinkStrategy(declaredOnly).recommendations
      .find((r) => r.backlinkType === 'topical_editorial');
    expect(rec?.relevance.find((d) => d.dimension === 'topical')?.verdict).toBe('supports');
  });

  it('5 — audience relevance is unknown, not neutral, when no market is established', () => {
    const strategy = buildBacklinkStrategy({
      assets: { topicsCovered: ['decision frameworks'] },
    });
    const rec = strategy.recommendations.find((r) => r.backlinkType === 'topical_editorial');
    const audience = rec?.relevance.find((d) => d.dimension === 'audience');
    expect(audience?.verdict).toBe('unknown');
    // `unknown` must not be reported as a considered judgement.
    expect(audience?.verdict).not.toBe('neutral');
  });

  it('6 — earnability reflects whether the earning asset actually exists', () => {
    const present = buildBacklinkStrategy({
      ...declaredOnly, assets: { hasOriginalResearch: true },
    }).recommendations.find((r) => r.backlinkType === 'research_data_citation');
    expect(present?.relevance.find((d) => d.dimension === 'earnability')?.verdict).toBe('supports');
    expect(present?.priority).toBe('now');

    const absent = buildBacklinkStrategy({
      ...declaredOnly, assets: { hasOriginalResearch: false },
    }).recommendations.find((r) => r.backlinkType === 'research_data_citation');
    expect(absent?.relevance.find((d) => d.dimension === 'earnability')?.verdict).toBe('against');
    // An asset that must be built first is a prerequisite, never an immediate opportunity.
    expect(absent?.priority).not.toBe('now');
    expect(absent?.dependencies.join(' ')).toMatch(/not evidenced on the site today/i);
  });
});

// ── 7. EVIDENCE STATE PROPAGATION ───────────────────────────────────────────

describe('evidence state propagates and declared never becomes observed', () => {
  it('7 — declared-only context yields declared recommendations, never observed', () => {
    const strategy = buildBacklinkStrategy(declaredOnly);
    for (const rec of strategy.recommendations) {
      expect(rec.evidenceState).toBe('declared');
      expect(rec.evidenceState).not.toBe('observed');
      expect(rec.provenance).toBe('INFERRED');
      expect(rec.caveats.join(' ')).toMatch(/strategic inference, not an observed opportunity/i);
    }
    expect(strategy.limitations.join(' ')).toMatch(/rests? on declared context/i);
  });

  it('an observed site topic upgrades the basis to observed — the weakest state still governs', () => {
    const strategy = buildBacklinkStrategy({
      declared: { category: 'decision support', target_market: 'career changers' },
      assets: { topicsCovered: ['decision frameworks', 'career clarity'] },
      observedMarketSignals: [{ value: 'career clarity tools', source: 'serp' }],
    });
    const rec = strategy.recommendations.find((r) => r.backlinkType === 'topical_editorial');
    // Wording clarified: these are literal title/heading text observed on the company's own
    // pages, so "subjects" rather than "topics". Evidence semantics are unchanged.
    expect(rec?.evidenceBasis.join(' ')).toContain('Observed site subjects');
    // Positioning was not supplied, so nothing declared entered the basis: state is observed.
    expect(rec?.evidenceState).toBe('observed');
    expect(rec?.provenance).toBe('PUBLIC_OBSERVED');
  });

  it('a private-source signal is excluded from the basis rather than relabelled', () => {
    const strategy = buildBacklinkStrategy({
      ...declaredOnly,
      observedMarketSignals: [{ value: 'crm-derived segment', source: 'gsc' }],
    });
    expect(strategy.report1_clean).toBe(false);
    for (const rec of strategy.recommendations) {
      expect(allText(rec)).not.toContain('crm-derived segment');
    }
    expect(strategy.limitations.join(' ')).toMatch(/private source/i);
  });
});

// ── 8. TYPE, NOT TARGET ─────────────────────────────────────────────────────

describe('recommendations name types, never targets', () => {
  it('8 — no output field contains a URL, domain or fabricated publisher', () => {
    const strategy = buildBacklinkStrategy({
      ...declaredOnly,
      observedMarketSignals: [{ value: 'career decision guidance', source: 'serp' }],
      assets: { topicsCovered: ['decision frameworks'], hasOriginalResearch: true, hasCaseStudies: true },
    });
    expect(strategy.recommendations.length).toBeGreaterThan(0);
    for (const rec of strategy.recommendations) {
      const body = allText(rec);
      expect(body).not.toMatch(/https?:\/\//i);
      expect(body).not.toMatch(/www\./i);
      // No bare domain-looking token (e.g. "techcrunch.com"). The '.com' family is enough to catch
      // a fabricated outlet without flagging ordinary prose.
      expect(body).not.toMatch(/\b[a-z0-9-]+\.(com|co|io|net|org|in)\b/i);
      expect(rec.backlinkType).toEqual(expect.any(String));
      expect(BACKLINK_TYPE_KEYS).toContain(rec.backlinkType);
    }
  });

  it('never recommends volume or paid tactics — the taxonomy contains no such type', () => {
    const forbidden = /directory submission|guest.post network|paid link|link farm|buy links|PBN/i;
    const strategy = buildBacklinkStrategy({ ...declaredOnly, assets: { hasOriginalResearch: true } });
    for (const rec of strategy.recommendations) expect(allText(rec)).not.toMatch(forbidden);
    for (const key of BACKLINK_TYPE_KEYS) expect(key).not.toMatch(/director|guest_post|paid/i);
  });

  it('domain authority is not an input: a high-authority irrelevant source is not made valuable', () => {
    const highAuthority = buildBacklinkStrategy({
      ...declaredOnly,
      measurement: {
        state: 'measured', referring_domains: 4, backlinks: 9, authority: 95,
        observed_at: '2026-01-01T00:00:00.000Z', source: 'backlink_api',
      },
    });
    const baseline = buildBacklinkStrategy(declaredOnly);
    // The provider's authority reading changes no recommendation and no priority.
    expect(highAuthority.recommendations.map((r) => `${r.backlinkType}:${r.priority}`))
      .toEqual(baseline.recommendations.map((r) => `${r.backlinkType}:${r.priority}`));
  });
});

// ── 9-10. OBSERVATION HONESTY ───────────────────────────────────────────────

describe('observation and recommendation stay separate', () => {
  it('9 — an unavailable provider is never a reason to recommend anything', () => {
    const strategy = buildBacklinkStrategy({
      ...declaredOnly,
      measurement: {
        state: 'unavailable', referring_domains: null, backlinks: null, authority: null,
        observed_at: null, source: 'backlink_api',
        reason_unavailable: 'AHREFS_API_KEY not configured.',
      },
    });
    for (const rec of strategy.recommendations) {
      const basis = rec.evidenceBasis.join(' ');
      expect(basis).not.toMatch(/not configured|unavailable|not measured|no backlink/i);
    }
    // And with NO context at all, an unavailable provider produces no recommendation whatsoever.
    const contextless = buildBacklinkStrategy({
      measurement: {
        state: 'unavailable', referring_domains: null, backlinks: null, authority: null,
        observed_at: null, source: 'backlink_api', reason_unavailable: 'no key',
      },
    });
    expect(contextless.abstained).toBe(true);
    expect(contextless.recommendations).toHaveLength(0);
  });

  it('an unavailable provider is reported as unmeasured, never as weak backlinks', () => {
    const obs = summarizeBacklinkObservation({
      measurement: {
        state: 'unavailable', referring_domains: null, backlinks: null, authority: null,
        observed_at: null, source: 'backlink_api', reason_unavailable: 'AHREFS_API_KEY not configured.',
      },
    });
    expect(obs.state).toBe('unavailable');
    expect(obs.referring_domains).toBeNull();
    expect(obs.referring_domains).not.toBe(0);
    expect(obs.provenance).toBe('UNAVAILABLE');
    expect(obs.limitations.join(' ')).toMatch(/not a finding about this company/i);
    expect(obs.limitations.join(' ')).toMatch(/no comparison against other companies/i);
  });

  it('10 — a provider-reported zero remains a measured zero', () => {
    const obs = summarizeBacklinkObservation({
      comparabilityKey: 'k1',
      measurement: {
        state: 'measured', referring_domains: 0, backlinks: 0, authority: 0,
        observed_at: '2026-01-01T00:00:00.000Z', source: 'backlink_api',
      },
    });
    expect(obs.state).toBe('measured');
    expect(obs.referring_domains).toBe(0);
    expect(obs.referring_domains).not.toBeNull();
    expect(obs.reason_unavailable).toBeNull();
  });
});

// ── 11. PROVIDER STATE ──────────────────────────────────────────────────────

describe('11 — an unsupported provider key cannot create a healthy provider state', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });

  it('MOZ_API_KEY alone yields no configured/healthy backlink provider', () => {
    delete process.env.AHREFS_API_KEY;
    process.env.MOZ_API_KEY = 'synthetic-not-a-real-credential';
    expect(isBacklinkProviderConfigured()).toBe(false);
    const descriptor = registerBacklinkProvider();
    expect(descriptor.authStatus).toBe('unauthenticated');
    expect(descriptor.health).not.toBe('healthy');
  });
});

// ── 12. HISTORICAL GROWTH ───────────────────────────────────────────────────

describe('12 — growth requires two or more comparable observations', () => {
  const measurement = {
    state: 'measured' as const, referring_domains: 40, backlinks: 120, authority: 30,
    observed_at: '2026-02-01T00:00:00.000Z', source: 'backlink_api' as const,
  };

  it('one snapshot is a current profile, never momentum', () => {
    const growth = assessBacklinkGrowth({ comparabilityKey: 'k1', measurement, history: [] });
    expect(growth.state).toBe('insufficient_history');
    expect(growth.referring_domain_delta).toBeNull();
    expect(growth.reason).toMatch(/not growth/i);
  });

  it('two comparable observations produce measured change', () => {
    const growth = assessBacklinkGrowth({
      comparabilityKey: 'k1', measurement,
      history: [{ referring_domains: 25, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'k1' }],
    });
    expect(growth.state).toBe('measured');
    expect(growth.referring_domain_delta).toBe(15);
    expect(growth.comparable_observations).toBe(2);
  });

  it('a non-comparable prior snapshot is not used', () => {
    const growth = assessBacklinkGrowth({
      comparabilityKey: 'k1', measurement,
      history: [{ referring_domains: 25, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'DIFFERENT' }],
    });
    expect(growth.state).toBe('insufficient_history');
    expect(growth.referring_domain_delta).toBeNull();
  });

  it('without a comparability identity nothing is comparable', () => {
    const growth = assessBacklinkGrowth({
      comparabilityKey: null, measurement,
      history: [{ referring_domains: 25, observed_at: '2026-01-01T00:00:00.000Z', comparability_key: 'k1' }],
    });
    expect(growth.state).toBe('not_comparable');
    expect(growth.referring_domain_delta).toBeNull();
    expect(growth.reason).toMatch(/Current profile only/i);
  });
});

// ── 13-14. STRUCTURAL GUARANTEES ────────────────────────────────────────────

describe('13/14 — cannot mutate a profile or create a prospect', () => {
  it('the module imports nothing that could perform I/O or a write', () => {
    const source = fs.readFileSync(MODULE_PATH, 'utf8');
    const imports = [...source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)]
      .map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    // An allowlist, not a denylist: a module that can only reach these two cannot write anywhere.
    // Deduplicated because `../evidenceProvenance` is imported twice, once for a type and once
    // for its two pure functions.
    const distinct = [...new Set(imports)].sort();
    expect(distinct).toEqual(['../evidenceProvenance', './canonicalReportTypes']);
    expect(source).not.toMatch(/require\(/);
  });

  it('the output shape carries no prospect, lead or target field', () => {
    const rec = buildBacklinkStrategy(declaredOnly).recommendations[0];
    for (const key of Object.keys(rec)) {
      expect(key).not.toMatch(/prospect|lead|target|contact|outreach|publisher|domain|url/i);
    }
  });

  it('the input is not mutated — the caller\'s profile object is untouched', () => {
    const input: BacklinkStrategyInput = {
      declared: { ...declaredOnly.declared },
      assets: { topicsCovered: ['decision frameworks'] },
    };
    const before = JSON.stringify(input);
    Object.freeze(input);
    Object.freeze(input.declared);
    expect(() => buildBacklinkStrategy(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('abstains rather than emitting generic advice when there is no context', () => {
    const strategy = buildBacklinkStrategy({});
    expect(strategy.abstained).toBe(true);
    expect(strategy.recommendations).toHaveLength(0);
    expect(strategy.state).toBe('insufficient_signal');
    expect(strategy.abstention_reason).toMatch(/Generic link-building advice/i);
    expect(strategy.limitations.join(' ')).toMatch(/not evidence about this company/i);
  });
});
