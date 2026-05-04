import { randomUUID } from 'crypto';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import type { RegisteredJobId } from './jobRegistry';

export type DeadLetterInput = {
  job_id: RegisteredJobId | string;
  queue_name?: string | null;
  payload: Record<string, unknown>;
  error_message: string;
  idempotency_key?: string | null;
  trigger_source?: string | null;
};

export async function writeDeadLetter(input: DeadLetterInput): Promise<string> {
  const id = randomUUID();
  const row = {
    id,
    worker_name: input.job_id,
    job_payload: {
      queue_name: input.queue_name ?? null,
      payload: input.payload,
      idempotency_key: input.idempotency_key ?? null,
      trigger_source: input.trigger_source ?? null,
      replay_count: 0,
      status: 'dead_lettered',
    },
    failure_reason: input.error_message,
    attempt_count: 1,
    last_attempt_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('worker_dead_letter_queue').insert(row);
  if (error) {
    console.error(JSON.stringify({ event: 'job_dlq_failed', job_id: input.job_id, error: error.message }));
    throw error;
  }
  console.error(JSON.stringify({ event: 'job_dlq', job_id: input.job_id, dlq_id: id }));
  return id;
}
