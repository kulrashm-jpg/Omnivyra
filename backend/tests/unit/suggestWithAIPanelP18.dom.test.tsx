/**
 * @jest-environment jsdom
 *
 * P1.8 — Suggest-with-AI panel behaviour.
 *
 * The decisive assertions are about OWNERSHIP and about which endpoints are
 * reachable: exactly one surface may display a recommendation at a time, and
 * Suggest / Revise / Suggest another must never reach a generation endpoint.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuggestWithAIPanel from '../../../components/content/SuggestWithAIPanel';
import type { ContentSuggestion } from '../../../lib/content/contentSuggestionContract';

const SUGGEST_API = '/api/content/suggest';

const suggestion = (topic: string): ContentSuggestion => ({
  topic,
  angle: 'A specific angle',
  objective: 'authority',
  audience: 'Heads of marketing',
  brief: 'Write a post explaining the mechanism, then the fix, then the next step for the reader.',
  reason: 'Grounded in your engagement signals.',
  intent: 'authority',
  priority: 'high',
  tone: 'Direct',
  format_guidance: '',
  platform_guidance: '',
  context_used: {
    company_profile: true,
    engagement_signals: 2,
    user_input: false,
    campaign_context: false,
    content_history: false,
    knowledge_graph: false,
    coverage_analysis: false,
  },
});

let calls: Array<{ url: string; body: any }>;

function mockFetch(handler: (url: string, body: any) => { ok: boolean; json: unknown }) {
  (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    const result = handler(url, body);
    return { ok: result.ok, json: async () => result.json } as unknown as Response;
  });
}

const props = { companyId: 'company-a', contentType: 'post' };

beforeEach(() => {
  calls = [];
});

async function openSuggestion(topic = 'Why attribution breaks at scale') {
  mockFetch(() => ({ ok: true, json: { suggestion: suggestion(topic) } }));
  render(<SuggestWithAIPanel {...props} onAccept={jest.fn()} />);
  fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
  await waitFor(() => screen.getByTestId('suggest-with-ai-suggestion'));
}

describe('suggestion-only operations', () => {
  it('Suggest calls only the suggestion endpoint', async () => {
    await openSuggestion();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SUGGEST_API);
    expect(calls.some((c) => c.url.includes('/api/posts/generate'))).toBe(false);
  });

  it('Revise sends the instruction and the previous suggestion, and generates nothing', async () => {
    await openSuggestion('Original topic here');

    mockFetch(() => ({ ok: true, json: { suggestion: suggestion('Revised founder topic') } }));
    fireEvent.click(screen.getByTestId('suggest-with-ai-revise'));
    fireEvent.change(screen.getByTestId('suggest-with-ai-revision-input'), {
      target: { value: 'Make it more provocative and focus on founders' },
    });
    fireEvent.click(screen.getByTestId('suggest-with-ai-revise-submit'));

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].url).toBe(SUGGEST_API);
    expect(calls[1].body.revision_instruction).toBe('Make it more provocative and focus on founders');
    expect(calls[1].body.previous_suggestion.topic).toBe('Original topic here');
    expect(calls.every((c) => c.url === SUGGEST_API)).toBe(true);
  });

  it('Suggest another stays suggestion-only', async () => {
    await openSuggestion();
    mockFetch(() => ({ ok: true, json: { suggestion: suggestion('Another topic entirely') } }));
    fireEvent.click(screen.getByTestId('suggest-with-ai-another'));

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls.every((c) => c.url === SUGGEST_API)).toBe(true);
    // No revision metadata on a fresh suggestion.
    expect(calls[1].body.revision_instruction).toBeUndefined();
  });
});

describe('accept ownership handoff', () => {
  it('stops displaying the recommendation while it is promoted to Recommended Cards', async () => {
    let release: () => void = () => {};
    const onAccept = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));

    mockFetch(() => ({ ok: true, json: { suggestion: suggestion('Harnessing AI for smarter execution') } }));
    render(<SuggestWithAIPanel {...props} onAccept={onAccept} />);
    fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
    await waitFor(() => screen.getByTestId('suggest-with-ai-suggestion'));

    fireEvent.click(screen.getByTestId('suggest-with-ai-accept'));

    // THE regression: during the (multi-second, in production) accept window the
    // card is already in Recommended Cards, so the panel must not still show it.
    await waitFor(() => expect(screen.queryByTestId('suggest-with-ai-suggestion')).toBeNull());
    expect(screen.getByTestId('suggest-with-ai-accepting')).toBeTruthy();
    expect(onAccept).toHaveBeenCalledTimes(1);

    release();
  });

  it('hands the accepted suggestion to the existing generation path unchanged', async () => {
    const onAccept = jest.fn().mockResolvedValue(undefined);
    mockFetch(() => ({ ok: true, json: { suggestion: suggestion('A concrete topic') } }));
    render(<SuggestWithAIPanel {...props} onAccept={onAccept} />);
    fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
    await waitFor(() => screen.getByTestId('suggest-with-ai-suggestion'));

    fireEvent.click(screen.getByTestId('suggest-with-ai-accept'));
    await waitFor(() => expect(onAccept).toHaveBeenCalled());

    expect(onAccept.mock.calls[0][0].topic).toBe('A concrete topic');
    // The panel itself never generates.
    expect(calls.every((c) => c.url === SUGGEST_API)).toBe(true);
  });

  it('restores the recommendation if generation fails, so the user can retry', async () => {
    const onAccept = jest.fn().mockRejectedValue(new Error('Failed to generate post'));
    mockFetch(() => ({ ok: true, json: { suggestion: suggestion('A topic that fails') } }));
    render(<SuggestWithAIPanel {...props} onAccept={onAccept} />);
    fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
    await waitFor(() => screen.getByTestId('suggest-with-ai-suggestion'));

    fireEvent.click(screen.getByTestId('suggest-with-ai-accept'));

    await waitFor(() => screen.getByTestId('suggest-with-ai-error'));
    // Ownership returns to the panel — the recommendation is visible again.
    expect(screen.getByTestId('suggest-with-ai-suggestion')).toBeTruthy();
    expect(screen.getByText('Failed to generate post')).toBeTruthy();
  });
});

describe('context honesty', () => {
  it('never claims history, graph or coverage signals', async () => {
    await openSuggestion();
    const panel = screen.getByTestId('suggest-with-ai-panel');
    expect(panel.textContent).not.toMatch(/content history|knowledge graph|coverage/i);
    expect(panel.textContent).toContain('company profile');
  });
});
