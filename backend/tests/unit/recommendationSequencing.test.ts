/**
 * Recommendation Sequencing unit tests.
 */

import {
  sequenceRecommendations,
  type StrategySequence,
} from '../../services/recommendationSequencingService';
import type { CompanyStrategyDNA } from '../../services/companyStrategyDNAService';

const mkRec = (
  topic: string,
  overrides?: Partial<Record<string, unknown>>
): Record<string, unknown> & { topic: string } => ({
  topic,
  intelligence: {
    campaign_angle: 'Pain → Awareness → Authority → Solution',
    problem_being_solved: 'Helping B2B overcome positioning confusion',
  },
  polish_flags: { diamond_candidate: false, authority_elevated: false },
  ...overrides,
});

describe('recommendationSequencing', () => {
  it('returns empty ladder for empty input', () => {
    const result = sequenceRecommendations([], null);
    expect(result.ladder).toEqual([]);
    expect(result.recommended_flow).toBeDefined();
  });

  it('classifies as education when problem_being_solved exists (default mode)', () => {
    const recs = [mkRec('topic a')];
    const result = sequenceRecommendations(recs, null);
    expect(result.ladder.length).toBeGreaterThan(0);
    expect(result.ladder[0].stage).toBe('education');
  });

  it('classifies as awareness when no problem/authority/conversion signals', () => {
    const recs = [
      mkRec('topic a', {
        intelligence: {
          campaign_angle: 'Awareness',
          problem_being_solved: '',
          authority_reason: null,
        },
      }),
    ];
    const result = sequenceRecommendations(recs, null);
    expect(result.ladder[0].stage).toBe('awareness');
  });

  it('ladder stages include objective, psychological_goal, momentum_level', () => {
    const recs = [mkRec('topic a')];
    const result = sequenceRecommendations(recs, null);
    expect(result.ladder[0]).toHaveProperty('objective');
    expect(result.ladder[0]).toHaveProperty('psychological_goal');
    expect(result.ladder[0]).toHaveProperty('momentum_level');
  });

  it('classifies diamond_candidate as authority (when no Conversion in angle)', () => {
    const recs = [
      mkRec('diamond topic', {
        polish_flags: { diamond_candidate: true },
        intelligence: { campaign_angle: 'Pain → Awareness → Authority → Solution' },
      }),
    ];
    const result = sequenceRecommendations(recs, null);
    const authorityStage = result.ladder.find((s) => s.stage === 'authority');
    expect(authorityStage).toBeDefined();
    expect(authorityStage!.recommendations).toHaveLength(1);
  });

  it('uses default flow order when strategyDNA missing', () => {
    const recs = [mkRec('a'), mkRec('b')];
    const result = sequenceRecommendations(recs, null);
    expect(result.ladder.length).toBeGreaterThan(0);
    expect(result.recommended_flow).toContain('awareness');
  });

  it('problem_transformation mode: awareness → education → authority → conversion', () => {
    const dna: CompanyStrategyDNA = {
      mode: 'problem_transformation',
      growth_motion: 'trust_building',
      content_style: 'educational',
      decision_focus: 'awareness_to_trust',
    };
    const result = sequenceRecommendations([mkRec('x')], dna);
    expect(result.recommended_flow).toContain('awareness');
    expect(result.recommended_flow).toContain('authority');
  });
});
