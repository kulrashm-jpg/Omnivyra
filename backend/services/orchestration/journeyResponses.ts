/**
 * Has this person responded? — what ends a journey early.
 *
 * A person who replied, booked, converted, declined or unsubscribed gets no further
 * automated steps in that journey. This only ever NARROWS contact, so it is implicit
 * rather than authored: a workflow cannot opt out of it, for the same reason it
 * cannot opt out of an opt-out. It is not outcome-driven branching; no step is chosen
 * or added because of a response.
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

import { ownedDbTable } from '../../db/writeOwner';
import { listInstanceHandoffs } from '../outreachBridge/outreachBridgeStore';
import { outcomeTypesFor } from '../leadOutreachExecution/storage';
import { listInstanceTasks } from '../executionPlans/executionPlanStore';
import { normalizePhone } from '../identityResolutionService';
import { detectWhatsAppOptOut } from '../whatsappOptOut';
import { ENGINE_REQUESTS_TABLE } from './whatsappEngineAdapter';

/** The responses that end a journey. `opened` and `clicked` are not responses to act on. */
export const JOURNEY_EXIT_OUTCOMES = ['replied', 'meeting_booked', 'converted', 'rejected', 'unsubscribed'] as const;

/** How far a sweep reads inbound messages. An opt-out anywhere in them outranks a reply. */
const MAX_INBOUND_READ = 50;

export interface WhatsAppReply {
  /** A STOP is not engagement: PI must close this prospect, not call them engaged. */
  readonly outcome: 'replied' | 'unsubscribed';
  /** `engagement_messages.platform_message_id`: the reply's stable identity. */
  readonly messageId: string;
  readonly threadId: string;
}

export interface JourneyResponsePort {
  /** Business outcome types recorded for this run's WS-3 tasks. */
  ws3Outcomes(organizationId: string, executionInstanceId: string): Promise<readonly string[]>;
  /** An inbound WhatsApp message since this run first messaged the person: an opt-out if any, else the earliest. */
  whatsappReply(organizationId: string, executionInstanceId: string, personId: string | null): Promise<WhatsAppReply | null>;
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
    return m
      ? { outcome: stop ? 'unsubscribed' : 'replied', messageId: String(m.platform_message_id), threadId: String(m.thread_id) }
      : null;
  },
};

export interface JourneyExitVerdict {
  readonly exit: boolean;
  /** The response that ended it; null when the journey continues. */
  readonly outcome: string | null;
  readonly whatsappReply: WhatsAppReply | null;
}

export async function assessJourneyExit(
  organizationId: string,
  executionInstanceId: string,
  personId: string | null,
  port: JourneyResponsePort = durableJourneyResponsePort,
): Promise<JourneyExitVerdict> {
  const outcomes = await port.ws3Outcomes(organizationId, executionInstanceId);
  const hit = JOURNEY_EXIT_OUTCOMES.find((o) => outcomes.includes(o));
  if (hit) return { exit: true, outcome: hit, whatsappReply: null };
  const reply = await port.whatsappReply(organizationId, executionInstanceId, personId);
  return reply
    ? { exit: true, outcome: reply.outcome, whatsappReply: reply }
    : { exit: false, outcome: null, whatsappReply: null };
}
