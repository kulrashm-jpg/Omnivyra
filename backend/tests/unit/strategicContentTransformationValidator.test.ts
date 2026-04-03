import { validateStrategicContentTransformation } from '../../services/strategicContentTransformationValidator';

describe('validateStrategicContentTransformation', () => {
  it('returns the strict five-block contract', () => {
    const result = validateStrategicContentTransformation({
      strategic_source: {
        campaign_angle: 'Pipeline teams stall because attribution dashboards hide buyer intent',
        why_now: 'Revenue teams are cutting headcount while demand scrutiny is rising',
        gap_being_filled: 'Most attribution content explains metrics but not decision timing',
        problem_being_solved: 'B2B teams cannot tell when accounts are ready for sales escalation',
        expected_transformation: 'Move from noisy reporting to decision-grade signal routing',
        authority_reason: 'Observed across multi-touch funnel audits for SaaS companies',
        narrative_direction: 'Expose why reporting accuracy is not the same as buying-committee clarity',
      },
      final_content: {
        sections: [
          {
            heading: 'The real problem',
            content: 'B2B teams stall because attribution dashboards hide buyer intent. Revenue teams are cutting headcount while demand scrutiny is rising.',
          },
          {
            heading: 'How it works',
            content: 'The mechanism is simple: reporting accuracy and decision timing are different systems. For example, a SaaS team can have clean attribution and still miss the buying committee handoff. This means decision-grade signal routing matters more than another dashboard.',
          },
          {
            heading: 'Trade-offs',
            content: 'Manual reporting versus decision-grade routing is a real trade-off. Manual reporting is easier to launch, but it slows escalation and hides intent. Use routing when accounts are active; do not use it as a substitute for ICP clarity.',
          },
        ],
      },
    });

    expect(result).toEqual({
      signal_preservation: expect.any(Object),
      insight_transfer: expect.any(Object),
      depth_execution: expect.any(Object),
      decision_content: expect.any(Object),
      generic_content: expect.any(Object),
    });

    expect(result.signal_preservation.retention_score).toBeGreaterThan(0);
    expect(Array.isArray(result.signal_preservation.missing_signals)).toBe(true);
    expect(Array.isArray(result.insight_transfer.flattened_sections)).toBe(true);
    expect(Array.isArray(result.depth_execution.missing_layers)).toBe(true);
    expect(Array.isArray(result.decision_content.fake_or_missing_blocks)).toBe(true);
    expect(Array.isArray(result.generic_content.generic_sections)).toBe(true);
  });

  it('is harsh on generic content with no real decision layer', () => {
    const result = validateStrategicContentTransformation({
      strategic_source: {
        campaign_angle: 'Fix decision friction in enterprise CRM rollouts',
        why_now: 'Buying cycles are getting longer',
        gap_being_filled: 'Content stays generic and never explains implementation risk',
        problem_being_solved: 'Leaders cannot compare enablement options clearly',
      },
      final_content: `
Introduction

In today's fast-paced market, businesses need to stay ahead and unlock growth.

Best practices

It is important to create strong strategies and drive results with valuable insights.
      `,
    });

    expect(result.decision_content.decision_score).toBe(0);
    expect(result.decision_content.fake_or_missing_blocks).toContain('No real comparison or trade-off block found');
    expect(result.generic_content.generic_ratio).toBeGreaterThan(0);
    expect(result.signal_preservation.missing_signals.length).toBeGreaterThan(0);
  });
});
