/**
 * Closure-014 (D-1) — the ONE Redis URL parser for every hand-built ioredis
 * connection (standalone client, BullMQ client, intelligence-polling queue).
 *
 * Closure-012 proved both former parsers silently DROPPED the database index:
 * `REDIS_URL=redis://127.0.0.1:6379/14` connected to DB 0, so an "isolated"
 * certification app wrote into the shared local DB. They also dropped an ACL
 * username and passed a still percent-encoded password.
 *
 * Contract:
 *   - `redis://` and `rediss://` only (an optional `redis-cli … -u` prefix is
 *     stripped, as before). TLS: `rediss://` OR an Upstash host (isRedisUrlTLS).
 *   - Database: no path or `/` → `db` omitted (ioredis default 0, exactly as
 *     before); `/N` with an integer 0 ≤ N ≤ MAX_REDIS_DB_INDEX → `db: N`;
 *     ANY other path (negative, non-integer, out of range, extra segments) →
 *     RedisUrlConfigError('INVALID_DB'). It never falls back to DB 0.
 *   - Credentials are percent-decoded. A username of '' or 'default' is not
 *     sent (identical to the former password-only AUTH); any other username is
 *     sent for Redis 6+ ACL.
 *   - Port: 1–65535, default 6379.
 *   - Query parameters are ignored (unchanged).
 */

import { isRedisUrlTLS } from './sanitizer';

/** Redis' default `databases 16` → valid indexes 0–15 (Memurai/Redis default; Upstash supports only 0). */
export const MAX_REDIS_DB_INDEX = 15;

export type RedisUrlErrorKind = 'MALFORMED' | 'UNSUPPORTED_PROTOCOL' | 'INVALID_PORT' | 'INVALID_DB';

export class RedisUrlConfigError extends Error {
  constructor(readonly kind: RedisUrlErrorKind, detail: string) {
    // Never echo the URL itself: it can carry a password.
    super(`Invalid REDIS_URL (${kind}): ${detail}`);
    this.name = 'RedisUrlConfigError';
  }
}

export interface ParsedRedisUrl {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

function decode(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    throw new RedisUrlConfigError('MALFORMED', 'credentials are not valid percent-encoding');
  }
}

/** Parse a Redis URL into ioredis connection options. Throws RedisUrlConfigError; never guesses. */
export function parseRedisConnectionUrl(input: string): ParsedRedisUrl {
  const match = String(input ?? '').match(/rediss?:\/\/\S+/);
  if (!match) throw new RedisUrlConfigError('MALFORMED', 'expected a redis:// or rediss:// URL');
  const url = match[0];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RedisUrlConfigError('MALFORMED', 'not a parseable URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new RedisUrlConfigError('UNSUPPORTED_PROTOCOL', parsed.protocol);
  }
  if (!parsed.hostname) throw new RedisUrlConfigError('MALFORMED', 'missing host');

  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RedisUrlConfigError('INVALID_PORT', String(parsed.port));
  }

  let db: number | undefined;
  const path = parsed.pathname;
  if (path && path !== '/') {
    const m = /^\/(\d{1,5})\/?$/.exec(path);
    const n = m ? Number(m[1]) : NaN;
    if (!m || !Number.isInteger(n) || n < 0 || n > MAX_REDIS_DB_INDEX) {
      throw new RedisUrlConfigError('INVALID_DB', `database path must be /0–/${MAX_REDIS_DB_INDEX}`);
    }
    db = n;
  }

  const username = decode(parsed.username);
  const password = decode(parsed.password);
  const out: ParsedRedisUrl = { host: parsed.hostname.replace(/^\[|\]$/g, ''), port };
  if (username && username !== 'default') out.username = username;
  if (password) out.password = password;
  if (db !== undefined) out.db = db;
  if (isRedisUrlTLS(url)) out.tls = {};
  return out;
}
