#!/usr/bin/env node
/**
 * Pre-deploy verification (READ-ONLY — never deploys, never tags).
 *
 * Vercel is manual-CLI-only here (vercel.json: git.deploymentEnabled=false),
 * so deployments carry no Git metadata. This guard makes a manual deploy
 * traceable by refusing to proceed from an unclean tree and printing the
 * exact commit + the tag command to run AFTER a successful deploy.
 *
 * Exit 1 (block) if the working tree is dirty — you must never deploy a
 * snapshot that does not correspond to a committed, pushed SHA.
 *
 * Exit 1 (block) if HEAD is not the exact tip of origin/main. Deploying a
 * stale worktree or a divergent branch ships old/divergent code and
 * silently regresses already-fixed functionality — this is the root cause
 * of the recurring "worked before, broke after deploy" problem. Deploy
 * ONLY a fresh, clean checkout of the latest origin/main.
 */
const { execSync } = require('child_process');

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

const porcelain = git('status --porcelain');
const sha = git('rev-parse HEAD');
const shortSha = git('rev-parse --short HEAD');
const branch = git('rev-parse --abbrev-ref HEAD');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp =
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
  `-${pad(now.getHours())}${pad(now.getMinutes())}`;
const tag = `deploy/omnivyra-${stamp}`;

process.stdout.write(
  `── predeploy check ──\n` +
  `branch:    ${branch}\n` +
  `commit:    ${sha}\n` +
  `proposed deploy tag: ${tag}\n\n`,
);

if (porcelain) {
  process.stdout.write(
    `RESULT: BLOCKED — working tree is not clean:\n${porcelain}\n\n` +
    `Commit or stash before deploying so the deployed code maps to a SHA.\n`,
  );
  process.exit(1);
}

// Regression guard: deploy ONLY the exact tip of origin/main. A clean but
// stale worktree (or a feature branch) deploying old/divergent code is the
// #1 cause of "worked before, broke after deploy".
let originMain;
try {
  execSync('git fetch origin main --quiet', { stdio: 'ignore' });
  originMain = git('rev-parse origin/main');
} catch (e) {
  process.stdout.write(
    `RESULT: BLOCKED — cannot verify origin/main (git fetch failed): ${e.message}\n`,
  );
  process.exit(1);
}

if (sha !== originMain) {
  process.stdout.write(
    `RESULT: BLOCKED — HEAD ${shortSha} is NOT the tip of origin/main (${originMain.slice(0, 7)}).\n\n` +
    `Deploying a stale worktree or divergent branch ships old code and\n` +
    `silently regresses already-fixed functionality.\n\n` +
    `Deploy only a fresh checkout of the latest origin/main:\n` +
    `  git fetch origin && git checkout main && git reset --hard origin/main\n`,
  );
  process.exit(1);
}

// ── Worker build gate ────────────────────────────────────────────────────────
// The Railway worker image runs `tsc -p tsconfig.worker.json` at build time;
// a type error there fails the deploy AFTER the image push. Catch it here so a
// bad commit never reaches either Vercel or Railway. (Root cause of a prior
// incident: lib/blog/runBlogGeneration.ts type errors from in-progress WIP.)
process.stdout.write(`Running worker typecheck (tsc -p tsconfig.worker.json)...\n`);
try {
  execSync('npx tsc -p tsconfig.worker.json --noEmit', { stdio: 'pipe', encoding: 'utf8' });
  process.stdout.write(`  worker typecheck: OK\n`);
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
  const errs = out.split('\n').filter((l) => l.includes('error TS'));
  process.stdout.write(
    `RESULT: BLOCKED — worker typecheck failed (${errs.length} error(s)):\n` +
    `${errs.slice(0, 20).join('\n')}\n\n` +
    `The Railway worker build would fail. Fix or isolate these before deploying.\n`,
  );
  process.exit(1);
}

// ── Critical env gate ────────────────────────────────────────────────────────
// Block a deploy whose local .env.local is missing a runtime-critical var —
// the most common are empty after an env pull / merge.
const fs = require('fs');
const path = require('path');
const CRITICAL_ENV = [
  'REDIS_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY',
];
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  const missing = CRITICAL_ENV.filter((k) => {
    const m = envText.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return !m || m[1].trim().replace(/^["']|["']$/g, '') === '';
  });
  if (missing.length > 0) {
    process.stdout.write(
      `RESULT: BLOCKED — .env.local missing/empty critical var(s): ${missing.join(', ')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`  critical env: OK (${CRITICAL_ENV.length} vars present)\n`);
} else {
  process.stdout.write(`  critical env: SKIPPED (no .env.local)\n`);
}

// ── Schema parity gate ───────────────────────────────────────────────────────
// Verify that the production database has every column the runtime writes.
// Catches the migration-ledger-desync case where code expects a column that
// hasn't been applied yet. Strict mode (PREDEPLOY_STRICT_SCHEMA=1) blocks
// the deploy on any missing column; default mode warns but continues so the
// gate stays usable when SUPABASE creds aren't in the predeploy shell.
//
// See scripts/verify-schema-parity.js for the column manifest and
// docs/migration-discipline.md for the application protocol.
process.stdout.write(`Verifying schema parity against production DB...\n`);
const strictSchema = process.env.PREDEPLOY_STRICT_SCHEMA === '1';
try {
  execSync('node scripts/verify-schema-parity.js', { stdio: 'inherit' });
  process.stdout.write(`  schema parity: OK\n`);
} catch (e) {
  const code = (e && typeof e.status === 'number') ? e.status : 1;
  // Exit-code contract (see scripts/verify-schema-parity.js):
  //   0 — all clean (no throw)
  //   1 — BLOCKING: at least one runtime-critical column missing
  //   2 — environmental failure (missing creds, network)
  //   3 — WARN: only non-critical columns missing or ledger desync
  if (code === 2) {
    process.stdout.write(
      `  schema parity: SKIPPED (env unavailable). Set PREDEPLOY_STRICT_SCHEMA=1 to require this gate.\n`,
    );
  } else if (code === 1) {
    // BLOCKING-severity missing column. Block deploy unconditionally —
    // strict-mode toggle doesn't apply to blocking issues; those are
    // always deploy-fatal regardless of the strict flag.
    process.stdout.write(
      `RESULT: BLOCKED — schema parity check failed with BLOCKING severity.\n` +
      `Apply missing migrations via Supabase SQL editor before deploying.\n` +
      `See docs/migration-discipline.md.\n`,
    );
    process.exit(1);
  } else if (code === 3) {
    if (strictSchema) {
      process.stdout.write(
        `RESULT: BLOCKED — schema parity reported WARN (non-critical columns missing\n` +
        `or UNSAFE_MIGRATION_LEDGER_STATE). PREDEPLOY_STRICT_SCHEMA=1 is set, so blocking.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(
      `  schema parity: WARN — non-critical columns missing or UNSAFE_MIGRATION_LEDGER_STATE.\n` +
      `  Review structured output above. Continuing in non-strict mode. *** DO NOT run\n` +
      `  'supabase db push' to remediate *** — see docs/migration-discipline.md.\n`,
    );
  } else {
    // Unknown exit code — surface as warning, don't block.
    process.stdout.write(
      `  schema parity: WARN — verifier exited ${code} (unrecognized). Continuing.\n`,
    );
  }
}

// ── Render parity gate ───────────────────────────────────────────────────────
// Verify THIS environment can rasterize SVG text glyphs (the infographic /
// brand_card render path). On the dev box this catches render-CODE regressions;
// the SAME script run INSIDE the worker Docker image in CI catches the FONT/ENV
// gap that shipped blank infographics in prod while localhost rendered text.
// exit 1 = blank (block deploy); exit 2 = environmental (sharp unavailable) → skip.
process.stdout.write(`Verifying render-text parity (SVG glyph rasterization)...\n`);
try {
  execSync('node scripts/verify-render-parity.js', { stdio: 'inherit' });
  process.stdout.write(`  render parity: OK\n`);
} catch (e) {
  const code = (e && typeof e.status === 'number') ? e.status : 1;
  if (code === 2) {
    process.stdout.write(
      `  render parity: SKIPPED (sharp unavailable in this shell). ` +
      `Run inside the worker image in CI for the prod-env check.\n`,
    );
  } else {
    process.stdout.write(
      `RESULT: BLOCKED — render-text parity failed. This environment cannot rasterize\n` +
      `text glyphs (fonts missing) — infographics/brand_cards would render BLANK.\n` +
      `Verify the worker image: build Dockerfile.worker, then run\n` +
      `'node scripts/verify-render-parity.js' inside it (must exit 0).\n`,
    );
    process.exit(1);
  }
}

// ── Vercel render-inline probe (POST-deploy) ────────────────────────────────
// render-inline rasterizes infographic text in the VERCEL runtime (not the
// worker). This verifies the LIVE function can render glyphs via its in-bundle
// ?probe=1 endpoint. It must run AFTER deploy (a pre-deploy run would test the
// OLD build), so it's opt-in here via POSTDEPLOY_PROBE=1; otherwise it's printed
// as a required post-deploy step below.
if (process.env.POSTDEPLOY_PROBE === '1') {
  process.stdout.write(`Verifying LIVE Vercel render-inline parity (?probe=1)...\n`);
  try {
    execSync('node scripts/verify-vercel-render-parity.js', { stdio: 'inherit' });
    process.stdout.write(`  vercel render parity: OK\n`);
  } catch (e) {
    process.stdout.write(
      `RESULT: BLOCKED — live Vercel render-inline probe failed (ok!=true or inkRatio<=0).\n` +
      `Infographics would render blank. Do not consider the deploy successful.\n`,
    );
    process.exit(1);
  }
}

process.stdout.write(
  `\nRESULT: OK — clean tree at ${shortSha} (== origin/main), worker typecheck + env OK.\n\n` +
  `Manual deploy is your action (not automated here). AFTER a verified\n` +
  `successful 'vercel --prod' deploy of omnivyra, record traceability:\n\n` +
  `  git tag -a ${tag} ${shortSha} -m "omnivyra prod deploy ${stamp}"\n` +
  `  git push origin ${tag}\n\n` +
  `Then confirm: vercel inspect <deployment-url>  ==  ${shortSha}\n\n` +
  `── DEPLOY LOCKSTEP (avoid Vercel/Railway skew) ──\n` +
  `The Railway worker AUTO-deploys 'main'; Vercel is MANUAL. To keep them in\n` +
  `lockstep, deploy BOTH from this same SHA (${shortSha}):\n` +
  `  1. git push origin main   → Railway rebuilds the worker from ${shortSha}\n` +
  `  2. vercel --prod          → Vercel app from the SAME checkout\n` +
  `  3. Verify Railway's running commit == ${shortSha} (Railway dashboard/CLI)\n` +
  `Running app and worker on different SHAs is a parity hazard (the worker may\n` +
  `expect schema/contracts the app hasn't shipped, or vice versa).\n\n` +
  `── POST-DEPLOY: Vercel render-inline font parity (REQUIRED) ──\n` +
  `After the Vercel deploy, confirm the live render runtime renders text:\n` +
  `  npm run verify:vercel-render-parity   (must print PASS / ok=true, inkRatio>0)\n` +
  `Blank infographics ⇒ fonts not traced into the Lambda — do NOT call the\n` +
  `deploy successful until this passes.\n`,
);
process.exit(0);
