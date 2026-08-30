#!/usr/bin/env node
/**
 * Resets the auth rate-limit counters in the E2E Redis instance.
 *
 * WHY
 * ---
 * `lib/auth/rateLimit.ts` enforces LOGIN_LIMIT = 10 sign-ins per IP per 15
 * minutes, backed by a Redis sliding window keyed `rl:login:<ip>`. The
 * Auth-Integrity suite performs ~5 password logins per full run, all from a
 * single IP, so three consecutive runs inside one 15-minute window exceed the
 * cap and the app correctly returns HTTP 429.
 *
 * That is the production security control behaving as designed. Rather than
 * weaken it, the E2E harness clears the counters BETWEEN runs — the limiter
 * stays fully active within each run.
 *
 * SAFETY
 * ------
 * Refuses to run against a Redis URL that is not explicitly an E2E/local
 * target, and only ever deletes keys under the `rl:*` auth rate-limit
 * namespace. It never flushes the database.
 */

const path = require('path');

const ENV_FILE = process.env.AUTH_E2E_ENV_FILE || '.env.e2e';
try {
  const fs = require('fs');
  if (fs.existsSync(ENV_FILE)) {
    require('dotenv').config({ path: ENV_FILE, override: true });
  }
} catch {
  /* dotenv optional */
}

const PRODUCTION_MARKERS = ['noble-dane-77325.upstash.io', 'klkiseupptzbecbxwrky'];
const RATE_LIMIT_PREFIXES = [
  'rl:login',
  'rl:otp_send',
  'rl:otp_verify',
  'rl:email_link',
  'rl:onboarding',
  'rl:uid:onboarding',
  'rl:uid:invite',
  'rl:domain_resolution',
];

async function main() {
  const url = process.env.E2E_REDIS_URL || process.env.REDIS_URL;
  if (!url) {
    console.error('[auth-e2e rate-limit reset] no E2E_REDIS_URL/REDIS_URL configured');
    process.exit(1);
  }

  for (const marker of PRODUCTION_MARKERS) {
    if (url.includes(marker)) {
      console.error(
        `[auth-e2e rate-limit reset] REFUSING: Redis URL points at production ("${marker}")`,
      );
      process.exit(1);
    }
  }

  const IORedis = require(path.join(process.cwd(), 'node_modules', 'ioredis'));
  const redis = new IORedis(url, { maxRetriesPerRequest: 2, lazyConnect: true });

  let deleted = 0;
  try {
    await redis.connect();
    for (const prefix of RATE_LIMIT_PREFIXES) {
      // Scoped SCAN + DEL. Never FLUSHDB.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');
    }
    console.log(`[auth-e2e rate-limit reset] cleared ${deleted} auth rate-limit key(s)`);
  } finally {
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
  }
}

main().catch((error) => {
  console.error(`[auth-e2e rate-limit reset] ${error && error.message ? error.message : error}`);
  process.exit(1);
});
