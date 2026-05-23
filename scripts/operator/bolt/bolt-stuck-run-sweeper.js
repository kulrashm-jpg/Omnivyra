#!/usr/bin/env node
/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: DB_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * BOLT stuck-run sweeper.
 *
 * Recovers runs whose worker crashed mid-pipeline. A run is "stuck" when
 * ALL of the following are true:
 *
 *   1. status = 'running'
 *   2. heartbeat_at older than STUCK_THRESHOLD_MS (default 5 min)
 *   3. EITHER lock_expires_at is NULL OR lock_expires_at < now()
 *
 * Condition 3 protects live but slow runs from being swept — a healthy
 * pipeline extends its lock between stages, so a valid lock means a
 * live worker is still in there even if its last heartbeat write was
 * a moment ago. We only sweep when the lock has also lapsed.
 *
 * On sweep we:
 *   - Persist a row-level "stuck" failure via the same instrumentation
 *     migration columns the rest of the pipeline uses (failed_stage =
 *     'stuck', raw_error_message + friendly fallback).
 *   - Set status = 'failed'.
 *   - Clear lock fields so the row is re-entrant if the user retriggers.
 *   - Emit a 'stuck' event into bolt_execution_events for replay/debugging.
 *
 * Designed to be run by a cron at any cadence ≥ 1 min. Idempotent: a
 * second run finds zero stuck rows and exits.
 *
 *   node scripts/operator/bolt/bolt-stuck-run-sweeper.js                # default 5 min threshold
 *   STUCK_THRESHOLD_SECONDS=180 node scripts/operator/bolt/bolt-stuck-run-sweeper.js
 *
 * Exits 0 when sweep completes (even with zero hits). Non-zero only
 * on infrastructure failure (DB unreachable, etc.).
 */

const path = require('path');
const { Client } = require('pg');
process.env.TS_NODE_COMPILER_OPTIONS = '{"module":"commonjs"}';
require('ts-node/register/transpile-only');
const { enforceOperatorSafety } = require('../../_core/operatorSafety');

require('dotenv').config({ path: path.join(__dirname, '../../../.env.local') });

const STUCK_THRESHOLD_SECONDS = Number(process.env.STUCK_THRESHOLD_SECONDS || 300);
const FRIENDLY_MSG = 'Your campaign plan was disrupted due to a technical glitch. Please try again. If the problem persists, try again later or reach out for support.';

async function main() {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/bolt/bolt-stuck-run-sweeper.js',
    mutationTarget: 'bolt/db',
    intendedAction: 'mark abandoned BOLT execution runs failed and write stuck-run events',
    example: 'node scripts/operator/bolt/bolt-stuck-run-sweeper.js --target-env=local --apply',
  });
  if (!safety.allowed) return;

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('[sweeper] SUPABASE_DB_URL missing from environment');
    process.exit(1);
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const ranAt = new Date().toISOString();
  let recovered = 0;

  try {
    // Single statement: identify, mark, and clear locks atomically.
    // RETURNING surfaces what we touched for the event-log insert + summary.
    const { rows: sweptRuns } = await client.query(`
      WITH stuck AS (
        SELECT id, current_stage, payload->>'outcomeView' AS pipeline_mode, campaign_id
        FROM bolt_execution_runs
        -- Two failure modes captured here:
        --   status='running' → pipeline started normally then died mid-flight
        --   status='started' → /api/bolt/execute created the row but the
        --                      pipeline kickoff never reached its first
        --                      lock claim (dev-server dropped the promise,
        --                      worker not running, etc.)
        -- For both modes, "no heartbeat for >threshold AND lock expired"
        -- is the unambiguous abandoned signal.
        WHERE status IN ('running', 'started')
          AND (heartbeat_at IS NULL OR heartbeat_at < now() - ($1::int || ' seconds')::interval)
          AND created_at < now() - ($1::int || ' seconds')::interval
          AND (lock_expires_at IS NULL OR lock_expires_at < now())
        ORDER BY heartbeat_at NULLS FIRST
        LIMIT 100
      )
      -- Forensic-integrity: the sweeper NEVER touches error_message /
      -- raw_error_message / failed_stage — those are the exclusive
      -- domain of persistPipelineFailure(). The sweeper only records
      -- abandonment metadata in dedicated columns. Two flavours of
      -- failure (real stage-thrown cause + sweeper-detected abandonment)
      -- can now coexist on the same row without either erasing the
      -- other. failed_after_ms is still updated because it's a
      -- timing measurement, not a causal claim.
      UPDATE bolt_execution_runs r
         SET status                  = 'failed',
             abandonment_reason      = 'operator_stuck_sweep',
             abandonment_detected_at = now(),
             failed_after_ms         = EXTRACT(EPOCH FROM (now() - r.created_at)) * 1000,
             lock_owner              = NULL,
             lock_expires_at         = NULL,
             updated_at              = now()
        FROM stuck s
       WHERE r.id = s.id
         AND r.abandonment_detected_at IS NULL
       RETURNING r.id, r.current_stage, r.campaign_id, r.error_message IS NOT NULL AS had_diagnostic;
    `, [STUCK_THRESHOLD_SECONDS]);

    recovered = sweptRuns.length;

    // Per-row event so replay/debugging tooling can tell which stage was
    // in flight when the worker died.
    if (recovered > 0) {
      const eventRows = sweptRuns.map((r) => ({
        run_id: r.id,
        stage: r.current_stage || 'unknown',
        status: 'failed',
        // Per-row audit record. Records the abandonment as a discrete
        // event without touching the run row's error_message fields
        // (those remain the domain of persistPipelineFailure). The
        // `had_pre_existing_diagnostic` flag separates "swept a row
        // that already had a real failure cause" from "swept a row
        // that had no diagnostic" — high-signal for forensic
        // reconstruction.
        metadata: {
          abandonment_reason: 'operator_stuck_sweep',
          stuck_threshold_seconds: STUCK_THRESHOLD_SECONDS,
          had_pre_existing_diagnostic: Boolean(r.had_diagnostic),
          // Single-hop causal link. Points operators at the prior
          // event that would carry the real cause (typically
          // bolt_pipeline_error from persistPipelineFailure). No
          // recursive chasing — one hop is sufficient.
          originating_failure_event: r.had_diagnostic ? 'bolt_pipeline_error' : null,
          retriable: true,
          recovered_by: 'bolt-stuck-run-sweeper',
          swept_at: ranAt,
          campaign_id: r.campaign_id,
        },
      }));
      for (const ev of eventRows) {
        await client.query(
          `INSERT INTO bolt_execution_events (run_id, stage, status, metadata) VALUES ($1, $2, $3, $4)`,
          [ev.run_id, ev.stage, ev.status, ev.metadata],
        );
      }
    }

    console.log(JSON.stringify({
      event: 'bolt-stuck-run-sweep',
      ran_at: ranAt,
      threshold_seconds: STUCK_THRESHOLD_SECONDS,
      recovered_count: recovered,
      recovered_ids: sweptRuns.map((r) => r.id),
    }));
  } catch (err) {
    console.error('[sweeper] failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[sweeper] FATAL:', err.message);
  process.exit(1);
});
