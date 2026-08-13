/**
 * @jest-environment jsdom
 *
 * B7.8-C.6 — platform embedding admin UI (DOM proofs 1–18).
 *
 * Follows the B7.6 `.dom.test.tsx` convention. The decisive assertions are
 * negative: the browser reaches exactly one endpoint, sends exactly one field,
 * and never claims an embedding exists when the route only accepted the work.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import KnowledgeGraphCuration from '../../../components/admin/knowledgeGraphCuration';

const TOPICS_API = '/api/admin/knowledge-graph/topics';
const CURATION_API = '/api/admin/knowledge-graph/canonical-topic';
const EMBED_API = '/api/admin/knowledge-graph/embed-topic';

const identity = {
  id: 't1', canonicalLabel: 'AI lead qualification', normalizedLabel: 'ai lead qualification',
  canonicalTopicId: null, parentTopicId: null, state: 'observed', confidence: 'low',
  source: 'content', occurrenceCount: 4, lastSeenAt: '2026-02-01',
};
const alias = { ...identity, id: 't2', canonicalLabel: 'AI powered lead qualification', canonicalTopicId: 't1' };

let calls: Array<{ url: string; method: string; body: unknown }>;

/** `embedReply` drives what the embed route returns; the list read always succeeds. */
function mockFetch(embedReply: { ok: boolean; status: number; json: unknown }, items: unknown[] = [identity]) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.startsWith(TOPICS_API)) {
      return { ok: true, status: 200, json: async () => ({ items, hasMore: false }) } as never;
    }
    if (url.startsWith(EMBED_API)) {
      return { ok: embedReply.ok, status: embedReply.status, json: async () => embedReply.json } as never;
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, action: 'confirmed', topicId: 't2' }) } as never;
  });
}

const accepted = { ok: true, status: 202, json: { ok: true, status: 'accepted', note: 'accepted for asynchronous processing' } };

/**
 * Render, wait for the table, click Generate embedding on `id`, and wait for
 * the request to SETTLE. The status element appears immediately in the
 * `pending` state, so asserting without this wait would test the spinner.
 */
async function clickEmbed(id = 't1') {
  render(<KnowledgeGraphCuration />);
  await screen.findByTestId('topic-table');
  fireEvent.click(screen.getByTestId('embed-' + id));
  const el = await screen.findByTestId('embed-status-' + id);
  await waitFor(() => expect(el.getAttribute('data-state')).not.toBe('pending'));
  return el;
}

const embedCalls = () => calls.filter((c) => c.url === EMBED_API);

beforeEach(() => { calls = []; jest.clearAllMocks(); });

/* ── 1-6: the action and its request shape ─────────────────────────────── */

describe('B7.8-C.6 · action and request shape', () => {
  it('1. renders the action for an eligible identity, and not for an alias', async () => {
    mockFetch(accepted, [identity, alias]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    expect(screen.getByTestId('embed-t1')).toBeTruthy();      // identity
    expect(screen.queryByTestId('embed-t2')).toBeNull();      // alias resolves elsewhere
  });

  it('2. clicking calls the certified B7.8-C.4 route with POST', async () => {
    mockFetch(accepted);
    await clickEmbed();
    await waitFor(() => expect(embedCalls()).toHaveLength(1));
    expect(embedCalls()[0].method).toBe('POST');
    expect(embedCalls()[0].url).toBe(EMBED_API);
  });

  it('3. the request body contains ONLY topicId', async () => {
    mockFetch(accepted);
    await clickEmbed();
    await waitFor(() => expect(embedCalls()).toHaveLength(1));
    expect(embedCalls()[0].body).toEqual({ topicId: 't1' });
    expect(Object.keys(embedCalls()[0].body as object)).toEqual(['topicId']);
  });

  it('4/5. no companyId and no organizationId are sent anywhere', async () => {
    mockFetch(accepted);
    await clickEmbed();
    await waitFor(() => expect(embedCalls()).toHaveLength(1));
    for (const c of calls) {
      const payload = JSON.stringify(c.body ?? {}) + ' ' + c.url;
      expect(payload).not.toMatch(/companyId|company_id/i);
      expect(payload).not.toMatch(/organizationId|organization_id/i);
    }
  });

  it('6. no provider, model, cost or arbitrary text is sent', async () => {
    mockFetch(accepted);
    await clickEmbed();
    await waitFor(() => expect(embedCalls()).toHaveLength(1));
    const payload = JSON.stringify(embedCalls()[0].body);
    for (const forbidden of ['provider', 'model', 'cost', 'text', 'embedding', 'apiKey', 'token']) {
      expect(payload).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });
});

/* ── 7: duplicate-click prevention ─────────────────────────────────────── */

describe('B7.8-C.6 · duplicate submission', () => {
  it('7. a pending request disables the button and refuses a second click', async () => {
    // Never-resolving embed call so the request stays pending for the assertion.
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.startsWith(TOPICS_API)) {
        return { ok: true, status: 200, json: async () => ({ items: [identity], hasMore: false }) } as never;
      }
      return new Promise(() => {}) as never;      // hangs
    });

    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const btn = screen.getByTestId('embed-t1') as HTMLButtonElement;

    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    expect(btn.textContent).toMatch(/Requesting/);

    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(embedCalls()).toHaveLength(1);         // still exactly one POST
  });

  it('the synchronous guard holds even for clicks inside a single tick', async () => {
    mockFetch(accepted);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const btn = screen.getByTestId('embed-t1');
    fireEvent.click(btn);
    fireEvent.click(btn);                          // same tick, before any re-render
    await waitFor(() => expect(screen.getByTestId('embed-status-t1')).toBeTruthy());
    expect(embedCalls()).toHaveLength(1);
  });
});

/* ── 8-13: every route state is handled ────────────────────────────────── */

describe('B7.8-C.6 · route state handling', () => {
  it('8. accepted is shown as asynchronous and does NOT claim an embedding exists', async () => {
    mockFetch(accepted);
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('accepted');
    expect(el.textContent).toMatch(/generating in the background/i);
    expect(el.textContent).toMatch(/no embedding exists yet/i);
    // The words that would mislead an operator into thinking it is queryable.
    expect(el.textContent).not.toMatch(/\b(complete|completed|done|embedded successfully)\b/i);
  });

  it('9. in_flight reports that generation is already running', async () => {
    mockFetch({ ok: true, status: 202, json: { ok: true, status: 'in_flight' } });
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('in_flight');
    expect(el.textContent).toMatch(/already generating/i);
  });

  it('10. already_embedded reports a completed state', async () => {
    mockFetch({ ok: true, status: 200, json: { ok: true, status: 'already_embedded' } });
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('already_embedded');
    expect(el.textContent).toMatch(/already embedded/i);
  });

  it('11. disabled reports the feature is off — not a failure of the topic', async () => {
    mockFetch({ ok: false, status: 503, json: { ok: false, status: 'disabled' } });
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('disabled');
    expect(el.textContent).toMatch(/disabled/i);
  });

  it('12. not_found reports the topic is gone', async () => {
    mockFetch({ ok: false, status: 404, json: { ok: false, status: 'not_found' } });
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('not_found');
    expect(el.textContent).toMatch(/not found/i);
  });

  it('13. error surfaces the route\'s deterministic reason, never a success', async () => {
    mockFetch({ ok: false, status: 500, json: { ok: false, status: 'error', reason: 'ledger_failed:pricing_missing' } });
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('error');
    expect(el.textContent).toMatch(/ledger_failed:pricing_missing/);
    expect(el.textContent).toMatch(/failed/i);
  });

  it('an authorization rejection is shown gracefully (no client-side auth logic)', async () => {
    mockFetch({ ok: false, status: 403, json: {} });   // guard bodies carry no status
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('unauthorized');
    expect(el.textContent).toMatch(/not authorized/i);
  });

  it('a network rejection is contained and shown as an error', async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: null });
      if (url.startsWith(TOPICS_API)) {
        return { ok: true, status: 200, json: async () => ({ items: [identity], hasMore: false }) } as never;
      }
      throw new Error('offline');
    });
    const el = await clickEmbed();
    expect(el.getAttribute('data-state')).toBe('error');
    expect(el.textContent).toMatch(/offline/);
  });
});

/* ── 14-16: the browser cannot reach anything but the route ────────────── */

describe('B7.8-C.6 · safety boundaries', () => {
  it('14/15/16. no OpenAI, no Supabase, no ledger — every call is an admin route', async () => {
    mockFetch(accepted);
    await clickEmbed();
    await waitFor(() => expect(embedCalls()).toHaveLength(1));
    for (const c of calls) {
      expect(c.url.startsWith('/api/admin/knowledge-graph/')).toBe(true);
      expect(c.url).not.toMatch(/openai|supabase|\.co|https?:/i);
    }
  });

  it('every non-GET request goes exclusively to the embed or curation route', async () => {
    mockFetch(accepted);
    await clickEmbed();
    await waitFor(() => expect(embedCalls()).toHaveLength(1));
    for (const c of calls) {
      if (c.method !== 'GET') expect([EMBED_API, CURATION_API]).toContain(c.url);
    }
  });

  it('the component source names no provider, ledger, table or client', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../components/admin/knowledgeGraphCuration.tsx'), 'utf8',
    );
    const code = src.split('\n')
      .filter((l: string) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
      .join('\n');
    for (const forbidden of [
      'openai', 'supabaseClient', 'createClient', 'platform_usage_events',
      'platform_topic_node', 'canonical_topic_id', 'parent_topic_id', 'company_topic_coverage',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('does not poll — a single click produces exactly one embed request', async () => {
    jest.useFakeTimers();
    try {
      mockFetch(accepted);
      render(<KnowledgeGraphCuration />);
      await screen.findByTestId('topic-table');
      fireEvent.click(screen.getByTestId('embed-t1'));
      await waitFor(() => expect(embedCalls()).toHaveLength(1));
      jest.advanceTimersByTime(120_000);
      expect(embedCalls()).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

/* ── 17-18: B7.6 behaviour is unchanged ────────────────────────────────── */

describe('B7.8-C.6 · existing B7.6 actions are unchanged', () => {
  it('17. confirm still posts the operator-supplied pair to the B7.5 endpoint', async () => {
    mockFetch(accepted);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');

    fireEvent.change(screen.getByLabelText('Source topic id'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Canonical topic id'), { target: { value: 't1' } });
    fireEvent.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => expect(calls.some((c) => c.url === CURATION_API && c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.url === CURATION_API)!.body).toEqual({ topicId: 't2', canonicalTopicId: 't1' });
    expect(embedCalls()).toHaveLength(0);          // curation never triggers spend
  });

  it('17. reverse still issues DELETE for an alias, and offers no embed action', async () => {
    mockFetch(accepted, [alias]);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    fireEvent.click(screen.getByTestId('reverse-t2'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')!.body).toEqual({ topicId: 't2' });
    expect(embedCalls()).toHaveLength(0);
  });

  it('18. "leave separate" still dismisses locally and issues NO request', async () => {
    mockFetch(accepted);
    render(<KnowledgeGraphCuration />);
    await screen.findByTestId('topic-table');
    const before = calls.length;
    fireEvent.click(screen.getByTestId('dismiss-t1'));
    await waitFor(() => expect(screen.queryByTestId('row-t1')).toBeNull());
    expect(calls.length).toBe(before);
    expect(embedCalls()).toHaveLength(0);
  });
});
