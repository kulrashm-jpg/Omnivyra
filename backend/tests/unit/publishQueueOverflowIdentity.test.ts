/**
 * Overflow buffer — a deferred publish job keeps its queue_jobs identity.
 *
 * `applyQueueProtection` (backend/queue/bullmqClient.ts) is what every queue,
 * the publish queue included, is wrapped in. Under Redis pressure it parks jobs
 * in an in-process overflow buffer and re-adds them later through a drain
 * callback. Single adds of the publish queue are never parked (it is a
 * critical queue), but BULK adds are capped by the fan-out multiplier at
 * throttle AND critical level regardless of queue — and the safety-net cron
 * enqueues with addBulk. So a publish job CAN sit in the buffer with its
 * queue_jobs row already 'pending' and no BullMQ job behind it.
 *
 * What the reliability design relies on is that the drain re-adds the job
 * under the SAME job id — the queue_jobs row id — so that when it is finally
 * delivered, the worker reads the row a cancel may have retired meanwhile.
 * These tests pin that, through the real wrapper, with the usage-protection
 * runtime replaced by a controllable stand-in.
 */

type Entry = { name: string; data: Record<string, unknown>; opts?: { jobId?: string } };

const usage = { allowed: true, multiplier: 1 };
const overflow: Entry[] = [];
let drain: ((queueName: string, jobs: Entry[]) => Promise<void>) | null = null;

jest.mock('../../../lib/redis/usageProtection', () => ({
  startUsageProtection: jest.fn(async () => undefined),
  isQueueAllowed: jest.fn(() => usage.allowed),
  getQueueFanOutMultiplier: jest.fn(() => usage.multiplier),
  storeOverflow: jest.fn((_queueName: string, entry: Entry) => { overflow.push(entry); return true; }),
  registerOverflowDrain: jest.fn((_queueName: string, cb: (queueName: string, jobs: Entry[]) => Promise<void>) => { drain = cb; }),
}));

import type { Queue } from 'bullmq';
import { applyQueueProtection } from '../../queue/bullmqClient';

function fakePublishQueue() {
  const added: Entry[] = [];
  const queue = {
    name: 'publish',
    add: async (name: string, data: Record<string, unknown>, opts?: { jobId?: string }) => {
      added.push({ name, data, opts });
      return { id: opts?.jobId };
    },
    addBulk: async (jobs: Entry[]) => { added.push(...jobs); return jobs; },
  };
  return { queue, added };
}

const job = (queueJobId: string): Entry => ({
  name: 'publish',
  data: { scheduled_post_id: `sp-${queueJobId}`, social_account_id: 'sa', user_id: 'u' },
  opts: { jobId: queueJobId },
});

beforeEach(() => {
  usage.allowed = true;
  usage.multiplier = 1;
  overflow.length = 0;
  drain = null;
});

test('throttle: deferred publish jobs are re-added by the drain under their original queue_jobs ids', async () => {
  const { queue, added } = fakePublishQueue();
  const protectedQueue = applyQueueProtection(queue as unknown as Queue);
  usage.multiplier = 0.5;

  await protectedQueue.addBulk([job('qj-1'), job('qj-2'), job('qj-3'), job('qj-4')]);

  expect(added.map((j) => j.opts?.jobId)).toEqual(['qj-1', 'qj-2']);
  expect(overflow.map((j) => j.opts?.jobId)).toEqual(['qj-3', 'qj-4']);

  expect(drain).not.toBeNull();
  await drain!('publish', overflow.splice(0));
  expect(added.map((j) => j.opts?.jobId)).toEqual(['qj-1', 'qj-2', 'qj-3', 'qj-4']);
});

test('critical: a single publish add is never parked; a bulk add keeps one and parks the rest with their ids', async () => {
  const { queue, added } = fakePublishQueue();
  const protectedQueue = applyQueueProtection(queue as unknown as Queue);
  // isQueueAllowed is true for the publish queue at critical level (critical
  // queue); the multiplier is 0.
  usage.multiplier = 0;

  await protectedQueue.add('publish', job('qj-single').data, job('qj-single').opts);
  expect(added.map((j) => j.opts?.jobId)).toEqual(['qj-single']);

  await protectedQueue.addBulk([job('qj-1'), job('qj-2')]);
  expect(added.map((j) => j.opts?.jobId)).toEqual(['qj-single', 'qj-1']);
  expect(overflow.map((j) => j.opts?.jobId)).toEqual(['qj-2']);

  await drain!('publish', overflow.splice(0));
  expect(added.map((j) => j.opts?.jobId)).toEqual(['qj-single', 'qj-1', 'qj-2']);
});
