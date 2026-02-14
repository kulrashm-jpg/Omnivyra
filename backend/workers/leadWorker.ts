/**
 * Lead Jobs Worker
 * Processes lead-jobs from BullMQ queue. Handles execution and timeout recovery.
 *
 * Run: npm run worker:leads
 * Requires: REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (optional) or REDIS_URL
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { Worker } from 'bullmq';
import { supabase } from '../db/supabaseClient';
import { processLeadJobV1 } from '../services/leadJobProcessor';
import { leadQueueConnection } from '../queue/leadQueue';

const TIMEOUT_RECOVERY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STUCK_JOB_AGE_MINUTES = 15;

const worker = new Worker(
  'lead-jobs',
  async (job) => {
    const { jobId } = job.data as { jobId: string };
    if (!jobId) {
      throw new Error('Missing jobId in job data');
    }

    console.info({ jobId, event: 'worker_start' });

    await supabase
      .from('lead_jobs_v1')
      .update({ status: 'RUNNING', progress_stage: 'INITIALIZING' })
      .eq('id', jobId);

    try {
      await processLeadJobV1(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase
        .from('lead_jobs_v1')
        .update({
          status: 'FAILED',
          error: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      throw error;
    }
  },
  {
    connection: leadQueueConnection,
    concurrency: 1,
  }
);

worker.on('completed', (job) => {
  console.info({ jobId: job.id, event: 'job_completed', leadJobId: (job.data as { jobId: string }).jobId });
});

worker.on('failed', (job, err) => {
  console.info({ jobId: job?.id, event: 'job_failed', err: err?.message });
});

worker.on('error', (err) => {
  console.error({ event: 'worker_error', err: err.message });
});

async function runTimeoutRecovery(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_AGE_MINUTES * 60 * 1000).toISOString();
  const { data: stuck, error } = await supabase
    .from('lead_jobs_v1')
    .select('id')
    .eq('status', 'RUNNING')
    .lt('created_at', cutoff);

  if (error) {
    console.error({ event: 'timeout_recovery_error', err: error.message });
    return;
  }

  if (stuck && stuck.length > 0) {
    for (const { id } of stuck) {
      await supabase
        .from('lead_jobs_v1')
        .update({
          status: 'FAILED',
          error: 'Timeout recovery',
          completed_at: new Date().toISOString(),
        })
        .eq('id', id);
    }
    console.info({ event: 'timeout_recovery', count: stuck.length, jobIds: stuck.map((r) => r.id) });
  }
}

const timeoutInterval = setInterval(runTimeoutRecovery, TIMEOUT_RECOVERY_INTERVAL_MS);

const shutdown = async (signal: string) => {
  clearInterval(timeoutInterval);
  console.info({ event: 'shutdown', signal });
  await worker.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.info('Lead worker started. Listening for jobs.');
