/**
 * mode=list per-attempt timeout.
 *
 * The retry loop treats a client abort exactly like a failure, so an 8s timeout
 * meant a healthy-but-slow response was abandoned and re-requested. mode=list
 * gates selectedCompanyId and user.userId, and its measured spread is 1.2-6s
 * with a tail past 8s — so the retry fired on the gating endpoint precisely
 * when it was slowest.
 *
 * These pin the retry CONDITIONS (which must not change) and the timeout
 * threshold (which did).
 */
import * as fs from 'fs';
import * as path from 'path';

class AbortError extends Error { constructor() { super('aborted'); this.name = 'AbortError'; } }

type Attempt = { delayMs?: number; status?: number; throws?: 'abort' | 'network' };

/** Mirrors the loop in components/CompanyContext.tsx (refreshCompanies). */
async function runLoop(attempts: Attempt[], timeoutMs: number) {
  const issued: number[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const fetchWithTimeout = async (i: number) => {
    const a = attempts[Math.min(i, attempts.length - 1)];
    issued.push(i);
    if (a.throws === 'abort') throw new AbortError();
    if (a.throws === 'network') return { ok: false, status: 503 };   // apiFetch synthetic 503
    const delay = a.delayMs ?? 0;
    if (delay > timeoutMs) { await sleep(1); throw new AbortError(); } // AbortController fires first
    await sleep(1);
    return { ok: (a.status ?? 200) < 400, status: a.status ?? 200 };
  };

  let attemptRes: { ok: boolean; status: number } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { attemptRes = await fetchWithTimeout(attempt); } catch { attemptRes = null; }
    if (attemptRes && attemptRes.status !== 404 && attemptRes.status < 500) break;
    if (attempt < 2) await sleep(1);
  }
  return { attemptRes, requestCount: issued.length };
}

const DEPLOYED_TIMEOUT = 15000;
const OLD_TIMEOUT = 8000;

describe('retry conditions are unchanged', () => {
  it('A — 401 stops immediately', async () => {
    const r = await runLoop([{ status: 401 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(1);
    expect(r.attemptRes?.status).toBe(401);
  });

  it('B — 403 stops immediately', async () => {
    const r = await runLoop([{ status: 403 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(1);
  });

  it('C — 404 retries to the cap', async () => {
    const r = await runLoop([{ status: 404 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(3);
  });

  it('D — 5xx retries to the cap', async () => {
    const r = await runLoop([{ status: 500 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(3);
  });

  it('E — network failure retries (apiFetch synthetic 503)', async () => {
    const r = await runLoop([{ throws: 'network' }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(3);
  });

  it('F — abort retries', async () => {
    const r = await runLoop([{ throws: 'abort' }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(3);
  });

  it('a 200 stops immediately', async () => {
    const r = await runLoop([{ status: 200 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(1);
    expect(r.attemptRes?.ok).toBe(true);
  });

  it('a transient 500 followed by 200 succeeds on the second attempt', async () => {
    const r = await runLoop([{ status: 500 }, { status: 200 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(2);
    expect(r.attemptRes?.status).toBe(200);
  });
});

describe('G — the load-bearing case: a healthy response at 9s', () => {
  it('is accepted on the first attempt under the deployed timeout', async () => {
    const r = await runLoop([{ delayMs: 9000, status: 200 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(1);          // no retry issued
    expect(r.attemptRes?.status).toBe(200);  // response processed normally
  });

  it('mutation check — the old 8s timeout aborts and retries that same response', async () => {
    const r = await runLoop([{ delayMs: 9000, status: 200 }], OLD_TIMEOUT);
    expect(r.requestCount).toBe(3);          // abandoned and re-requested
    expect(r.attemptRes).toBeNull();
  });

  it('a genuinely hung request still times out and retries', async () => {
    const r = await runLoop([{ delayMs: 60000, status: 200 }], DEPLOYED_TIMEOUT);
    expect(r.requestCount).toBe(3);
    expect(r.attemptRes).toBeNull();
  });
});

describe('deployed source', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../components/CompanyContext.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the mode=list attempt uses the raised timeout', () => {
    const i = code.indexOf("'/api/company-profile?mode=list',");
    expect(i).toBeGreaterThan(-1);
    const window = code.slice(i, i + 120);
    expect(window).toContain('15000');
    expect(window).not.toContain('8000');
  });

  it('retry count, backoff and break condition are untouched', () => {
    expect(code).toContain('for (let attempt = 0; attempt < 3; attempt++)');
    expect(code).toContain('await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))');
    expect(code).toContain("if (attemptRes && attemptRes.status !== 404 && attemptRes.status < 500) break;");
  });

  it('singleFlight and the sign-out gate remain in place', () => {
    expect(code).toContain("singleFlight<Response | null>(");
    expect(code).toContain("'company-profile-list'");
    expect(code).toContain('shouldForceSignOut(listRes, errData)');
    expect(code).toContain('refreshInFlightRef');
  });
});
