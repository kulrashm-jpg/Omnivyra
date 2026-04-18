/**
 * WhatsApp Broadcast Job Processor
 *
 * Handles `wa-broadcast-batch` jobs from the `whatsapp-broadcast` queue.
 * Each job contains a broadcast_id + array of recipient_ids to send to.
 * Delegates to processBatch() in whatsappBroadcastService.
 */

import type { Job } from 'bullmq';
import { processBatch } from '../../services/whatsappBroadcastService';

export interface WaBroadcastBatchJob {
  broadcast_id:  string;
  recipient_ids: string[];
}

export async function processWhatsAppBroadcastJob(job: Job<WaBroadcastBatchJob>): Promise<void> {
  const { broadcast_id, recipient_ids } = job.data;

  if (!broadcast_id || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
    throw new Error(`[wa-broadcast-processor] Invalid job data: ${JSON.stringify(job.data)}`);
  }

  console.info('[wa-broadcast-processor][start]', {
    jobId:         job.id,
    broadcast_id,
    recipient_count: recipient_ids.length,
  });

  await processBatch(broadcast_id, recipient_ids);

  console.info('[wa-broadcast-processor][done]', {
    jobId:         job.id,
    broadcast_id,
    recipient_count: recipient_ids.length,
  });
}
