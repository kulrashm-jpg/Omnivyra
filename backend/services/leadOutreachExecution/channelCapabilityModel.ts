/**
 * The canonical OUTREACH CHANNEL capability model.
 *
 * ─── THE QUESTION THIS REPLACES ───────────────────────────────────────────
 * `transport.ts` answers "is there a transport for this channel?" and nothing
 * else. That is the only question the dispatcher needs, and it is deliberately
 * narrow: `resolveTransport` returns null and the channel is skipped. But every
 * surface ABOVE the dispatcher — a workflow step picking a channel, an operator
 * screen, a report — has been asking a different question ("can we reach this
 * prospect by WhatsApp?") and answering it from transport presence alone.
 *
 * Transport presence cannot answer it. `registerDefaultTransports` registers
 * email, and the email transport returns `disabled` without calling a provider
 * unless `LEAD_OUTREACH_EMAIL_ENABLED` is `true` — so email is ROUTABLE and not
 * LIVE. Meanwhile WhatsApp, SMS, voice and social have no transport at all,
 * which is a different fact again from "built but gated".
 *
 * This module holds the capability facts, and it is the only thing allowed to
 * answer them.
 *
 * ─── FOUR OPERATIONS, AND NONE IS DERIVED FROM ANOTHER ────────────────────
 * A channel does not have "a capability". It has up to four, and in this domain
 * they genuinely come apart:
 *
 *   send              can we transmit an outreach action on this channel?
 *   deliveryReceipt   does the channel tell us the message ARRIVED, as opposed
 *                     to having been accepted? `TransportResult` already keeps
 *                     `sent_unverified` apart from `delivered` for exactly this
 *                     reason, and a channel that never confirms delivery must
 *                     not look like one that does.
 *   inboundReply      can a reply from the prospect reach us as an event?
 *   callDisposition   does the channel report a human outcome distinct from its
 *                     technical status? Only a conversational channel has one.
 *
 * Nothing here computes one from another. A channel that can send may be unable
 * to confirm delivery; a channel that can receive replies may be unable to
 * send. Both have occurred in this codebase's own roadmap.
 *
 * ─── IT IS NOT A SECOND TRANSPORT REGISTRY ────────────────────────────────
 * It registers nothing, resolves nothing and performs no I/O. `transport.ts`
 * remains the only thing that decides what is dispatchable, and this module
 * cannot make a channel sendable — which is the property that keeps a
 * capability declaration from becoming an egress path. It also owns none of
 * what the neighbouring registries own:
 *
 *   `transportRegistry`          which channels are dispatchable at runtime
 *   `providerCapabilityModel`    DATA provider capabilities (acquisition,
 *                                discovery, enrichment) — a different axis, and
 *                                no entry there declares `engagement`
 *   `failureTaxonomy`            how a failed attempt is classified
 *   `feedbackIngestion`          which inbound signals exist, and their axis
 *
 * ─── DECLARED FROM EVIDENCE, NEVER COMPUTED ───────────────────────────────
 * Every state below is written down with the evidence named in `basis`. The
 * module deliberately does NOT import the transport registry to derive
 * `routable`: registration is caller-driven (`registerDefaultTransports`), and
 * tests clear and re-register it, so a derived value would report whatever the
 * last test did. Consistency between the declaration and the real registry is
 * asserted by a test instead — which is the right place for it, because a drift
 * should fail a build rather than silently redefine a capability.
 *
 * ─── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────
 *
 * A SINGLE `social` CAPABILITY SET. Social is not one channel. Sending a
 * LinkedIn connection note, replying to an X mention and posting to a company
 * page differ in whether they can send, whether a reply arrives as an event,
 * and whether any of it is permitted by the network's terms. `networkScoped`
 * marks the channel as one whose capabilities cannot be stated without naming
 * the network, and every operation is `UNSUPPORTED` until one is.
 *
 * ANY `operationallyVerified` TRUE. No channel in this platform has been
 * observed completing a real external send, so the verification list is empty
 * for every external channel. `internal` is verified because the platform
 * itself performs the write and the dispatch chain exercises it.
 *
 * A BUSINESS OUTCOME. `callDisposition` is the channel's report of what a human
 * did — answered, declined, asked for a callback. The tenant's business
 * assessment of the prospect is a separate concept owned elsewhere, and folding
 * the two together is how a no-answer becomes "not interested".
 */

/** The operations a channel can have, independently of one another. */
export const CHANNEL_OPERATIONS = ['send', 'deliveryReceipt', 'inboundReply', 'callDisposition'] as const;
export type ChannelOperation = typeof CHANNEL_OPERATIONS[number];

/**
 * The state of one operation on one channel.
 *
 * These are NOT interchangeable, and the distinctions are the point:
 *
 *   SUPPORTED             implemented and exercised end to end here.
 *   PARTIALLY_SUPPORTED   works within stated limits; the limits are in `basis`.
 *   UNVERIFIED            implemented, but never observed working. The default
 *                         for anything that leaves the platform.
 *   NOT_CONFIGURED        implemented and reachable, but switched off — an
 *                         operator action away, not an engineering one.
 *   NOT_OPERATIONAL       implemented and NOT reachable: no registration, or a
 *                         gate that refuses unconditionally.
 *   UNSUPPORTED           the channel cannot do this, or nothing is built.
 */
export const CAPABILITY_STATUSES = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'UNVERIFIED',
  'NOT_CONFIGURED',
  'NOT_OPERATIONAL',
  'UNSUPPORTED',
] as const;
export type CapabilityStatus = typeof CAPABILITY_STATUSES[number];

/** Statuses under which an operation must never be attempted. */
export const NON_ATTEMPTABLE_STATUSES: readonly CapabilityStatus[] = Object.freeze([
  'NOT_CONFIGURED', 'NOT_OPERATIONAL', 'UNSUPPORTED',
]);

export interface ChannelOperationState {
  readonly status: CapabilityStatus;
  /** The evidence for this status. Never a guess, never a plan. */
  readonly basis: string;
}

export interface ChannelCapabilityDefinition {
  /** Matches `OutreachTransport.channel` and `OutreachTask.channel`. */
  readonly channel: string;
  readonly label: string;
  /** True when a send leaves the platform. Drives extra caution. */
  readonly external: boolean;
  /**
   * A transport module exists in this repository. Says nothing about whether it
   * is registered, enabled or working.
   */
  readonly transportImplemented: boolean;
  /**
   * `registerDefaultTransports` registers it, so the dispatcher can resolve it.
   * ROUTABLE IS NOT LIVE: email is routable and ships disabled.
   */
  readonly routable: boolean;
  /** The env flag that must be true before egress, when one gates the channel. */
  readonly egressFlag: string | null;
  /**
   * Capabilities cannot be stated for this channel without naming a narrower
   * target (a social network). Every operation stays UNSUPPORTED until then.
   */
  readonly networkScoped: boolean;
  readonly operations: Readonly<Record<ChannelOperation, ChannelOperationState>>;
}

const unsupported = (basis: string): ChannelOperationState => ({ status: 'UNSUPPORTED', basis });

/**
 * The channels this platform names.
 *
 * A channel absent from here is one nothing in the repository mentions. The
 * five below are exactly the channels `transportRegistry`'s own header names as
 * either shipped or deliberately undispatchable, plus `internal`.
 */
export const CHANNEL_CAPABILITIES: readonly ChannelCapabilityDefinition[] = Object.freeze<ChannelCapabilityDefinition[]>([
  {
    channel: 'internal',
    label: 'Internal work item',
    external: false,
    transportImplemented: true,
    routable: true,
    egressFlag: null,
    networkScoped: false,
    operations: Object.freeze({
      send: {
        status: 'SUPPORTED',
        basis: 'internalTransport writes an outreach_internal_work_items row; the platform completes the write itself, so TransportResult reports deliveryStatus confirmed',
      },
      deliveryReceipt: {
        status: 'SUPPORTED',
        basis: 'the write IS the delivery — there is no third party to confirm it, which is why this channel reports confirmed rather than sent_unverified',
      },
      inboundReply: unsupported('a work item is read by an operator inside the platform; it has no inbound message path'),
      callDisposition: unsupported('not a conversational channel'),
    }),
  },
  {
    channel: 'email',
    label: 'Email',
    external: true,
    transportImplemented: true,
    routable: true,
    egressFlag: 'LEAD_OUTREACH_EMAIL_ENABLED',
    networkScoped: false,
    operations: Object.freeze({
      send: {
        status: 'NOT_CONFIGURED',
        basis: 'emailTransport is implemented and registered, and returns outcome disabled WITHOUT calling a provider unless LEAD_OUTREACH_EMAIL_ENABLED is true; registration makes the channel routable, not live',
      },
      deliveryReceipt: {
        status: 'UNVERIFIED',
        basis: 'a provider that accepts a message yields sent_unverified, not delivered; no confirmed external delivery has been observed from this platform',
      },
      inboundReply: {
        status: 'PARTIALLY_SUPPORTED',
        basis: 'feedbackIngestion accepts delivery-axis and business-axis signals including unsubscribed, so an inbound signal has a canonical path; a full reply BODY is not modelled',
      },
      callDisposition: unsupported('not a conversational channel'),
    }),
  },
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    external: true,
    transportImplemented: false,
    routable: false,
    egressFlag: null,
    networkScoped: false,
    operations: Object.freeze({
      send: {
        status: 'NOT_OPERATIONAL',
        basis: 'no transport is registered by registerDefaultTransports, so resolveTransport returns null and the dispatcher skips the channel; this is absence of a call path, not a disabled one',
      },
      deliveryReceipt: unsupported('nothing receives a WhatsApp callback'),
      inboundReply: unsupported('no inbound WhatsApp path records an event on this channel'),
      callDisposition: unsupported('not a voice channel'),
    }),
  },
  {
    channel: 'sms',
    label: 'SMS',
    external: true,
    transportImplemented: false,
    routable: false,
    egressFlag: null,
    networkScoped: false,
    operations: Object.freeze({
      send: {
        status: 'NOT_OPERATIONAL',
        basis: 'no transport is registered; resolveTransport returns null and the dispatcher skips the channel',
      },
      deliveryReceipt: unsupported('nothing receives an SMS status callback'),
      inboundReply: unsupported('no inbound SMS path records an event'),
      callDisposition: unsupported('not a voice channel'),
    }),
  },
  {
    channel: 'voice',
    label: 'Voice',
    external: true,
    transportImplemented: false,
    routable: false,
    egressFlag: null,
    networkScoped: false,
    operations: Object.freeze({
      send: {
        status: 'NOT_OPERATIONAL',
        basis: 'no transport is registered; placing a call has no implementation here',
      },
      deliveryReceipt: unsupported('a connected call is not a delivery receipt; the technical call status would be its own axis and nothing records one'),
      inboundReply: unsupported('no inbound call path records an event'),
      callDisposition: unsupported('no call outcome is recorded anywhere; this operation is declared so that a future voice channel must state it SEPARATELY from send and from any business assessment, rather than letting a technical status stand in for what a human said'),
    }),
  },
  {
    channel: 'social',
    label: 'Social',
    external: true,
    transportImplemented: false,
    routable: false,
    egressFlag: null,
    networkScoped: true,
    operations: Object.freeze({
      send: unsupported('social is not one channel: capability differs per network and cannot be stated without naming one, so no send capability is claimed at channel level'),
      deliveryReceipt: unsupported('varies per network and is unstated; several networks never confirm delivery of a direct message at all'),
      inboundReply: unsupported('varies per network; a mention, a comment and a direct-message reply are different events with different availability'),
      callDisposition: unsupported('not a voice channel'),
    }),
  },
]);

/**
 * Channels whose capability has been observed working end to end.
 *
 * Its own list, separate from the declarations above, for the same reason
 * `providerCapabilityModel` keeps `OPERATIONAL_VERIFICATIONS` separate: "we
 * built it" and "we have seen it work" are different facts, and a single field
 * lets the first quietly stand in for the second.
 *
 * EMPTY for every EXTERNAL channel. Only `internal` appears, because the
 * platform performs that write itself and the dispatch chain exercises it.
 */
interface ChannelVerification {
  readonly channel: string;
  readonly operation: ChannelOperation;
  readonly basis: string;
}

export const CHANNEL_OPERATIONAL_VERIFICATIONS: readonly ChannelVerification[] =
  Object.freeze<ChannelVerification[]>([
  {
    channel: 'internal',
    operation: 'send',
    basis: 'the WS-3 dispatch chain runs governance, quota, lifecycle, attempt, transport and evidence against internalTransport with no external egress',
  },
  {
    channel: 'internal',
    operation: 'deliveryReceipt',
    basis: 'the platform completes the write, so confirmed is the honest delivery status rather than an inference',
  },
]);

export function getChannelCapability(channel: string): ChannelCapabilityDefinition | null {
  const key = String(channel ?? '').trim().toLowerCase();
  if (!key) return null;
  return CHANNEL_CAPABILITIES.find((c) => c.channel === key) ?? null;
}

/**
 * The state of one operation on one channel.
 *
 * An UNKNOWN channel is UNSUPPORTED, not UNVERIFIED. A channel nothing in this
 * repository names cannot be "implemented but unobserved", and returning
 * UNVERIFIED would read as a capability awaiting a credential.
 */
export function getChannelOperation(channel: string, operation: ChannelOperation): ChannelOperationState {
  const definition = getChannelCapability(channel);
  if (!definition) {
    return { status: 'UNSUPPORTED', basis: `no channel '${String(channel)}' is declared in this platform` };
  }
  return definition.operations[operation];
}

/**
 * May this operation be attempted on this channel right now?
 *
 * Fails closed: an unknown channel, an unknown operation and every
 * non-attemptable status all answer false. This is a CAPABILITY answer only —
 * it says the operation could physically work, never that it is permitted.
 * Consent, suppression, quota and governance are separate gates and this
 * function is not a substitute for any of them.
 */
export function isChannelOperationAttemptable(channel: string, operation: ChannelOperation): boolean {
  if (!(CHANNEL_OPERATIONS as readonly string[]).includes(operation)) return false;
  const { status } = getChannelOperation(channel, operation);
  return !NON_ATTEMPTABLE_STATUSES.includes(status);
}

/** Has this channel operation actually been observed working? */
export function isChannelOperationallyVerified(channel: string, operation: ChannelOperation): boolean {
  const key = String(channel ?? '').trim().toLowerCase();
  return CHANNEL_OPERATIONAL_VERIFICATIONS.some((v) => v.channel === key && v.operation === operation);
}

/** Channels declaring a given operation as attemptable. Sorted, for stable reads. */
export function channelsSupporting(operation: ChannelOperation): string[] {
  return CHANNEL_CAPABILITIES
    .filter((c) => !NON_ATTEMPTABLE_STATUSES.includes(c.operations[operation].status))
    .map((c) => c.channel)
    .sort();
}

/**
 * One row per channel for an operator surface or a report.
 *
 * Deliberately carries `routable` and `egressFlag` alongside the send status, so
 * a reader can tell "switched off" from "not built" without inferring it.
 */
export interface ChannelCapabilitySummary {
  readonly channel: string;
  readonly label: string;
  readonly external: boolean;
  readonly networkScoped: boolean;
  readonly routable: boolean;
  readonly egressFlag: string | null;
  readonly operations: Readonly<Record<ChannelOperation, CapabilityStatus>>;
  readonly operationallyVerified: readonly ChannelOperation[];
}

export function summarizeChannelCapabilities(): ChannelCapabilitySummary[] {
  return CHANNEL_CAPABILITIES.map((c) => ({
    channel: c.channel,
    label: c.label,
    external: c.external,
    networkScoped: c.networkScoped,
    routable: c.routable,
    egressFlag: c.egressFlag,
    operations: Object.freeze(
      CHANNEL_OPERATIONS.reduce((acc, op) => {
        acc[op] = c.operations[op].status;
        return acc;
      }, {} as Record<ChannelOperation, CapabilityStatus>),
    ),
    operationallyVerified: CHANNEL_OPERATIONS.filter((op) => isChannelOperationallyVerified(c.channel, op)),
  }));
}
