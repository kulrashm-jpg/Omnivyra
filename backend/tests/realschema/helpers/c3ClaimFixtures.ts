/**
 * C3 fixtures for the single community claim (20270126000000-03).
 *
 * openPolicy: opens execution for a tenant the only supported way, the
 *   production two-person path (insert closed, request by one operator,
 *   confirm by another). No trigger is bypassed.
 * approvedAction: an action carrying a complete human approval (approved_by,
 *   the approve route's 'approved' log, content hash, passkey evidence). An old
 *   approved_at uses the test-only back-date seam (superuser session + SET
 *   LOCAL omnivyra.community_action_test_backdate), which only fails closed.
 *   Callers must be inside a transaction (inRollback or BEGIN ... COMMIT).
 */
import { randomUUID } from 'crypto';
import { communityApprovalBindingHash } from '../../../services/communityApprovalBinding';

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export const C3_APPROVER = '00000000-0000-4000-8000-0000000000c3';
export const C3_REQUESTER = '00000000-0000-4000-8000-0000000000d1';
export const C3_CONFIRMER = '00000000-0000-4000-8000-0000000000d2';
/** A well-formed hash that binds nothing (format-only checks). */
export const C3_HASH = 'ab'.repeat(32);

/** The approve route's binding hash for a row (communityApprovalBinding, B). */
export function bindingHashOf(row: { id: string; tenant_id: string; organization_id: string; platform: string; action_type: string;
  target_id: string; suggested_text: string | null; playbook_id?: string | null; discovered_user_id?: string | null }): string {
  const r = communityApprovalBindingHash(row);
  if (!r.ok) throw new Error(`fixture cannot be bound: ${r.reason}`);
  return r.hash;
}

export async function ensureUser(c: Q, id: string = C3_APPROVER): Promise<void> {
  await c.query(`INSERT INTO public.users (id, email, name) VALUES ($1, $2, 'c3') ON CONFLICT (id) DO NOTHING`,
    [id, `c3-${id.slice(-4)}@example.invalid`]);
}

/** Platform row (org NULL) and/or tenant row, opened by request + confirmation. */
export async function openPolicy(c: Q, org: string | null, o: { auto?: boolean; execution?: boolean } = {}): Promise<void> {
  const execution = o.execution ?? true;
  const auto = o.auto ?? true;
  const where = org === null ? 'organization_id IS NULL' : 'organization_id = $1';
  const params = org === null ? [] : [org];
  const { rows } = await c.query(`SELECT id, execution_enabled, auto_rules_enabled FROM public.community_ai_platform_policy WHERE ${where}`, params);
  if (rows.length === 0) {
    await c.query(
      `INSERT INTO public.community_ai_platform_policy (organization_id, tenant_id, execution_enabled, auto_rules_enabled, require_human_approval)
       VALUES ($1, $1, false, false, true)`, [org]);
  }
  if (!execution && !auto) {
    await c.query(`UPDATE public.community_ai_platform_policy SET execution_enabled = false, auto_rules_enabled = false WHERE ${where}`, params);
    return;
  }
  await c.query(
    `UPDATE public.community_ai_platform_policy
        SET requested_execution_enabled = $${params.length + 1}, requested_auto_rules_enabled = $${params.length + 2}, requested_by = $${params.length + 3}
      WHERE ${where}`, [...params, execution, auto, C3_REQUESTER]);
  await c.query(
    `UPDATE public.community_ai_platform_policy
        SET execution_enabled = $${params.length + 1}, auto_rules_enabled = $${params.length + 2}, updated_by = $${params.length + 3}
      WHERE ${where}`, [...params, execution, auto, C3_CONFIRMER]);
}

/** Open the platform row and the tenant row. */
export async function openTenant(c: Q, org: string, o: { auto?: boolean } = {}): Promise<void> {
  await openPolicy(c, null, { auto: true });
  await openPolicy(c, org, { auto: o.auto ?? true });
}

export type ApprovedActionOpts = {
  org: string;
  tenant?: string;
  status?: string;
  executionMode?: string;
  /** Age of the approval in milliseconds (back-date seam); default: stamped now. */
  ageMs?: number;
  /** Passkey verification offset from approved_at, ms (default -30 s). */
  passkeyOffsetMs?: number | null;
  hash?: string | null;
  approver?: string | null;
  /** Write the approve route's 'approved' log (default true). hash: undefined = the real binding hash. */
  log?: boolean;
  actionType?: string;
  targetId?: string;
  cancelRequested?: boolean;
  /** false: no approved_at at all (never approved). Default true. */
  approved?: boolean;
  /** The action's playbook (inside the binding hash). */
  playbookId?: string | null;
};

export async function approvedAction(c: Q, o: ApprovedActionOpts): Promise<{ id: string; approvedAt: string }> {
  const tenant = o.tenant ?? o.org;
  const approver = o.approver === undefined ? C3_APPROVER : o.approver;
  if (approver) await ensureUser(c, approver);
  if (o.ageMs !== undefined) {
    await c.query(`SET LOCAL omnivyra.community_action_test_backdate = 'i-am-a-test-fixture'`);
  }
  const target = o.targetId ?? `https://www.linkedin.com/feed/update/urn:li:activity:c3-${process.pid}-${Math.random().toString(36).slice(2)}/`;
  const offset = o.passkeyOffsetMs === undefined ? -30_000 : o.passkeyOffsetMs;
  const newId = randomUUID();
  const actionType = o.actionType ?? 'reply';
  const hash = o.hash === undefined
    ? bindingHashOf({ id: newId, tenant_id: tenant, organization_id: o.org, platform: 'linkedin', action_type: actionType,
        target_id: target, suggested_text: 'Thanks for sharing', playbook_id: o.playbookId ?? null })
    : o.hash;
  const { rows } = await c.query(
    `WITH t AS (SELECT date_trunc('milliseconds', clock_timestamp() - make_interval(secs => $9::double precision / 1000)) AS at)
     INSERT INTO public.community_ai_actions
       (id, tenant_id, organization_id, platform, action_type, target_id, suggested_text, status, execution_mode,
        requires_human_approval, risk_level, approved_at, approved_by, approved_content_hash,
        passkey_credential_id, passkey_verified_at, cancel_requested_at, playbook_id)
     SELECT $13, $1, $2, 'linkedin', $3, $4, 'Thanks for sharing', $5, $6, true, 'low', CASE WHEN $12 THEN t.at END, $7, $8,
            CASE WHEN $10::double precision IS NULL THEN NULL ELSE 'cred-c3' END,
            CASE WHEN $10::double precision IS NULL THEN NULL ELSE t.at + make_interval(secs => $10::double precision / 1000) END,
            CASE WHEN $11 THEN now() ELSE NULL END, $14::uuid
       FROM t
     RETURNING id, to_char(approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
    // An 'executing' row is inserted 'approved' and moved after its approval log
    // exists: the INSERT backstop judges the row as written.
    [tenant, o.org, actionType, target, o.status === 'executing' ? 'approved' : (o.status ?? 'approved'), o.executionMode ?? 'api', approver,
      o.approved === false ? null : hash, o.ageMs ?? 0, offset, !!o.cancelRequested, o.approved !== false, newId, o.playbookId ?? null]);
  if (o.ageMs !== undefined) {
    await c.query(`SET LOCAL omnivyra.community_action_test_backdate = ''`);
  }
  const { id, at } = rows[0];
  if (o.log !== false && approver) {
    await c.query(
      `INSERT INTO public.community_ai_action_logs (action_id, tenant_id, organization_id, event_type, event_payload)
       VALUES ($1, $2, $3, 'approved', $4::jsonb)`,
      [id, tenant, o.org, JSON.stringify({ approved: true, playbook_id: null, intent: null, user_id: approver, timestamp: at })]);
  }
  if (o.status === 'executing') {
    await c.query(`UPDATE public.community_ai_actions SET status = 'executing' WHERE id = $1`, [id]);
  }
  return { id, approvedAt: at };
}

/** The claim RPC, as the wrapper calls it. */
export async function claimRpc(c: Q, id: string, org: string, point = 'manual', tenant: string = org, mode: string | null = null)
  : Promise<{ claimed: boolean; code: string | null; current_status: string | null }> {
  const { rows } = await c.query(
    `SELECT * FROM public.claim_community_ai_action_for_execution($1, $2, $3, $4, $5, NULL)`, [id, org, tenant, point, mode]);
  return rows[0];
}

export async function browserClaimRpc(c: Q, id: string, org: string, lease = 'lease-1'): Promise<number> {
  const { rows } = await c.query(
    `SELECT * FROM public.claim_community_ai_browser_command($1, $2, $3, 'holder-1', 60)`, [id, org, lease]);
  return rows.length;
}

export async function refusalsOf(c: Q, id: string): Promise<Array<{ event_type: string; code: string; claim_point: string }>> {
  const { rows } = await c.query(
    `SELECT event_type, event_payload->>'code' AS code, event_payload->>'claim_point' AS claim_point
       FROM public.community_ai_action_logs WHERE action_id = $1 AND event_payload ? 'refusal_key' ORDER BY created_at, id`, [id]);
  return rows;
}

export async function logTypesOf(c: Q, id: string): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT event_type FROM public.community_ai_action_logs WHERE action_id = $1 ORDER BY created_at, id`, [id]);
  return rows.map((r: any) => r.event_type);
}

export async function statusOf(c: Q, id: string): Promise<string> {
  const { rows } = await c.query(`SELECT status FROM public.community_ai_actions WHERE id = $1`, [id]);
  return rows[0]?.status;
}
