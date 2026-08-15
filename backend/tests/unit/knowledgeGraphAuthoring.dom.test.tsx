/**
 * @jest-environment jsdom
 *
 * B7.9 — operator topic authoring UI, added to the EXISTING B7.6 surface.
 *
 * Proves the create/rename actions exist on the same page, send only the
 * approved fields, surface conflicts as errors, and leave every B7.6/B7.8-C
 * behaviour untouched.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KnowledgeGraphCuration from '../../../components/admin/knowledgeGraphCuration';

const TOPICS_API = '/api/admin/knowledge-graph/topics';
const CURATION_API = '/api/admin/knowledge-graph/canonical-topic';
const EMBED_API = '/api/admin/knowledge-graph/embed-topic';
const AUTHORING_API = '/api/admin/knowledge-graph/topic';

const identity = {
  id: 't1', canonicalLabel: 'AI lead qualification', normalizedLabel: 'ai lead qualification',
  canonicalTopicId: null, parentTopicId: null, state: 'observed', confidence: 'low',
  source: 'operator', occurrenceCount: 1, lastSeenAt: '2026-02-01',
};
const alias = { ...identity, id: 't2', canonicalLabel: 'AI powered lead qualification', canonicalTopicId: 't1' };

let calls: Array<{ url: string; method: string; body: unknown }>;

function mockFetch(authoringReply: { ok: boolean; status: number; json: unknown }, items: unknown[] = [identity]) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.startsWith(TOPICS_API)) {
      return { ok: true, status: 200, json: async () => ({ items, hasMore: false }) } as never;
    }
    if (url.startsWith(AUTHORING_API)) {
      return { ok: authoringReply.ok, status: authoringReply.status, json: async () => authoringReply.json } as never;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, action: 'confirmed', topicId: 't2' }) } as never;
  });
}

const created = { ok: true, status: 201, json: { ok: true, action: 'created', topicId: 'new-1', canonicalLabel: 'New Topic', normalizedLabel: 'new topic' } };
const authoringCalls = () => calls.filter((c) => c.url === AUTHORING_API);

beforeEach(() => { calls = []; jest.clearAllMocks(); });

describe('B7.9 · create action on the existing surface', () => {
  it('the create form lives on the B7.6 page (no separate app)', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.getByTestId('create-topic-btn')).toBeTruthy();
    expect(screen.getByLabelText('New topic label')).toBeTruthy();
    // B7.6 + B7.8-C surfaces still present on the same page.
    expect(screen.getByTestId('confirm-btn')).toBeTruthy();
    expect(screen.getByTestId('embed-t1')).toBeTruthy();
  });

  it('create is disabled until a label is entered', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const btn = screen.getByTestId('create-topic-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'New Topic' } });
    expect(btn.disabled).toBe(false);
  });

  it('posts ONLY the label to the authoring route', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'New Topic' } });
    fireEvent.click(screen.getByTestId('create-topic-btn'));

    await waitFor(() => expect(authoringCalls()).toHaveLength(1));
    expect(authoringCalls()[0].method).toBe('POST');
    expect(authoringCalls()[0].body).toEqual({ label: 'New Topic' });
    expect(Object.keys(authoringCalls()[0].body as object)).toEqual(['label']);
  });

  it('shows success and refreshes the list', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const before = calls.filter((c) => c.url.startsWith(TOPICS_API)).length;
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'New Topic' } });
    fireEvent.click(screen.getByTestId('create-topic-btn'));

    const msg = await screen.findByTestId('create-message');
    expect(msg.textContent).toMatch(/Created/i);
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith(TOPICS_API)).length).toBeGreaterThan(before));
  });

  it('a 409 conflict is shown as an ERROR, never as success', async () => {
    mockFetch({ ok: false, status: 409, json: { error: 'already_exists', topicId: 'existing-1' } });
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'AI lead qualification' } });
    fireEvent.click(screen.getByTestId('create-topic-btn'));

    const msg = await screen.findByTestId('create-message');
    expect(msg.textContent).toContain('already_exists');
    expect(msg.textContent).not.toMatch(/Created/i);
  });

  it('prevents duplicate submission while pending', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.startsWith(TOPICS_API)) return { ok: true, status: 200, json: async () => ({ items: [identity], hasMore: false }) } as never;
      return new Promise(() => {}) as never;   // hangs
    });
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'New Topic' } });
    const btn = screen.getByTestId('create-topic-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    fireEvent.click(btn); fireEvent.click(btn);
    expect(authoringCalls()).toHaveLength(1);
  });
});

describe('B7.9 · rename visibility', () => {
  /**
   * B7.9.2 — these three cases are the whole contract. B7.9 gated only on the
   * client-side session map, so an embedded topic still offered Rename after a
   * page reload; `hasEmbedding` is now the persisted fact from the row.
   */
  it('offered for an inert identity (no canonical parent, no embedding)', async () => {
    mockFetch(created, [{ ...identity, hasEmbedding: false }]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.getByTestId('rename-t1')).toBeTruthy();
  });

  it('HIDDEN for an embedded topic — even on a fresh load with no session state', async () => {
    // The B7.9 regression: canonicalTopicId is null, so the old condition
    // (!canonicalTopicId && !embed[id]) rendered Rename for this row.
    mockFetch(created, [{ ...identity, canonicalTopicId: null, hasEmbedding: true }]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.queryByTestId('rename-t1')).toBeNull();
    // Still an identity, so the other identity affordances remain.
    expect(screen.getByTestId('use-t1')).toBeTruthy();
    expect(screen.getByTestId('embed-t1')).toBeTruthy();
  });

  it('hidden for an alias (already canonicalised)', async () => {
    mockFetch(created, [alias]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.queryByTestId('rename-t2')).toBeNull();
  });

  it('hidden for an alias that is ALSO embedded', async () => {
    mockFetch(created, [{ ...alias, hasEmbedding: true }]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.queryByTestId('rename-t2')).toBeNull();
  });

  it('the session guard still hides Rename right after embedding in this tab', async () => {
    // hasEmbedding is stale (false) until the list refetches; embed[t.id]
    // covers that window.
    mockFetch({ ok: true, status: 202, json: { ok: true, status: 'accepted' } }, [{ ...identity, hasEmbedding: false }]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.getByTestId('rename-t1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('embed-t1'));
    await waitFor(() => expect(screen.queryByTestId('rename-t1')).toBeNull());
  });

  it('the client never receives an embedding vector', async () => {
    mockFetch(created, [{ ...identity, hasEmbedding: true }]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(document.body.innerHTML).not.toMatch(/\[0?\.\d+,/);
    expect(document.body.innerHTML).not.toContain('embedding_model');
  });

  it('PATCHes only topicId and label', async () => {
    mockFetch({ ok: true, status: 200, json: { ok: true, action: 'renamed', topicId: 't1', canonicalLabel: 'Renamed', normalizedLabel: 'renamed' } });
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('Renamed');
    try {
      render(<KnowledgeGraphCuration />);
      await screen.findByTestId('topic-table');
      fireEvent.click(screen.getByTestId('rename-t1'));
      await waitFor(() => expect(authoringCalls()).toHaveLength(1));
      expect(authoringCalls()[0].method).toBe('PATCH');
      expect(authoringCalls()[0].body).toEqual({ topicId: 't1', label: 'Renamed' });
    } finally { promptSpy.mockRestore(); }
  });

  it('a cancelled prompt issues no request', async () => {
    mockFetch(created);
    const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue(null);
    try {
      render(<KnowledgeGraphCuration />);
      await screen.findByTestId('topic-table');
      fireEvent.click(screen.getByTestId('rename-t1'));
      expect(authoringCalls()).toHaveLength(0);
    } finally { promptSpy.mockRestore(); }
  });
});

describe('B7.9 · existing behaviour unchanged', () => {
  it('confirm still posts to the B7.5 endpoint, not the authoring route', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.change(screen.getByLabelText('Source topic id'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Canonical topic id'), { target: { value: 't1' } });
    fireEvent.click(screen.getByTestId('confirm-btn'));
    await waitFor(() => expect(calls.some((c) => c.url === CURATION_API && c.method === 'POST')).toBe(true));
    expect(authoringCalls()).toHaveLength(0);
  });

  it('embedding still posts only topicId to the B7.8-C.4 route', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.click(screen.getByTestId('embed-t1'));
    await waitFor(() => expect(calls.some((c) => c.url === EMBED_API)).toBe(true));
    expect(calls.find((c) => c.url === EMBED_API)!.body).toEqual({ topicId: 't1' });
  });

  it('every request still targets an /api/admin/knowledge-graph endpoint', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'New Topic' } });
    fireEvent.click(screen.getByTestId('create-topic-btn'));
    await waitFor(() => expect(authoringCalls()).toHaveLength(1));
    for (const c of calls) {
      expect(c.url.startsWith('/api/admin/knowledge-graph/')).toBe(true);
      expect(c.url).not.toMatch(/openai|supabase|https?:/i);
    }
  });

  it('no company/organization field is ever sent', async () => {
    mockFetch(created);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.change(screen.getByLabelText('New topic label'), { target: { value: 'New Topic' } });
    fireEvent.click(screen.getByTestId('create-topic-btn'));
    await waitFor(() => expect(authoringCalls()).toHaveLength(1));
    for (const c of calls) {
      expect(JSON.stringify(c.body ?? {})).not.toMatch(/companyId|organizationId|campaignId|contentId/i);
    }
  });
});
