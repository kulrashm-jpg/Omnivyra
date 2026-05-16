#!/usr/bin/env node
/**
 * BOLT Text validation harness — Phases 1–3.
 *
 * Drives `executeBoltPipeline` directly (skips the UI + auth layer), captures
 * per-stage timings via `bolt_execution_events`, memory deltas, AI latency
 * (LLM events on `usage_events` if present), DB insert counts, and the final
 * run row populated by the new instrumentation layer.
 *
 * Phases are sequential and explicit; one fails → we stop with a diagnosis.
 *
 *   PHASE 1: Week Plan,  1 wk, LinkedIn,    Post
 *   PHASE 2: Daily Plan, 1 wk, LinkedIn,    Post   (parity check)
 *   PHASE 3: Schedule,   1 wk, LinkedIn,    Post   (full schedule path)
 *
 * Telemetry written to telemetry/bolt-validation-YYYYMMDD-HHMMSS.json so
 * we can diff phases without re-running.
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// ── Loader: register ts-node so we can import the TS pipeline directly ─────
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    target: 'es2020',
    skipLibCheck: true,
    jsx: 'react',
  },
});
// `@/...` alias resolution per tsconfig.json paths
require('tsconfig-paths/register');

const { executeBoltPipeline } = require('../backend/services/boltPipelineService');

// ── Test config ─────────────────────────────────────────────────────────────
const COMPANY_ID = '4bdbec26-4f7e-4e77-a965-d499e1472f5c'; // from dev logs
const CONNECTION_STRING = process.env.SUPABASE_DB_URL;

const PHASE_DEFS = [
  {
    id: 'phase-1',
    name: 'PHASE 1 — Week Plan baseline',
    outcomeView: 'week_plan',
    duration: 1,
    platforms: ['linkedin'],
    formats: ['post'],
    successCriteria: { maxRuntimeMs: 4 * 60 * 1000, allowRetries: false },
  },
  {
    id: 'phase-2',
    name: 'PHASE 2 — Daily Plan baseline',
    outcomeView: 'daily_plan',
    duration: 1,
    platforms: ['linkedin'],
    formats: ['post'],
    successCriteria: { maxRuntimeMs: 4 * 60 * 1000, allowRetries: false },
  },
  {
    id: 'phase-3',
    name: 'PHASE 3 — Schedule baseline',
    outcomeView: 'schedule',
    duration: 1,
    platforms: ['linkedin'],
    formats: ['post'],
    successCriteria: { maxRuntimeMs: 8 * 60 * 1000, allowRetries: false },
  },
  {
    id: 'phase-4',
    name: 'PHASE 4 — Medium load (Schedule, 2wk, LinkedIn+X, Post+Article)',
    outcomeView: 'schedule',
    duration: 2,
    platforms: ['linkedin', 'x'],
    formats: ['post', 'article'],
    // 20 min ceiling. Phase 3 (3 cards) took 76s, ~25s/card. Phase 4
    // expected card count ≈ 12–24 depending on sharing distribution; a
    // generous 20 min covers worst-case linear scaling.
    successCriteria: { maxRuntimeMs: 20 * 60 * 1000, allowRetries: false },
  },
];

// CLI filter: run only the phases named on the command line.
//   node scripts/bolt-text-validation-harness.js phase-4
// Defaults to all phases when no arg is supplied.
const cliPhases = process.argv.slice(2).filter((a) => a.startsWith('phase-'));
const SELECTED_PHASES = cliPhases.length > 0
  ? PHASE_DEFS.filter((p) => cliPhases.includes(p.id))
  : PHASE_DEFS;
if (cliPhases.length > 0 && SELECTED_PHASES.length === 0) {
  console.error(`[harness] no matching phases for: ${cliPhases.join(', ')}`);
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function nowIso() { return new Date().toISOString(); }
function memSnapshot() {
  const m = process.memoryUsage();
  return { rss_mb: +(m.rss / 1024 / 1024).toFixed(1), heapUsed_mb: +(m.heapUsed / 1024 / 1024).toFixed(1) };
}

function buildPayload(phase) {
  const formatFrequency = Object.fromEntries(phase.formats.map((f) => [f, 3]));
  const totalFreq = phase.formats.reduce((sum, f) => sum + (formatFrequency[f] ?? 3), 0);
  return {
    companyId: COMPANY_ID,
    userId: null,
    generatedCampaignId: null,
    sourceStrategicTheme: {
      schema_type: 'recommendation_strategic_card',
      schema_version: 1,
      topic: `Validation: ${phase.name}`,
      polished_title: `Validation: ${phase.name}`,
      summary: `Synthetic BOLT Text validation run for ${phase.outcomeView}.`,
      strategic_context: {
        aspect: 'Brand Awareness',
        facets: ['Content Marketing'],
        audience_personas: ['B2B Marketers'],
        messaging_hooks: [],
        campaign_goals: ['Brand Awareness'],
      },
      intelligence: { campaign_angle: 'validation harness' },
      blueprint: {
        duration_weeks: phase.duration,
        progression_summary: 'awareness → consideration → action',
      },
      formats: phase.formats,
    },
    executionConfig: {
      target_audience: 'B2B Marketers',
      content_depth: 'standard',
      frequency_per_week: totalFreq,
      format_frequency: formatFrequency,
      campaign_duration: phase.duration,
      tentative_start: new Date().toISOString().split('T')[0],
      campaign_goal: 'Brand Awareness',
      campaign_goals: ['Brand Awareness'],
      campaign_mode: 'fast',
      communication_style: ['professional'],
      content_formats: phase.formats,
      selected_platforms: phase.platforms,
      cross_platform_sharing: true,
    },
    outcomeView: phase.outcomeView,
    recId: null,
    title: `Validation: ${phase.outcomeView} ${phase.duration}w`,
    description: null,
    sourceOpportunityId: null,
    regionsFromCard: [],
  };
}

async function createRun(pg, payload) {
  const id = crypto.randomUUID();
  await pg.query(
    `INSERT INTO bolt_execution_runs
       (id, company_id, target_campaign_id, user_id, current_stage, status, progress_percentage, payload)
     VALUES ($1, $2, NULL, NULL, 'source-recommendation', 'started', 0, $3)`,
    [id, COMPANY_ID, JSON.stringify(payload)]
  );
  return id;
}

async function fetchRun(pg, runId) {
  const { rows } = await pg.query(
    `SELECT id, status, current_stage, progress_percentage, result_campaign_id,
            error_message, raw_error_message, failed_stage, failed_after_ms,
            pipeline_mode, campaign_type, weeks_generated, daily_slots_created,
            scheduled_posts_created, content_jobs_total, content_jobs_done,
            ai_calls_total, ai_tokens_input, ai_tokens_output, ai_cost_usd
       FROM bolt_execution_runs WHERE id = $1`,
    [runId]
  );
  return rows[0] ?? null;
}

async function fetchEvents(pg, runId) {
  const { rows } = await pg.query(
    `SELECT stage, status, metadata, created_at FROM bolt_execution_events
      WHERE run_id = $1 ORDER BY created_at ASC`,
    [runId]
  );
  return rows;
}

async function countWrites(pg, campaignId) {
  if (!campaignId) return { daily_content_plans: 0, scheduled_posts: 0 };
  const [{ rows: plans }, { rows: posts }] = await Promise.all([
    pg.query(`SELECT COUNT(*)::int AS n FROM daily_content_plans WHERE campaign_id = $1`, [campaignId]),
    pg.query(`SELECT COUNT(*)::int AS n FROM scheduled_posts WHERE campaign_id = $1`, [campaignId]),
  ]);
  return { daily_content_plans: plans[0].n, scheduled_posts: posts[0].n };
}

function summarizeStages(events) {
  // Pair started/completed/failed by stage → derive duration.
  const byStage = {};
  for (const ev of events) {
    const s = ev.stage;
    byStage[s] = byStage[s] ?? { stage: s, started_at: null, ended_at: null, status: null, duration_ms: null };
    if (ev.status === 'started') byStage[s].started_at = ev.created_at;
    if (ev.status === 'completed' || ev.status === 'failed') {
      byStage[s].ended_at = ev.created_at;
      byStage[s].status = ev.status;
      const md = ev.metadata || {};
      if (typeof md.duration_ms === 'number') byStage[s].duration_ms = md.duration_ms;
      else if (byStage[s].started_at) byStage[s].duration_ms = new Date(byStage[s].ended_at) - new Date(byStage[s].started_at);
      byStage[s].error_message = md.error_message ?? null;
      byStage[s].raw_error_message = md.raw_error_message ?? null;
    }
  }
  return Object.values(byStage);
}

async function runPhase(pg, phase) {
  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(` ${phase.name}`);
  console.log(`   outcome: ${phase.outcomeView} | duration: ${phase.duration}w | platforms: ${phase.platforms.join(',')} | formats: ${phase.formats.join(',')}`);
  console.log(`══════════════════════════════════════════════════════════════════`);

  const memBefore = memSnapshot();
  const payload = buildPayload(phase);
  const runId = await createRun(pg, payload);
  console.log(`[${phase.id}] run_id = ${runId}`);

  const t0 = Date.now();
  let runtimeError = null;
  try {
    await executeBoltPipeline(runId);
  } catch (err) {
    runtimeError = err instanceof Error ? err.message : String(err);
  }
  const runtimeMs = Date.now() - t0;
  const memAfter = memSnapshot();

  const run = await fetchRun(pg, runId);
  const events = await fetchEvents(pg, runId);
  const stageBreakdown = summarizeStages(events);
  const writes = await countWrites(pg, run?.result_campaign_id);

  const report = {
    phase: phase.id,
    name: phase.name,
    run_id: runId,
    started_at: new Date(t0).toISOString(),
    ended_at: nowIso(),
    runtime_ms: runtimeMs,
    runtime_human: `${(runtimeMs / 1000).toFixed(1)}s`,
    runtime_error_caught: runtimeError,
    memory: { before: memBefore, after: memAfter, rss_delta_mb: +(memAfter.rss_mb - memBefore.rss_mb).toFixed(1) },
    run_row: run,
    db_writes: writes,
    stage_breakdown: stageBreakdown,
    success_evaluation: evaluateSuccess(phase, runtimeMs, run, events),
  };

  return report;
}

function evaluateSuccess(phase, runtimeMs, run, events) {
  const failedEvents = events.filter((e) => e.status === 'failed');
  return {
    completed: run?.status === 'completed',
    within_max_runtime: runtimeMs <= phase.successCriteria.maxRuntimeMs,
    max_runtime_ms: phase.successCriteria.maxRuntimeMs,
    failed_event_count: failedEvents.length,
    failed_event_stages: failedEvents.map((e) => e.stage),
    final_status: run?.status,
    failed_stage: run?.failed_stage ?? null,
    raw_error_message: run?.raw_error_message ?? null,
    failed_after_ms: run?.failed_after_ms ?? null,
  };
}

function printPhaseReport(report) {
  console.log(`\n--- ${report.name} REPORT ---`);
  console.log(`runtime              : ${report.runtime_human}`);
  console.log(`completed            : ${report.success_evaluation.completed}`);
  console.log(`final_status         : ${report.success_evaluation.final_status}`);
  console.log(`within max runtime   : ${report.success_evaluation.within_max_runtime} (limit ${report.success_evaluation.max_runtime_ms / 1000}s)`);
  console.log(`memory rss delta     : ${report.memory.rss_delta_mb} MB`);
  console.log(`failed_event_count   : ${report.success_evaluation.failed_event_count}`);
  if (report.success_evaluation.failed_stage) {
    console.log(`failed_stage         : ${report.success_evaluation.failed_stage}`);
    console.log(`raw_error_message    : ${report.success_evaluation.raw_error_message}`);
    console.log(`failed_after_ms      : ${report.success_evaluation.failed_after_ms}`);
  }
  console.log(`db writes            : daily_content_plans=${report.db_writes.daily_content_plans}, scheduled_posts=${report.db_writes.scheduled_posts}`);
  if (report.run_row) {
    console.log(`AI calls / tokens    : ${report.run_row.ai_calls_total ?? '?'} calls, ${report.run_row.ai_tokens_input ?? '?'} in / ${report.run_row.ai_tokens_output ?? '?'} out`);
  }
  console.log(`stage breakdown:`);
  for (const s of report.stage_breakdown) {
    const dur = s.duration_ms != null ? `${(s.duration_ms / 1000).toFixed(1)}s` : '—';
    console.log(`  ${s.status === 'failed' ? '✗' : '✓'} ${s.stage.padEnd(45)} ${dur.padStart(8)}  ${s.status ?? ''}`);
  }
}

async function main() {
  if (!CONNECTION_STRING) {
    console.error('SUPABASE_DB_URL missing');
    process.exit(1);
  }
  const pg = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const tsTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(__dirname, '../telemetry');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `bolt-validation-${tsTag}.json`);

  const reports = [];
  try {
    for (const phase of SELECTED_PHASES) {
      const report = await runPhase(pg, phase);
      reports.push(report);
      printPhaseReport(report);

      // STOP escalation on failure per spec
      if (!report.success_evaluation.completed) {
        console.log(`\n⛔  ${phase.name} FAILED — stopping escalation per protocol.`);
        break;
      }
    }
  } finally {
    fs.writeFileSync(outFile, JSON.stringify(reports, null, 2));
    console.log(`\n[harness] telemetry written → ${outFile}`);
    await pg.end();
  }
}

main().catch((err) => {
  console.error('[harness] FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
