/**
 * @jest-environment jsdom
 *
 * B7.6 — curation review surface DOM tests (UI proofs 11–20).
 *
 * Follows the repository's existing `.dom.test.tsx` convention: RTL scoped to
 * one component, opting into jsdom via the pragma above.
 *
 * The decisive assertions are negative: the UI never writes to a database, only
 * ever mutates through the B7.5 endpoint, and renders no tenant data.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KnowledgeGraphCuration from '../../../components/admin/knowledgeGraphCuration';

const TOPICS_API = '/api/admin/knowledge-graph/topics';
const CURATION_API = '/api/admin/knowledge-graph/canonical-topic';

const identity = {
  id: 't1', canonicalLabel: 'AI lead qualification', normalizedLabel: 'ai lead qualification',
  canonicalTopicId: null, parentTopicId: null, state: 'observed', confidence: 'low',
  source: 'content', occurrenceCount: 4, lastSeenAt: '2026-02-01',
};
const alias = { ...identity, id: 't2', canonicalLabel: 'AI powered lead qualification', canonicalTopicId: 't1' };

/** Records every fetch so "no direct DB mutation" and "goes through B7.5" are provable. */
let calls: Array<{ url: string; method: string; body: unknown }>;

function mockFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json: unknown }) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = handler(url, init);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.json } as never;
  });
}

const listOk = (items: unknown[], hasMore = false) =>
  mockFetch((url) => url.startsWith(TOPICS_API)
    ? { ok: true, json: { items, hasMore, page: 0, pageSize: 25, filter: 'identities', mode: 'list' } }
    : { ok: true, json: { ok: true, action: 'confirmed', topicId: 't2', canonicalTopicId: 't1' } });

beforeEach(() => { calls = []; jest.clearAllMocks(); });

describe('B7.6 · UI states', () => {
  it('11. renders a loading state before data arrives', async () => {
    listOk([identity]);
    render(<KnowledgeGraphCuration />);
    expect(screen.getByTestId('loading')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('loading')).toBeNull());
  });

  it('12. renders the empty state and names B7.7 as the future candidate source', async () => {
    listOk([]);
    render(<KnowledgeGraphCuration />);
    const empty = await screen.findByTestId('empty');
    expect(empty.textContent).toMatch(/B7\.7/);
  });

  it('13. renders an error state when the read fails', async () => {
    mockFetch(() => ({ ok: false, status: 500, json: {} }));
    render(<KnowledgeGraphCuration />);
    expect((await screen.findByTestId('error')).textContent).toMatch(/500/);
  });

  it('14. presents the review row with its deterministic metadata', async () => {
    listOk([identity]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const row = screen.getByTestId('row-t1');
    expect(row.textContent).toContain('AI lead qualification');
    expect(row.textContent).toContain('observed');   // state
    expect(row.textContent).toContain('low');        // confidence
  });
});

describe('B7.6 · operator actions go through B7.5', () => {
  it('15. confirm posts to the B7.5 endpoint with the operator-supplied pair', async () => {
    listOk([identity]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');

    fireEvent.change(screen.getByLabelText('Source topic id'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Canonical topic id'), { target: { value: 't1' } });
    fireEvent.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => expect(calls.some((c) => c.url === CURATION_API && c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ topicId: 't2', canonicalTopicId: 't1' });
  });

  it('16. reverse issues DELETE to the B7.5 endpoint', async () => {
    listOk([alias]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.click(screen.getByTestId('reverse-t2'));
    await waitFor(() => expect(calls.some((c) => c.url === CURATION_API && c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({ topicId: 't2' });
  });

  it('17. "leave separate" dismisses locally and issues NO request', async () => {
    listOk([identity]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const before = calls.length;
    fireEvent.click(screen.getByTestId('dismiss-t1'));
    await waitFor(() => expect(screen.queryByTestId('row-t1')).toBeNull());
    expect(calls.length).toBe(before);          // no persistent rejection model invented
    expect(screen.getByTestId('empty')).toBeTruthy();
  });

  it('9/18. a failed confirmation surfaces B7.5\'s deterministic reason and changes nothing', async () => {
    mockFetch((url) => url.startsWith(TOPICS_API)
      ? { ok: true, json: { items: [identity], hasMore: false } }
      : { ok: false, status: 409, json: { error: 'would_create_cycle', code: 'WOULD_CREATE_CYCLE' } });
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');

    fireEvent.change(screen.getByLabelText('Source topic id'), { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText('Canonical topic id'), { target: { value: 't2' } });
    fireEvent.click(screen.getByTestId('confirm-btn'));

    expect((await screen.findByTestId('message')).textContent).toContain('would_create_cycle');
    expect(screen.getByTestId('row-t1')).toBeTruthy();   // row unchanged
  });
});

describe('B7.6 · safety boundaries', () => {
  it('20. every request goes to an /api/admin endpoint — no direct DB access', async () => {
    listOk([alias]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.click(screen.getByTestId('reverse-t2'));
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
    for (const c of calls) expect(c.url.startsWith('/api/admin/knowledge-graph/')).toBe(true);
  });

  it('19. no companyId is ever sent, and no tenant field is rendered', async () => {
    listOk([identity]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    for (const c of calls) {
      expect(c.url).not.toMatch(/company/i);
      expect(JSON.stringify(c.body ?? {})).not.toMatch(/company/i);
    }
    const html = document.body.innerHTML;
    for (const forbidden of ['company_id', 'companyId', 'campaign_id', 'campaignId', 'content_id']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('mutations are only ever POST/DELETE on the B7.5 route; reads are GET only', async () => {
    listOk([alias]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.click(screen.getByTestId('reverse-t2'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    for (const c of calls) {
      if (c.method !== 'GET') expect(c.url).toBe(CURATION_API);
      else expect(c.url.startsWith(TOPICS_API)).toBe(true);
    }
  });
});
