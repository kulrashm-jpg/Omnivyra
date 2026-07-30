/**
 * COMPETITOR-RANKING-IMPLEMENTATION-001 — Always Return Ranked Competitor Intelligence.
 *
 * Confidence must determine RANKING, not VISIBILITY. A candidate with meaningful
 * evidence is always surfaced (ranked into its scoring-assigned tier) instead of
 * being hidden merely because it fell below the legacy 0.6-confidence / 40-score
 * thresholds. Genuine insufficiency (invalid / blocked / unrelated / cross-category /
 * no-evidence) and explicit user "Not a Competitor" feedback remain suppressed.
 */
import {
  getFinalCompetitorsSync,
  extractCompetitiveContextFromProfile,
  competitorAlwaysRankEnabled,
} from '../../services/competitorEngineService';
import { buildCompetitorFeedbackMemory } from '../../services/competitorFeedbackService';
import type { CompanyProfile } from '../../services/companyProfileService';
import type { CompetitorCandidate } from '../../services/competitorEngineService';

const drishikProfile: CompanyProfile = {
  company_id: 'drishik',
  name: 'Drishik',
  industry: 'AI wellness and decision intelligence',
  category: 'AI clarity platform',
  products_services: 'AI clarity engine for self-reflection, emotional wellbeing, and life decisions',
  products_services_list: [
    'AI clarity engine',
    'self-reflection guidance',
    'emotional wellbeing decision support',
  ],
  target_audience: 'individuals seeking personal clarity and guided self-reflection',
  geography: 'Global',
  report_settings: {
    company_facts: { team_size: '1-10', revenue_range: 'Pre-revenue', founded_year: '2024' },
  },
} as unknown as CompanyProfile;

// A genuine same-category competitor whose evidence is real but whose enrichment
// confidence (0.4) sits below the legacy 0.6 gate — the exact case the feature
// exists to rescue.
const lowConfidenceSameCategory: CompetitorCandidate = {
  name: 'ClarityLite',
  source: 'manual',
  category: 'mental wellness AI',
  description:
    'AI-guided mental wellbeing and self-reflection app offering emotional support, guided journaling, and personal clarity coaching for individuals.',
  targetCustomer:
    'individuals seeking personal clarity and guided self-reflection and emotional wellbeing',
  geography: 'Global',
  productSignals: ['AI clarity', 'self-reflection', 'emotional wellbeing'],
  confidenceScore: 0.4,
  enrichment: {
    name: 'ClarityLite',
    domain: 'claritylite.example',
    category: 'mental_wellness_ai',
    tags: [],
    description:
      'AI-guided mental wellbeing and self-reflection app with guided journaling and personal clarity coaching.',
    confidence_score: 0.4,
    icp: {
      age_group: 'adults',
      use_case: 'self-reflection and emotional wellbeing clarity',
      user_intent: 'personal clarity and decision support',
    },
  } as CompetitorCandidate['enrichment'],
};

describe('competitorAlwaysRankEnabled flag', () => {
  const original = process.env.COMPETITOR_ALWAYS_RANK;
  afterEach(() => {
    if (original === undefined) delete process.env.COMPETITOR_ALWAYS_RANK;
    else process.env.COMPETITOR_ALWAYS_RANK = original;
  });

  it('defaults ON when unset', () => {
    delete process.env.COMPETITOR_ALWAYS_RANK;
    expect(competitorAlwaysRankEnabled()).toBe(true);
  });

  it('is a reversible kill-switch (0 / false disable it)', () => {
    process.env.COMPETITOR_ALWAYS_RANK = '0';
    expect(competitorAlwaysRankEnabled()).toBe(false);
    process.env.COMPETITOR_ALWAYS_RANK = 'false';
    expect(competitorAlwaysRankEnabled()).toBe(false);
    process.env.COMPETITOR_ALWAYS_RANK = '1';
    expect(competitorAlwaysRankEnabled()).toBe(true);
  });
});

describe('COMPETITOR-RANKING-IMPLEMENTATION-001 — always-rank surfacing', () => {
  const original = process.env.COMPETITOR_ALWAYS_RANK;
  afterEach(() => {
    if (original === undefined) delete process.env.COMPETITOR_ALWAYS_RANK;
    else process.env.COMPETITOR_ALWAYS_RANK = original;
  });

  it('legacy mode hides a sub-confidence same-category candidate', () => {
    process.env.COMPETITOR_ALWAYS_RANK = '0';
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [{ name: 'Wysa', source: 'manual' }, lowConfidenceSameCategory],
      max: 10,
    });
    expect(ranked.map((c) => c.name)).not.toContain('ClarityLite');
  });

  it('always-rank surfaces the SAME candidate, ranked with transparent confidence', () => {
    delete process.env.COMPETITOR_ALWAYS_RANK; // default ON
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [{ name: 'Wysa', source: 'manual' }, lowConfidenceSameCategory],
      max: 10,
    });
    const claritylite = ranked.find((c) => c.name === 'ClarityLite');
    expect(claritylite).toBeDefined();
    // Confidence is preserved and exposed (ranking input), not used to hide.
    expect(Number(claritylite?.enrichment_confidence_score)).toBeCloseTo(0.4, 5);
    // It carries a scoring-assigned tier and a rationale for display.
    expect(claritylite?.tier).toMatch(/^Tier [123]$/);
    expect(typeof claritylite?.rationale).toBe('string');
  });

  it('still suppresses explicit user "Not a Competitor" feedback in always-rank mode', () => {
    delete process.env.COMPETITOR_ALWAYS_RANK; // default ON
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const feedbackMemory = buildCompetitorFeedbackMemory(
      [
        {
          company_id: 'drishik',
          competitor_name: 'Wysa',
          category: 'mental_wellness_ai',
          feedback_type: 'incorrect',
          created_at: '2026-05-01T00:00:00.000Z',
        },
      ],
      { companyId: 'drishik', categories: ['mental_wellness_ai'] },
    );
    const ranked = getFinalCompetitorsSync({
      context,
      feedbackMemory,
      candidates: [
        { name: 'Wysa', source: 'manual' },
        { name: 'Woebot Health', source: 'manual' },
        { name: 'Reflectly', source: 'manual' },
      ],
    });
    expect(ranked.map((c) => c.name)).not.toContain('Wysa');
  });

  it('still suppresses cross-category mislabels (an ai_companion for a wellness product) in always-rank mode', () => {
    delete process.env.COMPETITOR_ALWAYS_RANK; // default ON
    const context = extractCompetitiveContextFromProfile(drishikProfile);
    const ranked = getFinalCompetitorsSync({
      context,
      candidates: [
        { name: 'Wysa', source: 'manual' },
        { name: 'Replika', source: 'manual' }, // ai_companion — genuinely not a category competitor
      ],
      max: 10,
    });
    const names = ranked.map((c) => c.name);
    expect(names).toContain('Wysa');
    expect(names).not.toContain('Replika');
  });
});
