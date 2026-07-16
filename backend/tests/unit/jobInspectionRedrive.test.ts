/**
 * DLQ re-drive (POP-IMP-013) — controlled operator re-drive of dead-letter
 * entries. Verifies the canonical seam re-enqueues the ORIGINAL payload onto
 * the queue the worker consumes (via the existing named-queue getters), uses a
 * stable jobId for idempotency, clears the DLQ row, defaults/overrides the
 * target queue, and rejects unknown targets rather than orphaning a job.
 *
 * The DB owner and the BullMQ queue getters are mocked — this exercises the
 * re-drive orchestration, not real Redis/Postgres.
 */

const mockRows: Record<string, Record<string, unknown>> = {};
const mockAdd = jest.fn().mockResolvedValue(undefined);

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    let op: 'select' | 'delete' = 'select';
    let pendingId: string | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      delete: () => { op = 'delete'; return b; },
      eq: (_col: string, val: string) => {
        pendingId = val;
        if (op === 'delete') { delete mockRows[val]; return Promise.resolve({ error: null }); }
        return b;
      },
      maybeSingle: () => Promise.resolve({ data: pendingId ? (mockRows[pendingId] ?? null) : null, error: null }),
    };
    return b;
  },
}));

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => ({ add: mockAdd }),
  getPostingQueue: () => ({ add: mockAdd }),
  getAiHeavyQueue: () => ({ add: mockAdd }),
  getEngagementPollingQueue: () => ({ add: mockAdd }),
  getLeadThreadRecomputeQueue: () => ({ add: mockAdd }),
  getConversationMemoryRebuildQueue: () => ({ add: mockAdd }),
  makeStableJobId: (prefix: string) => `jobid:${prefix}`,
}));
jest.mock('../../queue/boltQueue', () => ({ getBoltQueue: () => ({ add: mockAdd }) }));
jest.mock('../../queue/contentGenerationQueues', () => ({
  CONTENT_QUEUE_CONFIG: { 'content-blog': {}, 'content-post': {} },
  getContentQueue: () => ({ add: mockAdd }),
}));

import { replayDeadLetterEntry, replayableQueueNames } from '../../services/jobInspection';

function seed(id: string, workerName: string, payload: Record<string, unknown> = { x: 1 }) {
  mockRows[id] = {
    id,
    worker_name: workerName,
    job_payload: payload,
    failure_reason: 'boom',
    attempt_count: 3,
    last_attempt_at: '2026-07-16T00:00:00.000Z',
    created_at: '2026-07-16T00:00:00.000Z',
  };
}

describe('DLQ re-drive — replayDeadLetterEntry', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockRows)) delete mockRows[k];
    mockAdd.mockClear();
  });

  test('missing entry throws dead_letter_not_found', async () => {
    await expect(replayDeadLetterEntry('nope')).rejects.toThrow('dead_letter_not_found');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('re-enqueues original payload onto the worker_name queue with a stable jobId, then removes the row', async () => {
    seed('e1', 'publish', { postId: 'p-9' });
    const r = await replayDeadLetterEntry('e1');
    expect(r).toEqual({
      id: 'e1', workerName: 'publish', targetQueue: 'publish', jobName: 'publish',
      jobId: 'jobid:replay:publish', enqueued: true, removed: true,
    });
    expect(mockAdd).toHaveBeenCalledWith('publish', { postId: 'p-9' }, { jobId: 'jobid:replay:publish' });
    expect(mockRows.e1).toBeUndefined(); // block cleared
  });

  test('resolves content queues via the existing content-queue getter', async () => {
    seed('e2', 'content-blog');
    const r = await replayDeadLetterEntry('e2');
    expect(r.targetQueue).toBe('content-blog');
    expect(r.enqueued).toBe(true);
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  test('operator can override the target queue when worker_name is not the queue name', async () => {
    seed('e3', 'some-worker-label', { a: 1 });
    const r = await replayDeadLetterEntry('e3', { queueName: 'ai-heavy', jobName: 'ai-heavy' });
    expect(r.targetQueue).toBe('ai-heavy');
    expect(mockAdd).toHaveBeenCalledWith('ai-heavy', { a: 1 }, { jobId: 'jobid:replay:ai-heavy' });
  });

  test('unknown target queue is rejected — never enqueued onto an orphan queue, row preserved', async () => {
    seed('e4', 'no-such-queue');
    await expect(replayDeadLetterEntry('e4')).rejects.toThrow('unknown_target_queue');
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockRows.e4).toBeDefined(); // not removed on failure
  });

  test('bolt-execution resolves to the bolt queue getter', async () => {
    seed('e5', 'bolt-execution');
    const r = await replayDeadLetterEntry('e5');
    expect(r.targetQueue).toBe('bolt-execution');
    expect(r.enqueued).toBe(true);
  });
});

describe('DLQ re-drive — replayableQueueNames', () => {
  test('advertises the existing consumed queues, including content queues', async () => {
    const names = await replayableQueueNames();
    expect(names).toEqual(expect.arrayContaining([
      'publish', 'posting', 'ai-heavy', 'bolt-execution', 'content-blog',
    ]));
  });
});
