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
        db.updates.push({ table, patch: st.patch as Row });
        rows().filter(match).forEach((r) => Object.assign(r, st.patch));
        return { data: null, error: null };
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
  db.accounts.push({ id: 'sa1', phone_number_id: 'pn1' });
  db.recipients.push({ id: 'r1', encrypted_phone: encrypt(PHONE), contact_name: 'A', status: 'pending', retry_count: 0 });
};

const restrict = (over: Row = {}) => {
  db.governance.push({
    id: 'g1', organization_id: ORG, person_id: null, target_normalized: PHONE,
    channel: 'whatsapp', governance_type: 'dnc_channel',
    effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, ...over,
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
    expect(String(recipient().error_code)).toBe('contact_governance');
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
