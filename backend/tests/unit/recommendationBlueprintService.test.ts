import { buildCampaignBlueprint } from '../../services/recommendationBlueprintService';
import type { StrategySequence } from '../../services/recommendationSequencingService';

const mkRec = (overrides?: Record<string, unknown>) => ({
  topic: 'Pipeline Friction Breakthrough',
  execution_stage: 'conversion' as const,
  intelligence: {
    problem_being_solved: 'slow pipeline decisions',
    gap_being_filled: 'teams mistake activity for progress',
    why_now: 'decision windows are shrinking this quarter',
    expected_transformation: 'faster qualified pipeline movement',
    campaign_angle: 'proof-led conversion acceleration',
    authority_reason: 'go-to-market diagnostics experience',
  },
  company_problem_transformation: {
    awareness_gap: 'more posts alone create pipeline',
    pain_symptoms: ['stalled evaluations'],
    authority_domains: ['b2b strategy'],
    desired_transformation: 'predictable decision velocity',
  },
  target_audience: 'B2B revenue teams',
  polish_flags: {
    diamond_candidate: false,
  },
  ...overrides,
});

const mkSequence = (recOverrides?: Record<string, unknown>): StrategySequence => ({
  ladder: [
    {
      stage: 'conversion',
      objective: 'Action & decision',
      psychological_goal: 'Commitment',
      momentum_level: 'peak',
      recommendations: [mkRec(recOverrides)],
    },
  ],
  recommended_flow: 'Conversion first for tests.',
});

describe('recommendationBlueprintService', () => {
  it('includes intelligence-derived week_goal', () => {
    const blueprint = buildCampaignBlueprint(mkSequence(), 1);
    expect(blueprint).toBeDefined();
    expect(blueprint?.weekly_plan[0].week_goal).toContain('Help B2B revenue teams move from');
    expect(blueprint?.weekly_plan[0].week_goal).toContain('proof-led conversion acceleration');
  });

  it('builds topics with awareness, authority, and implementation guidance', () => {
    const blueprint = buildCampaignBlueprint(mkSequence(), 1);
    const topics = blueprint?.weekly_plan[0].topics_to_cover ?? [];
    expect(topics.some((topic) => topic.startsWith('Pain-awareness signal:'))).toBe(true);
    expect(topics.some((topic) => topic.startsWith('Authority insight:'))).toBe(true);
    expect(topics.some((topic) => topic.startsWith('Practical implementation:'))).toBe(true);
    expect(topics.length).toBeGreaterThanOrEqual(5);
  });

  it('prioritizes diamond candidate as first topic', () => {
    const blueprint = buildCampaignBlueprint(
      mkSequence({ polish_flags: { diamond_candidate: true } }),
      1
    );
    const week = blueprint?.weekly_plan[0];
    expect(week?.diamond_focus).toBe(true);
    expect((week?.topics_to_cover ?? [])[0]).toContain('Diamond priority:');
  });

  it('adds execution_intent for each week', () => {
    const blueprint = buildCampaignBlueprint(mkSequence(), 1);
    const intent = blueprint?.weekly_plan[0].execution_intent;
    expect(intent).toBeDefined();
    expect(intent?.primary_psychology).toBe('Commitment');
    expect(intent?.conversion_pressure).toBe('high');
  });

  it('is deterministic for same input', () => {
    const a = buildCampaignBlueprint(mkSequence(), 2);
    const b = buildCampaignBlueprint(mkSequence(), 2);
    expect(b).toEqual(a);
  });
});

