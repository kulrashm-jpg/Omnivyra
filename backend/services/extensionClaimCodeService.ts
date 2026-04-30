/**
 * EXTENSION CLAIM-CODE SERVICE
 *
 * The web app creates a short-lived, one-time claim code while the user is
 * authenticated in their browser session. The extension's service worker
 * redeems the code directly against the backend to receive its session
 * token + HMAC secret.
 *
 * Design choice: the extension never receives a token forwarded by the web
 * page via postMessage. Only the claim code crosses the page↔extension
 * boundary, and it is single-use and unsigned — knowing the code is
 * useless unless you are the extension SW redeeming over HTTPS inside the
 * same 60s window.
 *
 * Store: in-memory Map. This is fine for a single-instance backend. For
 * multi-instance deployments, replace with Redis using the same interface.
 */

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

type ClaimCode = {
  code: string;
  userId: string;
  orgId: string;
  createdAt: number;
  expiresAt: number;
  redeemedAt: number | null;
};

// In dev, Next.js hot-reload tears down and re-evaluates this module
// when ANY file in its dependency graph changes — which wipes the in-memory
// Map between bootstrap (creates code) and redeem (looks it up). The user
// experiences this as "INVALID_OR_EXPIRED_CLAIM_CODE" on every redeem.
// Pin the Map onto globalThis so it survives module re-evaluation. In
// production this is a no-op (no hot-reload, single Map either way).
const GLOBAL_KEY = '__omnivyra_claim_code_store__';
const globalAny = globalThis as unknown as Record<string, Map<string, ClaimCode> | undefined>;
const store: Map<string, ClaimCode> = globalAny[GLOBAL_KEY] ?? new Map<string, ClaimCode>();
globalAny[GLOBAL_KEY] = store;
const CLAIM_CODE_TTL_MS = 60 * 1000; // 60 seconds

function getCodeSecret() {
  return (
    process.env.EXTENSION_SESSION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    'omnivyra-extension-claim-code-secret'
  );
}

function gc() {
  const now = Date.now();
  for (const [code, claim] of store) {
    if (claim.expiresAt < now || (claim.redeemedAt && now - claim.redeemedAt > 5 * 60 * 1000)) {
      store.delete(code);
    }
  }
}

export function createClaimCode(userId: string, orgId: string): ClaimCode {
  gc();
  if (!userId || !orgId) throw new Error('createClaimCode: userId and orgId required');
  // Use a signed random string so guessing is infeasible even without Redis.
  const random = randomBytes(16).toString('hex');
  const sig = createHmac('sha256', getCodeSecret()).update(`${userId}:${orgId}:${random}`).digest('hex').slice(0, 16);
  const code = `cc_${random}_${sig}`;
  const now = Date.now();
  const claim: ClaimCode = {
    code,
    userId,
    orgId,
    createdAt: now,
    expiresAt: now + CLAIM_CODE_TTL_MS,
    redeemedAt: null,
  };
  store.set(code, claim);
  return claim;
}

/**
 * Redeem a claim code. Single-use: once redeemed it cannot be used again
 * even within its TTL. Returns the bound userId/orgId if valid, null if
 * expired, redeemed, or not found.
 */
export function redeemClaimCode(code: string): { userId: string; orgId: string } | null {
  gc();
  if (!code) return null;
  const claim = store.get(code);
  if (!claim) return null;
  if (claim.redeemedAt) return null;
  if (claim.expiresAt < Date.now()) return null;

  // Constant-time compare the code itself (guards against timing oracles
  // on the Map.get implementation in extreme threat models).
  const a = Buffer.from(code);
  const b = Buffer.from(claim.code);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  claim.redeemedAt = Date.now();
  store.set(code, claim);
  return { userId: claim.userId, orgId: claim.orgId };
}
