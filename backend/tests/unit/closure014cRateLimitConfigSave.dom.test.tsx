/**
 * @jest-environment jsdom
 *
 * Closure-014C (Finding D) — the Rate Limiter tab must report "saved" only
 * after the server confirmed the write.
 *
 * Closure-014B: every UI write to /api/admin/rate-limit-config was a bare
 * fetch with no Idempotency-Key (the route is wrapped by withIdempotency, so
 * it ALWAYS answered 400 IDEMPOTENCY_KEY_REQUIRED), the response was ignored,
 * local config was replaced and a "saved" check mark was shown.
 *
 * Real component (RedisEfficiencyPanel → RateLimiterTab), real
 * performSuperAdminWrite; only fetch is a fake, keyed by URL. The route's
 * authorization is NOT under test here and is not changed (see the 014C
 * report: route inventory and the separate authorization decision).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../../lib/security/stepUpClient', () => ({ triggerWebAuthnStepUp: jest.fn() }));

import RedisEfficiencyPanel from '../../../components/super-admin/RedisEfficiencyPanel';

type Body = Record<string, unknown> | null;
function res(status: number, body: Body = {}, headers: Record<string, string> = {}): Response {
  const h = { get: (k: string) => headers[k.toLowerCase()] ?? null } as unknown as Headers;
  const make = (): unknown => ({ ok: status >= 200 && status < 300, status, headers: h, json: async () => body, text: async () => JSON.stringify(body), clone: () => make() });
  return make() as Response;
}

let posts: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
let postReply: () => Promise<Response>;

beforeEach(() => {
  posts = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/admin/rate-limit-config') && init?.method === 'POST') {
      posts.push({ headers: (init.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init.body)) });
      return postReply();
    }
    if (url.includes('rate-limit-config')) return res(200, { v: 1, updatedAt: 'x', endpoints: {} });
    if (url.includes('redis-metrics')) return res(200, { live: null });
    return res(503, {});
  });
});

async function openRateLimiter() {
  render(<RedisEfficiencyPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Rate Limiter' }));
  const row = (await screen.findByText('/api/auth/login')).closest('tr') as HTMLElement;
  const [limit] = within(row).getAllByRole('spinbutton') as HTMLInputElement[];
  fireEvent.change(limit, { target: { value: '7' } });
  return { row, limit, save: within(row).getAllByRole('button')[0] };
}
const savedMarkShown = (row: HTMLElement) => within(row).getAllByRole('button')[0].className.includes('emerald');

describe('Rate Limiter save reports only confirmed outcomes', () => {
  it('2xx: one POST carrying a fresh Idempotency-Key, saved mark shown, no error banner', async () => {
    postReply = async () => res(200, { ok: true });
    const { row, save } = await openRateLimiter();
    fireEvent.click(save);
    await waitFor(() => expect(savedMarkShown(row)).toBe(true));
    expect(posts).toHaveLength(1);
    expect(posts[0].headers['Idempotency-Key']).toMatch(/.+/);
    expect((posts[0].body.endpoints as Record<string, { limit: number }>).login.limit).toBe(7);
    expect(screen.queryByText(/^Not saved:/)).not.toBeInTheDocument();
  });

  it('429: "Not saved" with the wait from Retry-After, NO saved mark, the edited value is kept', async () => {
    postReply = async () => res(429, { error: 'Too many requests', code: 'RATE_LIMITED' }, { 'retry-after': '30' });
    const { row, limit, save } = await openRateLimiter();
    fireEvent.click(save);
    expect(await screen.findByText(/^Not saved: Too many requests\. Wait 30 seconds/)).toBeInTheDocument();
    expect(savedMarkShown(row)).toBe(false);
    expect(limit.value).toBe('7');
  });

  it('other non-2xx (500): "Not saved" with the server message, NO saved mark, value kept', async () => {
    postReply = async () => res(500, { error: 'redis write failed' });
    const { row, limit, save } = await openRateLimiter();
    fireEvent.click(save);
    expect(await screen.findByText(/^Not saved: Server error/)).toBeInTheDocument();
    expect(savedMarkShown(row)).toBe(false);
    expect(limit.value).toBe('7');
  });

  it('network failure: "Not saved" network message, NO saved mark, value kept', async () => {
    postReply = async () => { throw new TypeError('Failed to fetch'); };
    const { row, limit, save } = await openRateLimiter();
    fireEvent.click(save);
    expect(await screen.findByText(/^Not saved: Network error/)).toBeInTheDocument();
    expect(savedMarkShown(row)).toBe(false);
    expect(limit.value).toBe('7');
  });

  it('a failed save does not mark the endpoint as overridden (local config unchanged)', async () => {
    postReply = async () => res(500, { error: 'boom' });
    const { row, save } = await openRateLimiter();
    fireEvent.click(save);
    await screen.findByText(/^Not saved:/);
    expect(within(row).queryByText('overridden')).not.toBeInTheDocument();
    expect(within(row).getByText('default')).toBeInTheDocument();
  });
});
