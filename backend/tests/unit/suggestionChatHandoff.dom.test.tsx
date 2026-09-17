/**
 * @jest-environment jsdom
 *
 * Suggestion → Chat handoff — the real page, panel and chat modal together.
 *
 *   Suggest with AI → recommendation shown → "Discuss in Chat"
 *     → the existing AI chat modal opens with the recommendation
 *     → the user's first message → /api/ai/blog-card-chat request carries it.
 *
 * Only the network, router, company context and the page's data hook are
 * faked; ManagedIntelligencePage, SuggestWithAIPanel and AIBlogCardModal are
 * the real components.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ContentSuggestion } from '../../../lib/content/contentSuggestionContract';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

let mockCompanyId = COMPANY_A;
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({
    selectedCompanyId: mockCompanyId,
    selectedCompanyName: 'Company A',
    user: { userId: 'user-a' },
    isLoading: false,
  }),
}));

const mockPush = jest.fn(async () => true);
jest.mock('next/router', () => ({ useRouter: () => ({ query: {}, push: mockPush }) }));
jest.mock('next/head', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={String(href)}>{children}</a>,
}));
jest.mock('../../../components/ChatVoiceButton', () => ({ __esModule: true, default: () => null }));

// The page's data hook — faked, but the modal-open state is real React state.
jest.mock('../../../components/content/managed-intelligence/useManagedIntelligenceData', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  return {
    useManagedIntelligenceData: () => {
      const [isAIModalOpen, setIsAIModalOpen] = ReactActual.useState(false);
      return {
        loading: false,
        companyName: 'Company A',
        companyContext: 'COMPANY-CONTEXT-SENTINEL B2B analytics for revenue teams',
        existingItems: [],
        cards: [],
        cardSuggestions: {},
        suggestionsLoading: false,
        isAIModalOpen,
        setIsAIModalOpen,
        setCustomCards: jest.fn(),
        buildCardBundle: jest.fn(),
        publishedCount: 0,
        draftCount: 0,
        totalViews: 0,
        topPerforming: null,
        actionItems: [],
      };
    },
  };
});

const mockChatCalls: Array<{ url: string; body: any }> = [];
jest.mock('../../../components/community-ai/fetchWithAuth', () => ({
  fetchWithAuth: async (url: string, init?: RequestInit) => {
    mockChatCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({ done: false, nextQuestion: 'Which part should we sharpen first?' }),
    } as unknown as Response;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ManagedIntelligencePage = require('../../../components/content/ManagedIntelligencePage').default;

const SUGGESTION: ContentSuggestion = {
  topic: 'Why onboarding data decays within 90 days',
  angle: 'ANGLE-SENTINEL from our own implementation work',
  objective: 'authority',
  audience: 'AUDIENCE-SENTINEL heads of revenue operations',
  brief: 'BRIEF-SENTINEL explain the mechanism, then the fix, then the next step.',
  reason: 'REASON-SENTINEL recurring questions in your threads',
  intent: 'conversion',
  priority: 'high',
  tone: 'TONE-SENTINEL direct',
  format_guidance: 'FORMAT-SENTINEL three sections',
  platform_guidance: 'PLATFORM-SENTINEL',
  context_used: {
    company_profile: true,
    engagement_signals: 2,
    user_input: false,
    campaign_context: false,
    content_history: false,
    knowledge_graph: false,
    coverage_analysis: false,
  },
};

const networkCalls: Array<{ url: string; body: any }> = [];

const renderPage = () =>
  render(
    <ManagedIntelligencePage
      contentType="article"
      pageTitle="Articles"
      eyebrow="Content"
      heading="Articles"
      icon="📰"
      accentClassName="text-orange-700"
      accentSurfaceClassName="from-orange-50 to-white"
      backPath="/articles"
      createPath="/articles/create"
      templatePath="/articles/template"
      generatePath="/articles/generate"
      formatOptions={[{ value: 'narrative', label: 'Narrative', description: '', wordRange: '1500-2000' }]}
      defaultFormat="narrative"
    />,
  );

async function getSuggestion() {
  fireEvent.click(screen.getByTestId('suggest-with-ai-trigger'));
  await screen.findByTestId('suggest-with-ai-suggestion');
}

async function sendChatMessage(text: string) {
  const input = await screen.findByPlaceholderText(/Describe your article idea/);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByTitle('Send message'));
  await waitFor(() => expect(mockChatCalls.length).toBeGreaterThan(0));
}

beforeEach(() => {
  mockCompanyId = COMPANY_A;
  mockChatCalls.length = 0;
  networkCalls.length = 0;
  mockPush.mockClear();
  (global as any).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    networkCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return { ok: true, status: 200, json: async () => ({ suggestion: SUGGESTION }) } as unknown as Response;
  });
  Element.prototype.scrollIntoView = jest.fn();
});

describe('Discuss in Chat — recommendation reaches the chat AI request', () => {
  it('opens the existing chat seeded with the recommendation, and the first chat request carries it', async () => {
    renderPage();
    await getSuggestion();

    fireEvent.click(screen.getByTestId('suggest-with-ai-discuss'));

    // The existing modal opened, and its opener restates the recommendation.
    const opener = await screen.findByText(/Let's work on this recommendation together/);
    expect(opener.textContent).toContain('BRIEF-SENTINEL');
    expect(opener.textContent).toContain('ANGLE-SENTINEL');

    await sendChatMessage('Can we make it more practical?');

    expect(mockChatCalls).toHaveLength(1);
    const request = mockChatCalls[0];
    expect(request.url).toBe('/api/ai/blog-card-chat');
    expect(request.body.companyId).toBe(COMPANY_A);
    expect(request.body.message).toBe('Can we make it more practical?');
    expect(request.body.metadata.seedSuggestion).toMatchObject({
      topic: SUGGESTION.topic,
      brief: SUGGESTION.brief,
      angle: SUGGESTION.angle,
      audience: SUGGESTION.audience,
      objective: SUGGESTION.objective,
      intent: 'conversion',
      priority: 'high',
      tone: SUGGESTION.tone,
      format_guidance: SUGGESTION.format_guidance,
      reason: SUGGESTION.reason,
      signals: ['company profile', '2 engagement signals'],
    });
    expect(JSON.stringify(request.body)).not.toContain('PLATFORM-SENTINEL');
    // Company context still comes from the page's authorized company data.
    expect(request.body.metadata.companyContext).toContain('COMPANY-CONTEXT-SENTINEL');
    // The opener (which restates the recommendation) is part of the history too.
    expect(JSON.stringify(request.body.conversation)).toContain('BRIEF-SENTINEL');
  });

  it('keeps the seed on every turn of the conversation', async () => {
    renderPage();
    await getSuggestion();
    fireEvent.click(screen.getByTestId('suggest-with-ai-discuss'));

    await sendChatMessage('First refinement');
    await screen.findByText('Which part should we sharpen first?');
    await sendChatMessage('Second refinement');
    await waitFor(() => expect(mockChatCalls).toHaveLength(2));

    expect(mockChatCalls[1].body.metadata.seedSuggestion.brief).toBe(SUGGESTION.brief);
  });

  it('discussing is not accepting: no generation call, no navigation, suggestion stays on the panel', async () => {
    renderPage();
    await getSuggestion();
    fireEvent.click(screen.getByTestId('suggest-with-ai-discuss'));
    await screen.findByText(/Let's work on this recommendation together/);

    expect(networkCalls.map((c) => c.url)).toEqual(['/api/content/suggest']);
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('suggest-with-ai-suggestion')).toBeTruthy();
  });
});

describe('normal chat behaviour without a recommendation is unchanged', () => {
  it('"Create with AI Chat" opens the generic opener and sends no seed', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Create with AI Chat'));

    expect(
      await screen.findByText(/Tell me the article idea or topic you want to shape/),
    ).toBeTruthy();
    await sendChatMessage('An idea about data quality');

    expect(mockChatCalls[0].body.metadata).not.toHaveProperty('seedSuggestion');
  });

  it('closing a discussed chat and opening a new one starts clean', async () => {
    renderPage();
    await getSuggestion();
    fireEvent.click(screen.getByTestId('suggest-with-ai-discuss'));
    await screen.findByText(/Let's work on this recommendation together/);

    // The close button is the only button inside the modal header.
    const header = screen.getByText(/Create Custom Article Card/).closest('div')!.parentElement!.parentElement!;
    fireEvent.click(header.querySelector('button')!);
    await waitFor(() => expect(screen.queryByText(/Let's work on this recommendation together/)).toBeNull());

    fireEvent.click(screen.getByText('Create with AI Chat'));
    await screen.findByText(/Tell me the article idea or topic you want to shape/);
    await sendChatMessage('Something new');
    expect(mockChatCalls[0].body.metadata).not.toHaveProperty('seedSuggestion');
  });
});

describe('tenant binding on the client', () => {
  it('a seed from one company is dropped when the active company changes', async () => {
    const view = renderPage();
    await getSuggestion();
    fireEvent.click(screen.getByTestId('suggest-with-ai-discuss'));
    await screen.findByText(/Let's work on this recommendation together/);

    await act(async () => {
      mockCompanyId = COMPANY_B;
      view.rerender(
        <ManagedIntelligencePage
          contentType="article"
          pageTitle="Articles"
          eyebrow="Content"
          heading="Articles"
          icon="📰"
          accentClassName="text-orange-700"
          accentSurfaceClassName="from-orange-50 to-white"
          backPath="/articles"
          createPath="/articles/create"
          templatePath="/articles/template"
          generatePath="/articles/generate"
          formatOptions={[{ value: 'narrative', label: 'Narrative', description: '', wordRange: '1500-2000' }]}
          defaultFormat="narrative"
        />,
      );
    });

    await sendChatMessage('Still there?');
    const request = mockChatCalls[mockChatCalls.length - 1];
    expect(request.body.companyId).toBe(COMPANY_B);
    expect(request.body.metadata).not.toHaveProperty('seedSuggestion');
  });
});
