/**
 * send-transactional-email idempotency (correct-sending, pre-launch; e9 rulings 2026-11-13). The function used to
 * IGNORE `idempotencyKey`, so every keyed caller was silently not deduplicated. idempotency.ts reserves first and
 * sends only on its own reservation.
 *
 * The fake store implements the SAME state machine as the SQL functions (reserve / take over an expired 'sent' or
 * 'uncertain' - an uncertain row's window being max(type TTL, 7 days) from when it became uncertain / stale
 * 'sending' -> 'uncertain' / confirm-release-mark move only 'sending'); realschema/transactional_email_idempotency_real
 * holds the SQL to it, so the fake is no kinder than the real thing.
 */
import {
  DEFAULT_TTL_SECONDS, PreSendError, STALE_SENDING_SECONDS, classifySendError, recipientSha256, sendOnce, ttlSecondsFor,
  type IdempotencyStore, type ReserveOutcome,
} from '../../../supabase/functions/send-transactional-email/idempotency';

type Row = { state: 'sending' | 'sent' | 'uncertain'; messageId: string | null; createdAt: number; expiresAt: number; recipientSha256: string; emailType: string };
function fakeStore(clock: { now: number }) {
  const rows = new Map<string, Row>();
  const calls: string[] = [];
  const store: IdempotencyStore = {
    async reserve({ key, emailType, recipientSha256: r, ttlSeconds, staleSeconds }) {
      calls.push(`reserve:${key}`);
      const cur = rows.get(key);
      const fresh = (): Row => ({ state: 'sending', messageId: null, createdAt: clock.now, expiresAt: clock.now + ttlSeconds * 1000, recipientSha256: r, emailType });
      let outcome: ReserveOutcome;
      if (!cur) { rows.set(key, fresh()); outcome = 'reserved'; }
      else if ((cur.state === 'sent' || cur.state === 'uncertain') && cur.expiresAt <= clock.now) { rows.set(key, fresh()); outcome = 'reserved'; }
      else if (cur.state === 'sent') outcome = 'duplicate_sent';
      else if (cur.state === 'uncertain') outcome = 'duplicate_uncertain';
      else if (clock.now - cur.createdAt > staleSeconds * 1000) { cur.state = 'uncertain'; cur.expiresAt = Math.max(cur.expiresAt, clock.now + 7 * 24 * 3600 * 1000); outcome = 'stale_marked_uncertain'; }
      else outcome = 'duplicate_inflight';
      const row = rows.get(key);
      const freesAt = row && row.state === 'uncertain' && outcome !== 'reserved' ? new Date(row.expiresAt).toISOString() : null;
      return { outcome, messageId: row?.messageId ?? null, freesAt };
    },
    async confirm({ key, messageId }) { calls.push(`confirm:${key}`); const r = rows.get(key); if (r && r.state === 'sending') { r.state = 'sent'; r.messageId = messageId; } },
    async release({ key }) { calls.push(`release:${key}`); if (rows.get(key)?.state === 'sending') rows.delete(key); },
    async markUncertain({ key }) {
      calls.push(`uncertain:${key}`);
      const r = rows.get(key);
      if (!r || r.state !== 'sending') return null;
      r.state = 'uncertain';
      r.expiresAt = Math.max(r.expiresAt, clock.now + 7 * 24 * 3600 * 1000);
      return new Date(r.expiresAt).toISOString();
    },
  };
  return { store, rows, calls };
}
const net = (): Error => Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });
const http = (status: number): Error => Object.assign(new Error(`ses ${status}`), { $metadata: { httpStatusCode: status } });

function harness() {
  const clock = { now: Date.UTC(2026, 10, 13, 10) };
  const f = fakeStore(clock);
  const sends: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const run = (key: string | null, send: () => Promise<string | null>, emailType = 'team_invite') =>
    sendOnce({ key, emailType, recipient: ' Ada@Example.com ', store: f.store, send: async () => { sends.push(key ?? '-'); return send(); }, log: (e, d) => logs.push([e, d]) });
  return { clock, ...f, sends, logs, run };
}

describe('the same key twice -> ONE send', () => {
  it('second call is a duplicate success carrying the first message id; nothing sent again', async () => {
    const h = harness();
    expect(await h.run('reinvite:co:u', async () => 'mid-1')).toEqual({ status: 200, body: { ok: true, messageId: 'mid-1' } });
    expect(await h.run('reinvite:co:u', async () => 'mid-2')).toEqual({ status: 200, body: { ok: true, messageId: 'mid-1', duplicate: true } });
    expect(h.sends).toEqual(['reinvite:co:u']);
  });

  it('while the first is still sending, a second is refused (in flight, retryable) and does not send', async () => {
    const h = harness();
    let release!: (v: string) => void;
    const first = h.run('k', () => new Promise<string>((r) => { release = r; }));
    await new Promise((r) => setImmediate(r));
    expect(await h.run('k', async () => 'x')).toEqual({ status: 409, body: { ok: false, error: 'IDEMPOTENCY_IN_FLIGHT', duplicate: true, retryable: true } });
    release('mid-1');
    expect((await first).status).toBe(200);
    expect(h.sends).toEqual(['k']);
  });

  it('after the window, the same key may send again (team_invite: 1h)', async () => {
    const h = harness();
    await h.run('reinvite:co:u', async () => 'mid-1');
    h.clock.now += 3600 * 1000 + 1;
    expect(await h.run('reinvite:co:u', async () => 'mid-2')).toEqual({ status: 200, body: { ok: true, messageId: 'mid-2' } });
    expect(h.sends).toHaveLength(2);
  });
});

describe('a DEFINITE failure is retryable', () => {
  it.each([['a provider 4xx', () => http(400)], ['a pre-send configuration error', () => new PreSendError('SES_NOT_CONFIGURED')]])('%s: reservation released, the retry sends', async (_n, mk) => {
    const h = harness();
    expect(await h.run('k', async () => { throw mk(); })).toEqual(expect.objectContaining({ status: 500, body: expect.objectContaining({ retryable: true }) }));
    expect(h.calls).toContain('release:k');
    expect(await h.run('k', async () => 'mid-2')).toEqual({ status: 200, body: { ok: true, messageId: 'mid-2' } });
    expect(h.sends).toEqual(['k', 'k']);
  });
});

describe('an UNCERTAIN send is never resent', () => {
  it.each([['no answer (network / timeout)', net], ['a provider 5xx', () => http(503)]])('%s: marked uncertain; the retry is refused and sends nothing', async (_n, mk) => {
    const h = harness();
    expect(await h.run('k', async () => { throw mk(); })).toEqual(expect.objectContaining({ status: 502, body: expect.objectContaining({ uncertain: true, retryable: false }) }));
    expect(h.rows.get('k')?.state).toBe('uncertain');
    expect(await h.run('k', async () => 'mid-2')).toEqual({ status: 409, body: { ok: false, error: 'IDEMPOTENCY_UNCERTAIN', duplicate: true, retryable: false } });
    expect(h.sends).toEqual(['k']);
    expect(h.logs.map(([e]) => e)).toContain('TRANSACTIONAL_EMAIL_UNCERTAIN');
  });

  it('the UNCERTAIN WINDOW is max(type TTL, 7 days): never resent inside it; after it the key frees (e9 ruling, 05)', async () => {
    const h = harness(); // team_invite: TTL 1h, so the 7-day floor rules
    const markedAt = h.clock.now;
    await h.run('k', async () => { throw net(); });
    const alert = h.logs.find(([e]) => e === 'TRANSACTIONAL_EMAIL_UNCERTAIN')![1];
    expect(alert.freesAt).toBe(new Date(markedAt + 7 * 24 * 3600 * 1000).toISOString()); // the alert says WHEN the key frees
    h.clock.now = markedAt + 7 * 24 * 3600 * 1000 - 1;
    expect((await h.run('k', async () => 'x')).status).toBe(409);       // still inside: never resent
    h.clock.now = markedAt + 7 * 24 * 3600 * 1000 + 1;
    expect(await h.run('k', async () => 'mid-2')).toEqual({ status: 200, body: { ok: true, messageId: 'mid-2' } }); // freed
    expect(h.sends).toEqual(['k', 'k']);
  });

  it('a type TTL LONGER than 7 days keeps the uncertain window that long (lead_outreach: 30 days)', async () => {
    const h = harness();
    const at = h.clock.now;
    await h.run('k', async () => { throw net(); }, 'lead_outreach');
    h.clock.now = at + 8 * 24 * 3600 * 1000;
    expect((await h.run('k', async () => 'x', 'lead_outreach')).status).toBe(409);
    h.clock.now = at + 30 * 24 * 3600 * 1000 + 1;
    expect((await h.run('k', async () => 'y', 'lead_outreach')).status).toBe(200);
  });

  it('a reservation stuck in sending (crash mid-send) past the stale bound becomes uncertain, is never resent, and raises an alert-ready event', async () => {
    const h = harness();
    await h.store.reserve({ key: 'k', emailType: 'team_invite', recipientSha256: 'x', ttlSeconds: 3600, staleSeconds: STALE_SENDING_SECONDS }); // the crashed send
    h.clock.now += STALE_SENDING_SECONDS * 1000 + 1;
    expect(await h.run('k', async () => 'x')).toEqual({ status: 409, body: { ok: false, error: 'IDEMPOTENCY_UNCERTAIN', duplicate: true, retryable: false } });
    expect(h.rows.get('k')?.state).toBe('uncertain');
    expect(h.sends).toEqual([]);
    expect(h.logs).toEqual(expect.arrayContaining([['TRANSACTIONAL_EMAIL_UNCERTAIN', expect.objectContaining({ reason: 'stale_sending_reservation', freesAt: expect.any(String) })]]));
  });
});

describe('fail SAFE around the store', () => {
  it('reserve unavailable -> 503 retryable and NOTHING sent', async () => {
    const h = harness();
    h.store.reserve = async () => { throw new Error('db down'); };
    expect(await h.run('k', async () => 'x')).toEqual({ status: 503, body: { ok: false, error: 'IDEMPOTENCY_STORE_UNAVAILABLE', retryable: true } });
    expect(h.sends).toEqual([]);
  });

  it('sent but confirm failed -> the caller is told it was sent; the reservation stays sending (-> uncertain later, never resent)', async () => {
    const h = harness();
    h.store.confirm = async () => { throw new Error('db down'); };
    expect(await h.run('k', async () => 'mid-1')).toEqual({ status: 200, body: { ok: true, messageId: 'mid-1' } });
    expect(h.rows.get('k')?.state).toBe('sending');
    expect(h.logs.map(([e]) => e)).toContain('TRANSACTIONAL_EMAIL_CONFIRM_FAILED');
  });

  it('no key -> sends as before, the store is never touched', async () => {
    const h = harness();
    expect(await h.run(null, async () => 'mid')).toEqual({ status: 200, body: { ok: true, messageId: 'mid' } });
    expect(h.calls).toEqual([]);
  });
});

describe('the window is decided SERVER-side from the type', () => {
  it.each([
    ['team_invite', 'reinvite:c:u', 3600],
    ['company_referral', 'company-referral:x@y.z', 7 * 86400],
    ['inbound_signup_notice', 'inbound-signup-notice:c:x', 7 * 86400],
    ['credit_alert', 'credit_alert:org:low:2026-11-13', 86400],
    ['credit_alert', 'credit_alert:org:2026-11', 31 * 86400],
    ['lead_outreach', 'outreach:task:1', 30 * 86400],
  ])('%s (%s) -> %i s', (type, key, ttl) => {
    expect(ttlSecondsFor(type, key)).toEqual({ ttlSeconds: ttl, known: true });
  });

  it('an unknown type gets the conservative default and a log', async () => {
    expect(ttlSecondsFor('brand_new_type', 'k')).toEqual({ ttlSeconds: DEFAULT_TTL_SECONDS, known: false });
    const h = harness();
    await h.run('k', async () => 'm', 'brand_new_type');
    expect(h.logs.map(([e]) => e)).toContain('TRANSACTIONAL_EMAIL_TTL_DEFAULTED');
  });
});

it('classification: only a PreSendError or a provider 4xx is definite; a 5xx or no answer is uncertain', () => {
  expect([classifySendError(new PreSendError('x')), classifySendError(http(429)), classifySendError(http(500)), classifySendError(net()), classifySendError('weird')])
    .toEqual(['definite', 'definite', 'uncertain', 'uncertain', 'uncertain']);
});

it('the store receives the recipient\'s SHA-256 of the normalised address, never the address', async () => {
  const h = harness();
  await h.run('k', async () => 'm');
  const row = h.rows.get('k')!;
  expect(row.recipientSha256).toBe(await recipientSha256('ada@example.com'));
  expect(row.recipientSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify([...h.rows.values()])).not.toMatch(/ada@example\.com/i);
});
