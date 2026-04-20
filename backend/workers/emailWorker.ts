import { processPendingEmailJobs } from '../services/emailService';
import { logger } from '../services/logger';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runEmailWorker(pollIntervalMs = 5_000, batchSize = 20, workerId?: string): Promise<never> {
  const resolvedWorkerId = workerId || `email-worker-${process.pid}`;
  logger.info('email_worker_started', { workerId: resolvedWorkerId, pollIntervalMs, batchSize });

  while (true) {
    try {
      const processed = await processPendingEmailJobs(batchSize, resolvedWorkerId);
      logger.info('email_worker_cycle_complete', { workerId: resolvedWorkerId, processed });
    } catch (error: any) {
      logger.error('email_worker_cycle_failed', {
        workerId: resolvedWorkerId,
        message: error?.message ?? String(error),
      });
    }
    await sleep(pollIntervalMs);
  }
}

if (require.main === module) {
  void runEmailWorker();
}
