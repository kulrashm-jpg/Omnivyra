import { Worker } from 'bullmq';
import { getRedisConfig } from './bullmqClient';

console.info('[engine-worker] starting...');

const worker = new Worker(
  'engine-jobs',
  async job => {
    const { type, jobId } = job.data;

    console.info('[engine-worker] processing', { type, jobId });

    if (type === 'LEAD') {
      const { processLeadJobV1 } = await import('../services/leadJobProcessor');
      await processLeadJobV1(jobId);
    }

    if (type === 'MARKET_PULSE') {
      const { processMarketPulseJobV1 } = await import('../services/marketPulseJobProcessor');
      await processMarketPulseJobV1(jobId);
    }

    console.info('[engine-worker] finished', { type, jobId });
  },
  {
    connection: getRedisConfig(),
  }
);

worker.on('completed', job => {
  console.info('BULLMQ COMPLETED EVENT', job.id);
});

worker.on('failed', (job, err) => {
  console.error('BULLMQ FAILED EVENT', job?.id, err);
});

worker.on('error', err => {
  console.error('Worker error:', err);
});
