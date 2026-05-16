#!/usr/bin/env node
/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: DB_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Trace executeBoltPipeline end-to-end with synthetic logs at each
 * potential return point. Resets the row first, then invokes.
 */
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../../../.env.local') });
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, target: 'es2020', skipLibCheck: true, jsx: 'react' },
});
require('tsconfig-paths/register');
const { enforceOperatorSafety, getOperatorArgs } = require('../../_core/operatorSafety');

(async () => {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/bolt/bolt-trace-pipeline.js',
    mutationTarget: 'bolt/db',
    intendedAction: 'reset one BOLT execution run and trace pipeline lock/update behavior',
    example: 'node scripts/operator/bolt/bolt-trace-pipeline.js <runId> --target-env=local --apply',
  });
  if (!safety.allowed) return;

  const runId = getOperatorArgs()[0];
  if (!runId) { console.error('usage: node scripts/operator/bolt/bolt-trace-pipeline.js <runId> --target-env=local --apply'); process.exit(1); }

  // Reset row
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(`
    UPDATE bolt_execution_runs
       SET status='started', current_stage='source-recommendation', progress_percentage=0,
           lock_owner=NULL, lock_expires_at=NULL, lock_acquired_at=NULL, heartbeat_at=NULL,
           cancel_requested=false, error_message=NULL, raw_error_message=NULL,
           failed_stage=NULL, failed_after_ms=NULL, updated_at=now()
     WHERE id=$1;
  `, [runId]);
  await c.end();

  console.log('[trace] reset done. invoking…');
  const t0 = Date.now();

  const { supabase } = require('../../../backend/db/supabaseClient');
  const { acquireRunLock, extendRunLock, releaseRunLock, DEFAULT_LOCK_TTL_MS } = require('../../../backend/services/boltExecutionLock');
  const { persistPipelineFailure, deriveBoltCampaignType } = require('../../../backend/services/boltPipelineFailurePersistence');

  console.log('[trace] step 1: fetch row');
  const { data: run, error: fetchError } = await supabase.from('bolt_execution_runs').select('*').eq('id', runId).maybeSingle();
  console.log('[trace] fetched. status=', run?.status, 'error=', fetchError?.message);

  console.log('[trace] step 2: acquireRunLock');
  const lock = await acquireRunLock(runId, DEFAULT_LOCK_TTL_MS);
  console.log('[trace] lock=', lock ? `{token: ${lock.token.slice(0,8)}…}` : 'null');
  if (!lock) { console.log('[trace] BAIL: lock null'); return; }

  console.log('[trace] step 3: updateRun status=running');
  const { error: updErr } = await supabase
    .from('bolt_execution_runs')
    .update({ status: 'running', heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', runId);
  console.log('[trace] updateRun done. error=', updErr?.message ?? null);

  console.log('[trace] step 4: extendRunLock');
  const stillOurs = await extendRunLock(runId, lock.token, DEFAULT_LOCK_TTL_MS);
  console.log('[trace] extendRunLock returned=', stillOurs);

  console.log(`[trace] DONE in ${((Date.now()-t0)/1000).toFixed(1)}s`);
})().catch((e) => { console.error('[trace] threw:', e.message, e.stack); });
