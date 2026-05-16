/**
 * Billing Idempotency Service — Phase A
 *
 * Single source of truth for idempotency-key construction across the billing
 * surface. Wraps the existing makeIdempotencyKey() from creditExecutionService
 * with policy-aware variants for different caller classes.
 *
 *   - HTTP-route caller  → request fingerprint (body hash + actor + action)
 *   - Queue job          → deterministic from (queueName, jobId, payloadFp)
 *   - Webhook            → provider event ID (already unique per provider)
 *   - Background engine  → time-bucket scoped to smart-mode dedup window
 *
 * The orchestrator MUST be the only emitter of new keys — direct calls to
 * makeIdempotencyKey() elsewhere are an anti-pattern that this service
 * exists to replace.
 */

import { createHash } from 'crypto';
import { makeIdempotencyKey } from '../creditExecutionService';
import { fingerprintPayload } from './billingCorrelationService';

export interface HttpKeyArgs {
  kind:        'http';
  actorUserId: string;
  action:      string;
  referenceId: string;
  requestBody?: unknown;            // hashed for fingerprint
  requestHeaderIdempotency?: string; // honors Idempotency-Key header
}

export interface QueueKeyArgs {
  kind:               'queue';
  queueName:          string;
  jobId:              string;
  organizationId:     string;
  action:             string;
  payloadFingerprint: string;       // from billingCorrelationService.fingerprintPayload
}

export interface WebhookKeyArgs {
  kind:           'webhook';
  provider:       string;
  providerEventId: string;
}

export interface CronKeyArgs {
  kind:               'cron';
  cronName:           string;
  organizationId?:    string;
  action:             string;
  bucketSeconds:      number;       // e.g. 86400 for daily, 3600 for hourly
}

export type BillingIdempotencyArgs =
  | HttpKeyArgs
  | QueueKeyArgs
  | WebhookKeyArgs
  | CronKeyArgs;

export interface BillingIdempotencyKey {
  /** The root key — used for billing_operations row and ledger HOLD/CONFIRM/RELEASE base */
  root: string;
  /** Phase keys, derived from root */
  hold:    string;
  confirm: string;
  release: string;
  /** Source descriptor (for logging / audit) */
  source:  string;
}

export function buildBillingIdempotencyKey(args: BillingIdempotencyArgs): BillingIdempotencyKey {
  const root = computeRoot(args);
  return {
    root,
    hold:    `${root}:hold`,
    confirm: `${root}:confirm`,
    release: `${root}:release`,
    source:  describeSource(args),
  };
}

function computeRoot(args: BillingIdempotencyArgs): string {
  switch (args.kind) {
    case 'http': {
      const bodyFp = args.requestBody !== undefined ? hash(JSON.stringify(args.requestBody)) : '';
      // The Idempotency-Key header, when present, becomes part of the salt so
      // distinct retries with the same body but different keys produce
      // distinct operations.
      const salt = args.requestHeaderIdempotency ?? bodyFp;
      return makeIdempotencyKey(args.actorUserId, args.action, args.referenceId, salt);
    }
    case 'queue': {
      // Job ID + payload fingerprint = exactly-once-per-(job, payload).
      // Bull retries with the same job id + same payload are absorbed; if the
      // payload changes (which shouldn't happen for a retry) we treat it as a
      // distinct work unit.
      return makeIdempotencyKey(
        args.organizationId,
        args.action,
        `${args.queueName}::${args.jobId}`,
        args.payloadFingerprint,
      );
    }
    case 'webhook': {
      // Provider events already unique per (provider, providerEventId). The
      // payment_provider_events table enforces this at DB level.
      return makeIdempotencyKey(args.provider, 'webhook', args.providerEventId);
    }
    case 'cron': {
      const bucket = Math.floor(Date.now() / (args.bucketSeconds * 1000)).toString();
      const orgScope = args.organizationId ?? 'global';
      return makeIdempotencyKey(args.cronName, args.action, orgScope, bucket);
    }
  }
}

function describeSource(args: BillingIdempotencyArgs): string {
  switch (args.kind) {
    case 'http':    return `http:${args.action}:actor=${args.actorUserId}`;
    case 'queue':   return `queue:${args.queueName}:job=${args.jobId}`;
    case 'webhook': return `webhook:${args.provider}:event=${args.providerEventId}`;
    case 'cron':    return `cron:${args.cronName}:bucket=${args.bucketSeconds}s`;
  }
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

/** Convenience: fingerprint helper re-exported so callers don't import from two places. */
export { fingerprintPayload };
