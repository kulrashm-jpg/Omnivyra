/**
 * Extension 1.5.0 service (EXTENSION-1.5.0-CONTRACT.md §3, §4, §5): binding,
 * issuance gates, the signed offer, acknowledgment and result verification.
 * The owned table seam is replaced by a small in-memory fake that evaluates the
 * filters, so compare-and-set and scoping are exercised, not assumed.
 */
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let failNext: { table: string; op: string } | null = null;

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let patch: Row = {};
  let ins: Row | null = null;
  let lim = Infinity;
  const q: any = {};
  const rows = () => (tables[table] ??= []);
  const run = () => {
    if (failNext && failNext.table === table && failNext.op === op) { failNext = null; return { data: null, error: { message: 'injected' } }; }
    if (op === 'insert') {
      const r: Row = { id: `id-${rows().length + 1}`, created_at: new Date().toISOString(), ...ins };
      if (table === 'extension_account_bindings' && rows().some((x) => !x.revoked_at && x.org_id === r.org_id && x.user_id === r.user_id && x.platform === r.platform)) {
        return { data: null, error: { code: '23505', message: 'unique' } };
      }
      rows().push(r);
      return { data: [r], error: null };
    }
    const hit = rows().filter((r) => filters.every((f) => f(r)));
    if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    return { data: hit.slice(0, lim), error: null };
  };
  q.select = () => q;
  q.insert = (r: Row) => { op = 'insert'; ins = r; return q; };
  q.update = (p: Row) => { op = 'update'; patch = p; return q; };
  q.eq = (k: string, v: any) => { filters.push((r) => r[k] === v); return q; };
  q.is = (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return q; };
  q.gt = (k: string, v: any) => { filters.push((r) => r[k] > v); return q; };
  q.order = () => q;
  q.limit = (n: number) => { lim = n; return q; };
  q.maybeSingle = async () => { const r = run(); return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }; };
  q.single = async () => { const r = run(); return r.error ? r : { data: (r.data as Row[])[0], error: null }; };
  q.then = (res: any, rej: any) => Promise.resolve(run()).then(res, rej);
  return q;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => query(t) }));
jest.mock('../../services/extensionSessionService', () => ({ deriveExtensionHmacSecret: () => 'test-session-secret' }));
// Write offers have their own suite (extension15WriteCommands); here the read path only.
jest.mock('../../services/extension15/writeCommands', () => ({ offerWriteCommands: async () => [] }));
const gate = { on: true };
jest.mock('../../services/extensionIngestionSuspension', () => ({
  get EXTENSION_V15_COMMAND_INGESTION_ENABLED() { return gate.on; },
}));

import {
  bindAccount, issueReadCommand, offerCommands, acknowledgeCommand, verifyResultCommand, finishCommand,
  DM_COLLECTION_ISSUABLE, SALESNAV_CAPTURE_ISSUABLE,
} from '../../services/extension15';
import { verifyEnvelopeSignature } from '../../../lib/extension/envelope';

const ORG = 'org-1';
const USER = 'user-1';
const S = { userId: USER, orgId: ORG, expiresAt: Date.now() + 3_600_000, hmacNonce: 'n' };
const ME = 'urn:li:fsd_profile:ACoAAme0001';
const OTHER = 'urn:li:fsd_profile:ACoAAother1';

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; failNext = null; });

describe('account binding (§3)', () => {
  it('binds once; the same member again is idempotent; a different member is a conflict', async () => {
    expect(await bindAccount(S, ME)).toEqual({ ok: true, created: true });
    expect(await bindAccount(S, ME)).toEqual({ ok: true, created: false });
    expect(await bindAccount(S, OTHER)).toEqual({ ok: false, status: 409, code: 'ACCOUNT_BINDING_CONFLICT' });
    expect(tables.extension_account_bindings).toHaveLength(1);
  });
  it.each(['', 'urn:li:member:123', 'javascript:x', 42, null])('refuses a malformed member urn %p', async (u) => {
    expect(await bindAccount(S, u)).toMatchObject({ ok: false, code: 'INVALID_MEMBER_URN' });
  });
  it('a THROWING binding read is also unreadable (503), never an exception to the caller', async () => {
    failNext = null;
    const spy = jest.spyOn(require('../../db/writeOwner'), 'ownedDbTable').mockImplementationOnce(() => { throw new Error('boom'); });
    const { getActiveBinding } = require('../../services/extension15');
    await expect(getActiveBinding(ORG, USER)).resolves.toMatchObject({ ok: false, status: 503, code: 'BINDING_UNREADABLE' });
    spy.mockRestore();
  });
  it('an unreadable binding read refuses (503), never treats it as unbound', async () => {
    failNext = { table: 'extension_account_bindings', op: 'select' };
    expect(await bindAccount(S, ME)).toMatchObject({ ok: false, status: 503, code: 'BINDING_UNREADABLE' });
  });
});

describe('issuance gates (§4)', () => {
  beforeEach(async () => { await bindAccount(S, ME); });
  it('while R-3 is not lifted for 1.5, no collection command is issued at all', async () => {
    gate.on = false;
    try {
      expect(await issueReadCommand({ orgId: ORG, userId: USER, action: 'li.collect.own_post_comments' })).toMatchObject({ status: 403, code: 'BROWSER_SYNC_SUSPENDED' });
      expect(tables.extension_commands ?? []).toHaveLength(0);
    } finally { gate.on = true; }
  });
  it('the inbox command is never issued before B-7, and Sales Navigator capture stays dark', async () => {
    expect(DM_COLLECTION_ISSUABLE).toBe(false);
    expect(SALESNAV_CAPTURE_ISSUABLE).toBe(false);
    expect(await issueReadCommand({ orgId: ORG, userId: USER, action: 'li.collect.own_inbox' })).toMatchObject({ status: 403, code: 'DM_STORAGE_DISABLED' });
    expect(await issueReadCommand({ orgId: ORG, userId: USER, action: 'li.salesnav.capture_saved_leads' })).toMatchObject({ status: 403, code: 'SALESNAV_CAPTURE_DISABLED' });
    expect(tables.extension_commands ?? []).toHaveLength(0);
  });
  it.each([
    ['unknown action', { action: 'li.comment.reply' }, 'UNKNOWN_ACTION'],
    ['unknown param', { action: 'li.collect.own_post_comments', params: { url: 'x' } }, 'UNKNOWN_PARAM'],
    ['too many items', { action: 'li.collect.own_post_comments', params: { max_items: 201 } }, 'INVALID_PARAM'],
    ['bad post urn', { action: 'li.collect.own_post_comments', params: { post_urns: ['https://linkedin.com/x'] } }, 'INVALID_PARAM'],
  ])('refuses %s', async (_n, extra, code) => {
    expect(await issueReadCommand({ orgId: ORG, userId: USER, ...extra } as never)).toMatchObject({ ok: false, code });
  });
  it('refuses without an active binding', async () => {
    expect(await issueReadCommand({ orgId: ORG, userId: 'user-2', action: 'li.collect.own_post_comments' })).toMatchObject({ status: 409, code: 'NO_ACCOUNT_BINDING' });
  });
});

describe('offer, acknowledgment and result verification (§4, §5)', () => {
  let id: string;
  beforeEach(async () => {
    await bindAccount(S, ME);
    const r = await issueReadCommand({ orgId: ORG, userId: USER, action: 'li.collect.own_post_comments', params: { max_items: 50 } });
    if (r.ok !== true) throw new Error('issue failed');
    id = r.commandId;
  });

  it('offers the command with a valid signed envelope bound to the member', async () => {
    const r = await offerCommands(S);
    if (r.ok !== true) throw new Error('offer failed');
    expect(r.commands).toHaveLength(1);
    const { envelope, envelope_signature } = r.commands[0];
    expect(envelope).toMatchObject({ command_id: id, acting_member_urn: ME, action: 'li.collect.own_post_comments', params: { max_items: 50 }, schema_version: '2026-11-10.1' });
    expect(verifyEnvelopeSignature(envelope, envelope_signature, 'test-session-secret')).toBe(true);
  });
  it('another user in the org, or a re-bound account, is offered nothing', async () => {
    const other = await offerCommands({ ...S, userId: 'user-2' });
    expect(other).toEqual({ ok: true, commands: [] });
    tables.extension_account_bindings[0].revoked_at = new Date().toISOString();
    await bindAccount(S, OTHER);
    expect(await offerCommands(S)).toEqual({ ok: true, commands: [] });
  });
  it('an expired command is not offered and cannot be acknowledged', async () => {
    const later = Date.now() + 11 * 60_000;
    expect(await offerCommands(S, later)).toEqual({ ok: true, commands: [] });
    expect(await acknowledgeCommand(S, id, later)).toMatchObject({ code: 'COMMAND_EXPIRED' });
  });
  it('acknowledges once; a result needs a dispatched command of the expected action; finishing is once', async () => {
    expect(await verifyResultCommand(S, id, 'li.collect.own_post_comments')).toMatchObject({ code: 'COMMAND_NOT_DISPATCHED' });
    expect(await acknowledgeCommand(S, id)).toEqual({ ok: true });
    expect(await acknowledgeCommand(S, id)).toMatchObject({ code: 'COMMAND_NOT_PENDING' });
    expect(await verifyResultCommand(S, id, 'li.salesnav.capture_saved_leads')).toMatchObject({ code: 'COMMAND_ACTION_MISMATCH' });
    expect(await verifyResultCommand({ ...S, userId: 'user-2' }, id, 'li.collect.own_post_comments')).toMatchObject({ code: 'COMMAND_NOT_FOUND' });
    expect(await verifyResultCommand(S, id, 'li.collect.own_post_comments')).toMatchObject({ ok: true, actingMemberUrn: ME });
    expect(await finishCommand(S, id, 'completed', { accepted: 3 })).toEqual({ ok: true });
    expect(await finishCommand(S, id, 'completed', { accepted: 3 })).toMatchObject({ code: 'COMMAND_NOT_DISPATCHED' });
  });
  it('a re-bound account invalidates the command at result time', async () => {
    await acknowledgeCommand(S, id);
    tables.extension_account_bindings[0].revoked_at = new Date().toISOString();
    await bindAccount(S, OTHER);
    expect(await verifyResultCommand(S, id, 'li.collect.own_post_comments')).toMatchObject({ code: 'BINDING_MISMATCH' });
  });
});
