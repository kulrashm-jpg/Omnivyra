import type { RpaTask, RpaResult } from './rpaWorkerService';

type QueueItem = {
  task: RpaTask;
  attempts: number;
  resolve: (value: RpaResult | PromiseLike<RpaResult>) => void;
  reject: (reason?: any) => void;
};

const MAX_ATTEMPTS = 2;

const queue: QueueItem[] = [];
let isProcessing = false;

let currentHandler: ((task: RpaTask) => Promise<RpaResult>) | null = null;

/**
 * In-process retry is permitted ONLY for outcomes that provably did not reach
 * the platform (the handler said `may_have_acted: false`), that are not a
 * cancellation, and that were not deferred to the durable retry queue.
 * Anything else — a post-submit failure, an unclassified failure, or a thrown
 * error — may have acted and is returned to the caller as-is, never re-run.
 */
export const isInProcessRetryable = (result: RpaResult | null | undefined): boolean =>
  !!result &&
  result.success === false &&
  result.may_have_acted === false &&
  result.deferred !== true &&
  result.error !== 'RPA_CANCELLED';

const processQueue = async () => {
  if (isProcessing || !currentHandler) return;
  isProcessing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;

    try {
      const result = await currentHandler(item.task);
      if (isInProcessRetryable(result) && item.attempts < MAX_ATTEMPTS) {
        queue.push({ ...item, attempts: item.attempts + 1 });
        continue;
      }
      item.resolve(result);
    } catch (error) {
      // A throw is unclassified: the browser may have submitted. Never retry.
      item.reject(error);
    }
  }

  isProcessing = false;
  if (queue.length > 0) {
    void processQueue();
  }
};

export const startRpaWorker = (handler: (task: RpaTask) => Promise<RpaResult>) => {
  currentHandler = handler;
  void processQueue();
};

export const enqueueRpaTask = (task: RpaTask) => {
  return new Promise<RpaResult>((resolve, reject) => {
    if (!currentHandler) {
      reject(new Error('RPA_WORKER_NOT_STARTED'));
      return;
    }
    queue.push({ task, attempts: 1, resolve, reject });
    void processQueue();
  });
};
