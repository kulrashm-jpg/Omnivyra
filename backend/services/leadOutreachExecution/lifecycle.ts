/**
 * WS-3 Milestone-1 — lifecycle model: states, legal transitions, validation.
 *
 * VALIDATION ONLY. This module answers "is this transition legal?" — it never
 * performs one. Nothing here writes, dispatches, queues or contacts anything;
 * executing transitions belongs to later milestones.
 *
 * The transition table is DATA rather than control flow so it can be asserted
 * against directly in tests and read by a reviewer without tracing code.
 */

import type { BusinessOutcomeType, DeliveryStatus, OutreachTaskStatus } from './types';

/** Every legal state, in lifecycle order. Mirrors the DB CHECK constraint. */
export const OUTREACH_TASK_STATUSES: readonly OutreachTaskStatus[] = [
  'pending',
  'awaiting_approval',
  'approved',
  'rejected',
  'queued',
  'dispatching',
  'sent',
  'delivered',
  'completed',
  'failed',
  'retried',
  'paused',
  'resumed',
  'escalated',
  'reassigned',
  'cancelled',
  'expired',
] as const;

/**
 * Terminal states. Nothing exits one — a regenerated plan produces a NEW task
 * rather than reviving a finished one.
 */
export const TERMINAL_STATUSES: readonly OutreachTaskStatus[] = [
  'completed',
  'rejected',
  'cancelled',
  'expired',
] as const;

/**
 * States that are transitions rather than resting places. Recorded for audit,
 * they resolve immediately and deterministically to their successor; no task
 * may be observed resting in one.
 */
export const TRANSIENT_STATUSES: readonly OutreachTaskStatus[] = ['retried', 'resumed', 'reassigned'] as const;

/** The complete legal transition table from the frozen architecture. */
export const ALLOWED_TRANSITIONS: Readonly<Record<OutreachTaskStatus, readonly OutreachTaskStatus[]>> = {
  pending: ['awaiting_approval', 'queued', 'cancelled', 'expired'],
  awaiting_approval: ['approved', 'rejected', 'cancelled', 'expired'],
  approved: ['queued', 'cancelled', 'expired'],
  rejected: [],
  queued: ['dispatching', 'paused', 'cancelled', 'expired'],
  dispatching: ['sent', 'failed'],
  sent: ['delivered', 'failed', 'completed'],
  delivered: ['completed'],
  completed: [],
  failed: ['retried', 'escalated', 'cancelled'],
  retried: ['queued'],
  paused: ['resumed', 'cancelled'],
  resumed: ['queued'],
  escalated: ['reassigned', 'cancelled'],
  reassigned: ['pending', 'queued'],
  cancelled: [],
  expired: [],
};

export const isTerminalStatus = (s: OutreachTaskStatus): boolean => TERMINAL_STATUSES.includes(s);
export const isTransientStatus = (s: OutreachTaskStatus): boolean => TRANSIENT_STATUSES.includes(s);
export const isOutreachTaskStatus = (v: unknown): v is OutreachTaskStatus =>
  typeof v === 'string' && (OUTREACH_TASK_STATUSES as readonly string[]).includes(v);

/** Legality check only — performs nothing. */
export function isTransitionAllowed(from: OutreachTaskStatus, to: OutreachTaskStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Human-readable rejection reason, for audit and error messages. */
export function explainTransition(from: OutreachTaskStatus, to: OutreachTaskStatus): string {
  if (isTransitionAllowed(from, to)) return `${from} → ${to} is permitted`;
  if (isTerminalStatus(from)) return `${from} is terminal; no transition out of it is permitted`;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  return allowed.length === 0
    ? `${from} has no permitted transitions`
    : `${from} → ${to} is not permitted (allowed: ${allowed.join(', ')})`;
}

// ── Delivery axis ───────────────────────────────────────────────────────────

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'queued', 'dispatched', 'confirmed', 'sent_unverified', 'delivered',
  'bounced', 'failed', 'suppressed', 'expired',
] as const;

/**
 * The delivery axis is monotonic — it never moves backwards. Encoded as legal
 * successors so "monotonic" is checkable rather than merely asserted.
 */
export const ALLOWED_DELIVERY_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  queued: ['dispatched', 'suppressed', 'expired', 'failed'],
  dispatched: ['confirmed', 'sent_unverified', 'failed'],
  confirmed: ['delivered', 'bounced'],
  sent_unverified: ['delivered', 'bounced'],
  delivered: [],
  bounced: [],
  failed: [],
  suppressed: [],
  expired: [],
};

export const isDeliveryStatus = (v: unknown): v is DeliveryStatus =>
  typeof v === 'string' && (DELIVERY_STATUSES as readonly string[]).includes(v);

export function isDeliveryTransitionAllowed(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return (ALLOWED_DELIVERY_TRANSITIONS[from] ?? []).includes(to);
}

// ── Business axis ───────────────────────────────────────────────────────────

export const BUSINESS_OUTCOME_TYPES: readonly BusinessOutcomeType[] = [
  'opened', 'clicked', 'replied', 'meeting_booked', 'rejected', 'no_response',
  // WS-3 M7 — see types.ts on why `unsubscribed` is not folded into `rejected`.
  'unsubscribed', 'converted',
] as const;

export const isBusinessOutcomeType = (v: unknown): v is BusinessOutcomeType =>
  typeof v === 'string' && (BUSINESS_OUTCOME_TYPES as readonly string[]).includes(v);
