import { enqueueRpaTask, startRpaWorker } from './rpaTaskQueue';

export type RpaTask = {
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: 'reply' | 'like' | 'share' | 'follow' | 'schedule';
  target_url: string;
  text?: string | null;
  action_id: string;
};

export type RpaResult = {
  success: boolean;
  screenshot_path?: string;
  error?: string;
};

type RpaHandler = (task: RpaTask) => Promise<RpaResult>;

const normalizePlatform = (platform: string) => platform.trim().toLowerCase();

const handlers: Record<string, RpaHandler> = {
  facebook: async () => ({ success: false, error: 'RPA_NOT_IMPLEMENTED' }),
  instagram: async () => ({ success: false, error: 'RPA_NOT_IMPLEMENTED' }),
  twitter: async () => ({ success: false, error: 'RPA_NOT_IMPLEMENTED' }),
  reddit: async () => ({ success: false, error: 'RPA_NOT_IMPLEMENTED' }),
  linkedin: async () => ({ success: false, error: 'RPA_NOT_IMPLEMENTED' }),
};

const validateTask = (task: RpaTask) => {
  if (!task?.tenant_id) return { ok: false, error: 'TENANT_ID_REQUIRED' };
  if (!task?.organization_id) return { ok: false, error: 'ORGANIZATION_ID_REQUIRED' };
  if (!task?.platform) return { ok: false, error: 'PLATFORM_REQUIRED' };
  if (!task?.action_type) return { ok: false, error: 'ACTION_TYPE_REQUIRED' };
  if (!task?.target_url) return { ok: false, error: 'TARGET_URL_REQUIRED' };
  if (!task?.action_id) return { ok: false, error: 'ACTION_ID_REQUIRED' };
  return { ok: true };
};

export const executeRpaTask = async (task: RpaTask): Promise<RpaResult> => {
  const validation = validateTask(task);
  if (!validation.ok) {
    return { success: false, error: validation.error };
  }

  const handler = handlers[normalizePlatform(task.platform)];
  if (!handler) {
    return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED' };
  }

  startRpaWorker(async (queuedTask) => {
    const taskHandler = handlers[normalizePlatform(queuedTask.platform)];
    if (!taskHandler) {
      return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED' };
    }
    return taskHandler(queuedTask);
  });

  try {
    return await enqueueRpaTask(task);
  } catch (error: any) {
    return { success: false, error: error?.message || 'RPA_QUEUE_FAILED' };
  }
};
