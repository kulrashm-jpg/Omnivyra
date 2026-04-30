/**
 * GET /api/extension/commands
 *
 * Returns the set of pending browser-assisted commands for the caller's
 * (user, org). Only commands whose (platform, action) pair is verified or
 * partial in the capability map are emitted. Anything else is skipped at
 * dispatch — the extension will never see an unsupported command.
 *
 * Correctness contract:
 *  - Validation (capability + payload schema) runs BEFORE the CAS claim, so
 *    a permanently-invalid row does not get claimed-and-dropped on every
 *    90-second cycle.
 *  - On claim, the row transitions pending → dispatched and stamps
 *    dispatch_lease_id, dispatch_lease_expires_at, dispatch_lease_holder_id.
 *    Only the same holder (derived from session) may submit the result.
 *
 * Response:
 *   { success: true, commands: Command[] }
 * where Command = { id, platform, action, payload, metadata, created_at }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import { supabase } from '@/backend/db/supabaseClient';
import { resolveEngagementCapability, CAPABILITY_MAP_VERSION } from '@/backend/services/engagementCapabilityMap';
import { isCurrentlyDisabled } from '@/backend/services/extensionReliabilityService';
import { validateCommandPayload, COMMAND_SCHEMA_VERSION } from '@/backend/services/extensionCommandSchema';
import { recordExecutionMetric } from '@/backend/services/communityAiActionExecutor';
import { resolveAccountTier } from '@/backend/services/rpaWorker/rpaAccountTier';

const LEASE_TTL_SECONDS = 90; // longer than the extension's 30s handler timeout + retries

const EXTENSION_ACTION_BY_PAIR: Record<string, string> = {
  reply: 'reply_comment',
  like: 'like_message',
  dm: 'continue_thread',
  post_create: 'create_post',
  // DM orchestration step names are already extension-native; allow
  // passthrough so command_chain steps resolve to themselves.
  open_thread: 'open_thread',
  continue_thread: 'continue_thread',
  search_user: 'search_user',
  start_new_dm: 'start_new_dm',
  sync_dm_inbox: 'sync_dm_inbox',
};

function mapCapabilityActionToExtensionAction(capabilityAction: string): string | null {
  return EXTENSION_ACTION_BY_PAIR[capabilityAction] || null;
}

/**
 * Derive a stable lease-holder id from the session. The hmac nonce is issued
 * per session at bootstrap time, so two concurrent extension service workers
 * holding distinct sessions will never share a holder id.
 *
 * Sessions missing an `hmacNonce` would collide across extensions, so the
 * caller MUST reject them before reaching here.
 */
function deriveHolderId(session: { userId: string; orgId: string; hmacNonce: string }): string {
  const basis = `${session.userId}:${session.orgId}:${session.hmacNonce}`;
  return createHash('sha256').update(`lease-holder:${basis}`).digest('hex').slice(0, 32);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return handleAck(req, res);
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;

  // Lease-holder derivation requires a per-session hmac nonce. Sessions
  // issued before nonce-binding shipped would collide across extensions.
  if (!session.hmacNonce) {
    return res.status(401).json({ success: false, error: 'INVALID_SESSION', reason: 'SESSION_MISSING_HMAC_NONCE' });
  }

  const clientCapabilityVersion = String(req.headers['x-omnivyra-capability-version'] || '').trim();
  if (!clientCapabilityVersion) {
    return res.status(400).json({ success: false, error: 'MISSING_CAPABILITY_VERSION' });
  }
  if (clientCapabilityVersion !== CAPABILITY_MAP_VERSION) {
    return res.status(409).json({
      success: false,
      error: 'CAPABILITY_VERSION_MISMATCH',
      server_version: CAPABILITY_MAP_VERSION,
      client_version: clientCapabilityVersion,
    });
  }

  // Heartbeat: a successful auth + capability check past this point means
  // the extension is alive and polling. Stamp extension_sessions.last_seen
  // so the platform-health badge can flip from 'unverified' to 'ok' as
  // soon as the extension is loaded — not only after a successful action.
  // Best-effort: failures here must not block command dispatch.
  //
  // The table has no unique index on (user_id, org_id), so we can't use
  // upsert-on-conflict. Pattern: UPDATE → if zero rows matched, INSERT.
  void (async () => {
    try {
      const nowTs = new Date().toISOString();
      const { data: updated } = await supabase
        .from('extension_sessions')
        .update({ last_seen: nowTs, updated_at: nowTs })
        .eq('user_id', session.userId)
        .eq('org_id', session.orgId)
        .select('id')
        .limit(1);

      if (!updated || updated.length === 0) {
        // No prior session row for this (user, org) — likely the first
        // poll under DEV_EXTENSION_AUTH_BYPASS, where no real redeem ever
        // ran. Insert a minimal heartbeat row so subsequent polls can
        // UPDATE it cleanly.
        const tokenForRow = `heartbeat:${session.userId}:${session.orgId}`;
        await supabase.from('extension_sessions').insert({
          user_id: session.userId,
          org_id: session.orgId,
          session_token: tokenForRow,
          last_seen: nowTs,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          created_at: nowTs,
          updated_at: nowTs,
        });
      }
    } catch (hbErr) {
      // Heartbeat is opportunistic. If a constraint or race means we
      // can't write, swallow — the command flow still works.
      console.warn('[extension/commands] heartbeat write skipped:', (hbErr as Error)?.message);
    }
  })();

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('community_ai_actions')
      .select('id, platform, action_type, target_id, suggested_text, execution_mode, created_at, dispatch_lease_expires_at, execution_correlation_id, command_chain, command_chain_index')
      .eq('organization_id', session.orgId)
      .eq('status', 'pending')
      .eq('execution_mode', 'browser')
      .or(`dispatch_lease_expires_at.is.null,dispatch_lease_expires_at.lt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[extension/commands] supabase error:', error.message);
      return res.status(500).json({ success: false, error: 'COMMANDS_QUERY_FAILED' });
    }

    const holderId = deriveHolderId({
      userId: session.userId,
      orgId: session.orgId,
      hmacNonce: session.hmacNonce as string,
    });
    const leaseId = `lease-${randomBytes(8).toString('hex')}`;
    const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_SECONDS * 1000).toISOString();
    const commands: any[] = [];

    for (const row of data || []) {
      // ── Chain-aware step selection ────────────────────────────────────────
      // When the row carries a command_chain, dispatch the step at
      // command_chain_index instead of the row's top-level action_type.
      // The DM orchestration path uses this to emit open_thread first,
      // then continue_thread after /action-result advances the index.
      const chain = Array.isArray((row as any).command_chain)
        ? ((row as any).command_chain as Array<{ action_type: string; payload?: Record<string, unknown> }>)
        : null;
      const chainIndex = Number((row as any).command_chain_index ?? 0);
      const currentStep = chain && chain[chainIndex] ? chain[chainIndex] : null;

      // ── Validate BEFORE claim ─────────────────────────────────────────────
      const topAction = String(row.action_type || '').toLowerCase();
      const capabilityAction = currentStep
        ? String(currentStep.action_type || '').toLowerCase()
        : topAction;

      // Capability gate still uses the ROW's action_type (e.g. 'dm') —
      // chain steps are internal orchestration. The top action must be
      // api_verified; orchestration steps are always dispatchable once
      // the parent pair is.
      const cap = resolveEngagementCapability(row.platform, topAction as any);
      if (cap.status !== 'api_verified') continue;
      if (isCurrentlyDisabled(row.platform, topAction)) continue;

      // Instagram DM business-tier enforcement. Instagram Direct is only
      // usable on business accounts via the browser runtime; dispatch a
      // DM command to a non-business tier would guarantee failure at the
      // composer. We short-circuit here so the command never gets claimed.
      if (row.platform === 'instagram' && capabilityAction === 'dm') {
        const tier = await resolveAccountTier({
          organization_id: session.orgId,
          platform: 'instagram',
          action_metadata: null,
        });
        if (tier !== 'business') {
          console.warn('[extension/commands] instagram DM rejected: tier=', tier, 'actionId=', row.id);
          // Mark the row failed via the central pipeline so it doesn't
          // keep getting considered. A correlation id is generated by
          // the executor's persist helper to satisfy the audit trigger.
          try {
            const { persistExecutionResult } = await import('@/backend/services/communityAiActionExecutor');
            const { randomUUID } = await import('crypto');
            await persistExecutionResult({
              actionId: row.id,
              organizationId: session.orgId,
              correlationId: randomUUID(),
              result: {
                ok: false,
                status: 'failed',
                error: 'ACCOUNT_TYPE_NOT_SUPPORTED',
                response: { source: 'executor', reason: 'instagram_dm_requires_business_tier', detected_tier: tier ?? 'unknown' },
                execution_mode: 'browser',
              },
              rowHint: { platform: 'instagram', action_type: 'dm', target_id: row.target_id ?? null },
            });
          } catch (err: any) {
            console.warn('[extension/commands] tier-rejection persist failed:', err?.message || err);
          }
          continue;
        }
      }

      const extensionAction = mapCapabilityActionToExtensionAction(capabilityAction);
      if (!extensionAction) continue;

      const platformSlug = row.platform === 'x' ? 'twitter' : row.platform;
      // Chain-step payload takes precedence when present. The default
      // payload (used by single-step pairs: reply / like / post_create /
      // continue_thread without chain) is the legacy text+threadId shape.
      const rawPayload: Record<string, unknown> = currentStep?.payload
        ? { ...currentStep.payload }
        : {
            text: row.suggested_text ?? undefined,
            autoSubmit: true,
            threadId: row.target_id ?? undefined,
          };
      const validation = validateCommandPayload(platformSlug, extensionAction, rawPayload);
      if (validation.ok !== true) {
        const bad = validation as { code: string; message: string };
        console.warn('[extension/commands] payload validation failed:', platformSlug, extensionAction, bad.code, bad.message);
        try {
          const { persistExecutionResult } = await import('@/backend/services/communityAiActionExecutor');
          await persistExecutionResult({
            actionId: row.id,
            organizationId: session.orgId,
            correlationId: (row as any).execution_correlation_id ?? randomUUID(),
            result: {
              ok: false,
              status: 'failed',
              error: bad.code || 'INVALID_COMMAND_PAYLOAD',
              response: {
                source: 'extension_commands',
                reason: 'payload_validation_failed',
                message: bad.message,
              },
              execution_mode: 'browser',
            },
            rowHint: {
              platform: row.platform ?? null,
              action_type: row.action_type ?? null,
              target_id: row.target_id ?? null,
            },
          });
        } catch (persistErr: any) {
          console.warn('[extension/commands] payload validation failure persist failed:', persistErr?.message || persistErr);
        }
        continue;
      }

      // ── Claim via CAS on (id, prior lease expiry, status=pending) ────────
      const priorExpiry = (row as any).dispatch_lease_expires_at as string | null;
      let update = supabase
        .from('community_ai_actions')
        .update({
          dispatch_lease_id: leaseId,
          dispatch_lease_expires_at: leaseExpiresAt,
          dispatch_lease_holder_id: holderId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending');
      update = priorExpiry == null
        ? update.is('dispatch_lease_expires_at', null)
        : update.eq('dispatch_lease_expires_at', priorExpiry);

      const { data: claimed, error: claimErr } = await update.select('id').maybeSingle();
      if (claimErr) {
        console.warn('[extension/commands] claim update failed for', row.id, claimErr.message);
        continue;
      }
      if (!claimed || !claimed.id) continue; // another worker won the claim

      commands.push({
        id: row.id,
        platform: platformSlug,
        action: extensionAction,
        schema_version: COMMAND_SCHEMA_VERSION,
        payload: validation.payload,
        metadata: null,
        created_at: row.created_at,
        // Lifecycle correlation id — must be echoed back on /action-result
        // so the backend can verify the ack belongs to this lifecycle and
        // so logs/metrics across execute → dispatch → ack → result join cleanly.
        execution_correlation_id: (row as any).execution_correlation_id ?? null,
        // Chain state — the extension echoes these back on /action-result
        // so the server can deterministically advance the chain.
        chain_total: chain ? chain.length : 0,
        chain_index: chain ? chainIndex : 0,
        is_final_step: !chain || chainIndex >= chain.length - 1,
        lease: {
          id: leaseId,
          expires_at: leaseExpiresAt,
        },
      });
    }

    return res.status(200).json({ success: true, commands });
  } catch (error) {
    console.error('[extension/commands]', error);
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'commands failed' });
  }
}

/**
 * POST /api/extension/commands  — body: { commandId, leaseId }
 *
 * DISPATCHED → ACKNOWLEDGED transition. The extension calls this immediately
 * after receiving a claim batch so the backend can distinguish "claimed and
 * received" from "claimed but never reached the extension" (e.g. lost HTTP
 * response). Only the session whose derived holder_id matches the row's
 * dispatch_lease_holder_id may ack.
 *
 * Safe to call repeatedly: an already-acknowledged row returns idempotently.
 */
async function handleAck(req: NextApiRequest, res: NextApiResponse) {
  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;

  if (!session.hmacNonce) {
    return res.status(401).json({ success: false, error: 'INVALID_SESSION', reason: 'SESSION_MISSING_HMAC_NONCE' });
  }

  const body = (req.body || {}) as { commandId?: string; command_id?: string; leaseId?: string; lease_id?: string };
  const commandId = String(body.commandId || body.command_id || '').trim();
  const submittedLeaseId = String(body.leaseId || body.lease_id || '').trim();
  if (!commandId) return res.status(400).json({ success: false, error: 'commandId required' });
  if (!submittedLeaseId) return res.status(400).json({ success: false, error: 'leaseId required' });

  const holderId = deriveHolderId({
    userId: session.userId,
    orgId: session.orgId,
    hmacNonce: session.hmacNonce as string,
  });

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('community_ai_actions')
      .select('id, organization_id, status, dispatch_lease_id, dispatch_lease_holder_id, dispatch_lease_expires_at, dispatch_acknowledged_at')
      .eq('id', commandId)
      .maybeSingle();
    if (fetchError || !existing) {
      return res.status(404).json({ success: false, error: 'COMMAND_NOT_FOUND' });
    }
    if (existing.organization_id !== session.orgId) {
      return res.status(403).json({ success: false, error: 'TENANT_SCOPE_VIOLATION' });
    }

    // Idempotent: already acknowledged or already progressed past ack.
    if ((existing as any).dispatch_acknowledged_at) {
      return res.status(200).json({ success: true, idempotent: true, status: existing.status });
    }
    if (existing.status === 'executing' || existing.status === 'executed' || existing.status === 'sent_unverified' || existing.status === 'failed') {
      return res.status(200).json({ success: true, idempotent: true, status: existing.status });
    }
    // This deployment keeps leased browser commands as `pending` because the
    // DB status constraint does not include dispatched/acknowledged. The lease
    // fields, not the status value, prove ownership.
    if (existing.status !== 'pending' && existing.status !== 'dispatched') {
      return res.status(409).json({ success: false, error: 'INVALID_STATE', current_status: existing.status });
    }

    const rowHolderId = (existing as any).dispatch_lease_holder_id as string | null;
    const rowLeaseId = (existing as any).dispatch_lease_id as string | null;
    const rowLeaseExpiresAt = (existing as any).dispatch_lease_expires_at as string | null;

    if (!rowLeaseId || !rowHolderId) {
      return res.status(409).json({ success: false, error: 'NO_ACTIVE_LEASE' });
    }
    if (rowHolderId !== holderId) {
      return res.status(409).json({ success: false, error: 'LEASE_HOLDER_MISMATCH' });
    }
    if (rowLeaseId !== submittedLeaseId) {
      return res.status(409).json({ success: false, error: 'LEASE_ID_MISMATCH' });
    }
    if (rowLeaseExpiresAt && new Date(rowLeaseExpiresAt).getTime() < Date.now()) {
      return res.status(409).json({ success: false, error: 'LEASE_EXPIRED' });
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('community_ai_actions')
      .update({
        dispatch_acknowledged_at: now,
        updated_at: now,
      })
      .eq('id', commandId)
      .eq('status', existing.status)
      .eq('dispatch_lease_id', rowLeaseId)
      .eq('dispatch_lease_holder_id', rowHolderId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[extension/commands][ack] update failed:', updateError.message);
      return res.status(500).json({ success: false, error: 'ACK_PERSIST_FAILED' });
    }
    if (!updated) {
      return res.status(409).json({ success: false, error: 'STATE_CHANGED' });
    }

    // Correlation id is stamped on the row at /execute time; re-read it
    // here so the metric event joins the rest of the lifecycle.
    const { data: rowCorr } = await supabase
      .from('community_ai_actions')
      .select('execution_correlation_id, platform, action_type')
      .eq('id', commandId)
      .maybeSingle();

    await recordExecutionMetric({
      organization_id: session.orgId,
      action_id: commandId,
      correlation_id: rowCorr?.execution_correlation_id ?? null,
      event_type: 'ack_received',
      platform: rowCorr?.platform ?? null,
      action_type: rowCorr?.action_type ?? null,
      execution_mode: 'browser',
      metadata: { lease_id: rowLeaseId },
    });

    return res.status(200).json({ success: true, status: 'acknowledged' });
  } catch (error) {
    console.error('[extension/commands][ack]', error);
    return res.status(500).json({ success: false, error: (error as Error)?.message || 'ack failed' });
  }
}
