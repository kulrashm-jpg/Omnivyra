/**
 * BOLT Execution Job Processor
 * Runs the full BOLT pipeline for a given run_id.
 */

import { Job } from 'bullmq';
import { executeBoltPipeline } from '../../services/boltPipelineService';

export async function processBoltJob(job: Job): Promise<void> {
  const runId = job.data?.run_id;
  if (!runId || typeof runId !== 'string') {
    throw new Error('Invalid BOLT job: run_id is required');
  }

  await executeBoltPipeline(runId);
}
