/**
 * @jest-environment jsdom
 *
 * Accepted suggestion brief → long-form generation request.
 *
 * Defect: accepting an AI suggestion card for a long-form artifact routed to
 * ManagedSuggestionsPage, which read only the topic and chip suggestions from
 * the card bundle. The brief (intent, reason, tone, company context, current
 * content, writing style, related titles) never reached /api/<type>/generate.
 *
 * These tests render the real page, click Generate, and inspect the body of
 * the actual fetch to the generate endpoint.
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
  buildAcceptedBriefFields,
} from '../../../components/content/ManagedSuggestionsPage';

const SUGGESTIONS = {
  uniqueness_directive_options: ['Lead with operator data'],
  must_include_points_options: ['Cite the 2026 benchmark'],
  campaign_objective_options: ['Drive demo requests'],
  trend_context_options: ['AI procurement scrutiny'],
};

const BUNDLE = {
  topic: 'Why RevOps teams abandon attribution models',
  reason: 'Your pipeline pages get traffic but no article answers this objection.',
  targetWords: 1800,
  depthLabel: 'Deep',
  formatLabel: 'Article',
  suggestions: SUGGESTIONS,
  brief: {
    company_id: 'bundle-company-must-be-ignored',
    company_context: 'Acme sells revenue attribution software to B2B SaaS.',
    current_content: 'Existing posts cover multi-touch basics.',
    writing_style: 'Direct, evidence-led, no hype.',
    related_titles: ['Multi-touch attribution 101', '  ', 'Pipeline hygiene checklist'],
    intent: 'authority',
    tone: 'Specific, modern, and high-signal',
  },
};

const fetchMock = jest.fn();

function generateCall() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/generate'));
  if (!call) throw new Error('no generate request was sent');
  return { url: String(call[0]), body: JSON.parse(call[1].body) };
}

async function renderAndGenerate(contentType: any, title: string) {
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

beforeEach(() => {
  sessionStorage.clear();
  mockPush.mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => (String(url).includes('brief-suggestions')
    // The page also requests chip suggestions on mount; serve the same set.
    ? { ok: true, json: async () => SUGGESTIONS }
    : {
        ok: true,
        json: async () => ({ result: { title: 'T', content_blocks: [] }, platform_variant: { text: 'x' } }),
      }));
  (global as any).fetch = fetchMock;
  mockQuery = {
    prefill_topic: BUNDLE.topic,
    prefill_reason: BUNDLE.reason,
    prefill_intent: BUNDLE.brief.intent,
    prefill_bundle: 'bundle-token',
    format: 'article',
  };
  sessionStorage.setItem('bundle-token', JSON.stringify(BUNDLE));
});

describe('accepted suggestion brief reaches the long-form generation request', () => {
  it.each([
    ['article', 'Article', '/api/articles/generate'],
    ['whitepaper', 'Whitepaper', '/api/whitepapers/generate'],
    ['guide', 'Guide', '/api/guides/generate'],
    ['story', 'Story', '/api/stories/generate'],
    ['case-study', 'Case Study', '/api/case-studies/generate'],
  ])('%s: the actual request body carries the complete brief', async (contentType, title, apiPath) => {
    const { url, body } = await renderAndGenerate(contentType, title);

    expect(url).toBe(apiPath);
    expect(body.topic).toBe(BUNDLE.topic);
    // Tenant scoping: the page's selected company, never the bundle's.
    expect(body.company_id).toBe('tenant-company');
    expect(JSON.stringify(body)).not.toContain('bundle-company-must-be-ignored');

    // Top-level contract fields (standard prompt builder).
    expect(body.intent).toBe('authority');
    expect(body.tone).toBe('Specific, modern, and high-signal');
    expect(body.related_blogs).toEqual(['Multi-touch attribution 101', 'Pipeline hygiene checklist']);

    // answers (read by both the standard and template-aware builders).
    expect(body.answers.company_context).toBe(BUNDLE.brief.company_context);
    expect(body.answers.current_content).toBe(BUNDLE.brief.current_content);
    expect(body.answers.writing_style).toBe(BUNDLE.brief.writing_style);
    expect(body.answers.strategy_perspective).toContain('Strategic intent: authority.');
    expect(body.answers.strategy_perspective).toContain(BUNDLE.reason);
    expect(body.answers.strategy_perspective).toContain('Tone: Specific, modern, and high-signal.');

    // The four page answers and the existing fields are unchanged.
    expect(body.answers.uniqueness_directive).toBe('Lead with operator data');
    expect(body.answers.must_include_points).toBe('Cite the 2026 benchmark');
    expect(body.answers.campaign_objective).toBe('Drive demo requests');
    expect(body.answers.trend_context).toBe('AI procurement scrutiny');
    expect(body.mode).toBe('full');
    expect(body.target_word_count).toBe(1800);
    expect(body.answers.target_word_count).toBe('1800');
    expect(body.cache_version).toBe(`direct-suggestions-flow:${contentType}:article`);
  });

  it('falls back to the URL intent and reason when the bundle has no brief', async () => {
    sessionStorage.setItem('bundle-token', JSON.stringify({ suggestions: SUGGESTIONS }));
    const { body } = await renderAndGenerate('article', 'Article');

    expect(body.intent).toBe('authority');
    expect(body.answers.strategy_perspective).toContain('Strategic intent: authority.');
    expect(body.answers.strategy_perspective).toContain(BUNDLE.reason);
    expect(body.tone).toBeUndefined();
    expect(body.related_blogs).toBeUndefined();
    expect(body.answers.company_context).toBeUndefined();
  });

  it('with no brief at all the request is exactly the previous shape', async () => {
    mockQuery = { prefill_topic: BUNDLE.topic, prefill_bundle: 'bundle-token', format: 'article' };
    sessionStorage.setItem('bundle-token', JSON.stringify({ suggestions: SUGGESTIONS }));
    const { body } = await renderAndGenerate('article', 'Article');

    expect(Object.keys(body).sort()).toEqual(
      ['answers', 'cache_version', 'company_id', 'format_type', 'mode', 'target_word_count', 'topic'].sort(),
    );
    expect(Object.keys(body.answers).sort()).toEqual(
      ['campaign_objective', 'must_include_points', 'target_word_count', 'trend_context', 'uniqueness_directive'].sort(),
    );
  });
});

describe('post behaviour is unchanged', () => {
  it('the short-form request body is untouched even when a brief is present', async () => {
    mockQuery = { ...mockQuery, format: 'post', platform: 'linkedin' };
    const { body } = await renderAndGenerate('post', 'Post');

    expect(Object.keys(body).sort()).toEqual(
      ['company_id', 'extra_instruction', 'objective', 'platform', 'tone', 'topic'].sort(),
    );
    expect(body.company_id).toBe('tenant-company');
    expect(body.platform).toBe('linkedin');
    expect(body.tone).toBe('Lead with operator data');
    expect(body.objective).toBe('Drive demo requests');
    expect(body.answers).toBeUndefined();
    expect(body.intent).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(BUNDLE.brief.company_context);
  });
});

describe('buildAcceptedBriefFields', () => {
  it('returns no fields for a missing brief', () => {
    expect(buildAcceptedBriefFields(null)).toEqual({ answers: {} });
  });

  it('drops blank values instead of sending empty strings', () => {
    expect(
      buildAcceptedBriefFields({ intent: '  ', tone: '', company_context: ' ', related_titles: ['', '  '] }),
    ).toEqual({ answers: {} });
  });

  it('never emits the page-owned answer keys', () => {
    const out = buildAcceptedBriefFields({ ...BUNDLE.brief, reason: BUNDLE.reason } as any);
    for (const key of ['uniqueness_directive', 'must_include_points', 'campaign_objective', 'trend_context', 'target_word_count']) {
      expect(out.answers).not.toHaveProperty(key);
    }
  });
});
