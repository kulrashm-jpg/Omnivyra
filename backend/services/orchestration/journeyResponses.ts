/**
 * Has this person responded? — what ends, or suspends, a journey early.
 *
 * A person who booked, converted, declined or unsubscribed (a WhatsApp STOP included)
 * gets no further automated steps in that journey: those answers are deterministic and
 * END it. A REPLY whose meaning is not classified — any other inbound WhatsApp message,
 * or a recorded WS-3 `replied` — SUSPENDS it instead (Prompt 4, owner decision
 * 2026-11-05, SC-7 unratified): the run is paused for a person to evaluate, so an
 * out-of-office can no longer end a journey. The person resumes the run (the existing
 * PATCH /api/execution-instances/:id, `active`) or ends it (`cancelled`). A reply a
 * person already evaluated — one that suspended the run before it was resumed — does not
 * suspend it again; a later reply does.
 *
 * Q-C1 (owner, 2026-11-05) — a COMPLAINT ends the run, including a paused one. It is read
 * three ways, directly from the stores and never through the journey event view: the
 * canonical restriction (`contact_governance_records`, `complaint`), the complaint-inferred
 * delivery evidence row, and a future `complained` outcome row.
 *
 * PRECEDENCE (Outreach sign-off condition). The canonical restrictions are read FIRST: a
 * complaint or an unsubscribe (a WhatsApp STOP writes one) on the person ends the run before
 * any reply is considered, so a pending reply can never turn an opt-out into a pause. They
 * are written at ingestion, independently of this module; governance refuses a send whether
 * or not the run ended.
 *
 * Both only ever NARROW contact, so they are implicit rather than authored: a workflow
 * cannot opt out of them, for the same reason it cannot opt out of an opt-out. It is not
 * outcome-driven branching; no step is chosen or added because of a response.
 *
 * Every response comes from the store its engine already writes. This module owns
 * none and reads only:
 *
 *   WS-3      outreach_bridge_handoffs → outreach_outcomes (SES webhook, operator route)
 *   WhatsApp  execution_engine_requests → engagement_threads / engagement_messages
 *             (the inbound row the Meta webhook processor persists)
 *
 * An unreadable source THROWS. The sweeper catches that per run, before any engine is
 * asked, so "we could not tell" means no contact this sweep, never contact anyway.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { listInstanceHandoffs } from '../outreachBridge/outreachBridgeStore';
import { outcomeTypesFor } from '../leadOutreachExecution/storage';
import { listInstanceTasks } from '../executionPlans/executionPlanStore';
import { normalizePhone } from '../identityResolutionService';
import { detectWhatsAppOptOut } from '../whatsappOptOut';
import { loadGovernanceRecords } from '../prospectIdentity/contactGovernanceRepository';
import { ENGINE_REQUESTS_TABLE } from './whatsappEngineAdapter';

/**
 * The recorded responses that END a journey: deterministic answers. `opened` and `clicked`
 * are not responses to act on. Prompt 4: `replied` moved to JOURNEY_SUSPEND_OUTCOMES.
 */
export const JOURNEY_EXIT_OUTCOMES = ['complained', 'meeting_booked', 'converted', 'rejected', 'unsubscribed'] as const;

/** The canonical restrictions that end a run, and the exit outcome each one records. */
export const RESTRICTION_EXITS: Readonly<Record<string, 'complained' | 'unsubscribed'>> = {
  complaint: 'complained',
  unsubscribe: 'unsubscribed',
};

/**
 * Q-C1 — the complaint-inferred delivery evidence rule is journeyEvents.ts's
 * `isComplaintInferredEvidence` (fails toward a complaint, never throws): the event view and
 * the complaint exit use the one rule, so they cannot diverge.
 */
export type ComplaintEvidencePredicate = (row: { delivery_status: unknown; transport_response?: unknown }) => boolean;

export async function complaintEvidencePredicate(): Promise<ComplaintEvidencePredicate> {
  // Loaded on use: journeyEvents imports this module.
  const { isComplaintInferredEvidence } = await import('./journeyEvents');
  return isComplaintInferredEvidence;
}

/** A reply whose meaning is unclassified: it SUSPENDS the journey for a person to evaluate. */
export const JOURNEY_SUSPEND_OUTCOMES = ['replied'] as const;

/** The `needs_human` decision outcome of a suspension, suffixed with the reply's reference. */
export const REPLY_AWAITING_EVALUATION = 'reply_awaiting_evaluation';

/** A reply's reference as stored on its suspension decision: a fingerprint, never the raw id. */
export const replyReferenceKey = (ref: string): string =>
  createHash('sha256').update(ref).digest('hex').slice(0, 32);

/** How far a sweep reads inbound messages. An opt-out anywhere in them outranks a reply. */
const MAX_INBOUND_READ = 50;

/**
 * X-3 (Prompt 5) — the internal label of a WhatsApp inbound that nobody has evaluated.
 * It is NOT a business outcome: no one has said what the message means, so it is never
 * `replied`. It suspends the run exactly as a reply does, feeds nothing to Prospect
 * Intelligence (PI ruling, virality-b6, 2026-11-06) and reads as `response.received`
 * (contract 0.4.0), never as positive engagement.
 */
export const WHATSAPP_INBOUND_UNCLASSIFIED = 'inbound_unclassified';

export interface WhatsAppReply {
  /**
   * A STOP is not engagement: PI must close this prospect, not call them engaged. Any
   * other inbound is `inbound_unclassified`: its meaning is unknown, so it is not engagement either.
   */
  readonly outcome: typeof WHATSAPP_INBOUND_UNCLASSIFIED | 'unsubscribed';
  /** `engagement_messages.platform_message_id`: the reply's stable identity. */
  readonly messageId: string;
  readonly threadId: string;
  /**
   * Prompt 4 — every non-STOP inbound message since the run reached out, oldest first, so
   * a reply after an evaluated one is still seen. Absent from an older port: then only
   * `messageId` is known.
   */
  readonly inboundMessageIds?: readonly string[];
}

export interface JourneyResponsePort {
  /** Business outcome types recorded for this run's WS-3 tasks. */
  ws3Outcomes(organizationId: string, executionInstanceId: string): Promise<readonly string[]>;
  /** An inbound WhatsApp message since this run first messaged the person: an opt-out if any, else the earliest. */
  whatsappReply(organizationId: string, executionInstanceId: string, personId: string | null): Promise<WhatsAppReply | null>;
  /**
   * Prompt 4 — the ids of this run's recorded WS-3 `replied` outcome rows, oldest first, so
   * each reply is evaluated once. Optional: a port without it identifies the replies of a
   * run as one.
   */
  ws3ReplyRefs?(organizationId: string, executionInstanceId: string): Promise<readonly string[]>;
  /** Q-C1 — whether any of this run's WS-3 tasks has complaint-inferred delivery evidence. */
  ws3ComplaintEvidence?(organizationId: string, executionInstanceId: string): Promise<boolean>;
  /** The governance types in force on this person (any channel), from the canonical store. */
  personRestrictions?(organizationId: string, personId: string, now: string): Promise<readonly string[]>;
}

const REACHED_OUT_STATES = ['submitted', 'completed', 'uncertain'];

const unreadable = (what: string): Error =>
  Object.assign(new Error(`${what} unreadable; the journey is not advanced this sweep`), { code: 'responses_unreadable' });

export const durableJourneyResponsePort: JourneyResponsePort = {
  async ws3Outcomes(organizationId, executionInstanceId) {
    const out: string[] = [];
    for (const h of await listInstanceHandoffs(organizationId, executionInstanceId)) {
      out.push(...(await outcomeTypesFor(organizationId, h.outreachTaskId)));
    }
    return out;
  },

  async ws3ReplyRefs(organizationId, executionInstanceId) {
    const taskIds = (await listInstanceHandoffs(organizationId, executionInstanceId)).map((h) => h.outreachTaskId);
    if (taskIds.length === 0) return [];
    const res = await ownedDbTable('outreach_outcomes')
      .select('id, occurred_at')
      .eq('company_id', organizationId)
      .in('task_id', taskIds)
      .eq('outcome_type', 'replied')
      .order('occurred_at', { ascending: true });
    if (res.error) throw unreadable('reply outcomes');
    return ((res.data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => String(r.id));
  },

  async ws3ComplaintEvidence(organizationId, executionInstanceId) {
    const taskIds = (await listInstanceHandoffs(organizationId, executionInstanceId)).map((h) => h.outreachTaskId);
    if (taskIds.length === 0) return false;
    const res = await ownedDbTable('outreach_delivery_evidence')
      .select('delivery_status, transport_response')
      .eq('company_id', organizationId)
      .in('task_id', taskIds);
    if (res.error) throw unreadable('delivery evidence');
    const isComplaint = await complaintEvidencePredicate();
    return ((res.data ?? []) as unknown as Array<{ delivery_status: unknown; transport_response?: unknown }>).some((r) => isComplaint(r));
  },

  // `now` is deliberately NOT used to decide what is in force (the P0 class A closed for PI):
  // each read's records are judged at THAT read's database instant (readAt). A read that failed,
  // or returned rows without an instant, or a loader that did not report its reads, is
  // indeterminate and fails closed (unreadable), never "no restriction".
  async personRestrictions(organizationId, personId, _now) {
    const person = await ownedDbTable('unified_persons')
      .select('primary_email, primary_phone')
      .eq('company_id', organizationId)
      .eq('id', personId)
      .maybeSingle();
    if (person.error) throw unreadable('person');
    const p = (person.data ?? {}) as Record<string, unknown>;
    const types = new Set<string>();
    for (const [channel, target] of [['email', p.primary_email], ['whatsapp', p.primary_phone]] as const) {
      const loaded = await loadGovernanceRecords({ organizationId, personId, channel, target: typeof target === 'string' ? target : null });
      if (!loaded.ok || loaded.reads === undefined) throw unreadable('contact governance');
      for (const read of loaded.reads) {
        if (!read.ok) throw unreadable('contact governance');
        if (read.records.length === 0) continue;
        if (read.readAt === null) throw unreadable('contact governance (rows without a database read instant)');
        const atMs = Date.parse(read.readAt);
        if (!Number.isFinite(atMs)) throw unreadable('contact governance (unparseable database read instant)');
        for (const r of read.records) {
          const from = Date.parse(r.effectiveFrom);
          const until = r.effectiveUntil === null ? Number.POSITIVE_INFINITY : Date.parse(r.effectiveUntil);
          // An unparseable window is in force: a restriction is never assumed away.
          if (!(Number.isFinite(from) && from > atMs) && !(until <= atMs)) types.add(r.governanceType);
        }
      }
    }
    return [...types];
  },

  async whatsappReply(organizationId, executionInstanceId, personId) {
    if (personId === null) return null;
    const taskIds = (await listInstanceTasks(organizationId, executionInstanceId))
      .filter((t) => t.channel === 'whatsapp')
      .map((t) => t.id);
    if (taskIds.length === 0) return null;

    // Only a message after this run first reached out is a response to it.
    const requests = await ownedDbTable(ENGINE_REQUESTS_TABLE)
      .select('created_at, state, external_ref')
      .eq('organization_id', organizationId)
      .in('execution_task_id', taskIds)
      .order('created_at', { ascending: true });
    if (requests.error) throw unreadable('engine requests');
    // A settled `failed` can still hold a broadcast that went out (an interrupted submission),
    // so a request that names one counts. One that never left the building does not.
    const since = ((requests.data ?? []) as unknown as Array<Record<string, unknown>>)
      .find((r) => REACHED_OUT_STATES.includes(String(r.state)) || r.external_ref != null)?.created_at;
    if (since == null) return null;

    const person = await ownedDbTable('unified_persons')
      .select('primary_phone')
      .eq('company_id', organizationId)
      .eq('id', personId)
      .maybeSingle();
    if (person.error) throw unreadable('person');
    const phone = (person.data as Record<string, unknown> | null)?.primary_phone;
    const normalized = typeof phone === 'string' ? normalizePhone(phone) : null;
    if (!normalized) return null;
    // Meta's `from` is digits only; the webhook processor keys the thread on it.
    const waId = normalized.replace(/^\+/, '');

    const accounts = await ownedDbTable('social_accounts')
      .select('id')
      .eq('company_id', organizationId)
      .eq('platform', 'whatsapp');
    if (accounts.error) throw unreadable('whatsapp accounts');
    const threadKeys = ((accounts.data ?? []) as unknown as Array<Record<string, unknown>>)
      .map((a) => `wa:${String(a.id)}:${waId}`);
    if (threadKeys.length === 0) return null;

    const threads = await ownedDbTable('engagement_threads')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('platform', 'whatsapp')
      .in('platform_thread_id', threadKeys);
    if (threads.error) throw unreadable('engagement threads');
    const threadIds = ((threads.data ?? []) as unknown as Array<Record<string, unknown>>).map((t) => String(t.id));
    if (threadIds.length === 0) return null;

    const messages = await ownedDbTable('engagement_messages')
      .select('thread_id, platform_message_id, content')
      .in('thread_id', threadIds)
      .eq('direction', 'inbound')
      .gte('created_at', String(since))
      .order('created_at', { ascending: true })
      .limit(MAX_INBOUND_READ);
    if (messages.error) throw unreadable('engagement messages');
    const found = (messages.data ?? []) as unknown as Array<Record<string, unknown>>;
    const stop = found.find((m) => detectWhatsAppOptOut(m.content) !== null);
    const m = stop ?? found[0];
    const inboundMessageIds = found.filter((x) => detectWhatsAppOptOut(x.content) === null).map((x) => String(x.platform_message_id));
    return m
      ? { outcome: stop ? 'unsubscribed' : WHATSAPP_INBOUND_UNCLASSIFIED, messageId: String(m.platform_message_id), threadId: String(m.thread_id), inboundMessageIds }
      : null;
  },
};

export type JourneyResponseConsequence = 'exit' | 'suspend' | 'continue';

export interface JourneyResponseVerdict {
  readonly consequence: JourneyResponseConsequence;
  /** The response behind an exit or a suspension; null when the journey continues. */
  readonly outcome: string | null;
  readonly whatsappReply: WhatsAppReply | null;
  /** Suspend only: the fingerprint of the reply awaiting evaluation (`replyReferenceKey`). */
  readonly replyKey: string | null;
}

/**
 * Prompt 4 — the consequence of what the person said, in order:
 *   0. a canonical restriction on the person (complaint, unsubscribe) or complaint-inferred
 *      evidence → exit (Q-C1, governance precedence);
 *   1. a recorded deterministic answer (complained, booked, converted, rejected,
 *      unsubscribed) → exit;
 *   2. a WhatsApp STOP → exit `unsubscribed`;
 *   3. a reply not yet evaluated by a person (`evaluated` holds the fingerprints of the
 *      replies that already suspended this run) → suspend;
 *   4. otherwise → continue.
 * A PI closed state is the sweeper's own check and still ends the run. Throws when a
 * source is unreadable: "we could not tell" means no contact this sweep.
 */
/**
 * Q-C1 — the deterministic answers that hold over anything else, in order: a canonical
 * restriction on the person (complaint, then unsubscribe), complaint-inferred evidence.
 * Null when none applies. Throws when a source is unreadable.
 */
async function restrictionExit(
  organizationId: string, executionInstanceId: string, personId: string | null, port: JourneyResponsePort, now: string,
): Promise<'complained' | 'unsubscribed' | null> {
  if (personId !== null && port.personRestrictions) {
    const types = await port.personRestrictions(organizationId, personId, now);
    if (types.includes('complaint')) return 'complained';
    if (types.includes('unsubscribe')) return 'unsubscribed';
  }
  if (port.ws3ComplaintEvidence && (await port.ws3ComplaintEvidence(organizationId, executionInstanceId))) return 'complained';
  return null;
}

/** Q-C1 — does a complaint end this run? Used for PAUSED runs too: a complaint wins over a pause. */
export async function assessComplaint(
  organizationId: string, executionInstanceId: string, personId: string | null,
  port: JourneyResponsePort = durableJourneyResponsePort, now: string = new Date().toISOString(),
): Promise<boolean> {
  if (personId !== null && port.personRestrictions && (await port.personRestrictions(organizationId, personId, now)).includes('complaint')) return true;
  if (port.ws3ComplaintEvidence && (await port.ws3ComplaintEvidence(organizationId, executionInstanceId))) return true;
  return (await port.ws3Outcomes(organizationId, executionInstanceId)).includes('complained');
}

export async function assessJourneyResponse(
  organizationId: string,
  executionInstanceId: string,
  personId: string | null,
  evaluated: ReadonlySet<string>,
  port: JourneyResponsePort = durableJourneyResponsePort,
  now: string = new Date().toISOString(),
): Promise<JourneyResponseVerdict> {
  // Restrictions FIRST: no reply is considered while an opt-out or complaint stands.
  const restricted = await restrictionExit(organizationId, executionInstanceId, personId, port, now);
  if (restricted !== null) {
    // PI still hears a WhatsApp STOP with its message identity. Best effort: the exit never
    // depends on this read.
    let stop: WhatsAppReply | null = null;
    if (restricted === 'unsubscribed') {
      try {
        const r = await port.whatsappReply(organizationId, executionInstanceId, personId);
        stop = r !== null && r.outcome === 'unsubscribed' ? r : null;
      } catch {
        stop = null;
      }
    }
    return { consequence: 'exit', outcome: restricted, whatsappReply: stop, replyKey: null };
  }
  const outcomes = await port.ws3Outcomes(organizationId, executionInstanceId);
  const hit = JOURNEY_EXIT_OUTCOMES.find((o) => outcomes.includes(o));
  if (hit) return { consequence: 'exit', outcome: hit, whatsappReply: null, replyKey: null };
  const reply = await port.whatsappReply(organizationId, executionInstanceId, personId);
  if (reply !== null && reply.outcome === 'unsubscribed') return { consequence: 'exit', outcome: 'unsubscribed', whatsappReply: reply, replyKey: null };

  const refs: string[] = [];
  if (outcomes.includes('replied')) {
    const rows = port.ws3ReplyRefs ? await port.ws3ReplyRefs(organizationId, executionInstanceId) : [];
    refs.push(...(rows.length > 0 ? rows.map((id) => `ws3:${id}`) : [`ws3:${executionInstanceId}`]));
  }
  if (reply !== null) refs.push(...(reply.inboundMessageIds ?? [reply.messageId]).map((id) => `wa:${id}`));
  const pendingRef = refs.find((r) => !evaluated.has(replyReferenceKey(r))) ?? null;
  if (pendingRef === null) return { consequence: 'continue', outcome: null, whatsappReply: null, replyKey: null };
  // X-3 — the outcome names what suspended the run: a recorded WS-3 `replied`, or a WhatsApp
  // inbound nobody has evaluated (`inbound_unclassified`, never the business outcome `replied`).
  const outcome = pendingRef.startsWith('wa:') ? WHATSAPP_INBOUND_UNCLASSIFIED : 'replied';
  return { consequence: 'suspend', outcome, whatsappReply: reply, replyKey: replyReferenceKey(pendingRef) };
}

/**
 * The fingerprints of the replies that already suspended this run, read from its own
 * `needs_human` decisions. A run the sweeper sees again is not paused, so each of these
 * was evaluated by the person who resumed it.
 */
export function evaluatedReplyKeys(decisions: ReadonlyArray<{ decision: string; outcome: string | null }>): Set<string> {
  const prefix = `${REPLY_AWAITING_EVALUATION}:`;
  return new Set(decisions
    .filter((d) => d.decision === 'needs_human' && typeof d.outcome === 'string' && d.outcome.startsWith(prefix))
    .map((d) => (d.outcome as string).slice(prefix.length)));
}
