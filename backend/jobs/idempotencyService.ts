import { createHash } from 'crypto';
import IORedis from 'ioredis';
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

export function buildDeterministicIdempotencyKey(scope: string, payload: Record<string, unknown>): string {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return `${scope}:${createHash('sha256').update(sorted).digest('hex')}`;
}

export async function claimIdempotencyKey(
  key: string,
  ttlSeconds: number,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const result = await getRedis().set(`idempotency:${key}`, JSON.stringify(metadata), 'EX', ttlSeconds, 'NX');
    if (result === 'OK') return true;
    return false;
  } catch (error) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const { error: insertError } = await supabase
      .from('job_idempotency_keys')
      .insert({ key, metadata, expires_at: expiresAt });
    if (!insertError) return true;
    if (String((insertError as any).code) === '23505') return false;
    throw error;
  }
}

export async function hasIdempotencyKey(key: string): Promise<boolean> {
  try {
    return (await getRedis().exists(`idempotency:${key}`)) === 1;
  } catch {
    const { data } = await supabase
      .from('job_idempotency_keys')
      .select('key')
      .eq('key', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    return !!data;
  }
}

export async function closeIdempotencyService(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
}
