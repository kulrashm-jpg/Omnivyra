import { enrichRecommendationCards } from '../../services/recommendationCardEnrichmentService';

type TestResult = {
  trends_used: Array<Record<string, unknown> & { topic: string }>;
  strategy_dna?: { mode?: string | null } | null;
  strategy_sequence?: {
    ladder?: Array<{
      stage: string;
      objective: string;
      psychological_goal: string;
      momentum_level: string;
      recommendations: Array<{ topic: string }>;
    }>;
  } | null;
  company_context?: {
    brand?: {
      brand_voice?: string | null;
      brand_positioning?: string | null;
    } | null;
    problem_transformation?: {
      core_problem_statement?: string | null;
      pain_symptoms?: string[] | null;
      desired_transformation?: string | null;
      authority_domains?: string[] | null;
    } | null;
    campaign?: {
      reader_emotion_target?: string | null;
      narrative_flow_seed?: unknown;
      recommended_cta_style?: string | null;
    } | null;
  } | null;
};

const buildBaseResult = (): TestResult => ({
  trends_used: [
    {
      topic: 'First topic',
      alignment_score: 0.72,
      polish_flags: { authority_elevated: true },
      intelligence: {
        problem_being_solved: 'Problem A',
        gap_being_filled: 'Gap A',
        why_now: 'Now A',
        authority_reason: 'Authority A',
        expected_transformation: 'Transformation A',
        campaign_angle: 'Angle A',
      },
    },
    {
      topic: 'Second topic',
      alignment_score: 0.41,
      polish_flags: { diamond_candidate: true },
      intelligence: {
        problem_being_solved: 'Problem B',
      },
    },
  ],
  strategy_dna: { mode: 'problem_transformation' },
  strategy_sequence: {
    ladder: [
      {
        stage: 'awareness',
        objective: 'Introduce problem',
        psychological_goal: 'Clarity',
        momentum_level: 'low',
        recommendations: [{ topic: 'First topic' }],
      },
      {
        stage: 'authority',
        objective: 'Build trust',
        psychological_goal: 'Confidence',
        momentum_level: 'medium',
        recommendations: [{ topic: 'Second topic' }],
      },
    ],
  },
  company_context: {
    brand: {
      brand_voice: 'clear, practical, outcome-driven',
      brand_positioning: 'The no-fluff execution partner for busy teams',
    },
    problem_transformation: {
      core_problem_statement: 'Core issue',
      pain_symptoms: ['symptom-1'],
      desired_transformation: 'Desired future',
      authority_domains: ['domain-1'],
    },
    campaign: {
      reader_emotion_target: 'confident',
      narrative_flow_seed: { pattern: '3-step weekly arc', steps: ['clarity', 'proof', 'conversion'] },
      recommended_cta_style: 'Direct',
    },
  },
});

describe('recommendationCardEnrichmentService', () => {
  it('adds intelligence fields to card', () => {
    const result = enrichRecommendationCards(buildBaseResult());
    expect(result.trends_used[0]).toHaveProperty('intelligence.problem_being_solved', 'Problem A');
    expect(result.trends_used[0]).toHaveProperty('intelligence.gap_being_filled', 'Gap A');
    expect(result.trends_used[1]).toHaveProperty('intelligence.gap_being_filled', null);
  });

  it('adds execution stage metadata', () => {
    const result = enrichRecommendationCards(buildBaseResult());
    expect(result.trends_used[0]).toHaveProperty('execution.execution_stage', 'awareness');
    expect(result.trends_used[0]).toHaveProperty('execution.stage_objective', 'Introduce problem');
    expect(result.trends_used[1]).toHaveProperty('execution.momentum_level', 'medium');
  });

  it('adds company context snapshot', () => {
    const result = enrichRecommendationCards(buildBaseResult());
    expect(result.trends_used[0]).toHaveProperty(
      'company_context_snapshot.brand_voice',
      'clear, practical, outcome-driven'
    );
    expect(result.trends_used[0]).toHaveProperty(
      'company_context_snapshot.brand_positioning',
      'The no-fluff execution partner for busy teams'
    );
    expect(result.trends_used[0]).toHaveProperty(
      'company_context_snapshot.reader_emotion_target',
      'confident'
    );
    expect(result.trends_used[0]).toHaveProperty(
      'company_context_snapshot.narrative_flow_seed',
      JSON.stringify({ pattern: '3-step weekly arc', steps: ['clarity', 'proof', 'conversion'] })
    );
    expect(result.trends_used[0]).toHaveProperty(
      'company_context_snapshot.recommended_cta_style',
      'Direct'
    );
    expect(result.trends_used[0]).toHaveProperty(
      'company_context_snapshot.core_problem_statement',
      'Core issue'
    );
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.authority_domains', ['domain-1']);
  });

  it('does not change order', () => {
    const input = buildBaseResult();
    const before = input.trends_used.map((t) => t.topic);
    const after = enrichRecommendationCards(input).trends_used.map((t) => t.topic);
    expect(after).toEqual(before);
  });

  it('does not change alignment score', () => {
    const input = buildBaseResult();
    const before = input.trends_used.map((t) => t.alignment_score);
    const after = enrichRecommendationCards(input).trends_used.map((t) => t.alignment_score);
    expect(after).toEqual(before);
  });

  it('works when strategy_sequence is missing (null execution fields)', () => {
    const input = buildBaseResult();
    input.strategy_sequence = undefined;
    const result = enrichRecommendationCards(input);
    expect(result.trends_used[0]).toHaveProperty('execution.execution_stage', null);
    expect(result.trends_used[0]).toHaveProperty('execution.stage_objective', null);
    expect(result.trends_used[0]).toHaveProperty('execution.psychological_goal', null);
    expect(result.trends_used[0]).toHaveProperty('execution.momentum_level', null);
  });

  it('works when company_context is missing', () => {
    const input = buildBaseResult();
    input.company_context = undefined;
    const result = enrichRecommendationCards(input);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.brand_voice', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.brand_positioning', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.reader_emotion_target', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.narrative_flow_seed', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.recommended_cta_style', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.core_problem_statement', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.pain_symptoms', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.desired_transformation', null);
    expect(result.trends_used[0]).toHaveProperty('company_context_snapshot.authority_domains', null);
  });
});

