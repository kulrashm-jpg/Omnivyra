/**
 * @jest-environment jsdom
 *
 * SuggestWithAIPanel — "Discuss in Chat" action.
 *
 * The panel stays a recommendation surface: the action only hands the current
 * suggestion to the host, reaches no endpoint, and does not release the
 * suggestion (discussing is not accepting).
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SuggestWithAIPanel from '../../../components/content/SuggestWithAIPanel';
import type { ContentSuggestion } from '../../../lib/content/contentSuggestionContract';

const suggestion: ContentSuggestion = {
  topic: 'Why onboarding data decays within 90 days',
  angle: 'A specific angle',
  objective: 'authority',
  audience: 'Heads of revenue operations',
  brief: 'Explain the mechanism, then the fix, then the next step for the reader.',
  reason: 'Grounded in your engagement signals.',
  intent: 'authority',
  priority: 'high',
  tone: 'Direct',
  format_guidance: '',
  platform_guidance: '',
  context_used: {
    company_profile: true,
    engagement_signals: 1,
    user_input: false,
    campaign_context: false,
    content_history: false,
    knowledge_graph: false,
    coverage_analysis: false,
  },
};

let urls: string[];

beforeEach(() => {
  urls = [];
  (global as any).fetch = jest.fn(async (url: string) => {
    urls.push(url);
    return { ok: true, json: async () => ({ suggestion }) } as unknown as Response;
  });
});

async function showSuggestion() {
  fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
  await screen.findByTestId('suggest-with-ai-suggestion');
}

describe('SuggestWithAIPanel — Discuss in Chat', () => {
  it('is not rendered when the host does not provide onDiscuss (existing hosts unchanged)', async () => {
    render(<SuggestWithAIPanel companyId="c1" contentType="post" onAccept={jest.fn()} />);
    await showSuggestion();
    expect(screen.queryByTestId('suggest-with-ai-discuss')).toBeNull();
  });

  it('hands the current suggestion to the host without calling any endpoint', async () => {
    const onDiscuss = jest.fn();
    const onAccept = jest.fn();
    render(<SuggestWithAIPanel companyId="c1" contentType="post" onAccept={onAccept} onDiscuss={onDiscuss} />);
    await showSuggestion();

    fireEvent.click(screen.getByTestId('suggest-with-ai-discuss'));

    expect(onDiscuss).toHaveBeenCalledTimes(1);
    expect(onDiscuss).toHaveBeenCalledWith(suggestion);
    expect(onAccept).not.toHaveBeenCalled();
    expect(urls).toEqual(['/api/content/suggest']);
    // Still owned by the panel — the user can come back and accept or revise.
    expect(screen.getByTestId('suggest-with-ai-suggestion')).toBeTruthy();
    expect(screen.getByTestId('suggest-with-ai-accept')).toBeTruthy();
  });
});
