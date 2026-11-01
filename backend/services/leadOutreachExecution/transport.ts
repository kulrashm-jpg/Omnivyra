/**
 * WS-3 Milestone-5B — the transport interface.
 *
 * ONE dispatcher, many transports. The runtime resolves a transport by channel
 * and calls this interface; it contains no provider logic and no per-channel
 * branching. A future channel plugs in here without the dispatcher changing —
 * which is the point, because every `if (channel === …)` in a dispatcher is a
 * place a future channel can be sent down the wrong path.
 *
 * A transport's ONLY job is to attempt delivery and report what happened. It
 * does not decide whether it should run (governance did), consume quota (the
 * runtime did), record attempts, or transition the task. It receives an
 * already-authorised request and returns a classified outcome.
 */

import type { OutreachTask } from './types';

/**
 * Transport outcome classes. Closed set.
 *
 * `accepted` means the provider took responsibility for the message — NOT that
 * anyone received it. That distinction is the whole reason the delivery axis
 * separates `sent_unverified` from `delivered`, and conflating them would make
 * every external send look successful.
 */
export type TransportOutcome =
  | 'accepted'
  | 'rejected'
  | 'timeout'
  | 'provider_error'
  | 'transport_error'
  | 'disabled';

export interface TransportRequest {
  task: OutreachTask;
  /** The durable attempt this request belongs to. One attempt, one request. */
  attemptId: string | null;
  attemptNumber: number;
  /**
   * Deterministic provider idempotency key. Derived from identity, never from
   * time or randomness, so a repeated request for the same attempt carries the
   * same key and the provider can refuse the duplicate itself.
   */
  idempotencyKey: string;
  /** Resolved recipient. Absent for channels that do not address a person. */
  recipient: string | null;
  /** Injected instant — transports never read the clock. */
  at: string;
}

export interface TransportResult {
  outcome: TransportOutcome;
  /** Provider identity, e.g. `internal_work_item`, `ses`. */
  provider: string;
  /** Identifier the provider issued, when it issued one. */
  providerMessageId: string | null;
  /**
   * Delivery status to record. `confirmed` only when the platform itself
   * completed the write; `sent_unverified` when a third party accepted it.
   */
  deliveryStatus: 'confirmed' | 'sent_unverified' | 'failed' | 'bounced';
  /** Raw-ish provider response, redacted of message content. */
  response: Record<string, unknown>;
  /** True when the provider (or our own guard) recognised a repeat. */
  duplicate: boolean;
  error?: string;
  /** Provider round-trip, milliseconds. */
  latencyMs?: number;
}

/** What a channel transport must implement. */
export interface OutreachTransport {
  /** Channel this transport serves, matching `OutreachTask.channel`. */
  readonly channel: string;
  /** Provider identity recorded on evidence. */
  readonly provider: string;
  /** True when the transport leaves the platform. Drives extra caution. */
  readonly external: boolean;
  /**
   * Attempt delivery. MUST NOT throw — every failure is a classified outcome,
   * because a thrown transport is a transport whose evidence never got written.
   */
  send(request: TransportRequest): Promise<TransportResult>;
}

// ── registry ────────────────────────────────────────────────────────────────

const registry = new Map<string, OutreachTransport>();

/** Register a transport for its channel. Last registration wins (tests). */
export function registerTransport(transport: OutreachTransport): void {
  registry.set(transport.channel, transport);
}

/** Resolve the transport for a channel, or null when none serves it. */
export function resolveTransport(channel: string | null): OutreachTransport | null {
  if (!channel) return null;
  return registry.get(channel) ?? null;
}

/** Channels with a registered transport, sorted. */
export function supportedChannels(): string[] {
  return [...registry.keys()].sort();
}

/** Test seam: drop all registrations. */
export function __clearTransportsForTests(): void {
  registry.clear();
}

/**
 * Deterministic provider idempotency key.
 *
 * Derived ONLY from identity — tenant, task and attempt number. No timestamp,
 * no random component, no hostname. A repeated request for the same attempt
 * therefore produces a byte-identical key, so a provider that honours
 * idempotency keys will refuse the duplicate even if every guard above it
 * somehow failed. That is the last line of defence against a double send.
 */
export function buildIdempotencyKey(companyId: string, taskId: string, attemptNumber: number): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('crypto') as typeof import('crypto');
  return `ws3-${createHash('sha256').update(`${companyId}:${taskId}:${attemptNumber}`).digest('hex').slice(0, 40)}`;
}
