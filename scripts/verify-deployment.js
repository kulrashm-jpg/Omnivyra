#!/usr/bin/env node
/**
 * RELEASE-GATE-001 — HTTP verification of an UN-ALIASED Vercel deployment.
 *
 * The gate this closes: on 2026-08-29 a deployment reached READY, passed config
 * validation, passed CI and passed `predeploy-check`, and then answered every
 * request to www.omnivyra.com with 404. Nothing in the pipeline looked at an
 * actual HTTP response, so the production alias was the first thing that
 * exercised the change.
 *
 *     BUILD_READY  is not  APPLICATION_VERIFIED
 *     APPLICATION_VERIFIED  is what permits promotion
 *
 * So: deploy with `--skip-domain` (production env, alias untouched), run this
 * against the deployment URL, and only then `vercel promote`.
 *
 * ── Deployment Protection ──────────────────────────────────────────────────
 * The project is `all_except_custom_domains`: the custom domain is public,
 * every *.vercel.app deployment URL requires Vercel login and answers 200 with
 * `<title>Login – Vercel</title>` for EVERY path — including invented ones.
 * A naive probe therefore "passes" against a completely broken deployment.
 * Two consequences, both learned the hard way:
 *
 *   1. The bypass HEADER alone yields 307s. It must be paired with
 *      `x-vercel-set-bypass-cookie` AND a cookie jar that persists across the
 *      redirect. This script keeps the cookie in memory and replays it.
 *   2. `vercel curl` produces no usable output on the pinned CLI (53.2.0), so
 *      it is not used here.
 *
 * The secret is read at runtime from the authenticated Vercel CLI
 * (`vercel project protection`), held in memory, and never printed, never
 * written to disk, and never committed.
 *
 * Usage:
 *   node scripts/verify-deployment.js <deployment-url> [--project omnivyra]
 *   node scripts/verify-deployment.js --alias        (verify production)
 *
 * Exit 0 only when every check passes.
 */

const { execFileSync } = require('child_process');

const EXPECTED_PROJECT = process.env.VERCEL_EXPECTED_PROJECT || 'omnivyra';
const PRODUCTION_ALIAS = 'https://www.omnivyra.com';

const args = process.argv.slice(2);
const aliasMode = args.includes('--alias');
const target = (aliasMode ? PRODUCTION_ALIAS : args.find((a) => a.startsWith('http')) || '').replace(/\/$/, '');

if (!target) {
  console.error('usage: node scripts/verify-deployment.js <deployment-url> | --alias');
  process.exit(2);
}

const fail = (msg) => { console.error(`  FAIL — ${msg}`); process.exitCode = 1; };
const ok = (msg) => console.log(`  ok   — ${msg}`);

/** Read the automation bypass secret from the authenticated CLI. Never logged. */
function readBypassSecret() {
  if (aliasMode) return null; // the custom domain is public; no bypass needed
  try {
    const raw = execFileSync('npx', ['vercel', 'project', 'protection'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true,
    });
    const json = JSON.parse(raw.slice(raw.indexOf('{')));
    if (json.name !== EXPECTED_PROJECT) {
      console.error(`  FAIL — linked project is "${json.name}", expected "${EXPECTED_PROJECT}"`);
      process.exit(1);
    }
    const entry = Object.entries(json.protectionBypass || {})
      .find(([, v]) => v && v.scope === 'automation-bypass');
    return entry ? entry[0] : null;
  } catch {
    return null;
  }
}

/** Minimal cookie jar: the bypass cookie must survive the redirect. */
let cookieJar = '';
function absorb(res) {
  const set = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of set) {
    const pair = String(c).split(';')[0];
    if (pair && !cookieJar.includes(pair.split('=')[0])) {
      cookieJar = cookieJar ? `${cookieJar}; ${pair}` : pair;
    }
  }
}

/**
 * Redirects are followed MANUALLY, replaying the accumulated cookies on every
 * hop. Node's built-in fetch has no cookie jar, so `redirect: 'follow'` drops
 * the bypass cookie that Vercel sets on the first hop and the protection
 * handshake loops until "redirect count exceeded". That failure looks exactly
 * like a broken deployment, which is the trap this whole gate exists to avoid.
 */
async function get(path, secret, maxHops = 5) {
  let url = `${target}${path}`;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const headers = {};
    if (secret) {
      headers['x-vercel-protection-bypass'] = secret;
      headers['x-vercel-set-bypass-cookie'] = 'samesitenone';
    }
    if (cookieJar) headers.cookie = cookieJar;

    const res = await fetch(url, { headers, redirect: 'manual' });
    absorb(res);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { status: res.status, body: '' };
      url = new URL(loc, url).toString();
      continue;
    }
    return { status: res.status, body: await res.text() };
  }
  return { status: 599, body: '' }; // too many hops — treated as a failure
}

(async () => {
  console.log(`[verify-deployment] ${target}`);
  const secret = readBypassSecret();

  if (!aliasMode) {
    if (!secret) {
      console.error('  FAIL — no automation-bypass secret available from the Vercel CLI.');
      console.error('         Enable Protection Bypass for Automation on the project, or run');
      console.error('         `vercel login`. Refusing to verify against a protected URL blind.');
      process.exit(2);
    }
    ok('automation bypass secret obtained (value not shown)');
    // Prime the cookie so subsequent requests survive the redirect.
    await get('/', secret);
  }

  // ── A. the application, not Vercel's protection or error page ───────────
  const root = await get('/', secret);
  if (root.status !== 200) fail(`/ returned ${root.status}`);
  else if (/<title>\s*Login\s*[–-]\s*Vercel/i.test(root.body)) {
    fail('/ served the Vercel protection page — the bypass did not take effect');
  } else if (!root.body.includes('_next/static') || !root.body.includes('__NEXT_DATA__')) {
    fail('/ returned 200 but is not the Next.js application (no _next/static / __NEXT_DATA__)');
  } else ok(`/ 200, ${root.body.length}B, Next.js app markers present`);

  const planner = await get('/campaign-planner', secret);
  if (planner.status !== 200) fail(`/campaign-planner returned ${planner.status}`);
  else ok(`/campaign-planner 200, ${planner.body.length}B`);

  const health = await get('/api/health', secret);
  let healthOk = false;
  try { healthOk = JSON.parse(health.body).status === 'ok'; } catch { /* not json */ }
  if (health.status !== 200 || !healthOk) fail(`/api/health returned ${health.status} ${health.body.slice(0, 80)}`);
  else ok('/api/health 200 {"status":"ok"}');

  // ── B. a representative static asset from THIS build ────────────────────
  const buildId = (root.body.match(/"buildId":"([^"]+)"/) || [])[1];
  if (!buildId) fail('could not read buildId from / — cannot check a static asset');
  else {
    const asset = await get(`/_next/static/${buildId}/_buildManifest.js`, secret);
    if (asset.status !== 200 || asset.body.length < 100) {
      fail(`static asset returned ${asset.status}, ${asset.body.length}B`);
    } else ok(`static asset 200, ${asset.body.length}B (buildId ${buildId})`);
  }

  // ── C. render parity, via the EXISTING probe and its accepted contract ──
  const parity = await get('/api/command-center/creator-content/render-inline?probe=1', secret);
  let p = {};
  try { p = JSON.parse(parity.body); } catch { /* not json */ }
  // Same contract as scripts/verify-vercel-render-parity.js: ok && inkRatio > 0.
  if (parity.status !== 200 || p.ok !== true || !(typeof p.inkRatio === 'number' && p.inkRatio > 0)) {
    fail(`render parity http=${parity.status} ok=${p.ok} inkRatio=${p.inkRatio}`);
  } else ok(`render parity ok=true inkRatio=${p.inkRatio} fontCount=${p.fontCount}`);

  if (process.exitCode === 1) {
    console.error('\nRESULT: NOT VERIFIED — do NOT promote this deployment.');
    console.error('If this is already production, restore the previous known-good deployment:');
    console.error('  vercel promote <previous-known-good-deployment>');
    process.exit(1);
  }
  if (aliasMode) {
    console.log('\nRESULT: PRODUCTION VERIFIED — the live alias serves the application.');
  } else {
    console.log('\nRESULT: APPLICATION VERIFIED — this deployment may be promoted:');
    console.log(`  vercel promote ${target.replace(/^https:\/\//, '')}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(`[verify-deployment] probe failed: ${e && e.message ? e.message : e}`);
  process.exit(2);
});
