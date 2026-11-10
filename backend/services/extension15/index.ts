/**
 * Extension 1.5.0 server service (docs/outreach/platform/EXTENSION-1.5.0-CONTRACT.md).
 *
 * Account binding (§3), server-issued READ commands (§4), the signed offer and
 * acknowledgment (§4), and result-time verification of a command (§5). Write
 * commands (li.comment.reply / li.reaction.like) are served from approved
 * community_ai_actions rows by the authorize-submit path, not from here.
 *
 * Every table access goes through the owned write seam. Every refusal is a
 * fixed code; no stored value is ever echoed.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { deriveExtensionHmacSecret } from '../extensionSessionService';
import { EXTENSION_V15_COMMAND_INGESTION_ENABLED } from '../extensionIngestionSuspension';
import { offerWriteCommands } from './writeCommands';
import {
  COMMAND_SCHEMA_VERSION_V15,
  signEnvelope,
  type CommandEnvelope,
  type ExtensionAction15,
} from '../../../lib/extension/envelope';

export type ExtSession = { userId: string; orgId: string; expiresAt: number; hmacNonce?: string };

export const READ_ACTIONS15 = [
  'li.collect.own_post_comments',
  'li.collect.own_inbox',
  'li.salesnav.capture_saved_leads',
] as const;
export type ReadAction15 = (typeof READ_ACTIONS15)[number];

/** E-3: DMs are not stored until PI's B-7 recipient proof exists, so the inbox command is never issued. */
export const DM_COLLECTION_ISSUABLE = false;
/**
 * E-2: Sales Navigator capture stays DARK until the owner accepts the LinkedIn-terms
 * risk in writing. Reading the page IS the risky act, so the gate sits at issuance,
 * before any page is read. Flip only together with PI's SALESNAV_EXTENSION_CAPTURE_ENABLED.
 */
export const SALESNAV_CAPTURE_ISSUABLE = false;

export const COMMAND_TTL_MS = 10 * 60 * 1000;
const MEMBER_URN = /^urn:li:fsd_profile:[A-Za-z0-9_-]{6,128}$/;
const POST_URN = /^urn:li:(activity|ugcPost|share):[0-9A-Za-z_-]{1,64}$/;

export type Refusal = { ok: false; status: number; code: string };
const refuse = (status: number, code: string): Refusal => ({ ok: false, status, code });

// ── bindings (§3) ────────────────────────────────────────────────────────────

export async function getActiveBinding(orgId: string, userId: string): Promise<{ ok: true; urn: string | null } | Refusal> {
  // Never throws: the 1.4 command route calls this too, and an exception there would
  // fail that route instead of leaving 1.4 behaviour unchanged.
  try {
    return await readActiveBinding(orgId, userId);
  } catch {
    return refuse(503, 'BINDING_UNREADABLE');
  }
}

async function readActiveBinding(orgId: string, userId: string): Promise<{ ok: true; urn: string | null } | Refusal> {
  const { data, error } = await ownedDbTable('extension_account_bindings')
    .select('acting_member_urn')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('platform', 'linkedin')
    .is('revoked_at', null)
    .maybeSingle();
  // A null error with no data is NOT proof of absence (postgrest-js rewrites a
  // blank 404); only a successful read with data null is.
  if (error) return refuse(503, 'BINDING_UNREADABLE');
  return { ok: true, urn: (data as { acting_member_urn?: string } | null)?.acting_member_urn ?? null };
}

export async function bindAccount(session: ExtSession, actingMemberUrn: unknown):
  Promise<{ ok: true; created: boolean } | Refusal> {
  if (typeof actingMemberUrn !== 'string' || !MEMBER_URN.test(actingMemberUrn)) return refuse(400, 'INVALID_MEMBER_URN');
  const current = await getActiveBinding(session.orgId, session.userId);
  if (current.ok !== true) return current;
  if (current.urn === actingMemberUrn) return { ok: true, created: false };
  if (current.urn) return refuse(409, 'ACCOUNT_BINDING_CONFLICT');
  const { error } = await ownedDbTable('extension_account_bindings').insert({
    org_id: session.orgId, user_id: session.userId, platform: 'linkedin', acting_member_urn: actingMemberUrn,
  });
  if (error) {
    // A concurrent bind won the unique index: re-read and decide, never assume.
    const again = await getActiveBinding(session.orgId, session.userId);
    if (again.ok !== true) return again;
    if (again.urn === actingMemberUrn) return { ok: true, created: false };
    return refuse(409, 'ACCOUNT_BINDING_CONFLICT');
  }
  return { ok: true, created: true };
}

// ── issuance (§4; called from an Omnivyra UI action, never a background job) ──

export function validateReadParams(action: ReadAction15, params: unknown): { ok: true; params: Record<string, unknown> } | Refusal {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const allowed: Record<ReadAction15, string[]> = {
    'li.collect.own_post_comments': ['post_urns', 'max_items'],
    'li.collect.own_inbox': ['max_threads'],
    'li.salesnav.capture_saved_leads': ['list_kind', 'max_leads'],
  };
  for (const k of Object.keys(p)) if (!allowed[action].includes(k)) return refuse(400, 'UNKNOWN_PARAM');
  const int = (v: unknown, lo: number, hi: number, dflt: number) =>
    v === undefined ? dflt : (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : NaN);
  if (action === 'li.collect.own_post_comments') {
    const max = int(p.max_items, 1, 200, 100);
    if (Number.isNaN(max)) return refuse(400, 'INVALID_PARAM');
    const urns = p.post_urns;
    if (urns !== undefined && (!Array.isArray(urns) || urns.length > 10 || urns.some((u) => typeof u !== 'string' || !POST_URN.test(u)))) {
      return refuse(400, 'INVALID_PARAM');
    }
    return { ok: true, params: { max_items: max, ...(urns ? { post_urns: urns } : {}) } };
  }
  if (action === 'li.collect.own_inbox') {
    const max = int(p.max_threads, 1, 20, 20);
    return Number.isNaN(max) ? refuse(400, 'INVALID_PARAM') : { ok: true, params: { max_threads: max } };
  }
  const kind = p.list_kind ?? 'saved_leads';
  const max = int(p.max_leads, 1, 25, 25);
  if (!['saved_leads', 'lead_list'].includes(kind as string) || Number.isNaN(max)) return refuse(400, 'INVALID_PARAM');
  return { ok: true, params: { list_kind: kind, max_leads: max } };
}

export async function issueReadCommand(input: { orgId: string; userId: string; action: unknown; params?: unknown; now?: number }):
  Promise<{ ok: true; commandId: string } | Refusal> {
  if (!READ_ACTIONS15.includes(input.action as ReadAction15)) return refuse(400, 'UNKNOWN_ACTION');
  const action = input.action as ReadAction15;
  if (action !== 'li.salesnav.capture_saved_leads' && !EXTENSION_V15_COMMAND_INGESTION_ENABLED) {
    return refuse(403, 'BROWSER_SYNC_SUSPENDED');
  }
  if (action === 'li.collect.own_inbox' && !DM_COLLECTION_ISSUABLE) return refuse(403, 'DM_STORAGE_DISABLED');
  if (action === 'li.salesnav.capture_saved_leads' && !SALESNAV_CAPTURE_ISSUABLE) return refuse(403, 'SALESNAV_CAPTURE_DISABLED');
  const v = validateReadParams(action, input.params);
  if (v.ok !== true) return v;
  const binding = await getActiveBinding(input.orgId, input.userId);
  if (binding.ok !== true) return binding;
  if (!binding.urn) return refuse(409, 'NO_ACCOUNT_BINDING');
  const now = input.now ?? Date.now();
  const { data, error } = await ownedDbTable('extension_commands')
    .insert({
      org_id: input.orgId,
      user_id: input.userId,
      platform: 'linkedin',
      action_type: action,
      target_id: binding.urn,
      payload: { v15: true, action, params: v.params, acting_member_urn: binding.urn, expires_at: now + COMMAND_TTL_MS },
      status: 'pending',
      max_retries: 0,
      expires_at: new Date(now + COMMAND_TTL_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error || !(data as { id?: string } | null)?.id) return refuse(503, 'COMMAND_NOT_ISSUED');
  return { ok: true, commandId: (data as { id: string }).id };
}

// ── offer + acknowledgment (§4) ──────────────────────────────────────────────

type CommandRow = {
  id: string; org_id: string; user_id: string; status: string; action_type: string;
  payload: { v15?: boolean; action?: string; params?: Record<string, unknown>; acting_member_urn?: string; expires_at?: number } | null;
};

export async function offerCommands(session: ExtSession, now: number = Date.now()):
  Promise<{ ok: true; commands: Array<{ envelope: CommandEnvelope; envelope_signature: string }> } | Refusal> {
  if (!session.hmacNonce) return refuse(401, 'SESSION_MISSING_HMAC_NONCE');
  const binding = await getActiveBinding(session.orgId, session.userId);
  if (binding.ok !== true) return binding;
  if (!binding.urn) return { ok: true, commands: [] };
  const { data, error } = await ownedDbTable('extension_commands')
    .select('id, org_id, user_id, status, action_type, payload')
    .eq('org_id', session.orgId)
    .eq('user_id', session.userId)
    .eq('status', 'pending')
    .gt('expires_at', new Date(now).toISOString())
    .order('created_at', { ascending: true })
    .limit(5);
  if (error) return refuse(503, 'COMMANDS_UNREADABLE');
  const secret = deriveExtensionHmacSecret({ ...session, nonce: session.hmacNonce } as never);
  const commands = ((data as CommandRow[] | null) ?? [])
    .filter((r) => r.payload?.v15 === true
      && READ_ACTIONS15.includes(r.payload.action as ReadAction15)
      && r.payload.acting_member_urn === binding.urn
      && typeof r.payload.expires_at === 'number' && r.payload.expires_at > now)
    .map((r) => {
      const envelope: CommandEnvelope = {
        command_id: r.id,
        schema_version: COMMAND_SCHEMA_VERSION_V15,
        org_id: r.org_id,
        user_id: r.user_id,
        platform: 'linkedin',
        acting_member_urn: binding.urn as string,
        action: r.payload!.action as ExtensionAction15,
        params: r.payload!.params ?? {},
        expires_at: r.payload!.expires_at as number,
      };
      return { envelope, envelope_signature: signEnvelope(envelope, secret) };
    });
  // Approved write actions (reply/like) on the bound member's own content, claimed
  // through the unchanged claim RPC (see writeCommands.ts).
  const writes = await offerWriteCommands(session, binding.urn, now);
  return { ok: true, commands: [...commands, ...writes] };
}

/** pending → dispatched, once, by compare-and-set. */
export async function acknowledgeCommand(session: ExtSession, commandId: unknown, now: number = Date.now()):
  Promise<{ ok: true } | Refusal> {
  if (typeof commandId !== 'string' || !commandId) return refuse(400, 'COMMAND_ID_REQUIRED');
  const loaded = await loadOwnCommand(session, commandId, now);
  if (loaded.ok !== true) return loaded;
  if (loaded.row.status !== 'pending') return refuse(409, 'COMMAND_NOT_PENDING');
  const { data, error } = await ownedDbTable('extension_commands')
    .update({ status: 'dispatched', updated_at: new Date(now).toISOString() })
    .eq('id', commandId)
    .eq('org_id', session.orgId)
    .eq('user_id', session.userId)
    .eq('status', 'pending')
    .select('id');
  if (error) return refuse(503, 'ACK_NOT_PERSISTED');
  if (!Array.isArray(data) || data.length !== 1) return refuse(409, 'COMMAND_NOT_PENDING');
  return { ok: true };
}

async function loadOwnCommand(session: ExtSession, commandId: string, now: number):
  Promise<{ ok: true; row: CommandRow; urn: string } | Refusal> {
  const { data, error } = await ownedDbTable('extension_commands')
    .select('id, org_id, user_id, status, action_type, payload')
    .eq('id', commandId)
    .maybeSingle();
  if (error) return refuse(503, 'COMMAND_UNREADABLE');
  const row = data as CommandRow | null;
  if (!row || row.payload?.v15 !== true) return refuse(404, 'COMMAND_NOT_FOUND');
  if (row.org_id !== session.orgId || row.user_id !== session.userId) return refuse(404, 'COMMAND_NOT_FOUND');
  if (typeof row.payload.expires_at !== 'number' || row.payload.expires_at <= now) return refuse(409, 'COMMAND_EXPIRED');
  const binding = await getActiveBinding(session.orgId, session.userId);
  if (binding.ok !== true) return binding;
  if (!binding.urn || binding.urn !== row.payload.acting_member_urn) return refuse(409, 'BINDING_MISMATCH');
  return { ok: true, row, urn: binding.urn };
}

/**
 * Result-time check (§5): the command exists, belongs to this session, is
 * dispatched, unexpired, of the expected action, and still matches the binding.
 */
export async function verifyResultCommand(session: ExtSession, commandId: unknown, expected: ReadAction15, now: number = Date.now()):
  Promise<{ ok: true; actingMemberUrn: string; params: Record<string, unknown> } | Refusal> {
  if (typeof commandId !== 'string' || !commandId) return refuse(400, 'COMMAND_ID_REQUIRED');
  const loaded = await loadOwnCommand(session, commandId, now);
  if (loaded.ok !== true) return loaded;
  if (loaded.row.payload?.action !== expected) return refuse(409, 'COMMAND_ACTION_MISMATCH');
  if (loaded.row.status !== 'dispatched') return refuse(409, 'COMMAND_NOT_DISPATCHED');
  return { ok: true, actingMemberUrn: loaded.urn, params: loaded.row.payload?.params ?? {} };
}

/**
 * The extension's own verdict on a dispatched READ command it could not complete
 * (envelope or parameter refusal, no open tab, unreadable member, …): a fixed code,
 * never page content. Write commands report through /api/extension/action-result.
 */
export async function reportReadCommandOutcome(session: ExtSession, body: Record<string, unknown>, now: number = Date.now()):
  Promise<{ ok: true } | Refusal> {
  const status = body.status;
  if (status !== 'refused' && status !== 'failed') return refuse(400, 'INVALID_STATUS');
  const code = typeof body.error_code === 'string' && /^[A-Z0-9_]{1,64}$/.test(body.error_code) ? body.error_code : 'UNSPECIFIED';
  const id = body.command_id;
  if (typeof id !== 'string' || !id) return refuse(400, 'COMMAND_ID_REQUIRED');
  const loaded = await loadOwnCommand(session, id, now);
  if (loaded.ok !== true) return loaded;
  if (loaded.row.status !== 'dispatched') return refuse(409, 'COMMAND_NOT_DISPATCHED');
  return finishCommand(session, id, status, { code }, now);
}

/** dispatched → completed | failed | refused, once. The result is a fixed summary, never page content. */
export async function finishCommand(session: ExtSession, commandId: string, status: 'completed' | 'failed' | 'refused',
  summary: Record<string, number | string | boolean>, now: number = Date.now()): Promise<{ ok: true } | Refusal> {
  const { data, error } = await ownedDbTable('extension_commands')
    .update({ status, result: summary, executed_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
    .eq('id', commandId)
    .eq('org_id', session.orgId)
    .eq('user_id', session.userId)
    .eq('status', 'dispatched')
    .select('id');
  if (error) return refuse(503, 'RESULT_NOT_PERSISTED');
  if (!Array.isArray(data) || data.length !== 1) return refuse(409, 'COMMAND_NOT_DISPATCHED');
  return { ok: true };
}
