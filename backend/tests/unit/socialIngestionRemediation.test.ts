/**
 * Phase 87 — social ingestion remediation.
 *
 * WHAT THESE GUARD
 * ----------------
 * The production failure was not one bug but three that disguised each other:
 *   1. X replies were fetched from an endpoint that does not exist (permanent
 *      404, misread as an auth problem);
 *   2. a rejected credential was never refreshed on 401, and a FAILED refresh
 *      silently fell through to a provider call with the stale token;
 *   3. any adapter failure re-issued the identical request through the legacy
 *      path, doubling every guaranteed-failing call.
 *
 * Each test below fails if one of those returns. In particular the endpoint
 * assertions are written as "must NOT contain /replies" rather than only
 * "must contain search/recent", because the original defect was a URL that
 * looked plausible.
 */

import {
  buildXConversationSearchUrl,
  isOutsideXRecentSearchWindow,
  X_RECENT_SEARCH_WINDOW_DAYS,
} from '../../services/engagement/xReplyQuery';
import {
  ProviderRequestError,
  providerErrorFromResponse,
  classifyStatus,
  isAuthFailure,
  isProviderRequestError,
} from '../../services/engagement/providerRequestError';

/** Minimal Response stand-in: only what providerErrorFromResponse consumes. */
const res = (status: number, body: string) => ({ status, text: async () => body });

describe('A — X reply retrieval uses conversation search, not the phantom endpoint', () => {
  const url = buildXConversationSearchUrl('https://api.twitter.com/2', '1750000000000000000');

  it('CRITICAL: never uses /tweets/{id}/replies', () => {
    // The exact shape of the original defect.
    expect(url).not.toMatch(/\/tweets\/[^/]+\/replies/);
  });

  it('CRITICAL: targets the recent-search endpoint', () => {
    expect(url).toContain('/tweets/search/recent');
  });

  it('CRITICAL: queries by conversation_id, URL-encoded', () => {
    // `conversation_id:123` must survive as a query PARAMETER value — the colon
    // is encoded, which is what makes it a valid query string.
    expect(url).toContain('query=conversation_id');
    expect(url).toContain('1750000000000000000');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('query')).toBe('conversation_id:1750000000000000000');
  });

  it('requests the fields the normalizer reads', () => {
    const parsed = new URL(url);
    const fields = parsed.searchParams.get('tweet.fields') ?? '';
    expect(fields).toContain('created_at');   // platform_created_at
    expect(fields).toContain('author_id');    // author_name
  });

  it('stays within X\'s max_results cap', () => {
    const max = Number(new URL(url).searchParams.get('max_results'));
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(100);
  });

  it('handles a base URL with a trailing slash without doubling it', () => {
    expect(buildXConversationSearchUrl('https://api.twitter.com/2/', '42')).not.toContain('//tweets');
  });
});

describe('B — the 7-day recent-search limitation is represented, not hidden', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-08-27T12:00:00.000Z');

  it('declares the window explicitly', () => {
    expect(X_RECENT_SEARCH_WINDOW_DAYS).toBe(7);
  });

  it('a post older than the window is known to be unreachable', () => {
    expect(isOutsideXRecentSearchWindow(new Date(now - 8 * DAY).toISOString(), now)).toBe(true);
  });

  it('a post inside the window is reachable', () => {
    expect(isOutsideXRecentSearchWindow(new Date(now - 2 * DAY).toISOString(), now)).toBe(false);
  });

  it('CRITICAL: unknown or unparseable age attempts the fetch rather than assuming failure', () => {
    // Silently skipping on missing data would look identical to "no replies".
    expect(isOutsideXRecentSearchWindow(null, now)).toBe(false);
    expect(isOutsideXRecentSearchWindow(undefined, now)).toBe(false);
    expect(isOutsideXRecentSearchWindow('not-a-date', now)).toBe(false);
  });
});

describe('C — provider failures are classified, not flattened to statusText', () => {
  it('CRITICAL: 401 and 404 are different kinds', () => {
    // The whole diagnostic failure of the incident in one assertion.
    expect(classifyStatus(401)).toBe('auth');
    expect(classifyStatus(404)).toBe('not_found');
    expect(classifyStatus(401)).not.toBe(classifyStatus(404));
  });

  it('classifies 403, 429 and 5xx distinctly', () => {
    expect(classifyStatus(403)).toBe('auth');
    expect(classifyStatus(429)).toBe('rate_limited');
    expect(classifyStatus(500)).toBe('provider');
  });

  it('only auth failures are eligible for refresh-and-retry', () => {
    expect(isAuthFailure(new ProviderRequestError({ provider: 'x', status: 401, endpointCategory: 'replies' }))).toBe(true);
    expect(isAuthFailure(new ProviderRequestError({ provider: 'x', status: 404, endpointCategory: 'replies' }))).toBe(false);
    expect(isAuthFailure(new Error('adapter unsupported'))).toBe(false);
  });

  it('preserves the provider error code and message', async () => {
    const e = await providerErrorFromResponse(
      res(401, JSON.stringify({ serviceErrorCode: 65600, message: 'Invalid access token' })),
      { provider: 'linkedin', endpointCategory: 'comments' },
    );
    expect(e.status).toBe(401);
    expect(e.kind).toBe('auth');
    expect(e.providerCode).toBe('65600');
    expect(e.providerMessage).toBe('Invalid access token');
  });

  it('handles X\'s error shape too', async () => {
    const e = await providerErrorFromResponse(
      res(404, JSON.stringify({ title: 'Not Found Error', detail: 'Could not find tweet' })),
      { provider: 'x', endpointCategory: 'replies' },
    );
    expect(e.kind).toBe('not_found');
    expect(e.providerMessage).toBe('Could not find tweet');
  });

  it('survives a non-JSON body without masking the status', async () => {
    const e = await providerErrorFromResponse(res(502, '<html>Bad Gateway</html>'), {
      provider: 'linkedin', endpointCategory: 'comments',
    });
    expect(e.status).toBe(502);
    expect(e.kind).toBe('provider');
  });

  it('survives an empty body and an unreadable body', async () => {
    expect((await providerErrorFromResponse(res(500, ''), { provider: 'x', endpointCategory: 'replies' })).status).toBe(500);
    const broken = { status: 503, text: async () => { throw new Error('stream closed'); } };
    const e = await providerErrorFromResponse(broken, { provider: 'x', endpointCategory: 'replies' });
    expect(e.status).toBe(503);
  });
});

describe('D — diagnostics never carry credentials', () => {
  it('CRITICAL: a bearer token echoed by a provider is redacted', async () => {
    const leak = 'Bearer AAAAAAAAAAAAAAAAAAAAAMLheAAAAAAA0%2BuSeid%2BULvsea8VaLLLLLL';
    const e = await providerErrorFromResponse(
      res(401, JSON.stringify({ message: `token rejected: ${leak}` })),
      { provider: 'x', endpointCategory: 'replies' },
    );
    const serialized = JSON.stringify(e.toLogPayload()) + e.message;
    expect(serialized).not.toContain('AAAAAAAAAAAAAAAAAAAAAMLheAAAAAAA');
    expect(serialized).toContain('[REDACTED]');
  });

  it('CRITICAL: token-shaped JSON fields are redacted', async () => {
    const e = await providerErrorFromResponse(
      res(401, JSON.stringify({ message: 'ctx', access_token: 'sk-liveSECRETVALUE1234567890abcdefghij' })),
      { provider: 'linkedin', endpointCategory: 'comments' },
    );
    expect(JSON.stringify(e.toLogPayload())).not.toContain('SECRETVALUE');
  });

  it('the log payload is structured and free of full URLs', () => {
    const p = new ProviderRequestError({
      provider: 'x', status: 401, endpointCategory: 'replies',
      providerCode: '89', providerMessage: 'Invalid or expired token',
    }).toLogPayload();
    expect(p).toMatchObject({
      provider: 'x', status: 401, endpoint_category: 'replies', failure_kind: 'auth', provider_code: '89',
    });
    // Endpoint category only — a full URL would carry post ids.
    expect(JSON.stringify(p)).not.toContain('https://');
  });

  it('caps an oversized provider message', async () => {
    const e = await providerErrorFromResponse(res(500, 'x'.repeat(5000)), {
      provider: 'x', endpointCategory: 'replies',
    });
    expect((e.providerMessage ?? '').length).toBeLessThanOrEqual(300);
  });
});

describe('E — a provider failure is a provider failure, whoever raised it', () => {
  it('CRITICAL: adapter provider errors are recognisable, so the caller can refuse to re-issue them', () => {
    // This predicate is what stops the legacy fallback from doubling the call.
    expect(isProviderRequestError(new ProviderRequestError({ provider: 'x', status: 401, endpointCategory: 'replies' }))).toBe(true);
    // An adapter that simply cannot attempt the call is NOT a provider failure,
    // so the legacy path remains available for it.
    expect(isProviderRequestError(new Error('twitter does not support replies'))).toBe(false);
    expect(isProviderRequestError(null)).toBe(false);
  });
});
