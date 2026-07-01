/**
 * prewarm-dev.js — ENV-001 deterministic dev-runtime stabilizer.
 *
 * Root cause of the "forms never become interactive / first request differs from subsequent"
 * instability: `next dev` compiles each route's server + client bundles ON FIRST REQUEST
 * (measured cold≈6–9s vs warm≈150ms — a 34–60× gap). A headless browser hitting a cold route
 * sees the SSR HTML fast but must wait for the client bundle to finish compiling before the
 * page hydrates and the form becomes interactive.
 *
 * This script loads every key route once IN A REAL BROWSER (so both server AND client chunks
 * compile), leaving them warm — so the tester's subsequent customer-journey runs hydrate fast
 * and consistently. Read-only navigation; no product behaviour changed; no config touched.
 *
 * Usage: after `npm run dev` (or dev:full) is up, run `node scripts/prewarm-dev.js`.
 * The production alternative (zero on-demand compile) is `next build && next start`.
 */
const BASE = process.env.PREWARM_BASE || 'http://localhost:3000';
const ROUTES = [
  '/',                                              // landing (public)
  '/login',                                         // login (public)
  '/create-account',                                // signup (public)
  '/dashboard',                                     // authed → compiles, then redirects to /login
  '/command-center/writer-content',                 // Writer
  '/command-center/creator-content/social-post',    // Creator
  '/reports',                                        // Reports
  '/command-center/campaigns',                       // Campaigns
  '/command-center/engagement',                      // Engagement
];
const PUBLIC = new Set(['/', '/login', '/create-account']);

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const route of ROUTES) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    const t = Date.now();
    let interactiveMs = null;
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
      // For public routes, wait until a real form/input is interactive (true hydration signal).
      if (PUBLIC.has(route)) {
        await page.waitForSelector('input, button', { timeout: 120000 });
        interactiveMs = Date.now() - t;
      } else {
        // Authed routes redirect to /login without a session, but the route still compiles.
        await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
      }
    } catch (e) {
      results.push({ route, compileMs: Date.now() - t, interactiveMs, error: String(e.message).split('\n')[0] });
      await ctx.close();
      continue;
    }
    results.push({ route, compileMs: Date.now() - t, interactiveMs, finalUrl: page.url() });
    await ctx.close();
  }
  await browser.close();
  console.log('\n=== PRE-WARM (cold compile of each route) ===');
  for (const r of results) {
    console.log(`  ${r.route.padEnd(48)} ${String(r.compileMs).padStart(6)}ms` +
      (r.interactiveMs != null ? ` (interactive @ ${r.interactiveMs}ms)` : '') +
      (r.error ? `  ERROR: ${r.error}` : ''));
  }
  console.log('\nRoutes are now warm. Re-run this script (or load pages) to see warm timings.');
})().catch((e) => { console.error('prewarm failed:', e.message); process.exit(1); });
