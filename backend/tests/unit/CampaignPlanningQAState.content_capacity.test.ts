/**
 * Verifies content_capacity is asked immediately after available_content when user answers "No".
 */
import { computeCampaignPlanningQAState } from '../../chatGovernance/CampaignPlanningQAState';

const GATHER_ORDER_WITH_CAPACITY = [
  { key: 'available_content', question: 'Do you have existing content?' },
  { key: 'available_content_allocation', question: 'For each piece...', contingentOn: 'available_content' },
  { key: 'content_capacity', question: 'How many can you and your team create every week? (e.g., 3 videos, 10 posts, 2 blogs)' },
  { key: 'action_expectation', question: 'What do you want people to do?' },
];

const REQUIRED = ['available_content', 'content_capacity', 'action_expectation'];

describe('CampaignPlanningQAState content_capacity', () => {
  it('asks content_capacity next when user answers No to available_content', () => {
    const conversationHistory = [
      { type: 'ai' as const, message: 'Do you have existing content (videos, posts, blogs) for this campaign? Answer "no", "none", or describe what you have.' },
      { type: 'user' as const, message: 'No' },
    ];

    const result = computeCampaignPlanningQAState({
      gatherOrder: GATHER_ORDER_WITH_CAPACITY,
      prefilledKeys: [],
      requiredKeys: REQUIRED,
      conversationHistory,
    });

    expect(result.nextQuestion).not.toBeNull();
    expect(result.nextQuestion?.key).toBe('content_capacity');
    expect(result.nextQuestion?.question).toMatch(/create every week|you and your team/i);
    expect(result.answeredKeys).toContain('available_content');
    expect(result.answeredKeys).not.toContain('content_capacity');
  });
});
