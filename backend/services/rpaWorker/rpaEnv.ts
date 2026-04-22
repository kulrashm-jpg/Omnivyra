/**
 * RPA environment readiness probe. A worker that fails this check MUST
 * refuse to accept RPA tasks; executing without a working Playwright
 * runtime silently marks every task `failed`.
 *
 * The probe is intentionally cheap: it attempts a dynamic `import` of
 * `playwright` and a one-shot chromium launch, then closes. Results are
 * memoized for 5 minutes so hot-path dispatches don't relaunch browsers.
 */

export type ProbeResult = { ok: true } | { ok: false; reason: string };

let cached: { result: ProbeResult; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

// Keep Playwright as a runtime-only dependency so production web builds
// can compile even when the RPA runtime is not installed.
async function loadPlaywright(): Promise<any | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<any>;
    return await importer('playwright');
  } catch {
    return null;
  }
}

export async function rpaEnvReady(): Promise<ProbeResult> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.result;
  }
  let result: ProbeResult;
  try {
    const pw = await loadPlaywright();
    if (!pw?.chromium?.launch) {
      result = { ok: false, reason: 'PLAYWRIGHT_MODULE_MISSING_CHROMIUM' };
    } else {
      let browser: any = null;
      try {
        browser = await pw.chromium.launch({ headless: true });
        result = { ok: true };
      } catch (err: any) {
        const msg = (err?.message || '').toString();
        if (msg.includes("Executable doesn't exist") || msg.includes('please run')) {
          result = { ok: false, reason: 'PLAYWRIGHT_BROWSERS_NOT_INSTALLED' };
        } else {
          result = { ok: false, reason: msg || 'PLAYWRIGHT_LAUNCH_FAILED' };
        }
      } finally {
        try { if (browser) await browser.close(); } catch { /* swallow */ }
      }
    }
  } catch {
    result = { ok: false, reason: 'PLAYWRIGHT_NOT_INSTALLED' };
  }
  cached = { result, at: Date.now() };
  return result;
}

export function isProbeFailure(result: ProbeResult): result is Extract<ProbeResult, { ok: false }> {
  return result.ok === false;
}

/**
 * Hard gate: throws when the env is not ready. Use at worker startup /
 * entrypoint so misconfigured workers fail loudly rather than silently
 * draining the task queue.
 */
export async function assertRpaEnvReady(): Promise<void> {
  const ready = await rpaEnvReady();
  if (isProbeFailure(ready)) {
    const err = new Error(`RPA_ENV_NOT_READY: ${ready.reason}`);
    (err as Error & { code?: string }).code = 'RPA_ENV_NOT_READY';
    throw err;
  }
}

/** Invalidate the probe cache after a dependency install. */
export function resetRpaEnvCache(): void {
  cached = null;
}
