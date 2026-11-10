/**
 * Extension 1.5 write commands: approved LinkedIn replies and likes
 * (EXTENSION-1.5.0-CONTRACT.md §4, §5.4; design agreed with Orchestration).
 *
 * REUSES the approved-action path, never forks it:
 * - the claim is claim_community_ai_browser_command (approval evidence CAS, kill
 *   switch, tenant, lease), unchanged;
 * - the result goes through the existing /api/extension/action-result, with its
 *   post-submit rule;
 * - the last gate before the click is authorize_extension_submit (SQL, one row lock).
 * This module only adds the v15 filtering (an active binding; own content BEFORE
 * claiming, so an action is never leased to an extension that cannot execute it)
 * and the signed envelope.
 */
import { createHash } from 'crypto';
import { ownedDbTable, ownedDbRpc } from '../../db/writeOwner';
import { deriveExtensionHmacSecret } from '../extensionSessionService';
import { COMMAND_SCHEMA_VERSION_V15, signEnvelope, type CommandEnvelope } from '../../../lib/extension/envelope';
import type { ExtSession } from './index';

/** Same as pages/api/extension/commands.ts and action-result.ts (the lease holder of this session). */
export function deriveLeaseHolderId(session: { userId: string; orgId: string; hmacNonce: string }): string {
  return createHash('sha256').update(`lease-holder:${session.userId}:${session.orgId}:${session.hmacNonce}`).digest('hex').slice(0, 32);
}

export const WRITE_LEASE_TTL_SECONDS = 90;
const MAX_WRITE_OFFERS = 3;

type ActionRow = {
  id: string; organization_id: string; action_type: string; target_id: string | null;
  suggested_text: string | null; execution_correlation_id: string | null;
};

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The target's post when it is the bound member's own (1.5-collected) content, else null. */
async function ownPostOf(orgId: string, targetId: string, memberUrn: string): Promise<string | null> {
  const { data: msg, error } = await ownedDbTable('engagement_messages')
    .select('thread_id')
    .eq('organization_id', orgId)
    .eq('platform', 'linkedin')
    .eq('platform_message_id', targetId)
    .maybeSingle();
  if (error || !(msg as { thread_id?: string } | null)?.thread_id) return null;
  const { data: thread, error: tErr } = await ownedDbTable('engagement_threads')
    .select('platform_thread_id, raw_payload')
    .eq('id', (msg as { thread_id: string }).thread_id)
    .eq('organization_id', orgId)
    .eq('platform', 'linkedin')
    .maybeSingle();
  if (tErr || !thread) return null;
  const t = thread as { platform_thread_id?: string; raw_payload?: Record<string, unknown> | null };
  if (t.raw_payload?.ingested_via !== 'extension_v15' || t.raw_payload?.post_author_urn !== memberUrn) return null;
  return t.platform_thread_id ?? null;
}

/**
 * Claims up to MAX_WRITE_OFFERS approved LinkedIn reply/like actions that target the
 * bound member's own content, and returns their signed envelopes. A claim RPC error
 * fails closed (the action is not offered), as in the 1.4 route.
 */
export async function offerWriteCommands(session: ExtSession, memberUrn: string, now: number = Date.now()):
  Promise<Array<{ envelope: CommandEnvelope; envelope_signature: string }>> {
  if (!session.hmacNonce) return [];
  const { data, error } = await ownedDbTable('community_ai_actions')
    .select('id, organization_id, action_type, target_id, suggested_text, execution_correlation_id')
    .eq('organization_id', session.orgId)
    .eq('platform', 'linkedin')
    .eq('execution_mode', 'browser')
    .eq('status', 'pending')
    .in('action_type', ['reply', 'like'])
    .is('dispatch_lease_id', null)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error || !Array.isArray(data)) return [];
  const holderId = deriveLeaseHolderId(session as { userId: string; orgId: string; hmacNonce: string });
  const secret = deriveExtensionHmacSecret({ ...session, nonce: session.hmacNonce } as never);
  const out: Array<{ envelope: CommandEnvelope; envelope_signature: string }> = [];
  for (const row of data as ActionRow[]) {
    if (out.length >= MAX_WRITE_OFFERS) break;
    if (!row.target_id) continue;
    if (row.action_type === 'reply' && (!row.suggested_text || row.suggested_text.trim() === '')) continue;
    const postUrn = await ownPostOf(session.orgId, row.target_id, memberUrn);
    if (!postUrn) continue; // not this member's own 1.5 content: never leased to this extension
    const leaseId = `v15-${row.id}-${now}`;
    const { data: claimed, error: claimErr } = await ownedDbRpc('claim_community_ai_browser_command', {
      p_action_id: row.id,
      p_organization_id: session.orgId,
      p_lease_id: leaseId,
      p_holder_id: holderId,
      p_lease_ttl_seconds: WRITE_LEASE_TTL_SECONDS,
    });
    const c = (Array.isArray(claimed) ? claimed[0] : claimed) as { id?: string; dispatch_lease_expires_at?: string } | null;
    if (claimErr || !c?.id) continue;
    const leaseExpires = c.dispatch_lease_expires_at ? Date.parse(c.dispatch_lease_expires_at) : now + WRITE_LEASE_TTL_SECONDS * 1000;
    const isReply = row.action_type === 'reply';
    const envelope: CommandEnvelope = {
      command_id: row.id,
      schema_version: COMMAND_SCHEMA_VERSION_V15,
      org_id: session.orgId,
      user_id: session.userId,
      platform: 'linkedin',
      acting_member_urn: memberUrn,
      action: isReply ? 'li.comment.reply' : 'li.reaction.like',
      params: {
        lease_id: leaseId,
        correlation_id: row.execution_correlation_id ?? null,
        ...(isReply ? { text: row.suggested_text } : {}),
      },
      expires_at: leaseExpires,
      approval_id: row.id,
      ...(isReply ? { text_sha256: sha256Hex(row.suggested_text as string) } : {}),
      target: isReply
        ? { post_urn: postUrn, parent_comment_urn: row.target_id }
        : { post_urn: postUrn, comment_urn: row.target_id },
    };
    out.push({ envelope, envelope_signature: signEnvelope(envelope, secret) });
  }
  return out;
}

export type SubmitRefusal = { ok: false; status: number; code: string };

/** The last gate before the click (authorize_extension_submit). NULL from SQL means authorized. */
export async function authorizeSubmit(session: ExtSession, memberUrn: string, body: Record<string, unknown>):
  Promise<{ ok: true } | SubmitRefusal> {
  if (!session.hmacNonce) return { ok: false, status: 401, code: 'SESSION_MISSING_HMAC_NONCE' };
  const actionId = typeof body.command_id === 'string' ? body.command_id : '';
  const leaseId = typeof body.lease_id === 'string' ? body.lease_id : '';
  const textSha = typeof body.text_sha256 === 'string' ? body.text_sha256 : null;
  if (!actionId || !leaseId) return { ok: false, status: 400, code: 'COMMAND_AND_LEASE_REQUIRED' };
  const { data, error } = await ownedDbRpc('authorize_extension_submit', {
    p_action_id: actionId,
    p_organization_id: session.orgId,
    p_lease_id: leaseId,
    p_holder_id: deriveLeaseHolderId(session as { userId: string; orgId: string; hmacNonce: string }),
    p_user_id: session.userId,
    p_text_sha256: textSha,
    p_acting_member_urn: memberUrn,
  });
  // An RPC error is NOT authorization: the extension must not click (it reports
  // uncertain only if it cannot know whether submit_attempted_at was written).
  if (error) return { ok: false, status: 503, code: 'AUTHORIZE_UNAVAILABLE' };
  const code = Array.isArray(data) ? (data[0] as unknown) : data;
  if (code === null || code === undefined) return { ok: true };
  return { ok: false, status: 409, code: String(code) };
}
