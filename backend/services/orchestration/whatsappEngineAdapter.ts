/**
 * The WhatsApp broadcast engine, as an orchestration adapter.
 *
 * The engine is used as its own routes use it — `createBroadcast` →
 * `expandPersonRecipients` (their `expandRecipients`, plus the person) →
 * `enqueueBroadcast` — and its send path (`processBatch`)
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
import { createBroadcast, enqueueBroadcast, expandPersonRecipients, WhatsAppEnqueueUncertainError } from '../whatsappBroadcastService';
import { normalizePhone } from '../identityResolutionService';
import { WHATSAPP_CAPABILITIES } from './engineCapabilities';
import { channelRefusal } from './journeyGovernance';
import type { EngineAdapter, EngineDisposition, EngineResult, EngineStepContext } from './engineAdapters';
import { claimEngineRequest, claimRefusal, type ClaimOptions } from './engineRequestClaim';

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
  /**
   * Compare-and-set; returns true when this call moved the row. The claim (`requested ->
   * submitting`) is D-2's atomic claim: the default makes it through orch_claim_engine_request
   * (per-person lock + frequency gap + claim, one transaction) and reports why nothing was
   * claimed through `claim.verdict`.
   *
   * `expectUpdatedAt` (CLASS-2 C3): the generic compare-and-set ALSO requires updated_at to equal
   * this value - the RAW string PostgREST returned (microseconds; never round-tripped through a
   * Date). The guard trigger sets updated_at := now() on every update, so it is the claim's
   * fencing token. Refused on the claim path (the claim RPC cannot honour it, and a silent
   * no-op there would read as a fence).
   */
  transitionRequest(organizationId: string, executionTaskId: string, from: RequestState, patch: { state: RequestState; external_ref?: string; detail?: string | null }, claim?: ClaimOptions, expectUpdatedAt?: string): Promise<boolean>;
  findBroadcastByName(organizationId: string, name: string): Promise<string | null>;
  readPersonPhone(organizationId: string, personId: string): Promise<string | null | undefined>;
  findWhatsAppAccount(organizationId: string): Promise<{ id: string } | 'none' | 'ambiguous'>;
  createBroadcast: typeof createBroadcast;
  expandPersonRecipients: typeof expandPersonRecipients;
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

  async transitionRequest(organizationId, executionTaskId, from, patch, claim, expectUpdatedAt) {
    if (from === 'requested' && patch.state === 'submitting') {
      if (expectUpdatedAt !== undefined) throw new Error('transitionRequest: expectUpdatedAt is not supported on the claim path');
      const options = claim ?? {};
      options.externalRef = patch.external_ref ?? options.externalRef ?? null;
      return claimEngineRequest(organizationId, executionTaskId, options);
    }
    const cas = ownedDbTable(ENGINE_REQUESTS_TABLE)
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('execution_task_id', executionTaskId)
      .eq('state', from);
    const res = await (expectUpdatedAt === undefined ? cas : cas.eq('updated_at', expectUpdatedAt))
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
    // A failed read is not "no broadcast": that answer releases the claim and creates another.
    if (res.error || !Array.isArray(res.data)) throw new Error('the broadcast could not be read');
    if (res.data.length === 0) return null;
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
  expandPersonRecipients,
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

/** The engine's code for a batch that may be queued and could not be withdrawn (L-4). */
export const WHATSAPP_ENQUEUE_UNCERTAIN_CODE = 'whatsapp_enqueue_uncertain';

/**
 * The request's `detail` for that case. A fixed, code-level summary: the column must never
 * hold personal data, and the engine's message carries a raw database error. The batch is
 * identified by `external_ref` (the broadcast id) and its recipient rows.
 */
export const ENQUEUE_UNCERTAIN_DETAIL =
  `${WHATSAPP_ENQUEUE_UNCERTAIN_CODE}: the queue may hold this batch and its recipients could not be withdrawn; never resent automatically, a person reviews it`;

/**
 * RUL-C (owner ruling 2026-11-09). Matched by class AND code, never by message text: a
 * message can be reworded or imitated, and an error that is not the engine's own signal
 * must not stop being a failure.
 */
const isEnqueueUncertain = (e: unknown): boolean =>
  e instanceof WhatsAppEnqueueUncertainError && (e as { code?: unknown }).code === WHATSAPP_ENQUEUE_UNCERTAIN_CODE;

export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps = defaultWhatsAppDeps): EngineAdapter {
  const result = (outcome: string, disposition: EngineDisposition, reason: string | null, externalRef: string | null): EngineResult =>
    ({ engine: 'whatsapp', outcome, disposition, reason, externalRef });

  /** Settle the request row (best effort; the step settlement is the authority) and report. */
  /**
   * Settle the request. With `expectUpdatedAt` the settle is FENCED (CLASS-2 C3, 55): it lands only
   * on the claim that value names, and if the claim moved this run settles nothing and waits - the
   * request belongs to whoever moved it. Without it (only for a run that has passed fence 1, so
   * held the claim at the fence; every later writer is pinned) the settle is state-only, as before.
   */
  const settle = async (ctx: EngineStepContext, from: RequestState, state: RequestState, r: EngineResult, expectUpdatedAt?: string): Promise<EngineResult> => {
    const moved = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, from, {
      state,
      detail: r.reason,
      ...(r.externalRef === null ? {} : { external_ref: r.externalRef }),
    }, undefined, expectUpdatedAt);
    if (expectUpdatedAt !== undefined && !moved) {
      return result('submitting', 'wait', 'the claim moved concurrently; this run settled nothing', null);
    }
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
      case 'blocked_send_control':
        return settle(ctx, 'submitted', 'failed', result(status, 'needs_human', 'a send-time control refused the message; nothing was sent', broadcastId));
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
          let orphan: string | null;
          try {
            orphan = await deps.findBroadcastByName(ctx.organizationId, broadcastNameFor(ctx.executionTaskId));
          } catch {
            return result('broadcast_unreadable', 'wait', 'the broadcast could not be read', null);
          }
          if (orphan !== null) {
            // Pinned like the release below (55, F1): the claimant may have passed fence 1 since this
            // read, and then it queues - an unpinned `uncertain` would sit over a live send.
            if (row.updated_at === null) return result('submitting', 'wait', 'the stale claim cannot be fenced (no updated_at)', null);
            return settle(ctx, 'submitting', 'uncertain', result('submission_interrupted', 'needs_human', 'a submission was interrupted after the broadcast was created; review it before any resend', orphan), row.updated_at);
          }
          // FENCE 2 (CLASS-2 C3): released only if it is still the stale claim that was READ. A
          // claimant that woke, created its broadcast and refreshed its claim (fence 1) has a new
          // updated_at, and must not be released from under it - or both would send.
          if (row.updated_at === null) return result('submitting', 'wait', 'the stale claim cannot be fenced (no updated_at)', null);
          const released = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'requested', detail: 'stale claim released' }, undefined, row.updated_at);
          if (!released) return result('submitting', 'wait', 'the stale claim moved concurrently', null);
          break;
        }
        case 'requested':
          break;
        default:
          return result(row.state, 'needs_human', 'unknown request state', row.external_ref);
      }

      if (ctx.holdOnly === true) {
        return settle(ctx, 'requested', 'skipped', result('not_begun', 'skipped', 'the step no longer applies and nothing had been created', null));
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
      // D-2: atomically with the person's frequency gap, under the person's lock.
      const claim: ClaimOptions = { gapHours: ctx.frequencyGapHours ?? null, now: ctx.now };
      const claimed = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'requested', { state: 'submitting' }, claim);
      if (!claimed) {
        const refused = claimRefusal(claim.verdict, claim.gapHours, claim.now);
        return refused === null
          ? result('submitting', 'wait', 'another sweep claimed this request', null)
          : result(refused.outcome, 'wait', refused.reason, null);
      }

      // The claim's FENCING TOKEN (CLASS-2 C3): its updated_at, read right after the claim, kept as
      // the raw string. If this read picks up a later claimant's value instead, both fence on the
      // same value and exactly one wins. Unreadable / null: the claim cannot be fenced, so nothing
      // is created or sent (a stale claim with no broadcast is released by a later sweep).
      let claimToken: string | null = null;
      try {
        const mine = await deps.getOrCreateRequest(ctx.organizationId, ctx.executionTaskId);
        claimToken = mine.state === 'submitting' && typeof mine.updated_at === 'string' && mine.updated_at !== '' ? mine.updated_at : null;
      } catch {
        claimToken = null;
      }
      if (claimToken === null) return result('claim_unfenced', 'wait', 'the claim could not be read back, so it cannot be fenced; nothing was created', null);

      const name = broadcastNameFor(ctx.executionTaskId);
      let broadcastId: string | null = null;
      // Until fence 1 passes, every settle of this run is pinned to its claim token (55, F2): a run
      // that stalled, was released and re-claimed, then failed in createBroadcast / expand, must not
      // settle the NEW holder's live claim `failed`.
      let fenced = false;
      try {
        broadcastId = await deps.createBroadcast({
          company_id: ctx.organizationId,
          social_account_id: account.id,
          name,
          message_type: 'template',
          template_name: template,
        });
        // The canonical person rides with the recipient so the send path can apply person-level restrictions.
        await deps.expandPersonRecipients(broadcastId, [{ phone_e164: phone, person_id: ctx.personId }]);
        // FENCE 1 (CLASS-2 C3): still MINE, immediately before the send act. A sweep that stalled
        // past STALE_SUBMISSION_MS may have been released and the request claimed - and sent - by
        // another; that sweep then created a SECOND wf:<task> broadcast and queued it. This CAS
        // (state submitting AND the token read after the claim; the trigger bumps updated_at)
        // moves exactly one row or this run does not enqueue. Its draft broadcast is left
        // unqueued - it sends nothing unless an operator resumes it by hand - and the row is not
        // settled: it is not this run's any more.
        const stillMine = await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'submitting' }, undefined, claimToken);
        if (!stillMine) {
          console.error('[orch-whatsapp] claim lost before enqueue; this run\'s draft broadcast is NOT queued (an orphan draft, never sent)', {
            organization_id: ctx.organizationId, execution_task_id: ctx.executionTaskId, draft_broadcast_id: broadcastId,
          });
          return result('claim_lost', 'wait', 'another sweep holds this request now; nothing was queued by this run', null);
        }
        fenced = true;
        // Validates the template and the account's rate limit, then queues the
        // send. Only after it succeeds is the request `submitted`.
        await deps.enqueueBroadcast(broadcastId, WHATSAPP_RATE_PLAN);
      } catch (e) {
        // RUL-C. The queue add's acknowledgement was lost AND the engine could not withdraw
        // the batch's recipients: the batch may be queued and may send. That is not a
        // refusal, so it is never `failed` (which reads as "the provider refused; nothing
        // went out") and never `submitted`. It is `uncertain`, which is settled for good: no
        // sweep, re-run or stale-claim release re-submits it, and the broadcast it names
        // stays the one record of the attempt. A person reviews it before any resend.
        if (isEnqueueUncertain(e)) {
          const ref = broadcastId ?? (e as WhatsAppEnqueueUncertainError).broadcastId;
          return settle(ctx, 'submitting', 'uncertain', result('uncertain', 'needs_human', ENQUEUE_UNCERTAIN_DETAIL, ref), fenced ? undefined : claimToken);
        }
        // A refusal here (unapproved template, rate limit, unreadable account), or a lost
        // acknowledgement whose recipients the engine withdrew, is for a person to resolve:
        // nothing of it can be sent. The request is settled `failed` so no sweep re-submits
        // it on its own.
        const reason = (e as Error).message.slice(0, 200);
        return settle(ctx, 'submitting', 'failed', result('submit_failed', 'needs_human', reason, broadcastId), fenced ? undefined : claimToken);
      }
      await deps.transitionRequest(ctx.organizationId, ctx.executionTaskId, 'submitting', { state: 'submitted', external_ref: broadcastId });
      return result('submitted', 'wait', 'queued with the WhatsApp engine', broadcastId);
    },
  };
}
