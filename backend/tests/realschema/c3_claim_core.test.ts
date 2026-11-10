/**
 * C3: the single authoritative community claim, on REAL PostgreSQL.
 *
 * Migrations under test (template w3_c3):
 *   20270126000000 tenant execution policy, 20270126000001 approval evidence +
 *   claim + backstop, 20270126000002 refusal governance, 20270126000003 OD-2.
 *
 * Covers Prompt 3 §6 (concurrency, committed fixtures on separate sessions),
 * §7 (policy), §8 (expiry at the three claim points: the action claim, the
 * browser claim and the backstop trigger) and §13 (refusal records), plus the
 * server stamp, the content lock, OD-2 and grants.
 */
import { Client } from 'pg';
import { db, inRollback, effect, ORG_A, ORG_B } from './setup';
import {
  C3_APPROVER, C3_REQUESTER, C3_CONFIRMER, C3_HASH, ensureUser, openPolicy, openTenant, approvedAction,
  claimRpc, browserClaimRpc, refusalsOf, logTypesOf, statusOf,
} from './helpers/c3ClaimFixtures';

const DAY = 24 * 3600 * 1000;
const url = process.env.W6_DB_URL as string;
const ORG_C = '00000000-0000-4000-8000-0000000c3c3c'; // committed fixtures only

async function decision(org: string | null, tenant: string | null = org) {
  const { rows } = await db.query(`SELECT * FROM public.community_execution_policy_decision($1, $2)`, [org, tenant]);
  return rows[0];
}

// ── §7 policy ───────────────────────────────────────────────────────────────

describe('§7 tenant execution policy decision', () => {
  it('enabled: platform + tenant rows open -> allowed, auto rules reported, a version', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A, { auto: false });
      const d = await decision(ORG_A);
      expect(d).toMatchObject({ allowed: true, code: null, auto_rules_enabled: false });
      expect(d.policy_version).not.toBeNull();
      await openPolicy(db, ORG_A, { auto: true });
      expect(await decision(ORG_A)).toMatchObject({ allowed: true, auto_rules_enabled: true });
    });
  });

  it('disabled tenant row -> POLICY_EXECUTION_DISABLED', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_A]);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_EXECUTION_DISABLED' });
    });
  });

  it('missing tenant row / missing platform row -> POLICY_MISSING (closed, nothing auto-created)', async () => {
    await inRollback(async () => {
      await openPolicy(db, null);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_MISSING' });
      await db.query(`DELETE FROM public.community_ai_platform_policy`);
      await openPolicy(db, ORG_A);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_MISSING' });
      expect((await db.query(`SELECT count(*)::int AS n FROM public.community_ai_platform_policy`)).rows[0].n).toBe(1);
    });
  });

  it("another tenant's row never applies: only ORG_B open -> ORG_A POLICY_MISSING", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_B);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_MISSING' });
      expect(await decision(ORG_B)).toMatchObject({ allowed: true });
    });
  });

  it('tenant mismatch: org row asked for with another tenant id -> POLICY_TENANT_MISMATCH', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      expect(await decision(ORG_A, ORG_B)).toMatchObject({ allowed: false, code: 'POLICY_TENANT_MISMATCH' });
    });
  });

  it('scope invalid: NULL org or tenant -> POLICY_SCOPE_INVALID', async () => {
    await inRollback(async () => {
      expect(await decision(null, ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_SCOPE_INVALID' });
      expect(await decision(ORG_A, null)).toMatchObject({ allowed: false, code: 'POLICY_SCOPE_INVALID' });
    });
  });

  it('malformed: a NULL flag -> POLICY_MALFORMED (NOT NULL lifted inside this rolled-back test only)', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      expect(await effect(`UPDATE public.community_ai_platform_policy SET auto_rules_enabled = NULL WHERE organization_id = $1`, [ORG_A])).toBe('23502');
      await db.query(`ALTER TABLE public.community_ai_platform_policy ALTER COLUMN auto_rules_enabled DROP NOT NULL`);
      await db.query(`UPDATE public.community_ai_platform_policy SET auto_rules_enabled = NULL WHERE organization_id = $1`, [ORG_A]);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_MALFORMED' });
    });
  });

  it('ambiguous: a second platform row or a second tenant row is refused by the unique indexes', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      expect(await effect(`INSERT INTO public.community_ai_platform_policy (execution_enabled, auto_rules_enabled) VALUES (false, false)`)).toBe('23505');
      expect(await effect(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [ORG_A])).toBe('23505');
      expect(await effect(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $2, false, false)`, [ORG_A, ORG_B])).toBe('23514');
      // With the indexes lifted (rolled back), the decision itself refuses ambiguity.
      await db.query(`DROP INDEX public.uq_community_ai_platform_policy_org`);
      await db.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [ORG_A]);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'POLICY_AMBIGUOUS' });
    });
  });

  it('kill switch: a disabled platform row refuses every tenant -> PLATFORM_KILL_SWITCH (checked first)', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id IS NULL`);
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'PLATFORM_KILL_SWITCH' });
      expect(await decision(ORG_B)).toMatchObject({ allowed: false, code: 'PLATFORM_KILL_SWITCH' });
    });
  });

  it('closed defaults: a row inserted without flags is closed', async () => {
    await inRollback(async () => {
      await db.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id) VALUES ($1, $1)`, [ORG_A]);
      const { rows } = await db.query(`SELECT execution_enabled, auto_rules_enabled, require_human_approval FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
      expect(rows[0]).toEqual({ execution_enabled: false, auto_rules_enabled: false, require_human_approval: true });
    });
  });
});

describe('OD-2 two-person control on loosening (20270126000003)', () => {
  it('an enabled row cannot be inserted; open needs request + a different confirmer, exactly as requested, within 1 h', async () => {
    await inRollback(async () => {
      expect(await effect(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, true, false)`, [ORG_A])).toBe('23514');
      await db.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [ORG_A]);
      const enable = (by: string, exec = true, auto = false) => effect(
        `UPDATE public.community_ai_platform_policy SET execution_enabled = $2, auto_rules_enabled = $3, updated_by = $4 WHERE organization_id = $1`, [ORG_A, exec, auto, by]);
      expect(await enable(C3_CONFIRMER)).toBe('23514'); // no request
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = false, requested_by = $2 WHERE organization_id = $1`, [ORG_A, C3_REQUESTER]);
      const { rows: [req] } = await db.query(`SELECT requested_at FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
      expect(req.requested_at).not.toBeNull(); // server-stamped
      expect(await enable(C3_REQUESTER)).toBe('23514'); // confirmer = requester
      expect(await enable(C3_CONFIRMER, true, true)).toBe('23514'); // not what was requested
      // request and confirmation in one statement
      expect(await effect(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, requested_by = $2, updated_by = $2 WHERE organization_id = $1`, [ORG_A, C3_CONFIRMER])).toBe('23514');
      // TTL: an old request does not confirm
      await db.query(`ALTER TABLE public.community_ai_platform_policy DISABLE TRIGGER community_ai_platform_policy_two_person`);
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_at = clock_timestamp() - interval '61 minutes' WHERE organization_id = $1`, [ORG_A]);
      await db.query(`ALTER TABLE public.community_ai_platform_policy ENABLE TRIGGER community_ai_platform_policy_two_person`);
      expect(await enable(C3_CONFIRMER)).toBe('23514');
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = NULL, requested_auto_rules_enabled = NULL, requested_by = NULL, requested_at = NULL WHERE organization_id = $1`, [ORG_A]);
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = false, requested_by = $2 WHERE organization_id = $1`, [ORG_A, C3_REQUESTER]);
      expect(await enable(C3_CONFIRMER)).toBe('ok');
      const { rows: [after] } = await db.query(`SELECT execution_enabled, requested_by, requested_at FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
      expect(after).toEqual({ execution_enabled: true, requested_by: null, requested_at: null });
      // disabling is single-operator and immediate
      expect(await effect(`UPDATE public.community_ai_platform_policy SET execution_enabled = false, updated_by = $2 WHERE organization_id = $1`, [ORG_A, C3_REQUESTER])).toBe('ok');
    });
  });

  it('the platform row is under the same control', async () => {
    await inRollback(async () => {
      await db.query(`INSERT INTO public.community_ai_platform_policy (execution_enabled, auto_rules_enabled) VALUES (false, false)`);
      expect(await effect(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, updated_by = $1 WHERE organization_id IS NULL`, [C3_CONFIRMER])).toBe('23514');
    });
  });
});

// ── server stamp, content lock, evidence CHECK ──────────────────────────────

describe('approval evidence on the row', () => {
  it('an approval UPDATE is server-stamped (ms), a future value is refused, a decided approval cannot be rewritten', async () => {
    await inRollback(async () => {
      await ensureUser(db);
      const { rows: [r] } = await db.query(
        `INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, execution_mode)
         VALUES ($1, $1, 'linkedin', 'like', 'x-1', 'pending', 'api') RETURNING id`, [ORG_A]);
      const { rows: [s] } = await db.query(
        `UPDATE public.community_ai_actions SET status = 'approved', approved_at = '2020-01-01T00:00:00Z', approved_by = $2,
                approved_content_hash = $3, passkey_credential_id = 'cred', passkey_verified_at = clock_timestamp()
          WHERE id = $1 RETURNING approved_at, date_trunc('milliseconds', approved_at) = approved_at AS ms, approved_at > now() - interval '1 minute' AS fresh`,
        [r.id, C3_APPROVER, C3_HASH]);
      expect(s).toMatchObject({ ms: true, fresh: true });
      expect(await effect(`UPDATE public.community_ai_actions SET approved_at = clock_timestamp() + interval '1 hour' WHERE id = $1`, [r.id])).toBe('23514');
      // log the returned value: the approval is now decided and valid
      await db.query(`INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
        VALUES ($1, $2, $2, 'approved', jsonb_build_object('user_id', $3::text, 'timestamp', to_char($4::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
        [r.id, ORG_A, C3_APPROVER, s.approved_at]);
      expect(await effect(`UPDATE public.community_ai_actions SET approved_by = $2 WHERE id = $1`, [r.id, C3_APPROVER])).toBe('ok'); // unchanged value
      await ensureUser(db, C3_REQUESTER);
      expect(await effect(`UPDATE public.community_ai_actions SET approved_by = $2 WHERE id = $1`, [r.id, C3_REQUESTER])).toBe('23514');
      expect(await effect(`UPDATE public.community_ai_actions SET approved_content_hash = $2 WHERE id = $1`, [r.id, 'cd'.repeat(32)])).toBe('23514');
      // clearing (revocation) is always allowed
      expect(await effect(`UPDATE public.community_ai_actions SET approved_at = NULL, approved_content_hash = NULL, passkey_credential_id = NULL, passkey_verified_at = NULL WHERE id = $1`, [r.id])).toBe('ok');
    });
  });

  it('an INSERT is server-stamped too; the back-date seam needs superuser + the GUC and only makes it older', async () => {
    await inRollback(async () => {
      const ins = (at: string) => db.query(
        `INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, approved_at)
         VALUES ($1, $1, 'linkedin', 'like', 'x-2', 'approved', $2) RETURNING approved_at > now() - interval '1 minute' AS fresh`, [ORG_A, at]);
      expect((await ins('2020-01-01T00:00:00Z')).rows[0].fresh).toBe(true);
      await db.query(`SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'`);
      expect((await ins('2020-01-01T00:00:00Z')).rows[0].fresh).toBe(false);
      expect(await effect(`INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, approved_at)
         VALUES ($1, $1, 'linkedin', 'like', 'x-3', 'approved', clock_timestamp() + interval '1 hour')`, [ORG_A])).toBe('23514');
      // a non-superuser session cannot use the seam
      await db.query(`SET LOCAL ROLE service_role`);
      const { rows: [sr] } = await db.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`);
      expect(sr.rolsuper).toBe(false);
      await db.query(`RESET ROLE`);
    });
  });

  it('the seam keys on session_user: a non-superuser LOGIN session with the GUC set is still stamped', async () => {
    const role = `c3_probe_${process.pid}`;
    await db.query(`CREATE ROLE ${role} LOGIN PASSWORD 'c3probe' NOSUPERUSER BYPASSRLS`);
    await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.query(`GRANT SELECT, INSERT, DELETE ON public.community_ai_actions TO ${role}`);
    await db.query(`GRANT EXECUTE ON FUNCTION public.community_action_approval_evidence_code(public.community_ai_actions, timestamptz) TO ${role}`);
    const u = new URL(url); u.username = role; u.password = 'c3probe';
    const c = new Client({ connectionString: u.toString() });
    try {
      await c.connect();
      await c.query('BEGIN');
      await c.query(`SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'`);
      const { rows } = await c.query(
        `INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, approved_at)
         VALUES ($1, $1, 'linkedin', 'like', 'x-4', 'approved', '2020-01-01T00:00:00Z') RETURNING approved_at > now() - interval '1 minute' AS fresh`, [ORG_A]);
      expect(rows[0].fresh).toBe(true);
      await c.query('ROLLBACK');
    } finally {
      await c.end().catch(() => undefined);
      await db.query(`REVOKE ALL ON public.community_ai_actions FROM ${role}`);
      await db.query(`REVOKE ALL ON FUNCTION public.community_action_approval_evidence_code(public.community_ai_actions, timestamptz) FROM ${role}`);
      await db.query(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
      await db.query(`DROP ROLE ${role}`);
    }
  });

  it('content lock: approved content, target, recipient and tenant are immutable while approved; execution_mode is not', async () => {
    await inRollback(async () => {
      const { id } = await approvedAction(db, { org: ORG_A });
      const { rows: [du] } = await db.query(`INSERT INTO public.community_ai_discovered_users (tenant_id, organization_id, platform, profile_url, discovered_via)
        VALUES ($1, $1, 'linkedin', 'https://www.linkedin.com/in/c3', 'api') RETURNING id`, [ORG_A]);
      for (const set of [`suggested_text = 'other'`, `target_id = 'other'`, `platform = 'x'`, `action_type = 'like'`,
        `playbook_id = gen_random_uuid()`, `organization_id = '${ORG_B}'`, `tenant_id = '${ORG_B}'`,
        `discovered_user_id = '${du.id}'`]) {
        expect(await effect(`UPDATE public.community_ai_actions SET ${set} WHERE id = $1`, [id])).toBe('23514');
      }
      expect(await effect(`UPDATE public.community_ai_actions SET execution_mode = 'browser', final_text = suggested_text WHERE id = $1`, [id])).toBe('ok');
      expect(await effect(`UPDATE public.community_ai_actions SET approved_at = NULL, approved_content_hash = NULL, passkey_credential_id = NULL,
        passkey_verified_at = NULL, suggested_text = 'edited' WHERE id = $1`, [id])).toBe('ok');
    });
  });

  it('evidence CHECK: passkey id and time together, 64-hex hash, none without approved_at', async () => {
    await inRollback(async () => {
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await effect(`UPDATE public.community_ai_actions SET passkey_verified_at = NULL WHERE id = $1`, [id])).toBe('23514');
      expect(await effect(`UPDATE public.community_ai_actions SET approved_at = NULL WHERE id = $1`, [id])).toBe('23514');
      expect(await effect(`INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, approved_content_hash)
        VALUES ($1, $1, 'linkedin', 'like', 'x', 'ab')`, [ORG_A])).toBe('23514');
    });
  });
});

// ── §8 expiry and evidence at the three claim points ────────────────────────

const POINTS = ['action claim', 'browser claim', 'backstop'] as const;
type Point = typeof POINTS[number];

/** Try to claim at one point; returns true when claimed. */
async function claimAt(point: Point, id: string): Promise<boolean> {
  if (point === 'action claim') return (await claimRpc(db, id, ORG_A, 'manual')).claimed;
  if (point === 'browser claim') return (await browserClaimRpc(db, id, ORG_A)) === 1;
  return (await effect(`UPDATE public.community_ai_actions SET status = 'executing' WHERE id = $1`, [id])) === 'ok';
}
const rowFor = (point: Point) => (point === 'browser claim'
  ? { status: 'pending', executionMode: 'browser' } : { status: 'approved', executionMode: 'api' });

describe('§8 approval expiry and evidence, at every claim point', () => {
  const CASES: Array<[string, (p: Point) => Parameters<typeof approvedAction>[1], boolean, string | null]> = [
    ['valid (1 minute old)', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 60_000 }), true, null],
    ['just before 7 days', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 7 * DAY - 60_000 }), true, null],
    ['exactly 7 days', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 7 * DAY }), false, 'APPROVAL_EXPIRED'],
    ['just after 7 days', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 7 * DAY + 1 }), false, 'APPROVAL_EXPIRED'],
    ['missing approval (no approved_at)', (p) => ({ org: ORG_A, ...rowFor(p), approved: false, approver: null, hash: null, passkeyOffsetMs: null, log: false }), false, 'APPROVAL_REQUIRED'],
    ['no approver', (p) => ({ org: ORG_A, ...rowFor(p), approver: null }), false, 'APPROVAL_EVIDENCE_REQUIRED'],
    ['no approve-route log', (p) => ({ org: ORG_A, ...rowFor(p), log: false }), false, 'APPROVAL_EVIDENCE_REQUIRED'],
    ['no content hash', (p) => ({ org: ORG_A, ...rowFor(p), hash: null }), false, 'APPROVAL_EVIDENCE_REQUIRED'],
    ['no passkey', (p) => ({ org: ORG_A, ...rowFor(p), passkeyOffsetMs: null }), false, 'APPROVAL_EVIDENCE_REQUIRED'],
    ['passkey 5 min 1 s before', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 60_000, passkeyOffsetMs: -301_000 }), false, 'APPROVAL_EVIDENCE_REQUIRED'],
    ['passkey 5 min before (edge, valid)', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 60_000, passkeyOffsetMs: -300_000 }), true, null],
    ['passkey 60 s after (edge, valid)', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 120_000, passkeyOffsetMs: 60_000 }), true, null],
    ['passkey 61 s after', (p) => ({ org: ORG_A, ...rowFor(p), ageMs: 120_000, passkeyOffsetMs: 61_000 }), false, 'APPROVAL_EVIDENCE_REQUIRED'],
  ];
  for (const point of POINTS) {
    it.each(CASES)(`${point}: %s`, async (_l, make, ok, code) => {
      await inRollback(async () => {
        await openTenant(db, ORG_A);
        const { id } = await approvedAction(db, make(point));
        expect(await claimAt(point, id)).toBe(ok);
        if (point === 'backstop') return;
        const refusals = await refusalsOf(db, id);
        expect(refusals.map((r) => r.code)).toEqual(code ? [code] : []);
        if (!ok) expect(await statusOf(db, id)).toBe(rowFor(point).status); // not burned
      });
    });
  }

  it('the boundary itself, by the predicate: approved_at + 7 days is expired, 1 ms before is not; a future approved_at is invalid', async () => {
    await inRollback(async () => {
      const { id } = await approvedAction(db, { org: ORG_A, ageMs: 60_000 });
      const at = async (expr: string) => (await db.query(
        `SELECT public.community_action_approval_evidence_code(a, ${expr}) AS c FROM public.community_ai_actions a WHERE id = $1`, [id])).rows[0].c;
      expect(await at(`a.approved_at + interval '7 days'`)).toBe('APPROVAL_EXPIRED');
      expect(await at(`a.approved_at + interval '7 days' - interval '1 millisecond'`)).toBeNull();
      expect(await at(`a.approved_at - interval '1 millisecond'`)).toBe('APPROVAL_EVIDENCE_REQUIRED');
    });
  });

  it('revoked (approval cleared) and cancelled', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      await db.query(`UPDATE public.community_ai_actions SET approved_at = NULL, approved_content_hash = NULL, passkey_credential_id = NULL, passkey_verified_at = NULL WHERE id = $1`, [id]);
      expect(await claimRpc(db, id, ORG_A)).toMatchObject({ claimed: false, code: 'APPROVAL_REQUIRED' });
      const c = await approvedAction(db, { org: ORG_A, cancelRequested: true });
      expect(await claimRpc(db, c.id, ORG_A)).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', current_status: 'approved' });
      expect(await refusalsOf(db, c.id)).toEqual([]);
    });
  });

  it('a legacy row (approved_at only, no approver, log, hash or passkey) is claimable at NO point', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      for (const point of POINTS) {
        const { id } = await approvedAction(db, { org: ORG_A, ...rowFor(point), approver: null, hash: null, passkeyOffsetMs: null, log: false, ageMs: 1000 });
        expect(await claimAt(point, id)).toBe(false);
      }
    });
  });
});

// ── claim semantics on one session ──────────────────────────────────────────

describe('the action claim', () => {
  it('claims once: approved -> executing, stamps the mode, returns executing; a second claim is CLAIM_CONFLICT and writes nothing', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await claimRpc(db, id, ORG_A, 'scheduler', ORG_A, 'rpa')).toEqual({ claimed: true, code: null, current_status: 'executing' });
      const { rows: [r] } = await db.query(`SELECT status, execution_mode FROM public.community_ai_actions WHERE id = $1`, [id]);
      expect(r).toEqual({ status: 'executing', execution_mode: 'rpa' });
      const logsBefore = await logTypesOf(db, id);
      expect(await claimRpc(db, id, ORG_A, 'scheduler')).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', current_status: 'executing' });
      expect(await logTypesOf(db, id)).toEqual(logsBefore);
    });
  });

  it.each(['uncertain', 'executed', 'failed', 'skipped', 'pending'])('re-claim of a %s row: CLAIM_CONFLICT with its status, no record', async (status) => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A, status });
      expect(await claimRpc(db, id, ORG_A)).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', current_status: status });
      expect(await refusalsOf(db, id)).toEqual([]);
    });
  });

  it("another tenant's action: TENANT_SCOPE_VIOLATION, nothing written in either tenant; unknown id: ACTION_NOT_FOUND", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      await openPolicy(db, ORG_B);
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await claimRpc(db, id, ORG_B)).toEqual({ claimed: false, code: 'TENANT_SCOPE_VIOLATION', current_status: null });
      expect(await claimRpc(db, id, ORG_A, 'manual', ORG_B)).toMatchObject({ claimed: false, code: 'TENANT_SCOPE_VIOLATION' });
      expect(await claimRpc(db, '00000000-0000-4000-8000-00000000dead', ORG_A)).toMatchObject({ claimed: false, code: 'ACTION_NOT_FOUND' });
      expect(await refusalsOf(db, id)).toEqual([]);
      expect(await statusOf(db, id)).toBe('approved');
    });
  });

  it.each([
    ['kill switch', async () => db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id IS NULL`), 'PLATFORM_KILL_SWITCH', 'skipped_due_to_platform_policy'],
    ['tenant disabled', async () => db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_A]), 'POLICY_EXECUTION_DISABLED', 'skipped_due_to_platform_policy'],
    ['tenant row missing', async () => db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]), 'POLICY_MISSING', 'skipped_due_to_platform_policy'],
  ])('policy refusal (%s) right before the claim: row stays approved, one refusal record', async (_l, act, code, type) => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      await act();
      expect(await claimRpc(db, id, ORG_A)).toEqual({ claimed: false, code, current_status: 'approved' });
      expect(await statusOf(db, id)).toBe('approved');
      expect(await refusalsOf(db, id)).toEqual([{ event_type: type, code, claim_point: 'manual' }]);
      expect(await effect(`UPDATE public.community_ai_actions SET status = 'executing' WHERE id = $1`, [id])).toBe('23514'); // backstop agrees
    });
  });

  it("claim point 'auto' requires auto rules: POLICY_AUTO_RULES_DISABLED; manual is unaffected", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A, { auto: false });
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await claimRpc(db, id, ORG_A, 'auto')).toMatchObject({ claimed: false, code: 'POLICY_AUTO_RULES_DISABLED' });
      expect(await refusalsOf(db, id)).toEqual([{ event_type: 'skipped_due_to_platform_policy', code: 'POLICY_AUTO_RULES_DISABLED', claim_point: 'auto' }]);
      expect(await claimRpc(db, id, ORG_A, 'manual')).toMatchObject({ claimed: true });
    });
  });

  it('an invalid claim point or a NULL action raises; NULL scope is POLICY_SCOPE_INVALID and writes nothing', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await effect(`SELECT * FROM public.claim_community_ai_action_for_execution($1, $2, $2, 'browser', NULL, NULL)`, [id, ORG_A])).toBe('P0001');
      expect(await effect(`SELECT * FROM public.claim_community_ai_action_for_execution(NULL, $1, $1, 'manual', NULL, NULL)`, [ORG_A])).toBe('P0001');
      expect(await claimRpc(db, id, null as any, 'manual', null as any)).toMatchObject({ claimed: false, code: 'POLICY_SCOPE_INVALID' });
      expect(await refusalsOf(db, id)).toEqual([]);
    });
  });

  it('backstop: a writer that skips the claim cannot move a row into executing or lease it; legitimate writes still pass', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const legacy = await approvedAction(db, { org: ORG_A, approver: null, hash: null, passkeyOffsetMs: null, log: false });
      expect(await effect(`UPDATE public.community_ai_actions SET status = 'executing' WHERE id = $1`, [legacy.id])).toBe('23514');
      const pend = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', approver: null, hash: null, passkeyOffsetMs: null, log: false });
      expect(await effect(`UPDATE public.community_ai_actions SET dispatch_lease_id = 'l' WHERE id = $1`, [pend.id])).toBe('23514');
      // legitimate: claim, write back pending for the extension, lease via the RPC, finish, reap
      const { id } = await approvedAction(db, { org: ORG_A, executionMode: 'browser' });
      expect((await claimRpc(db, id, ORG_A)).claimed).toBe(true);
      expect(await effect(`UPDATE public.community_ai_actions SET status = 'pending' WHERE id = $1`, [id])).toBe('ok');
      expect(await browserClaimRpc(db, id, ORG_A)).toBe(1);
      expect(await effect(`UPDATE public.community_ai_actions SET status = 'executed', dispatch_lease_id = NULL WHERE id = $1`, [id])).toBe('ok');
      const e = await approvedAction(db, { org: ORG_A });
      expect((await claimRpc(db, e.id, ORG_A)).claimed).toBe(true);
      expect(await effect(`UPDATE public.community_ai_actions SET status = 'uncertain' WHERE id = $1`, [e.id])).toBe('ok');
    });
  });

  it('INSERT backstop: a row inserted executing or leased must carry a current approval; pending and platform-sync rows pass', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const ins = (status: string, lease: string | null) => effect(
        `INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, execution_mode, dispatch_lease_id)
         VALUES ($1, $1, 'linkedin', 'like', 'x-ins', $2, 'api', $3)`, [ORG_A, status, lease]);
      expect(await ins('executing', null)).toBe('23514');
      expect(await ins('pending', 'lease-x')).toBe('23514');
      expect(await ins('approved', 'lease-x')).toBe('23514');
      expect(await ins('pending', null)).toBe('ok');
      // a legacy 'approved' row inserted with approved_at only, executing: refused
      expect(await effect(`INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, approved_at)
        VALUES ($1, $1, 'linkedin', 'like', 'x-leg', 'executing', clock_timestamp())`, [ORG_A])).toBe('23514');
      // the platform-sync row shape (pages/api/engagement/platform-sync.ts): pending, browser, self-stamped approved_at, no lease
      expect(await effect(`INSERT INTO public.community_ai_actions (id, tenant_id, organization_id, platform, action_type, target_id, suggested_text,
          risk_level, requires_human_approval, requires_approval, execution_mode, status, execution_correlation_id, idempotency_key,
          command_chain, command_chain_index, approved_at, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $1, 'linkedin', 'dm', 'sync-dm-inbox:linkedin', NULL, 'low', false, false, 'browser', 'pending',
          gen_random_uuid(), 'sync-key-1', '[{"action_type":"sync_dm_inbox","payload":{"navigate":true}}]'::jsonb, 0,
          clock_timestamp(), now(), now())`, [ORG_A])).toBe('ok');
      // a fully approved row may be inserted executing (fixture shape; the predicate applies, not a blanket ban)
      expect((await approvedAction(db, { org: ORG_A, status: 'executing' })).id).toBeTruthy();
      // and with the policy closed, even that is refused
      await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_A]);
      await db.query('SAVEPOINT p');
      await expect(approvedAction(db, { org: ORG_A, status: 'executing' })).rejects.toMatchObject({ code: '23514' });
      await db.query('ROLLBACK TO SAVEPOINT p');
    });
  });

  it('browser chain: each step re-claims through the same checks (an approval that expired mid-chain stops the next step)', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', ageMs: 7 * DAY - 60_000 });
      expect(await browserClaimRpc(db, id, ORG_A, 'step-0')).toBe(1);
      // step 0 done: lease cleared for the next step (action-result)
      await db.query(`UPDATE public.community_ai_actions SET dispatch_lease_id = NULL, dispatch_lease_holder_id = NULL, dispatch_lease_expires_at = NULL WHERE id = $1`, [id]);
      expect(await browserClaimRpc(db, id, ORG_A, 'step-1')).toBe(1);
      await db.query(`UPDATE public.community_ai_actions SET dispatch_lease_id = NULL, dispatch_lease_holder_id = NULL, dispatch_lease_expires_at = NULL WHERE id = $1`, [id]);
      // the same row, judged at a later instant
      const { rows } = await db.query(`SELECT public.community_action_approval_evidence_code(a, clock_timestamp() + interval '2 minutes') AS c FROM public.community_ai_actions a WHERE id = $1`, [id]);
      expect(rows[0].c).toBe('APPROVAL_EXPIRED');
    });
  });
});

// ── §13 refusal records ─────────────────────────────────────────────────────

describe('§13 refusal records', () => {
  it('exactly one record per refusal across repeated attempts, at both claim functions; a new policy version is a new refusal', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const a = await approvedAction(db, { org: ORG_A, ageMs: 8 * DAY });
      for (let i = 0; i < 4; i += 1) expect((await claimRpc(db, a.id, ORG_A)).code).toBe('APPROVAL_EXPIRED');
      expect(await refusalsOf(db, a.id)).toEqual([{ event_type: 'skipped', code: 'APPROVAL_EXPIRED', claim_point: 'manual' }]);
      const b = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser', ageMs: 8 * DAY });
      for (let i = 0; i < 4; i += 1) expect(await browserClaimRpc(db, b.id, ORG_A)).toBe(0);
      expect(await refusalsOf(db, b.id)).toEqual([{ event_type: 'skipped', code: 'APPROVAL_EXPIRED', claim_point: 'browser' }]);
      // SEC3-F7b: a write that changes no flag (request bookkeeping, require_human_approval) is not a new refusal
      await db.query(`UPDATE public.community_ai_platform_policy SET require_human_approval = true WHERE organization_id = $1`, [ORG_A]);
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_auto_rules_enabled = false, requested_by = $2 WHERE organization_id = $1`, [ORG_A, C3_REQUESTER]);
      await claimRpc(db, a.id, ORG_A);
      expect((await refusalsOf(db, a.id)).length).toBe(1);
      // an effective flag change is a new policy state: a new refusal
      await db.query(`UPDATE public.community_ai_platform_policy SET auto_rules_enabled = false WHERE organization_id = $1`, [ORG_A]);
      await claimRpc(db, a.id, ORG_A);
      expect((await refusalsOf(db, a.id)).length).toBe(2);
    });
  });

  it("the record function writes only 'skipped' / 'skipped_due_to_platform_policy', never 'approved', and its key cannot be forged", async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      const rec = async (code: string, payload: object) => (await db.query(
        `SELECT public.record_community_execution_refusal($1, $2, $2, 'manual', $3, NULL, $4::jsonb) AS ok`, [id, ORG_A, code, JSON.stringify(payload)])).rows[0].ok;
      expect(await rec('APPROVAL_REQUIRED', { event_type: 'approved', refusal_key: 'forged', user_id: C3_APPROVER })).toBe(true);
      expect(await rec('APPROVAL_REQUIRED', {})).toBe(false); // same refusal
      expect(await rec('POLICY_MISSING', {})).toBe(true);
      const { rows } = await db.query(
        `SELECT event_type, event_payload->>'refusal_key' AS k FROM public.community_ai_action_logs WHERE action_id = $1 AND event_payload ? 'refusal_key' ORDER BY created_at, id`, [id]);
      expect(rows.map((r: any) => r.event_type).sort()).toEqual(['skipped', 'skipped_due_to_platform_policy']);
      expect(rows.every((r: any) => /^[0-9a-f]{64}$/.test(r.k))).toBe(true);
      expect((await logTypesOf(db, id)).filter((t) => t === 'approved')).toHaveLength(1); // only the fixture's approval
      // SEC3-F6: never a silent drop. Another organization, another tenant or an unknown action RAISES.
      expect(await effect(`SELECT public.record_community_execution_refusal($1, $2, $2, 'manual', 'X', NULL, NULL)`, [id, ORG_B])).toBe('P0001');
      expect(await effect(`SELECT public.record_community_execution_refusal($1, $2, $3, 'browser', 'POLICY_MISSING', NULL, '{}'::jsonb)`, [id, ORG_A, ORG_B])).toBe('P0001');
      expect(await effect(`SELECT public.record_community_execution_refusal(gen_random_uuid(), $1, $1, 'manual', 'X', NULL, NULL)`, [ORG_A])).toBe('P0001');
    });
  });

  it("the widened CHECK accepts 'skipped_due_to_platform_policy' (the executor's policy event)", async () => {
    await inRollback(async () => {
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await effect(`INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
        VALUES ($1, $2, $2, 'skipped_due_to_platform_policy', '{}')`, [id, ORG_A])).toBe('ok');
      expect(await effect(`INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
        VALUES ($1, $2, $2, 'nope', '{}')`, [id, ORG_A])).toBe('23514');
    });
  });
});

// ── grants ───────────────────────────────────────────────────────────────────

describe('grants (measured, never inferred)', () => {
  it.each([
    'public.community_execution_policy_decision(uuid,uuid)',
    'public.claim_community_ai_action_for_execution(uuid,uuid,uuid,text,text,text)',
    'public.claim_community_ai_browser_command(uuid,uuid,text,text,integer)',
    'public.record_community_execution_refusal(uuid,uuid,uuid,text,text,uuid,jsonb)',
    'public.community_action_approval_evidence_code(public.community_ai_actions,timestamptz)',
  ])('%s: service_role only', async (f) => {
    const { rows: [r] } = await db.query(
      `SELECT has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS sr,
              has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
              (SELECT prosecdef FROM pg_proc WHERE oid = $1::regprocedure) AS secdef,
              (SELECT proconfig FROM pg_proc WHERE oid = $1::regprocedure) AS cfg`, [f]);
    expect(r).toMatchObject({ sr: true, anon: false, auth: false, secdef: true });
    expect(r.cfg).toEqual(['search_path=public, pg_temp']);
  });

  it.each([
    'public.community_ai_actions_server_approved_at()', 'public.community_ai_actions_content_lock()',
    'public.community_ai_actions_claim_requires_approval()', 'public.community_ai_platform_policy_two_person()',
    'public.community_ai_platform_policy_touch()',
  ])('%s (trigger function): no anon / authenticated execute', async (f) => {
    const { rows: [r] } = await db.query(
      `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth`, [f]);
    expect(r).toEqual({ anon: false, auth: false });
  });
});

// ── §6 concurrency: committed fixtures, separate sessions ───────────────────

describe('§6 concurrency (committed fixtures, one session per worker)', () => {
  const sessions: Client[] = [];
  const session = async () => { const c = new Client({ connectionString: url }); await c.connect(); sessions.push(c); return c; };
  const committed = async <T>(fn: () => Promise<T>): Promise<T> => {
    await db.query('BEGIN'); try { const r = await fn(); await db.query('COMMIT'); return r; } catch (e) { await db.query('ROLLBACK'); throw e; }
  };
  const waitingOnLock = async (c: Client) => {
    const pid = (c as any).processID;
    for (let i = 0; i < 200; i += 1) {
      const { rows } = await db.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
      if (rows[0]?.wait_event_type === 'Lock') return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };
  let hadPlatform = false;

  beforeAll(async () => {
    hadPlatform = (await db.query(`SELECT 1 FROM public.community_ai_platform_policy WHERE organization_id IS NULL`)).rows.length > 0;
    await committed(async () => {
      await db.query(`INSERT INTO public.companies (id, name) VALUES ($1, 'C3 concurrency') ON CONFLICT (id) DO NOTHING`, [ORG_C]);
      await openTenant(db, ORG_C);
    });
  });
  afterAll(async () => {
    await Promise.all(sessions.map((c) => c.end().catch(() => undefined)));
    await db.query(`DELETE FROM public.community_ai_action_logs WHERE organization_id = $1`, [ORG_C]);
    await db.query(`DELETE FROM public.community_ai_actions WHERE organization_id = $1`, [ORG_C]);
    await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_C]);
    if (!hadPlatform) await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
    await db.query(`DELETE FROM public.users WHERE id = $1`, [C3_APPROVER]);
  });

  const PAIRS: Array<[string, string[]]> = [
    ['two workers (manual, manual)', ['manual', 'manual']],
    ['scheduler x scheduler', ['scheduler', 'scheduler']],
    ['manual vs scheduler', ['manual', 'scheduler']],
    ['retry vs original (rpa_retry vs scheduler)', ['rpa_retry', 'scheduler']],
    ['orchestration vs auto vs manual', ['orchestration', 'auto', 'manual']],
  ];
  it.each(PAIRS)('%s: exactly one claim; losers get CLAIM_CONFLICT and write nothing', async (_l, points) => {
    const { id } = await committed(() => approvedAction(db, { org: ORG_C }));
    const cs = await Promise.all(points.map(() => session()));
    // hold the row so every claimant queues behind the same lock
    const holder = await session();
    await holder.query('BEGIN');
    await holder.query(`SELECT 1 FROM public.community_ai_actions WHERE id = $1 FOR UPDATE`, [id]);
    const runs = points.map((p, i) => claimRpc(cs[i], id, ORG_C, p));
    expect(await waitingOnLock(cs[0])).toBe(true);
    await holder.query('COMMIT');
    const results = await Promise.all(runs);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(results.filter((r) => !r.claimed).every((r) => r.code === 'CLAIM_CONFLICT' && r.current_status === 'executing')).toBe(true);
    expect(await logTypesOf(db, id)).toEqual(['approved']);
    expect(await statusOf(db, id)).toBe('executing');
  });

  it('extension vs manual on a dispatched (pending) browser row: the extension leases it once, manual is CLAIM_CONFLICT', async () => {
    const { id } = await committed(() => approvedAction(db, { org: ORG_C, status: 'pending', executionMode: 'browser' }));
    const [e1, e2, m] = await Promise.all([session(), session(), session()]);
    const [l1, l2, man] = await Promise.all([browserClaimRpc(e1, id, ORG_C, 'l1'), browserClaimRpc(e2, id, ORG_C, 'l2'), claimRpc(m, id, ORG_C)]);
    expect(l1 + l2).toBe(1);
    expect(man).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', current_status: 'pending' });
    expect(await logTypesOf(db, id)).toEqual(['approved']);
  });

  it('extension vs manual on an approved row: manual claims, the extension leases nothing', async () => {
    const { id } = await committed(() => approvedAction(db, { org: ORG_C, executionMode: 'browser' }));
    const [e, m] = await Promise.all([session(), session()]);
    const [l, man] = await Promise.all([browserClaimRpc(e, id, ORG_C), claimRpc(m, id, ORG_C)]);
    expect(l).toBe(0);
    expect(man.claimed).toBe(true);
  });

  it('re-claim after uncertain / completed / revoke / expiry: never claimed again', async () => {
    const make = (o: Partial<Parameters<typeof approvedAction>[1]> = {}) => committed(() => approvedAction(db, { org: ORG_C, ...o }));
    const s = await session();
    const u = await make();
    expect((await claimRpc(s, u.id, ORG_C)).claimed).toBe(true);
    await db.query(`UPDATE public.community_ai_actions SET status = 'uncertain' WHERE id = $1`, [u.id]);
    expect(await claimRpc(s, u.id, ORG_C)).toMatchObject({ claimed: false, code: 'CLAIM_CONFLICT', current_status: 'uncertain' });
    await db.query(`UPDATE public.community_ai_actions SET status = 'executed' WHERE id = $1`, [u.id]);
    expect(await claimRpc(s, u.id, ORG_C)).toMatchObject({ claimed: false, code: 'CLAIM_CONFLICT', current_status: 'executed' });
    const r = await make();
    await db.query(`UPDATE public.community_ai_actions SET approved_at = NULL, approved_content_hash = NULL, passkey_credential_id = NULL, passkey_verified_at = NULL WHERE id = $1`, [r.id]);
    expect(await claimRpc(s, r.id, ORG_C)).toMatchObject({ claimed: false, code: 'APPROVAL_REQUIRED' });
    const x = await make({ ageMs: 7 * DAY + 1000 });
    expect(await claimRpc(s, x.id, ORG_C)).toMatchObject({ claimed: false, code: 'APPROVAL_EXPIRED' });
  });

  it('§8/§13 concurrent: expired row claimed from four sessions at once -> all refused, ONE refusal record', async () => {
    const { id } = await committed(() => approvedAction(db, { org: ORG_C, ageMs: 7 * DAY + 1000 }));
    const cs = await Promise.all([1, 2, 3, 4].map(() => session()));
    const res = await Promise.all(cs.map((c, i) => claimRpc(c, id, ORG_C, i % 2 ? 'scheduler' : 'manual')));
    expect(res.every((r) => !r.claimed && r.code === 'APPROVAL_EXPIRED')).toBe(true);
    const refusals = await refusalsOf(db, id);
    expect(refusals.filter((r) => r.claim_point === 'manual')).toHaveLength(1);
    expect(refusals.filter((r) => r.claim_point === 'scheduler')).toHaveLength(1);
    expect(await statusOf(db, id)).toBe('approved');
  });

  it('§7 concurrent disable vs claim: a claim holding the policy FOR SHARE makes the disable wait; a pending disable makes the claim wait and then refuse', async () => {
    const a = await committed(() => approvedAction(db, { org: ORG_C }));
    const b = await committed(() => approvedAction(db, { org: ORG_C }));
    const [claimer, admin] = await Promise.all([session(), session()]);
    // 1. the claim is first: its transaction holds the policy rows FOR SHARE
    await claimer.query('BEGIN');
    expect((await claimRpc(claimer, a.id, ORG_C)).claimed).toBe(true);
    const disable = admin.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_C]);
    expect(await waitingOnLock(admin)).toBe(true);
    await claimer.query('COMMIT');
    await disable;
    // 2. the disable is first and uncommitted: the claim waits, then sees it
    await committed(() => openPolicy(db, ORG_C));
    await admin.query('BEGIN');
    await admin.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false WHERE organization_id = $1`, [ORG_C]);
    const pending = claimRpc(claimer, b.id, ORG_C);
    expect(await waitingOnLock(claimer)).toBe(true);
    await admin.query('COMMIT');
    expect(await pending).toEqual({ claimed: false, code: 'POLICY_EXECUTION_DISABLED', current_status: 'approved' });
    expect(await statusOf(db, b.id)).toBe('approved');
    await committed(() => openPolicy(db, ORG_C));
  });
});

// ── SEC3 hardening (permanent forms of the reviewer's repros) ───────────────

describe('SEC3 hardening', () => {
  const OPERATOR_C = '00000000-0000-4000-8000-0000000000d3';

  it('F2: a request made before a kill-switch tighten can never reopen execution after it', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A, { auto: false });
      await db.query(`UPDATE public.community_ai_platform_policy SET auto_rules_enabled = false, updated_by = $1 WHERE organization_id IS NULL`, [OPERATOR_C]);
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = true,
        requested_by = $1 WHERE organization_id IS NULL`, [C3_REQUESTER]);
      const { rows: [req] } = await db.query(`SELECT requested_base_execution_enabled AS e, requested_base_auto_rules_enabled AS a FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
      expect(req).toEqual({ e: true, a: false }); // the base, stamped by the server
      // incident: the kill switch (single operator), written the way the route writes it
      await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false, auto_rules_enabled = false,
        requested_execution_enabled = NULL, requested_auto_rules_enabled = NULL, updated_by = $1 WHERE organization_id IS NULL`, [OPERATOR_C]);
      const { rows: [after] } = await db.query(`SELECT requested_by, requested_at, requested_execution_enabled, requested_auto_rules_enabled,
        requested_base_execution_enabled, requested_base_auto_rules_enabled FROM public.community_ai_platform_policy WHERE organization_id IS NULL`);
      expect(Object.values(after).every((v) => v === null)).toBe(true); // all six cleared
      // the confirmation, as the route's CAS writes it, matches nothing
      const r = await db.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, auto_rules_enabled = true, updated_by = $1
        WHERE organization_id IS NULL AND requested_by = $2 AND requested_execution_enabled = true AND requested_auto_rules_enabled = true`, [C3_CONFIRMER, C3_REQUESTER]);
      expect(r.rowCount).toBe(0);
      // and a blind confirmation is refused
      expect(await effect(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, updated_by = $1 WHERE organization_id IS NULL`, [C3_CONFIRMER])).toBe('23514');
      expect(await decision(ORG_A)).toMatchObject({ allowed: false, code: 'PLATFORM_KILL_SWITCH' });
    });
  });

  it('F2: a confirmation is refused when the flags moved off the request base; a request without bases is refused by the CHECK', async () => {
    await inRollback(async () => {
      await db.query(`INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled) VALUES ($1, $1, false, false)`, [ORG_A]);
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_execution_enabled = true, requested_auto_rules_enabled = false, requested_by = $2 WHERE organization_id = $1`, [ORG_A, C3_REQUESTER]);
      await db.query(`ALTER TABLE public.community_ai_platform_policy DISABLE TRIGGER community_ai_platform_policy_two_person`);
      await db.query(`UPDATE public.community_ai_platform_policy SET requested_base_auto_rules_enabled = true WHERE organization_id = $1`, [ORG_A]);
      expect(await effect(`UPDATE public.community_ai_platform_policy SET requested_base_execution_enabled = NULL WHERE organization_id = $1`, [ORG_A])).toBe('23514');
      await db.query(`ALTER TABLE public.community_ai_platform_policy ENABLE TRIGGER community_ai_platform_policy_two_person`);
      expect(await effect(`UPDATE public.community_ai_platform_policy SET execution_enabled = true, updated_by = $2 WHERE organization_id = $1`, [ORG_A, C3_CONFIRMER])).toBe('23514');
    });
  });

  it('F4: final_text may only be NULL or the approved text, and command_chain is frozen, while approved', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      const { id } = await approvedAction(db, { org: ORG_A });
      expect(await effect(`UPDATE public.community_ai_actions SET final_text = 'UNAPPROVED TEXT' WHERE id = $1`, [id])).toBe('23514');
      expect(await effect(`UPDATE public.community_ai_actions SET final_text = suggested_text WHERE id = $1`, [id])).toBe('ok');
      expect(await effect(`UPDATE public.community_ai_actions SET final_text = NULL WHERE id = $1`, [id])).toBe('ok');
      const b = await approvedAction(db, { org: ORG_A, status: 'pending', executionMode: 'browser' });
      expect(await effect(`UPDATE public.community_ai_actions SET command_chain = '[{"action_type":"continue_thread","payload":{"text":"UNAPPROVED"}}]'::jsonb WHERE id = $1`, [b.id])).toBe('23514');
      expect((await claimRpc(db, id, ORG_A, 'rpa_retry')).claimed).toBe(true);
      expect(await effect(`UPDATE public.community_ai_actions SET final_text = 'UNAPPROVED TEXT' WHERE id = $1`, [id])).toBe('23514'); // also after the claim
    });
  });

  it('F5: a policy row is never re-pointed to another tenant or scope', async () => {
    await inRollback(async () => {
      await openTenant(db, ORG_A);
      expect(await effect(`UPDATE public.community_ai_platform_policy SET organization_id = $1, tenant_id = $1 WHERE organization_id = $2`, [ORG_B, ORG_A])).toBe('23514');
      expect(await effect(`UPDATE public.community_ai_platform_policy SET organization_id = NULL, tenant_id = NULL WHERE organization_id = $1`, [ORG_A])).toBe('23514');
      expect(await effect(`UPDATE public.community_ai_platform_policy SET organization_id = $1, tenant_id = $1 WHERE organization_id IS NULL`, [ORG_B])).toBe('23514');
      expect(await decision(ORG_B)).toMatchObject({ allowed: false, code: 'POLICY_MISSING' });
    });
  });

  it.each(['executed', 'uncertain', 'failed', 'skipped', 'executing', 'pending'])(
    'F7a: claiming a %s row is CLAIM_CONFLICT and writes no refusal record, even with the policy closed',
    async (status) => {
      await inRollback(async () => {
        await openTenant(db, ORG_A);
        const { id } = await approvedAction(db, { org: ORG_A, status });
        // then close it: POLICY_MISSING would apply (and be recorded) if policy were checked first
        await db.query(`DELETE FROM public.community_ai_platform_policy WHERE organization_id = $1`, [ORG_A]);
        expect(await claimRpc(db, id, ORG_A)).toEqual({ claimed: false, code: 'CLAIM_CONFLICT', current_status: status });
        expect(await refusalsOf(db, id)).toEqual([]);
      });
    });

  it('F9: the back-date seam is closed when the CURRENT role is not a superuser (SET ROLE service_role)', async () => {
    await inRollback(async () => {
      await db.query(`SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'`);
      await db.query(`GRANT INSERT, SELECT ON public.community_ai_actions TO service_role`); // rolled back
      await db.query(`SET LOCAL ROLE service_role`);
      let fresh: boolean;
      try {
        const { rows } = await db.query(
          `INSERT INTO public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id, status, approved_at)
           VALUES ($1, $1, 'linkedin', 'like', 'seam-setrole', 'approved', '2020-01-01T00:00:00Z') RETURNING approved_at > now() - interval '1 minute' AS fresh`, [ORG_A]);
        fresh = rows[0].fresh;
      } finally {
        await db.query(`RESET ROLE`);
      }
      expect(fresh).toBe(true);
    });
  });
});
