/**
 * Extension 1.5 write commands (EXTENSION-1.5.0-CONTRACT.md §4, §5.4): own content is
 * checked BEFORE the unchanged claim RPC; the envelope carries the approved text and its
 * hash; authorize-submit maps the SQL gate's answer (NULL = authorized) and fails closed.
 */
import { createHash } from 'crypto';
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const rpcCalls: Array<{ fn: string; args: any }> = [];
let rpcImpl: (fn: string, args: any) => { data: any; error: any } = () => ({ data: null, error: null });

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let lim = Infinity;
  const q: any = {};
  const run = () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, lim), error: null });
  q.select = () => q;
  q.eq = (k: string, v: any) => { filters.push((r) => r[k] === v); return q; };
  q.is = (k: string, v: any) => { filters.push((r) => (r[k] ?? null) === v); return q; };
  q.in = (k: string, vs: any[]) => { filters.push((r) => vs.includes(r[k])); return q; };
  q.order = () => q;
  q.limit = (n: number) => { lim = n; return q; };
  q.maybeSingle = async () => ({ data: run().data[0] ?? null, error: null });
  q.then = (res: any, rej: any) => Promise.resolve(run()).then(res, rej);
  return q;
}
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => query(t),
  ownedDbRpc: async (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcImpl(fn, args); },
}));
jest.mock('../../services/extensionSessionService', () => ({ deriveExtensionHmacSecret: () => 'test-session-secret' }));

import { offerWriteCommands, authorizeSubmit, deriveLeaseHolderId } from '../../services/extension15/writeCommands';
import { verifyEnvelopeSignature } from '../../../lib/extension/envelope';

const ORG = 'org-1';
const S = { userId: 'user-1', orgId: ORG, expiresAt: Date.now() + 3_600_000, hmacNonce: 'nonce-1' };
const ME = 'urn:li:fsd_profile:ACoAAme0001';
const OTHER = 'urn:li:fsd_profile:ACoAAother1';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function seed(o: { author?: string; via?: string; actionType?: string; text?: string | null } = {}) {
  tables.community_ai_actions = [{
    id: 'act-1', organization_id: ORG, platform: 'linkedin', execution_mode: 'browser', status: 'pending',
    action_type: o.actionType ?? 'reply', target_id: 'urn:li:comment:(activity:1,2)', dispatch_lease_id: null,
    suggested_text: o.text === undefined ? 'Thanks for sharing' : o.text, execution_correlation_id: 'corr-1', created_at: '2026-11-10',
  }];
  tables.engagement_messages = [{ organization_id: ORG, platform: 'linkedin', platform_message_id: 'urn:li:comment:(activity:1,2)', thread_id: 'th-1' }];
  tables.engagement_threads = [{ id: 'th-1', organization_id: ORG, platform: 'linkedin', platform_thread_id: 'urn:li:activity:1',
    raw_payload: { ingested_via: o.via ?? 'extension_v15', post_author_urn: o.author ?? ME } }];
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  rpcCalls.length = 0;
  rpcImpl = (fn, args) => (fn === 'claim_community_ai_browser_command'
    ? { data: [{ id: args.p_action_id, dispatch_lease_expires_at: new Date(Date.now() + 90_000).toISOString() }], error: null }
    : { data: null, error: null });
});

describe('offerWriteCommands', () => {
  it('claims an approved reply on own content and signs an envelope with the text, its hash and the target', async () => {
    seed();
    const out = await offerWriteCommands(S, ME);
    expect(out).toHaveLength(1);
    const { envelope, envelope_signature } = out[0];
    expect(envelope).toMatchObject({
      command_id: 'act-1', action: 'li.comment.reply', acting_member_urn: ME, approval_id: 'act-1',
      text_sha256: sha('Thanks for sharing'),
      target: { post_urn: 'urn:li:activity:1', parent_comment_urn: 'urn:li:comment:(activity:1,2)' },
    });
    expect(envelope.params).toMatchObject({ text: 'Thanks for sharing', correlation_id: 'corr-1' });
    expect(verifyEnvelopeSignature(envelope, envelope_signature, 'test-session-secret')).toBe(true);
    expect(rpcCalls).toEqual([{ fn: 'claim_community_ai_browser_command', args: expect.objectContaining({
      p_action_id: 'act-1', p_organization_id: ORG, p_holder_id: deriveLeaseHolderId(S), p_lease_ttl_seconds: 90,
      p_lease_id: envelope.params.lease_id }) }]);
  });
  it('a like carries no text and targets the comment', async () => {
    seed({ actionType: 'like', text: null });
    const [c] = await offerWriteCommands(S, ME);
    expect(c.envelope).toMatchObject({ action: 'li.reaction.like', target: { comment_urn: 'urn:li:comment:(activity:1,2)' } });
    expect(c.envelope.text_sha256).toBeUndefined();
    expect(c.envelope.params.text).toBeUndefined();
  });
  it.each([
    ['another member post', { author: OTHER }],
    ['a thread not collected by 1.5', { via: 'extension_comments' }],
    ['a reply with blank text', { text: '  ' }],
  ])('%s is never claimed', async (_n, o) => {
    seed(o);
    expect(await offerWriteCommands(S, ME)).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });
  it('a refused or failed claim offers nothing (fails closed)', async () => {
    seed();
    rpcImpl = () => ({ data: [], error: null });
    expect(await offerWriteCommands(S, ME)).toEqual([]);
    rpcImpl = () => ({ data: null, error: { message: 'boom' } });
    expect(await offerWriteCommands(S, ME)).toEqual([]);
  });
});

describe('authorizeSubmit', () => {
  const body = { command_id: 'act-1', lease_id: 'v15-act-1-1', text_sha256: 'ab'.repeat(32) };
  it('NULL from the SQL gate authorizes; the server supplies holder, user and member (never the client)', async () => {
    rpcImpl = () => ({ data: null, error: null });
    expect(await authorizeSubmit(S, ME, { ...body, acting_member_urn: OTHER, user_id: 'evil' })).toEqual({ ok: true });
    expect(rpcCalls[0]).toEqual({ fn: 'authorize_extension_submit', args: {
      p_action_id: 'act-1', p_organization_id: ORG, p_lease_id: 'v15-act-1-1', p_holder_id: deriveLeaseHolderId(S),
      p_user_id: 'user-1', p_text_sha256: body.text_sha256, p_acting_member_urn: ME } });
  });
  it('a code refuses with 409; an RPC error is 503, never authorized', async () => {
    rpcImpl = () => ({ data: 'NOT_OWN_CONTENT', error: null });
    expect(await authorizeSubmit(S, ME, body)).toEqual({ ok: false, status: 409, code: 'NOT_OWN_CONTENT' });
    rpcImpl = () => ({ data: null, error: { message: 'timeout' } });
    expect(await authorizeSubmit(S, ME, body)).toEqual({ ok: false, status: 503, code: 'AUTHORIZE_UNAVAILABLE' });
  });
  it('requires command and lease', async () => {
    expect(await authorizeSubmit(S, ME, { command_id: 'act-1' })).toMatchObject({ status: 400 });
    expect(rpcCalls).toEqual([]);
  });
});
