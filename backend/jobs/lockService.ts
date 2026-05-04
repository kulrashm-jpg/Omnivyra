import IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { getConnectionConfig } from '../queue/bullmqClient';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

let redis: IORedis | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms).unref?.();
    }),
  ]);
}

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(getConnectionConfig());
    redis.on('error', () => {});
  }
  return redis;
}

export type AcquiredJobLock = { key: string; token: string; source: 'redis' | 'db' };

export async function acquireJobLock(key: string, ttlSeconds: number): Promise<AcquiredJobLock | null> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  try {
    const { error } = await supabase
      .from('scheduler_locks')
      .insert({ job_name: key, locked_at: new Date().toISOString(), expires_at: expiresAt, lock_owner: token });
    if (!error) return { key, token, source: 'db' };
    if (String((error as any).code) === '23505') {
      const { data } = await supabase
        .from('scheduler_locks')
        .select('locked_at, expires_at')
        .eq('job_name', key)
        .maybeSingle();
      const lockedAt = data?.locked_at ? new Date(data.locked_at).getTime() : Date.now();
      const expiresAtMs = data?.expires_at ? new Date(data.expires_at).getTime() : 0;
      if (expiresAtMs <= Date.now() || Date.now() - lockedAt > ttlSeconds * 1000) {
        await supabase.from('scheduler_locks').delete().eq('job_name', key);
        const retry = await supabase
          .from('scheduler_locks')
          .insert({ job_name: key, locked_at: new Date().toISOString(), expires_at: expiresAt, lock_owner: token });
        if (!retry.error) return { key, token, source: 'db' };
      }
      return null;
    }
    throw error;
  } catch (error) {
    throw error;
  }
}

export async function releaseJobLock(lock: AcquiredJobLock): Promise<void> {
  if (lock.source === 'redis') {
    await withTimeout(
      getRedis().eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        `lock:${lock.key}`,
        lock.token,
      ),
      5_000,
      'REDIS_LOCK_RELEASE',
    );
    return;
  }

  await supabase
    .from('scheduler_locks')
    .delete()
    .eq('job_name', lock.key);
}

export async function withJobLock<T>(
  key: string,
  ttlSeconds: number,
  runner: () => Promise<T>,
): Promise<T | { skipped: true; reason: 'locked' }> {
  const lock = await acquireJobLock(key, ttlSeconds);
  if (!lock) return { skipped: true, reason: 'locked' };
  try {
    return await runner();
  } finally {
    await releaseJobLock(lock).catch(() => {});
  }
}

export async function closeJobLockService(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
}
