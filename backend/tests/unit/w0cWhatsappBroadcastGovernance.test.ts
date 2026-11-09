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
 *
 * ─── P0: ONE READ PER RECIPIENT, AT THE DATABASE'S OWN INSTANT ────────────
 * Governance is read once per RECIPIENT immediately before that recipient's
 * send, and each read is judged at the `read_at` it came back with. A journey
 * recipient has two anchors — its person and its number — which are TWO
 * PostgREST requests, so two transactions and two instants.
 *
 * The double below models that honestly: every governance SELECT gets its OWN
 * instant, one second apart in request order (person first, then target), so a
 * test can place a restriction's `effective_from` BETWEEN them and prove that
 * each anchor was judged at its own timestamp rather than at one shared
 * substitute. `db.governanceReads` counts the requests.
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
  /** Governance SELECTs issued, in order. One per anchor, per recipient. */
  governanceReads: 0,
  /** Fail only the Nth governance read (1-based), to isolate a person-read failure. */
  failGovernanceRead: null as number | null,
  /** Make every recipient UPDATE fail, to prove a failed status write is detected. */
  failRecipientUpdate: false,
  /** Incremented by a getter on `broadcast.body`, which only `buildMessageBody` reads. */
  bodyReads: 0,
};

/**
 * The instant the Nth governance request came back at, as PostgreSQL renders a
 * `timestamptz`: `T`-separated, six fractional digits, an EXPLICIT `+00:00`
 * offset — never `Z`. One second apart so the person read and the target read
 * are visibly different transactions.
 */
const readInstant = (n: number): string => `2026-10-05T00:00:0${n}.000000+00:00`;
/** The person read is #1 and the target read is #2, so this lies strictly between them. */
const BETWEEN_PERSON_AND_TARGET = '2026-10-05T00:00:01.500000+00:00';

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
        if (table === 'whatsapp_broadcast_recipients' && db.failRecipientUpdate) {
          return { data: null, error: { code: '08006', message: 'connection reset' } };
        }
        db.updates.push({ table, patch: st.patch as Row });
        // Like PostgREST's `update().select()`: the rows the update matched, so a
        // compare-and-set claim can tell whether it won.
        const affected = rows().filter(match);
        affected.forEach((r) => Object.assign(r, st.patch));
        return { data: affected.map((r) => ({ id: r.id })), error: null };
      }
      if (table === 'contact_governance_records') {
        db.governanceReads += 1;
        if (db.failGovernanceRead === db.governanceReads) {
          return { data: null, error: { message: 'governance store unreadable' } };
        }
        // Served as a DEFAULT, so a row can override it, omit it, or conflict.
        const at = readInstant(db.governanceReads);
        return { data: rows().filter(match).map((r) => ({ read_at: at, ...r })), error: null };
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

const restrict = (over: Row = {}) => {
  db.governance.push({
    id: 'g1', organization_id: ORG, person_id: null, target_normalized: PHONE,
    channel: 'whatsapp', governance_type: 'dnc_channel',
    effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, ...over,
  });
};

const PERSON = 'person-aaaa-1111';

/** A journey recipient: Orchestration attached the canonical person (20270128000004). */
const seedPersonLinked = (over: Row = {}) => {
  seed();
  Object.assign(recipient(), { person_id: PERSON, ...over });
};

/** A restriction anchored to the PERSON only — no target, so only the person read returns it. */
const restrictPerson = (over: Row = {}) => restrict({
  id: 'g-person', person_id: PERSON, target_normalized: null,
  governance_type: 'dnc_permanent', ...over,
});

/**
 * The same broadcast with a getter on `body`. `buildMessageBody` is its only
 * reader, so a zero count proves the message was never constructed — stronger
 * than "no provider call", and what a governance refusal must guarantee.
 */
const seedWithBodyProbe = (over: Row = {}) => {
  const b: Row = {
    id: 'b1', company_id: ORG, social_account_id: 'sa1', status: 'running',
    message_type: 'text', language: 'en', body_params: [],
  };
  Object.defineProperty(b, 'body', {
    get: () => { db.bodyReads += 1; return 'hello'; }, enumerable: true,
  });
  db.broadcasts.push(b);
  db.accounts.push({ id: 'sa1', company_id: ORG, phone_number_id: 'pn1' });
  db.recipients.push({ id: 'r1', encrypted_phone: encrypt(PHONE), contact_name: 'A', status: 'pending', retry_count: 0, ...over });
};

const recipient = (): Row => db.recipients.find((r) => r.id === 'r1')!;

beforeEach(() => {
  db.broadcasts = []; db.accounts = []; db.recipients = []; db.governance = [];
  db.updates = []; db.failTable = null;
  db.governanceReads = 0; db.failGovernanceRead = null;
  db.failRecipientUpdate = false; db.bodyReads = 0;
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


// ════════════════════════════════════════════════════════════════════════════
// P0 — per-recipient, per-anchor governance at the database's own instants
// ════════════════════════════════════════════════════════════════════════════
describe('P0 — person and target anchors, each judged at its own database instant', () => {
  it('1. a PERSON-anchored restriction blocks, with no target-anchored restriction present', async () => {
    seedPersonLinked();
    restrictPerson();
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('dnc_permanent');
  });

  it('2. a TARGET-anchored restriction blocks, with no person restriction present', async () => {
    seedPersonLinked();
    restrict();                                   // target_normalized = PHONE
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('dnc_channel');
  });

  it('3. person ALLOW plus target RESTRICT blocks — the restrictive side wins', async () => {
    seedPersonLinked();
    restrict();                                   // the number is restricted
    // The person has a record that cannot apply: another channel entirely.
    restrict({ id: 'g-other-ch', person_id: PERSON, target_normalized: null, channel: 'email' });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
  });

  it('4. person RESTRICT plus target ALLOW blocks — the number being clear is not enough', async () => {
    seedPersonLinked();
    restrictPerson();
    // A target-anchored record for a DIFFERENT number: the target read is clear.
    restrict({ id: 'g-other-num', target_normalized: '+15550109999' });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('dnc_permanent');
  });

  it('5a. the TARGET read uses ITS OWN instant: a restriction starting between the two anchors blocks', async () => {
    // The person read is request #1 (00:00:01) and the target read is #2
    // (00:00:02). This record starts at 00:00:01.5 — after the person read's
    // instant and before the target read's. Anchored to the TARGET, so only the
    // target read returns it, and it IS in force at that read's instant.
    seedPersonLinked();
    restrict({ effective_from: BETWEEN_PERSON_AND_TARGET });
    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(2);           // two anchors, two requests
    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
  });

  it('5b. the PERSON read uses ITS OWN instant: the same window is NOT yet in force there', async () => {
    // The decisive control. Identical record, anchored to the PERSON instead, so
    // only the person read returns it — and at that read's instant (00:00:01) it
    // has not started. One shared timestamp for both anchors would make 5a and 5b
    // agree; they must not.
    seedPersonLinked();
    restrictPerson({ effective_from: BETWEEN_PERSON_AND_TARGET });
    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(2);
    expect(fetchCalls).toHaveLength(1);
    expect(recipient().status).toBe('sent');
  });

  it('5c. BOTH reads carrying rows are judged separately — merging them under one instant would permit', async () => {
    // THE DISCRIMINATING CASE, and the one 5a/5b could not make. In those only
    // ONE read returned rows, so the "first available instant" happened to be
    // that read's own and a merge was invisible. Here BOTH anchors return a
    // record, each starting at 00:00:01.5:
    //
    //   person read #1 @00:00:01 -> its record has NOT started  -> allowed
    //   target read #2 @00:00:02 -> its record HAS started      -> blocked
    //
    // Combined restrictively that is BLOCKED. Merge the two record sets under
    // one timestamp — the earlier instant — and neither has started, so the
    // recipient would be SENT. A mutation that merges them is caught here and
    // nowhere else.
    seedPersonLinked();
    restrictPerson({ effective_from: BETWEEN_PERSON_AND_TARGET });
    restrict({ effective_from: BETWEEN_PERSON_AND_TARGET });

    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(2);
    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('dnc_channel');   // the TARGET record decided
  });

  it('6. a FAILED person read prevents permission, although the target read succeeds', async () => {
    seedPersonLinked();
    db.failGovernanceRead = 1;                    // the person anchor only
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('governance unreadable');
  });

  it('7. an INVALID person identity is refused, never silently downgraded to target-only', async () => {
    // A person column holding something that is not a usable id. Coercing it to
    // null would skip the person's restrictions and send on the number alone,
    // which is the owner invariant this guards.
    for (const bad of ['', '   ', 42, {}, true]) {
      db.broadcasts = []; db.accounts = []; db.recipients = []; db.governance = [];
      db.governanceReads = 0; fetchCalls.length = 0;
      seedPersonLinked({ person_id: bad });

      await processBatch('b1', ['r1']);

      expect(fetchCalls).toHaveLength(0);
      expect(recipient().status).toBe('blocked_governance');
      expect(String(recipient().error_message)).toContain('invalid person identity');
      expect(db.governanceReads).toBe(0);         // refused before any query
    }
  });

  it('8. a DELIBERATELY person-free recipient is judged on the number alone, with one read', async () => {
    // `expandRecipients` omits the column for manual broadcasts, so null is the
    // normal state and target-only evaluation is complete — not a downgrade.
    seed();                                        // no person_id at all
    expect(recipient().person_id).toBeUndefined();
    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(1);           // one anchor, one request
    expect(fetchCalls).toHaveLength(1);
    expect(recipient().status).toBe('sent');
  });

  it('9. a person-free recipient is still blocked by a restriction on its number', async () => {
    // The person-free path is not a way out: the number is still governed.
    seed();
    restrict();
    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(1);
    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
  });
});

describe('P0 — per-recipient freshness and fail-closed reads', () => {
  it('10. a restriction recorded BY recipient one\u2019s send blocks recipient two', async () => {
    // THE DECISIVE CASE for the per-recipient read. Under a batch-wide snapshot
    // this restriction is recorded after the snapshot was taken, so r2 was judged
    // against a reading that predated it and the message went out.
    const PHONE_2 = '+15550100002';
    seed();
    db.recipients.push({ id: 'r2', encrypted_phone: encrypt(PHONE_2), contact_name: 'B', status: 'pending', retry_count: 0 });

    (global as unknown as { fetch: unknown }).fetch = async (url: string) => {
      fetchCalls.push(String(url));
      restrict({ id: 'g-midbatch', target_normalized: PHONE_2 });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
    };

    await processBatch('b1', ['r1', 'r2']);

    expect(fetchCalls).toHaveLength(1);                     // ONLY r1 went out
    expect(recipient().status).toBe('sent');
    expect(db.recipients.find((r) => r.id === 'r2')!.status).toBe('blocked_governance');
  });

  it('11. a fresh processing attempt re-reads governance rather than reusing a result', async () => {
    seed();
    await processBatch('b1', ['r1']);
    expect(fetchCalls).toHaveLength(1);
    expect(db.governanceReads).toBe(1);

    // A restriction recorded between the attempts, as a retry would meet. The
    // send-once claim means the row is no longer `pending`, so assert the READ
    // happened again and that nothing was sent a second time.
    restrict();
    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(2);
    expect(fetchCalls).toHaveLength(1);                     // never sent twice
  });

  it('12. a MISSING database instant blocks — indeterminate is not permissive', async () => {
    seed();
    restrict({ read_at: undefined });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('governance indeterminate');
  });

  it('12b. a MALFORMED database instant blocks', async () => {
    seed();
    restrict({ read_at: 'not-a-timestamp' });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('blocked_governance');
  });

  it('13. DISAGREEING instants within one read block — a response cannot have two transaction times', async () => {
    seed();
    restrict({ id: 'g-a', read_at: '2026-10-05T00:00:01.000000+00:00' });
    restrict({ id: 'g-b', read_at: '2026-10-05T00:00:09.000000+00:00' });
    await processBatch('b1', ['r1']);

    expect(fetchCalls).toHaveLength(0);
    expect(String(recipient().error_message)).toContain('governance indeterminate');
  });

  it('15. an UNANCHORABLE phone blocks with no governance query and no provider call', async () => {
    seed();
    db.recipients = [{ id: 'r1', encrypted_phone: encrypt('n/a'), contact_name: 'A', status: 'pending', retry_count: 0 }];
    await processBatch('b1', ['r1']);

    expect(recipient().status).toBe('blocked_governance');
    expect(String(recipient().error_message)).toContain('unanchorable recipient');
    expect(fetchCalls).toHaveLength(0);
    expect(db.governanceReads).toBe(0);
  });

  it('15b. a PERSON-LINKED recipient whose number will not normalise is still judged, not called unanchorable', async () => {
    // The person anchor can still answer, so this is not an absence of question.
    seedPersonLinked();
    Object.assign(recipient(), { encrypted_phone: encrypt('n/a') });
    restrictPerson();
    await processBatch('b1', ['r1']);

    expect(db.governanceReads).toBe(1);                     // person anchor only
    expect(fetchCalls).toHaveLength(0);
    expect(String(recipient().error_message)).toContain('dnc_permanent');
  });

  it('16. a blocked recipient reaches neither buildMessageBody nor Meta Graph', async () => {
    seedWithBodyProbe();
    restrict();
    await processBatch('b1', ['r1']);

    expect(db.bodyReads).toBe(0);
    expect(fetchCalls).toHaveLength(0);
    expect(recipient().wa_message_id).toBeUndefined();
  });

  it('16b. a permitted recipient DOES build and send — the probe is not inert', async () => {
    seedWithBodyProbe();
    await processBatch('b1', ['r1']);

    expect(db.bodyReads).toBeGreaterThan(0);
    expect(fetchCalls).toHaveLength(1);
  });
});

describe('P0 — blocked-recipient persistence against the real column types', () => {
  it('17/18. a governance block writes a NULL integer error_code and moves the row off pending', async () => {
    // The double rejects a non-integer `error_code` exactly as Postgres does
    // (22P02), so a text code would fail the statement and leave the row
    // `pending`. Asserting the status CHANGED proves the write succeeded.
    seed();
    expect(recipient().status).toBe('pending');
    restrict();
    await processBatch('b1', ['r1']);

    expect(recipient().status).toBe('blocked_governance');
    expect(recipient().error_code).toBeNull();
    expect(String(recipient().error_message)).toMatch(/^contact_governance: /);
    const patch = db.updates.find((u) => (u.patch as Row).status === 'blocked_governance');
    expect(patch).toBeDefined();
    expect((patch!.patch as Row).error_code).toBeNull();
  });

  it('17b. the unanchorable refusal writes through the same correct shape', async () => {
    seed();
    db.recipients = [{ id: 'r1', encrypted_phone: encrypt('n/a'), contact_name: 'A', status: 'pending', retry_count: 0 }];
    await processBatch('b1', ['r1']);

    expect(recipient().status).toBe('blocked_governance');
    expect(recipient().error_code).toBeNull();
  });

  it('19. a FAILED status write is detected, not silently ignored', async () => {
    seed();
    restrict();
    db.failRecipientUpdate = true;

    await expect(processBatch('b1', ['r1'])).rejects.toThrow(/governance block could not be recorded/);
    // Nothing was sent, and the row is untouched for the retry to find.
    expect(fetchCalls).toHaveLength(0);
    expect(recipient().status).toBe('pending');
  });
});

describe('P0 — decryption failure is terminal, visible and isolated (P1-B)', () => {
  it('24. an undecryptable recipient becomes terminally failed, with no provider call', async () => {
    seed();
    db.recipients = [{ id: 'r1', encrypted_phone: 'not:valid:ciphertext', contact_name: 'A', status: 'pending', retry_count: 0 }];

    await processBatch('b1', ['r1']);

    expect(recipient().status).toBe('failed');              // terminal, not pending
    expect(String(recipient().error_message)).toContain('recipient_undecryptable');
    expect(recipient().error_code).toBeNull();
    expect(fetchCalls).toHaveLength(0);
    expect(db.governanceReads).toBe(0);
  });

  it('25. the rest of the batch continues after a decryption failure', async () => {
    // Before this, the decrypt sat outside the try: one unreadable row threw out
    // of the loop and denied every later recipient its send.
    seed();
    db.recipients = [
      { id: 'r1', encrypted_phone: 'not:valid:ciphertext', contact_name: 'A', status: 'pending', retry_count: 0 },
      { id: 'r2', encrypted_phone: encrypt('+15550100002'), contact_name: 'B', status: 'pending', retry_count: 0 },
    ];

    await expect(processBatch('b1', ['r1', 'r2'])).resolves.toBeUndefined();

    expect(recipient().status).toBe('failed');
    expect(db.recipients.find((r) => r.id === 'r2')!.status).toBe('sent');
    expect(fetchCalls).toHaveLength(1);
  });

  it('the governance evaluator is reached only through the database-instant seam', async () => {
    // Deliberately NOT a blanket `new Date()` ban: this file has many legitimate
    // row and delivery timestamp uses. What must be absent is a direct call to
    // the authority, which would need an instant this module cannot honestly
    // supply.
    const raw = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/whatsappBroadcastService.ts'),
      'utf8',
    ) as string;
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('evaluateGovernanceReads');
    expect(code).toContain('loadGovernanceRecords');
    expect(code).not.toContain('mayContact(');
    expect(code).not.toContain('governanceNow');
    expect(code).toContain('sent_at: new Date().toISOString()');   // the clock survives where it belongs
  });
});
