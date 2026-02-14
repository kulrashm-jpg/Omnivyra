import 'dotenv/config';
import { Worker } from 'bullmq';
import { supabase } from '../db/supabaseClient';

console.log('ENV CHECK:', process.env.SUPABASE_URL);

console.info('🚀 Engine Worker started...');

const worker = new Worker(
  'engine-jobs',
  async job => {
    const { type, jobId } = job.data;

    console.info('Processing job', type, jobId);

    if (type === 'LEAD') {
      const { processLeadJobV1 } = await import('../services/leadJobProcessor');
      await processLeadJobV1(jobId);
    }

    if (type === 'MARKET_PULSE') {
      const { processMarketPulseJobV1 } = await import('../services/marketPulseJobProcessor');
      await processMarketPulseJobV1(jobId);
    }

    console.info('Finished job', type, jobId);
  },
  {
    connection: {
      host: '127.0.0.1',
      port: 6379,
    },
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
