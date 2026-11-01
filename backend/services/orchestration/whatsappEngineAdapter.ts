/**
 * The WhatsApp broadcast engine, as an orchestration adapter.
 *
 * The engine is used exactly as its own routes use it — `createBroadcast` →
 * `expandRecipients` → `enqueueBroadcast` — and its send path (`processBatch`)
 * stays the only place a message leaves: contact governance is evaluated there,
 * before Meta is called, and a recipient is claimed `pending → sending` so a
 * retry can never message them twice.
 *
 * ─── ONE REQUEST PER STEP ─────────────────────────────────────────────────
 * `execution_engine_requests` holds one row per execution task (DB-unique). Only
 * the invocation that moves it `requested → submitting` may create the
 * broadcast; every other one waits. The broadcast is named after the task
 * (`wf:<executionTaskId>`), so if a sweep dies after creating it but before
 * recording it, the next sweep ADOPTS that broadcast instead of creating a second.
 *
 * ─── APPROVAL AND TENANT CONTROLS, BEFORE ANYTHING IS CREATED ─────────────
 * This engine has no approval gate or tenant kill switch of its own: its send path
 * evaluates contact governance only. So both are checked here, before a broadcast can
 * exist. No approval record exists for a WhatsApp step yet, so the default answer is
 * "not approved" for EVERY execution mode: autonomous dispatch is not authorized, and
 * `autonomous` on a step does not change that. The tenant approval capability plugs
 * in behind `hasApproval`. Tests that exercise the send path inject it, by name.
 *
 * ─── WHAT IT CHECKS ITSELF ────────────────────────────────────────────────
 * Only what the engine cannot know: that the person has a phone number in
 * E.164 form (the form the opt-out record and the governance gate share), and
 * that the tenant has exactly one active WhatsApp account. Permission is read
 * from the canonical governance store before any request (`whatsapp_permitted`),
 * and the engine re-checks it at send time — the workflow can never override an
 * opt-out.
 *
 * The plan passed to the engine's rate limiter is always 'free', its most
 * conservative tier: a journey never claims a larger allowance than the tenant's
 * lowest one.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { createBroadcast, enqueueBroadcast, expandRecipients } from '../whatsappBroadcastService';
import { normalizePhone } from '../identityResolutionService';
import { WHATSAPP_CAPABILITIES } from './engineCapabilities';
import { channelRefusal } from './journeyGovernance';
import type { EngineAdapter, EngineDisposition, EngineResult, EngineStepContext } from './engineAdapters';

export const ENGINE_REQUESTS_TABLE = 'execution_engine_requests';
export const WHATSAPP_RATE_PLAN = 'free';

type RequestState = 'requested' | 'submitting' | 'submitted' | 'completed' | 'skipped' | 'failed' | 'uncertain';

interface RequestRow {
  id: string;
  state: RequestState;
  external_ref: string | null;
  detail: string | null;
  updated_at: string | null;
}

/** A `submitting` claim older than this, with no broadcast, belonged to a sweep that died. */
export const STALE_SUBMISSION_MS = 15 * 60 * 1000;

export interface WhatsAppAdapterDeps {
  /** Insert-or-read the one request row for this task. */
  getOrCreateRequest(organizationId: string, executionTaskId: string): Promise<RequestRow>;
  /** Compare-and-set; returns true when this call moved the row. */
  transitionRequest(organizationId: string, executionTaskId: string, from: RequestState, patch: { state: RequestState; external_ref?: string; detail?: string | null }): Promise<boolean>;
  findBroadcastByName(organizationId: string, name: string): Promise<string | null>;
  readPersonPhone(organizationId: string, personId: string): Promise<string | null | undefined>;
  findWhatsAppAccount(organizationId: string): Promise<{ id: string } | 'none' | 'ambiguous'>;
  createBroadcast: typeof createBroadcast;
  expandRecipients: typeof expandRecipients;
  enqueueBroadcast: typeof enqueueBroadcast;
  readRecipientStatus(broadcastId: string): Promise<string | null>;
  /** Is there a human approval on record for this task? See the module header. */
  hasApproval(organizationId: string, executionTaskId: string): Promise<boolean>;
  /** The WS-3 tenant controls, null when the channel may be used; otherwise why not. */
  channelRefusal(organizationId: string): Promise<string | null>;
}

const rowOf = (r: Record<string, unknown>): RequestRow => ({
  id: String(r.id),
  state: String(r.state) as RequestState,
  external_ref: typeof r.external_ref === 'string' ? r.external_ref : null,
  detail: typeof r.detail === 'string' ? r.detail : null,
  updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
});

export const defaultWhatsAppDeps: WhatsAppAdapterDeps = {
  async getOrCreateRequest(organizationId, executionTaskId) {
    const read = async () => {
      const res = await ownedDbTable(ENGINE_REQUESTS_TABLE)
        .select('id, state, external_ref, detail, updated_at')
        .eq('organization_id', organizationId)          // TENANT FIRST
        .eq('execution_task_id', executionTaskId)
        .maybeSingle();
      if (res.error) throw Object.assign(new Error('engine request unreadable'), { code: 'request_unreadable' });
      return res.data ? rowOf(res.data as Record<string, unknown>) : null;
    };
    const existing = await read();
    if (existing) return existing;
    const ins = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .insert({ organization_id: organizationId, execution_task_id: executionTaskId, engine: 'whatsapp', state: 'requested' })
      .select('id, state, external_ref, detail, updated_at')
      .single();
    if (!ins.error && ins.data) return rowOf(ins.data as Record<string, unknown>);
    // A concurrent creator won the unique key: read the winner's row.
    const winner = await read();
    if (winner) return winner;
    throw Object.assign(new Error('engine request could not be created'), { code: 'request_create_failed' });
  },

  async transitionRequest(organizationId, executionTaskId, from, patch) {
    const res = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('execution_task_id', executionTaskId)
      .eq('state', from)
      .select('id');
    return !res.error && Array.isArray(res.data) && res.data.length === 1;
  },

  async findBroadcastByName(organizationId, name) {
    const res = await ownedDbTable('whatsapp_broadcasts')
      .select('id')
      .eq('company_id', organizationId)
      .eq('name', name)
      .order('created_at', { ascending: true })
      .limit(1);
    if (res.error || !Array.isArray(res.data) || res.data.length === 0) return null;
    return String((res.data[0] as Record<string, unknown>).id);
  },

  async readPersonPhone(organizationId, personId) {
    const res = await ownedDbTable('unified_persons')
      .select('primary_phone')
      .eq('company_id', organizationId)
      .eq('id', personId)
      .maybeSingle();
    if (res.error) return undefined;                     // unreadable ≠ absent
    const v = (res.data as Record<string, unknown> | null)?.primary_phone;
    return typeof v === 'string' && v.trim() ? v : null;
  },

  async findWhatsAppAccount(organizationId) {
    const res = await ownedDbTable('social_accounts')
      .select('id')
      .eq('company_id', organizationId)
      .eq('platform', 'whatsapp')
      .eq('is_active', true)
      .not('phone_number_id', 'is', null);
    if (res.error || !Array.isArray(res.data) || res.data.length === 0) return 'none';
    if (res.data.length > 1) return 'ambiguous';
    return { id: String((res.data[0] as Record<string, unknown>).id) };
  },

  createBroadcast,
  expandRecipients,
  enqueueBroadcast,

  async readRecipientStatus(broadcastId) {
    const res = await ownedDbTable('whatsapp_broadcast_recipients')
      .select('status')
      .eq('broadcast_id', broadcastId)
      .limit(1);
    if (res.error || !Array.isArray(res.data) || res.data.length === 0) return null;
    return String((res.data[0] as Record<string, unknown>).status);
  },

  hasApproval: async () => false,

  channelRefusal: (organizationId) => channelRefusal(organizationId, 'whatsapp'),
};

const E164 = /^\+\d{8,15}$/;

/** The broadcast name is the idempotency anchor for crash recovery. */
export const broadcastNameFor = (executionTaskId: string): string => `wf:${executionTaskId}`;

export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps = defaultWhatsAppDeps): EngineAdapter {
  const result = (outcome: string, disposition: EngineDisposition, reason: string | null, externalRef: string | null): EngineResult =>
    ({ engine: 'whatsapp', outcome, disposition, reason, externalRef });

  /** Settle the request row (best effort; the step settlement is the authority) and report. */
  const settle = async (ctx: EngineStepContext, from: RequestState, state: RequestState, r: EngineResult): Promise<EngineResult> => {
    await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, from, { state, detail: r.reason });
    return r;
  };

  /** Map the engine's recipient status onto the journey. */
  const fromRecipient = async (ctx: EngineStepContext, broadcastId: string): Promise<EngineResult> => {
    const status = await deps.readRecipientStatus(broadcastId);
    switch (status) {
      case 'sent':
      case 'delivered':
      case 'read':
        return settle(ctx, 'submitted', 'completed', result(status, 'completed', null, broadcastId));
      case 'blocked_governance':
        return settle(ctx, 'submitted', 'skipped', result(status, 'skipped', 'contact governance refused the send', broadcastId));
      case 'failed':
        return settle(ctx, 'submitted', 'failed', result(status, 'needs_human', 'the provider refused the message', broadcastId));
      case 'send_uncertain':
        return settle(ctx, 'submitted', 'uncertain', result(status, 'needs_human', 'the provider may have sent it; never resent automatically', broadcastId));
      case 'pending':
      case 'sending':
        return result(status, 'wait', 'queued for sending', broadcastId);
      default:
        return result(String(status ?? 'unknown'), 'wait', 'recipient status unreadable', broadcastId);
    }
  };

  return {
    engine: 'whatsapp',
    channels: ['whatsapp'],
    capabilities: WHATSAPP_CAPABILITIES,
    async execute(ctx) {
      const template = ctx.step?.whatsapp?.template_name ?? null;
      if (!template) return result('no_template', 'needs_human', 'the step has no whatsapp.template_name', null);

      let row: RequestRow;
      try {
        row = await deps.getOrCreateRequest(ctx.organizationId, ctx.executionTaskId);
      } catch (e) {
        return result('request_unavailable', 'wait', (e as Error).message, null);
      }

      switch (row.state) {
        case 'completed': return result('completed', 'completed', null, row.external_ref);
        case 'skipped': return result('skipped', 'skipped', row.detail, row.external_ref);
        case 'failed':
        case 'uncertain': return result(row.state, 'needs_human', row.detail, row.external_ref);
        case 'submitted': return fromRecipient(ctx, String(row.external_ref));
        case 'submitting': {
          // Another invocation owns creation. While it is fresh, wait. If it is
          // stale it belonged to a sweep that died: with NO broadcast nothing can
          // have been sent, so the claim is released and the request retried; with
          // a broadcast, submission was interrupted part-way and a person decides
          // — a second send is never risked.
          const nowMs = Date.parse(ctx.now ?? new Date().toISOString());
          const age = row.updated_at ? nowMs - Date.parse(row.updated_at) : Number.POSITIVE_INFINITY;
          if (!(age >= STALE_SUBMISSION_MS)) return result('submitting', 'wait', 'another sweep is submitting this request', null);
          const orphan = await deps.findBroadcastByName(ctx.organizationId, broadcastNameFor(ctx.executionTaskId));
          if (orphan !== null) {
            return settle(ctx, 'submitting', 'failed', result('submission_interrupted', 'needs_human', 'a submission was interrupted after the broadcast was created; review it before any resend', orphan));
          }
          const released = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'requested', detail: 'stale claim released' });
          if (!released) return result('submitting', 'wait', 'the stale claim moved concurrently', null);
          break;
        }
        case 'requested':
          break;
        default:
          return result(row.state, 'needs_human', 'unknown request state', row.external_ref);
      }

      // ── Controls and approval: nothing may be created without both ─────────
      const refusal = await deps.channelRefusal(ctx.organizationId);
      if (refusal !== null) return result(refusal, 'needs_human', `whatsapp is not available: ${refusal}`, null);
      if (!(await deps.hasApproval(ctx.organizationId, ctx.executionTaskId))) {
        return result('approval_required', 'needs_human', 'no human approval is on record for this step', null);
      }

      // ── Preconditions only the orchestrator can check ─────────────────────
      if (ctx.personId === null) {
        return settle(ctx, 'requested', 'skipped', result('person_unresolved', 'skipped', 'no canonical person to message', null));
      }
      const phoneRaw = await deps.readPersonPhone(ctx.organizationId, ctx.personId);
      if (phoneRaw === undefined) return result('phone_unreadable', 'wait', 'the person could not be read', null);
      const phone = phoneRaw === null ? null : normalizePhone(phoneRaw);
      if (phone === null || !E164.test(phone)) {
        return settle(ctx, 'requested', 'skipped', result('no_e164_phone', 'skipped', 'the person has no phone number in E.164 form', null));
      }
      const account = await deps.findWhatsAppAccount(ctx.organizationId);
      if (account === 'none' || account === 'ambiguous') {
        return result(`whatsapp_account_${account}`, 'needs_human', `the tenant has ${account === 'none' ? 'no active' : 'more than one active'} WhatsApp account`, null);
      }

      // ── Claim creation: exactly one invocation proceeds ────────────────────
      const claimed = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'requested', { state: 'submitting' });
      if (!claimed) return result('submitting', 'wait', 'another sweep claimed this request', null);

      const name = broadcastNameFor(ctx.executionTaskId);
      let broadcastId: string | null = null;
      try {
        broadcastId = await deps.createBroadcast({
          company_id: ctx.organizationId,
          social_account_id: account.id,
          name,
          message_type: 'template',
          template_name: template,
        });
        await deps.expandRecipients(broadcastId, [{ phone_e164: phone }]);
        // Validates the template and the account's rate limit, then queues the
        // send. Only after it succeeds is the request `submitted`.
        await deps.enqueueBroadcast(broadcastId, WHATSAPP_RATE_PLAN);
      } catch (e) {
        // A refusal here (unapproved template, rate limit, unreadable account) is
        // for a person to resolve. Only the queue sends, so a failure before or
        // inside enqueue cannot have delivered anything twice; the request is
        // settled `failed` so no sweep re-submits it on its own.
        const reason = (e as Error).message.slice(0, 200);
        return settle(ctx, 'submitting', 'failed', result('submit_failed', 'needs_human', reason, broadcastId));
      }
      await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'submitted', external_ref: broadcastId });
      return result('submitted', 'wait', 'queued with the WhatsApp engine', broadcastId);
    },
  };
}
