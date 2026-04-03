import { sanitizeReportViewPayload } from '../../services/reportContentSanitizationService';

describe('reportContentSanitizationService', () => {
  it('deduplicates repeated sentences across sections and cleans repeated step prefixes', () => {
    const payload = {
      diagnosis: 'Authority is weak. Authority is weak.',
      summary: 'Authority is weak.',
      confidenceSource: 'Summary is limited for this run',
      decisionSnapshot: {
        whatsBroken: 'Authority is weak.',
        whatToFixFirst: 'Improve depth.',
        whatToDelay: 'Delay expansion.',
        ifIgnored: 'Visibility stays constrained.',
        ifExecutedWell: 'Visibility improves.',
        executionSequence: ['Step 1: Step 1: Build depth pages', 'Step 2: Earn links'],
      },
      insights: [
        {
          text: 'Authority is weak.',
          whyItMatters: 'Authority is weak.',
          businessImpact: 'Authority is weak.',
        },
      ],
      opportunities: [],
      nextSteps: [],
      topPriorities: [],
    };

    const sanitized = sanitizeReportViewPayload(payload);

    expect(sanitized.diagnosis).toBe('Authority is weak.');
    expect(sanitized.summary).not.toBe('Authority is weak.');
    expect(sanitized.confidenceSource).toContain('Available signals indicate limited data coverage');
    expect(sanitized.decisionSnapshot.executionSequence[0]).toBe('Step 1: Build depth pages.');
  });

  it('limits idea-level signal reuse to max two appearances', () => {
    const payload = {
      diagnosis: 'Authority is weak. Authority needs trust signals.',
      summary: 'Authority performance is constrained.',
      confidenceSource: 'Authority trend is weak.',
      decisionSnapshot: {
        whatsBroken: 'Authority signals are weak.',
        whatToFixFirst: 'Build authority.',
        whatToDelay: 'Delay expansion.',
        ifIgnored: 'Growth stays constrained.',
        ifExecutedWell: 'Authority improves.',
        executionSequence: ['Step 1: Build authority pages'],
      },
      insights: [],
      opportunities: [],
      nextSteps: [],
      topPriorities: [],
    };

    const sanitized = sanitizeReportViewPayload(payload);
    const stitched = [
      sanitized.diagnosis,
      sanitized.summary,
      sanitized.confidenceSource,
      sanitized.decisionSnapshot.whatsBroken,
      sanitized.decisionSnapshot.whatToFixFirst,
      sanitized.decisionSnapshot.ifExecutedWell,
    ].join(' ');

    const authorityMentions = (stitched.toLowerCase().match(/authority/g) ?? []).length;
    expect(authorityMentions).toBeLessThanOrEqual(2);
  });
});
