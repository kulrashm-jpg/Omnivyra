#!/usr/bin/env node
/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: DB_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Take an existing stuck BOLT run, reset its state, and invoke the
 * pipeline directly in this Node process — completely bypasses the
 * Next.js API layer, BullMQ, and HMR. If this works but the UI
 * doesn't, the bug is in the dispatch layer, not the pipeline.
 *
 * Usage:
 *   node scripts/operator/bolt/bolt-rerun-existing.js [runId]
 *
 * Defaults to the most recent run with status 'running' OR 'started'
 * that has no completed stages.
 */

const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../../../.env.local') });

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs', moduleResolution: 'node', esModuleInterop: true,
    target: 'es2020', skipLibCheck: true, jsx: 'react',
  },
});
require('tsconfig-paths/register');
const { enforceOperatorSafety, getOperatorArgs } = require('../../_core/operatorSafety');

async function main() {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/bolt/bolt-rerun-existing.js',
    mutationTarget: 'bolt/db',
    intendedAction: 'reset an existing BOLT execution run and invoke the BOLT pipeline directly',
    example: 'node scripts/operator/bolt/bolt-rerun-existing.js <runId> --target-env=local --apply',
  });
  if (!safety.allowed) return;

  const targetRunId = getOperatorArgs()[0] || null;
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  let runId;
  if (targetRunId) {
    runId = targetRunId;
  } else {
    // Find the most recent run that hasn't progressed past source-recommendation
    const { rows } = await c.query(`
      SELECT id FROM bolt_execution_runs
      WHERE status IN ('running', 'started', 'failed')
        AND current_stage = 'source-recommendation'
      ORDER BY created_at DESC LIMIT 1;
    `);
    if (!rows[0]) { console.log('no candidate run found'); return; }
    runId = rows[0].id;
  }

  console.log(`[rerun] target runId=${runId}`);

  // Reset the row so the pipeline's terminal-state guard lets us in.
  // - status=started: lets the pipeline re-enter (we skip terminal states)
  // - clear lock columns: lets acquireRunLock succeed
  // - clear cancel/heartbeat: clean slate
  // - keep payload intact so we exercise the user's ORIGINAL inputs
  await c.query(`
    UPDATE bolt_execution_runs
       SET status='started',
           current_stage='source-recommendation',
           progress_percentage=0,
           lock_owner=NULL,
           lock_expires_at=NULL,
           lock_acquired_at=NULL,
           heartbeat_at=NULL,
           cancel_requested=false,
           error_message=NULL,
           raw_error_message=NULL,
           failed_stage=NULL,
           failed_after_ms=NULL,
           updated_at=now()
     WHERE id=$1;
  `, [runId]);
  console.log('[rerun] row reset to fresh state');

  await c.end();

  const { executeBoltPipeline } = require('../../../backend/services/boltPipelineService');
  const t0 = Date.now();
  console.log('[rerun] invoking executeBoltPipeline directly…');
  try {
    await executeBoltPipeline(runId);
    console.log(`[rerun] PIPELINE COMPLETED in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('[rerun] pipeline threw:', err?.message);
    console.error(err?.stack);
  }
}

main().catch((e) => { console.error('[rerun] fatal:', e.message); process.exit(1); });
