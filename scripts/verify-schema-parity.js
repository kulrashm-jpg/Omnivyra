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
 *   It ALSO verifies two structural dependencies that column existence cannot
 *   express (GAP-B / GAP-C, see the REQUIRED_INDEXES and REQUIRED_COLUMN_TYPES
 *   manifests): the unique indexes whose 23505 IS the ingestion idempotency
 *   mechanism, and the declared type of a column a migration converted. Both
 *   are cases where every required column is present, this gate was green, and
 *   the runtime was still broken.
 *
 * Targets:
 *   - bolt_execution_runs: lock/heartbeat/abandonment forensics
 *   - queue_jobs: result_data, error_code (legacy-only columns now migrated)
 *   - scheduled_posts: idempotency_key
 *   - Writer canonical content platform (content_* / learning_* / brand_memory /
 *     publication_lineage — 16 tables, Waves 0–5). Severity WARN because Writer
 *     persistence is fail-open; a missing table degrades (no canonical persistence)
 *     rather than failing generation. See the manifest block for per-table detail.
 *   - Prospect Intelligence (GAP-007): unified_persons, prospect_accounts,
 *     canonical_leads, source_records, source_assertions, identity_claims,
 *     person_duplicate_candidates, contact_governance_records, prospect_icps,
 *     prospect_icp_versions, prospect_enrichment_attempts, outreach_tasks,
 *     outreach_outcomes, outreach_decisions. Mixed severity, unlike Writer:
 *     PI reads are EXPLICIT PostgREST column lists followed by `if (error) throw`,
 *     so a missing column on a read path is a 42703 on a customer request rather
 *     than a degrade. See the manifest block for the BLOCKING/WARN rule.
 *
 * Maintenance rule (ENG-CERT-002 / ENG-IMPL-001): when a new production-critical
 * write path is added, append its identity + core write columns to REQUIRED_COLUMNS
 * with a severity reflecting real operational impact (BLOCKING only if the write is
 * NOT fail-open). This keeps the gate's coverage current with schema evolution.
 *
 *   - ORCH-STACK (orchestration-engine-adapters release, migrations
 *     20261127000000 + 20261226000000 … 20261231000010): every table, added
 *     column, index, function, trigger and load-bearing CHECK the stack
 *     creates, plus RLS, client-role privileges, SECURITY DEFINER flags and
 *     body markers of the safety-critical functions. See the ORCH-STACK block.
 *
 * Usage:
 *   node scripts/verify-schema-parity.js            (default mode)
 *   node scripts/verify-schema-parity.js --strict   (or SCHEMA_PARITY_STRICT=1)
 *
 * Strict mode (fail closed): "could not check" is never success. A required
 * check that cannot run — a client role that does not exist (privilege checks
 * unrunnable), or the migration-ledger probe failing — becomes a BLOCKING
 * `check_skipped` finding (exit 1) instead of a WARN / silent note. Missing
 * credentials, a refused connection, or ANY catalog query error (permission
 * denied included) exit 2 in both modes; they are never read as an empty
 * catalog. WARN findings exit 3 (non-zero) in both modes. INFO-severity stack
 * `advisories` (owner-pending) never affect the exit code.
 * `scripts/predeploy-check.js` passes --strict when PREDEPLOY_STRICT_SCHEMA=1
 * and then blocks on EVERY non-zero exit (see predeployParityDecision).
 *
 * Requires:
 *   A direct Postgres connection string, first found of SCHEMA_PARITY_DB_URL,
 *   SUPABASE_POOLER_DB_URL, SUPABASE_DB_URL, DATABASE_URL.
 *   SCHEMA_PARITY_DB_URL is the release-gate credential: when it is set,
 *   .env.local is NOT read. Otherwise .env.local in the CWD fills variables
 *   missing from the environment (unless SUPABASE_URL and
 *   SUPABASE_SERVICE_ROLE_KEY are both set), and a URL taken from it is
 *   announced on stderr by variable NAME (never value).
 *   The session is pinned to default_transaction_read_only = on with
 *   statement/lock timeouts; `session.role` / `session.tx_read_only` in the
 *   JSON output record which role ran the check.
 *
 * Exit codes:
 *   0 — all required columns present, all required indexes structurally sound,
 *       all declared column types as expected, and no ledger desync
 *   1 — at least one BLOCKING finding (structured stdout below); under
 *       --strict this includes every required check that could not run
 *   2 — environmental failure (missing creds, network error, a catalog query
 *       that threw — e.g. permission denied)
 *   3 — WARN/INFO findings only (REQUIRED_COLUMNS INFO entries keep their
 *       historical exit-3 behaviour; stack `advisories` are not findings)
 *
 *   A BLOCKING index finding and a BLOCKING type finding are the SAME class of
 *   outcome as a BLOCKING missing column: they join the one findings list and
 *   exit 1. Exit 0 remains reachable on exactly one condition — an empty
 *   findings list and no ledger desync.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { classifyLedger, HISTORICAL_VERSION_MAP } = require('./lib/migrationLedger');

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

  // ── active_leads — the 20260817 Active Leads object model (19 expectations) ──
  //
  // KNOWN NAME COLLISION. Production `active_leads` is the LEGACY lead-runs table
  // (supabase/_schema/baseline.sql: run_id, company_id, bucket, …). 20260817 uses
  // CREATE TABLE IF NOT EXISTS, so it was a no-op there, and its index on
  // organization_id cannot build — which is also why
  // opportunity_feed_items.active_lead_id (added later in the same file) is absent.
  // Do NOT "fix" this with ALTER TABLE: that grafts two designs onto one table.
  //
  // DISPOSITION (prospect provenance contract, 2026-10-30 —
  // docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md). The 19 expectations
  // originally listed here (all INFO, added in 0d7090ff with 20260817) are
  // resolved as follows. Severity of every OTHER entry in this manifest is
  // untouched by this change.
  //
  // REPLACED (5) — the capability is real, its storage moved to the canonical,
  // append-only contribution ledger `prospect_source_contributions`, whose
  // entries further down carry the expectation at BLOCKING:
  //   active_leads.organization_id           → prospect_source_contributions.organization_id
  //   active_leads.contact_id                → prospect_source_contributions.contact_id
  //   active_leads.source_platforms          → prospect_source_contributions.platform
  //   active_leads.first_seen_at             → prospect_source_contributions.observed_at
  //   opportunity_feed_items.active_lead_id  → prospect_source_contributions.opportunity_feed_item_id
  //
  // RETIRED (8) — intent_score, icp_score, confidence_score, total_score,
  // signal_count, last_seen_at, last_activity_at, company_name. Evidence note:
  //   - production (read-only, orchestrator-verified 2026-10-30): 0 rows and 0
  //     writes in active_leads, active_lead_runs and opportunity_feed_items;
  //   - no runtime writer of the 20260817 shape exists (only the operator script
  //     scripts/operator/db/backfill-active-leads.ts, which fails at its first
  //     query in production on opportunity_feed_items.active_lead_id);
  //   - the only runtime reader (leadIntelligenceReadService, filter on
  //     organization_id) has never returned a row: in production the filter is
  //     42703 and the read fails soft to [];
  //   - 20260817_active_leads_object_model.sql was never applied in production
  //     and never recorded in the ledger;
  //   - intent_score / first_seen_at / last_seen_at "passed" only because the
  //     legacy table has same-named columns of a different meaning (0–100
  //     NOT NULL DEFAULT 0; nullable run sightings) — false greens;
  //   - canonical equivalents already exist: the four scores are
  //     prospect_score_evaluations.score_intent / score_icp / confidence /
  //     score_overall (0..1 — see ScoreScale in lib/prospectProvenance/contract.ts;
  //     never compared with the legacy 0–100 scale implicitly); company_name is
  //     prospect_accounts.name via unified_persons.account_id; signal_count,
  //     last_seen_at and last_activity_at are derivable from contributions
  //     (count / max(observed_at)).
  //
  // REMAINING (6) — the opportunity-WORKFLOW columns (status, owner, snooze,
  // status audit). They describe triage workflow, not provenance; all six are
  // reconciled below onto the per-opportunity workflow tables.
  //
  // RECONCILED against docs/architecture/PROSPECT-OPPORTUNITY-LIFECYCLE.md (owner
  // direction: a per-contact, per-opportunity-type model; opportunity workflow is
  // separate from source attribution). Five of the six already live, per
  // opportunity, in workflow tables that exist in production (verified read-only
  // 2026-10-30: present, 0 rows), so the expectation moves to the real column:
  //   opportunity_type   → opportunity_feed_items.opportunity_type
  //   status             → opportunity_lifecycle_states.state (latest row per item)
  //   owner_user_id      → opportunity_assignments.assigned_to_user_id (role 'owner', unassigned_at IS NULL)
  //   status_changed_at  → opportunity_lifecycle_states.transitioned_at
  //   status_changed_by  → opportunity_lifecycle_states.actor_user_id
  // WARN: the opportunity workflow writes them; a missing column degrades workflow.
  { severity: 'WARN', table: 'opportunity_feed_items',       column: 'opportunity_type',    motivation: 'Per-opportunity type (replaces active_leads.opportunity_type roll-up key).' },
  { severity: 'WARN', table: 'opportunity_lifecycle_states', column: 'state',               motivation: 'Per-opportunity status history (replaces active_leads.status).' },
  { severity: 'WARN', table: 'opportunity_lifecycle_states', column: 'transitioned_at',     motivation: 'When the status changed (replaces active_leads.status_changed_at).' },
  { severity: 'WARN', table: 'opportunity_lifecycle_states', column: 'actor_user_id',       motivation: 'Who changed the status (replaces active_leads.status_changed_by).' },
  { severity: 'WARN', table: 'opportunity_assignments',      column: 'assigned_to_user_id', motivation: 'Per-opportunity owner (replaces active_leads.owner_user_id).' },
  // snoozed_until — DECIDED (owner, 2026-10-30; lifecycle doc D-4): snooze is an
  // OPPORTUNITY-level workflow property, carried by the existing disposition
  // model as a typed deadline on a `revisit_later` row (migration
  // 20270108000000_pi_opportunity_snooze.sql: nullable timestamptz, CHECK
  // revisit_later-only, partial expiry index, composite tenant FK). The
  // expectation therefore moves off the legacy-name-colliding active_leads
  // table onto the real carrier:
  //   snoozed_until      → opportunity_dispositions.snoozed_until
  // WARN, like its sibling workflow columns: only the snooze writer inserts it
  // (every other disposition write omits it), so its absence degrades snooze
  // and nothing else. Until 20270108000000 is applied in production this is a
  // WARN finding, so strict predeploy stays honestly non-green.
  { severity: 'WARN', table: 'opportunity_dispositions',     column: 'snoozed_until',       motivation: 'Opportunity-level snooze deadline on a revisit_later disposition (replaces active_leads.snoozed_until; owner decision D-4, 20270108000000).' },

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

  // ══ Prospect Intelligence (GAP-007) ═══════════════════════════════════════
  //
  // WHY THIS BLOCK EXISTS. Until now this manifest covered 21 tables and not
  // one of them was a PI table, so every authored PI migration — the
  // 20261011000000 … 20261022000000 series, plus the W1/LI-1/LI-2/LI-3/LI-4C/P2A
  // migrations it builds on — shipped with ZERO deploy-gate coverage. The gate
  // ran, passed, and proved nothing about the half of the platform a prospect
  // request actually touches. The failure mode is not theoretical: PI reads are
  // written as EXPLICIT PostgREST column lists — `accountIntelligence.ts`
  // selects `['id', ...CONTACT_COLUMNS]` (which includes `authority`,
  // `influence` and `buying_role`, added by 20261013000000) and the next line
  // is `if (error) throw`. PostgREST answers a missing column with 42703, so an
  // unapplied migration does not degrade a prospect page, it 500s it. The
  // ledger is known to be desynced (see the header), migrations are applied by
  // hand, and this gate is the only thing standing between that and a customer
  // request.
  //
  // WHAT IS LISTED, AND WHY NOT EVERY COLUMN. A table created by a single
  // migration is present or absent AS A WHOLE, so one identity anchor detects
  // it — `observed` has no entry for an absent table and every requirement
  // against it reports missing. Additional entries earn their place in exactly
  // two cases:
  //   (a) the column was added by a LATER migration, so it can be individually
  //       missing when the ledger is partially applied; or
  //   (b) the column is named in an explicit select list or an `.eq()`/`.is()`
  //       predicate on a path that throws — the shapes that become 42703.
  //
  // HOW SEVERITY WAS CHOSEN. BLOCKING requires all three of: the column is in
  // an explicit column list or a filter predicate (not reached via `select('*')`,
  // which returns undefined rather than erroring); the path converts the error
  // into a throw or a hard refusal; and the path is reachable from a tenant
  // request — `/api/prospects`, `/api/prospects/[id]`, `/api/prospects/[id]/enrich`
  // or an outreach send gate — not only from an operator script. Everything
  // else is WARN. Enrichment ATTEMPT recording in particular is deliberately
  // fail-open (`recordedExecution.ts` catches the open, and `complete()` runs
  // inside `try { … } catch {}`), so it is WARN even though it is on the enrich
  // request path. A gate that marked all of this BLOCKING would be switched off
  // inside a week, and then it would protect nothing at all.

  // ── unified_persons — the canonical person spine ─────────────────────────
  // BLOCKING: `accountIntelligence.loadContacts` selects `['id', ...CONTACT_COLUMNS]`
  // and `prospectContext.loadPerson` selects `['account_id', ...PERSON_IDENTITY_COLUMNS]`.
  // Both are explicit lists, both filter on `company_id`, and both end in
  // `if (error) throw`. Both are reached from `buildProspectIntelligenceContext`,
  // i.e. from GET /api/prospects/[id]. A missing column is a 42703 on a
  // customer request, not a null field.
  { severity: 'BLOCKING', table: 'unified_persons', column: 'company_id',  motivation: 'Tenant predicate on every spine read; a missing column makes the filter itself 42703, so the tenant boundary cannot even be applied.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'account_id',  motivation: 'W1 (20260920000000) person→account link. In prospectContext.loadPerson\'s select list AND accountIntelligence.loadContacts\' roster filter; absent, no prospect resolves an employer and both reads throw.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'job_title',   motivation: 'LI-1 (20261001000000). PERSON_IDENTITY_COLUMNS + CONTACT_COLUMNS — named in two explicit selects that throw.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'department',  motivation: 'LI-1 (20261001000000). Same two explicit selects.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'seniority',   motivation: 'LI-1 (20261001000000). Same two explicit selects.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'authority',   motivation: 'WS-6/7 (20261013000000). In CONTACT_COLUMNS, so in accountIntelligence.loadContacts\' literal select list — the exact column whose absence 500s the account roster.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'influence',   motivation: 'WS-6/7 (20261013000000). Same select list.' },
  { severity: 'BLOCKING', table: 'unified_persons', column: 'buying_role', motivation: 'WS-6/7 (20261013000000). Same select list; also the source of every RawRelationship role WS-6 scores.' },
  // WARN: the rest of LI-1's person surface is read through `select('*')`
  // (prospectIntelligenceRead) and written only by ingestionBoundary's canonical
  // patch, which touches an attribute ONLY when a live assertion exists for it.
  // Absent, the attribute reads as unknown — a degrade, not a throw.
  { severity: 'WARN', table: 'unified_persons', column: 'full_name',             motivation: 'LI-1 person attribute surface; read via select(*), patched only when asserted.' },
  { severity: 'WARN', table: 'unified_persons', column: 'first_name',            motivation: 'LI-1 person attribute surface.' },
  { severity: 'WARN', table: 'unified_persons', column: 'last_name',             motivation: 'LI-1 person attribute surface.' },
  { severity: 'WARN', table: 'unified_persons', column: 'country_code',          motivation: 'LI-1 person geography; ICP person-subject evaluation degrades to unknown without it.' },
  { severity: 'WARN', table: 'unified_persons', column: 'region',                motivation: 'LI-1 person geography.' },
  { severity: 'WARN', table: 'unified_persons', column: 'city',                  motivation: 'LI-1 person geography.' },
  { severity: 'WARN', table: 'unified_persons', column: 'timezone',              motivation: 'LI-1 person geography.' },
  { severity: 'WARN', table: 'unified_persons', column: 'attributes_source',     motivation: 'LI-1 block-level provenance. In EVERY ingestionBoundary canonical patch, so a person enrichment write throws — but that write is a background reconciliation, not the read path.' },
  { severity: 'WARN', table: 'unified_persons', column: 'attributes_updated_at', motivation: 'LI-1 block-level provenance; the freshness clock for the whole attribute block.' },

  // ── prospect_accounts — the external company (W1 20260920000000) ─────────
  // Created by one migration, so one anchor detects its absence. The account
  // row itself is read with `select('*')`, which does NOT error on a missing
  // column — only the tenant predicate does.
  { severity: 'BLOCKING', table: 'prospect_accounts', column: 'organization_id', motivation: 'Tenant predicate on accountIntelligence.loadAccount (`if (error) throw`). Also the anchor that detects the whole W1 table being unapplied — without prospect_accounts there is no Account aggregation and GET /api/prospects/[id] throws.' },
  // WARN: the firmographic surface. Read via select('*') → a missing column is
  // reported by WS-7 as an unknown fact (`completeness.missing`), which is the
  // designed behaviour for absence. Each entry pins one ALTER migration so a
  // partially-applied ledger is visible.
  { severity: 'WARN', table: 'prospect_accounts', column: 'industry',              motivation: 'LI-1 (20261001000000) firmographics; ICP account-subject input.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'employee_count',        motivation: 'LI-1 (20261001000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'employee_band',         motivation: 'LI-1 (20261001000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'description',           motivation: 'LI-1 (20261001000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'attributes_source',     motivation: 'LI-1 provenance; in every account canonical patch and in WS-7\'s provenance block.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'attributes_updated_at', motivation: 'LI-1 provenance; WS-7 freshness + the observedAt WS-6 stamps on every account-derived relationship.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'annual_revenue',        motivation: 'P2A (20261005000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'revenue_band',          motivation: 'P2A (20261005000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'founded_year',          motivation: 'P2A (20261005000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'technologies',          motivation: 'P2A (20261005000000) firmographics (jsonb array).' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'funding_stage',         motivation: 'P2A (20261005000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'last_funding_at',       motivation: 'P2A (20261005000000) firmographics.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'market',                motivation: 'WS-6/7 (20261013000000) ICP attribute extension; in ACCOUNT_ATTRIBUTE_COLUMNS.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'business_model',        motivation: 'WS-6/7 (20261013000000) ICP attribute extension.' },
  { severity: 'WARN', table: 'prospect_accounts', column: 'growth_stage',          motivation: 'WS-6/7 (20261013000000) ICP attribute extension.' },

  // ── canonical_leads — the Prospect ───────────────────────────────────────
  // BLOCKING: `listProspects` (GET /api/prospects) selects this exact literal
  // list and throws on error. It is the tenant's prospect list; a missing
  // column empties the whole page with a 500.
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'company_id',          motivation: 'Tenant predicate on listProspects, accountIntelligence.loadProspects and prospectEngagementIntelligence.loadProspect — all `if (error) throw`.' },
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'unified_person_id',   motivation: 'The Prospect→person anchor. In three explicit select lists; without it no prospect resolves a person, an account or any engagement.' },
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'source',              motivation: 'In listProspects\' and loadProspects\' literal select lists.' },
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'created_at',          motivation: 'In two literal select lists AND the `order()` key of the prospect list query.' },
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'external_lead_key',   motivation: 'In listProspects\' literal select list.' },
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'qualification_score', motivation: 'In listProspects\' literal select list.' },

  // ── source_assertions — field-level evidence (LI-2 20261002000000) ───────
  // BLOCKING on two independent throwing paths: accountIntelligence.loadAssertions
  // (GET /api/prospects/[id]) and observations.readAssertions, which states
  // "Fail CLOSED" and throws — and which runs on the enrich path BEFORE the
  // provider is paid. The insert in ingestionBoundary.recordAssertions runs on
  // the same enrich request via `persistObservation`, which recordedExecution
  // documents as UNGUARDED: it throws AFTER the provider has already been paid.
  { severity: 'BLOCKING', table: 'source_assertions', column: 'organization_id',  motivation: 'Tenant predicate on both throwing reads and the anchor detecting the LI-2 migration being unapplied — no LI-2 means every account fact loses its evidence and the WS-7 read throws.' },
  { severity: 'BLOCKING', table: 'source_assertions', column: 'attribute',        motivation: 'In accountIntelligence\'s and observations\' literal select lists; the key LI-2 arbitrates on.' },
  { severity: 'BLOCKING', table: 'source_assertions', column: 'normalized_value', motivation: 'In accountIntelligence\'s literal select list; the value decideCanonicalUpdates compares.' },
  { severity: 'BLOCKING', table: 'source_assertions', column: 'superseded_at',    motivation: '`.is(\'superseded_at\', null)` — the LIVE-evidence predicate on both throwing reads. Absent, the filter is 42703 before a single row is considered.' },
  { severity: 'WARN', table: 'source_assertions', column: 'applied_to_canonical_at', motivation: 'Provenance stamp written after a canonical apply; that update\'s error is not inspected, so absence loses the stamp rather than failing the request.' },
  { severity: 'WARN', table: 'source_assertions', column: 'applied_reason',         motivation: 'Why an assertion became canonical. Same unchecked update.' },

  // ── source_records — what a provider sent (LI-2 20261002000000) ──────────
  { severity: 'BLOCKING', table: 'source_records', column: 'organization_id',  motivation: 'Tenant predicate + insert column on ingestionBoundary.recordSourceRecord, reached from POST /api/prospects/[id]/enrich through the UNGUARDED persistObservation port — it throws after the provider call has already been billed.' },
  { severity: 'BLOCKING', table: 'source_records', column: 'ingestion_run_id',  motivation: 'A7P-C9 (20261022000000) — in the insert payload on that same unguarded path. NOTE: this entry detects the column being ABSENT; it cannot detect 20261022000000\'s uuid→text conversion, which the column-existence probe is structurally blind to. Production writers already supply non-UUID values, so an unconverted column fails at insert with 22P02, not 42703.' },
  { severity: 'WARN', table: 'source_records', column: 'payload_hash',       motivation: 'Change detection for a re-seen provider record; part of the LI-2 create, so the anchor above already detects an unapplied migration.' },
  { severity: 'WARN', table: 'source_records', column: 'observation_count',  motivation: 'How many times a record has been re-seen; read-modify-written on the conflict path.' },
  // Prospect provenance (contract 2026-10-30). Added to an EXISTING table by a
  // LATER migration, so each column is individually missable under a partial
  // ledger (rule (a) above) and needs its own entry. BLOCKING on the same footing
  // as organization_id / ingestion_run_id: the contract makes every ingestion
  // path set them EXPLICITLY in the source_records insert payload, which runs on
  // the unguarded persistObservation port — an absent column is PGRST204/42703
  // at INSERT, after a billed provider call, for every ingestion.
  // ASSUMPTION until the ingestion workstreams land: if an ingestion path ends
  // up NOT naming a column in its payload, that column belongs at WARN.
  { severity: 'BLOCKING', table: 'source_records', column: 'source_category', motivation: 'Provenance contract: the discovery classification (12-value vocabulary, CHECK-constrained). Named in every ingestion path\'s source_records insert; absent, ingestion throws at INSERT on the unguarded persistObservation port.' },
  { severity: 'BLOCKING', table: 'source_records', column: 'platform',        motivation: 'Provenance contract: the originating platform/provider (linkedin, reddit, apollo, hubspot…). Same insert payload, same unguarded path.' },
  { severity: 'BLOCKING', table: 'source_records', column: 'source_url',      motivation: 'Provenance contract: where the original evidence lives. Same insert payload, same unguarded path.' },

  // ── prospect_icps / prospect_icp_versions — D1 (20261012000000) ──────────
  // BLOCKING, despite `getRatifiedIcp` returning null for "nothing ratified".
  // That null is the ABSTAIN case and is handled; a read ERROR is not. Both
  // reads run `translate(res.error, …)`, which calls `fail()`, which throws an
  // IcpContractError — and `buildProspectIntelligenceContext` awaits
  // `getRatifiedIcp` with no catch, on GET /api/prospects/[id]. A tenant with
  // no ICP is fine; a tenant whose ICP TABLE is missing gets a 500.
  { severity: 'BLOCKING', table: 'prospect_icps',         column: 'organization_id', motivation: 'Tenant predicate on resolveIcpByKey, whose error path throws through the prospect read. Anchor for the whole D1 migration.' },
  { severity: 'BLOCKING', table: 'prospect_icps',         column: 'icp_key',         motivation: 'The lookup predicate every ICP read leads with; absent, the filter is 42703.' },
  { severity: 'BLOCKING', table: 'prospect_icp_versions', column: 'organization_id', motivation: 'Tenant predicate on getRatifiedVersionRow; in VERSION_COLUMNS. Same throwing path.' },
  { severity: 'BLOCKING', table: 'prospect_icp_versions', column: 'icp_id',          motivation: 'Version→ICP link; predicate and VERSION_COLUMNS member on every version read.' },
  { severity: 'BLOCKING', table: 'prospect_icp_versions', column: 'version',         motivation: 'VERSION_COLUMNS member and the compare-and-set key of ratification.' },
  { severity: 'BLOCKING', table: 'prospect_icp_versions', column: 'status',          motivation: '`.eq(\'status\', \'ratified\')` on the evaluator\'s read and the CAS predicate on promotion.' },
  { severity: 'BLOCKING', table: 'prospect_icp_versions', column: 'criteria',        motivation: 'VERSION_COLUMNS member; the ratified criteria the ICP evaluator scores against.' },
  { severity: 'WARN', table: 'prospect_icp_versions', column: 'proposal',              motivation: 'VERSION_COLUMNS member, but only the proposal audit trail — POST /api/prospect-icp/propose, not the scoring read.' },
  { severity: 'WARN', table: 'prospect_icp_versions', column: 'proposed_by_model',     motivation: 'Proposal provenance.' },
  { severity: 'WARN', table: 'prospect_icp_versions', column: 'ratified_at',           motivation: 'Ratification audit; getRatifiedIcp returns null when it is absent from the row, which is the abstain case.' },
  { severity: 'WARN', table: 'prospect_icp_versions', column: 'ratified_by',           motivation: 'Ratification attribution.' },
  { severity: 'WARN', table: 'prospect_icp_versions', column: 'superseded_at',         motivation: 'Supersession audit.' },
  { severity: 'WARN', table: 'prospect_icp_versions', column: 'superseded_by_version', motivation: 'Supersession chain.' },

  // ── contact_governance_records — LI-3 (20261003000000) ───────────────────
  // BLOCKING, and the reasoning is worth stating because the code fails CLOSED:
  // `governanceService` converts a read failure into
  // `failClosed('governance_lookup_failed_failclosed')` and
  // `suppressionService.canonicalVerdict` throws outright. So nobody on a DNC
  // list gets contacted — but EVERY outreach send is refused, for every tenant,
  // for as long as the migration is unapplied. That is a total outage of the
  // outreach product, not a degrade, and shipping it under a WARN that says
  // "apply soon" would be dishonest about what the deploy does.
  { severity: 'BLOCKING', table: 'contact_governance_records', column: 'organization_id',   motivation: 'Tenant predicate on loadGovernanceRecords\' explicit select. Anchor for the LI-3 table; absent, every send fails closed and suppressionService throws.' },
  { severity: 'BLOCKING', table: 'contact_governance_records', column: 'person_id',         motivation: 'One of the two anchor predicates the governance read runs (`.eq(\'person_id\', …)`); the A3 person-anchored suppression lookup.' },
  { severity: 'BLOCKING', table: 'contact_governance_records', column: 'target_normalized', motivation: 'The other anchor predicate (`.eq(\'target_normalized\', …)`) — the address-anchored lookup used when no person is resolved.' },
  { severity: 'BLOCKING', table: 'contact_governance_records', column: 'revoked_at',        motivation: '`.is(\'revoked_at\', null)` — the live-record predicate. Absent, the filter is 42703 and no suppression record can be read at all.' },
  { severity: 'WARN', table: 'contact_governance_records', column: 'governance_type',  motivation: 'dnc/unsubscribe/bounce classification; in the select list, so covered by the anchors above — listed to document the write surface.' },
  { severity: 'WARN', table: 'contact_governance_records', column: 'effective_until',  motivation: 'Deferred-suppression expiry; absence collapses "not now" into an unbounded record.' },

  // ── person_duplicate_candidates — LI-4C (20261004000000) ─────────────────
  // WARN: no tenant read path selects from it. It is an operator review queue
  // (`listOpenDuplicateCandidates`, `resolveDuplicateCandidate`) fed by
  // `parkDuplicateCandidate`, which treats 23505 as success. A missing table
  // means duplicates stop being surfaced for review — bad, and not a 500 on a
  // customer request.
  { severity: 'WARN', table: 'person_duplicate_candidates', column: 'organization_id', motivation: 'Tenant predicate on the review queue; anchor for the LI-4C table.' },
  { severity: 'WARN', table: 'person_duplicate_candidates', column: 'classification',  motivation: 'definite/probable/possible — what the operator triages on.' },
  { severity: 'WARN', table: 'person_duplicate_candidates', column: 'matched_on',      motivation: 'Which signal paired the two people; the audit for a merge decision.' },
  { severity: 'WARN', table: 'person_duplicate_candidates', column: 'status',          motivation: 'open/merged/retained/dismissed/deleted; the queue filter.' },

  // ── identity_claims — W1 (20260920000000) ────────────────────────────────
  // WARN: no reader on the prospect read or enrich path. `persistClaims`
  // records a per-claim failure rather than throwing, `externalIdentityShadow`
  // returns `{ ok: false }`, and the shadow resolver falls back to the spine's
  // own primary_email / primary_phone. Absence degrades identity resolution to
  // the pre-W1 behaviour; it does not fail a request.
  { severity: 'WARN', table: 'identity_claims', column: 'organization_id',  motivation: 'Tenant predicate on every claim lookup; anchor for the W1 claims table.' },
  { severity: 'WARN', table: 'identity_claims', column: 'normalized_value', motivation: 'The claimed identifier, and part of the tenant uniqueness tuple that makes re-runs converge instead of duplicating.' },
  { severity: 'WARN', table: 'identity_claims', column: 'platform',         motivation: 'Part of the same NULLS NOT DISTINCT uniqueness tuple; separates external identities from provider-agnostic ones.' },
  { severity: 'WARN', table: 'identity_claims', column: 'revoked_at',       motivation: '`.is(\'revoked_at\', null)` — a withdrawn belief must not resolve; absent, the predicate cannot be expressed.' },

  // ── prospect_enrichment_attempts — A4/A5/A6 (20261015000000 … 20261020000000) ──
  // WARN, deliberately, and this is the entry most worth arguing about. It IS
  // on the POST /api/prospects/[id]/enrich path. But attempt recording is
  // explicitly fail-open there: recordedExecution catches the open
  // ("losing the audit row is a smaller harm than refusing the work") and runs
  // `complete()` inside `try { … } catch {}`. It fails CLOSED only for leased /
  // automated callers and for `requireAttemptRecord`. So a missing column loses
  // the spend audit and disables lease-based recovery — serious, and not a 500
  // on the tenant's request. One entry per ALTER migration so a partially
  // applied ledger is still visible.
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'organization_id',      motivation: 'Tenant predicate + insert column; anchor for the A4A attempt record (20261015000000).' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'requested_attributes', motivation: 'A4Y work-item identity — the canonical attribute set the live partial unique index arbitrates on. Absent, two workers can both call (and both pay) a provider for the same work.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'correlation_id',       motivation: 'Ties an attempt to the request that caused it; the only thread through a spend investigation.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'claimed_by',           motivation: 'A4N lease owner (20261016000000). The claim path is NOT fail-open; absent, leased enrichment throws and abandonment recovery cannot run.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'claimed_until',        motivation: 'A4N lease expiry (20261016000000); how a dead worker\'s work item is reclaimed.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'provider_call_state',  motivation: 'A4Q (20261017000000) — written BEFORE transport so a process death is recorded as `unknown` rather than decaying to `not_called` and authorising a second paid call.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'execution_status',     motivation: 'A5 (20261019000000) — in the insert payload and in completeAttempt\'s update.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'next_retry_at',        motivation: 'A6A (20261020000000) — the provider-stated retry horizon; absent, the retry-candidate reader cannot honour a rate-limit backoff.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'source_record_id',     motivation: 'Links an attempt to the LI-2 evidence it produced.' },
  { severity: 'WARN', table: 'prospect_enrichment_attempts', column: 'attributes_returned',  motivation: 'What the provider actually answered, against what was asked.' },

  // ── outreach_tasks / outreach_outcomes — WS-3 + A3 (20261011000000) ──────
  // BLOCKING: `prospectOutcomes/corpus.ts` is imported by
  // `prospectIntelligenceRead` and both its ports use explicit select lists
  // ending in `if (error) throw`, on GET /api/prospects/[id].
  { severity: 'BLOCKING', table: 'outreach_tasks', column: 'company_id',      motivation: 'Tenant predicate on corpus.loadTasks (`if (error) throw`) and on the governance/quota task reads.' },
  { severity: 'BLOCKING', table: 'outreach_tasks', column: 'person_id',       motivation: 'A3 (20261011000000) person anchor. corpus.loadTasks filters on it directly; `lead_id` is deliberately NOT read because A3 records it is not proven to be leads.id. Absent, the outcome corpus throws and no prospect can show its outreach history.' },
  { severity: 'BLOCKING', table: 'outreach_tasks', column: 'channel',         motivation: 'In corpus.loadTasks\' literal select list.' },
  { severity: 'BLOCKING', table: 'outreach_tasks', column: 'delivery_status', motivation: 'In corpus.loadTasks\' literal select list.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'company_id',        motivation: 'Tenant predicate on corpus.loadOutcomes (`if (error) throw`).' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'task_id',           motivation: 'In the literal select list and the `.in()` predicate joining outcomes to this prospect\'s tasks.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'outcome_type',      motivation: 'In the literal select list; opened/clicked/replied/meeting_booked — the corpus itself.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'derived',           motivation: 'In the literal select list; separates an observed outcome from an inferred one.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'occurred_at',       motivation: 'In the literal select list and half of the idempotency tuple.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'source',            motivation: 'WS-3 feedback ingestion (20260915000000) — in corpus.loadOutcomes\' literal select list, so an unapplied ALTER 42703s the read.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'provider',          motivation: 'WS-3 feedback ingestion (20260915000000) — same literal select list.' },
  { severity: 'BLOCKING', table: 'outreach_outcomes', column: 'provider_event_id', motivation: 'WS-3 feedback ingestion (20260915000000) — same literal select list; the provider-side dedup key.' },
  { severity: 'WARN', table: 'outreach_outcomes', column: 'metadata', motivation: 'WS-3 feedback ingestion (20260915000000); written by ingestFeedback but not in the corpus select list.' },

  // outreach_decisions — A3 (20261011000000) identity-anchor columns. WARN:
  // these are the governance AUDIT trail, written after a verdict is reached.
  // A missing column loses the record of why a send was allowed or denied; it
  // does not change the verdict, which is computed from the governance records
  // above.
  { severity: 'WARN', table: 'outreach_decisions', column: 'person_id',         motivation: 'A3 (20261011000000): which person the governance verdict was anchored to.' },
  { severity: 'WARN', table: 'outreach_decisions', column: 'identity_anchor',   motivation: 'A3 (20261011000000): which anchor kind produced the verdict.' },
  { severity: 'WARN', table: 'outreach_decisions', column: 'identity_degraded', motivation: 'A3 (20261011000000): records that the verdict was reached without a resolved person — the flag that distinguishes a clean allow from a best-effort one.' },

  // ── prospect_lifecycle_transitions — PI-LIFECYCLE (20261028000000) ──────
  // PI-VERIFY-001 (NF-08): this table was absent from the manifest entirely,
  // although its CHECK constraints ARE the lifecycle authorization model. Both
  // readers (readCurrentProspectState / readProspectLifecycleHistory) use a
  // LITERAL select list and throw on error, so an unapplied column is a 42703
  // that propagates — and readCurrentProspectState is what the writer's own
  // append-only chain check consults, so a gap there stops every transition.
  // BLOCKING = the current-state read or the append; WARN = history detail only.
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'organization_id', motivation: 'Tenant predicate (.eq) on both reads and the only tenant key on the row; also the organization half of all three composite FKs.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'prospect_id', motivation: 'The other .eq predicate on both reads — which prospect the ledger is about.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'seq', motivation: 'The .order key. "Latest" is defined by it, so the writer cannot verify previous_state without it.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'state', motivation: 'In the literal select list and checked against the 7-word TS vocabulary; a divergence throws by design.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'previous_state', motivation: 'In the literal select list; the append-only chain trigger compares NEW.previous_state to the actual latest state.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'is_initial', motivation: 'In the literal select list and the partial unique index that permits exactly one initial row per prospect.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'transitioned_at', motivation: 'In the literal select list of the current-state read.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'origin', motivation: 'Written on every append and constrained with actor_user_id by prospect_lifecycle_origin_actor; absent, no transition can be recorded.' },
  { severity: 'BLOCKING', table: 'prospect_lifecycle_transitions', column: 'evidence_kind', motivation: 'Written on every append and constrained against the evidence FKs by prospect_lifecycle_evidence_typed.' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'evidence_outcome_id', motivation: 'History detail; the outcome half of the composite evidence FK (ON DELETE RESTRICT).' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'evidence_source_record_id', motivation: 'History detail; the source-record half of the composite evidence FK (ON DELETE RESTRICT).' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'evidence_detail', motivation: 'History detail; jsonb, defaulted, in the history select list only.' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'source_event_key', motivation: 'History detail; shape-constrained so a leadKey is structurally inexpressible.' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'actor_user_id', motivation: 'History detail; required for origin=human and forbidden for origin=derived by the origin/actor CHECK.' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'reasoning', motivation: 'History detail; length-constrained.' },
  { severity: 'WARN', table: 'prospect_lifecycle_transitions', column: 'model_version', motivation: 'History detail; which rule version produced a derived transition.' },

  // ── outreach_approvals / _attempts / _delivery_evidence — WS-3 (20260910000000)
  // PI-VERIFY-001 (NF-08): also absent from the manifest. NOTE THE FAILURE MODE
  // — unlike every table above, these three are read through storage.listFor,
  // which wraps the query in safeDb and returns [] on error. A missing column
  // therefore does NOT throw: it yields an EMPTY LIST that is indistinguishable
  // from "this task has no approvals / no attempts / no delivery evidence".
  // That is a fail-OPEN read, which is why manifest coverage matters here even
  // though nothing raises. Tenant/anchor predicates are BLOCKING on the same
  // basis as every other table; ordering and payload columns are WARN.
  { severity: 'BLOCKING', table: 'outreach_approvals', column: 'company_id', motivation: 'Tenant predicate (.eq) on storage.listApprovals. Absent, the read silently returns [] and an approval history reads as empty.' },
  { severity: 'BLOCKING', table: 'outreach_approvals', column: 'task_id', motivation: 'The task anchor predicate (.eq) on storage.listApprovals; same silent-empty consequence.' },
  { severity: 'WARN', table: 'outreach_approvals', column: 'decided_at', motivation: 'The .order key for listApprovals; absent, the read returns [] rather than mis-ordering.' },
  { severity: 'WARN', table: 'outreach_approvals', column: 'decision', motivation: 'approved/rejected; selected via a star projection, so covered by the anchors — listed to document the surface.' },
  { severity: 'BLOCKING', table: 'outreach_attempts', column: 'company_id', motivation: 'Tenant predicate (.eq) on storage.listAttempts AND on the quota/governance attempt reads that gate sending.' },
  { severity: 'BLOCKING', table: 'outreach_attempts', column: 'task_id', motivation: 'Task anchor (.eq) on listAttempts and in the literal select of the quota/governance reads.' },
  { severity: 'BLOCKING', table: 'outreach_attempts', column: 'started_at', motivation: 'The .gte window predicate in quota.ts and governanceService.ts — the rate-limit horizon. Absent, the window read fails and the quota view of recent attempts is empty.' },
  { severity: 'WARN', table: 'outreach_attempts', column: 'attempt_number', motivation: 'The .order key for listAttempts; also the third column of the (company_id, task_id, attempt_number) uniqueness that makes a retry idempotent.' },
  { severity: 'BLOCKING', table: 'outreach_delivery_evidence', column: 'company_id', motivation: 'Tenant predicate (.eq) on storage.listDeliveryEvidence; silent-empty on absence.' },
  { severity: 'BLOCKING', table: 'outreach_delivery_evidence', column: 'task_id', motivation: 'Task anchor predicate (.eq) on storage.listDeliveryEvidence.' },
  { severity: 'WARN', table: 'outreach_delivery_evidence', column: 'observed_at', motivation: 'The .order key for listDeliveryEvidence.' },
  { severity: 'WARN', table: 'outreach_delivery_evidence', column: 'delivery_status', motivation: 'The 9-value delivery vocabulary; selected via a star projection, listed to document the surface.' },

  // ── the WS-5 engagement seam (GAP-A) — four NON-PI-owned tables ─────────────
  // Listed on the same basis as integration_credentials below: PI is a CONSUMER
  // whose read throws. Ownership is not the test this manifest applies; impact
  // is ("a severity reflecting real operational impact").
  //
  // What makes these BLOCKING rather than WARN is a single structural fact:
  // `readProspectEngagementIntelligence` is the ONE seam in the prospect read
  // deliberately NOT wrapped. prospectIntelligenceRead.ts:279-280 awaits it with
  // no try/catch and no attempt(), because its null IS the 404 that answers
  // "does this prospect exist in this tenant". Every other seam is wrapped and
  // degrades to a `failed` section; this one does not. So a throw here becomes
  // HTTP 503 `prospect_intelligence_unavailable` for the ENTIRE prospect detail
  // response (pages/api/prospects/[id].ts:73), not a degraded panel.
  //
  // That seam reads five tables with explicit column lists and `if (error) throw`.
  // canonical_leads is already covered above; these are the other four. Covering
  // only some of them would make the gate's view of one code path arbitrary.
  //
  // Precedent, not innovation: engagement_threads has ALREADY 42703'd production
  // once — migration 20260917000000 records it, caused by an ungoverned
  // `database/` file being only partially applied, which is the exact failure
  // class this gate exists for. These tables are MORE exposed than the PI tables
  // above, because much of their schema comes from files CI never applies.
  //
  // Scope is deliberately narrow: only columns PI actually selects or filters on.
  // The engagement domain's own surface (window_open, raw_payload, assigned_to…)
  // is not imported here — PI has no dependency on it and this manifest is a
  // record of consumer contracts, not a second schema authority.
  { severity: 'BLOCKING', table: 'engagement_threads',  column: 'organization_id',   motivation: 'GAP-A: tenant predicate on BOTH PI engagement reads (prospectEngagementIntelligence.loadThreads, accountIntelligence.loadEngagement). Absent, the filter itself is 42703 and GET /api/prospects/[id] returns 503. Also the anchor detecting the whole table being absent.' },
  { severity: 'BLOCKING', table: 'engagement_threads',  column: 'unified_person_id', motivation: 'GAP-A: added LATER by 20260621_unified_person_identity_spine.sql, so individually missable under a partial ledger. It is the ONLY key PI has to reach engagement at all.' },
  { severity: 'BLOCKING', table: 'engagement_threads',  column: 'contact_id',        motivation: 'GAP-A: added LATER by 20260419_contacts_spine.sql, so individually missable. In loadThreads\' literal select list on the unguarded seam. canonicalLeadSignalService.ts:326 already codes defensively around this exact column being absent; PI does not — it throws.' },
  { severity: 'BLOCKING', table: 'engagement_threads',  column: 'platform',          motivation: 'GAP-A: in loadThreads\' literal select list; the channel every timeline entry is built from.' },
  { severity: 'BLOCKING', table: 'engagement_messages', column: 'thread_id',         motivation: 'GAP-A: the join key loadMessages selects and filters on, on the unguarded seam → 503. NOTE: engagement_messages has no tenant column of its own; it is reached only via thread ids already scoped by organization_id.' },
  { severity: 'BLOCKING', table: 'engagement_messages', column: 'direction',         motivation: 'GAP-A: in loadMessages\' literal select list; distinguishes inbound from outbound in the timeline, which is what makes engagement evidence directional.' },
  { severity: 'BLOCKING', table: 'contacts',            column: 'organization_id',   motivation: 'GAP-A: tenant predicate on loadContactIds, on the unguarded seam. Also the anchor for the table.' },
  { severity: 'BLOCKING', table: 'contacts',            column: 'unified_person_id', motivation: 'GAP-A: added LATER by 20260621_unified_person_identity_spine.sql, so individually missable. The predicate linking a contact to the person whose timeline is being read.' },
  { severity: 'BLOCKING', table: 'lead_signals',        column: 'organization_id',   motivation: 'GAP-A: tenant predicate on both of loadSignals\' reads, on the unguarded seam. Also the anchor for the table.' },
  { severity: 'BLOCKING', table: 'lead_signals',        column: 'source_type',       motivation: 'GAP-A: in loadSignals\' 13-column literal select list. The engagement/listening discriminator — the contract frozen by manifest C-5.' },
  { severity: 'BLOCKING', table: 'lead_signals',        column: 'thread_id',         motivation: 'GAP-A: one of the two link keys loadSignals reads and filters on.' },
  { severity: 'BLOCKING', table: 'lead_signals',        column: 'contact_id',        motivation: 'GAP-A: the second link key loadSignals reads and filters on.' },

  // ── integration_credentials — A3M tenant credential ownership (20261014000000) ──
  // Not a PI-owned table, but 20261014000000 is part of the same uncovered
  // series and the columns it adds are what make a provider credential belong
  // to a TENANT rather than to Omnivyra. Severity is WARN, conservatively: the
  // caller traced here (`tenantSourceStatuses`) resolves each credential with
  // `.catch(() => null)`, so an unapplied migration reports every acquisition
  // source as "not connected" rather than throwing. The executor's own
  // credential resolution has NOT been traced end-to-end here; if it proves
  // not to be fail-open, these two belong at BLOCKING.
  { severity: 'WARN', table: 'integration_credentials', column: 'company_id',   motivation: 'A3M (20261014000000): the tenant a provider credential belongs to. Predicate on readTenantProviderCredentials; absent, no tenant can own an enrichment provider key and every source falls back to the platform-wide env var — the A3V defect this migration exists to close.' },
  { severity: 'WARN', table: 'integration_credentials', column: 'provider_key', motivation: 'A3M (20261014000000): which provider the credential is for. Second half of the (company_id, provider_key, credential_key) tenant credential identity.' },

  // ══ Prospect provenance (contract 2026-10-30) ═════════════════════════════
  //
  // docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md; names are contract
  // (lib/prospectProvenance/contract.ts PROVENANCE_DB).
  //
  // ── prospect_source_contributions — append-only per-lead source ledger ────
  // BLOCKING. The table is created by ONE migration, so organization_id is the
  // anchor that detects it being unapplied; the remaining entries are the five
  // expectations REPLACED from the retired active_leads block (contact_id,
  // platform, observed_at, opportunity_feed_item_id, and organization_id itself)
  // plus the contract identity columns. Why BLOCKING and not WARN like the
  // fail-open Writer block: backend/services/prospectProvenance/contributionWriter.ts
  // is the ONLY write path, it INSERTs a payload naming every one of these
  // columns, and it RETURNS the failure (it neither swallows nor degrades) —
  // so an absent table or column fails every provenance write, and an
  // observation's originating source and observed_at cannot be reconstructed
  // later. Losing provenance permanently is the failure the owner requirement
  // forbids, not a degrade.
  //
  // RELEASE CONSEQUENCE (intended): until the provenance migration is applied in
  // production these entries are BLOCKING findings, the verifier exits 1 and
  // predeploy BLOCKS. See docs/architecture/PROSPECT-PROVENANCE-RELEASE-CHECKLIST.md.
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'organization_id',          motivation: 'Tenant (= companies.id) and the anchor detecting the provenance migration being unapplied. REPLACES active_leads.organization_id.' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'canonical_lead_id',        motivation: 'The prospect a contribution belongs to (composite FK to canonical_leads(id, company_id)); part of uq_psc_org_lead_external_ref.' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'contribution_role',        motivation: 'originating | contributing — the column the one-originating partial index is predicated on.' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'source_category',          motivation: 'Discovery classification (12-value CHECK vocabulary); never inferred from the display source.' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'external_ref',             motivation: 'Namespaced <provider>:<id>; the per-lead idempotency key in uq_psc_org_lead_external_ref.' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'observed_at',              motivation: 'When the SOURCE observed the prospect (not ingestion time). REPLACES active_leads.first_seen_at (the lead-level origin time is the originating contribution\'s observed_at).' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'contact_id',               motivation: 'The platform handle that produced the signal (composite FK to contacts). REPLACES active_leads.contact_id.' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'platform',                 motivation: 'Originating platform/provider per contribution. REPLACES active_leads.source_platforms (the deduped union is derivable).' },
  { severity: 'BLOCKING', table: 'prospect_source_contributions', column: 'opportunity_feed_item_id', motivation: 'Typed signal → lead link (composite FK to opportunity_feed_items; must survive the feed item\'s retention delete). REPLACES opportunity_feed_items.active_lead_id.' },

  // ── lead_intelligence — the durable unified lead store (20260629000000) ───
  // The only landing point for MarketPulse / community / engagement / website /
  // CRM adoption (adoptLead), and the store the unified reader lists. WARN, by
  // the same rule as the Writer block above: every path is FAIL-OPEN —
  // leadIntelligenceRepository.upsertCanonicalLead returns null on error,
  // listCanonicalLeads / getCanonicalLead return [] / null, and adoption is
  // fire-and-forget. An absent column therefore makes every adoption write fail
  // SILENTLY (the upsert names all of these columns; PostgREST rejects the whole
  // row) and the unified view loses those sources — a degrade that no request
  // surfaces, which is exactly why the gate must report it, but not a throw on a
  // tenant request, so not BLOCKING. Single-migration table: company_id is the
  // anchor; the others are the provenance columns the reader projects
  // (rowToView) and the predicates / order key it filters on.
  { severity: 'WARN', table: 'lead_intelligence', column: 'company_id',        motivation: 'Tenant predicate on every lead_intelligence read and the anchor detecting the table being absent; in the adoption upsert payload.' },
  { severity: 'WARN', table: 'lead_intelligence', column: 'dedupe_key',        motivation: 'Half of the upsert conflict target (company_id, dedupe_key); absent, every adoption upsert fails and is swallowed.' },
  { severity: 'WARN', table: 'lead_intelligence', column: 'source',            motivation: 'Display source (CanonicalLeadSource) — the provenance label the unified view, stats.bySource and exports group by; `.eq(\'source\')` filter.' },
  { severity: 'WARN', table: 'lead_intelligence', column: 'source_table',      motivation: 'Originating table of the adopted lead (sourceRef.table in the unified view).' },
  { severity: 'WARN', table: 'lead_intelligence', column: 'source_id',         motivation: 'Originating row id of the adopted lead (sourceRef.id in the unified view).' },
  { severity: 'WARN', table: 'lead_intelligence', column: 'occurred_at',       motivation: 'When the source event happened; the order() key of listCanonicalLeads.' },
  { severity: 'WARN', table: 'lead_intelligence', column: 'unified_person_id', motivation: 'Person anchor; `.eq(\'unified_person_id\')` predicate on listCanonicalLeads.' },

  // ── prospect_source_contribution_redactions — privacy tombstones (20270108000001)
  // BLOCKING. Person erasure (personErasure.ts → prospectProvenance/redaction.ts)
  // calls pi_redact_prospect_source_contributions, which writes these columns in
  // the same transaction as the redaction, and the erasure FAILS CLOSED on any
  // error: absent, erasure of any person with provenance throws and the person
  // is NOT erased (a compliance path stops). Single-migration table:
  // organization_id is the anchor; the others are what the function inserts
  // and what makes the record auditable and idempotent.
  { severity: 'BLOCKING', table: 'prospect_source_contribution_redactions', column: 'organization_id', motivation: 'Tenant of the tombstone and the anchor detecting 20270108000001 unapplied; absent, person erasure with provenance fails closed.' },
  { severity: 'BLOCKING', table: 'prospect_source_contribution_redactions', column: 'contribution_id', motivation: 'Redacted contribution (composite FK, SET NULL (contribution_id)); uq_pscr_contribution makes redaction idempotent.' },
  { severity: 'BLOCKING', table: 'prospect_source_contribution_redactions', column: 'reason',          motivation: 'Why the contribution was redacted (the audit half of owner decision 8).' },
  { severity: 'BLOCKING', table: 'prospect_source_contribution_redactions', column: 'values_sha256',   motivation: 'RETIRED by 20270109000000 (always NULL, CHECK pscr_values_sha256_retired); still inserted as NULL by the erasure function, so its absence fails erasure closed.' },

  // ── marketpulse_signal_observations — per-tenant MarketPulse view (20270108000001)
  // WARN, by the fail-open rule: recordMarketPulseObservation returns an
  // outcome and never throws (42P01/PGRST205 → skipped), so an absent table
  // degrades silently to the pre-existing behaviour (tenant content only on the
  // adopted lead snapshot) rather than failing a MarketPulse run.
  { severity: 'WARN', table: 'marketpulse_signal_observations', column: 'company_id',      motivation: 'Tenant of the observation and the anchor detecting 20270108000001 unapplied; absent, tenant observations are silently skipped.' },
  { severity: 'WARN', table: 'marketpulse_signal_observations', column: 'signal_id',       motivation: 'Link to the global marketpulse_signals row (insert-only; never carries tenant content after creation).' },
  { severity: 'WARN', table: 'marketpulse_signal_observations', column: 'observation_key', motivation: 'Idempotency key in uq_mpso_company_signal_observation (company_id, signal_id, observation_key).' },
  { severity: 'WARN', table: 'marketpulse_signal_observations', column: 'observed_at',     motivation: 'When THIS tenant observed the signal.' },

  // ── closure-D (lifecycle governance) ──
  // 20270109000003_pi_opportunity_governance.sql adds NO column: it adds two
  // trigger functions (snooze-terminal guard, append-only dispositions) and two
  // composite FKs over columns that exist since 20260520. A column probe cannot
  // see triggers or FKs, so no column entry would detect it unapplied; the one
  // structural expectation closure-D adds is the 20270108000000 index in
  // REQUIRED_INDEXES below. Deliberately empty rather than padded.
  // ── end closure-D ──
  // ── closure-A (privacy) ──
  // prospect_provenance_erasures — the per-call erasure audit event
  // (20270109000000). BLOCKING: pi_erase_prospect_provenance inserts this row
  // in the same transaction as the erasure, and person erasure FAILS CLOSED on
  // any error (including an undeployed function): absent, no person can be
  // erased. organization_id is the anchor detecting 20270109000000 unapplied;
  // the rest is the minimum the audit record must prove (who/why/what/how many).
  { severity: 'BLOCKING', table: 'prospect_provenance_erasures', column: 'organization_id', motivation: 'Tenant of the erasure event and the anchor detecting 20270109000000 unapplied; absent, every person erasure fails closed.' },
  { severity: 'BLOCKING', table: 'prospect_provenance_erasures', column: 'subject_kind',    motivation: 'person | prospect — what kind of subject the erasure covered.' },
  { severity: 'BLOCKING', table: 'prospect_provenance_erasures', column: 'reason',          motivation: 'Why the erasure happened (the audit half of owner decision 8).' },
  { severity: 'BLOCKING', table: 'prospect_provenance_erasures', column: 'requested_by',    motivation: 'Who/what requested the erasure.' },
  { severity: 'BLOCKING', table: 'prospect_provenance_erasures', column: 'table_counts',    motivation: 'Rows changed per table — proof of scope without retaining any value or hash.' },
  // ── end closure-A ──
  // ── closure-C (enrichment/scoring) ──
  // canonical_leads.qualification_score: NO manifest change — the verifier checks
  // existence only, and 20270109000002 changes nullability/default, not existence.
  // BLOCKING: listProspects' literal select now reads the scoring marker
  // `lead_metadata->qualificationScoring` and throws on error.
  { severity: 'BLOCKING', table: 'canonical_leads', column: 'lead_metadata', motivation: 'closure C: listProspects selects lead_metadata->qualificationScoring (legacy-default-0 rule); a missing column 500s the prospect list.' },
  // WARN, fail-open: the enrichment applicability readers (enrichmentContribution.ts)
  // turn a read error into a counted `pi_enrichment:error` outcome, never a failed enrichment.
  { severity: 'WARN', table: 'source_records', column: 'account_id', motivation: 'closure C: account evidence attaches only where the originating source record names the account.' },
  { severity: 'WARN', table: 'person_account_relationships', column: 'organization_id', motivation: 'closure C: tenant predicate of the current-relationship account link.' },
  { severity: 'WARN', table: 'person_account_relationships', column: 'person_id', motivation: 'closure C: person leg of the current-relationship account link.' },
  { severity: 'WARN', table: 'person_account_relationships', column: 'account_id', motivation: 'closure C: account leg of the current-relationship account link.' },
  { severity: 'WARN', table: 'person_account_relationships', column: 'ended_at', motivation: 'closure C: only CURRENT relationships (ended_at IS NULL) evidence an account link.' },
  // ── end closure-C ──
  // ── closure-B (identity/aliases) ──
  // prospect_aliases (20270109000001) — verified-identity reconciliation. WARN,
  // by the fail-open rule: identityReconciliation never throws and maps a
  // missing table (42P01/PGRST205) to `unavailable` (no alias written, the
  // bridge/discovery outcome unchanged), and readProspectAliases degrades to
  // "no alias" (an absorbed prospect stays visible as its own lead) — a silent
  // degrade the gate must report, not a throw on a tenant request.
  { severity: 'WARN', table: 'prospect_aliases', column: 'organization_id',  motivation: 'Tenant of the alias and the anchor detecting 20270109000001 unapplied; absent, reconciliation is unavailable and absorbed prospects stay separate leads.' },
  { severity: 'WARN', table: 'prospect_aliases', column: 'alias_lead_id',    motivation: 'The absorbed prospect (composite FK to canonical_leads(id, company_id)); part of uq_prospect_alias_org_alias.' },
  { severity: 'WARN', table: 'prospect_aliases', column: 'survivor_lead_id', motivation: 'The terminal survivor the reader resolves the absorbed prospect onto (composite FK to canonical_leads(id, company_id)).' },
  { severity: 'WARN', table: 'prospect_aliases', column: 'reason',           motivation: 'Why the alias exists (CHECK: verified_identity); the audit half of the reconciliation.' },
  // ── end closure-B ──
];

// ══ GAP-B — the indexes that ARE the idempotency mechanism ════════════════
//
// Everything above asks exactly one question: does this column exist? That
// question cannot see the dependency this block covers, and the failure it
// misses is SILENT.
//
// `backend/services/prospectIdentity/ingestionBoundary.ts` says it in its own
// words: "Idempotency is by DATABASE CONSTRAINT, never SELECT-then-INSERT: the
// insert is attempted, and a 23505 means another worker won the race, at which
// point the existing row is updated." Three writers are built that way:
//
//   upsertSourceRecord       INSERT → `code !== '23505'` rethrows; on 23505 it
//                            re-reads by (organization_id, provider,
//                            source_entity_type, source_record_id) and bumps
//                            observation_count / re-hashes the payload.
//   recordAssertions         INSERT per attribute → 23505 is counted as
//                            `alreadyPresent`, anything else throws.
//   contactGovernanceWriter  INSERT → 23505 → resolveByCanonicalKey, returning
//   .recordContactGovernance `outcome: 'already_present'`.
//
// Every one of those branches is reached ONLY because a unique index raises
// 23505. Drop the index and nothing raises: the INSERT succeeds, the code takes
// the `created` path, no error is logged, and this gate — which finds every
// column present — exits 0. Re-ingesting the same provider record then appends
// a SECOND observation instead of being a no-op, `observation_count` stays 1
// forever, the payload-hash change detection never runs because it lives on the
// conflict branch, and `assertionsAlreadyPresent` is permanently 0. The
// corruption lands in the evidence layer, whose entire purpose is to be
// trustworthy after the fact.
//
// THREE PROPERTIES, NOT ONE. Existence alone is not the requirement:
//   - a NON-UNIQUE index of the same name raises nothing at all;
//   - a PARTIAL index only covers rows its predicate matches, so rows outside
//     it collide with nothing.
// `uq_contact_governance_identity` is partial BY DESIGN (`WHERE revoked_at IS
// NULL`, so a revocation frees the key and re-recording stays expressible) —
// which is precisely why its writer must INSERT-and-catch: PostgREST cannot
// infer a partial index and `ON CONFLICT` answers 42P10, the trap W0.1, W0.2
// and W3 each hit. Partiality is therefore stated per index and a divergence in
// EITHER direction is a finding.
//
// WHAT THIS DOES NOT PROVE. It proves an index of this name exists on this
// table, with this uniqueness and this partiality, and that
// `pg_get_indexdef()` mentions each expected key. The key check is a SUBSTRING
// test on the definition, not a parsed key-list comparison: an index over the
// right columns in the wrong ORDER, or carrying an extra trailing key, passes
// here. It does not read `indisvalid`/`indisready`, so an index left behind by
// a failed CREATE INDEX CONCURRENTLY is reported as present (Postgres does
// still enforce uniqueness through an invalid unique index, so this is a
// reporting gap rather than a correctness one). And it proves nothing at all
// about the rows already in the table: an index that exists today says the
// constraint is enforced from now on, not that yesterday's ingestion was
// idempotent.
//
// SEVERITY RULE FOR AN INDEX (distinct from the column rule above). BLOCKING
// when the index's absence makes a write path silently persist WRONG STATE —
// no error, no degrade, just incorrect data that looks correct. WARN when the
// absence only slows a query or loses an operator convenience, since the
// runtime behaviour is unchanged. All three below are the first kind; there is
// no performance-only index in this manifest, deliberately, because a gate that
// blocks on query plans is a gate somebody disables.
const REQUIRED_INDEXES = [
  {
    severity: 'BLOCKING',
    table: 'source_records',
    index: 'uq_source_records_tenant_identity',
    unique: true,
    partial: false,
    keys: ['organization_id', 'provider', 'source_entity_type', 'source_record_id'],
    motivation:
      'LI-2 (20261002000000) SOURCE IDENTITY — one row per provider record per tenant. upsertSourceRecord INSERTs and branches on 23505; without this index the insert always succeeds, so re-ingesting the same provider record creates a DUPLICATE observation instead of bumping observation_count, and the payload-hash change detection on the conflict branch never executes. Nothing errors and this gate finds every column present. Must be NON-PARTIAL: the ops DDL script refuses a partial one because it would leave rows outside the predicate colliding with nothing.',
  },
  {
    severity: 'BLOCKING',
    table: 'source_assertions',
    index: 'uq_source_assertions_dedupe',
    unique: true,
    partial: false,
    keys: ['organization_id', 'source_record_id', 'attribute', 'value_hash'],
    motivation:
      'LI-2 (20261002000000) assertion dedupe. recordAssertions counts 23505 as alreadyPresent; without the index every re-ingestion APPENDS a duplicate row to an append-only evidence table and reports it as newly recorded. decideCanonicalUpdates de-duplicates by distinct VALUE, so the canonical verdict itself does not flip — the damage is that the evidence corpus LI-6 will arbitrate on, and the recorded/alreadyPresent counts callers trust, both become fiction.',
  },
  {
    severity: 'BLOCKING',
    table: 'contact_governance_records',
    index: 'uq_contact_governance_identity',
    unique: true,
    partial: true,
    keys: ['organization_id', 'channel', 'governance_type', 'person_id', 'target_normalized'],
    motivation:
      'LI-3B (20261003000000) canonical governance key, PARTIAL on `revoked_at IS NULL` (ADR §13) — which is why recordContactGovernance INSERTs and catches 23505 rather than using ON CONFLICT, since PostgREST cannot infer a partial index and gets 42P10. Without it a repeated unsubscribe webhook writes a second live row; resolveByCanonicalKey then `.limit(1)`s an arbitrary one, and revokeContactGovernance — which revokes by id — reports `revoked: true` while a duplicate live row keeps the person suppressed. A consent restoration that silently does not take effect is a compliance record that lies.',
  },
  // Prospect provenance (contract 2026-10-30; names are contract —
  // lib/prospectProvenance/contract.ts PROVENANCE_DB). contributionWriter.ts
  // INSERTs and branches on 23505 by constraint NAME, exactly like the three
  // above, so both indexes are the "silently persists wrong state" kind.
  {
    severity: 'BLOCKING',
    table: 'prospect_source_contributions',
    index: 'uq_psc_org_lead_external_ref',
    unique: true,
    partial: false,
    keys: ['organization_id', 'canonical_lead_id', 'external_ref'],
    motivation:
      'Provenance idempotency: one contribution per (tenant, lead, namespaced source event). recordSourceContribution maps a 23505 naming this index to `duplicate`; without it a retried or re-synced source event APPENDS a second contribution to an append-only ledger that can never be cleaned by UPDATE/DELETE (service_role has neither), and counts of contributing sources become fiction. Nothing errors.',
  },
  {
    severity: 'BLOCKING',
    table: 'prospect_source_contributions',
    index: 'uq_psc_one_originating_per_lead',
    unique: true,
    partial: true,
    keys: ['canonical_lead_id', 'contribution_role'],
    motivation:
      'Exactly ONE originating contribution per canonical lead, PARTIAL on `contribution_role = \'originating\'` — which is why the writer INSERTs and catches 23505 (PostgREST cannot infer a partial index; ON CONFLICT answers 42P10). Without it a race, or a resync that believes it created the lead, records a SECOND originator and "where was this prospect first discovered" has two answers. A non-partial index of this name would instead forbid every second contribution. Nothing errors in either case.',
  },
  // ── closure-D (lifecycle governance) ──
  {
    severity: 'BLOCKING',
    table: 'opportunity_assignments',
    index: 'uq_opp_assignment_one_active',
    unique: true,
    partial: true,
    keys: ['opportunity_feed_item_id', 'role'],
    motivation:
      'ONE active owner per (opportunity, role), PARTIAL on `unassigned_at IS NULL` (20270108000000; re-proved by 20270109000003 $verify$). assignOpportunity closes the active row then INSERTs and retries on 23505; without the index two concurrent assignments both close nothing and both insert, leaving TWO active owners — the legacy constraint opp_assignment_unique_active treats NULL unassigned_at as distinct, so it never fires. Nothing errors. A non-partial index of this name would instead forbid keeping any assignment history.',
  },
  // ── end closure-D ──
];

// ══ GAP-C — a TYPE CONVERSION the column probe is structurally blind to ═══
//
// 20261022000000 (A7P-C9) converts `source_records.ingestion_run_id` from uuid
// to text, because every live writer already supplies a non-UUID correlation
// value: a LinkedIn URN from extensionBridge, `a7e-<entityId>-<timestamp>` from
// consumeEnrichmentWork, the CRM pipeline's own run id, or whatever string an
// operator typed. The column existed BEFORE that migration and exists after it,
// so a column-existence probe reports "present" in both worlds and this gate
// goes green on a database where ingestion cannot write a single row.
//
// The failure is also in the wrong place to catch cheaply. A missing column is
// 42703 and shows up on a SELECT; an unconverted column is 22P02 ("invalid
// input syntax for type uuid") raised at INSERT — on the unguarded
// persistObservation port, which recordedExecution documents as throwing AFTER
// the provider call has already been billed. That is exactly how the first
// pilot ingestion failed, having already created a person, an identity claim,
// an account and a canonical lead.
//
// BLOCKING, on the same footing as a missing BLOCKING column: the write path is
// not fail-open, it is reachable from POST /api/prospects/[id]/enrich, and the
// money is already spent when it throws.
//
// WHAT THIS DOES NOT PROVE. It compares the column's DECLARED type
// (information_schema's udt_name) against the expected one. It does NOT prove
// that every stored row is convertible, that the conversion preserved values,
// that the migration's other effects landed (the DROP NOT NULL, the COMMENT),
// or that no later migration narrows the column again after this gate runs.
// A declared type is the precondition for the insert to parse — not a
// guarantee about data.
const REQUIRED_COLUMN_TYPES = [
  {
    severity: 'BLOCKING',
    table: 'source_records',
    column: 'ingestion_run_id',
    udtName: 'text',
    motivation:
      'A7P-C9 (20261022000000) converts this column uuid→text. Production writers already supply values no uuid can express (a LinkedIn URN, an operator batch label). If the conversion is unapplied the column is still PRESENT, so the column probe passes, and ingestionBoundary.upsertSourceRecord fails at INSERT with 22P02 — after a billed provider call — instead of 42703 at SELECT. The migration is guarded on the current type, so replaying it onto a converted schema is a no-op: there is no reason not to apply it.',
  },
];

// ══ ORCH-STACK — the orchestration-engine-adapters release ════════════════
//
// The migrations 20261127000000 and 20261226000000 … 20261231000010 create 18
// tables, 27 functions, 16 triggers and ~40 indexes, and NONE of it was in the
// manifest above: a database where the whole stack was unapplied (or half
// applied, or applied and then hand-edited) passed this gate. This block names
// every object the stack creates — `verifySchemaParityCoverage.test.ts` parses
// the migration files and fails if a CREATE TABLE / INDEX / FUNCTION / TRIGGER
// or ADD COLUMN in that series is not listed here — plus the safety properties
// existence alone cannot see: RLS, client-role privileges, SECURITY DEFINER,
// body markers of the safety-critical functions, trigger wiring and CHECK
// vocabularies.
//
// SEVERITY IS A PROPERTY OF THE CHECK RULE, not chosen per entry:
//   BLOCKING — the object is absent, or a safety property is violated: a
//              stack table/column/unique index/function/trigger/CHECK value is
//              missing; RLS is off; anon holds any table privilege; a table
//              whose migration REVOKEs from authenticated grants it anything;
//              a SECURITY DEFINER RPC is executable by anon/authenticated/
//              PUBLIC or not by service_role; SECURITY DEFINER differs from
//              the migration; a body marker is missing or a forbidden body
//              pattern is present (e.g. the reaper writing 'failed').
//   WARN     — a non-unique (query-plan) index is absent; a SECURITY INVOKER
//              RPC whose migration revokes client roles is executable by them
//              (invoker semantics bound the exposure to the caller's own
//              table privileges, so it is drift, not an escalation).
//   INFO     — owner-pending: authenticated's effective privileges on the 10
//              tables whose migration relies on RLS only (no explicit REVOKE).
//              Reported in `advisories`; NEVER part of the exit decision, in
//              any mode, until the owner decides the intended grant.
//
// WHAT THIS DOES NOT PROVE. Function bodies are checked by marker substrings
// over pg_get_functiondef(), not by equality with the migration text. Index
// keys are substring-checked like GAP-B. Trigger checks prove name, table,
// enabled state and the function called — not timing/WHEN clauses. Privilege
// checks use has_table_privilege/has_function_privilege, i.e. EFFECTIVE
// privilege including role membership, as seen by the connecting role's
// catalog view. Nothing here reads row data.

/** Source migration for each group, cited in output and in the coverage test. */
const STACK_MIGRATIONS = [
  '20261127000000_pi_prospect_lists.sql',
  '20261226000000_pi_prospect_campaigns.sql',
  '20261227000000_pi_workflow_definitions.sql',
  '20261228000000_pi_execution_instances.sql',
  '20261228000001_pi_execution_plans.sql',
  '20261228000002_pi_execution_step_scheduling.sql',
  '20261229000000_pi_outreach_bridge.sql',
  '20261230000000_orchestration_engine_requests.sql',
  '20261231000000_orchestration_campaign_targeting.sql',
  '20261231000001_orchestration_engine_requests_engines.sql',
  '20261231000002_community_execution_safety.sql',
  '20261231000003_community_journey_link.sql',
  '20261231000004_social_publish_step_channel.sql',
  '20261231000005_extension_dispatch_safety.sql',
  '20261231000006_community_identity_link.sql',
  '20261231000007_identity_verification.sql',
  '20261231000008_engagement_request_idempotency.sql',
  '20261231000009_migration_rerun_safety.sql',
  '20261231000010_rpa_legacy_session_invalidation.sql',
  '20270120000000_orchestration_journey_decisions.sql',
  '20270120000001_pi_email_content_evidence.sql',
];

/**
 * Stack tables. `revokesClientRoles` = the migration issues an explicit
 * `REVOKE ALL … FROM anon, authenticated` (so authenticated holding anything is
 * BLOCKING); false = RLS-only (authenticated is reported as INFO).
 * `serviceRoleGrants` = privileges the migration GRANTs to service_role
 * explicitly; absence is BLOCKING (the worker cannot use the table).
 */
const STACK_TABLES = [
  // 20261127000000_pi_prospect_lists.sql:114,155 (RLS :268-269)
  { table: 'prospect_lists',                     source: '20261127000000:114', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'name', 'description', 'status', 'created_by_user_id', 'created_at', 'updated_at'] },
  { table: 'prospect_list_members',              source: '20261127000000:155', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'list_id', 'prospect_id', 'status', 'added_via', 'added_at', 'added_by_user_id', 'removed_at', 'removed_by_user_id', 'removal_reason'] },
  // 20261226000000_pi_prospect_campaigns.sql:93 (RLS :149)
  { table: 'prospect_campaigns',                 source: '20261226000000:93', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'name', 'description', 'status', 'created_at', 'updated_at'] },
  // 20261227000000_pi_workflow_definitions.sql:98,139 (RLS :565-566)
  { table: 'workflows',                          source: '20261227000000:98', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'name', 'description', 'status', 'created_by', 'created_at', 'updated_at'] },
  { table: 'workflow_versions',                  source: '20261227000000:139', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'workflow_id', 'version', 'status', 'definition', 'created_by', 'created_at', 'updated_at', 'published_at', 'published_by'] },
  // 20261228000000_pi_execution_instances.sql:110 (RLS :397)
  { table: 'execution_instances',                source: '20261228000000:110', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'campaign_id', 'workflow_id', 'workflow_version_id', 'target_id', 'subject_kind', 'subject_id', 'lifecycle_state', 'created_at', 'updated_at'] },
  // 20261228000001_pi_execution_plans.sql:98,166,236 (RLS :158,222,296)
  { table: 'execution_plans',                    source: '20261228000001:98', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'execution_instance_id', 'workflow_version_id', 'definition_snapshot', 'step_count', 'status', 'created_at', 'updated_at'] },
  { table: 'execution_plan_steps',               source: '20261228000001:166', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'plan_id', 'step_key', 'step_order', 'channel', 'instruction', 'delay_after_previous_hours', 'state', 'created_at', 'updated_at',
      // 20261228000002_pi_execution_step_scheduling.sql:94-98
      'ready_at', 'started_at', 'settled_at', 'completed_at'] },
  { table: 'execution_tasks',                    source: '20261228000001:236', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'execution_instance_id', 'plan_step_id', 'subject_kind', 'subject_id', 'channel', 'action', 'delay_after_previous_hours', 'requires_approval', 'state', 'created_at', 'updated_at'] },
  // 20261229000000_pi_outreach_bridge.sql:90 (RLS :194)
  { table: 'outreach_bridge_handoffs',           source: '20261229000000:90', revokesClientRoles: false,
    columns: ['id', 'organization_id', 'execution_task_id', 'outreach_task_id', 'campaign_id', 'workflow_id', 'workflow_version_id', 'execution_instance_id', 'execution_plan_id', 'execution_plan_step_id', 'subject_kind', 'subject_id', 'person_id', 'execution_mode', 'workflow_requires_approval', 'policy_source', 'created_at'] },
  // 20261230000000_orchestration_engine_requests.sql:40 (RLS :104, REVOKE :110)
  { table: 'execution_engine_requests',          source: '20261230000000:40', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'execution_task_id', 'engine', 'state', 'external_ref', 'detail', 'created_at', 'updated_at'] },
  // 20270120000001_pi_email_content_evidence.sql (REVOKE right after RLS)
  { table: 'email_outreach_content_evidence',    source: '20270120000001:70', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'outreach_attempt_id', 'rendered_subject', 'rendered_body', 'personalization_inputs', 'content_source', 'created_at'] },
  // 20270120000000_orchestration_journey_decisions.sql:28
  { table: 'execution_journey_decisions',        source: '20270120000000:28', revokesClientRoles: true,
    serviceRoleGrants: ['SELECT', 'INSERT'],
    columns: ['id', 'organization_id', 'execution_instance_id', 'plan_step_id', 'step_key', 'channel', 'engine', 'decision', 'outcome', 'reasons', 'decision_key', 'decided_at'] },
  // 20261231000000_orchestration_campaign_targeting.sql:164,194 (RLS :185,276; REVOKE :189,283)
  { table: 'prospect_campaign_lists',            source: '20261231000000:164', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'campaign_id', 'list_id', 'attached_by', 'attached_at'] },
  { table: 'prospect_campaign_targets',          source: '20261231000000:194', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'campaign_id', 'list_id', 'prospect_id', 'selection_event_key', 'selected_at', 'origin', 'actor_user_id', 'icp_id', 'icp_version', 'score_evaluation_id', 'created_at'] },
  // 20261231000003_community_journey_link.sql:88 (RLS :121, REVOKE :127)
  { table: 'community_action_journey_links',     source: '20261231000003:88', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'execution_task_id', 'execution_instance_id', 'community_action_id', 'linked_by', 'created_at',
      // 20261231000006_community_identity_link.sql:100-101
      'person_id', 'identity_claim_id'] },
  // 20261231000005_extension_dispatch_safety.sql:340 (RLS :352, REVOKE :358-365, GRANT :368)
  { table: 'rpa_auth_token_redemptions',         source: '20261231000005:340', revokesClientRoles: true,
    serviceRoleGrants: ['SELECT', 'INSERT', 'DELETE'],
    columns: ['nonce', 'organization_id', 'platform', 'user_id', 'token_expires_at', 'redeemed_at'] },
  // 20261231000007_identity_verification.sql:74 (RLS :238, REVOKE :243)
  { table: 'identity_verification_attestations', source: '20261231000007:74', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'person_id', 'platform', 'provider_user_id', 'identity_claim_id', 'discovered_user_id', 'method', 'basis', 'statement', 'evidence', 'attested_by', 'step_up_session_id', 'step_up_factor', 'attested_at', 'status', 'withdrawn_at', 'withdrawn_by', 'withdrawn_reason', 'confers_verification', 'created_at'] },
  // 20261231000008_engagement_request_idempotency.sql:55 (RLS :116, REVOKE :117-119, GRANT :120)
  { table: 'engagement_request_idempotency',     source: '20261231000008:55', revokesClientRoles: true,
    serviceRoleGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    columns: ['id', 'organization_id', 'actor_id', 'scope', 'idempotency_key', 'key_source', 'request_fingerprint', 'state', 'attempt', 'action_id', 'platform', 'action_type', 'target_id', 'outcome_status', 'outcome_error', 'reserved_at', 'finalized_at', 'expires_at', 'created_at', 'updated_at'] },
  // 20261231000010_rpa_legacy_session_invalidation.sql:45 (RLS :55, REVOKE :56)
  { table: 'rpa_session_invalidation_audit',     source: '20261231000010:45', revokesClientRoles: true,
    columns: ['id', 'organization_id', 'platform', 'reason', 'rows_invalidated', 'migration_version', 'invalidated_at'] },
];

/** Columns the stack ADDs to tables that pre-date it. */
const STACK_ADDED_COLUMNS = [
  // 20261231000000_orchestration_campaign_targeting.sql:62,82-85
  { table: 'prospect_lists',     column: 'icp_id',         source: '20261231000000:62' },
  { table: 'prospect_campaigns', column: 'targeting_mode', source: '20261231000000:82' },
  { table: 'prospect_campaigns', column: 'icp_id',         source: '20261231000000:83' },
  { table: 'prospect_campaigns', column: 'icp_version',    source: '20261231000000:84' },
  { table: 'prospect_campaigns', column: 'min_icp_score',  source: '20261231000000:85' },
  // 20261231000002_community_execution_safety.sql:130-131 — compare-and-set claim
  { table: 'rpa_retry_queue',    column: 'claim_token',    source: '20261231000002:130' },
  { table: 'rpa_retry_queue',    column: 'claimed_at',     source: '20261231000002:131' },
];

/** Declared types that are load-bearing (the migrations themselves assert them). */
const STACK_COLUMN_TYPES = [
  // 20261231000002:55-63 refuses to run if these exist with other types.
  { table: 'rpa_retry_queue',    column: 'claim_token',   udtName: 'text' },
  { table: 'rpa_retry_queue',    column: 'claimed_at',    udtName: 'timestamptz' },
  // 20261231000000:84-85 — compared against prospect_icp_versions / scores.
  { table: 'prospect_campaigns', column: 'icp_version',   udtName: 'int4' },
  { table: 'prospect_campaigns', column: 'min_icp_score', udtName: 'float8' },
  // 20261231000008:65 — uq_engagement_request_idempotency_action keys on it.
  { table: 'engagement_request_idempotency', column: 'action_id', udtName: 'uuid' },
];

/**
 * Stack indexes. Unique ones are idempotency / composite-FK mechanisms
 * (BLOCKING); non-unique ones are query-plan only (WARN). `predicate` lists
 * fragments the partial index's WHERE must mention.
 */
const STACK_INDEXES = [
  // 20261127000000_pi_prospect_lists.sql:142-245
  { table: 'prospect_lists', index: 'uq_prospect_lists_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'prospect_lists', index: 'idx_prospect_lists_org_status_created', unique: false, partial: false, keys: ['organization_id', 'status', 'created_at'] },
  { table: 'prospect_list_members', index: 'uq_prospect_list_members_active', unique: true, partial: true, keys: ['organization_id', 'list_id', 'prospect_id'], predicate: ["'active'"] },
  { table: 'prospect_list_members', index: 'idx_prospect_list_members_list', unique: false, partial: false, keys: ['organization_id', 'list_id', 'status', 'added_at'] },
  { table: 'prospect_list_members', index: 'idx_prospect_list_members_prospect', unique: false, partial: false, keys: ['organization_id', 'prospect_id', 'status'] },
  // 20261226000000_pi_prospect_campaigns.sql:114-118
  { table: 'prospect_campaigns', index: 'uq_prospect_campaigns_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'prospect_campaigns', index: 'idx_prospect_campaigns_org_status', unique: false, partial: false, keys: ['organization_id', 'status'] },
  // 20261227000000_pi_workflow_definitions.sql:130-226
  { table: 'workflows', index: 'uq_workflows_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'workflows', index: 'idx_workflows_org_status', unique: false, partial: false, keys: ['organization_id', 'status'] },
  { table: 'workflow_versions', index: 'uq_workflow_versions_identity', unique: true, partial: false, keys: ['organization_id', 'workflow_id', 'version'] },
  { table: 'workflow_versions', index: 'uq_workflow_versions_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'workflow_versions', index: 'uq_workflow_versions_one_published', unique: true, partial: true, keys: ['organization_id', 'workflow_id'], predicate: ["'published'"] },
  { table: 'workflow_versions', index: 'idx_workflow_versions_workflow', unique: false, partial: false, keys: ['organization_id', 'workflow_id', 'version'] },
  // 20261228000000_pi_execution_instances.sql:181-196
  { table: 'execution_instances', index: 'uq_execution_instances_active', unique: true, partial: true, keys: ['organization_id', 'campaign_id', 'workflow_id', 'subject_kind', 'subject_id'], predicate: ['lifecycle_state', "'created'", "'queued'", "'active'", "'paused'"] },
  { table: 'execution_instances', index: 'idx_execution_instances_campaign', unique: false, partial: false, keys: ['organization_id', 'campaign_id', 'created_at'] },
  { table: 'execution_instances', index: 'idx_execution_instances_subject', unique: false, partial: false, keys: ['organization_id', 'subject_kind', 'subject_id'] },
  { table: 'execution_instances', index: 'idx_execution_instances_version', unique: false, partial: false, keys: ['organization_id', 'workflow_version_id'] },
  // 20261228000001_pi_execution_plans.sql:152-293
  { table: 'execution_plans', index: 'uq_execution_plans_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'execution_plans', index: 'ix_execution_plans_org_status', unique: false, partial: false, keys: ['organization_id', 'status'] },
  { table: 'execution_plan_steps', index: 'uq_execution_plan_steps_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'execution_plan_steps', index: 'ix_execution_plan_steps_plan_order', unique: false, partial: false, keys: ['organization_id', 'plan_id', 'step_order'] },
  { table: 'execution_tasks', index: 'ix_execution_tasks_instance', unique: false, partial: false, keys: ['organization_id', 'execution_instance_id'] },
  { table: 'execution_tasks', index: 'ix_execution_tasks_subject', unique: false, partial: false, keys: ['organization_id', 'subject_kind', 'subject_id'] },
  // 20261228000002_pi_execution_step_scheduling.sql:127
  { table: 'execution_plan_steps', index: 'ix_execution_plan_steps_pending', unique: false, partial: true, keys: ['organization_id', 'plan_id', 'step_order'], predicate: ["'pending'"] },
  // 20261229000000_pi_outreach_bridge.sql:84-191
  { table: 'execution_tasks', index: 'uq_execution_tasks_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'outreach_bridge_handoffs', index: 'ix_outreach_bridge_handoffs_instance', unique: false, partial: false, keys: ['organization_id', 'execution_instance_id'] },
  { table: 'outreach_bridge_handoffs', index: 'ix_outreach_bridge_handoffs_subject', unique: false, partial: false, keys: ['organization_id', 'subject_kind', 'subject_id'] },
  // 20261230000000_orchestration_engine_requests.sql:74
  { table: 'email_outreach_content_evidence', index: 'ix_email_outreach_content_evidence_org', unique: false, partial: false, keys: ['organization_id', 'created_at'] },
  { table: 'execution_journey_decisions', index: 'ix_execution_journey_decisions_instance', unique: false, partial: false, keys: ['organization_id', 'execution_instance_id', 'decided_at'] },
  { table: 'execution_journey_decisions', index: 'ix_execution_journey_decisions_needs_human', unique: false, partial: true, keys: ['organization_id', 'decided_at'], predicate: ["'needs_human'"] },
  { table: 'execution_engine_requests', index: 'ix_execution_engine_requests_open', unique: false, partial: true, keys: ['organization_id', 'state'], predicate: ["'requested'", "'submitting'", "'submitted'"] },
  // 20261231000000_orchestration_campaign_targeting.sql:182-256
  { table: 'prospect_campaign_lists', index: 'uq_prospect_campaign_lists_identity', unique: true, partial: false, keys: ['organization_id', 'campaign_id', 'list_id'] },
  { table: 'prospect_campaign_targets', index: 'uq_prospect_campaign_targets_selection', unique: true, partial: false, keys: ['organization_id', 'campaign_id', 'list_id', 'prospect_id', 'selection_event_key'] },
  { table: 'prospect_campaign_targets', index: 'uq_prospect_campaign_targets_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'prospect_campaign_targets', index: 'ix_prospect_campaign_targets_campaign', unique: false, partial: false, keys: ['organization_id', 'campaign_id', 'selected_at'] },
  // 20261231000002_community_execution_safety.sql:152-156
  { table: 'rpa_retry_queue', index: 'idx_rpa_retry_queue_due_unclaimed', unique: false, partial: true, keys: ['organization_id', 'next_retry_at'], predicate: ['claim_token IS NULL'] },
  { table: 'rpa_retry_queue', index: 'idx_rpa_retry_queue_claimed', unique: false, partial: true, keys: ['claimed_at'], predicate: ['claim_token IS NOT NULL'] },
  // 20261231000003_community_journey_link.sql:82-118
  { table: 'community_ai_actions', index: 'uq_community_ai_actions_id_org', unique: true, partial: false, keys: ['id', 'organization_id'] },
  { table: 'community_action_journey_links', index: 'ix_community_action_journey_links_instance', unique: false, partial: false, keys: ['organization_id', 'execution_instance_id'] },
  // 20261231000005_extension_dispatch_safety.sql:349
  { table: 'rpa_auth_token_redemptions', index: 'idx_rpa_auth_token_redemptions_expires', unique: false, partial: false, keys: ['token_expires_at'] },
  // 20261231000006_community_identity_link.sql:129
  { table: 'community_action_journey_links', index: 'ix_community_action_journey_links_person', unique: false, partial: false, keys: ['organization_id', 'person_id'] },
  // 20261231000007_identity_verification.sql:141-145
  { table: 'identity_verification_attestations', index: 'uq_identity_verification_attestations_active_account', unique: true, partial: true, keys: ['organization_id', 'platform', 'provider_user_id'], predicate: ["'recorded'"] },
  { table: 'identity_verification_attestations', index: 'ix_identity_verification_attestations_person', unique: false, partial: false, keys: ['organization_id', 'person_id', 'attested_at'] },
  // 20261231000008_engagement_request_idempotency.sql:98-111
  { table: 'engagement_request_idempotency', index: 'uq_engagement_request_idempotency_key', unique: true, partial: false, keys: ['organization_id', 'actor_id', 'scope', 'idempotency_key'] },
  { table: 'engagement_request_idempotency', index: 'uq_engagement_request_idempotency_action', unique: true, partial: false, keys: ['action_id'] },
  { table: 'engagement_request_idempotency', index: 'ix_engagement_request_idempotency_expiry', unique: false, partial: true, keys: ['organization_id', 'expires_at'], predicate: ["'completed'", "'failed_not_acted'"] },
  { table: 'engagement_request_idempotency', index: 'ix_engagement_request_idempotency_reserved', unique: false, partial: true, keys: ['reserved_at'], predicate: ["'reserved'"] },
  // 20261231000010_rpa_legacy_session_invalidation.sql:58
  { table: 'rpa_session_invalidation_audit', index: 'idx_rpa_session_invalidation_audit_org', unique: false, partial: false, keys: ['organization_id', 'platform'] },
];

/** The closed channel vocabulary of publish_workflow_version (20261231000004:109-112). */
const WORKFLOW_STEP_CHANNELS = [
  'email', 'linkedin', 'phone', 'whatsapp', 'sms', 'github', 'discord', 'slack',
  'community', 'content', 'internal', 'social_post',
];

/**
 * Stack functions, matched on (name, argument types). `secdef` is the
 * SECURITY DEFINER flag the migration declares. `exec`:
 *   'service_role_only'         — anon/authenticated/PUBLIC must NOT execute,
 *                                 service_role MUST (BLOCKING both ways)
 *   'service_role_only_invoker' — same grant shape, SECURITY INVOKER: a client
 *                                 role holding EXECUTE is WARN, service_role
 *                                 lacking it is BLOCKING
 *   undefined                   — trigger function / helper: existence and
 *                                 SECURITY flag only
 * `bodyContains` / `bodyForbidden` — markers over pg_get_functiondef().
 */
const STACK_FUNCTIONS = [
  // 20261226000000_pi_prospect_campaigns.sql:125
  { name: 'prospect_campaigns_guard', args: '', secdef: false },
  // 20261227000000_pi_workflow_definitions.sql:233,259,397 (redefined 20261231000004:33)
  { name: 'workflows_guard', args: '', secdef: false },
  { name: 'workflow_versions_guard_immutable', args: '', secdef: false },
  { name: 'publish_workflow_version', args: 'uuid, uuid, uuid', secdef: false, exec: 'service_role_only_invoker',
    bodyContains: WORKFLOW_STEP_CHANNELS.map((c) => `'${c}'`) },
  // 20261228000000_pi_execution_instances.sql:208,264
  { name: 'execution_instances_guard', args: '', secdef: false },
  { name: 'create_execution_instance', args: 'uuid, uuid, uuid, text, text, uuid', secdef: false, exec: 'service_role_only_invoker' },
  // 20261228000001_pi_execution_plans.sql:304,367,404,483 (steps guard redefined 20261228000002:139)
  { name: 'execution_plans_guard', args: '', secdef: false },
  { name: 'execution_plan_steps_guard', args: '', secdef: false },
  { name: 'execution_tasks_guard', args: '', secdef: false },
  { name: 'create_execution_plan', args: 'uuid, uuid', secdef: false, exec: 'service_role_only_invoker' },
  // 20261228000002_pi_execution_step_scheduling.sql:211,273,394
  { name: 'execution_step_anchor', args: 'uuid, uuid', secdef: false, exec: 'service_role_only_invoker' },
  { name: 'advance_execution_plan', args: 'uuid, uuid', secdef: false, exec: 'service_role_only_invoker' },
  { name: 'cancel_execution_run', args: 'uuid, uuid', secdef: false, exec: 'service_role_only_invoker' },
  // 20261229000000_pi_outreach_bridge.sql:202,285
  { name: 'outreach_bridge_handoffs_guard', args: '', secdef: false },
  { name: 'bridge_execution_task', args: 'uuid, uuid, uuid, text, boolean, text, text, text, text, text', secdef: false, exec: 'service_role_only_invoker' },
  // 20261230000000_orchestration_engine_requests.sql:80
  { name: 'execution_engine_requests_guard', args: '', secdef: false },
  // 20270120000001_pi_email_content_evidence.sql
  { name: 'email_outreach_content_evidence_guard', args: '', secdef: false },
  // 20270120000000_orchestration_journey_decisions.sql:78
  { name: 'execution_journey_decisions_guard', args: '', secdef: false },
  // 20261231000000_orchestration_campaign_targeting.sql:120,264
  { name: 'prospect_campaigns_targeting_guard', args: '', secdef: false },
  { name: 'prospect_campaign_targets_guard', args: '', secdef: false },
  // 20261231000003_community_journey_link.sql:135
  { name: 'community_action_journey_links_guard', args: '', secdef: false },
  // 20261231000005_extension_dispatch_safety.sql:88,229,295 — SECURITY DEFINER;
  // privileges :398-403; the reaper's uncertain-outcome postcondition :413-420.
  { name: 'reap_community_ai_action_leases', args: '', secdef: true, exec: 'service_role_only',
    bodyContains: ["'uncertain'", "'DISPATCH_LEASE_EXPIRED'", "'DISPATCH_LEASE_EXPIRED_IN_FLIGHT'", "'EXECUTING_TIMEOUT'"],
    bodyForbidden: [{ pattern: "status\\s*=\\s*'failed'", why: "writes status = 'failed' — a possibly-delivered action would be retryable" }] },
  { name: 'claim_community_ai_browser_command', args: 'uuid, uuid, text, text, integer', secdef: true, exec: 'service_role_only' },
  { name: 'record_community_ai_late_dispatch_result', args: 'uuid, uuid, text, text, jsonb', secdef: true, exec: 'service_role_only' },
  // 20261231000006_community_identity_link.sql:142,170
  { name: 'community_identity_normalize_external_id', args: 'text', secdef: false },
  { name: 'community_action_journey_links_identity_guard', args: '', secdef: false },
  // 20261231000007_identity_verification.sql:153,254
  { name: 'identity_verification_attestations_guard', args: '', secdef: false },
  { name: 'community_action_journey_links_identity_proof_guard', args: '', secdef: false },
  // 20261231000009_migration_rerun_safety.sql:80 — converts a reaper 'failed'
  // write on a claimed row into 'uncertain', whichever reaper body is installed.
  { name: 'community_ai_actions_reap_uncertain_guard', args: '', secdef: false,
    bodyContains: ["'uncertain'", "'DISPATCH_LEASE_EXPIRED'", "'DISPATCH_LEASE_EXPIRED_IN_FLIGHT'", "'EXECUTING_TIMEOUT'"] },
];

/** Stack triggers: (table, trigger) → the function it must call, enabled. */
const STACK_TRIGGERS = [
  { table: 'prospect_lists',                     trigger: 'trg_prospect_lists_updated_at',                           fn: 'omnivyra_touch_updated_at' },                      // 20261127000000:261
  { table: 'prospect_campaigns',                 trigger: 'trg_prospect_campaigns_guard',                            fn: 'prospect_campaigns_guard' },                       // 20261226000000:142
  { table: 'workflows',                          trigger: 'trg_workflows_guard',                                     fn: 'workflows_guard' },                                // 20261227000000:254
  { table: 'workflow_versions',                  trigger: 'trg_workflow_versions_guard',                             fn: 'workflow_versions_guard_immutable' },              // 20261227000000:332
  { table: 'execution_instances',                trigger: 'trg_execution_instances_guard',                           fn: 'execution_instances_guard' },                      // 20261228000000:243
  { table: 'execution_plans',                    trigger: 'trg_execution_plans_guard',                               fn: 'execution_plans_guard' },                          // 20261228000001:363
  { table: 'execution_plan_steps',               trigger: 'trg_execution_plan_steps_guard',                          fn: 'execution_plan_steps_guard' },                     // 20261228000001:400
  { table: 'execution_tasks',                    trigger: 'trg_execution_tasks_guard',                               fn: 'execution_tasks_guard' },                          // 20261228000001:463
  { table: 'outreach_bridge_handoffs',           trigger: 'trg_outreach_bridge_handoffs_guard',                      fn: 'outreach_bridge_handoffs_guard' },                 // 20261229000000:266
  { table: 'email_outreach_content_evidence',    trigger: 'trg_email_outreach_content_evidence_guard',               fn: 'email_outreach_content_evidence_guard' },          // 20270120000001
  { table: 'execution_journey_decisions',        trigger: 'trg_execution_journey_decisions_guard',                   fn: 'execution_journey_decisions_guard' },              // 20270120000000:96
  { table: 'execution_engine_requests',          trigger: 'trg_execution_engine_requests_guard',                     fn: 'execution_engine_requests_guard' },                // 20261230000000:100
  { table: 'prospect_campaigns',                 trigger: 'trg_prospect_campaigns_targeting_guard',                  fn: 'prospect_campaigns_targeting_guard' },             // 20261231000000:157
  { table: 'prospect_campaign_targets',          trigger: 'trg_prospect_campaign_targets_guard',                     fn: 'prospect_campaign_targets_guard' },                // 20261231000000:272
  { table: 'community_action_journey_links',     trigger: 'trg_community_action_journey_links_guard',                fn: 'community_action_journey_links_guard' },           // 20261231000003:197
  { table: 'community_action_journey_links',     trigger: 'trg_community_action_journey_links_identity_guard',       fn: 'community_action_journey_links_identity_guard' },  // 20261231000006:302
  { table: 'identity_verification_attestations', trigger: 'trg_identity_verification_attestations_guard',            fn: 'identity_verification_attestations_guard' },       // 20261231000007:231
  { table: 'community_action_journey_links',     trigger: 'trg_community_action_journey_links_identity_proof_guard', fn: 'community_action_journey_links_identity_proof_guard' }, // 20261231000007:304
  { table: 'community_ai_actions',               trigger: 'trg_community_ai_actions_reap_uncertain_guard',           fn: 'community_ai_actions_reap_uncertain_guard' },      // 20261231000009:132
];

/** CHECK constraints whose vocabulary / predicate the runtime depends on. */
const STACK_CHECKS = [
  // 20261231000002_community_execution_safety.sql:70-72 — the complete 12-value
  // status vocabulary; without 'uncertain'/'executing' the reaper and the
  // extension dispatch path raise 23514.
  { table: 'community_ai_actions', constraint: 'community_ai_actions_status_check',
    contains: ['pending', 'approved', 'scheduled', 'dispatched', 'acknowledged', 'executing', 'executed', 'sent_unverified', 'failed', 'skipped', 'blocked', 'uncertain'].map((v) => `'${v}'`) },
  // 20261231000001_orchestration_engine_requests_engines.sql:29-30
  { table: 'execution_engine_requests', constraint: 'execution_engine_requests_engine_valid',
    contains: ["'whatsapp'", "'social_publish'", "'community'", "'browser'"] },
  // 20261230000000_orchestration_engine_requests.sql:57
  { table: 'execution_engine_requests', constraint: 'execution_engine_requests_state_valid',
    contains: ["'requested'", "'submitting'", "'submitted'", "'completed'", "'skipped'", "'failed'", "'uncertain'"] },
  // 20261231000000_orchestration_campaign_targeting.sql:91
  { table: 'prospect_campaigns', constraint: 'prospect_campaigns_targeting_mode_valid', contains: ["'manual'", "'icp'"] },
  // 20261231000002_community_execution_safety.sql:141-142
  { table: 'rpa_retry_queue', constraint: 'rpa_retry_queue_claim_pair', contains: ['claim_token IS NULL', 'claimed_at IS NULL'] },
  // 20261231000007_identity_verification.sql:107 — an attestation never verifies.
  { table: 'identity_verification_attestations', constraint: 'identity_verification_attestations_never_verifies', contains: ['confers_verification = false'] },
  // 20261231000008_engagement_request_idempotency.sql:79
  { table: 'engagement_request_idempotency', constraint: 'engagement_request_idempotency_state_check',
    contains: ["'reserved'", "'completed'", "'failed_not_acted'", "'uncertain'"] },
];

/** Severity by rule (see the block comment above). */
const STACK_SEVERITY = Object.freeze({
  missingObject: 'BLOCKING',
  safetyProperty: 'BLOCKING',
  queryPlanIndex: 'WARN',
  invokerClientExecute: 'WARN',
  ownerPending: 'INFO',
});

// Fold the stack columns / indexes / types into the existing manifests, so the
// existing column / index / type checks (and their output fields) cover them
// with unchanged semantics.
for (const t of STACK_TABLES) {
  for (const column of t.columns) {
    REQUIRED_COLUMNS.push({ severity: STACK_SEVERITY.missingObject, table: t.table, column,
      motivation: `ORCH-STACK (${t.source}): column of a table the orchestration-engine-adapters release creates; absent means the migration is unapplied or diverged.` });
  }
}
for (const c of STACK_ADDED_COLUMNS) {
  REQUIRED_COLUMNS.push({ severity: STACK_SEVERITY.missingObject, table: c.table, column: c.column,
    motivation: `ORCH-STACK (${c.source}): column the release ADDs to an existing table.` });
}
for (const ct of STACK_COLUMN_TYPES) {
  REQUIRED_COLUMN_TYPES.push({ severity: STACK_SEVERITY.safetyProperty, ...ct,
    motivation: 'ORCH-STACK: declared type the migration asserts; a different type fails the write path or the migration re-run.' });
}
for (const ix of STACK_INDEXES) {
  REQUIRED_INDEXES.push({
    severity: ix.unique ? STACK_SEVERITY.missingObject : STACK_SEVERITY.queryPlanIndex,
    ...ix,
    motivation: ix.unique
      ? 'ORCH-STACK: unique index that IS an idempotency / composite-FK mechanism; absent, duplicates persist silently.'
      : 'ORCH-STACK: query-plan index; absence slows a path but persists no wrong state.',
  });
}

/** Strict mode: `--strict` or SCHEMA_PARITY_STRICT=1. */
function isStrictMode(argv, env) {
  return (argv || []).includes('--strict') || (env || {}).SCHEMA_PARITY_STRICT === '1';
}

/**
 * The predeploy decision for a verifier exit code. Lives here (not in
 * predeploy-check.js) so the contract is defined beside the exit codes it
 * interprets and is unit-testable without running git/tsc.
 *
 *   strict=false (default, unchanged): 0 ok; 1 block; 2 continue (SKIPPED);
 *                3 continue (WARN); anything else continue (WARN).
 *   strict=true  (fail closed): 0 ok; EVERY non-zero code blocks — including 2
 *                (credentials missing / connection failed / a required catalog
 *                check could not run) and unrecognised codes.
 */
function predeployParityDecision(code, strict) {
  if (code === 0) return { action: 'ok', reason: 'clean' };
  if (code === 1) return { action: 'block', reason: 'blocking' };
  if (strict) {
    if (code === 2) return { action: 'block', reason: 'strict_env_unavailable' };
    if (code === 3) return { action: 'block', reason: 'strict_warn' };
    return { action: 'block', reason: 'strict_unrecognized_exit' };
  }
  if (code === 2) return { action: 'continue', reason: 'skipped_env_unavailable' };
  if (code === 3) return { action: 'continue', reason: 'warn' };
  return { action: 'continue', reason: 'unrecognized_exit' };
}

const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const CLIENT_ROLES = ['anon', 'authenticated', 'service_role'];

/**
 * Pure evaluation of the stack catalog observations → { findings, advisories }.
 * `obs` = { roles:Set, tables:Map(name→{rls, priv:{role:[privs]}}),
 *           functions:Map('name(args)'→{secdef, def, exec:{anon,authenticated,service_role,public}}),
 *           triggers:Map('table.trigger'→{enabled, fn}), checks:Map('table.constraint'→def) }
 * A role that does not exist makes its privilege checks UNRUNNABLE: that is a
 * `check_skipped` finding (WARN, BLOCKING under strict), never a pass.
 */
function evaluateStack(obs, strict) {
  const findings = [];
  const advisories = [];
  const skipSeverity = strict ? 'BLOCKING' : 'WARN';
  const push = (f) => findings.push(f);
  const missingRoles = CLIENT_ROLES.filter((r) => !obs.roles.has(r));
  for (const r of missingRoles) {
    push({ kind: 'check_skipped', severity: skipSeverity, table: null, object: `role ${r}`,
      reason: `role ${r} does not exist — its privilege checks could not run`,
      motivation: 'A privilege expectation that cannot be evaluated is not a pass.' });
  }
  const hasRole = (r) => obs.roles.has(r);

  for (const t of STACK_TABLES) {
    const o = obs.tables.get(t.table);
    if (!o) continue; // absence is reported once, by the column check
    if (o.rls !== true) {
      push({ kind: 'table_rls', severity: STACK_SEVERITY.safetyProperty, table: t.table, object: t.table,
        reason: 'row level security is DISABLED', motivation: `ORCH-STACK (${t.source}): every stack table enables RLS.` });
    }
    if (hasRole('anon') && o.priv.anon.length > 0) {
      push({ kind: 'table_privilege', severity: STACK_SEVERITY.safetyProperty, table: t.table, object: t.table,
        reason: `anon holds ${o.priv.anon.join(', ')}`, motivation: 'anon must hold no privilege on a stack table.' });
    }
    if (hasRole('authenticated') && o.priv.authenticated.length > 0) {
      if (t.revokesClientRoles) {
        push({ kind: 'table_privilege', severity: STACK_SEVERITY.safetyProperty, table: t.table, object: t.table,
          reason: `authenticated holds ${o.priv.authenticated.join(', ')} although the migration REVOKEs ALL`,
          motivation: `ORCH-STACK (${t.source}): explicit REVOKE ALL FROM anon, authenticated.` });
      } else {
        advisories.push({ kind: 'table_privilege', severity: STACK_SEVERITY.ownerPending, table: t.table,
          reason: `authenticated holds ${o.priv.authenticated.join(', ')} (RLS-only table; owner decision pending)` });
      }
    }
    if (t.serviceRoleGrants && hasRole('service_role')) {
      const lacking = t.serviceRoleGrants.filter((p) => !o.priv.service_role.includes(p));
      if (lacking.length > 0) {
        push({ kind: 'table_privilege', severity: STACK_SEVERITY.safetyProperty, table: t.table, object: t.table,
          reason: `service_role lacks ${lacking.join(', ')}`, motivation: `ORCH-STACK (${t.source}): explicit GRANT to service_role.` });
      }
    }
  }

  for (const f of STACK_FUNCTIONS) {
    const key = `${f.name}(${f.args})`;
    const o = obs.functions.get(key);
    if (!o) {
      push({ kind: 'function', severity: STACK_SEVERITY.missingObject, table: null, object: key,
        reason: 'absent', motivation: 'ORCH-STACK function the release creates.' });
      continue;
    }
    if (o.secdef !== f.secdef) {
      push({ kind: 'function', severity: STACK_SEVERITY.safetyProperty, table: null, object: key,
        reason: `SECURITY ${o.secdef ? 'DEFINER' : 'INVOKER'}, expected ${f.secdef ? 'DEFINER' : 'INVOKER'}`,
        motivation: 'The privilege context a function runs in is part of its contract.' });
    }
    for (const m of f.bodyContains || []) {
      if (!o.def.includes(m)) {
        push({ kind: 'function_body', severity: STACK_SEVERITY.safetyProperty, table: null, object: key,
          reason: `body does not contain ${m}`, motivation: 'Safety-critical body marker missing — a different body is installed.' });
      }
    }
    for (const b of f.bodyForbidden || []) {
      if (new RegExp(b.pattern).test(o.def)) {
        push({ kind: 'function_body', severity: STACK_SEVERITY.safetyProperty, table: null, object: key,
          reason: `body ${b.why}`, motivation: 'Forbidden body pattern present — the unsafe version is installed.' });
      }
    }
    if (f.exec) {
      const clientSev = f.exec === 'service_role_only' ? STACK_SEVERITY.safetyProperty : STACK_SEVERITY.invokerClientExecute;
      const holders = [];
      if (hasRole('anon') && o.exec.anon) holders.push('anon');
      if (hasRole('authenticated') && o.exec.authenticated) holders.push('authenticated');
      if (o.exec.public) holders.push('PUBLIC');
      if (holders.length > 0) {
        push({ kind: 'function_privilege', severity: clientSev, table: null, object: key,
          reason: `EXECUTE held by ${holders.join(', ')}`, motivation: 'Migration restricts EXECUTE to service_role.' });
      }
      if (hasRole('service_role') && !o.exec.service_role) {
        push({ kind: 'function_privilege', severity: STACK_SEVERITY.safetyProperty, table: null, object: key,
          reason: 'service_role cannot EXECUTE', motivation: 'The worker calls this as service_role.' });
      }
    }
  }

  for (const tr of STACK_TRIGGERS) {
    const o = obs.triggers.get(`${tr.table}.${tr.trigger}`);
    let reason = null;
    if (!o) reason = 'absent';
    else if (o.enabled === 'D') reason = 'DISABLED';
    else if (o.fn !== tr.fn) reason = `calls ${o.fn}, expected ${tr.fn}`;
    if (reason) {
      push({ kind: 'trigger', severity: o ? STACK_SEVERITY.safetyProperty : STACK_SEVERITY.missingObject,
        table: tr.table, object: tr.trigger, reason, motivation: 'ORCH-STACK guard trigger.' });
    }
  }

  for (const c of STACK_CHECKS) {
    const def = obs.checks.get(`${c.table}.${c.constraint}`);
    if (def == null) {
      push({ kind: 'check_constraint', severity: STACK_SEVERITY.missingObject, table: c.table, object: c.constraint,
        reason: 'absent', motivation: 'ORCH-STACK CHECK constraint.' });
      continue;
    }
    const lacking = c.contains.filter((v) => !def.includes(v));
    if (lacking.length > 0) {
      push({ kind: 'check_constraint', severity: STACK_SEVERITY.safetyProperty, table: c.table, object: c.constraint,
        reason: `definition lacks ${lacking.join(', ')}`, motivation: 'A narrowed vocabulary raises 23514 on a runtime write.' });
    }
  }
  return { findings, advisories };
}

/** Runs the stack catalog queries. Any thrown query propagates (caller exits 2). */
async function observeStack(db) {
  const roles = new Set((await db.query(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)', [CLIENT_ROLES])).rows.map((r) => r.rolname));
  const roleList = CLIENT_ROLES.filter((r) => roles.has(r));

  const tables = new Map();
  const tRes = await db.query(
    `SELECT c.relname, c.relrowsecurity, r.rolname, p.priv,
            has_table_privilege(r.rolname, c.oid, p.priv) AS granted
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN unnest($2::text[]) AS r(rolname)
      CROSS JOIN unnest($3::text[]) AS p(priv)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1)`,
    [STACK_TABLES.map((t) => t.table), roleList, TABLE_PRIVILEGES]);
  // A table with zero existing roles still needs its RLS flag.
  const rlsRes = await db.query(
    `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1)`,
    [STACK_TABLES.map((t) => t.table)]);
  for (const row of rlsRes.rows) {
    tables.set(row.relname, { rls: row.relrowsecurity === true, priv: { anon: [], authenticated: [], service_role: [] } });
  }
  for (const row of tRes.rows) {
    if (row.granted === true) tables.get(row.relname).priv[row.rolname].push(row.priv);
  }

  const functions = new Map();
  const fRes = await db.query(
    `SELECT p.proname, oidvectortypes(p.proargtypes) AS args, p.prosecdef,
            pg_get_functiondef(p.oid) AS def,
            CASE WHEN 'anon' = ANY($2) THEN has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon,
            CASE WHEN 'authenticated' = ANY($2) THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated,
            CASE WHEN 'service_role' = ANY($2) THEN has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_role,
            EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1)`,
    [[...new Set(STACK_FUNCTIONS.map((f) => f.name))], roleList]);
  for (const row of fRes.rows) {
    functions.set(`${row.proname}(${row.args})`, {
      secdef: row.prosecdef === true,
      def: row.def || '',
      exec: { anon: row.anon === true, authenticated: row.authenticated === true,
        service_role: row.service_role === true, public: row.public_exec === true },
    });
  }

  const triggers = new Map();
  const gRes = await db.query(
    `SELECT c.relname, t.tgname, t.tgenabled, p.proname
       FROM pg_trigger t
       JOIN pg_class c     ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p      ON p.oid = t.tgfoid
      WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname = ANY($1)`,
    [STACK_TRIGGERS.map((t) => t.trigger)]);
  for (const row of gRes.rows) {
    triggers.set(`${row.relname}.${row.tgname}`, { enabled: row.tgenabled, fn: row.proname });
  }

  const checks = new Map();
  const cRes = await db.query(
    `SELECT c.relname, k.conname, pg_get_constraintdef(k.oid) AS def
       FROM pg_constraint k
       JOIN pg_class c     ON c.oid = k.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND k.contype = 'c' AND k.conname = ANY($1)`,
    [STACK_CHECKS.map((c) => c.constraint)]);
  for (const row of cRes.rows) checks.set(`${row.relname}.${row.conname}`, row.def || '');

  return { roles, tables, functions, triggers, checks };
}

// URL sources, highest precedence first. SCHEMA_PARITY_DB_URL is the explicit
// release-gate credential: when it is set, .env.local is never read, so a stale
// or privileged URL in that file can never silently replace the operator's
// read-only credential.
const DB_URL_VARS = ['SCHEMA_PARITY_DB_URL', 'SUPABASE_POOLER_DB_URL', 'SUPABASE_DB_URL', 'DATABASE_URL'];

function resolveDbUrl(env) {
  for (const name of DB_URL_VARS) if (env[name]) return { name, url: env[name] };
  return { name: null, url: null };
}

async function main() {
  const strict = isStrictMode(process.argv.slice(2), process.env);
  if (!process.env.SCHEMA_PARITY_DB_URL) {
    const before = new Set(DB_URL_VARS.filter((k) => process.env[k]));
    loadEnvLocal();
    const chosen = resolveDbUrl(process.env).name;
    if (chosen && !before.has(chosen)) {
      // Name only — never the value.
      process.stderr.write(JSON.stringify({
        event: 'schema_parity.warning',
        reason: 'db_url_from_env_local',
        variable: chosen,
        hint: 'The connection string came from .env.local, not the shell. Set SCHEMA_PARITY_DB_URL to use an explicit credential.',
      }) + '\n');
    }
  }

  // ─── WHY THIS DOES NOT GO THROUGH PostgREST ──────────────────────────────
  // It used to. `client.from('information_schema.columns')` resolves as the
  // TABLE `public."information_schema.columns"`, which does not exist, so
  // PostgREST answered "Could not find the table 'public.information_schema.
  // columns' in the schema cache" for the FIRST table and the verifier exited
  // 2 every single time. `predeploy-check.js` maps exit 2 to
  // "schema parity: SKIPPED (env unavailable)" and continues — so this gate
  // reported an environmental excuse on every run and never once compared a
  // column. The credentials were present the whole time; the query mechanism
  // was wrong.
  //
  // `information_schema` is reachable over a direct Postgres connection, which
  // is what every other schema probe in this repository already uses. Exit 2
  // is now reserved for a genuinely absent connection string or a real
  // connection failure — never for a lookup this script chose incorrectly.
  const { name: dbUrlVar, url: dbUrl } = resolveDbUrl(process.env);
  if (!dbUrl) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'missing_credentials',
      missing: ['SCHEMA_PARITY_DB_URL', 'SUPABASE_POOLER_DB_URL'],
      hint: 'A direct Postgres connection string is required; information_schema is not reachable over PostgREST.',
    }) + '\n');
    process.exit(2);
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch (e) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'missing_pg',
      hint: 'Run from project root after `npm install`.',
    }) + '\n');
    process.exit(2);
  }

  // The explicit gate credential should authenticate the server. Without
  // sslmode=verify-full the default below encrypts but does not verify, so say
  // so (variable name only). Not fatal: disposable runs use sslmode=disable.
  if (dbUrlVar === 'SCHEMA_PARITY_DB_URL' && !/[?&]sslmode=verify-full(&|$)/.test(dbUrl)) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.warning',
      reason: 'tls_not_verified',
      variable: dbUrlVar,
      hint: 'Add sslmode=verify-full&sslrootcert=<CA file> to authenticate the server.',
    }) + '\n');
  }

  // Constructed inside the try: a malformed URL is a connection failure, not an
  // unhandled crash.
  let db;
  try {
    db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await db.connect();
  } catch (e) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'connection_failed',
      message: (e && e.message) || String(e),
    }) + '\n');
    process.exit(2);
  }

  // Every query below is a read. Pin the session read-only with timeouts so a
  // privileged credential still cannot write through this script, and record
  // which role actually ran it (name only).
  let session;
  try {
    await db.query("SET default_transaction_read_only = on; SET statement_timeout = '120s'; "
      + "SET lock_timeout = '2s'; SET application_name = 'schema-parity-verifier'");
    const res = await db.query(
      "SELECT current_user AS role, current_setting('transaction_read_only') AS tx_read_only");
    session = { role: res.rows[0].role, tx_read_only: res.rows[0].tx_read_only };
  } catch (e) {
    await db.end().catch(() => {});
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'session_setup_failed',
      message: (e && e.message) || String(e),
    }) + '\n');
    process.exit(2);
  }
  // Recording read-only is not enough: refuse to continue if it did not take
  // effect (e.g. a transaction-mode pooler that does not keep session SETs).
  if (session.tx_read_only !== 'on') {
    await db.end().catch(() => {});
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'session_not_read_only',
      role: session.role,
      tx_read_only: session.tx_read_only,
      hint: 'Use a direct or session-mode connection (not a transaction-mode pooler).',
    }) + '\n');
    process.exit(2);
  }

  // Build the set of unique tables we need to introspect.
  const tables = [...new Set(REQUIRED_COLUMNS.map((r) => r.table))];

  // One query for every table at once. A THROWN query is an environmental
  // failure and exits 2; it must never be caught and read as "this table has
  // no columns", which would turn an outage into a fabricated parity failure.
  //
  // The projection now also carries the declared type, so GAP-C costs no extra
  // round trip and no second pass: `data_type` for the human-readable form and
  // `udt_name` for the comparison (they agree for text/uuid, and udt_name is
  // the one that stays precise for varchar/array types).
  const observed = new Map();
  try {
    const res = await db.query(
      `SELECT table_name, column_name, data_type, udt_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [tables],
    );
    // Map rather than Set: `.has(column)` still answers existence exactly as
    // before, and `.get(column)` now also answers "declared as what".
    for (const t of tables) observed.set(t, new Map());
    for (const row of res.rows) {
      observed.get(row.table_name).set(row.column_name, {
        dataType: row.data_type,
        udtName: row.udt_name,
      });
    }
  } catch (e) {
    await db.end().catch(() => {});
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'information_schema_query_failed',
      message: (e && e.message) || String(e),
    }) + '\n');
    process.exit(2);
  }

  // GAP-B. `information_schema` has no index view, so this reads the catalog
  // directly — same connection, one more statement, no second pass. It carries
  // uniqueness and partiality because index EXISTENCE alone does not imply the
  // 23505 the writers depend on. Failure semantics match the column query
  // exactly: a thrown query is environmental and exits 2, and is never read as
  // "no indexes exist", which would fabricate three BLOCKING findings during an
  // outage.
  const observedIndexes = new Map();
  try {
    const res = await db.query(
      `SELECT c.relname AS table_name,
              i.relname AS index_name,
              x.indisunique AS is_unique,
              (x.indpred IS NOT NULL) AS is_partial,
              pg_get_indexdef(x.indexrelid) AS definition
         FROM pg_index x
         JOIN pg_class c     ON c.oid = x.indrelid
         JOIN pg_class i     ON i.oid = x.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND i.relname = ANY($1)`,
      [REQUIRED_INDEXES.map((r) => r.index)],
    );
    for (const row of res.rows) {
      observedIndexes.set(row.index_name, {
        table: row.table_name,
        isUnique: row.is_unique === true,
        isPartial: row.is_partial === true,
        definition: row.definition || '',
      });
    }
  } catch (e) {
    await db.end().catch(() => {});
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'index_introspection_query_failed',
      message: (e && e.message) || String(e),
    }) + '\n');
    process.exit(2);
  }

  // ORCH-STACK catalog observation (RLS, privileges, functions, triggers,
  // CHECKs). Same failure semantics as the queries above: a thrown query —
  // permission denied on a catalog function included — is environmental and
  // exits 2. It is never read as "nothing there", which would fabricate
  // findings, and never swallowed, which would be a silent pass.
  let stackObserved;
  try {
    stackObserved = await observeStack(db);
  } catch (e) {
    await db.end().catch(() => {});
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'stack_catalog_query_failed',
      strict,
      message: (e && e.message) || String(e),
    }) + '\n');
    process.exit(2);
  }

  // ONE findings list, still called `missing`, deliberately. The exit-0
  // condition below is `missing.length === 0 && !ledgerDesyncDetected` and it
  // must remain the single place that decides success — a structural finding
  // that lived in its own array would need its own reachable exit, and the one
  // guarantee this gate sells is that exit 0 has exactly one cause. `kind`
  // distinguishes the finding types in the output and in the operator summary.
  const missing = [];

  for (const req of REQUIRED_COLUMNS) {
    const cols = observed.get(req.table);
    if (!cols || !cols.has(req.column)) {
      missing.push({
        kind: 'column',
        severity: req.severity,
        table: req.table,
        column: req.column,
        reason: 'absent',
        motivation: req.motivation,
      });
    }
  }

  for (const req of REQUIRED_INDEXES) {
    const found = observedIndexes.get(req.index);
    let reason = null;
    if (!found) {
      reason = req.unique
        ? 'absent — the INSERT never conflicts, so the 23505 idempotency branch is unreachable'
        : 'absent — query-plan index (no persisted-state impact)';
    } else if (found.table !== req.table) {
      reason = `attached to ${found.table}, expected ${req.table}`;
    } else if (req.unique && !found.isUnique) {
      reason = 'exists but is NOT UNIQUE — it can never raise 23505';
    } else if (found.isPartial !== req.partial) {
      reason = found.isPartial
        ? 'exists but is PARTIAL — rows outside its predicate collide with nothing'
        : 'exists but is NOT PARTIAL — the predicate this key depends on is absent';
    } else {
      // Substring presence in pg_get_indexdef(), not a parsed key-list
      // comparison. It catches a same-named index built over different columns;
      // it does not catch a different column ORDER.
      const unmentioned = req.keys.filter((k) => !found.definition.includes(k));
      if (unmentioned.length > 0) {
        reason = `definition does not mention ${unmentioned.join(', ')} — same name, different key`;
      } else if (req.predicate) {
        // ORCH-STACK partial indexes: the WHERE must still name the rows it
        // covers (substring test over pg_get_indexdef, like the keys).
        const where = found.definition.split(' WHERE ')[1] || '';
        const absentPred = req.predicate.filter((p) => !where.includes(p));
        if (absentPred.length > 0) {
          reason = `predicate does not mention ${absentPred.join(', ')} — same name, different partial scope`;
        }
      }
    }
    if (reason) {
      missing.push({
        kind: 'index',
        severity: req.severity,
        table: req.table,
        index: req.index,
        reason,
        motivation: req.motivation,
      });
    }
  }

  // A (table, column) already required above. Used so an absent column is
  // reported ONCE, by the column check, rather than counted twice.
  const columnRequirementKeys = new Set(REQUIRED_COLUMNS.map((r) => `${r.table}.${r.column}`));

  for (const req of REQUIRED_COLUMN_TYPES) {
    const cols = observed.get(req.table);
    const meta = cols ? cols.get(req.column) : undefined;
    if (!meta) {
      if (!columnRequirementKeys.has(`${req.table}.${req.column}`)) {
        missing.push({
          kind: 'column_type',
          severity: req.severity,
          table: req.table,
          column: req.column,
          reason: `absent — expected type ${req.udtName}`,
          expected: req.udtName,
          observed: null,
          motivation: req.motivation,
        });
      }
      continue;
    }
    if (meta.udtName !== req.udtName) {
      missing.push({
        kind: 'column_type',
        severity: req.severity,
        table: req.table,
        column: req.column,
        reason: `declared ${meta.dataType} (${meta.udtName}), expected ${req.udtName}`,
        expected: req.udtName,
        observed: meta.udtName,
        motivation: req.motivation,
      });
    }
  }

  // ORCH-STACK safety properties. Findings join the ONE list; INFO
  // (owner-pending) observations go to `advisories`, which never decide the
  // exit code in any mode.
  const stackEval = evaluateStack(stackObserved, strict);
  for (const f of stackEval.findings) missing.push(f);
  const advisories = stackEval.advisories;

  /** What a clean run reports — every dimension this gate actually checked. */
  const okSummary = `SCHEMA PARITY OK — ${REQUIRED_COLUMNS.length} required columns present, `
    + `${REQUIRED_INDEXES.length} structural indexes intact, `
    + `${REQUIRED_COLUMN_TYPES.length} declared column types as expected; `
    + `stack: ${STACK_TABLES.length} tables RLS/privileges, ${STACK_FUNCTIONS.length} functions, `
    + `${STACK_TRIGGERS.length} triggers, ${STACK_CHECKS.length} CHECK constraints as expected`
    + `${strict ? ' (strict)' : ''}.`;

  /** One line naming a finding, whatever kind it is. */
  const describeFinding = (m) => (
    m.kind === 'index' ? `index ${m.index} on ${m.table} — ${m.reason}`
    : m.kind === 'column_type' ? `${m.table}.${m.column} — ${m.reason}`
    : m.kind === 'column' ? `${m.table}.${m.column}`
    : `${m.kind} ${m.object}${m.table && m.table !== m.object ? ` on ${m.table}` : ''} — ${m.reason}`
  );

  // Severity-bucketed status over the ONE findings list — a missing column, a
  // broken index and a wrong declared type bucket identically, by severity.
  // Verifier exit code:
  //   0 — INFO (all clean)
  //   1 — BLOCKING (one or more BLOCKING-severity findings)
  //   3 — WARN    (only WARN/INFO findings — operator should
  //               apply soon but deploy can proceed; non-zero so CI
  //               can flag but distinct from BLOCKING)

  // Ledger probe — by VERSION identity (scripts/lib/migrationLedger.js), never by
  // comparing row and file counts. Migrations are applied by hand and recording
  // them is optional (docs/migration-discipline.md), and 443 files share 329
  // versions, so the old `rows < 50% of files` ratio always fired and could never
  // be satisfied. A missing row means UNRECORDED, not unapplied: the column /
  // index / type checks above remain the evidence of what is live.
  //
  // `ledgerDesyncDetected` keeps its name (the single exit-0 condition reads it)
  // and now means "the ledger is not demonstrably clean":
  //   - an ORPHAN row — a recorded version with no local file — is history the
  //     repository does not have: genuine drift;
  //   - a ledger that could not be READ is unverified, and an unverified ledger
  //     is never reported as clean. (Before, a failed probe left this false, so
  //     the verifier could exit 0 having never read the ledger.)
  let ledgerDesyncDetected = false;
  let ledgerProbeNote = null;
  try {
    // statements_md5 is the fingerprint HISTORICAL_VERSION_MAP pins; never the text.
    const ledgerRes = await db.query(
      "SELECT version, name, md5(array_to_string(statements, E'\\n')) AS statements_md5 FROM supabase_migrations.schema_migrations ORDER BY version");

    // Only top-level `.sql` files are candidates — `rollbacks/` and `_`-prefixed
    // directories are never applied.
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      ledgerDesyncDetected = true;
      ledgerProbeNote = { verified: false, reason: 'no local supabase/migrations directory to compare against', ledger_rows: ledgerRes.rows.length };
    } else {
      const files = fs.readdirSync(migrationsDir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.sql'))
        .map((d) => d.name);
      // Hash only the files the historical version map pins.
      const fileDigests = {};
      for (const { file } of HISTORICAL_VERSION_MAP) {
        const p = path.join(migrationsDir, file);
        if (fs.existsSync(p)) fileDigests[file] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      }
      const c = classifyLedger({ files, ledgerRows: ledgerRes.rows, fileDigests });
      ledgerDesyncDetected = c.attention;
      const cap = (list) => list.slice(0, 50);
      ledgerProbeNote = {
        verified: true,
        local_files: c.local_files,
        local_versions: c.local_versions,
        duplicate_version_groups: c.duplicate_version_groups,
        ledger_rows: c.ledger_rows,
        recorded_identified: c.recorded_identified.length,
        recorded_ambiguous: c.recorded_ambiguous,
        recorded_by_version_map: c.recorded_by_version_map,
        version_map_violations: c.version_map_violations,
        orphans: c.orphans,
        name_mismatches: c.name_mismatches,
        unrecorded_unique: c.unrecorded_unique.length,
        unrecorded_ambiguous_groups: c.unrecorded_ambiguous.length,
        recorded_high_water: c.recorded_high_water,
        unrecorded_newer_than_high_water: cap(c.unrecorded_newer_than_high_water),
        invalid_filenames: c.invalid_filenames.length,
      };
    }
  } catch (e) {
    // Never converted into a column verdict — but never into "clean" either.
    ledgerDesyncDetected = true;
    ledgerProbeNote = { verified: false, reason: (e && e.message) || String(e) };
  }

  // STRICT: "could not check" is never success. A ledger probe that did not
  // run (e.g. no SELECT on supabase_migrations.schema_migrations) is a
  // BLOCKING `check_skipped` finding under --strict; outside strict it stays
  // advisory exactly as before.
  if (strict && ledgerProbeNote && ledgerProbeNote.verified === false) {
    missing.push({
      kind: 'check_skipped',
      severity: 'BLOCKING',
      table: null,
      object: 'ledger probe',
      reason: `migration ledger probe did not run: ${ledgerProbeNote.reason}`,
      motivation: 'STRICT: a required check that could not run is a failure.',
    });
  }

  const missingBlocking = missing.filter((m) => m.severity === 'BLOCKING');
  const missingWarn     = missing.filter((m) => m.severity === 'WARN');
  const missingInfo     = missing.filter((m) => m.severity === 'INFO');
  const overall =
    missingBlocking.length > 0 ? 'BLOCKING'
    : missingWarn.length > 0    ? 'WARN'
    :                             'INFO';

  await db.end().catch(() => {});

  const out = {
    event: 'schema_parity.check',
    ran_at: new Date().toISOString(),
    checked_columns: REQUIRED_COLUMNS.length,
    checked_indexes: REQUIRED_INDEXES.length,
    checked_column_types: REQUIRED_COLUMN_TYPES.length,
    strict,
    session,
    checked_stack: {
      tables: STACK_TABLES.length,
      functions: STACK_FUNCTIONS.length,
      triggers: STACK_TRIGGERS.length,
      check_constraints: STACK_CHECKS.length,
    },
    // TOTAL findings, not only absent columns — a structural finding counts
    // here too. `missing_columns` below keeps its original meaning and shape.
    missing_count: missing.length,
    // 'ok' means exactly the exit-0 condition. It used to be 'ok' whenever the worst
    // finding was INFO, so a run with INFO findings (exit 3) published 'ok'. INFO-only
    // findings are non-blocking and not WARN, so they report as 'INFO' — never 'ok'.
    status: missing.length === 0 && !ledgerDesyncDetected ? 'ok'
      : overall === 'BLOCKING' ? 'BLOCKING'
      : (overall === 'WARN' || ledgerDesyncDetected) ? 'WARN'
      : 'INFO',
    severity: {
      blocking: missingBlocking.length,
      warn: missingWarn.length,
      info: missingInfo.length,
    },
    ledger_desync_detected: ledgerDesyncDetected,
    ledger_probe: ledgerProbeNote,
    missing_columns: missing.filter((m) => m.kind === 'column').map((m) => ({
      severity: m.severity,
      table: m.table,
      column: m.column,
      motivation: m.motivation,
    })),
    // GAP-B / GAP-C. Emitted separately so an existing log parser keyed on
    // `missing_columns` keeps reading exactly what it always read.
    structural_findings: missing.filter((m) => m.kind !== 'column').map((m) => ({
      kind: m.kind,
      severity: m.severity,
      table: m.table,
      index: m.index ?? null,
      column: m.column ?? null,
      object: m.object ?? null,
      reason: m.reason,
      motivation: m.motivation,
    })),
    // ORCH-STACK owner-pending observations (INFO). Never part of the verdict.
    advisories,
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
    // Field names kept for the dashboards already reading them. They now count
    // every finding at that severity, structural ones included; the split is in
    // `structural_findings` beside them.
    blocking_missing_columns: missingBlocking.length,
    warn_missing_columns: missingWarn.length,
    structural_findings_count: out.structural_findings.length,
    runtime_env: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
  };
  process.stdout.write(JSON.stringify(integritySnapshot) + '\n');

  // stderr: human-readable summary + operator guidance.
  // The success banner is built above, not inline: the ONE reachable exit 0
  // must stay a short, readable two lines so that what makes this gate pass is
  // impossible to misread (and so the contract test can pin it).
  if (missing.length === 0 && !ledgerDesyncDetected) {
    process.stdout.write(`\n${okSummary}\n`);
    process.exit(0);
  }

  if (missingBlocking.length > 0) {
    process.stderr.write('\n[BLOCKING] SCHEMA PARITY FAILURE — runtime writes will fail or silently persist wrong state:\n');
    for (const m of missingBlocking) {
      process.stderr.write(`  - ${describeFinding(m)}\n    ${m.motivation}\n`);
    }
  }
  if (missingWarn.length > 0) {
    process.stderr.write('\n[WARN] Non-critical schema gaps — apply soon:\n');
    for (const m of missingWarn) {
      process.stderr.write(`  - ${describeFinding(m)}\n    ${m.motivation}\n`);
    }
  }
  if (ledgerDesyncDetected) {
    const why = ledgerProbeNote && ledgerProbeNote.verified === false
      ? `the ledger could not be verified (${ledgerProbeNote.reason})`
      : `${(ledgerProbeNote && ledgerProbeNote.orphans ? ledgerProbeNote.orphans.length : 0)} recorded version(s) have no local migration file, ` +
        `${(ledgerProbeNote && ledgerProbeNote.version_map_violations ? ledgerProbeNote.version_map_violations.length : 0)} historical version-map exception(s) failed their evidence check`;
    process.stderr.write(
      '\n[WARN] UNSAFE_MIGRATION_LEDGER_STATE — ' + why + '.\n' +
      '       Probe data: ' + JSON.stringify(ledgerProbeNote) + '\n' +
      '       An unrecorded migration is NOT necessarily unapplied (recording is optional;\n' +
      '       the column / index / type checks above are the schema evidence).\n' +
      '       *** DO NOT RUN `supabase db push` ***\n' +
      '       Duplicate-version prefixes + already-applied DDL will cause partial / non-deterministic\n' +
      '       application. The npm run db:push wrapper now hard-blocks this state — see\n' +
      '       docs/migration-discipline.md for the manual SQL editor protocol.\n'
    );
  }

  process.stderr.write(
    '\nRemediation:\n' +
    '  0. An index or type finding is NOT fixed by adding a column: re-apply the\n' +
    '     migration that creates it (LI-2 20261002000000, LI-3B 20261003000000,\n' +
    '     A7P-C9 20261022000000). All three are idempotent and safe to replay.\n' +
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

// Runs only when executed; `require()` (the coverage/strict tests, and
// predeploy-check's decision table) gets the manifests without a connection.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'unhandled',
      message: err && err.message ? err.message : String(err),
    }) + '\n');
    process.exit(2);
  });
}

module.exports = {
  REQUIRED_COLUMNS,
  REQUIRED_INDEXES,
  REQUIRED_COLUMN_TYPES,
  STACK_MIGRATIONS,
  STACK_TABLES,
  STACK_ADDED_COLUMNS,
  STACK_COLUMN_TYPES,
  STACK_INDEXES,
  STACK_FUNCTIONS,
  STACK_TRIGGERS,
  STACK_CHECKS,
  STACK_SEVERITY,
  isStrictMode,
  predeployParityDecision,
  evaluateStack,
  DB_URL_VARS,
  resolveDbUrl,
};
