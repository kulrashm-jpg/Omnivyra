#!/usr/bin/env node
/**
 * Schema parity verifier (READ-ONLY).
 *
 * Purpose:
 *   Verify that the production database has every column the running code
 *   writes to. Catches runtime/schema mismatch before a deploy reaches
 *   execution.
 *
 *   Built specifically for the migration-ledger-desync situation
 *   (see docs/audit/migration-ledger-reconciliation-plan.md and the
 *   project memory note `supabase-prod-ledger-desync`): we cannot trust
 *   `supabase db push` to apply pending migrations cleanly, so individual
 *   migrations are applied manually via the Supabase SQL editor. This
 *   script verifies the resulting schema state.
 *
 * Scope:
 *   Verifies columns the runtime code writes that, if absent, will cause
 *   silent PostgREST failures (manifesting as opaque "technical glitch"
 *   user errors). It does NOT attempt full migration reconciliation —
 *   that's a separate project. It does NOT mutate schema.
 *
 * Targets:
 *   - bolt_execution_runs: lock/heartbeat/abandonment forensics
 *   - queue_jobs: result_data, error_code (legacy-only columns now migrated)
 *   - scheduled_posts: idempotency_key
 *   - Writer canonical content platform (content_* / learning_* / brand_memory /
 *     publication_lineage — 16 tables, Waves 0–5). Severity WARN because Writer
 *     persistence is fail-open; a missing table degrades (no canonical persistence)
 *     rather than failing generation. See the manifest block for per-table detail.
 *
 * Maintenance rule (ENG-CERT-002 / ENG-IMPL-001): when a new production-critical
 * write path is added, append its identity + core write columns to REQUIRED_COLUMNS
 * with a severity reflecting real operational impact (BLOCKING only if the write is
 * NOT fail-open). This keeps the gate's coverage current with schema evolution.
 *
 * Usage:
 *   node scripts/verify-schema-parity.js
 *
 * Requires:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (.env.local loaded if
 *   process.env doesn't already have them).
 *
 * Exit codes:
 *   0 — all required columns present
 *   1 — at least one required column missing (structured stdout below)
 *   2 — environmental failure (missing creds, network error)
 */

const fs = require('fs');
const path = require('path');

// Lazy-load .env.local when running from a shell that didn't load it
function loadEnvLocal() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k]) continue;
    process.env[k] = raw.trim().replace(/^["']|["']$/g, '');
  }
}

// Required-column manifest. Each entry classifies severity:
//   BLOCKING  — runtime writes fail; deploy must NOT proceed.
//   WARN      — degraded observability or non-critical write path;
//               deploy can proceed but operator should apply soon.
//   INFO      — advisory; e.g. future-use columns.
//
// motivation explains what runtime behavior fails if the column is
// absent — surfaced in the diagnostic output to make the failure
// self-explanatory.
const REQUIRED_COLUMNS = [
  // bolt_execution_runs — lock/heartbeat substrate (BLOCKING: every BOLT run touches these)
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'lock_owner',          motivation: 'boltExecutionLock.{acquire,release,getStatus} writes/reads — runs fail to claim atomically without it.' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'lock_acquired_at',    motivation: 'Lock attribution timestamps.' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'lock_expires_at',     motivation: 'Sweepers rely on this to detect stale locks; without it, heartbeat writes throw at PostgREST and runs appear abandoned.' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'heartbeat_at',        motivation: 'boltPipelineService.updateRun writes on every progress event; without it the abandonment sweeper fires prematurely.' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'cancel_requested',    motivation: '/api/bolt/cancel sets this; pipeline checks it at each stage boundary.' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'cancel_requested_at', motivation: 'Cancellation timestamp.' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'cancel_requested_by', motivation: 'Cancellation audit attribution.' },

  // bolt_execution_runs — error instrumentation (BLOCKING: persistPipelineFailure writes them)
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'raw_error_message',   motivation: 'persistPipelineFailure() persists the real stage-thrown cause here; sweepers MUST NOT overwrite.' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'error_stack',         motivation: 'Stack trace for in-pipeline failures.' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'failed_stage',        motivation: 'Which BOLT stage threw.' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'failed_after_ms',     motivation: 'Wall time when stage threw.' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'pipeline_mode',       motivation: 'BOLT text / creator / combined attribution for analytics.' },
  { severity: 'WARN',     table: 'bolt_execution_runs', column: 'campaign_type',       motivation: 'Campaign-type attribution for analytics.' },

  // bolt_execution_runs — abandonment forensics (BLOCKING: sweepers write them, progress endpoint reads them)
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'abandonment_reason',      motivation: 'Sweepers record abandonment metadata here WITHOUT clobbering error_message. Forensic integrity contract.' },
  { severity: 'BLOCKING', table: 'bolt_execution_runs', column: 'abandonment_detected_at', motivation: 'Timestamp when sweeper detected abandonment.' },

  // queue_jobs — never-migrated columns (BLOCKING: every job termination writes them)
  { severity: 'BLOCKING', table: 'queue_jobs',          column: 'result_data',         motivation: 'backend/db/queries.ts:updateQueueJobStatus writes serialized completion result; missing column silently loses terminal state.' },
  { severity: 'BLOCKING', table: 'queue_jobs',          column: 'error_code',          motivation: 'Indexed error classification for retry policy and dashboards.' },

  // scheduled_posts — idempotency for retries / resumes (BLOCKING: scheduler INSERTs reference it)
  { severity: 'BLOCKING', table: 'scheduled_posts',     column: 'idempotency_key',     motivation: 'INSERT … ON CONFLICT (idempotency_key) DO NOTHING — without it, retries duplicate posts.' },

  // active_leads — Phase 1 of the Active Leads object model
  // (migration 20260817_active_leads_object_model.sql). Entries
  // are INFO in Phase 1 because no runtime code writes the table
  // yet — only the operator backfill script does. Phase 2 (APIs)
  // upgrades the user-mutated columns to BLOCKING.
  { severity: 'INFO', table: 'active_leads', column: 'organization_id',   motivation: 'Tenant scoping for the Lead object.' },
  { severity: 'INFO', table: 'active_leads', column: 'contact_id',        motivation: 'Person anchor — half of the rollup key.' },
  { severity: 'INFO', table: 'active_leads', column: 'opportunity_type',  motivation: 'Other half of the rollup key.' },
  { severity: 'INFO', table: 'active_leads', column: 'status',            motivation: 'Spec status enum (new/reviewing/contacted/qualified/won/lost/dismissed/snoozed).' },
  { severity: 'INFO', table: 'active_leads', column: 'owner_user_id',     motivation: 'Spec: assigned owner; nullable = unassigned.' },
  { severity: 'INFO', table: 'active_leads', column: 'intent_score',      motivation: 'Rollup score from attached signals.' },
  { severity: 'INFO', table: 'active_leads', column: 'icp_score',         motivation: 'Rollup score from attached signals.' },
  { severity: 'INFO', table: 'active_leads', column: 'confidence_score',  motivation: 'Rollup score from attached signals.' },
  { severity: 'INFO', table: 'active_leads', column: 'total_score',       motivation: 'Rollup score from attached signals — primary triage sort.' },
  { severity: 'INFO', table: 'active_leads', column: 'source_platforms',  motivation: 'Deduped platform union across attached signals.' },
  { severity: 'INFO', table: 'active_leads', column: 'signal_count',      motivation: 'Denormalized signal count for list rendering.' },
  { severity: 'INFO', table: 'active_leads', column: 'first_seen_at',     motivation: 'Spec: First Seen.' },
  { severity: 'INFO', table: 'active_leads', column: 'last_seen_at',      motivation: 'Spec: Last Seen.' },
  { severity: 'INFO', table: 'active_leads', column: 'last_activity_at',  motivation: 'Spec: Last Activity — primary triage sort.' },
  { severity: 'INFO', table: 'active_leads', column: 'company_name',      motivation: 'Spec: Company (v1 plain text).' },
  { severity: 'INFO', table: 'active_leads', column: 'snoozed_until',     motivation: 'Snooze expiry; unsnooze pass flips status back to reviewing.' },
  { severity: 'INFO', table: 'active_leads', column: 'status_changed_at', motivation: 'Status audit.' },
  { severity: 'INFO', table: 'active_leads', column: 'status_changed_by', motivation: 'Status audit attribution.' },

  // opportunity_feed_items — attachment column added by the
  // same migration. INFO in Phase 1; Phase 2 upgrades to BLOCKING
  // (auto-attach trigger / service path).
  { severity: 'INFO', table: 'opportunity_feed_items', column: 'active_lead_id', motivation: 'Link to active_leads. NULL = not yet rolled up.' },

  // opportunity_feed_items — PR-OPA-1 verbatim signal excerpt for the
  // "What was said" UI block. WARN: missing column means new rows
  // throw at PostgREST insert (signal_excerpt is part of the writer
  // payload), but existing reads tolerate NULL — so deploy without
  // migration partially breaks pipeline writes. Upgrade to BLOCKING
  // once migration is verified applied.
  { severity: 'WARN', table: 'opportunity_feed_items', column: 'signal_excerpt', motivation: 'PR-OPA-1: verbatim source excerpt (max 300 chars). Writer populates on every classification; missing column makes inserts fail.' },

  // ── Writer canonical content platform (Waves 0–5, migrations
  //    20260718000000..0003 — 16 tables). ENG-IMPL-001 closes the
  //    ENG-AUDIT-002 coverage gap. Severity = WARN (not BLOCKING): every
  //    Writer persistence write is FAIL-OPEN (runPostGeneration:533
  //    "canonical content persistence failed (continuing)" + generationRuntime
  //    persistence try/catch), and the shipped default path is legacy
  //    (WRITER_RUNTIME_DELEGATION_ENABLED off). A missing table/column therefore
  //    DEGRADES (no canonical persistence / originality / quality / learning)
  //    rather than failing or corrupting generation — deploy may proceed, but
  //    the operator must apply the Wave migrations promptly. One identity anchor
  //    + core write column(s) per table so an unapplied migration is detected.

  // content — canonical spine (contentService.createContent)
  { severity: 'WARN', table: 'content', column: 'company_id',       motivation: 'Tenant scope; createContent writes on every generation. Missing = canonical spine unpersisted (fail-open).' },
  { severity: 'WARN', table: 'content', column: 'content_type',     motivation: 'Canonical content type. Written on create.' },
  { severity: 'WARN', table: 'content', column: 'lifecycle_status', motivation: 'Approval/lifecycle state machine (generated→…→published). Written on create + advanceApproval.' },

  // content_variant — per-platform variants (contentService.upsertVariant)
  { severity: 'WARN', table: 'content_variant', column: 'content_id',     motivation: 'FK to content; upsertVariant writes per platform.' },
  { severity: 'WARN', table: 'content_variant', column: 'platform',       motivation: 'Platform key (upsert conflict target).' },
  { severity: 'WARN', table: 'content_variant', column: 'approval_state', motivation: 'Variant approval state.' },

  // content_revision — revision snapshots (contentService)
  { severity: 'WARN', table: 'content_revision', column: 'content_id',    motivation: 'FK to content; revision snapshots.' },
  { severity: 'WARN', table: 'content_revision', column: 'snapshot',      motivation: 'Serialized revision payload.' },

  // content_asset — attached creator assets
  { severity: 'WARN', table: 'content_asset', column: 'content_id',       motivation: 'FK to content; asset attachment.' },
  { severity: 'WARN', table: 'content_asset', column: 'asset_id',         motivation: 'Creator asset id linked to the content.' },

  // content_memory — originality dedup index (contentMemoryService.indexContentUnit)
  { severity: 'WARN', table: 'content_memory', column: 'company_id',      motivation: 'Tenant-scoped originality memory; indexContentUnit writes accepted masters/variants.' },
  { severity: 'WARN', table: 'content_memory', column: 'exact_hash',      motivation: 'Exact-match dedup key.' },
  { severity: 'WARN', table: 'content_memory', column: 'simhash',         motivation: 'Near-duplicate simhash used by assertOriginality retrieval.' },

  // content_originality — per-record originality decision (persistOriginality)
  { severity: 'WARN', table: 'content_originality', column: 'company_id', motivation: 'Tenant scope; persistOriginality records the decision alongside the canonical row.' },
  { severity: 'WARN', table: 'content_originality', column: 'decision',   motivation: 'accepted/regenerate/duplicate/rejected verdict.' },

  // brand_memory — Wave-2 brand rollup (getBrandMemory / brand writes)
  { severity: 'WARN', table: 'brand_memory', column: 'company_id',        motivation: 'Per-company brand rollup key (voice/terminology/messaging).' },

  // content_quality — 12-dim scorecard (qualityService.persistScorecard)
  { severity: 'WARN', table: 'content_quality', column: 'company_id',     motivation: 'Tenant scope; persistScorecard writes the quality evaluation.' },
  { severity: 'WARN', table: 'content_quality', column: 'dimensions',     motivation: '12-dimension scorecard payload (jsonb).' },

  // content_block — section blocks (collaborationService.upsertBlocks)
  { severity: 'WARN', table: 'content_block', column: 'content_id',       motivation: 'FK to content; upsertBlocks writes section blocks.' },
  { severity: 'WARN', table: 'content_block', column: 'block_type',       motivation: 'Block type; part of collaborative-edit lock model.' },

  // content_recommendation — explainable recs (collaborationService.saveRecommendations)
  { severity: 'WARN', table: 'content_recommendation', column: 'content_id', motivation: 'FK to content; saveRecommendations writes explainable recs.' },
  { severity: 'WARN', table: 'content_recommendation', column: 'category',   motivation: 'Recommendation category.' },

  // content_approval_history — immutable approval trail (approvalService.advanceApproval)
  { severity: 'WARN', table: 'content_approval_history', column: 'content_id', motivation: 'FK to content; advanceApproval appends each transition.' },
  { severity: 'WARN', table: 'content_approval_history', column: 'to_status',  motivation: 'Target lifecycle status of the transition.' },

  // content_performance — ingested signals (performanceService.ingestSignals)
  { severity: 'WARN', table: 'content_performance', column: 'company_id',  motivation: 'Tenant scope; ingestSignals writes engagement/impression signals.' },
  { severity: 'WARN', table: 'content_performance', column: 'content_id',  motivation: 'FK to content for the performance signal.' },

  // publication_lineage — publish/schedule lineage (publicationLineageService.recordEvent)
  { severity: 'WARN', table: 'publication_lineage', column: 'company_id',  motivation: 'Tenant scope; recordEvent traces publish/schedule lineage.' },
  { severity: 'WARN', table: 'publication_lineage', column: 'event_type',  motivation: 'Lineage event type (published/scheduled/…).' },

  // learning_intelligence — percentile learning patterns (learningEngine.recordLearningEvent)
  { severity: 'WARN', table: 'learning_intelligence', column: 'company_id',  motivation: 'Tenant scope; recordLearningEvent writes learned patterns.' },
  { severity: 'WARN', table: 'learning_intelligence', column: 'pattern_key', motivation: 'Pattern identity key.' },

  // learning_memory — consumable learning rollup
  { severity: 'WARN', table: 'learning_memory', column: 'model_version',   motivation: 'Learning-rollup model version; consumed by the prompt assembler.' },

  // content_prediction — explainable prediction (predictionEngine.predict)
  { severity: 'WARN', table: 'content_prediction', column: 'company_id',   motivation: 'Tenant scope; predict writes the explainable prediction.' },
  { severity: 'WARN', table: 'content_prediction', column: 'explanation',  motivation: 'Score-as-sum-of-explanations payload.' },
];

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'missing_credentials',
      missing: [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean),
    }) + '\n');
    process.exit(2);
  }

  // Query information_schema directly via PostgREST. We can't use
  // information_schema.columns through the standard table API because
  // it's not exposed; instead use the RPC fallback via raw SQL run
  // through `rest/v1/rpc/exec_sql`-like patterns. Since that helper
  // isn't guaranteed to exist, we use the supabase-js client.
  let createClient;
  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch (e) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'missing_supabase_js',
      hint: 'Run from project root after `npm install`.',
    }) + '\n');
    process.exit(2);
  }
  const client = createClient(url, key, { auth: { persistSession: false } });

  // Build the set of unique tables we need to introspect.
  const tables = [...new Set(REQUIRED_COLUMNS.map((r) => r.table))];

  // Query existing columns per table. information_schema is queryable via
  // the standard PostgREST path on Supabase as long as the service role
  // has access (it does by default).
  const observed = new Map();
  for (const table of tables) {
    const { data, error } = await client
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', table);
    if (error) {
      // Fallback: try the rpc approach if information_schema isn't
      // exposed (PostgREST doesn't always whitelist it). Use raw SQL
      // via a one-off PG connection if available; otherwise report.
      process.stderr.write(JSON.stringify({
        event: 'schema_parity.error',
        reason: 'information_schema_query_failed',
        table,
        supabase_error: error.message,
        hint: 'Expose information_schema to service_role or use direct SQL via Supabase Studio.',
      }) + '\n');
      process.exit(2);
    }
    observed.set(table, new Set((data ?? []).map((r) => r.column_name)));
  }

  const missing = [];
  for (const req of REQUIRED_COLUMNS) {
    const cols = observed.get(req.table);
    if (!cols || !cols.has(req.column)) {
      missing.push(req);
    }
  }

  // Severity-bucketed status. Verifier exit code:
  //   0 — INFO (all clean)
  //   1 — BLOCKING (one or more BLOCKING-severity columns missing)
  //   3 — WARN    (only WARN/INFO columns missing — operator should
  //               apply soon but deploy can proceed; non-zero so CI
  //               can flag but distinct from BLOCKING)
  const missingBlocking = missing.filter((m) => m.severity === 'BLOCKING');
  const missingWarn     = missing.filter((m) => m.severity === 'WARN');
  const missingInfo     = missing.filter((m) => m.severity === 'INFO');
  const overall =
    missingBlocking.length > 0 ? 'BLOCKING'
    : missingWarn.length > 0    ? 'WARN'
    :                             'INFO';

  // Best-effort ledger-desync probe. Counts rows in
  // supabase_migrations.schema_migrations vs. files in
  // supabase/migrations/. If the ratio is below threshold we flag
  // desync — but we don't fail the verifier on desync alone since
  // the column-existence check is the authoritative signal.
  let ledgerDesyncDetected = false;
  let ledgerProbeNote = null;
  try {
    const { data: ledgerRows, error: ledgerErr } = await client
      .schema('supabase_migrations')
      .from('schema_migrations')
      .select('version', { count: 'exact', head: true });
    // Migration file count is best-effort: read the local directory.
    // If we can't (e.g. running from a CI dir without filesystem
    // access), skip the probe rather than guess.
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
    let localCount = null;
    if (fs.existsSync(migrationsDir)) {
      localCount = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).length;
    }
    if (!ledgerErr && localCount != null) {
      // ledger row count via head:true comes back in the response's
      // count property — the supabase client returns it on data/error
      // ; older clients fall back to data array length. Use either.
      const ledgerCount = Array.isArray(ledgerRows) ? ledgerRows.length : 0;
      ledgerProbeNote = { ledger_recorded: ledgerCount, local_files: localCount };
      if (localCount > 20 && ledgerCount < localCount * 0.5) {
        ledgerDesyncDetected = true;
      }
    } else if (ledgerErr) {
      ledgerProbeNote = { skipped: true, reason: ledgerErr.message };
    }
  } catch (e) {
    ledgerProbeNote = { skipped: true, reason: (e && e.message) || String(e) };
  }

  const out = {
    event: 'schema_parity.check',
    ran_at: new Date().toISOString(),
    checked_columns: REQUIRED_COLUMNS.length,
    missing_count: missing.length,
    status: overall === 'INFO' && !ledgerDesyncDetected ? 'ok' : (overall === 'BLOCKING' ? 'BLOCKING' : 'WARN'),
    severity: {
      blocking: missingBlocking.length,
      warn: missingWarn.length,
      info: missingInfo.length,
    },
    ledger_desync_detected: ledgerDesyncDetected,
    ledger_probe: ledgerProbeNote,
    missing_columns: missing.map((m) => ({
      severity: m.severity,
      table: m.table,
      column: m.column,
      motivation: m.motivation,
    })),
  };

  // stdout: machine-readable JSON (single line for log parsers).
  process.stdout.write(JSON.stringify(out) + '\n');

  // ── Phase 18: deployment_integrity_snapshot event ──────────────
  // High-signal one-line summary so dashboards can immediately show
  // deployment posture without parsing the verbose schema_parity.check
  // event above. One emission per verifier invocation — predeploy
  // shells get it for free; worker-boot integration emits the same
  // event shape via observability/runtime/structuredTelemetry.
  //
  // The envelope follows the canonical taxonomy
  // (docs/telemetry-taxonomy.md §4). Severity is derived from the
  // overall verdict so dashboards can alert on critical postures
  // without inspecting payload fields.
  const integritySeverity =
    overall === 'BLOCKING' ? 'critical'
    : (overall === 'WARN' || ledgerDesyncDetected) ? 'warn'
    : 'info';
  const integritySnapshot = {
    event: 'deployment_integrity_snapshot',
    severity: integritySeverity,
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.VERCEL_DEPLOYMENT_ID ?? null,
    git_sha: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    worker_pid: process.pid,
    run_id: null,
    planner_stage: 'predeploy-integrity-snapshot',
    timestamp: new Date().toISOString(),
    schema_parity: out.status,
    ledger_desync_detected: ledgerDesyncDetected,
    blocking_missing_columns: missingBlocking.length,
    warn_missing_columns: missingWarn.length,
    runtime_env: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
  };
  process.stdout.write(JSON.stringify(integritySnapshot) + '\n');

  // stderr: human-readable summary + operator guidance.
  if (missing.length === 0 && !ledgerDesyncDetected) {
    process.stdout.write(`\nSCHEMA PARITY OK — all ${REQUIRED_COLUMNS.length} required columns present.\n`);
    process.exit(0);
  }

  if (missingBlocking.length > 0) {
    process.stderr.write('\n[BLOCKING] SCHEMA PARITY FAILURE — runtime writes will fail:\n');
    for (const m of missingBlocking) {
      process.stderr.write(`  - ${m.table}.${m.column}\n    ${m.motivation}\n`);
    }
  }
  if (missingWarn.length > 0) {
    process.stderr.write('\n[WARN] Missing non-critical columns — apply soon:\n');
    for (const m of missingWarn) {
      process.stderr.write(`  - ${m.table}.${m.column}\n    ${m.motivation}\n`);
    }
  }
  if (ledgerDesyncDetected) {
    process.stderr.write(
      '\n[WARN] UNSAFE_MIGRATION_LEDGER_STATE — supabase_migrations.schema_migrations is far behind\n' +
      '       the local supabase/migrations/ directory. Probe data: ' + JSON.stringify(ledgerProbeNote) + '\n' +
      '       *** DO NOT RUN `supabase db push` ***\n' +
      '       Duplicate-version prefixes + already-applied DDL will cause partial / non-deterministic\n' +
      '       application. The npm run db:push wrapper now hard-blocks this state — see\n' +
      '       docs/migration-discipline.md for the manual SQL editor protocol.\n'
    );
  }

  process.stderr.write(
    '\nRemediation:\n' +
    '  1. Apply the missing migrations via Supabase SQL editor (NOT `db push`).\n' +
    '  2. See docs/migration-discipline.md for the protocol.\n' +
    '  3. Re-run this verifier to confirm.\n'
  );

  if (missingBlocking.length > 0) {
    process.exit(1);
  }
  // WARN-only / ledger-desync-only path exits 3 (distinct non-zero) so
  // CI / predeploy can flag without blocking.
  process.exit(3);
}

main().catch((err) => {
  process.stderr.write(JSON.stringify({
    event: 'schema_parity.error',
    reason: 'unhandled',
    message: err && err.message ? err.message : String(err),
  }) + '\n');
  process.exit(2);
});
