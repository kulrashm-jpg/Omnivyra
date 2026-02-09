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

const processQueue = async () => {
  if (isProcessing || !currentHandler) return;
  isProcessing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;

    try {
      const result = await currentHandler(item.task);
      if (!result.success && item.attempts < MAX_ATTEMPTS) {
        queue.push({ ...item, attempts: item.attempts + 1 });
        continue;
      }
      item.resolve(result);
    } catch (error) {
      if (item.attempts < MAX_ATTEMPTS) {
        queue.push({ ...item, attempts: item.attempts + 1 });
        continue;
      }
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
