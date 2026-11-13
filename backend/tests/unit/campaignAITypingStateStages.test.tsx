/**
 * @jest-environment jsdom
 *
 * Opt-in batch 3: the campaign AI chat's progress shows real steps (traced to
 * /api/campaigns/ai/plan, runCampaignAiPlanExecutor and schedule-structured-plan)
 * instead of rotating messages.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CampaignAITypingState } from '../../../components/campaign-ai/CampaignAITypingState';

const base = {
  isTyping: true,
  activeTab: 'chat',
  messages: [] as Array<{ type: string; message: string }>,
  modeLoading: {} as Record<string, boolean>,
  campaignData: { duration_weeks: 6 },
  initialPlan: null,
  planAbortRef: { current: null },
  isSchedulingPlan: false,
  isLoading: false,
  isRecsChat: false,
  selectedProvider: 'gpt',
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-13T10:00:00Z'));
});
afterEach(() => jest.useRealTimers());

function expectSteps(labels: string[]) {
  for (const label of labels) expect(screen.getByText(label, { exact: false })).toBeInTheDocument();
}

describe('CampaignAITypingState shows traced steps', () => {
  it('final plan request: 5 steps, naming the week count', () => {
    render(
      <CampaignAITypingState
        {...base}
        modeLoading={{ generate_plan: true }}
        messages={[{ type: 'user', message: 'Looks good, proceed with 6 weeks' }]}
      />,
    );
    expectSteps([
      'Reading your campaign and answers',
      'Gathering your company context',
      'Writing the 6-week plan with AI',
      'Checking the plan and your calendar',
      'Saving the plan',
    ]);
  });

  it('scheduling: 4 steps', () => {
    render(<CampaignAITypingState {...base} isSchedulingPlan />);
    expectSteps(['Checking the plan can be scheduled', 'Saving the blueprint', 'Placing posts on your calendar', 'Refreshing your plan']);
  });

  it('refine day: 3 steps', () => {
    render(<CampaignAITypingState {...base} modeLoading={{ refine_day: true }} />);
    expectSteps(['Reading your plan', 'Rewriting the day with AI', 'Saving']);
  });

  it('platform customize: 3 steps', () => {
    render(<CampaignAITypingState {...base} modeLoading={{ platform_customize: true }} />);
    expectSteps(['Reading your plan', 'Tailoring content for each platform', 'Saving']);
  });

  it('conversational gathering turn: 3 steps', () => {
    render(
      <CampaignAITypingState
        {...base}
        modeLoading={{ generate_plan: true }}
        messages={[{ type: 'user', message: 'We sell to dentists' }]}
      />,
    );
    expectSteps(['Reading your answers', 'Working out the next question', 'Saving']);
  });

  it('keeps Cancel wired to the abort controller', () => {
    const abort = jest.fn();
    render(<CampaignAITypingState {...base} modeLoading={{ refine_day: true }} planAbortRef={{ current: { abort } }} />);
    screen.getByRole('button', { name: 'Cancel' }).click();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('no longer shows the old rotating messages', () => {
    render(<CampaignAITypingState {...base} modeLoading={{ refine_day: true }} />);
    expect(screen.queryByText(/Applying refinements/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Generating day content/)).not.toBeInTheDocument();
  });
});
