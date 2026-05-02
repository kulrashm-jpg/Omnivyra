import { mapComposedReport } from '../../../pages/api/reports/reportComposedMapper';

const baseCompetitor = {
  name: 'Wysa',
  domain: 'wysa.com',
  classification: 'direct_competitor',
  source: 'known_category_dataset',
  relevance_score: 78,
  category: 'mental_wellness_ai',
  tags: ['chatbot'],
  problem_overlap: 0.78,
  icp_overlap: 0.7,
  market_overlap: 0.72,
  revenue_tier: 'growth',
  product_depth: 0.75,
  authority_score: 0.7,
  authority_signals: {
    traffic_estimate: 'large app footprint',
    installs: 'large mobile app footprint',
    reviews: 'substantial review base',
    funding_level: 'funded',
    search_visibility: 'high',
    brand_strength: 'high',
  },
  final_score: 0.78,
  tier: 'Tier 1',
  positioning: {
    strengths_vs_company: ['Higher authority and broader market reach'],
    weaknesses_vs_company: ['Less focused on multilingual clarity guidance'],
    differentiation: 'Wysa is stronger in mental wellness authority while the company is more focused on clarity-led decision support.',
    threat_level: 'high',
  },
  enrichment_confidence_score: 0.86,
  enrichment: {
    category: 'mental_wellness_ai',
    description: 'AI-guided mental wellness app.',
    icp: {
      age_group: 'adults',
      use_case: 'stress, anxiety, emotional wellbeing, self-care, guided reflection',
      user_intent: 'get private emotional support',
    },
    business_model: 'B2C and employer hybrid',
    geography: 'global',
    product_type: 'AI chatbot',
    scale_signals: { notes: 'known category player' },
    confidence_score: 0.86,
    sources: ['known_category_dataset'],
  },
  rationale: 'Relevant final-gated competitor.',
} as const;

const marketAlternative = {
  ...baseCompetitor,
  name: 'Life coaches and clarity consultants',
  domain: null,
  source: 'market_substitute',
  category: 'coaching_consulting',
  final_score: 0.72,
  relevance_score: 72,
  tier: 'Tier 2',
  rationale: 'Adjacent human-led substitute for clarity and decision support.',
} as const;

describe('reportComposedMapper competitor contract', () => {
  it('keeps market substitutes out of detected competitors and exposes them only as alternatives', () => {
    const mapped = mapComposedReport({
      report_type: 'snapshot',
      sections: [
        {
          section_name: 'summary',
          insights: [{ title: 'Competitor context available', impact_score: 70, confidence_score: 0.8 }],
        },
      ],
      competitor_intelligence: {
        summary: 'Competitor context summary.',
        detected_competitors: [baseCompetitor as any, marketAlternative as any],
        market_alternatives: [marketAlternative as any],
        comparison: {
          competitors: [
            { competitor: baseCompetitor as any, metrics: {}, deltas_vs_company: {} },
            { competitor: marketAlternative as any, metrics: {}, deltas_vs_company: {} },
          ],
        },
        generated_gaps: [],
      },
    } as any, 'snapshot', 'report-1', 'company-1', 'drishiq.com', '2026-05-02', '2026-05-02T00:00:00.000Z', false, 'test');

    expect(mapped?.competitorContext?.competitors.map((competitor) => competitor.name)).toEqual(['Wysa']);
    expect(mapped?.competitorContext?.marketAlternatives?.map((alternative) => alternative.name)).toEqual([
      'Life coaches and clarity consultants',
    ]);
  });
});
