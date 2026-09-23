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
 * Usage:
 *   node scripts/verify-schema-parity.js
 *
 * Requires:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (.env.local loaded if
 *   process.env doesn't already have them).
 *
 * Exit codes:
 *   0 — all required columns present, all required indexes structurally sound,
 *       all declared column types as expected, and no ledger desync
 *   1 — at least one BLOCKING finding (structured stdout below)
 *   2 — environmental failure (missing creds, network error)
 *   3 — WARN/INFO findings only
 *
 *   A BLOCKING index finding and a BLOCKING type finding are the SAME class of
 *   outcome as a BLOCKING missing column: they join the one findings list and
 *   exit 1. Exit 0 remains reachable on exactly one condition — an empty
 *   findings list and no ledger desync.
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

async function main() {
  loadEnvLocal();

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
  const dbUrl = process.env.SUPABASE_POOLER_DB_URL
    || process.env.SUPABASE_DB_URL
    || process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'missing_credentials',
      missing: ['SUPABASE_POOLER_DB_URL'],
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

  const db = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await db.connect();
  } catch (e) {
    process.stderr.write(JSON.stringify({
      event: 'schema_parity.error',
      reason: 'connection_failed',
      message: (e && e.message) || String(e),
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
      reason = 'absent — the INSERT never conflicts, so the 23505 idempotency branch is unreachable';
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

  /** What a clean run reports — every dimension this gate actually checked. */
  const okSummary = `SCHEMA PARITY OK — ${REQUIRED_COLUMNS.length} required columns present, `
    + `${REQUIRED_INDEXES.length} structural indexes intact, `
    + `${REQUIRED_COLUMN_TYPES.length} declared column types as expected.`;

  /** One line naming a finding, whatever kind it is. */
  const describeFinding = (m) => (
    m.kind === 'index' ? `index ${m.index} on ${m.table} — ${m.reason}`
    : m.kind === 'column_type' ? `${m.table}.${m.column} — ${m.reason}`
    : `${m.table}.${m.column}`
  );

  // Severity-bucketed status over the ONE findings list — a missing column, a
  // broken index and a wrong declared type bucket identically, by severity.
  // Verifier exit code:
  //   0 — INFO (all clean)
  //   1 — BLOCKING (one or more BLOCKING-severity findings)
  //   3 — WARN    (only WARN/INFO findings — operator should
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
    // A REAL count. The previous probe selected with `head: true`, which
    // returns no rows, then derived the count from `data.length` — so it read
    // zero every time and reported desync unconditionally whenever more than
    // 20 local files existed. A gate that always fires carries no signal.
    const ledgerRes = await db.query(
      'SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations');
    const ledgerCount = ledgerRes.rows[0].n;

    // Migration file count is best-effort: read the local directory. Only
    // top-level `.sql` files are candidates — `rollbacks/` and `_`-prefixed
    // directories are never applied, so counting them would overstate drift.
    const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
    let localCount = null;
    if (fs.existsSync(migrationsDir)) {
      localCount = fs.readdirSync(migrationsDir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.sql')).length;
    }

    if (localCount != null) {
      ledgerProbeNote = { ledger_recorded: ledgerCount, local_files: localCount };
      if (localCount > 20 && ledgerCount < localCount * 0.5) {
        ledgerDesyncDetected = true;
      }
    } else {
      ledgerProbeNote = { ledger_recorded: ledgerCount, local_files: null, skipped: 'no local migrations dir' };
    }
  } catch (e) {
    // The ledger probe is advisory; the column check above is authoritative.
    // A probe failure is recorded, never converted into a parity verdict.
    ledgerProbeNote = { skipped: true, reason: (e && e.message) || String(e) };
  }

  await db.end().catch(() => {});

  const out = {
    event: 'schema_parity.check',
    ran_at: new Date().toISOString(),
    checked_columns: REQUIRED_COLUMNS.length,
    checked_indexes: REQUIRED_INDEXES.length,
    checked_column_types: REQUIRED_COLUMN_TYPES.length,
    // TOTAL findings, not only absent columns — a structural finding counts
    // here too. `missing_columns` below keeps its original meaning and shape.
    missing_count: missing.length,
    status: overall === 'INFO' && !ledgerDesyncDetected ? 'ok' : (overall === 'BLOCKING' ? 'BLOCKING' : 'WARN'),
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
      reason: m.reason,
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

main().catch((err) => {
  process.stderr.write(JSON.stringify({
    event: 'schema_parity.error',
    reason: 'unhandled',
    message: err && err.message ? err.message : String(err),
  }) + '\n');
  process.exit(2);
});
