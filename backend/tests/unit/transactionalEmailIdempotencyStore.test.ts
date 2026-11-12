/**
 * send-transactional-email's idempotency store (store.ts): the four RPCs over PostgREST with the secret key, each
 * with a hard timeout, each THROWING on anything but a well-formed 2xx (idempotency.ts turns a reserve failure into
 * "nothing sent"). A key that never needs a store never builds one (index.ts wiring, pinned elsewhere).
 */
import { randomBytes } from 'crypto';
import { rpcStore } from '../../../supabase/functions/send-transactional-email/store';

const KEY = `sb_secret_${randomBytes(12).toString('hex')}`;
type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal } };
function fetchReturning(status: number, body: unknown) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

it('reserve: POSTs the RPC with the secret key and p_* arguments; reads the set-returning answer', async () => {
  const f = fetchReturning(200, [{ outcome: 'duplicate_sent', message_id: 'mid-1' }]);
  const store = rpcStore({ url: 'https://proj.supabase.co/', key: KEY, fetchImpl: f.impl });
  expect(await store.reserve({ key: 'k', emailType: 'team_invite', recipientSha256: 'h', ttlSeconds: 3600, staleSeconds: 900 }))
    .toEqual({ outcome: 'duplicate_sent', messageId: 'mid-1' });
  expect(f.calls[0].url).toBe('https://proj.supabase.co/rest/v1/rpc/transactional_email_reserve');
  expect(f.calls[0].init.method).toBe('POST');
  expect(f.calls[0].init.headers).toEqual(expect.objectContaining({ apikey: KEY, Authorization: `Bearer ${KEY}` }));
  expect(JSON.parse(f.calls[0].init.body)).toEqual({ p_key: 'k', p_email_type: 'team_invite', p_recipient_sha256: 'h', p_ttl_seconds: 3600, p_stale_seconds: 900 });
});

it('confirm / release / markUncertain call their RPCs with p_* arguments', async () => {
  const f = fetchReturning(204, undefined);
  const store = rpcStore({ url: 'https://proj.supabase.co', key: KEY, fetchImpl: f.impl });
  await store.confirm({ key: 'k', messageId: 'm' });
  await store.release({ key: 'k' });
  await store.markUncertain({ key: 'k', reason: 'socket hang up' });
  expect(f.calls.map((c) => [c.url.split('/rpc/')[1], JSON.parse(c.init.body)])).toEqual([
    ['transactional_email_confirm', { p_key: 'k', p_message_id: 'm' }],
    ['transactional_email_release', { p_key: 'k' }],
    ['transactional_email_mark_uncertain', { p_key: 'k', p_reason: 'socket hang up' }],
  ]);
});

it('an unrecognised reserve answer THROWS (never read as "reserved")', async () => {
  for (const body of [[], [{ outcome: 'maybe' }], null, [{}]]) {
    const store = rpcStore({ url: 'https://p', key: KEY, fetchImpl: fetchReturning(200, body).impl });
    await expect(store.reserve({ key: 'k', emailType: 't', recipientSha256: 'h', ttlSeconds: 1, staleSeconds: 1 })).rejects.toThrow(/RESERVE_UNREADABLE/);
  }
});

it('a non-2xx answer THROWS, for every RPC', async () => {
  const store = rpcStore({ url: 'https://p', key: KEY, fetchImpl: fetchReturning(500, { message: 'x' }).impl });
  await expect(store.reserve({ key: 'k', emailType: 't', recipientSha256: 'h', ttlSeconds: 1, staleSeconds: 1 })).rejects.toThrow(/HTTP_500/);
  await expect(store.confirm({ key: 'k', messageId: null })).rejects.toThrow(/HTTP_500/);
  await expect(store.release({ key: 'k' })).rejects.toThrow(/HTTP_500/);
  await expect(store.markUncertain({ key: 'k', reason: 'r' })).rejects.toThrow(/HTTP_500/);
});

it('a hung call is ABORTED at the timeout and throws (never holds the send open)', async () => {
  const hang = ((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as unknown as typeof fetch;
  const store = rpcStore({ url: 'https://p', key: KEY, fetchImpl: hang, timeoutMs: 30 });
  await expect(store.release({ key: 'k' })).rejects.toThrow(/aborted/);
});

it('no URL or no key: refused at construction (the handler turns that into 503, nothing sent)', () => {
  expect(() => rpcStore({ url: '', key: KEY })).toThrow(/NOT_CONFIGURED/);
  expect(() => rpcStore({ url: 'https://p', key: '' })).toThrow(/NOT_CONFIGURED/);
});
