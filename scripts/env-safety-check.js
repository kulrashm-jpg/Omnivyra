#!/usr/bin/env node
/**
 * Environment safety check — production-target detection for localhost.
 *
 * Purpose: prevent a localhost/staging process from silently running
 * against PRODUCTION infrastructure (DB, Redis/queues, app URL). It does
 * NOT modify anything — it inspects the loaded env and reports.
 *
 * Modes:
 *   default            → WARN loudly, exit 0 (does not break current flow)
 *   ENV_SAFETY_ENFORCE=1 → exit 1 when ENV_TARGET is localhost|staging
 *                          but a production target is detected (blocks
 *                          unsafe `dev`/`build`/scheduler start)
 *
 * Wire (later, opt-in): add to package.json "predev"/"prebuild" or call
 * from scripts/start-all.js. NOT auto-wired here so the current
 * intentional prod-localhost flow is not broken without a decision.
 *
 * Production fingerprints are deliberately the values observed in the
 * Phase-1 audit; extend as infra changes.
 */
'use strict';

try { require('dotenv').config({ path: process.env.ENV_FILE || '.env.local' }); } catch (_) {}

const PROD_FINGERPRINTS = {
  supabase: /klkiseupptzbecbxwrky\.supabase\.co/i,
  pooler: /pooler\.supabase\.com/i,
  redis: /noble-dane-77325\.upstash\.io/i,
  appUrl: /(app|www)\.omnivyra\.com/i,
};

const E = process.env;
const target = String(E.ENV_TARGET || '').trim().toLowerCase(); // localhost|staging|production|''
const findings = [];

const check = (label, value, re) => {
  const v = String(value || '');
  if (v && re.test(v)) findings.push(label);
};
check('SUPABASE_URL→production', E.NEXT_PUBLIC_SUPABASE_URL || E.SUPABASE_URL, PROD_FINGERPRINTS.supabase);
check('SUPABASE_POOLER→production', E.SUPABASE_POOLER_DB_URL, PROD_FINGERPRINTS.pooler);
check('REDIS_URL→production(Upstash)', E.REDIS_URL, PROD_FINGERPRINTS.redis);
check('APP_URL→production', E.NEXT_PUBLIC_APP_URL || E.APP_URL, PROD_FINGERPRINTS.appUrl);

const isProdTarget = findings.length > 0;
const enforce = String(E.ENV_SAFETY_ENFORCE || '') === '1';

const payload = {
  evt: 'env.safety_check',
  ts: new Date().toISOString(),
  env_target: target || '(unset)',
  production_targets_detected: findings,
  workers_active: E.ENABLE_AUTO_WORKERS === '1',
  verdict: isProdTarget
    ? (target === 'localhost' || target === 'staging' ? 'UNSAFE_COUPLING' : 'PROD_OR_UNDECLARED')
    : 'ISOLATED_OK',
};
const line = `[env-safety] ${JSON.stringify(payload)}`;

if (payload.verdict === 'UNSAFE_COUPLING') {
  console.error(line);
  console.error(
    '[env-safety] ENV_TARGET=' + target + ' but production infrastructure is targeted: ' +
    findings.join(', ') + (payload.workers_active ? ' (workers ACTIVE → shared prod queues!)' : ''),
  );
  if (enforce) {
    console.error('[env-safety] ENV_SAFETY_ENFORCE=1 → refusing to start. Point to an isolated env or unset ENV_TARGET.');
    process.exit(1);
  }
  console.error('[env-safety] WARN-only (set ENV_SAFETY_ENFORCE=1 to hard-block). Continuing.');
} else if (isProdTarget) {
  console.warn(line);
} else {
  console.log(line);
}
process.exit(0);
