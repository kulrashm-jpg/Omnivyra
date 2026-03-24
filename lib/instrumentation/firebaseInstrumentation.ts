/**
 * Firebase Auth instrumentation.
 *
 * Wraps verifyFirebaseIdToken() in lib/firebaseAdmin.ts via a decorator applied
 * at import time. All other call sites that import verifyFirebaseIdToken will
 * automatically use the instrumented version after patchFirebaseAdmin() is called.
 *
 * Tracks:
 *   - tokenVerifications  (all calls to verifyIdToken)
 *   - revokedChecks       (calls with checkRevoked=true)
 *   - authErrors          (thrown errors)
 *   - avgVerifyLatency    (rolling 100-sample window)
 *   - signIns             (manual recording via recordSignIn())
 *   - phoneAuthCount      (manual recording via recordPhoneAuth())
 */

// ── State ─────────────────────────────────────────────────────────────────────

let tokenVerifications = 0;
let revokedChecks      = 0;
let authErrors         = 0;
let signIns            = 0;
let phoneAuthCount     = 0;
const latencySamples: number[] = [];
const verifyTimeline: number[] = [];  // rolling 60s
const OPS_WINDOW = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FirebaseMetrics {
  tokenVerifications:  number;
  revokedChecks:       number;
  authErrors:          number;
  signIns:             number;
  phoneAuthCount:      number;
  verificationsPerMin: number;
  avgVerifyLatencyMs:  number | null;
}

// ── Manual recorders (called from auth routes) ────────────────────────────────

export function recordSignIn():     void { signIns++; }
export function recordPhoneAuth():  void { phoneAuthCount++; }
export function recordAuthError():  void { authErrors++; }

// ── Automatic wrapper ─────────────────────────────────────────────────────────

/**
 * Returns an instrumented version of verifyFirebaseIdToken.
 * Usage in firebaseAdmin.ts:
 *
 *   import { wrapFirebaseVerify } from '../instrumentation/firebaseInstrumentation';
 *   export const verifyFirebaseIdToken = wrapFirebaseVerify(originalVerify);
 */
export function wrapFirebaseVerify<T>(
  original: (token: string, checkRevoked?: boolean) => Promise<T>,
): (token: string, checkRevoked?: boolean) => Promise<T> {
  return async function instrumentedVerify(token: string, checkRevoked?: boolean): Promise<T> {
    if (checkRevoked) revokedChecks++;
    const start = Date.now();
    try {
      const result = await original(token, checkRevoked);
      const ms = Date.now() - start;

      tokenVerifications++;
      latencySamples.push(ms);
      if (latencySamples.length > 100) latencySamples.shift();

      const now = Date.now();
      verifyTimeline.push(now);
      let i = 0;
      while (i < verifyTimeline.length && verifyTimeline[i] < now - OPS_WINDOW) i++;
      if (i > 0) verifyTimeline.splice(0, i);

      return result;
    } catch (err) {
      authErrors++;
      throw err;
    }
  };
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export function getFirebaseMetrics(): FirebaseMetrics {
  const avg = latencySamples.length === 0 ? null
    : latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length;

  return {
    tokenVerifications,
    revokedChecks,
    authErrors,
    signIns,
    phoneAuthCount,
    verificationsPerMin: verifyTimeline.filter(t => t >= Date.now() - OPS_WINDOW).length,
    avgVerifyLatencyMs:  avg === null ? null : Math.round(avg),
  };
}

export function resetFirebaseMetrics(): void {
  tokenVerifications = 0; revokedChecks = 0; authErrors = 0;
  signIns = 0; phoneAuthCount = 0;
  latencySamples.length = 0;
  verifyTimeline.length = 0;
}
