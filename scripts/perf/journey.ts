/**
 * P1.9A — automated authenticated performance harness.
 *
 * Drives the real deployed application with Playwright and records REAL elapsed
 * times for the full content journey. Nothing here simulates, estimates or
 * hard-codes a duration: every number is a wall-clock delta around an observed
 * DOM/network event.
 *
 * AUTHENTICATION
 * --------------
 * Follows the repository's existing convention (see
 * scripts/validate-super-admin-analytics-e2e.ts): the operator supplies an
 * authorised identity through the environment, and the script REFUSES to run
 * without it. It does not bypass auth, mint sessions, reuse production cookies,
 * disable tenant authorization, or touch auth semantics — it logs in through the
 * ordinary login form exactly as a user would.
 *
 *   E2E_BASE_URL      target origin (default https://www.omnivyra.com)
 *   PERF_E2E_EMAIL    authorised test identity
 *   PERF_E2E_PASSWORD its password
 *
 * SIDE EFFECTS
 * ------------
 * The journey is read-only by default. `--accept` additionally clicks
 * "Accept & Continue", which issues a REAL /api/posts/generate call and
 * therefore consumes credits and creates content. It is opt-in for that reason;
 * without it the harness measures everything up to and including Revise.
 *
 * Usage:
 *   npx tsx scripts/perf/journey.ts [--accept] [--out performance-baseline.json]
 */

// `Request`/`Response` are not exported as named types from 'playwright' — the
// event callbacks are typed by the Page overloads, so let them infer.
import { chromium, type Browser, type Page } from 'playwright';
import { writeFileSync } from 'fs';

const BASE_URL = (process.env.E2E_BASE_URL || 'https://www.omnivyra.com').replace(/\/$/, '');
const EMAIL = process.env.PERF_E2E_EMAIL;
const PASSWORD = process.env.PERF_E2E_PASSWORD;
const DO_ACCEPT = process.argv.includes('--accept');
const OUT =
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : 'performance-baseline.json';

if (!EMAIL || !PASSWORD) {
  throw new Error(
    'Set PERF_E2E_EMAIL and PERF_E2E_PASSWORD to an AUTHORISED test identity to run the ' +
      'performance journey. This harness will not run without credentials — it does not ' +
      'bypass authentication or reuse a production session.',
  );
}

/** Targets from P1.9A Step 3. `null` = measured but not target-bound. */
const TARGETS_MS: Record<string, number | null> = {
  loginToShellMs: 2000,
  shellToCreditsMs: 1000,
  commandCenterReadyMs: 2000,
  contentReadyMs: 2000,
  recommendationsMs: 2000,
  suggestMs: 5000,
  reviseMs: 5000,
  acceptToGenerationMs: 1000,
  generationResultMs: null,
};

type NetRecord = {
  url: string;
  method: string;
  status: number | null;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
};

const timings: Record<string, number> = {};
const network: NetRecord[] = [];
let t0 = 0;

const now = () => Date.now();
const since = (start: number) => now() - start;
const rel = (ms: number) => ms - t0;

function attachNetwork(page: Page) {
  // Keyed by the Playwright request object identity (not the DOM `Request`).
  const started = new Map<object, number>();

  page.on('request', (request) => {
    if (!request.url().includes('/api/')) return;
    started.set(request, now());
    network.push({
      url: request.url().replace(BASE_URL, ''),
      method: request.method(),
      status: null,
      startMs: rel(now()),
      endMs: null,
      durationMs: null,
    });
  });

  page.on('response', async (response) => {
    const request = response.request();
    if (!request.url().includes('/api/')) return;
    const startedAt = started.get(request);
    const record = network.find(
      (r) => r.url === request.url().replace(BASE_URL, '') && r.endMs === null,
    );
    if (!record) return;
    record.status = response.status();
    record.endMs = rel(now());
    record.durationMs = startedAt ? since(startedAt) : null;
  });
}

/** Waits for the first /api/<path> request whose URL contains `fragment`. */
function waitForApi(page: Page, fragment: string, timeout = 60_000) {
  return page.waitForResponse((r) => r.url().includes(fragment), { timeout });
}

async function run() {
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  t0 = now();
  attachNetwork(page);

  try {
    // ── Login → authenticated shell ────────────────────────────────────────
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('#email', EMAIL!);
    await page.fill('#password', PASSWORD!);

    const loginStart = now();
    await Promise.all([
      page.click('button[type="submit"]'),
      // The shell is "ready" when the header nav renders for an authed user.
      page.waitForSelector('[data-testid="credit-pill"], header nav', { timeout: 60_000 }),
    ]);
    timings.loginToShellMs = since(loginStart);

    // ── Shell → credits visible (a REAL balance, not the placeholder) ──────
    const creditsStart = now();
    await page.waitForSelector('[data-credit-status="ready"], [data-credit-status="unavailable"], [data-credit-status="error"]', {
      timeout: 60_000,
    });
    timings.shellToCreditsMs = since(creditsStart);
    const creditState = await page
      .getAttribute('[data-testid="credit-pill"]', 'data-credit-status')
      .catch(() => null);

    // ── Command Center ready ───────────────────────────────────────────────
    const ccStart = now();
    await page.goto(`${BASE_URL}/command-center`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    timings.commandCenterReadyMs = since(ccStart);

    // ── Content → Post Intelligence interactive ────────────────────────────
    const contentStart = now();
    await page.goto(`${BASE_URL}/posts/intelligence`, { waitUntil: 'domcontentloaded' });
    // Interactive = the Suggest panel (or an entry card) is on screen. This is
    // the P1.8 claim under test: the page must be usable before enrichment.
    await page.waitForSelector('[data-testid="suggest-with-ai-panel"], text=Write Your Own Topic', {
      timeout: 60_000,
    });
    timings.contentReadyMs = since(contentStart);

    // ── Recommendations (chips) rendered ───────────────────────────────────
    const recStart = now();
    await page
      .waitForFunction(
        () => document.body.innerText.includes('Uniqueness Directive') ||
              document.body.innerText.includes('Recommended Cards'),
        undefined,
        { timeout: 60_000 },
      )
      .catch(() => {});
    timings.recommendationsMs = since(recStart);

    // ── Suggest with AI ────────────────────────────────────────────────────
    const suggestStart = now();
    await page.click('[data-testid="suggest-with-ai-trigger"]');
    await waitForApi(page, '/api/content/suggest');
    await page.waitForSelector('[data-testid="suggest-with-ai-suggestion"]', { timeout: 60_000 });
    timings.suggestMs = since(suggestStart);

    // ── Revise ─────────────────────────────────────────────────────────────
    const reviseStart = now();
    await page.click('[data-testid="suggest-with-ai-revise"]');
    await page.fill('[data-testid="suggest-with-ai-revision-input"]', 'Make it more provocative and focus on founders');
    await page.click('[data-testid="suggest-with-ai-revise-submit"]');
    await waitForApi(page, '/api/content/suggest');
    await page.waitForSelector('[data-testid="suggest-with-ai-revision-note"]', { timeout: 60_000 });
    timings.reviseMs = since(reviseStart);

    // ── Accept → generation (opt-in: real credits, real content) ───────────
    if (DO_ACCEPT) {
      const acceptStart = now();
      const generationRequest = page.waitForRequest((r) => r.url().includes('/api/posts/generate'), {
        timeout: 60_000,
      });
      await page.click('[data-testid="suggest-with-ai-accept"]');
      await generationRequest;
      timings.acceptToGenerationMs = since(acceptStart);

      const genStart = now();
      const generationResponse = await waitForApi(page, '/api/posts/generate', 180_000);
      timings.generationResultMs = since(genStart);
      timings.generationHttpStatus = generationResponse.status();
    }

    const slowest = [...network]
      .filter((r) => r.durationMs !== null)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, 15);

    const report = {
      commit: process.env.PERF_COMMIT_SHA || null,
      environment: BASE_URL,
      capturedAt: new Date().toISOString(),
      acceptExecuted: DO_ACCEPT,
      creditState,
      ...TARGET_KEYS.reduce<Record<string, number | null>>((acc, key) => {
        acc[key] = timings[key] ?? null;
        return acc;
      }, {}),
      targets: TARGETS_MS,
      status: TARGET_KEYS.reduce<Record<string, string>>((acc, key) => {
        const actual = timings[key];
        const target = TARGETS_MS[key];
        acc[key] =
          actual === undefined ? 'NOT MEASURED'
            : target === null ? 'MEASURED'
            : actual <= target ? 'PASS'
            : 'FAIL';
        return acc;
      }, {}),
      slowestRequests: slowest,
      allRequests: network,
    };

    writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.status, null, 2));
    console.log(`\nwrote ${OUT} (${network.length} API requests captured)`);
    console.log('\nslowest API requests:');
    for (const r of slowest.slice(0, 8)) {
      console.log(`  ${String(r.durationMs).padStart(6)}ms  ${r.status}  ${r.method} ${r.url}`);
    }
  } finally {
    await browser.close();
  }
}

const TARGET_KEYS = Object.keys(TARGETS_MS);

run().catch((error) => {
  console.error('[perf-journey] FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
