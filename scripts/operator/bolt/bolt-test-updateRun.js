#!/usr/bin/env node
/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: DB_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env.local') });
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, target: 'es2020', skipLibCheck: true, jsx: 'react' },
});
require('tsconfig-paths/register');

const { enforceOperatorSafety, getOperatorArgs } = require('../../_core/operatorSafety');

(async () => {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/bolt/bolt-test-updateRun.js',
    mutationTarget: 'bolt/db',
    intendedAction: 'update one BOLT execution run status and heartbeat for write-path testing',
    example: 'node scripts/operator/bolt/bolt-test-updateRun.js <runId> --target-env=local --apply',
  });
  if (!safety.allowed) return;

  const runId = getOperatorArgs()[0];
  if (!runId) { console.error('usage: node scripts/operator/bolt/bolt-test-updateRun.js <runId> --target-env=local --apply'); process.exit(1); }

  const { supabase } = require('../../../backend/db/supabaseClient');

  console.log('--- before update ---');
  let { data } = await supabase.from('bolt_execution_runs').select('id, status, lock_owner').eq('id', runId).maybeSingle();
  console.log(JSON.stringify(data));

  console.log('--- attempting status update ---');
  const nowIso = new Date().toISOString();
  const { data: upd, error } = await supabase
    .from('bolt_execution_runs')
    .update({ status: 'running', heartbeat_at: nowIso, updated_at: nowIso })
    .eq('id', runId)
    .select('id, status')
    .maybeSingle();
  console.log('error:', error?.message ?? null);
  console.log('result:', JSON.stringify(upd));

  console.log('--- after update ---');
  ({ data } = await supabase.from('bolt_execution_runs').select('id, status').eq('id', runId).maybeSingle());
  console.log(JSON.stringify(data));
})();
