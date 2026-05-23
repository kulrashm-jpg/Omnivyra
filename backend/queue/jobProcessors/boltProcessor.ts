/**
 * BOLT Execution Job Processor
 * Runs the full BOLT pipeline for a given run_id.
 */

import { Job } from 'bullmq';
import { executeBoltPipeline } from '../../services/boltPipelineService';
import { emitStructuredEvent } from '../../../observability/runtime/structuredTelemetry';

export async function processBoltJob(job: Job): Promise<void> {
  const runId = job.data?.run_id;
  if (!runId || typeof runId !== 'string') {
    throw new Error('Invalid BOLT job: run_id is required');
  }

  // Worker pickup event. Closes the run_id → bullmq job_id correlation
  // gap so log aggregators can join "[provenance] worker boot" →
  // "bolt_worker_pickup" → "[bolt/plan-input]" → … → "bolt_run_completed"
  // by run_id alone, without manually joining BullMQ job UUIDs to BOLT
  // run UUIDs. Single emission per pickup; payload kept minimal.
  emitStructuredEvent(
    'bolt_worker_pickup',
    'info',
    { run_id: runId, planner_stage: 'queue-pickup' },
    {
      bullmq_job_id: job.id,
      queue_name: job.queueName,
      attempts_made: job.attemptsMade,
    },
  );

  await executeBoltPipeline(runId);
}
