#!/usr/bin/env node
/**
 * POST-DEPLOY gate (PHASE 13Z) — verify the LIVE Vercel render-inline runtime
 * can rasterize text glyphs. Hits the in-function `?probe=1` endpoint (same
 * bundle/trace as the real render), so a pass conclusively means infographics
 * will render text in production.
 *
 * Run AFTER a deploy against the deployed URL. Override target with
 * PARITY_PROBE_URL. Exit 0 only if ok===true && inkRatio>0.
 */
const TARGET =
  process.env.PARITY_PROBE_URL ||
  'https://www.omnivyra.com/api/command-center/creator-content/render-inline?probe=1';

(async () => {
  try {
    const r = await fetch(TARGET, { method: 'GET' });
    const body = await r.json().catch(() => ({}));
    console.log(`[vercel-render-parity] ${TARGET}`);
    console.log(
      `  http=${r.status} ok=${body.ok} inkRatio=${body.inkRatio} ` +
      `fontCount=${body.fontCount} dir=${body.resolvedFontDir}`,
    );
    const pass = body && body.ok === true && typeof body.inkRatio === 'number' && body.inkRatio > 0;
    if (pass) {
      console.log('  RESULT: PASS — Vercel runtime renders text glyphs');
      process.exit(0);
    }
    console.error('  RESULT: FAIL — Vercel runtime cannot render text (infographics would be blank)');
    process.exit(1);
  } catch (e) {
    console.error(`[vercel-render-parity] probe request failed: ${e && e.message ? e.message : e}`);
    process.exit(2);
  }
})();
