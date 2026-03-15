/**
 * Worker Retry Service
 * Retry policy and dead letter queue for background workers.
 */

import { supabase } from '../db/supabaseClient';

const MAX_ATTEMPTS = 3;

export function shouldRetry(attemptCount: number): boolean {
  return attemptCount < MAX_ATTEMPTS;
}

function sanitizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err.slice(0, 2000);
  try {
    return String(err).slice(0, 2000);
  } catch {
    return 'unknown error';
  }
}

export async function recordFailure(
  workerName: string,
  payload: Record<string, unknown>,
  error: unknown
): Promise<{ moved: boolean; attemptCount: number }> {
  const failureReason = sanitizeError(error);
  const attemptCount = 1;
  await moveToDeadLetter(workerName, payload, failureReason, attemptCount);
  return { moved: true, attemptCount };
}

export async function moveToDeadLetter(
  workerName: string,
  payload: Record<string, unknown>,
  error: string | Error,
  attemptCount: number = MAX_ATTEMPTS
): Promise<void> {
  const failureReason = typeof error === 'string' ? error : sanitizeError(error);
  try {
    await supabase.from('worker_dead_letter_queue').insert({
      worker_name: workerName,
      job_payload: payload ?? {},
      failure_reason: failureReason.slice(0, 4000),
      attempt_count: attemptCount,
      last_attempt_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[workerRetryService] moveToDeadLetter insert error', (err as Error)?.message);
  }
}

export async function executeWithRetry<T>(
  workerName: string,
  jobPayload: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  let attemptCount = 0;
  let lastError: unknown;
  while (true) {
    try {
      attemptCount++;
      return await fn();
    } catch (err) {
      lastError = err;
      if (shouldRetry(attemptCount)) {
        continue;
      }
      await moveToDeadLetter(workerName, jobPayload, err, attemptCount);
      throw err;
    }
  }
}
