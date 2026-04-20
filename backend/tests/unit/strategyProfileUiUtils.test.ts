import {
  buildImprovementSummary,
  getHighlightCandidates,
  matchHighlights,
  type StrategyProfile,
} from '../../../components/company/strategyProfileUiUtils';

const baseProfile = {
  ideal_customer_profile: 'B2B SaaS growth teams',
  target_audience: 'Demand generation leaders',
  products_services: 'Distribution-first content engine',
  industry: 'B2B SaaS',
  core_problem_statement: 'Low pipeline from SEO-only content',
  authority_domains: ['content distribution'],
  pain_symptoms: ['high CAC', 'low organic pipeline'],
} as any;

function strategy(overrides: Partial<StrategyProfile>): StrategyProfile {
  return {
    worldview: '',
    contrarianBeliefs: [],
    primaryFocus: [],
    differentiation: [],
    typicalAngles: [],
    ...overrides,
  };
}

describe('strategyProfileUiUtils', () => {
  it('rejects longer edits that do not improve specificity', () => {
    const previous = strategy({
      worldview: 'We help businesses grow with better content.',
    });
    const next = strategy({
      worldview: 'We help businesses grow with better content, better systems, and better execution across every channel.',
    });

    expect(buildImprovementSummary({ previous, next, profile: baseProfile })).toBeNull();
  });

  it('accepts clearer company-specific positioning', () => {
    const previous = strategy({
      worldview: 'We help businesses grow with content.',
    });
    const next = strategy({
      worldview: 'We help B2B SaaS growth teams build pipeline with a distribution-first content engine.',
      differentiation: ['Distribution-first content engine for B2B SaaS pipeline'],
    });

    expect(buildImprovementSummary({ previous, next, profile: baseProfile })).toEqual({
      improved: true,
      reason: 'Clearer differentiation added',
      before: 'We help businesses grow with content.',
      after: 'We help B2B SaaS growth teams build pipeline with a distribution-first content engine.',
    });
  });

  it('avoids partial token matches that are scattered across content', () => {
    const content = 'B2B teams need stronger distribution now. Months later, pipeline reviews expose the gaps in strategy.';
    const candidates = ['b2b pipeline distribution strategy'];

    expect(matchHighlights(content, candidates)).toEqual([]);
  });

  it('highlights only meaningful phrases with natural snippets', () => {
    const candidates = getHighlightCandidates(strategy({
      contrarianBeliefs: ['SEO alone is not enough'],
      primaryFocus: ['B2B SaaS growth teams need distribution-first content engines'],
      differentiation: ['Pipeline-first content systems'],
    }));
    const content = 'Most B2B SaaS growth teams need distribution-first content engines to turn content into pipeline instead of publishing and hoping.';

    const highlights = matchHighlights(content, candidates);

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toContain('B2B SaaS growth teams need distribution-first content engines');
  });

  it('is deterministic for the same input', () => {
    const content = 'Most B2B SaaS growth teams need distribution-first content engines to turn content into pipeline.';
    const candidates = ['b2b saas growth teams need distribution first content engines'];

    expect(matchHighlights(content, candidates)).toEqual(matchHighlights(content, candidates));
  });
});
