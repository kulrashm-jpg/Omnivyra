/**
 * authorize_extension_submit on real PostgreSQL (EXTENSION-1.5.0-CONTRACT.md §5.4).
 * R2 (Orchestration review): every refusal code has a row that fails ONLY that
 * check; a second call after authorization returns ALREADY_SUBMITTED. The approval
 * fixtures are the Prompt 3 ones (real passkey evidence, real claim RPC).
 */
import { createHash, randomUUID } from 'crypto';
import { Client } from 'pg';
import { db, inRollback, ORG_A, seedTenants } from './setup';
import { openTenant, openPolicy, approvedAction, browserClaimRpc, refusalsOf } from './helpers/c3ClaimFixtures';

const ME = 'urn:li:fsd_profile:ACoAAgateMember01';
const OTHER = 'urn:li:fsd_profile:ACoAAgateOther001';
const USER = '00000000-0000-4000-8000-0000000000e7';
const TEXT_SHA = createHash('sha256').update('Thanks for sharing', 'utf8').digest('hex');

async function fixture(o: { ingestedVia?: string; postAuthor?: string; ageMs?: number; bind?: boolean } = {}) {
  await openTenant(db, ORG_A);
  const target = `urn:li:comment:(activity:7${Date.now() % 1e9},${Math.floor(Math.random() * 1e9)})`;
  const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', targetId: target, ...(o.ageMs !== undefined ? { ageMs: o.ageMs } : {}) });
  const claimed = await browserClaimRpc(db, id, ORG_A, 'lease-1');
  if (claimed !== 1) {
    // Only for the expired-approval case: the claim refuses, so the lease is placed
    // directly to reach the gate's own approval re-check.
    await db.query(`SET LOCAL session_replication_role = replica`);
    await db.query(`UPDATE public.community_ai_actions SET dispatch_lease_id = 'lease-1', dispatch_lease_holder_id = 'holder-1',
                      dispatch_lease_expires_at = now() + interval '60 seconds' WHERE id = $1`, [id]);
    await db.query(`SET LOCAL session_replication_role = origin`);
  }
  if (o.bind !== false) {
    await db.query(`INSERT INTO public.extension_account_bindings (org_id, user_id, platform, acting_member_urn) VALUES ($1, $2, 'linkedin', $3)`,
      [ORG_A, USER, ME]);
  }
  const thread = randomUUID();
  await db.query(`INSERT INTO public.engagement_threads (id, organization_id, platform, platform_thread_id, raw_payload)
                  VALUES ($1, $2, 'linkedin', $3, $4::jsonb)`,
    [thread, ORG_A, `urn:li:activity:${thread}`, JSON.stringify({ ingested_via: o.ingestedVia ?? 'extension_v15', post_author_urn: o.postAuthor ?? ME })]);
  await db.query(`INSERT INTO public.engagement_messages (thread_id, organization_id, platform, platform_message_id, content)
                  VALUES ($1, $2, 'linkedin', $3, 'a comment')`, [thread, ORG_A, target]);
  return id;
}

const gate = async (id: string, o: { holder?: string; lease?: string; sha?: string; member?: string; user?: string } = {}) =>
  (await db.query(`SELECT public.authorize_extension_submit($1, $2, $3, $4, $5, $6, $7) AS code`,
    [id, ORG_A, o.lease ?? 'lease-1', o.holder ?? 'holder-1', o.user ?? USER, o.sha ?? TEXT_SHA, o.member ?? ME])).rows[0].code as string | null;
const row = async (id: string) =>
  (await db.query(`SELECT status, submit_attempted_at, acting_member_urn, dispatch_lease_id FROM public.community_ai_actions WHERE id = $1`, [id])).rows[0];

beforeAll(async () => { await seedTenants(); });

describe('authorize_extension_submit', () => {
  it('authorizes once: writes submit_attempted_at and the member, leaves status and lease; a second call is ALREADY_SUBMITTED', () => inRollback(async () => {
    const id = await fixture();
    expect(await gate(id)).toBeNull();
    const r = await row(id);
    expect(r.submit_attempted_at).not.toBeNull();
    expect(r.acting_member_urn).toBe(ME);
    expect(r.status).toBe('pending');
    expect(r.dispatch_lease_id).toBe('lease-1');
    expect(await gate(id)).toBe('ALREADY_SUBMITTED');
  }));

  it.each([
    ['ACTION_NOT_IN_FLIGHT (terminal row still holding its lease: B1)', async (id: string) => {
      await db.query(`SET LOCAL session_replication_role = replica`);
      await db.query(`UPDATE public.community_ai_actions SET status = 'failed' WHERE id = $1`, [id]);
      await db.query(`SET LOCAL session_replication_role = origin`);
    }, {}],
    ['LEASE_EXPIRED', async (id: string) => {
      await db.query(`SET LOCAL session_replication_role = replica`);
      await db.query(`UPDATE public.community_ai_actions SET dispatch_lease_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
      await db.query(`SET LOCAL session_replication_role = origin`);
    }, {}],
    ['LEASE_NOT_HELD', async () => undefined, { holder: 'holder-2' }],
    ['TEXT_MISMATCH', async () => undefined, { sha: '0'.repeat(64) }],
    ['BINDING_MISMATCH', async () => undefined, { member: OTHER }],
    ['BINDING_MISMATCH (another user of the same org)', async () => undefined, { user: '00000000-0000-4000-8000-0000000000e8' }],
  ])('%s', (code, mutate, args) => inRollback(async () => {
    const id = await fixture();
    await mutate(id);
    expect(await gate(id, args as never)).toBe(code.split(' ')[0]);
    expect((await row(id)).submit_attempted_at).toBeNull();
  }));

  it.each([
    ['a thread not collected by 1.5', { ingestedVia: 'extension_comments' }],
    ['a post authored by someone else', { postAuthor: OTHER }],
  ])('NOT_OWN_CONTENT for %s', (_n, o) => inRollback(async () => {
    const id = await fixture(o);
    expect(await gate(id)).toBe('NOT_OWN_CONTENT');
    expect((await row(id)).submit_attempted_at).toBeNull();
  }));

  it('the kill switch refuses, and the refusal is recorded (audit parity with the claim)', () => inRollback(async () => {
    const id = await fixture();
    await openPolicy(db, ORG_A, { execution: false });
    const code = await gate(id);
    expect(code).toMatch(/POLICY|DISABLED|KILL/);
    expect((await row(id)).submit_attempted_at).toBeNull();
    expect((await refusalsOf(db, id)).some((r) => r.claim_point === 'browser_submit' && r.code === code)).toBe(true);
  }));

  it('POLICY_AMBIGUOUS: a policy function returning two rows trips the multiplicity guard (seen, not reasoned)', () => inRollback(async () => {
    const id = await fixture();
    // Replaced inside this rolled-back transaction only: two ALLOW rows.
    await db.query(`CREATE OR REPLACE FUNCTION public.community_execution_policy_decision(p_org uuid, p_tenant uuid)
      RETURNS TABLE (allowed boolean, code text, auto_rules_enabled boolean, policy_version timestamptz)
      LANGUAGE sql AS $f$ SELECT true, NULL::text, false, now() UNION ALL SELECT true, NULL::text, false, now() $f$`);
    expect(await gate(id)).toBe('POLICY_AMBIGUOUS');
    expect((await row(id)).submit_attempted_at).toBeNull();
  }));

  it('an expired approval refuses through the evidence check, and is recorded', () => inRollback(async () => {
    const id = await fixture({ ageMs: 8 * 24 * 3600 * 1000 });
    expect(await gate(id)).toBe('APPROVAL_EXPIRED');
    expect((await refusalsOf(db, id)).some((r) => r.claim_point === 'browser_submit' && r.code === 'APPROVAL_EXPIRED')).toBe(true);
  }));

  it('concurrency: two sessions on the same action, exactly one is authorized', async () => {
    // Committed fixture (the race needs two connections), removed afterwards.
    await db.query('BEGIN');
    const id = await fixture();
    await db.query('COMMIT');
    const c2 = new Client({ connectionString: (db as unknown as { connectionParameters: { connectionString?: string } }).connectionParameters.connectionString ?? process.env.W6_DB_URL });
    await c2.connect();
    try {
      await db.query('BEGIN');
      await c2.query('BEGIN');
      const first = await db.query(`SELECT public.authorize_extension_submit($1,$2,'lease-1','holder-1',$3,$4,$5) AS code`, [id, ORG_A, USER, TEXT_SHA, ME]);
      // c2 blocks on the row lock until db commits.
      const secondP = c2.query(`SELECT public.authorize_extension_submit($1,$2,'lease-1','holder-1',$3,$4,$5) AS code`, [id, ORG_A, USER, TEXT_SHA, ME]);
      await new Promise((r) => setTimeout(r, 300));
      await db.query('COMMIT');
      const second = await secondP;
      await c2.query('COMMIT');
      expect([first.rows[0].code, second.rows[0].code]).toEqual([null, 'ALREADY_SUBMITTED']);
    } finally {
      await c2.end();
      await db.query(`SET session_replication_role = replica`);
      await db.query(`DELETE FROM public.engagement_messages WHERE organization_id = $1 AND platform_message_id IN (SELECT target_id FROM public.community_ai_actions WHERE id = $2)`, [ORG_A, id]);
      await db.query(`DELETE FROM public.community_ai_action_logs WHERE action_id = $1`, [id]);
      await db.query(`DELETE FROM public.community_ai_actions WHERE id = $1`, [id]);
      await db.query(`DELETE FROM public.extension_account_bindings WHERE user_id = $1`, [USER]);
      await db.query(`SET session_replication_role = origin`);
    }
  });
});
