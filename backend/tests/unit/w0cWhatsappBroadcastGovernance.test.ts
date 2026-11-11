/**
 * W0-C — the WhatsApp broadcast path must not bypass contact governance.
 *
 * This path reaches Meta Graph directly (`whatsappBroadcastService.processBatch`
 * → `fetch(META_GRAPH/.../messages)`), through its own API route and queue, and
 * never passes the outreach dispatch gate. Before W0-C it consulted no
 * suppression store at all, while `whatsapp` was already a KNOWN_CHANNEL — so a
 * tenant could hold a WhatsApp restriction for a number and still broadcast to
 * it.
 *
 * Every assertion below is made against the REAL `processBatch`, with `fetch`
 * spied, so a refusal is proven by the absence of a provider call rather than by
 * a return value.
 *
 * NOTE: the external call is a spy. Nothing here contacts Meta, and no provider
 * credential is real.
 */

import crypto from 'crypto';

const KEY = Buffer.from('11'.repeat(32), 'hex');   // 32 bytes, test-only

type Row = Record<string, unknown>;

const db = {
  broadcasts: [] as Row[],
  accounts: [] as Row[],
  recipients: [] as Row[],
  governance: [] as Row[],
  updates: [] as Array<{ table: string; patch: Row }>,
  failTable: null as string | null,
};

const fetchCalls: string[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select' as 'select' | 'update', patch: null as Row | null, eq: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown[]]> };
    const rows = (): Row[] =>
      table === 'whatsapp_broadcasts' ? db.broadcasts
        : table === 'social_accounts' ? db.accounts
          : table === 'whatsapp_broadcast_recipients' ? db.recipients
            : table === 'contact_governance_records' ? db.governance : [];
    const match = (r: Row) => st.eq.every(([c, v]) => (v === null ? r[c] == null : r[c] === v))
      && st.ins.every(([c, vs]) => vs.indexOf(r[c]) !== -1);
    const run = async () => {
      if (db.failTable === table) return { data: null, error: { message: 'governance store unreadable' } };
      if (st.op === 'update') {
        // Like Postgres: `whatsapp_broadcast_recipients.error_code` is INTEGER
        // (supabase/_schema/baseline.sql), so a non-integer value fails the whole
        // statement with 22P02 and no column of the row changes.
        const code = (st.patch as Row).error_code;
        if (table === 'whatsapp_broadcast_recipients' && code != null && !Number.isInteger(code)) {
          return { data: null, error: { code: '22P02', message: 'invalid input syntax for type integer' } };
        }
        db.updates.push({ table, patch: st.patch as Row });
        // Like PostgREST's `update().select()`: the rows the update matched, so a
        // compare-and-set claim can tell whether it won.
        const affected = rows().filter(match);
        affected.forEach((r) => Object.assign(r, st.patch));
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows().filter(match), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      update: (p: Row) => { st.op = 'update'; st.patch = p; return api; },
      eq: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
      is: (c: string, v: unknown) => { st.eq.push([c, v]); return api; },
      in: (c: string, vs: unknown[]) => { st.ins.push([c, vs]); return api; },
      single: async () => {
        const r = await run();
        return { data: Array.isArray(r.data) ? (r.data as Row[])[0] ?? null : r.data, error: r.error };
      },
      maybeSingle: async () => {
        const r = await run();
        return { data: Array.isArray(r.data) ? (r.data as Row[])[0] ?? null : r.data, error: r.error };
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return api;
  },
}));

jest.mock('../../db/supabaseClient', () => ({ supabase: { rpc: async () => ({ data: null, error: null }) } }));
jest.mock('../../auth/metaAuthService', () => ({ getValidAccessToken: async () => 'test-token' }));
jest.mock('../../auth/credentialEncryption', () => ({ requireEncryptionKey: () => Buffer.from('11'.repeat(32), 'hex') }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: async () => undefined }));
jest.mock('../../services/whatsappTemplateService', () => ({ getActiveTemplate: async () => ({ name: 'tpl', language: 'en' }) }));
jest.mock('../../services/whatsappRateLimiter', () => ({
  checkAndConsume: async () => ({ allowed: true }),
  getBroadcastChunkStrategy: () => ({ chunkSize: 10, delayMs: 0 }),
}));

import { processBatch } from '../../services/whatsappBroadcastService';

const ORG = 'co-a';
const PHONE = '+15550100001';

/** The service's own format: ivHex:tagHex:cipherHex, AES-256-GCM. */
const encrypt = (e164: string): string => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = c.update(e164, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc}`;
};

const seed = (over: Row = {}) => {
  db.broadcasts.push({
    id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'running',
    template_name: 'tpl', language: 'en', body_params: [], ...over,
  });
  // The sender account belongs to the broadcast's company (processBatch re-checks it).
  db.accounts.push({ id: 'sa1', company_id: ORG, phone_number_id: 'pn1' });
  db.recipients.push({ id: 'r1', encrypted_phone: encrypt(PHONE), contact_name: 'A', status: 'pending', retry_count: 0 });
};

/**
 * The DATABASE instant the governance read returns with every row (A2: the
 * decision instant). The real select carries `read_at` (the transaction instant).
 */
const DB_NOW = '2026-11-11T10:00:00.000Z';

const restrict = (over: Row = {}) => {
  db.governance.push({
    id: 'g1', organization_id: ORG, person_id: null, target_normalized: PHONE,
    channel: 'whatsapp', governance_type: 'dnc_channel',
    effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, read_at: DB_NOW, ...over,
  });
};

const recipient = (): Row => db.recipients.find((r) => r.id === 'r1')!;

beforeEach(() => {
  db.broadcasts = []; db.accounts = []; db.recipients = []; db.governance = [];
  db.updates = []; db.failTable = null;
  fetchCalls.length = 0;
  (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
    fetchCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
  };
});

describe('W0-C — WhatsApp broadcast is governed before the external send', () => {
  it('1. a PERMITTED recipient still reaches the send path', async () => {
    seed();
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/pn1/messages');
    expect(recipient().status).toBe('sent');
  });

  it('2. a PROHIBITED recipient is blocked BEFORE Meta Graph is called', async () => {
    seed();
    restrict();
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    // error_code is an INTEGER column (baseline.sql); the cause is text and lives
    // in error_message. The former text write failed the update in Postgres.
    expect(recipient().error_code).toBeNull();
    expect(String(recipient().error_message)).toMatch(/^contact_governance: /);
    expect(String(recipient().error_message)).toContain('dnc_channel');
  });

  it('a `*`-channel restriction also blocks WhatsApp', async () => {
    seed();
    restrict({ channel: '*', governance_type: 'dnc_permanent' });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
  });

  it('3. an unreadable governance store FAILS CLOSED — nothing is sent', async () => {
    seed();
    db.failTable = 'contact_governance_records';
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('governance unreadable');
  });

  it('5. another tenant\'s restriction does not apply, and this tenant\'s is not escaped', async () => {
    seed();
    restrict({ id: 'g-other', organization_id: 'co-other' });
    await processBatch('b1', ['r1']);
    // A foreign-tenant record is dropped by the loader's tenant filter and by
    // the evaluator's defence in depth, so this send proceeds.
    expect(fetchCalls).toHaveLength(1);

    // ...and the same number restricted under THIS tenant does block.
    fetchCalls.length = 0;
    db.recipients = [{ id: 'r1', encrypted_phone: encrypt(PHONE), contact_name: 'A', status: 'pending', retry_count: 0 }];
    restrict();
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
  });

  it('a restriction on a DIFFERENT number does not block this recipient', async () => {
    seed();
    restrict({ target_normalized: '+15550109999' });
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
  });

  it('governance is evaluated once per batch and applied per recipient', async () => {
    seed();
    db.recipients.push({ id: 'r2', encrypted_phone: encrypt('+15550100002'), contact_name: 'B', status: 'pending', retry_count: 0 });
    restrict();   // blocks r1 only

    await processBatch('b1', ['r1', 'r2']);

    expect(fetchCalls).toHaveLength(1);                       // only r2 went out
    expect(recipient().status).toBe('blocked_governance');
    expect(db.recipients.find((r) => r.id === 'r2')!.status).toBe('sent');
  });
});

describe('WhatsApp send idempotency — a retry never messages a recipient twice', () => {
  it('a retried batch skips a recipient that was already sent', async () => {
    seed();
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);

    await processBatch('b1', ['r1']);              // BullMQ retry / duplicate batch
    expect(fetchCalls).toHaveLength(1);
    expect(recipient().status).toBe('sent');
  });

  it('two concurrent batches for the same recipient send exactly once', async () => {
    seed();
    await Promise.all([processBatch('b1', ['r1']), processBatch('b1', ['r1'])]);
    expect(fetchCalls).toHaveLength(1);
  });

  it('a thrown request is UNCERTAIN, not failed, and is never retried', async () => {
    seed();
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      fetchCalls.push(String(url));
      throw new Error('socket hang up');
    };
    await processBatch('b1', ['r1']);
    expect(recipient().status).toBe('send_uncertain');

    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
  });

  it('accepted without a message id is UNCERTAIN', async () => {
    seed();
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      fetchCalls.push(String(url));
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await processBatch('b1', ['r1']);
    expect(recipient().status).toBe('send_uncertain');
  });

  it('a definitive provider refusal is FAILED (retryable) with the numeric code', async () => {
    seed();
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      fetchCalls.push(String(url));
      return { ok: false, status: 400, json: async () => ({ error: { code: 131026, message: 'undeliverable' } }) };
    };
    await processBatch('b1', ['r1']);
    expect(recipient().status).toBe('failed');
    expect(recipient().error_code).toBe(131026);
  });
});

describe('A2 — the decision instant is the governance READ instant, never the host clock', () => {
  afterEach(() => jest.useRealTimers());

  it('NEGATIVE CONTROL: a host clock 2 h AHEAD does not unlock a restriction still in force at the database instant', async () => {
    seed();
    // In force at DB_NOW (ends 1 h later); "over" only by a host clock 2 h ahead.
    restrict({ effective_until: '2026-11-11T11:00:00.000Z' });
    jest.useFakeTimers({ now: new Date('2026-11-11T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('dnc_channel');
  });

  it('control: once the database instant is past effective_until, the restriction no longer applies', async () => {
    seed();
    restrict({ effective_until: '2026-11-11T09:00:00.000Z' }); // ended before DB_NOW
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
  });

  it('rows that arrive WITHOUT a database read instant are indeterminate: nothing is sent', async () => {
    seed();
    restrict({ read_at: undefined, target_normalized: '+15550109999' }); // not even this number
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('governance indeterminate');
  });
});

describe('A2b — governance is re-read within a batch (every 30 s or 50 recipients)', () => {
  const PHONE2 = '+15550100002';
  const PHONE3 = '+15550100003';
  const three = () => {
    seed();
    db.recipients.push(
      { id: 'r2', encrypted_phone: encrypt(PHONE2), contact_name: 'B', status: 'pending', retry_count: 0 },
      { id: 'r3', encrypted_phone: encrypt(PHONE3), contact_name: 'C', status: 'pending', retry_count: 0 },
    );
  };
  const status = (id: string) => db.recipients.find((r) => r.id === id)!.status;
  /** After the FIRST send: the recipients of r2 and r3 unsubscribe (committed mid-batch). */
  const unsubscribeAfterFirstSend = () => {
    const realFetch = (global as unknown as { fetch: (u: string) => Promise<unknown> }).fetch;
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const r = await realFetch(url);
      if (fetchCalls.length === 1) {
        restrict({ id: 'u2', target_normalized: PHONE2, governance_type: 'dnc_channel' });
        restrict({ id: 'u3', target_normalized: PHONE3, governance_type: 'dnc_channel' });
      }
      return r;
    };
  };
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
    jest.useRealTimers();
  });

  it('an unsubscribe committed mid-batch blocks the LATER recipients (re-read by count)', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = '1';
    three();
    unsubscribeAfterFirstSend();
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect(fetchCalls).toHaveLength(1);
    expect([status('r1'), status('r2'), status('r3')]).toEqual(['sent', 'blocked_governance', 'blocked_governance']);
  });

  it('an unsubscribe committed mid-batch blocks the later recipients (re-read by TIME: 30 s passed)', async () => {
    three();
    jest.useFakeTimers({ now: new Date('2026-11-11T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const realFetch = (global as unknown as { fetch: (u: string) => Promise<unknown> }).fetch;
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const r = await realFetch(url);
      if (fetchCalls.length === 1) {
        restrict({ id: 'u2', target_normalized: PHONE2 });
        jest.setSystemTime(new Date('2026-11-11T10:00:31.000Z')); // the first send took 31 s
      }
      return r;
    };
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect([status('r1'), status('r2'), status('r3')]).toEqual(['sent', 'blocked_governance', 'sent']);
  });

  it('NEGATIVE CONTROL: within the window (default 50 / 30 s) there is no re-read, so the mid-batch unsubscribe is not yet seen', async () => {
    three();
    unsubscribeAfterFirstSend();
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect(fetchCalls).toHaveLength(3);
    expect([status('r1'), status('r2'), status('r3')]).toEqual(['sent', 'sent', 'sent']);
  });

  it('a FAILED re-read stops the batch: nothing more is sent, the rest stay pending (retryable)', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = '1';
    three();
    const realFetch = (global as unknown as { fetch: (u: string) => Promise<unknown> }).fetch;
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const r = await realFetch(url);
      db.failTable = 'contact_governance_records'; // the store becomes unreadable after the first send
      return r;
    };
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect(fetchCalls).toHaveLength(1);
    expect([status('r1'), status('r2'), status('r3')]).toEqual(['sent', 'pending', 'pending']);
    // Liveness: the broadcast is marked paused (never left looking finished), logged at ERROR.
    expect(db.broadcasts[0].status).toBe('paused');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('broadcast paused'), expect.objectContaining({ broadcast_id: 'b1', remaining: 2 }));
    err.mockRestore();
  });

  it('NEGATIVE CONTROL: a batch whose re-reads all succeed leaves the broadcast status alone', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = '1';
    three();
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect(fetchCalls).toHaveLength(3);
    expect(db.broadcasts[0].status).toBe('running');
    expect(db.updates.some((u) => u.table === 'whatsapp_broadcasts')).toBe(false);
  });

  it('EVERY above the cap is clamped to 500 (warned by name): the 501st recipient is decided on a fresh read', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = '100000';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    seed();
    const LAST = '+15550209999';
    for (let k = 2; k <= 500; k += 1) {
      db.recipients.push({ id: `r${k}`, encrypted_phone: encrypt(`+1555020${String(k).padStart(4, '0')}`), contact_name: 'X', status: 'pending', retry_count: 0 });
    }
    db.recipients.push({ id: 'r501', encrypted_phone: encrypt(LAST), contact_name: 'Z', status: 'pending', retry_count: 0 });
    const realFetch = (global as unknown as { fetch: (u: string) => Promise<unknown> }).fetch;
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const r = await realFetch(url);
      if (fetchCalls.length === 1) restrict({ id: 'u501', target_normalized: LAST });
      return r;
    };
    await processBatch('b1', db.recipients.map((r) => String(r.id)));
    expect(fetchCalls).toHaveLength(500);
    expect(status('r501')).toBe('blocked_governance');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WHATSAPP_GOVERNANCE_REREAD_EVERY is above its cap'), expect.objectContaining({ cap: 500 }));
    warn.mockRestore();
  });

  it('MS above the cap is clamped to 300000 (warned by name): a 5-minute gap forces a re-read', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_MS = '3600000';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    three();
    jest.useFakeTimers({ now: new Date('2026-11-11T10:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const realFetch = (global as unknown as { fetch: (u: string) => Promise<unknown> }).fetch;
    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      const r = await realFetch(url);
      if (fetchCalls.length === 1) {
        restrict({ id: 'u2', target_normalized: PHONE2 });
        jest.setSystemTime(new Date('2026-11-11T10:05:00.000Z')); // exactly the 300 s cap
      }
      return r;
    };
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect([status('r1'), status('r2'), status('r3')]).toEqual(['sent', 'blocked_governance', 'sent']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WHATSAPP_GOVERNANCE_REREAD_MS is above its cap'), expect.objectContaining({ cap: 300000 }));
    warn.mockRestore();
  });

  it('NEGATIVE CONTROL: values AT the caps are used as-is, without a warning', async () => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = '500';
    process.env.WHATSAPP_GOVERNANCE_REREAD_MS = '300000';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    three();
    unsubscribeAfterFirstSend();
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect(fetchCalls).toHaveLength(3); // no re-read within 500 / 300 s
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([['0'], ['-1'], ['abc'], ['1.5']])('WHATSAPP_GOVERNANCE_REREAD_EVERY=%s falls back to the default (50): no early re-read', async (v) => {
    process.env.WHATSAPP_GOVERNANCE_REREAD_EVERY = v;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    three();
    unsubscribeAfterFirstSend();
    await processBatch('b1', ['r1', 'r2', 'r3']);
    expect(fetchCalls).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('WHATSAPP_GOVERNANCE_REREAD_EVERY'), expect.anything());
    warn.mockRestore();
  });
});

describe('processBatch is idempotent under re-entry: only PENDING recipients are sent', () => {
  const PHONE2 = '+15550100002';
  const status = (id: string) => db.recipients.find((r) => r.id === id)!.status;
  const two = () => {
    seed();
    db.recipients.push({ id: 'r2', encrypted_phone: encrypt(PHONE2), contact_name: 'B', status: 'pending', retry_count: 0 });
  };

  it('calling processBatch twice with the same ids sends each recipient exactly once', async () => {
    two();
    await processBatch('b1', ['r1', 'r2']);
    expect(fetchCalls).toHaveLength(2);
    await processBatch('b1', ['r1', 'r2']); // a job retry re-enters with the same recipient_ids
    expect(fetchCalls).toHaveLength(2);
    expect([status('r1'), status('r2')]).toEqual(['sent', 'sent']);
  });

  it('a half-sent batch re-entered sends only the recipient still pending', async () => {
    two();
    db.recipients.find((r) => r.id === 'r1')!.status = 'sent';
    await processBatch('b1', ['r1', 'r2']);
    expect(fetchCalls).toHaveLength(1);
    expect(status('r2')).toBe('sent');
  });

  it.each([['blocked_governance'], ['failed'], ['delivered'], ['read']])('a recipient already %s is not sent again', async (st) => {
    seed();
    db.recipients[0].status = st;
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(0);
    expect(status('r1')).toBe(st);
  });

  it('NEGATIVE CONTROL: a pending recipient in the same position IS sent', async () => {
    seed();
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
    expect(status('r1')).toBe('sent');
  });
});
