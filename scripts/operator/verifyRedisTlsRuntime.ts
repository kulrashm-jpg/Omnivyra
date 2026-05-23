/*
SCRIPT_CLASSIFICATION: OPERATOR_SUPPORT
MUTATION_LEVEL: NONE
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: YES
REQUIRES_EXPLICIT_OPERATOR_INTENT: NO
*/
/**
 * Redis TLS Runtime Verification
 *
 * Read-only verification that REDIS_URL uses the TLS (rediss://) scheme and
 * that a TLS connection + PING succeed. It performs a single bounded connect
 * with NO reconnection (retryStrategy returns null) so it can never trigger a
 * reconnect storm, and it issues only a read-only PING — no mutation.
 *
 * Run:
 *   REDIS_URL=rediss://... npx tsx scripts/operator/verifyRedisTlsRuntime.ts
 */

import Redis from 'ioredis';
import { validateRedisTlsUrl, type RedisTlsValidation } from './snapshotPublishingOperatorCore';

export interface RedisTlsVerification {
  ok: boolean;
  urlValidation: RedisTlsValidation;
  connectionOk: boolean;
  pingOk: boolean;
  reconnectStormDetected: boolean;
  authFailureDetected: boolean;
  reasons: readonly string[];
}

export async function verifyRedisTlsRuntime(): Promise<RedisTlsVerification> {
  const reasons: string[] = [];
  const urlValidation = validateRedisTlsUrl(process.env.REDIS_URL);
  const result: RedisTlsVerification = {
    ok: false,
    urlValidation,
    connectionOk: false,
    pingOk: false,
    reconnectStormDetected: false,
    authFailureDetected: false,
    reasons,
  };

  if (!urlValidation.valid) {
    reasons.push(...urlValidation.reasons);
    return result;
  }

  let reconnectAttempts = 0;
  const client = new Redis(String(process.env.REDIS_URL), {
    lazyConnect: true,
    connectTimeout: 8000,
    maxRetriesPerRequest: 1,
    // No reconnection — a single bounded attempt, so verification can never
    // itself become a reconnect storm.
    retryStrategy: () => {
      reconnectAttempts += 1;
      return null;
    },
  });

  try {
    await client.connect();
    result.connectionOk = true;
    const pong = await client.ping();
    result.pingOk = pong === 'PONG';
    if (!result.pingOk) reasons.push(`unexpected PING response: ${pong}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (/auth|noauth|wrongpass|password/i.test(message)) {
      result.authFailureDetected = true;
      reasons.push(`redis auth failure: ${message}`);
    } else {
      reasons.push(`redis connection error: ${message}`);
    }
  } finally {
    client.disconnect();
  }

  result.reconnectStormDetected = reconnectAttempts > 1;
  if (result.reconnectStormDetected) reasons.push(`reconnect attempts observed: ${reconnectAttempts}`);

  result.ok = result.connectionOk
    && result.pingOk
    && !result.reconnectStormDetected
    && !result.authFailureDetected;
  return result;
}

async function main(): Promise<number> {
  const result = await verifyRedisTlsRuntime();
  console.log(JSON.stringify({ scope: 'verify-redis-tls-runtime', ...result }, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
