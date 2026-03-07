/**
 * Trigger Intelligence Polling Enqueue
 * Run: npx ts-node backend/scripts/triggerIntelligenceEnqueue.ts
 * Enqueues polling jobs immediately (no config changes).
 */

import { enqueueIntelligencePolling } from '../scheduler/schedulerService';

async function main() {
  const result = await enqueueIntelligencePolling();
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
