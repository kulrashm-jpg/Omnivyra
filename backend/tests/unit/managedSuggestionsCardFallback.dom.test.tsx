/**
 * @jest-environment jsdom
 *
 * Accepted CARD (prefill_card / prefill_tone) → long-form generation request.
 *
 * Defect found by the P0 combined integration gate: both acceptance paths —
 * "Accept & Continue" on the suggestion panel and "Confirm & Add" in the AI
 * chat — go through ManagedIntelligencePage.acceptAiCard, which writes
 * `prefill_card` + `prefill_tone` and NO `prefill_bundle`. This page understood
 * only the bundle and the prefill_intent/prefill_reason params, so the card's
 * tone, audience, writing style and related topics were dropped before
 * /api/<type>/generate.
 *
 * These tests render the real page, click Generate and inspect the body of the
 * actual fetch to the generate endpoint.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockQuery: Record<string, string> = {};
const mockPush = jest.fn(async () => true);
jest.mock('next/router', () => ({
  useRouter: () => ({ query: mockQuery, push: mockPush, replace: jest.fn() }),
}));
jest.mock('next/head', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({
    user: { userId: 'user-1' },
    selectedCompanyId: 'tenant-company',
    isLoading: false,
  }),
}));
jest.mock('../../../components/content/GenerationProgressTracker', () => ({
  __esModule: true,
  default: () => null,
}));

import ManagedSuggestionsPage, {
  briefFromAcceptedCard,
} from '../../../components/content/ManagedSuggestionsPage';

const SUGGESTIONS = {
  uniqueness_directive_options: ['Lead with operator data'],
  must_include_points_options: ['Cite the 2026 benchmark'],
  campaign_objective_options: ['Drive demo requests'],
  trend_context_options: ['AI procurement scrutiny'],
};

/** Exactly what AIBlogCardModal hands to acceptAiCard (BlogCardPreview). */
const CHAT_CARD = {
  topic: 'Why onboarding data decays within 90 days',
  intent: 'retention',
  audience: 'CARD-AUDIENCE heads of revenue operations',
  reason: 'CARD-REASON founders keep asking for a playbook',
  priority: 'high',
  tone: 'CARD-TONE practical and direct',
  writingStyle: 'CARD-STYLE numbered steps, no hype',
  relatedTopics: ['CARD-RELATED onboarding audit', '  ', 'CARD-RELATED data hygiene'],
};

const fetchMock = jest.fn();

function generateCall() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/generate'));
  if (!call) throw new Error('no generate request was sent');
  return { url: String(call[0]), body: JSON.parse(call[1].body) };
}

async function renderAndGenerate(contentType: any = 'article', title = 'Article') {
  render(
    <ManagedSuggestionsPage
      contentType={contentType}
      title={title}
      stepLabel="Step 3"
      heading="Refine"
      theme="blue"
      generatePath="/unused"
      backPath="/back"
    />,
  );
  const button = await screen.findByRole('button', { name: new RegExp(`Generate ${title}`) });
  await act(async () => {
    fireEvent.click(button);
  });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/generate'))).toBe(true));
  return generateCall();
}

/** The query acceptAiCard actually produces, carried through the template hop. */
const acceptanceQuery = {
  format: 'article',
  prefill_source: 'article_ai_card',
  prefill_topic: CHAT_CARD.topic,
  prefill_reason: CHAT_CARD.reason,
  prefill_priority: 'high',
  prefill_intent: CHAT_CARD.intent,
  prefill_tone: CHAT_CARD.tone,
  prefill_card: 'card-token',
};

beforeEach(() => {
  sessionStorage.clear();
  mockPush.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => (String(url).includes('brief-suggestions')
    ? { ok: true, json: async () => SUGGESTIONS }
    : {
        ok: true,
        json: async () => ({ result: { title: 'T', content_blocks: [] }, platform_variant: { text: 'x' } }),
      }));
  (global as any).fetch = fetchMock;
  mockQuery = { ...acceptanceQuery };
  sessionStorage.setItem('card-token', JSON.stringify(CHAT_CARD));
});

/* ── B. chat/panel acceptance fallback — the defect ─────────────────────────── */

describe('accepted card (no bundle) reaches the long-form generation request', () => {
  it('carries tone, audience, writing style and related topics', async () => {
    const { url, body } = await renderAndGenerate();

    expect(url).toBe('/api/articles/generate');
    expect(body.topic).toBe(CHAT_CARD.topic);
    // Tenant scoping is unchanged: the selected company, never the card.
    expect(body.company_id).toBe('tenant-company');

    // The fields the integration gate found missing.
    expect(body.tone).toBe(CHAT_CARD.tone);
    expect(body.answers.writing_style).toBe(CHAT_CARD.writingStyle);
    expect(body.answers.audience).toBe(CHAT_CARD.audience);
    expect(body.related_blogs).toEqual(['CARD-RELATED onboarding audit', 'CARD-RELATED data hygiene']);

    // Already working before this fix — must stay.
    expect(body.intent).toBe('retention');
    expect(body.answers.strategy_perspective).toContain('Strategic intent: retention.');
    expect(body.answers.strategy_perspective).toContain(CHAT_CARD.reason);
    expect(body.answers.strategy_perspective).toContain(`Tone: ${CHAT_CARD.tone}.`);

    // The four page-owned answers are untouched.
    expect(body.answers.uniqueness_directive).toBe('Lead with operator data');
    expect(body.answers.must_include_points).toBe('Cite the 2026 benchmark');
    expect(body.answers.campaign_objective).toBe('Drive demo requests');
    expect(body.answers.trend_context).toBe('AI procurement scrutiny');
  });

  it('the card is never an authority for company or tenant', async () => {
    sessionStorage.setItem(
      'card-token',
      JSON.stringify({ ...CHAT_CARD, company_id: 'card-company-must-be-ignored', companyId: 'card-company-must-be-ignored' }),
    );
    const { body } = await renderAndGenerate();

    expect(body.company_id).toBe('tenant-company');
    expect(JSON.stringify(body)).not.toContain('card-company-must-be-ignored');
  });

  it('tone survives from the URL param alone when the card token is gone', async () => {
    // sessionStorage can be evicted between the accept and this page.
    sessionStorage.clear();
    const { body } = await renderAndGenerate();

    expect(body.tone).toBe(CHAT_CARD.tone);
    expect(body.answers.strategy_perspective).toContain(`Tone: ${CHAT_CARD.tone}.`);
    expect(body.answers.audience).toBeUndefined();
    expect(body.answers.writing_style).toBeUndefined();
    expect(body.related_blogs).toBeUndefined();
  });
});

/* ── A. existing bundle path unchanged, and bundle beats card ───────────────── */

describe('bundle priority is unchanged', () => {
  const BUNDLE = {
    topic: 'Bundle topic',
    reason: 'BUNDLE-REASON pipeline pages get traffic but no article',
    targetWords: 1800,
    suggestions: SUGGESTIONS,
    brief: {
      company_context: 'BUNDLE-CONTEXT Acme sells attribution software.',
      current_content: 'BUNDLE-CURRENT existing posts cover the basics.',
      writing_style: 'BUNDLE-STYLE direct, evidence-led.',
      related_titles: ['BUNDLE-RELATED attribution 101'],
      intent: 'authority',
      tone: 'BUNDLE-TONE specific and modern',
    },
  };

  it('a bundle value always wins over the card and the URL', async () => {
    mockQuery = { ...acceptanceQuery, prefill_bundle: 'bundle-token' };
    sessionStorage.setItem('bundle-token', JSON.stringify(BUNDLE));
    sessionStorage.setItem('card-token', JSON.stringify(CHAT_CARD));
    const { body } = await renderAndGenerate();

    expect(body.intent).toBe('authority');
    expect(body.tone).toBe(BUNDLE.brief.tone);
    expect(body.answers.writing_style).toBe(BUNDLE.brief.writing_style);
    expect(body.answers.company_context).toBe(BUNDLE.brief.company_context);
    expect(body.answers.current_content).toBe(BUNDLE.brief.current_content);
    expect(body.related_blogs).toEqual(['BUNDLE-RELATED attribution 101']);
    expect(body.answers.strategy_perspective).toContain(BUNDLE.reason);
    expect(JSON.stringify(body)).not.toContain('CARD-TONE');
    expect(JSON.stringify(body)).not.toContain('CARD-STYLE');
  });

  it('the card fills only what the bundle does not carry', async () => {
    mockQuery = { ...acceptanceQuery, prefill_bundle: 'bundle-token' };
    // Bundle with no audience and no writing style.
    sessionStorage.setItem(
      'bundle-token',
      JSON.stringify({ ...BUNDLE, brief: { company_context: BUNDLE.brief.company_context, intent: 'authority' } }),
    );
    const { body } = await renderAndGenerate();

    expect(body.answers.company_context).toBe(BUNDLE.brief.company_context);
    expect(body.intent).toBe('authority');
    // Gaps filled from the card.
    expect(body.answers.audience).toBe(CHAT_CARD.audience);
    expect(body.answers.writing_style).toBe(CHAT_CARD.writingStyle);
    expect(body.tone).toBe(CHAT_CARD.tone);
  });
});

/* ── C. existing intent/reason fallback ─────────────────────────────────────── */

describe('existing URL intent/reason fallback still works', () => {
  it('sends intent and reason with no card and no bundle', async () => {
    mockQuery = { format: 'article', prefill_topic: 'T', prefill_intent: 'authority', prefill_reason: 'URL-REASON' };
    sessionStorage.clear();
    const { body } = await renderAndGenerate();

    expect(body.intent).toBe('authority');
    expect(body.answers.strategy_perspective).toContain('Strategic intent: authority.');
    expect(body.answers.strategy_perspective).toContain('URL-REASON');
    expect(body.tone).toBeUndefined();
    expect(body.related_blogs).toBeUndefined();
  });
});

/* ── D. missing metadata: previous shape preserved ──────────────────────────── */

describe('no accepted metadata at all', () => {
  it('the request is exactly the previous shape', async () => {
    mockQuery = { format: 'article', prefill_topic: 'T' };
    sessionStorage.clear();
    const { body } = await renderAndGenerate();

    expect(Object.keys(body).sort()).toEqual(
      ['answers', 'cache_version', 'company_id', 'format_type', 'mode', 'target_word_count', 'topic'].sort(),
    );
    expect(Object.keys(body.answers).sort()).toEqual(
      ['campaign_objective', 'must_include_points', 'target_word_count', 'trend_context', 'uniqueness_directive'].sort(),
    );
  });

  it('short-form (post) is untouched even with a card present', async () => {
    mockQuery = { ...acceptanceQuery, format: 'post', platform: 'linkedin' };
    const { body } = await renderAndGenerate('post', 'Post');

    expect(Object.keys(body).sort()).toEqual(
      ['company_id', 'extra_instruction', 'objective', 'platform', 'tone', 'topic'].sort(),
    );
    expect(body.answers).toBeUndefined();
    expect(body.intent).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('CARD-AUDIENCE');
  });
});

/* ── E. malformed card must not crash the page ──────────────────────────────── */

describe('malformed prefill_card', () => {
  it.each([
    ['invalid JSON', '{not json'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"just a string"'],
    ['null', 'null'],
    ['wrong field types', JSON.stringify({ tone: 42, audience: {}, relatedTopics: 'not-an-array', writingStyle: [] })],
  ])('%s still generates, with the URL fallbacks and no invented values', async (_label, raw) => {
    sessionStorage.setItem('card-token', raw);
    const { body } = await renderAndGenerate();

    expect(body.topic).toBe(CHAT_CARD.topic);
    expect(body.company_id).toBe('tenant-company');
    // URL params survive; nothing is fabricated from the broken card.
    expect(body.intent).toBe('retention');
    expect(body.tone).toBe(CHAT_CARD.tone);
    expect(body.answers.audience).toBeUndefined();
    expect(body.answers.writing_style).toBeUndefined();
    expect(body.related_blogs).toBeUndefined();
  });
});

/* ── unit: card → the existing AcceptedCardBrief shape ──────────────────────── */

describe('briefFromAcceptedCard', () => {
  it('maps the card onto the existing brief contract', () => {
    expect(briefFromAcceptedCard(CHAT_CARD)).toEqual({
      reason: CHAT_CARD.reason,
      intent: 'retention',
      tone: CHAT_CARD.tone,
      audience: CHAT_CARD.audience,
      writing_style: CHAT_CARD.writingStyle,
      related_titles: ['CARD-RELATED onboarding audit', 'CARD-RELATED data hygiene'],
    });
  });

  it('returns null for nothing usable', () => {
    for (const raw of [null, undefined, [], 'x' as any, 42 as any, {}, { tone: '   ' }, { relatedTopics: ['', ' '] }]) {
      expect(briefFromAcceptedCard(raw as any)).toBeNull();
    }
  });

  it('drops blank and wrongly typed values instead of inventing them', () => {
    expect(briefFromAcceptedCard({ tone: 42, audience: {}, writingStyle: [], relatedTopics: 'no', reason: ' ok ' } as any))
      .toEqual({ reason: 'ok' });
  });
});
