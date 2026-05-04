import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getJobRegistryEntry, type RegisteredJobId } from './jobRegistry';

export async function replayDeadLetter(
  dlqId: string,
  reason: string,
  enqueue: (jobId: RegisteredJobId, payload: Record<string, unknown>, idempotencyKey: string | null) => Promise<void>,
): Promise<{ replayed: boolean; reason?: string }> {
  const { data, error } = await supabase
    .from('worker_dead_letter_queue')
    .select('*')
    .eq('id', dlqId)
    .maybeSingle();
  if (error || !data) return { replayed: false, reason: 'missing_dlq_row' };

  const jobId = data.worker_name as RegisteredJobId;
  const jobPayload = (data.job_payload ?? {}) as Record<string, any>;
  const entry = getJobRegistryEntry(jobId);
  if (!entry.replayable) return { replayed: false, reason: 'job_not_replayable' };
  const replayCount = Number(jobPayload.replay_count ?? 0);
  if (replayCount >= entry.dlq_policy.max_replays) {
    return { replayed: false, reason: 'max_replays_exceeded' };
  }

  await enqueue(jobId, jobPayload.payload ?? {}, jobPayload.idempotency_key ?? null);
  await supabase
    .from('worker_dead_letter_queue')
    .update({
      job_payload: {
        ...jobPayload,
        replay_count: replayCount + 1,
        replay_reason: reason,
        status: 'replayed',
        replayed_at: new Date().toISOString(),
      },
    })
    .eq('id', dlqId);

  console.info(JSON.stringify({ event: 'job_replayed', job_id: jobId, dlq_id: dlqId, reason }));
  return { replayed: true };
}
