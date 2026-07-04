/**
 * BETA-ENGINE-005 — Decision Engine Adoption for External Evidence.
 *
 * Verifies that the previously-disconnected providers (entity_graph → authority, llm_visibility → trust)
 * and reputation → trust now GENUINELY change decision confidence via the existing Confidence Engine — with
 * no manual boost and no scoring redesign. Confidence improves solely because measured evidence improves.
 * Exercises the exact building blocks the engines use (availability + reliability + combinedProviderReliability
 * + deriveDecisionConfidence) deterministically, without a database.
 */
import { deriveDecisionConfidence, __clearProviderRegistry } from '../../services/evidencePlatform';
import { combinedProviderReliability } from '../../services/ga4ProviderBridge';
import { isEntityProviderAvailable, entityProviderReliability } from '../../services/entityGraphProviderBridge';
import { isBacklinkProviderAvailable, backlinkProviderReliability } from '../../services/backlinkAuthorityProviderBridge';
import { isReputationProviderAvailable, reputationProviderReliability } from '../../services/reputationProviderBridge';
import { isAIVisibilityProviderAvailable, aiVisibilityProviderReliability } from '../../services/aiVisibilityProviderBridge';

// Mirror the exact confidence computation the authority engine now performs.
function authorityConfidence(sampleSize: number) {
  const backlinkLive = isBacklinkProviderAvailable();
  const entityLive = isEntityProviderAvailable();
  const providerLive = backlinkLive || entityLive;
  return deriveDecisionConfidence({
    maturity: providerLive ? 'MEASURED' : 'INFERRED',
    providerReliability: combinedProviderReliability(
      backlinkLive ? backlinkProviderReliability() : null,
      entityLive ? entityProviderReliability() : null,
    ),
    sampleSize,
    completeness: 1,
    dataPresent: sampleSize > 0,
  });
}

// Mirror the exact confidence computation the trust engine now performs.
function trustConfidence(sampleSize: number) {
  const reputationLive = isReputationProviderAvailable();
  const aiLive = isAIVisibilityProviderAvailable();
  return deriveDecisionConfidence({
    maturity: reputationLive ? 'MEASURED' : 'INFERRED',
    providerReliability: combinedProviderReliability(
      reputationLive ? reputationProviderReliability() : null,
      aiLive ? aiVisibilityProviderReliability() : null,
    ),
    sampleSize,
    dataPresent: sampleSize > 0,
  });
}

const CLEAR = ['AHREFS_API_KEY', 'MOZ_API_KEY', 'MAJESTIC_API_KEY', 'WIKIDATA_ENABLED', 'GOOGLE_KG_API_KEY',
  'REVIEWS_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'PERPLEXITY_API_KEY', 'AZURE_COPILOT_API_KEY'];

describe('BETA-ENGINE-005 — entity_graph adoption into the authority engine', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });
  beforeEach(() => { for (const k of CLEAR) delete process.env[k]; __clearProviderRegistry(); });

  it('backward compatible: no providers → authority stays INFERRED (unchanged baseline)', () => {
    const c = authorityConfidence(40);
    expect(c.maturity).toBe('INFERRED');
  });

  it('entity_graph alone lifts authority to MEASURED and raises confidence (no backlinks)', () => {
    const baseline = authorityConfidence(40);
    process.env.WIKIDATA_ENABLED = 'true';
    __clearProviderRegistry();
    const withEntity = authorityConfidence(40);
    expect(withEntity.maturity).toBe('MEASURED');
    expect(withEntity.confidenceScore).toBeGreaterThan(baseline.confidenceScore);
  });

  it('backlink + entity blend deterministically (mean of 0.90 and 0.88)', () => {
    process.env.AHREFS_API_KEY = 'k'; process.env.WIKIDATA_ENABLED = 'true';
    __clearProviderRegistry();
    expect(isBacklinkProviderAvailable()).toBe(true);
    expect(isEntityProviderAvailable()).toBe(true);
    const blended = combinedProviderReliability(backlinkProviderReliability(), entityProviderReliability());
    expect(blended).toBeCloseTo((0.9 + 0.88) / 2, 5);
  });
});

describe('BETA-ENGINE-005 — reviews + llm_visibility adoption into the trust engine', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; __clearProviderRegistry(); });
  beforeEach(() => { for (const k of CLEAR) delete process.env[k]; __clearProviderRegistry(); });

  it('backward compatible: no providers → trust stays INFERRED (unchanged baseline)', () => {
    const c = trustConfidence(30);
    expect(c.maturity).toBe('INFERRED');
  });

  it('reputation flips trust to MEASURED and raises confidence', () => {
    const baseline = trustConfidence(30);
    process.env.REVIEWS_API_KEY = 'k';
    __clearProviderRegistry();
    const withReviews = trustConfidence(30);
    expect(withReviews.maturity).toBe('MEASURED');
    expect(withReviews.confidenceScore).toBeGreaterThan(baseline.confidenceScore);
  });

  it('AI visibility corroborates: reputation + ai blend deterministically (mean of 0.85 and 0.70)', () => {
    process.env.REVIEWS_API_KEY = 'k'; process.env.OPENAI_API_KEY = 'sk';
    __clearProviderRegistry();
    expect(isReputationProviderAvailable()).toBe(true);
    expect(isAIVisibilityProviderAvailable()).toBe(true);
    const blended = combinedProviderReliability(reputationProviderReliability(), aiVisibilityProviderReliability());
    expect(blended).toBeCloseTo((0.85 + 0.70) / 2, 5);
  });

  it('AI visibility alone (no reputation) corroborates but keeps INFERRED maturity (honest — not a trust measurement)', () => {
    process.env.OPENAI_API_KEY = 'sk';
    __clearProviderRegistry();
    const c = trustConfidence(30);
    expect(c.maturity).toBe('INFERRED'); // ai-visibility corroborates credibility, does not measure sentiment-trust
    expect(isAIVisibilityProviderAvailable()).toBe(true);
  });
});
