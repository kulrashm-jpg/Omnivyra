import IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { getConnectionConfig } from '../queue/bullmqClient';
import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');

let redis: IORedis | null = null;

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
  try {
    const result = await getRedis().set(`lock:${key}`, token, 'EX', ttlSeconds, 'NX');
    if (result === 'OK') return { key, token, source: 'redis' };
    return null;
  } catch {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { error } = await supabase
      .from('scheduler_locks')
      .insert({ job_name: key, locked_at: new Date().toISOString(), expires_at: expiresAt, lock_owner: token });
    if (!error) return { key, token, source: 'db' };
    if (String((error as any).code) === '23505') {
      const { data } = await supabase
        .from('scheduler_locks')
        .select('locked_at')
        .eq('job_name', key)
        .maybeSingle();
      const lockedAt = data?.locked_at ? new Date(data.locked_at).getTime() : Date.now();
      if (Date.now() - lockedAt > ttlSeconds * 1000) {
        await supabase.from('scheduler_locks').delete().eq('job_name', key);
        const retry = await supabase
          .from('scheduler_locks')
          .insert({ job_name: key, locked_at: new Date().toISOString(), expires_at: expiresAt, lock_owner: token });
        if (!retry.error) return { key, token, source: 'db' };
      }
      return null;
    }
    throw error;
  }
}

export async function releaseJobLock(lock: AcquiredJobLock): Promise<void> {
  if (lock.source === 'redis') {
    await getRedis().eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      `lock:${lock.key}`,
      lock.token,
    );
    return;
  }

  await supabase
    .from('scheduler_locks')
    .delete()
    .eq('job_name', lock.key)
    .eq('lock_owner', lock.token);
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
