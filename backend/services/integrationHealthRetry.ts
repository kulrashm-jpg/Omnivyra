/**
 * Lightweight retry wrapper around runIntegrationHealthCheck.
 *
 * Deliberately minimal — no distributed queue, no circuit breaker, no
 * orchestration. Just: catch transient errors, retry up to twice with
 * short exponential backoff, emit timeline events at each step so an
 * operator can see what happened.
 *
 * Retry policy:
 *   - max 2 retries (so up to 3 total attempts)
 *   - delays: 500ms, 1500ms
 *   - retry ONLY for errors whose message matches a TRANSIENT_ERROR
 *     fingerprint (network blip, 429, "temporary failure" etc.)
 *   - never retry invalid_credentials, permission lost, malformed
 *     config, or any error we can deterministically classify as
 *     permanent
 *
 * Timeline emission (no-ops if the migration isn't applied yet):
 *   - retry_started  before each retry attempt
 *   - retry_succeeded when a retry attempt finally returned healthy
 *   - retry_failed   after the final attempt still failed
 *   - failed         when the first attempt failed with a non-transient
 *                    error (no retry occurred)
 */

import { runIntegrationHealthCheck, type IntegrationHealthStatus } from './integrationHealthService';
import { emitIntegrationEvent } from './integrationEventService';

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1500];

const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i,   // network
  /\bfetch failed\b|\bnetwork\b|\btimeout\b/i,                 // generic
  /\b429\b|rate.?limit|too.?many.?requests/i,                 // throttle
  /\b502\b|\b503\b|\b504\b/i,                                  // upstream blip
  /temporarily.?unavailable|temporary failure/i,
];

const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /invalid_grant|refresh.?token|token.?expired|unauthorized_client/i,
  /\b401\b|\b403\b/i,
  /forbidden|insufficient.?scope|permission.?denied/i,
  /HTTPS_REQUIRED|wp-admin|REST_DISABLED/i,
  /invalid.?credentials/i,
];

function isTransient(message: string | null | undefined): boolean {
  if (!message) return false;
  if (PERMANENT_ERROR_PATTERNS.some((p) => p.test(message))) return false;
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(message));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RetryableHealthCheckInput {
  companyId: string;
  connectionId: string;
  integrationId: string;
  provider: string;
}

export interface RetryableHealthCheckResult {
  status: IntegrationHealthStatus;
  message: string;
  attempts: number;
  retried: boolean;
  retry_attempts_made: number;
}

/**
 * Run the existing provider health check with light transient-retry.
 * Always returns — never throws. Errors thrown by the underlying check
 * are treated as a 'failed' outcome at that attempt.
 */
export async function runIntegrationHealthCheckWithRetry(
  input: RetryableHealthCheckInput,
): Promise<RetryableHealthCheckResult> {
  let lastError: string | null = null;
  let lastStatus: IntegrationHealthStatus = 'failed';
  let retriesMade = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      void emitIntegrationEvent({
        integration_id: input.integrationId,
        company_id: input.companyId,
        provider: input.provider,
        event_type: 'retry_started',
        event_status: 'info',
        message: `Retry attempt ${attempt} of ${MAX_RETRIES} after transient failure`,
        metadata: { prior_error: lastError ? lastError.slice(0, 200) : null },
      });
      retriesMade += 1;
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1500);
    }

    let attemptStatus: IntegrationHealthStatus;
    let attemptMessage: string;
    try {
      const result = await runIntegrationHealthCheck({
        companyId: input.companyId,
        connectionId: input.connectionId,
      });
      attemptStatus = result.status;
      attemptMessage = result.message;
    } catch (err) {
      attemptStatus = 'failed';
      attemptMessage = err instanceof Error ? err.message : String(err);
    }

    lastStatus = attemptStatus;
    lastError = attemptMessage;

    if (attemptStatus === 'healthy') {
      if (attempt > 0) {
        // We recovered after at least one retry. Emit both retry_succeeded
        // (for retry-loop telemetry) and recovered (for the integration
        // lifecycle stream).
        void emitIntegrationEvent({
          integration_id: input.integrationId,
          company_id: input.companyId,
          provider: input.provider,
          event_type: 'retry_succeeded',
          event_status: 'success',
          message: `Healthy after ${attempt} retry attempt${attempt === 1 ? '' : 's'}`,
        });
        void emitIntegrationEvent({
          integration_id: input.integrationId,
          company_id: input.companyId,
          provider: input.provider,
          event_type: 'recovered',
          event_status: 'success',
          message: attemptMessage,
        });
      } else {
        void emitIntegrationEvent({
          integration_id: input.integrationId,
          company_id: input.companyId,
          provider: input.provider,
          event_type: 'validated',
          event_status: 'success',
          message: attemptMessage,
        });
      }
      return { status: attemptStatus, message: attemptMessage, attempts: attempt + 1, retried: attempt > 0, retry_attempts_made: retriesMade };
    }

    // Non-healthy outcome: decide whether to retry.
    if (attempt >= MAX_RETRIES) break;
    if (!isTransient(attemptMessage)) {
      // Permanent failure — don't waste retries on it.
      break;
    }
    // Loop continues: next iteration will emit retry_started and sleep.
  }

  // Exhausted retries OR refused to retry. Emit the appropriate terminal event.
  if (retriesMade > 0) {
    void emitIntegrationEvent({
      integration_id: input.integrationId,
      company_id: input.companyId,
      provider: input.provider,
      event_type: 'retry_failed',
      event_status: 'error',
      message: `Still failing after ${retriesMade} retry attempt${retriesMade === 1 ? '' : 's'}`,
      metadata: { final_message: lastError ? lastError.slice(0, 200) : null },
    });
  } else {
    void emitIntegrationEvent({
      integration_id: input.integrationId,
      company_id: input.companyId,
      provider: input.provider,
      event_type: 'failed',
      event_status: 'error',
      message: lastError ?? 'Health check failed',
      metadata: { transient: false },
    });
  }

  return {
    status: lastStatus,
    message: lastError ?? 'Health check failed',
    attempts: retriesMade + 1,
    retried: retriesMade > 0,
    retry_attempts_made: retriesMade,
  };
}

// Re-export the transient classifier so the audit script / UI can show
// "would retry" / "would not retry" hints without re-implementing the
// regex list.
export function isTransientErrorMessage(message: string | null | undefined): boolean {
  return isTransient(message);
}
