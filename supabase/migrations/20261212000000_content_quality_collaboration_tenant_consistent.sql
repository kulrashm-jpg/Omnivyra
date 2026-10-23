-- ============================================================================
-- Fix 3 — Content Quality & Collaboration, tenant-consistent.
--
-- WHAT THIS ADDS
--   The four Wave-4 editorial tables, with TENANT-CONSISTENT composite foreign
--   keys and retained approval history:
--     public.content_quality            — deterministic quality scorecards
--     public.content_block              — section-level editable blocks + locks
--     public.content_recommendation     — explainable, reversible recommendations
--     public.content_approval_history   — approval-workflow audit trail
--   plus the composite unique keys those foreign keys require, the shared
--   updated_at trigger, company-scoped RLS, and four policies.
--
-- WHY (which code paths write/read it)
--   content_quality        — qualityService.persistScorecard
--   content_block          — collaborationService.upsertBlocks / listBlocks
--   content_recommendation — collaborationService.saveRecommendations
--   content_approval_history
--                          — approvalService.recordHistory (write) and
--                            approvalService.getApprovalHistory +
--                            getCompanyApprovalHistory (read), surfaced by
--                            pages/api/content/[id]/approval.ts and
--                            pages/api/content/approval-history.ts
--
-- WHAT FAILS IF ABSENT
--   Every one of those writes fails: the tables do not exist, so each INSERT is
--   rejected and the editorial surface (scorecards, block locking, explainable
--   recommendations, approval audit trail) is inert.
--
-- PROVENANCE — THIS DOES NOT SUPERSEDE AN ARCHIVED MIGRATION
--   It completes the work of 20260718000002_content_quality_collaboration.sql,
--   which is FROZEN in scripts/migrations/historical-baseline.txt and is
--   deliberately left unchanged. This file carries a later version because the
--   quality gate's ordering rule requires every new migration to sort after
--   scripts/migrations/ordering-baseline.txt (highest entry 20261026000000).
--   The version therefore does NOT indicate a later design than Wave 4.
--
--   Differences from the frozen file, all owner-approved:
--     DECISION B — four single-column foreign keys become COMPOSITE
--       tenant-consistent foreign keys, so a child row can never REFERENCE
--       content or a block owned by another company. This holds even for the
--       service role, which bypasses RLS. READ THAT PRECISELY: it is a
--       REFERENTIAL guarantee. It does NOT prevent an UPDATE from re-tenanting
--       an existing child row — see "KNOWN LIMITS" below.
--     DECISION C — content_approval_history.content_id is NULLABLE with
--       ON DELETE SET NULL (content_id), so an approval audit row survives the
--       deletion of its content with only that column nulled. The frozen
--       predecessor shipped that FK as ON DELETE CASCADE, so applying this file
--       to a database carrying the predecessor REPLACES a cascade with a
--       set-null. STEP 4 treats that single transition as explicitly authorized
--       and verifies every other property of the legacy constraint first.
--       READ THE SCOPE OF THAT TOO: a foreign-key census is evidence about
--       FOREIGN-KEY delete semantics and nothing else. A DELETE trigger, a
--       TRUNCATE trigger or a rewrite rule can each remove audit rows with no
--       constraint involved, and this file inspected NONE of them — its trigger
--       censuses were all scoped to content_block, and pg_rewrite was read
--       nowhere. STEP 4b now checks all three across the whole family
--       (FIX3-AUDIT-01/02/03). Even with it, what is established is that no
--       such trigger or rule EXISTS WHEN THIS MIGRATION RUNS — not that audit
--       rows survive a delete, which also depends on DELETE privileges, on RLS
--       over the audit table, and on application code that can delete rows
--       directly. None of those is visible to any catalog query here.
--     content_quality.content_id REMAINS a soft reference with no foreign key,
--       by owner decision. content_quality is therefore OUTSIDE the DECISION B
--       guarantee: its writer is a service-role path
--       (backend/services/content/qualityService.ts), which performs no
--       validation of its own. The Phase 97 report records THREE call sites of
--       persistScorecard, with the caller-side validation and tenant-scoping
--       evidence for each; correctness of content_id rests on those callers,
--       not on the database.
--     ON UPDATE — every composite FK below is ON UPDATE NO ACTION (the default,
--       and the deliberate choice; ON UPDATE CASCADE would silently re-tenant
--       children). Consequence, absent from the frozen file: once any child row
--       exists, public.content.company_id can no longer be updated.
--
-- KNOWN LIMITS OF THE TENANT GUARANTEE — recorded so no reader over-reads it
--   1. The composite FKs prevent a child row from POINTING AT another company's
--      parent. They do not, by themselves, prevent an UPDATE that moves an
--      existing child row between companies — the FK is satisfied after such a
--      move. The APPLICATION is what closes that for blocks, and it now does:
--      backend/services/content/collaborationService.ts validates that every
--      caller-supplied block id already belongs to the caller's company AND
--      content before any write, and sends a company-scoped conflict target
--      (BLOCK_CONFLICT_TARGET = 'company_id,id'). An earlier version of this
--      note described that file as still upserting with onConflict:'id' and no
--      company predicate; that is stale — it describes the state before the
--      fix, not the branch this migration ships on.
--      NOTE THE COUPLING THIS CREATES, which is the real limit: a composite
--      conflict target needs the unique key STEP 2 adds, so that application
--      code must not ship before this migration is applied. See the release
--      dependency recorded in that file.
--      Other writers in the same family are NOT closed — see
--      contentService.upsertVariant, recorded as an owner decision below.
--   2. Intra-tenant coherence is unconstrained: a recommendation may carry a
--      content_id and a block_id that belong to the same company but to
--      different content. Closing that needs a three-column key and FK.
--   3. RLS here is defence in depth, not the operative boundary — see STEP 8.
--
-- APPLICATION
--   *** DO NOT RUN `supabase db push`. *** The migration ledger is desynced.
--
--   The figure an earlier version of this line gave — "56 duplicate-version
--   prefixes across 170 files" — does not reproduce at any prefix width and is
--   withdrawn. Measured over the top-level set `supabase/migrations/*.sql`
--   (421 files) by taking the first N characters of each basename and counting
--   groups of size > 1: at N=8 (the date) there are 64 duplicate prefixes
--   covering 229 files; at N=14 (the full version) 14 duplicate prefixes
--   covering 34 files. The desync is real and the 14-wide figure is the one
--   that matters for ledger ordering. Apply by hand in the
--   Supabase SQL editor per docs/migration-discipline.md rule 5, then run BOTH
--   `node scripts/verify-schema-parity.js` AND the companion verification
--   script. The ledger row is recorded only after a separately authorized
--   application and verification.
--
--   This file opens its own transaction. It must NOT be applied by a wrapper
--   that has already opened one: a nested BEGIN is a no-op with a warning, and
--   the COMMIT below would then commit the OUTER transaction early, so a later
--   failure in the same batch would no longer roll this file back.
--
-- VERIFICATION — WHAT THE COMPANION SCRIPT DOES AND DOES NOT PROVE
--   supabase/migrations/_fix3_tenant_consistent/verification.sql is
--   VERIFICATION-ONLY and is NOT an application script. It PROVES, from the
--   catalog: the four tables exist; all 37 required columns with their types,
--   nullability and default presence; a usable unique key over id on each; both
--   vocabulary CHECKs and the lifecycle CHECK in their exact supported
--   definition form; two composite unique keys; all four composite foreign keys
--   with every delete/update/match/validation/deferrability property; that each
--   of the four tables carries EXACTLY its expected number of foreign keys both
--   to its modelled parent and IN TOTAL, so an FK to an unmodelled relation is
--   caught, and that content_quality carries NO foreign key at all — the same
--   four totals STEP 4 reconciles, so this file and the script examine the same
--   population; the eight indexes
--   including uniqueness, access method, column order and partial-predicate
--   text; the trigger function's identity and the trigger's timing, events,
--   enabled state and WHEN clause; and RLS enablement with one modelled policy
--   per table.
--   It DOES NOT PROVE BEHAVIOUR. In particular it does NOT establish by
--   execution that an INSERT of lifecycle_status = 'quality_reviewed' is
--   accepted: it asserts the CHECK's exact definition form instead. No
--   behavioural probe exists anywhere in this repository, and adding one would
--   be a data operation requiring separate authorization.
--   `scripts/verify-schema-parity.js` is NOT a substitute for either: its
--   manifest carries only two columns per table, all at WARN, and checks column
--   presence only.
--
-- PRODUCTION / TARGET STATE — READ-ONLY OBSERVATIONS, NOT GUARANTEES
--   Recorded as provenance ONLY. Every one this migration depends on is
--   independently ASSERTED below, because an observation can go stale between
--   reading and applying.
--     - all four target tables ABSENT (read-only query; also absent from
--       supabase/_schema/baseline.sql)
--     - public.content is an ordinary table; company_id uuid NOT NULL; id uuid
--     - no FK-suitable unique key on content (company_id, id); the name
--       content_company_id_key is free; content_source_ref_uidx is partial AND
--       expression-based, so it cannot serve as a foreign-key target
--     - exactly one validated lifecycle CHECK permitting all nine values.
--       supabase/_schema/baseline.sql records it as content_lifecycle_status_check
--       with the nine values in a DIFFERENT ORDER from this file's. STEP 6
--       therefore compares the constraint's DEFINITION FORM order-insensitively
--       and never assumes a name.
--     - 9 rows in content, all within those nine values
--     - public.user_company_roles present; its COLUMNS were not recorded, so
--       STEP 0 asserts the three the RLS predicate reads.
--     - public.set_content_updated_at() is ABSENT from supabase/_schema/baseline.sql.
--       The sibling public.omnivyra_touch_updated_at() is present there and its
--       body is semantically identical. The claim that the repo-declared
--       function is "shared by five triggers" is a REPOSITORY fact, not a
--       target fact. STEP 7 is built around that: it reuses whichever
--       equivalent function the target already has rather than adding a
--       duplicate.
--
-- OWNER DECISIONS REQUIRED — NOT INFERRED, NOT RESOLVED IN THIS FILE
--   Recorded here because each one is a choice the owner makes, and because a
--   silent default would be indistinguishable from an approved decision.
--
--   1. THE updated_at EXECUTOR FUNCTION — DEFERRED, OWNER DECISION REQUIRED.
--      STEP 7 does not pick a function on policy grounds. It adopts whichever
--      approved equivalent the target already uses, prefers
--      public.set_content_updated_at() if present, falls back to
--      public.omnivyra_touch_updated_at() if that is what exists, and creates
--      set_content_updated_at() only when NEITHER exists. That is a
--      conflict-avoiding mechanism, NOT a decision: whether the content family
--      should converge on one executor across the schema, and which one, is
--      unresolved. Four repository migrations declare set_content_updated_at;
--      the production-shaped dump carries omnivyra_touch_updated_at instead.
--      Until the owner decides, every branch is held to identical checks and
--      no function is ever replaced.
--
--   2. DEFAULT PRIVILEGES AND PostgREST REACHABILITY — PREREQUISITES FOR THE
--      VALIDATION STAGE, NOT ADDRESSED HERE. This file issues no GRANT and no
--      ALTER DEFAULT PRIVILEGES, and supabase/_schema/baseline.sql records
--      none for this schema either. Whether `anon` and `authenticated` can
--      reach these four tables through PostgREST at all therefore depends on
--      target-side default privileges this file neither reads nor sets, and
--      RLS policies do not grant table privileges. Consequently the policies
--      added in STEP 8 are asserted as DEFINITIONS only; that they produce the
--      intended access for a real role over PostgREST is UNVERIFIED and
--      requires execution. Establishing it — and deciding whether any GRANT is
--      wanted — belongs to a SEPARATELY AUTHORIZED validation stage, together
--      with the statement_timeout scope question recorded above.
--
--   3. STEP 8 REPLACING A SAME-NAMED POLICY — OWNER DECISION REQUIRED, NOT
--      SETTLED HERE. This was previously decided inside STEP 8's own prose,
--      which is exactly the silent default this section exists to prevent.
--      The two states that reach the replacement branch:
--        (a) A pre-existing <table>_company_rw policy that is STRICTER than
--            this file's — for example the same membership sub-select plus an
--            owner/admin role test. It satisfies every check STEP 8 makes
--            (name, polcmd='*', permissive, polroles={0}, both USING and
--            WITH CHECK present, not literally `true`, a pg_depend edge to
--            user_company_roles), so it is DROPPED and replaced by this file's
--            LOOSER predicate. The only record is a RAISE NOTICE, which the
--            prescribed SQL-editor apply path may not surface. Re-applying the
--            file reverts any later tightening the same way.
--        (b) A pre-existing policy that is UNCONDITIONAL (`USING (true)`).
--            FIX3-RLS-01 ABORTS on it. That is the one state where replacement
--            would strictly improve security, and it is the one state the file
--            refuses to act on — while (a), the safest pre-existing state, is
--            the one it overwrites. The posture is inverted.
--      No predicate is compared semantically anywhere, so neither state can be
--      distinguished from a correct policy by anything but its text.
--      THE DECISION: whether STEP 8 should (i) keep replacing, (ii) abort on any
--      same-named policy whose predicate is not byte-identical to this file's,
--      or (iii) skip when a policy already depends on user_company_roles and
--      report. This file does NOT change the guard to make itself pass; the
--      behaviour is unchanged and recorded.
-- ============================================================================


BEGIN;

-- Bounded waits. These two values are a CONSERVATIVE JUDGEMENT, NOT a
-- workload-validated measurement.
--
-- WHAT lock_timeout = '5s' ACTUALLY DOES. It bounds EACH INDIVIDUAL lock
-- acquisition, not the statement as a whole. STEP 0B locks six relations in two
-- statements, so the worst-case wait for those statements is about 5 s per
-- relation, not 5 s in total. Without it the migration could queue indefinitely
-- behind any in-flight reader of public.content and, because PostgreSQL queues
-- lock requests, every later reader and writer of that table would queue behind
-- the migration.
--
-- WHAT statement_timeout = '120s' ACTUALLY DOES, AND WHY ITS SCOPE DEPENDS ON
-- HOW THIS FILE IS SENT. statement_timeout bounds a STATEMENT, and a `DO` block
-- is one statement — so STEP 4's whole block, every foreign-key spec plus the
-- whole-population reconciliation plus every catalog query they run, shares one
-- budget rather than getting one per constraint.
--
-- BUT "one budget per statement" is TRUE ONLY WHEN THE CLIENT SENDS THE
-- STATEMENTS ONE AT A TIME. PostgreSQL applies statement_timeout to a whole
-- multi-statement simple-query string, not to each statement inside it. The
-- prescribed application path for this file is the SQL editor
-- (docs/migration-discipline.md rule 5), which submits the pasted script as a
-- single string — so in that path the budget is a BATCH budget covering the
-- file, not 120 s for each of its 32 top-level statements.
--
-- THE FIGURE, WITH THE METHOD. Two earlier versions were wrong: "roughly 27"
-- with no method at all, then "49" from a counter that mis-tracked quoting —
-- and whose own decomposition summed to 31, not 49, which should have caught it.
-- A top-level statement here means one a client splitting on `;` would send: a
-- semicolon that is not inside a dollar-quoted block, a single- or
-- double-quoted literal, or a line/block comment. Counted that way this file
-- has 32: 12 DO blocks (each submitted as ONE statement however many checks it
-- contains), 8 CREATE INDEX, 4 CREATE TABLE, 4 ALTER TABLE, 2 SET, plus BEGIN
-- and COMMIT — which sums to 32. The frozen predecessor has 21 by the same
-- method, and that figure was right in both earlier versions, which is why the
-- predecessor is the control worth re-running the counter against.
-- An earlier version of this comment asserted the per-statement reading as the operative
-- one and told the operator that STEP 5's eight CREATE INDEX statements "each
-- get their own budget". Under the prescribed path that is wrong, and wrong in
-- the direction that matters: the real budget is far tighter than it implied.
--
-- AND THERE IS A SECOND UNCERTAINTY, STATED RATHER THAN RESOLVED. Whether a
-- `SET LOCAL statement_timeout` ISSUED INSIDE such a batch re-arms the timer for
-- the remainder of that same batch, or whether the batch was already armed from
-- the session value when the server began processing it, is NOT established by
-- static reading and this file does not execute. So the operative budget for an
-- SQL-editor apply is UNVERIFIED: it is either 120 s for the whole batch or the
-- session's pre-existing statement_timeout for the whole batch. Both readings
-- are batch-scoped; neither is per-statement. Resolving which applies requires
-- execution and is recorded as an OPEN ITEM for the separately authorized
-- validation stage, together with setting the value on the session before the
-- paste if a known budget is required.
--
-- WHAT NEITHER SETTING DOES. Neither bounds the TRANSACTION as such. Under the
-- per-statement reading nothing caps the total time ACCESS EXCLUSIVE is held on
-- public.content, and the ceiling is the sum of the per-statement budgets. Under
-- the batch reading the batch budget does bound it — but that is a consequence
-- of how the file is submitted, not a guarantee this file makes. At the 9 rows
-- observed in production every scan is expected to be sub-second, but that is an
-- observation about row counts, not a measured apply time; on a POPULATED target
-- 120 s may be too low under either reading and must be raised deliberately
-- after measuring.
--
-- transaction_timeout — AVAILABLE, AND DELIBERATELY NOT USED HERE. PostgreSQL
-- 17 added `transaction_timeout`, which WOULD bound the whole transaction and so
-- the whole ACCESS EXCLUSIVE hold. An earlier version of this comment advised an
-- "external watchdog", which is stale advice on a 17.6 target. It is not set in
-- this file for two reasons, both of which the operator should weigh rather than
-- inherit: (1) its semantics are terminal — expiry terminates the SESSION, not
-- just the statement, which is a harsher failure mode than the fail-closed
-- rollback the two settings above already guarantee; and (2) any value would be
-- a second unmeasured guess layered on the first. If a hard ceiling on the lock
-- hold is wanted, `SET LOCAL transaction_timeout = '<measured budget>'` added
-- next to these two lines is the correct mechanism, and it is an OPERATOR
-- DECISION requiring a measured budget — not something this file should pick.
-- PRECOND-00 already asserts server_version_num >= 150000; a transaction_timeout
-- addition would need >= 170000.
--
-- A lock_timeout (55P03) or statement_timeout (57014) expiry aborts the
-- statement, which propagates and rolls the whole transaction back, leaving NO
-- partial schema change. No DO block in this file has an EXCEPTION handler, so
-- none opens a subtransaction that could revert these settings or swallow an
-- abort.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';


-- ===========================================================================
-- STEP 0 — PREFLIGHT ASSERTIONS (fail closed)
-- Every assertion here runs BEFORE any lock is taken and before any DDL, so a
-- missing prerequisite costs nothing and names itself. Nothing found here is
-- stable under concurrency; STEP 1B re-reads the catalog after the locks.
-- ===========================================================================
DO $$
DECLARE
  r_content   regclass := to_regclass('public.content');
  r_ucr       regclass := to_regclass('public.user_company_roles');
  v_relkind   "char";
  v_type      text;
  v_notnull   boolean;
  t           text;
  r_child     regclass;
  v_colspec   record;
  a_id        smallint;
  a_company   smallint;
BEGIN
  -- PRECOND-00 — server version. ON DELETE SET NULL (<column list>) and the
  -- pg_constraint.confdelsetcols column this migration reads both require
  -- PostgreSQL >= 15. Asserted in SQL rather than claimed in a comment.
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'FIX3-PRECOND-00: server_version_num is % — ON DELETE SET NULL (column) and pg_constraint.confdelsetcols require PostgreSQL >= 15 (150000).',
      current_setting('server_version_num');
  END IF;

  IF r_content IS NULL THEN
    RAISE EXCEPTION 'FIX3-PRECOND-01: public.content is absent. Apply 20260718000000_canonical_content_foundation.sql first.';
  END IF;
  SELECT relkind INTO v_relkind FROM pg_class WHERE oid = r_content;
  IF v_relkind NOT IN ('r','p') THEN
    RAISE EXCEPTION 'FIX3-PRECOND-02: public.content has relkind=% — not a table, so it cannot be a foreign-key target.', v_relkind;
  END IF;

  SELECT format_type(atttypid, atttypmod), attnotnull INTO v_type, v_notnull
    FROM pg_attribute WHERE attrelid = r_content AND attname = 'company_id'
      AND attnum > 0 AND NOT attisdropped;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'FIX3-PRECOND-03: public.content.company_id is absent.';
  END IF;
  IF v_type <> 'uuid' THEN
    RAISE EXCEPTION 'FIX3-PRECOND-04: public.content.company_id is % (expected uuid).', v_type;
  END IF;
  IF NOT v_notnull THEN
    RAISE EXCEPTION 'FIX3-PRECOND-05: public.content.company_id is nullable. A composite tenant FK requires it NOT NULL.';
  END IF;

  SELECT format_type(atttypid, atttypmod), attnum INTO v_type, a_id
    FROM pg_attribute WHERE attrelid = r_content AND attname = 'id'
      AND attnum > 0 AND NOT attisdropped;
  IF v_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'FIX3-PRECOND-06: public.content.id is % (expected uuid).', COALESCE(v_type,'absent');
  END IF;

  -- PRECOND-20 — public.content must already carry a usable unique key that
  -- STEP 2 can rely on. THIS IS THE SAME RULE AS FIX3-SHAPE-07, deliberately.
  --
  -- WHY A DISJUNCTION. STEP 2 may need to add UNIQUE (company_id, id) on
  -- public.content, and its claim that "the ADD cannot fail on existing rows"
  -- rests on `id` already being unique. But there is a second way to satisfy
  -- STEP 2: if a usable unique key on exactly {company_id, id} already exists,
  -- STEP 2 adds NOTHING and the premise about `id` is irrelevant. An earlier
  -- version of this guard required only the first branch, which rejected a
  -- perfectly usable PRIMARY KEY (company_id, id) — exactly the over-strictness
  -- the SHAPE-07 comment says was fixed, left unfixed here while STEP 2's header
  -- claimed both guards implemented the same rule. They now do.
  SELECT attnum INTO a_company FROM pg_attribute
    WHERE attrelid = r_content AND attname = 'company_id' AND attnum > 0 AND NOT attisdropped;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = r_content
      AND i.indisunique AND i.indimmediate AND i.indisvalid
      AND i.indisready AND i.indislive
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (
        ( i.indnkeyatts = 1
          AND (string_to_array(i.indkey::text, ' ')::smallint[])[1] = a_id )
        OR
        ( i.indnkeyatts = 2
          AND (SELECT array_agg(t.attnum ORDER BY t.attnum)
                 FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                        WITH ORDINALITY AS t(attnum, ord)
                WHERE t.ord <= i.indnkeyatts)
              = (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[a_company, a_id]) k) )
      )
  ) THEN
    RAISE EXCEPTION
      'FIX3-PRECOND-20: public.content has no usable unique key on exactly (id) nor on exactly (company_id, id) — unique, immediate, valid, ready, live, non-partial, non-expression. STEP 2 needs one or the other: the first makes ADD CONSTRAINT ... UNIQUE (company_id, id) safe on existing rows, the second means STEP 2 adds nothing at all. Resolve manually.';
  END IF;

  IF r_ucr IS NULL THEN
    RAISE EXCEPTION 'FIX3-PRECOND-07: public.user_company_roles is absent; the RLS policy predicate would fail.';
  END IF;

  FOREACH t IN ARRAY ARRAY['content_quality','content_block','content_recommendation','content_approval_history'] LOOP
    r_child := to_regclass('public.' || t);
    CONTINUE WHEN r_child IS NULL;
    SELECT relkind INTO v_relkind FROM pg_class WHERE oid = r_child;
    IF v_relkind NOT IN ('r','p') THEN
      RAISE EXCEPTION 'FIX3-PRECOND-08: public.% has relkind=% — expected a table.', t, v_relkind;
    END IF;
    SELECT format_type(atttypid, atttypmod), attnotnull INTO v_type, v_notnull
      FROM pg_attribute WHERE attrelid = r_child AND attname = 'company_id'
        AND attnum > 0 AND NOT attisdropped;
    IF v_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'FIX3-PRECOND-09: public.%.company_id is % (expected uuid).', t, COALESCE(v_type,'absent');
    END IF;
    IF NOT v_notnull THEN
      RAISE EXCEPTION 'FIX3-PRECOND-10: public.%.company_id is nullable (expected NOT NULL).', t;
    END IF;
    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute WHERE attrelid = r_child AND attname = 'content_id'
        AND attnum > 0 AND NOT attisdropped;
    IF v_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'FIX3-PRECOND-11: public.%.content_id is % (expected uuid).', t, COALESCE(v_type,'absent');
    END IF;
    -- PRECOND-11 deliberately checks content_id's TYPE and NOT its nullability.
    -- The frozen predecessor ships content_approval_history.content_id as
    -- NOT NULL; STEP 3 relaxes it; and STEP 1B runs BEFORE STEP 3. Asserting
    -- NOT NULL here would break a fresh install (STEP 1 creates it nullable),
    -- and asserting nullable here would break the FIRST run against the legacy
    -- shape. Not asserting it is the only correct choice, and STEP 3 makes the
    -- end state unconditional regardless.
    --
    -- PRECOND-14 — `id` must be uuid on every existing target table.
    -- content_block.id is the referenced column of content_recommendation_block_fk;
    -- for content_quality and content_approval_history, whose id is referenced by
    -- nothing here, this is a deliberate uniformity requirement, not an FK one.
    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute WHERE attrelid = r_child AND attname = 'id'
        AND attnum > 0 AND NOT attisdropped;
    IF v_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'FIX3-PRECOND-14: public.%.id is % (expected uuid; required as an FK target on content_block, required for uniformity on the others).', t, COALESCE(v_type,'absent');
    END IF;
  END LOOP;

  r_child := to_regclass('public.content_recommendation');
  IF r_child IS NOT NULL THEN
    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute WHERE attrelid = r_child AND attname = 'block_id'
        AND attnum > 0 AND NOT attisdropped;
    IF v_type IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'FIX3-PRECOND-12: public.content_recommendation.block_id is % (expected uuid).', COALESCE(v_type,'absent');
    END IF;
  END IF;

  r_child := to_regclass('public.content_approval_history');
  IF r_child IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = r_child
                     AND attname = 'to_status' AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'FIX3-PRECOND-13: public.content_approval_history.to_status is absent.';
    END IF;
  END IF;

  -- PRECOND-15 — STEP 6 constrains public.content.lifecycle_status.
  --
  -- EXACTLY text, not the character type FAMILY. An earlier version accepted
  -- `character varying` here, reasoning that the lifecycle CHECK only compares
  -- the column to text literals. But STEP 6 matches the constraint's deparse
  -- against elements spelled `'value'::text`, and only a `text` column deparses
  -- that way — a varchar column yields `'value'::character varying` (or a
  -- visible `(col)::text` cast). So varchar was WELCOMED here and then
  -- GUARANTEED to be rejected by STEP 6, and on the no-constraint path the
  -- migration would have COMMITted a state its own verification script
  -- rejects. The two guards now agree. The type FAMILY is still accepted for
  -- the character columns that carry no CHECK (to_status, note, reason, …).
  SELECT format_type(atttypid, atttypmod) INTO v_type
    FROM pg_attribute WHERE attrelid = r_content AND attname = 'lifecycle_status'
      AND attnum > 0 AND NOT attisdropped;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'FIX3-PRECOND-15: public.content.lifecycle_status is absent; STEP 6 cannot constrain it.';
  END IF;
  IF v_type <> 'text' THEN
    RAISE EXCEPTION 'FIX3-PRECOND-15: public.content.lifecycle_status is % (expected exactly text — STEP 6 matches a deparsed CHECK whose elements are ''value''::text, which only a text column produces).', v_type;
  END IF;

  -- PRECOND-16..18 — the three columns STEP 8's policy predicate reads. These
  -- are asserted because the repository's own bootstrap definition of
  -- user_company_roles (20260319_core_bootstrap_dependencies.sql) does NOT
  -- declare `status`; later migrations add it.
  FOR v_colspec IN
    SELECT * FROM (VALUES
      ('user_id',    'uuid', 'FIX3-PRECOND-16'),
      ('company_id', 'uuid', 'FIX3-PRECOND-17'),
      ('status',     'char', 'FIX3-PRECOND-18')
    ) AS v(cname, want, code)
  LOOP
    SELECT format_type(atttypid, atttypmod) INTO v_type
      FROM pg_attribute WHERE attrelid = r_ucr AND attname = v_colspec.cname
        AND attnum > 0 AND NOT attisdropped;
    IF v_type IS NULL THEN
      RAISE EXCEPTION '%: public.user_company_roles.% is absent; STEP 8''s policy predicate would fail with 42703.',
        v_colspec.code, v_colspec.cname;
    END IF;
    IF v_colspec.want = 'uuid' AND v_type <> 'uuid' THEN
      RAISE EXCEPTION '%: public.user_company_roles.% is % (expected uuid, to compare against auth.uid() and public.content.company_id).',
        v_colspec.code, v_colspec.cname, v_type;
    END IF;
    IF v_colspec.want = 'char'
       AND v_type NOT IN ('text','character varying') AND v_type NOT LIKE 'character varying(%' THEN
      RAISE EXCEPTION '%: public.user_company_roles.% is % (expected a character type, since the policy compares it to the literal ''active'').',
        v_colspec.code, v_colspec.cname, v_type;
    END IF;
  END LOOP;

  -- PRECOND-19 — auth.uid() must be resolvable. On a non-Supabase target it is
  -- absent and STEP 8's CREATE POLICY fails with 42883 after everything else.
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'FIX3-PRECOND-19: auth.uid() is not resolvable; STEP 8''s policy predicate requires it. This target is not a Supabase database, or the auth schema is unavailable to this role.';
  END IF;

  RAISE NOTICE 'FIX3 STEP 0: preflight assertions passed.';
END $$;


-- ===========================================================================
-- STEP 0B — DETERMINISTIC, BOUNDED LOCK ACQUISITION
--
-- WHAT THIS DOES. Takes ACCESS SHARE on public.user_company_roles, then
-- ACCESS EXCLUSIVE on every table this migration alters, LEAF-FIRST by the
-- foreign-key graph this file declares.
--
-- THE GRAPH, as declared in STEP 4:
--   content_recommendation   -> content, content_block
--   content_block            -> content
--   content_approval_history -> content
--   content_quality          -> (no FK, by owner decision)
-- The only interior node is content_block: it is a child of content AND the
-- parent of content_recommendation. A true leaf-first order must therefore put
-- content_recommendation BEFORE content_block, and content_block before content:
--   content_recommendation, content_approval_history, content_quality,
--   content_block, content
-- An earlier version of this file listed content_block before
-- content_recommendation and still called the order "children first". It was
-- not: for the content_recommendation -> content_block edge it was parent-first,
-- which is exactly the inversion the ordering exists to avoid.
--
-- WHY LEAF-FIRST AT ALL. An ordinary application write to a child acquires the
-- child's lock first and only then the parent's KEY SHARE for the foreign-key
-- check — child, then parent. Acquiring in the same direction removes that
-- inversion for the relations in this set.
--
-- WHY user_company_roles IS HERE. STEP 8's CREATE POLICY parse-analyses a
-- predicate that reads public.user_company_roles, which takes ACCESS SHARE on
-- it — the same mechanism that records the pg_depend row STEP 8's check (5)
-- relies on. It happens four times, at the very end of the transaction. Taking
-- it up front means a concurrent ALTER/VACUUM FULL/REINDEX on the membership
-- table fails the apply in the first second instead of after every unique key,
-- foreign key, index, CHECK and trigger has been built. ACCESS SHARE is the
-- weakest mode that suffices. It is acquired FIRST, before the ACCESS EXCLUSIVE
-- set, so the global order is fixed.
--
-- THE COST OF HOLDING IT, stated rather than glossed. An earlier version of this
-- comment said ACCESS SHARE "blocks DDL on that table and nothing else". That
-- understates it in two ways, and both are the operator's to weigh:
--   (a) TRANSITIVE STALL. ACCESS SHARE conflicts only with ACCESS EXCLUSIVE, so
--       it does not block readers directly — but PostgreSQL QUEUES lock
--       requests. A concurrent ALTER/VACUUM FULL/REINDEX on user_company_roles
--       queues behind this lock, and every subsequent READER of that table then
--       queues behind THAT waiter. Since user_company_roles is the membership
--       table every company-scoped RLS policy in this schema reads, the
--       practical blast radius of that interval is far wider than "DDL only".
--   (b) A NEW CYCLE CLASS. Holding it for the whole transaction creates a
--       deadlock edge with any session that takes user_company_roles before
--       public.content. Nothing here constrains such a session.
-- The alternative — acquiring it lazily at STEP 8 — trades that for discovering
-- the need after every unique key, foreign key, index, CHECK and trigger has
-- been built, and then discarding all of it. This file takes it up front
-- deliberately; the trade is recorded so the choice is reviewable.
--
-- LOCK-ORDER CYCLE ANALYSIS — what remains possible, not a claim of safety:
--   REMOVED by this ordering: the child-write inversion for all five relations,
--     including the content_recommendation -> content_block edge.
--   REMAINS — parent-write DML. `DELETE FROM public.content` takes content
--     first, then locks the children to run the referential actions; `UPDATE
--     public.content SET company_id=...` likewise. That inverts against this
--     migration. Children-first does not remove an inversion, it chooses which
--     class of DML inverts; child writes are far more frequent than parent
--     deletes, which is why this direction is preferred.
--   REMAINS — FROM-order queries. Parse analysis opens relations in FROM order,
--     so `SELECT ... FROM public.content c JOIN public.content_block b ...`
--     holds AccessShare on content and waits on content_block.
--   REMAINS — VACUUM FULL / REINDEX / TRUNCATE on any relation in the set.
--   REMAINS — any other migration touching these relations in another order.
--   NOT A CYCLE — two concurrent runs of this file: identical order, so the
--     second waits and then aborts on lock_timeout.
-- DEADLOCK IS NOT ELIMINATED. On a true cycle PostgreSQL's deadlock detector
-- fires at deadlock_timeout (default 1 s, i.e. BEFORE lock_timeout) and raises
-- 40P01, choosing a victim that MAY be the application session rather than this
-- migration. An apply script must handle 40P01 and 55P03 alike.
--
-- OPERATIONAL IMPACT. From the ACCESS EXCLUSIVE statement until COMMIT, every
-- reader and writer of public.content and of any existing target table BLOCKS.
-- NOTE on the first apply to a target where the four tables are absent: the
-- ACCESS EXCLUSIVE set is {public.content} ALONE, so the ordering above is
-- inert there and the blocking is confined to public.content. content's OTHER
-- existing children (content_variant, content_asset, content_revision,
-- content_memory, content_originality) are deliberately NOT locked — this file
-- does not alter them, and they only ever need content, so they queue rather
-- than cycle.
-- ===========================================================================
DO $$
DECLARE
  t        text;
  v_parts  text[] := ARRAY[]::text[];
  v_sql    text;
BEGIN
  IF to_regclass('public.user_company_roles') IS NULL THEN
    RAISE EXCEPTION 'FIX3-LOCK-02: public.user_company_roles is absent at STEP 0B, which contradicts FIX3-PRECOND-07.';
  END IF;
  LOCK TABLE public.user_company_roles IN ACCESS SHARE MODE;

  FOREACH t IN ARRAY ARRAY['content_recommendation','content_approval_history','content_quality','content_block','content'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      v_parts := v_parts || ('public.' || quote_ident(t));
    END IF;
  END LOOP;
  IF array_length(v_parts, 1) IS NULL THEN
    RAISE EXCEPTION 'FIX3-LOCK-01: no target table exists to lock, which contradicts FIX3-PRECOND-01.';
  END IF;
  v_sql := 'LOCK TABLE ' || array_to_string(v_parts, ', ') || ' IN ACCESS EXCLUSIVE MODE';
  EXECUTE v_sql;
  RAISE NOTICE 'FIX3 STEP 0B: ACCESS SHARE on public.user_company_roles; ACCESS EXCLUSIVE leaf-first on % table(s): %',
    array_length(v_parts,1), array_to_string(v_parts, ', ');
END $$;


-- ===========================================================================
-- STEP 1 — CREATE ANY ABSENT TARGET TABLE
--
-- Columns, primary key and CHECK constraints are declared here and therefore
-- apply ONLY when a table is created fresh. A table-level create guard is a
-- no-op against a pre-existing table: it adds no column, no primary key, no
-- CHECK, no NOT NULL and no default. This file does NOT reconcile those
-- elements on a pre-existing table — it VALIDATES them in STEP 1B and fails
-- closed on any mismatch. The foreign keys and the composite unique keys are the
-- only elements genuinely reconciled (STEP 2 and STEP 4), which is why they are
-- declared outside these statements.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.content_quality (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  content_id    uuid,                       -- SOFT REF → content.id. No FK, by owner decision.
  overall_score numeric,                    -- 0..100
  dimensions    jsonb NOT NULL,
  evaluated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_block (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL,
  company_id  uuid NOT NULL,
  block_type  text NOT NULL CHECK (block_type IN ('hook','opening','body','cta','hashtags','other')),
  position    integer NOT NULL DEFAULT 0,
  text        text,
  locked      boolean NOT NULL DEFAULT false,  -- AI may NOT modify a locked block
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_recommendation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  content_id      uuid NOT NULL,
  block_id        uuid,                      -- NULLABLE: NULL = whole content
  affected_section text,
  category        text NOT NULL,
  reason          text NOT NULL,
  expected_impact text,
  confidence      numeric,
  before_text     text,
  after_text      text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected','superseded')),
  quality_ref     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS public.content_approval_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  content_id  uuid,                          -- DECISION C: NULLABLE
  from_status text,
  to_status   text NOT NULL,
  actor       uuid,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- ===========================================================================
-- STEP 1B — REQUIRED SHAPE VALIDATION (fail closed)
--
-- WHY THIS EXISTS. Because STEP 1 cannot repair a pre-existing table, a table
-- that exists with an INCOMPLETE shape would otherwise pass every earlier guard
-- and this migration would COMMIT a schema that cannot serve its own code paths
-- — for example a content_block without `updated_at`, where CREATE TRIGGER
-- succeeds (plpgsql resolves NEW.updated_at only at execution time) and every
-- UPDATE then fails at runtime. That is a fail-OPEN outcome.
--
-- STRATEGY. VALIDATE AND FAIL CLOSED: nothing here adds, alters or drops
-- anything. An incompatible pre-existing table aborts the transaction with a
-- diagnostic naming the exact table, column and discrepancy. Reconciling
-- automatically was rejected because adding a column, a CHECK or a NOT NULL to
-- a populated table whose contents are unknown cannot be shown safe from the
-- repository alone.
--
-- TYPE COMPARISON. `kind` selects the comparison:
--   'exact'   — format_type must equal `want` (uuid, jsonb, boolean, integer,
--               timestamp with time zone). These are the types this migration
--               actually depends on.
--   'char'    — any character type is accepted: text, character varying,
--               character varying(n). Nothing here depends on a text column's
--               typmod, and rejecting character varying(32) for a status column
--               would abort a usable schema. This mirrors PRECOND-15/18.
--   'numeric' — numeric with or without a typmod.
--
-- WHAT IS DELIBERATELY NOT CHECKED, and why:
--   - content_approval_history.content_id nullability — the frozen predecessor
--     ships it NOT NULL, STEP 3 relaxes it, and STEP 1B runs BEFORE STEP 3.
--     Asserting NOT NULL breaks a fresh install; asserting nullable breaks the
--     first legacy run. STEP 3 makes the end state unconditional.
--   - The EXPRESSION of a default. Only its presence is asserted; comparing a
--     deparsed default expression is the text-fragility trap documented below.
--   - Nullability of purely optional data columns, which this migration does
--     not depend on.
--   - Extra columns beyond the required set. Harmless here.
-- Because this step runs AFTER STEP 1 it also validates freshly created tables,
-- so a drafting error between this manifest and STEP 1's definitions fails
-- closed rather than diverging silently.
-- ===========================================================================
DO $$
DECLARE
  spec       record;
  r_tbl      regclass;
  v_type     text;
  v_notnull  boolean;
  v_hasdef   boolean;
  v_valid    boolean;
  v_cnt      int;
  v_ncons    int;
  v_nkeys    int;
  v_name     text;
  v_def      text;
  v_pre      text;
  v_suf      text;
  v_inner    text;
  v_got      text[];
  v_exp      text[];
  v_form_ok  boolean;
  a_col      smallint;
  a_id       smallint;
  a_company  smallint;
  v_typeok   boolean;
BEGIN
  -- ---- columns -----------------------------------------------------------
  FOR spec IN
    SELECT * FROM (VALUES
      ('content_quality','id',                     'uuid',                     'exact',   TRUE,          TRUE),
      ('content_quality','company_id',             'uuid',                     'exact',   TRUE,          NULL::boolean),
      ('content_quality','content_id',             'uuid',                     'exact',   FALSE,         NULL::boolean),
      ('content_quality','overall_score',          'numeric',                  'numeric', NULL::boolean, NULL::boolean),
      ('content_quality','dimensions',             'jsonb',                    'exact',   TRUE,          NULL::boolean),
      ('content_quality','evaluated_at',           'timestamp with time zone', 'exact',   TRUE,          TRUE),

      ('content_block','id',                       'uuid',                     'exact',   TRUE,          TRUE),
      ('content_block','content_id',               'uuid',                     'exact',   TRUE,          NULL::boolean),
      ('content_block','company_id',               'uuid',                     'exact',   TRUE,          NULL::boolean),
      ('content_block','block_type',               'text',                     'exact',   TRUE,          NULL::boolean),
      ('content_block','position',                 'integer',                  'exact',   TRUE,          TRUE),
      ('content_block','text',                     'text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_block','locked',                   'boolean',                  'exact',   TRUE,          TRUE),
      ('content_block','updated_at',               'timestamp with time zone', 'exact',   TRUE,          TRUE),

      ('content_recommendation','id',              'uuid',                     'exact',   TRUE,          TRUE),
      ('content_recommendation','company_id',      'uuid',                     'exact',   TRUE,          NULL::boolean),
      ('content_recommendation','content_id',      'uuid',                     'exact',   TRUE,          NULL::boolean),
      ('content_recommendation','block_id',        'uuid',                     'exact',   FALSE,         NULL::boolean),
      ('content_recommendation','affected_section','text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_recommendation','category',        'text',                     'char',    TRUE,          NULL::boolean),
      ('content_recommendation','reason',          'text',                     'char',    TRUE,          NULL::boolean),
      ('content_recommendation','expected_impact', 'text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_recommendation','confidence',      'numeric',                  'numeric', NULL::boolean, NULL::boolean),
      ('content_recommendation','before_text',     'text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_recommendation','after_text',      'text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_recommendation','status',          'text',                     'exact',   TRUE,          TRUE),
      ('content_recommendation','quality_ref',     'jsonb',                    'exact',   NULL::boolean, NULL::boolean),
      ('content_recommendation','created_at',      'timestamp with time zone', 'exact',   TRUE,          TRUE),
      ('content_recommendation','resolved_at',     'timestamp with time zone', 'exact',   NULL::boolean, NULL::boolean),

      ('content_approval_history','id',            'uuid',                     'exact',   TRUE,          TRUE),
      ('content_approval_history','company_id',    'uuid',                     'exact',   TRUE,          NULL::boolean),
      ('content_approval_history','content_id',    'uuid',                     'exact',   NULL::boolean, NULL::boolean),
      ('content_approval_history','from_status',   'text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_approval_history','to_status',     'text',                     'char',    TRUE,          NULL::boolean),
      ('content_approval_history','actor',         'uuid',                     'exact',   NULL::boolean, NULL::boolean),
      ('content_approval_history','note',          'text',                     'char',    NULL::boolean, NULL::boolean),
      ('content_approval_history','created_at',    'timestamp with time zone', 'exact',   TRUE,          TRUE)
    ) AS v(tbl, col, want, kind, want_notnull, want_hasdef)
  LOOP
    r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
    IF r_tbl IS NULL THEN
      RAISE EXCEPTION 'FIX3-SHAPE-01: public.% is absent at STEP 1B, which contradicts STEP 1.', spec.tbl;
    END IF;

    SELECT format_type(atttypid, atttypmod), attnotnull, atthasdef
      INTO v_type, v_notnull, v_hasdef
      FROM pg_attribute WHERE attrelid = r_tbl AND attname = spec.col
        AND attnum > 0 AND NOT attisdropped;

    IF v_type IS NULL THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-02: public.%.% is ABSENT (expected %). A table-level create guard cannot add a column to a pre-existing table, so this is a PARTIAL INSTALL. Add the column deliberately, then re-apply; this migration will not alter the table.',
        spec.tbl, spec.col, spec.want;
    END IF;

    v_typeok := CASE spec.kind
      WHEN 'exact'   THEN v_type = spec.want
      WHEN 'char'    THEN v_type IN ('text','character varying') OR v_type LIKE 'character varying(%'
      WHEN 'numeric' THEN v_type = 'numeric' OR v_type LIKE 'numeric(%'
      ELSE FALSE END;
    IF NOT v_typeok THEN
      RAISE EXCEPTION 'FIX3-SHAPE-03: public.%.% is % (expected % — comparison kind %).',
        spec.tbl, spec.col, v_type, spec.want, spec.kind;
    END IF;

    IF spec.want_notnull IS TRUE AND NOT v_notnull THEN
      RAISE EXCEPTION 'FIX3-SHAPE-04: public.%.% is nullable (expected NOT NULL).', spec.tbl, spec.col;
    END IF;
    IF spec.want_notnull IS FALSE AND v_notnull THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-05: public.%.% is NOT NULL (expected nullable). This migration depends on that column accepting NULL — content_recommendation.block_id NULL means "whole content", and content_quality.content_id is a nullable soft reference.',
        spec.tbl, spec.col;
    END IF;
    IF spec.want_hasdef IS TRUE AND NOT v_hasdef THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-06: public.%.% has no DEFAULT, and one is required (inserts omitting this column would fail). Only the PRESENCE of a default is asserted, never its expression.',
        spec.tbl, spec.col;
    END IF;
    IF spec.want_hasdef IS FALSE AND v_hasdef THEN
      RAISE EXCEPTION 'FIX3-SHAPE-06: public.%.% has a DEFAULT and none is expected.', spec.tbl, spec.col;
    END IF;
  END LOOP;

  -- ---- a usable unique key over id ---------------------------------------
  -- WHAT IS ACTUALLY REQUIRED, and why this is not "a primary key on (id)".
  -- STEP 2 needs a usable unique key on (company_id, id). It can get there two
  -- ways: either `id` is already unique, in which case adding
  -- UNIQUE (company_id, id) cannot fail on existing rows; or a usable unique key
  -- on exactly {company_id, id} already exists, in which case STEP 2 adds
  -- nothing and the premise about id is irrelevant. An earlier version demanded
  -- a PRIMARY KEY on exactly (id), which rejected a perfectly usable
  -- PRIMARY KEY (company_id, id) — a defensible tenant-partitioning choice that
  -- every later step handles correctly. This asserts the real prerequisite.
  FOR spec IN
    SELECT * FROM (VALUES
      ('content_quality'), ('content_block'), ('content_recommendation'), ('content_approval_history')
    ) AS v(tbl)
  LOOP
    r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
    SELECT attnum INTO a_id FROM pg_attribute
      WHERE attrelid = r_tbl AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
    SELECT attnum INTO a_company FROM pg_attribute
      WHERE attrelid = r_tbl AND attname = 'company_id' AND attnum > 0 AND NOT attisdropped;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = r_tbl
        AND i.indisunique AND i.indimmediate AND i.indisvalid
        AND i.indisready AND i.indislive
        AND i.indpred IS NULL AND i.indexprs IS NULL
        AND (
          ( i.indnkeyatts = 1
            AND (string_to_array(i.indkey::text, ' ')::smallint[])[1] = a_id )
          OR
          ( i.indnkeyatts = 2
            AND (SELECT array_agg(t.attnum ORDER BY t.attnum)
                   FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                          WITH ORDINALITY AS t(attnum, ord)
                  WHERE t.ord <= i.indnkeyatts)
                = (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[a_company, a_id]) k) )
        )
    ) THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-07: public.% has no usable unique key on exactly (id) nor on exactly (company_id, id) — unique, immediate, valid, non-partial, non-expression. STEP 2 requires one or the other.',
        spec.tbl;
    END IF;
  END LOOP;

  -- ---- inline vocabulary CHECK constraints -------------------------------
  -- HOW THE COMPARISON WORKS, and why it is not literal extraction.
  -- An earlier version extracted the quoted literals from pg_get_constraintdef
  -- and compared them as a set. That was FAIL-OPEN: it ignored everything
  -- AROUND the literals, so `block_type IN (...six...) AND length(block_type)<=4`
  -- and `block_type NOT IN (...six...)` both carried the right literal set and
  -- were accepted, while the second one rejects every legal value.
  -- This instead requires the WHOLE definition to be exactly the one supported
  -- form, BYTE FOR BYTE, with the value list as the only variable part:
  --     CHECK ((<col> = ANY (ARRAY[<elements>])))
  -- taken verbatim from PostgreSQL's own deparse output (the form recorded in
  -- supabase/_schema/baseline.sql for this schema's membership CHECKs). Because
  -- the prefix and suffix must consume the entire string, an extra conjunct, a
  -- negation, a COALESCE or any other wrapper CANNOT hide inside it. Each
  -- element is then compared against a CONSTRUCTED expected element, order
  -- insensitively, so literal order and the source spelling (`IN (...)` versus
  -- `= ANY (ARRAY[...])`, which deparse identically) are immaterial.
  -- NOTHING IS NORMALISED, stated rather than assumed. The actual definition is
  -- neither lower-cased nor whitespace-stripped: the prefix, the suffix and the
  -- `, ` element separator are the exact bytes `pg_get_constraintdef(oid)`
  -- emits in its single-argument, non-pretty form. An earlier version did
  -- lower-case and strip the actual text, which folded `'Draft'` onto `'draft'`
  -- and accepted a CHECK whose literals differ from this file's in case — so a
  -- value the application writes in canonical lower case could be rejected at
  -- run time by a constraint this migration had just reported as correct.
  -- Any deviation, including a whitespace variation, now fails CLOSED with the
  -- actual definition printed. Any other definition form, including
  -- `= ANY ('{...}'::text[])` or a regex, is REJECTED UNCHANGED rather than
  -- interpreted.
  FOR spec IN
    SELECT * FROM (VALUES
      ('content_block','block_type',
         ARRAY['hook','opening','body','cta','hashtags','other']),
      ('content_recommendation','status',
         ARRAY['pending','accepted','rejected','superseded'])
    ) AS v(tbl, col, want_lits)
  LOOP
    r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
    SELECT attnum INTO a_col FROM pg_attribute
      WHERE attrelid = r_tbl AND attname = spec.col AND attnum > 0 AND NOT attisdropped;

    SELECT count(*) INTO v_ncons FROM pg_constraint
      WHERE conrelid = r_tbl AND contype = 'c' AND a_col = ANY (conkey);
    IF v_ncons <> 1 THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-08: public.%.% is covered by % CHECK constraint(s); exactly one is expected (the vocabulary CHECK declared in STEP 1). With more than one the permitted domain is their CONJUNCTION. Resolve manually.',
        spec.tbl, spec.col, v_ncons;
    END IF;

    SELECT conname, pg_get_constraintdef(oid), array_length(conkey,1), convalidated
      INTO v_name, v_def, v_nkeys, v_valid
      FROM pg_constraint WHERE conrelid = r_tbl AND contype = 'c' AND a_col = ANY (conkey);
    IF v_nkeys <> 1 THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-09: the CHECK % on public.% spans % columns; a single-column vocabulary CHECK on %.% is expected. Resolve manually.',
        v_name, spec.tbl, v_nkeys, spec.tbl, spec.col;
    END IF;
    IF NOT v_valid THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-10: the CHECK % on public.%.% is NOT VALID, so existing rows were never checked against it. Resolve manually.',
        v_name, spec.tbl, spec.col;
    END IF;

    -- NOTHING IS NORMALISED. An earlier version lowercased the actual
    -- definition and stripped all its whitespace before comparing, while
    -- building the expected elements from already-lowercase values WITHOUT
    -- folding. The folding was therefore one-directional and FAIL-OPEN on the
    -- literal payload: a CHECK permitting 'HOOK' folded down to 'hook' and was
    -- accepted as correct, and a whitespace variant like 'other ' likewise.
    -- The comparison below is byte-exact against PostgreSQL's own deparse form,
    -- which is deterministic: `CHECK ((<col> = ANY (ARRAY['a'::text, …])))`
    -- with a single `, ` between elements. Evidence for that form is the live
    -- constraint recorded in supabase/_schema/baseline.sql. Any other spelling
    -- — including a different cast, a varchar column, extra whitespace outside
    -- the literals, or any wrapper — fails SHAPE-11 and is REJECTED UNCHANGED.
    -- Element ORDER remains immaterial (both sides are sorted), and the
    -- comparison is a MULTISET, so a duplicated value changes the arity and is
    -- rejected. Expected elements are built with quote_literal(), so a value
    -- containing a quote is rendered exactly as PostgreSQL would render it.
    v_pre  := 'CHECK ((' || spec.col || ' = ANY (ARRAY[';
    v_suf  := '])))';
    v_form_ok := length(v_def) > length(v_pre) + length(v_suf)
             AND left(v_def, length(v_pre)) = v_pre
             AND right(v_def, length(v_suf)) = v_suf;
    IF NOT v_form_ok THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-11: the CHECK % on public.%.% is not in the one supported definition form. The WHOLE definition must be exactly CHECK ((% = ANY (ARRAY[''a''::text, …]))) — no extra condition, negation, wrapper, cast or whitespace variation — so that nothing can hide inside it. Actual: %. This migration will not alter it; resolve manually.',
        v_name, spec.tbl, spec.col, spec.col, v_def;
    END IF;

    v_inner := substr(v_def, length(v_pre) + 1,
                      length(v_def) - length(v_pre) - length(v_suf));
    SELECT array_agg(e ORDER BY e) INTO v_got
      FROM unnest(string_to_array(v_inner, ', ')) AS e;
    SELECT array_agg(quote_literal(w) || '::text' ORDER BY quote_literal(w) || '::text') INTO v_exp
      FROM unnest(spec.want_lits) AS w;
    IF v_got IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION
        'FIX3-SHAPE-12: the CHECK % on public.%.% has the supported form but its element list is %, not the expected % (compared case-sensitively and with literal contents preserved). Actual definition: %. Resolve manually.',
        v_name, spec.tbl, spec.col, COALESCE(v_got::text,'{}'), v_exp::text, v_def;
    END IF;
  END LOOP;

  RAISE NOTICE 'FIX3 STEP 1B: required shape validated — 37 columns, 4 usable unique keys over id, 2 vocabulary CHECKs in their exact supported form.';
END $$;


-- ===========================================================================
-- STEP 2 — COMPOSITE REFERENCED KEYS, DEFINITION-AWARE
--
-- PostgreSQL resolves a composite FK against a unique key on EXACTLY the
-- referenced column pair. A unique key on `id` alone does NOT satisfy a
-- reference to (company_id, id), and content_source_ref_uidx is PARTIAL AND
-- expression-based, so it cannot serve.
--
-- Uniqueness of (company_id, id) follows from `id` already being unique. That
-- premise is ASSERTED, not assumed: FIX3-PRECOND-20 for public.content and
-- FIX3-SHAPE-07 for the four target tables. So ADD CONSTRAINT ... UNIQUE cannot
-- fail on existing rows — except in the one case SHAPE-07 also admits, where a
-- usable key on {company_id, id} already exists, in which case nothing is added
-- at all.
--
-- Detection accepts ANY usable unique key on {company_id, id}, whatever its
-- name, so an equivalent key added earlier is reused rather than duplicated.
-- ===========================================================================
DO $$
DECLARE
  spec        record;
  r_tbl       regclass;
  a_company   smallint;
  a_id        smallint;
  has_key     boolean;
  n_samename  int;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.content',       'content_company_id_key'),
      ('public.content_block', 'content_block_company_id_key')
    ) AS v(tbl, keyname)
  LOOP
    r_tbl := to_regclass(spec.tbl);
    IF r_tbl IS NULL THEN
      RAISE EXCEPTION 'FIX3-KEY-01: % is absent at STEP 2.', spec.tbl;
    END IF;

    SELECT attnum INTO a_company FROM pg_attribute
      WHERE attrelid = r_tbl AND attname = 'company_id' AND attnum > 0 AND NOT attisdropped;
    SELECT attnum INTO a_id FROM pg_attribute
      WHERE attrelid = r_tbl AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
    IF a_company IS NULL OR a_id IS NULL THEN
      RAISE EXCEPTION 'FIX3-KEY-02: % lacks company_id or id.', spec.tbl;
    END IF;

    -- `indkey` lists KEY columns followed by INCLUDE columns, so a unique index
    -- with key (company_id, id) INCLUDE (…) has indnkeyatts = 2 but a LONGER
    -- indkey. The comparison is restricted to the first `indnkeyatts` entries,
    -- which is also exactly how PostgreSQL decides FK-target suitability.
    -- It is order-insensitive because PostgreSQL resolves a composite foreign
    -- key against the referenced index's key columns as a SET. Every other
    -- suitability property is required explicitly.
    SELECT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = r_tbl
        AND i.indisunique AND i.indimmediate AND i.indisvalid
        AND i.indisready AND i.indislive
        AND i.indpred   IS NULL        -- must not be partial
        AND i.indexprs  IS NULL        -- must not be an expression index
        AND i.indnkeyatts = 2
        AND (SELECT array_agg(t.attnum ORDER BY t.attnum)
               FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                      WITH ORDINALITY AS t(attnum, ord)
              WHERE t.ord <= i.indnkeyatts)      -- KEY columns only; INCLUDE excluded
            = (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[a_company, a_id]) k)
    ) INTO has_key;

    IF has_key THEN
      RAISE NOTICE 'FIX3 STEP 2: % already has a usable unique key on (company_id, id) — reused. A reused BARE unique index leaves no constraint named %, so the companion verification script accepts either form.', spec.tbl, spec.keyname;
      CONTINUE;
    END IF;

    SELECT count(*) INTO n_samename FROM pg_constraint
      WHERE conrelid = r_tbl AND conname = spec.keyname;
    IF n_samename > 0 THEN
      RAISE EXCEPTION
        'FIX3-KEY-03: constraint % already exists on % but does NOT provide the required non-partial unique key on (company_id, id). Resolve manually; this migration will not drop it.',
        spec.keyname, spec.tbl;
    END IF;
    -- ADD CONSTRAINT ... UNIQUE also creates an INDEX of that name, so a bare
    -- index (or any other relation) squatting on the name collides in pg_class,
    -- which pg_constraint does not show.
    IF to_regclass('public.' || quote_ident(spec.keyname)) IS NOT NULL THEN
      RAISE EXCEPTION
        'FIX3-KEY-04: a relation named public.% already exists (an index or table, not a constraint), so ADD CONSTRAINT % UNIQUE would collide with it. Resolve manually.',
        spec.keyname, spec.keyname;
    END IF;

    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I UNIQUE (company_id, id)', spec.tbl, spec.keyname);
    RAISE NOTICE 'FIX3 STEP 2: added % on %.', spec.keyname, spec.tbl;
  END LOOP;
END $$;


-- ===========================================================================
-- STEP 3 — APPROVAL-HISTORY NULLABILITY (DECISION C)
--
-- DROP NOT NULL never fails on data and loses no information; it only widens the
-- domain. It must happen BEFORE STEP 4, because ON DELETE SET NULL (content_id)
-- against a NOT NULL column is accepted at ADD CONSTRAINT time and then fails at
-- the first content DELETE — a latent runtime failure rather than an apply-time
-- one.
--
-- WHAT THIS CHECKS, precisely: only pg_attribute.attnotnull. It does NOT verify
-- that no CHECK constraint, trigger or rule independently requires this column
-- to be non-null; such a constraint would leave the column nullable in the
-- catalog yet still reject the nulling UPDATE at DELETE time. That residual is
-- recorded in the report as an open item, not claimed as covered.
-- ===========================================================================
DO $$
DECLARE
  r_tbl     regclass := to_regclass('public.content_approval_history');
  v_notnull boolean;
BEGIN
  IF r_tbl IS NULL THEN
    RAISE EXCEPTION 'FIX3-NULL-01: public.content_approval_history is absent at STEP 3.';
  END IF;
  SELECT attnotnull INTO v_notnull FROM pg_attribute
    WHERE attrelid = r_tbl AND attname = 'content_id' AND attnum > 0 AND NOT attisdropped;
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION 'FIX3-NULL-02: public.content_approval_history.content_id is absent.';
  END IF;
  IF v_notnull THEN
    ALTER TABLE public.content_approval_history ALTER COLUMN content_id DROP NOT NULL;
    RAISE NOTICE 'FIX3 STEP 3: dropped NOT NULL on content_approval_history.content_id.';
  ELSE
    RAISE NOTICE 'FIX3 STEP 3: content_approval_history.content_id already nullable.';
  END IF;
END $$;


-- ===========================================================================
-- STEP 4 — FOREIGN-KEY RECONCILIATION: CENSUS FIRST, THEN ACT
--
-- WHY THE STRUCTURE CHANGED. An earlier version tested for the intended
-- composite FK first and, on finding it, executed `CONTINUE`. That jumped past
-- the legacy-FK check and the unexpected-FK counter, so whenever the intended
-- FK already existed NO OTHER foreign key on that child -> parent pair was ever
-- examined. A surviving legacy ON DELETE CASCADE on content_approval_history
-- would then cascade-delete audit rows while the migration reported
-- "already has the intended FK — reused" and COMMITted: DECISION C silently
-- false on a green run. It was the only fail-OPEN path in this file.
--
-- THE STRUCTURE NOW. For each spec a full CENSUS of every foreign key from the
-- child to the parent is taken FIRST and every class is counted. Only then does
-- anything act. There is no early exit before the census, so an existing
-- intended FK can never mask a legacy or competing constraint.
--
-- CLASSES AND OUTCOMES
--   INTENDED   conkey = the intended columns in order, confkey = (company_id,
--              id) in order, and every property matching: confdeltype,
--              confupdtype = 'a', confmatchtype = 's', convalidated, not
--              deferrable, not deferred, and confdelsetcols exactly the
--              intended set-null column list (required NULL for the CASCADE
--              specs). More than one -> FK-04.
--   SAME-COLS  on the intended columns but not fully compatible -> FK-05, with
--              every actual and expected property printed. Never dropped.
--   REORDERED  the same columns as a SET but a different order -> FK-05, named
--              as an ordering difference. Never dropped.
--   LEGACY     exactly the single legacy column. Dropped ONLY after its own
--              relation, columns, update action, match type, validation state
--              and deferrability are verified AND its delete action is one this
--              spec explicitly authorizes. More than one -> FK-06.
--   OTHER      any other column list -> FK-07. Never dropped.
--
-- THE AUTHORIZED DELETE-ACTION TRANSITIONS (`legacy_ok`) ARE THE POINT OF H2.
-- The frozen predecessor declares all four legacy FKs ON DELETE CASCADE. Three
-- specs intend CASCADE, so 'c' -> 'c' is a no-op replacement. The fourth,
-- content_approval_history, intends SET NULL (content_id): that 'c' -> 'n'
-- transition IS DECISION C, so it is listed as authorized. An earlier version
-- compared the actions with a bare inequality, which refused exactly that
-- transition and made this file unapplicable on any database carrying the
-- predecessor. 'n' is also authorized there because a single-column
-- ON DELETE SET NULL on content_id alone is already equivalent in effect.
-- Any OTHER legacy delete action — NO ACTION or RESTRICT, i.e. a deliberate
-- retention guard — is REFUSED, which is what the guard was for.
--
-- CLASSIFICATION TRUTH TABLE. Every foreign key from the child to the spec'd
-- parent is intended to fall into exactly one column. The predicates are
-- disjoint by construction; the totals reconciliation below does not prove that
-- disjointness, it detects a NET accounting discrepancy at run time — see the
-- note at that check for exactly what it does and does not establish.
--
-- SCOPE OF THE TRUTH TABLE. It covers foreign keys from the child to the
-- spec'd PARENT only, because that is the pair each census is scoped to. A
-- foreign key from one of these tables to any OTHER table is outside every row
-- below; the whole-population reconciliation at the end of this step is what
-- covers it, and it fails closed (FK-13 / FK-14 / FK-15, with FK-16 for an
-- absent child table).
--
--   existing FK on the pair                         | class      | outcome
--   ------------------------------------------------+------------+-----------------
--   intended cols+confkey, all properties match     | INTENDED   | reused, no DDL
--   two of those                                    | INTENDED×2 | FK-04 raise
--   intended cols, any property differs             | SAME-COLS  | FK-05 raise
--     …including confdelsetcols NULL vs a column    | SAME-COLS  | FK-05 raise
--       list (the NULL-COLUMN-LIST case: previously |            | (was: counted
--       this fell into NO class and the migration    |            |  nowhere →
--       silently added a second FK)                 |            |  fail-open)
--   same cols as a SET, different ORDER             | REORDERED  | FK-05 raise
--   exactly the legacy single column, action in     | LEGACY     | verified in
--     legacy_ok, confkey = parent.id, update/match/ |            | full, then
--     validated/deferrability all as expected       |            | dropped
--   legacy column, action NOT in legacy_ok          | LEGACY     | FK-10 raise
--   legacy column, other property differs          | LEGACY     | FK-11 raise
--   legacy column, confkey ≠ parent.id              | LEGACY     | FK-11 raise
--   two single-column FKs on the legacy column      | LEGACY×2   | FK-06 raise
--   any other column list (UNRELATED)               | OTHER      | FK-07 raise
--   counts do not sum to the total on the pair      | —          | FK-12 raise
--   any FK at all on content_quality, WHILE its spec | —          | FK-13 raise
--     still models no parent (expected = 0 and an    |            |
--     empty parent list). If that spec ever changes, |            |
--     the same catalog state is FK-14/FK-15's, not   |            |
--     FK-13's — the guard tests both so its          |            |
--     table-specific message cannot fire on a state  |            |
--     the spec declares valid.                       |            |
--   an FK to a table not modelled for this child    | —          | FK-14 raise
--   per-table FK total ≠ the intended count         | —          | FK-15 raise
--   a modelled CHILD TABLE is absent at that loop   | —          | FK-16 raise
--     (a missing relation, not an unexpected FK —   |            |
--      FK-16 and FK-14 are deliberately distinct)   |            |
--
-- ADD CONSTRAINT ... FOREIGN KEY validates existing rows. On a populated legacy
-- table a cross-tenant or orphaned pair makes the ADD fail (23503) and aborts
-- the transaction. That is deliberate: no row is ever deleted or rewritten to
-- force a constraint through. The drop of the legacy FK and the creation of the
-- composite one are in this one transaction, so they are atomic.
--
-- confdelsetcols and the ON DELETE SET NULL column list require PostgreSQL >= 15,
-- asserted by FIX3-PRECOND-00.
-- ===========================================================================
DO $$
DECLARE
  spec        record;
  r_child     regclass;
  r_parent    regclass;
  a_child     smallint[];
  a_parent    smallint[];
  a_setcols   smallint[];
  a_legacy    smallint[];
  n_intended  int;
  n_samecols  int;
  n_reordered int;
  n_legacy    int;
  n_other     int;
  n_total     int;
  legacy_name text;
  legacy_del  "char";
  legacy_upd  "char";
  legacy_mat  "char";
  legacy_val  boolean;
  legacy_dfr  boolean;
  legacy_dfd  boolean;
  legacy_def  text;
  legacy_fkey smallint[];
  a_parent_id smallint[];
  v_bad       record;
  v_sql       text;
  -- Whole-population reconciliation (see the end of this block).
  tspec        record;
  r_tbl        regclass;
  v_parents    oid[];
  n_unmodelled int;
  n_fk_total   int;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.content_block',            'public.content',       ARRAY['company_id','content_id'], 'content_id', 'c', NULL::text,   'content_block_content_fk',            ARRAY['c']),
      ('public.content_recommendation',   'public.content',       ARRAY['company_id','content_id'], 'content_id', 'c', NULL::text,   'content_recommendation_content_fk',   ARRAY['c']),
      ('public.content_recommendation',   'public.content_block', ARRAY['company_id','block_id'],   'block_id',   'c', NULL::text,   'content_recommendation_block_fk',     ARRAY['c']),
      ('public.content_approval_history', 'public.content',       ARRAY['company_id','content_id'], 'content_id', 'n', 'content_id', 'content_approval_history_content_fk', ARRAY['c','n'])
    ) AS v(child, parent, childcols, legacycol, deltype, setcols, fkname, legacy_ok)
  LOOP
    -- Spec sanity, checked on the spec itself before any string is built.
    IF spec.deltype NOT IN ('c','n') THEN
      RAISE EXCEPTION 'FIX3-FK-09: unsupported delete action % for %.', spec.deltype, spec.fkname;
    END IF;
    IF spec.deltype = 'n' AND spec.setcols IS NULL THEN
      RAISE EXCEPTION 'FIX3-FK-09: delete action SET NULL for % requires a column list; a bare SET NULL would null company_id (NOT NULL) and make the content DELETE fail.', spec.fkname;
    END IF;

    r_child  := to_regclass(spec.child);
    r_parent := to_regclass(spec.parent);
    IF r_child IS NULL OR r_parent IS NULL THEN
      RAISE EXCEPTION 'FIX3-FK-01: % or % absent at STEP 4.', spec.child, spec.parent;
    END IF;

    SELECT array_agg(a.attnum ORDER BY x.ord) INTO a_child
      FROM unnest(spec.childcols) WITH ORDINALITY AS x(cname, ord)
      JOIN pg_attribute a ON a.attrelid = r_child AND a.attname = x.cname
                         AND a.attnum > 0 AND NOT a.attisdropped;
    IF a_child IS NULL OR array_length(a_child,1) <> array_length(spec.childcols,1) THEN
      RAISE EXCEPTION 'FIX3-FK-02: % is missing one of the referencing columns %.', spec.child, spec.childcols;
    END IF;

    SELECT array_agg(a.attnum ORDER BY x.ord) INTO a_parent
      FROM unnest(ARRAY['company_id','id']) WITH ORDINALITY AS x(cname, ord)
      JOIN pg_attribute a ON a.attrelid = r_parent AND a.attname = x.cname
                         AND a.attnum > 0 AND NOT a.attisdropped;
    IF a_parent IS NULL OR array_length(a_parent,1) <> 2 THEN
      RAISE EXCEPTION 'FIX3-FK-03: % lacks company_id or id.', spec.parent;
    END IF;

    IF spec.setcols IS NULL THEN
      a_setcols := NULL;
    ELSE
      SELECT array_agg(a.attnum) INTO a_setcols FROM pg_attribute a
        WHERE a.attrelid = r_child AND a.attname = spec.setcols
          AND a.attnum > 0 AND NOT a.attisdropped;
      IF a_setcols IS NULL THEN
        RAISE EXCEPTION 'FIX3-FK-02: % is missing the SET NULL column %.', spec.child, spec.setcols;
      END IF;
    END IF;

    SELECT COALESCE(array_agg(a.attnum), ARRAY[]::smallint[]) INTO a_legacy
      FROM pg_attribute a
      WHERE a.attrelid = r_child AND a.attname = spec.legacycol
        AND a.attnum > 0 AND NOT a.attisdropped;

    -- ---------------- CENSUS: classify EVERY FK child -> parent -----------
    --
    -- NULL SAFETY. The confdelsetcols comparison below uses
    -- `IS NOT DISTINCT FROM`, not an `IS NULL`/`=` disjunction. The earlier
    -- disjunction was NULL-UNSAFE and FAIL-OPEN: for the SET NULL spec
    -- `a_setcols` is non-NULL, so against an existing FK whose
    -- `confdelsetcols IS NULL` (a bare `ON DELETE SET NULL`) the first branch
    -- was FALSE and the second was `TRUE AND NULL` = NULL, making the whole
    -- term NULL. A `count(*) FILTER` counts only rows whose predicate is TRUE,
    -- so that constraint was counted in NEITHER the intended class NOR the
    -- incompatible class, and the `conkey <> a_child` classes excluded it too.
    -- Every counter came back zero, nothing was dropped, and a SECOND composite
    -- FK was added whose bare SET NULL would null the NOT NULL company_id —
    -- making public.content undeletable (23502) on a green apply.
    -- `IS NOT DISTINCT FROM` is three-valued-logic-free: it returns TRUE or
    -- FALSE and never NULL, so the row always lands in exactly one class.
    --
    -- The TOTALS RECONCILIATION after this query is the structural backstop:
    -- the five classes must account for every FK row on the pair. Any future
    -- classification gap becomes a named, fail-closed error instead of a
    -- silent zero.
    SELECT
      count(*) FILTER (WHERE k.conkey = a_child
                         AND k.confkey = a_parent
                         AND k.confdeltype   = spec.deltype
                         AND k.confupdtype   = 'a'
                         AND k.confmatchtype = 's'
                         AND k.convalidated
                         AND NOT k.condeferrable
                         AND NOT k.condeferred
                         AND k.confdelsetcols IS NOT DISTINCT FROM a_setcols),
      count(*) FILTER (WHERE k.conkey = a_child
                         AND NOT ( k.confkey = a_parent
                               AND k.confdeltype   = spec.deltype
                               AND k.confupdtype   = 'a'
                               AND k.confmatchtype = 's'
                               AND k.convalidated
                               AND NOT k.condeferrable
                               AND NOT k.condeferred
                               AND k.confdelsetcols IS NOT DISTINCT FROM a_setcols )),
      count(*) FILTER (WHERE k.conkey <> a_child
                         AND (SELECT array_agg(x ORDER BY x) FROM unnest(k.conkey) x)
                           = (SELECT array_agg(x ORDER BY x) FROM unnest(a_child) x)),
      count(*) FILTER (WHERE array_length(a_legacy,1) = 1 AND k.conkey = a_legacy),
      count(*) FILTER (WHERE k.conkey <> a_child
                         AND (SELECT array_agg(x ORDER BY x) FROM unnest(k.conkey) x)
                          <> (SELECT array_agg(x ORDER BY x) FROM unnest(a_child) x)
                         AND k.conkey <> COALESCE(a_legacy, ARRAY[]::smallint[])),
      count(*)
      INTO n_intended, n_samecols, n_reordered, n_legacy, n_other, n_total
      FROM pg_constraint k
      WHERE k.conrelid = r_child AND k.contype = 'f' AND k.confrelid = r_parent;

    -- ---------------- TOTALS RECONCILIATION (structural backstop) ---------
    -- The five class counts must SUM to the number of foreign keys on this
    -- pair. The dangerous direction is a row in no class at all: that would let
    -- the branches below read "nothing to see" from a set of zeroes, which is
    -- the fail-open shape this check exists to turn into a named error.
    --
    -- WHAT THIS DOES NOT PROVE. A sum equality is not a proof of partition. Two
    -- offsetting mistakes — one row counted twice in one class and another
    -- counted in none — cancel and pass this check. It detects a NET
    -- discrepancy, which is what an accidental classification gap produces; it
    -- is not a uniqueness proof over the classes. The classes are written to be
    -- mutually exclusive by construction (the predicates are disjoint on
    -- `conkey`, and within the intended columns on full-compatibility), and
    -- that exclusivity rests on reading those predicates, not on this check.
    IF n_intended + n_samecols + n_reordered + n_legacy + n_other <> n_total THEN
      RAISE EXCEPTION
        'FIX3-FK-12: the FK census for % -> % does not account for every constraint: intended=%, same-columns=%, reordered=%, legacy=%, other=% sum to %, but % foreign key(s) exist on that pair. A constraint fell into no class or into two, so this migration cannot reason about the schema. Refusing to proceed; resolve manually. Constraints: %',
        spec.child, spec.parent, n_intended, n_samecols, n_reordered, n_legacy, n_other,
        n_intended + n_samecols + n_reordered + n_legacy + n_other, n_total,
        COALESCE((SELECT string_agg(k.conname || ' => ' || pg_get_constraintdef(k.oid), ' | ')
                    FROM pg_constraint k
                   WHERE k.conrelid = r_child AND k.contype = 'f' AND k.confrelid = r_parent), '(none)');
    END IF;

    -- ---------------- PATHOLOGIES: raise before acting -------------------
    IF n_intended > 1 THEN
      RAISE EXCEPTION 'FIX3-FK-04: % carries % duplicate fully-compatible FKs to %. Resolve manually.',
        spec.child, n_intended, spec.parent;
    END IF;

    IF n_samecols > 0 THEN
      -- The picker must EXCLUDE the fully-compatible constraint. An earlier
      -- version selected on `conkey = a_child` alone and ordered by name, so
      -- when a correct FK coexisted with an incompatible duplicate on the same
      -- columns it could name and print the CORRECT one — against an
      -- "Expected:" clause identical to the actual values, a self-contradictory
      -- message pointing the operator at the constraint that must be kept.
      SELECT k.conname, k.confdeltype, k.confupdtype, k.confmatchtype, k.convalidated,
             k.condeferrable, k.condeferred, k.conkey, k.confkey, k.confdelsetcols,
             pg_get_constraintdef(k.oid) AS def
        INTO v_bad
        FROM pg_constraint k
        WHERE k.conrelid = r_child AND k.contype = 'f' AND k.confrelid = r_parent
          AND k.conkey = a_child
          AND NOT ( k.confkey = a_parent
                AND k.confdeltype   = spec.deltype
                AND k.confupdtype   = 'a'
                AND k.confmatchtype = 's'
                AND k.convalidated
                AND NOT k.condeferrable
                AND NOT k.condeferred
                AND k.confdelsetcols IS NOT DISTINCT FROM a_setcols )
        ORDER BY k.conname LIMIT 1;
      RAISE EXCEPTION
        'FIX3-FK-05: % has an FK (%) on the intended referencing columns to %, but it is NOT fully compatible. Actual: confkey=%, on_delete=%, on_update=%, match=%, validated=%, deferrable=%, deferred=%, delsetcols=%. Expected: confkey=%, on_delete=%, on_update=a, match=s, validated=true, deferrable=false, deferred=false, delsetcols=%. Definition: %. Refusing to drop it; resolve manually.',
        spec.child, v_bad.conname, spec.parent,
        v_bad.confkey, v_bad.confdeltype, v_bad.confupdtype, v_bad.confmatchtype,
        v_bad.convalidated, v_bad.condeferrable, v_bad.condeferred,
        COALESCE(v_bad.confdelsetcols::text,'NULL'),
        a_parent, spec.deltype, COALESCE(a_setcols::text,'NULL'), v_bad.def;
    END IF;

    IF n_reordered > 0 THEN
      RAISE EXCEPTION
        'FIX3-FK-05: % has an FK to % on the same referencing columns as % but in a DIFFERENT ORDER. PostgreSQL would treat it as equivalent, but this migration compares column lists in order and will not drop it. Resolve manually (expected order %).',
        spec.child, spec.parent, spec.fkname, spec.childcols;
    END IF;

    IF n_other > 0 THEN
      RAISE EXCEPTION 'FIX3-FK-07: % has % unexpected FK(s) to % on other columns. Refusing to proceed.',
        spec.child, n_other, spec.parent;
    END IF;

    IF n_legacy > 1 THEN
      RAISE EXCEPTION 'FIX3-FK-06: % has % single-column FKs on %.% to %. Ambiguous; resolve manually.',
        spec.child, n_legacy, spec.child, spec.legacycol, spec.parent;
    END IF;

    -- ---------------- LEGACY: verify in full, then drop ------------------
    IF n_legacy = 1 THEN
      SELECT k.conname, k.confdeltype, k.confupdtype, k.confmatchtype,
             k.convalidated, k.condeferrable, k.condeferred, k.confkey,
             pg_get_constraintdef(k.oid)
        INTO legacy_name, legacy_del, legacy_upd, legacy_mat,
             legacy_val, legacy_dfr, legacy_dfd, legacy_fkey, legacy_def
        FROM pg_constraint k
        WHERE k.conrelid = r_child AND k.contype = 'f' AND k.confrelid = r_parent
          AND k.conkey = a_legacy;

      -- REFERENCED COLUMNS are verified too. An earlier version checked the
      -- legacy constraint's relation, referencing column and actions but never
      -- its `confkey`, so the DECISION C authorization would also have covered
      -- a single-column FK pointing at some OTHER single-column unique key of
      -- the parent. The predecessor references the parent's id, and nothing
      -- else is an authorized replacement target.
      SELECT array_agg(a.attnum) INTO a_parent_id
        FROM pg_attribute a
        WHERE a.attrelid = r_parent AND a.attname = 'id'
          AND a.attnum > 0 AND NOT a.attisdropped;
      IF legacy_fkey IS DISTINCT FROM a_parent_id THEN
        RAISE EXCEPTION
          'FIX3-FK-11: the legacy single-column FK % on %.% references column(s) % of %, not its id (%). This migration only authorizes replacing the predecessor''s FK to the parent''s id. Refusing; resolve manually. Definition: %.',
          legacy_name, spec.child, spec.legacycol, legacy_fkey::text, spec.parent,
          COALESCE(a_parent_id::text,'NULL'), legacy_def;
      END IF;

      IF NOT (legacy_del::text = ANY (spec.legacy_ok)) THEN
        RAISE EXCEPTION
          'FIX3-FK-10: the legacy single-column FK % on %.% has ON DELETE ''%''. This spec authorizes replacing only %, because those are the predecessor''s own action and (where DECISION C applies) the intended one. Replacing any other action would silently change delete semantics — for example turning a retention guard into a cascade. Refusing; resolve manually. Definition: %.',
          legacy_name, spec.child, spec.legacycol, legacy_del, spec.legacy_ok::text, legacy_def;
      END IF;

      IF legacy_upd <> 'a' OR legacy_mat <> 's' OR NOT legacy_val
         OR legacy_dfr OR legacy_dfd THEN
        RAISE EXCEPTION
          'FIX3-FK-11: the legacy single-column FK % on %.% has properties this migration will not replace blindly: on_update=% (expected a), match=% (expected s), validated=% (expected true), deferrable=%, deferred=% (both expected false). RESTRICT and NO ACTION on update are NOT equivalent, and a deferrable constraint changes when violations surface. Refusing; resolve manually. Definition: %.',
          legacy_name, spec.child, spec.legacycol, legacy_upd, legacy_mat,
          legacy_val, legacy_dfr, legacy_dfd, legacy_def;
      END IF;

      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', spec.child, legacy_name);
      RAISE NOTICE 'FIX3 STEP 4: dropped legacy single-column FK % on % — authorized transition ON DELETE ''%'' -> ''%''. Replaced definition was: %',
        legacy_name, spec.child, legacy_del, spec.deltype, legacy_def;
    END IF;

    -- ---------------- INTENDED: add it if absent --------------------------
    IF n_intended = 1 THEN
      RAISE NOTICE 'FIX3 STEP 4: % already has the intended FK to % (all properties match) — reused. Every other FK on this pair was examined first.',
        spec.child, spec.parent;
    ELSE
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r_child AND conname = spec.fkname) THEN
        RAISE EXCEPTION 'FIX3-FK-08: constraint % already exists on % with an unrecognised definition. Resolve manually.', spec.fkname, spec.child;
      END IF;
      v_sql := format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (company_id, id) ON DELETE %s',
        spec.child, spec.fkname,
        (SELECT string_agg(quote_ident(c), ', ' ORDER BY x.ord)
           FROM unnest(spec.childcols) WITH ORDINALITY AS x(c, ord)),
        spec.parent,
        CASE spec.deltype WHEN 'c' THEN 'CASCADE'
                          WHEN 'n' THEN 'SET NULL (' || quote_ident(spec.setcols) || ')' END
      );
      EXECUTE v_sql;
      RAISE NOTICE 'FIX3 STEP 4: added % on %.', spec.fkname, spec.child;
    END IF;
  END LOOP;

  -- ---------------- WHOLE-POPULATION RECONCILIATION (H-2) ----------------
  --
  -- WHY THIS EXISTS. Every census in the loop above is scoped to ONE
  -- child -> parent pair (`k.confrelid = r_parent`), and FIX3-FK-12's total is
  -- scoped the same way. A foreign key from one of these tables to ANY OTHER
  -- table therefore fell outside the examined population altogether: not
  -- classified, not counted, not reported. An ON DELETE CASCADE from
  -- content_approval_history to an archive or audit table is the concrete shape
  -- of that gap — it would survive untouched and undisclosed while this file
  -- reported success. That is the same fail-open class the census restructure
  -- was written to remove, one scope level up.
  --
  -- WHAT IS ASSERTED. For each of the four tables this migration owns, the
  -- population is EVERY foreign key on the table, regardless of which table it
  -- references. Each one must reference a parent this migration models FOR THAT
  -- TABLE; anything else is named and refused (FK-14). The per-table total must
  -- then equal the number of foreign keys this migration intends, so an extra
  -- constraint on an already-modelled pair, or a missing intended one, is also
  -- refused (FK-15). The totals are the ones the companion verification script
  -- asserts, so the two now examine the same population and claim the same
  -- numbers.
  --
  -- content_quality is in this list with an EMPTY parent set and an expected
  -- total of 0. That replaces the narrower predecessor of this check, which
  -- looked only for a foreign key to public.content and was therefore blind to
  -- a foreign key from content_quality to anything else — while the
  -- verification script asserts the table is foreign-key-free. FK-13 keeps its
  -- own identifier and message there because content_quality's emptiness is an
  -- OWNER DECISION (content_id is a soft reference), not a modelling omission.
  --
  -- THE FOUR IDENTIFIERS THIS LOOP RAISES, each one condition and one only:
  --   FK-13  content_quality carries any foreign key at all (owner decision).
  --   FK-14  a foreign key referencing a parent not modelled for that child.
  --   FK-15  the per-table foreign-key total is not the intended count.
  --   FK-16  a modelled child TABLE is absent — a missing relation, which is a
  --          different failure from an unexpected foreign key and therefore a
  --          different identifier. FK-14 and FK-16 were briefly the same one.
  --
  -- Nothing is dropped here. An unexpected foreign key is reported with its
  -- deparsed definition and its referenced table, and this file refuses.
  FOR tspec IN
    SELECT * FROM (VALUES
      ('public.content_block',            ARRAY['public.content'],                        1),
      ('public.content_recommendation',   ARRAY['public.content','public.content_block'],  2),
      ('public.content_approval_history', ARRAY['public.content'],                        1),
      ('public.content_quality',          ARRAY[]::text[],                                0)
    ) AS v(child, parents, expected)
  LOOP
    r_tbl := to_regclass(tspec.child);
    IF r_tbl IS NULL THEN
      -- FK-16, not FK-14: a MISSING RELATION, not an unexpected foreign key.
      -- The two were briefly given the same identifier, which sent an operator
      -- grepping a runbook to the wrong remediation.
      RAISE EXCEPTION 'FIX3-FK-16: % is absent at the whole-population reconciliation, although STEP 1 must have produced it. This is a missing RELATION, not an unexpected foreign key; FK-14 is the unmodelled-parent condition.', tspec.child;
    END IF;

    -- ---- THE CENSUS'S SCOPE, MADE EXPLICIT (FK-17) ----
    --
    -- Every count in this loop is `pg_constraint.conrelid = r_tbl`: the
    -- constraints recorded against THIS relation's oid. That is a complete
    -- population for an ordinary table and an INCOMPLETE one for a partitioned
    -- table, where a partition-local foreign key is recorded against the
    -- PARTITION's oid instead and is therefore invisible here — while the
    -- messages above state a total and call it the whole population.
    --
    -- Rather than widen the query to pg_inherits and then have to reason about
    -- which inherited constraints are local and which are cloned from the
    -- parent, this ASSERTS THE PRECONDITION under which the simple scope is
    -- provably complete: the relation is an ordinary table with no inheritance
    -- children and no inheritance parent. STEP 1 of this file creates all four
    -- that way, so this holds for anything this file produced. If a target has
    -- partitioned or inherited one of them, that is a schema this file does not
    -- model anywhere — not here, not in the trigger census, not in the policy
    -- checks — and failing closed with the requirement named is the honest
    -- outcome.
    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = r_tbl AND c.relkind <> 'r') THEN
      RAISE EXCEPTION
        'FIX3-FK-17: % is not an ordinary table (relkind %), so this step''s foreign-key census — which reads pg_constraint.conrelid for this relation alone — is not a complete population for it. A partition-local foreign key is recorded against the partition, not the parent, and would be invisible to every count below. VALIDATION REQUIREMENT: either this relation is an ordinary unpartitioned table, or the census must be rewritten to walk pg_inherits and classify local versus cloned constraints, and the companion verification script with it. Resolve manually.',
        tspec.child, (SELECT c.relkind FROM pg_class c WHERE c.oid = r_tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = r_tbl OR inhrelid = r_tbl) THEN
      RAISE EXCEPTION
        'FIX3-FK-17: % takes part in an inheritance or partitioning hierarchy (pg_inherits), so the conrelid-scoped foreign-key census below is not a complete population for it. VALIDATION REQUIREMENT: as for the relkind condition above. Resolve manually.',
        tspec.child;
    END IF;

    -- The modelled parents, resolved to oids. A parent that does not exist
    -- cannot be referenced by anything, so a NULL resolution is simply dropped
    -- from the set; the expected-total check below still has to hold. An empty
    -- set is intended: `confrelid = ANY (ARRAY[]::oid[])` is FALSE, never NULL,
    -- so every foreign key on such a table counts as unmodelled.
    SELECT COALESCE(array_agg(t.o), ARRAY[]::oid[]) INTO v_parents
      FROM (SELECT to_regclass(p.name)::oid AS o
              FROM unnest(tspec.parents) AS p(name)) t
     WHERE t.o IS NOT NULL;

    SELECT count(*) FILTER (WHERE NOT (k.confrelid = ANY (v_parents))),
           count(*)
      INTO n_unmodelled, n_fk_total
      FROM pg_constraint k
     WHERE k.conrelid = r_tbl AND k.contype = 'f';

    -- content_quality first, so its refusal carries the owner-decision reason
    -- rather than the generic unmodelled-parent wording.
    --
    -- THE CONDITION TESTS THE TABLE **AND** THE MODELLED STATE, and it has to
    -- test both. Keying on `expected = 0` alone sent a future zero-expectation
    -- row a sentence about content_quality. Keying on the TABLE alone opened the
    -- mirror fault: if the owner ever reverses the soft-reference decision and
    -- this spec row becomes ('public.content_quality', ARRAY['public.content'],
    -- 1), then on a CORRECT catalog state carrying exactly that one intended
    -- foreign key this guard would fire and announce that the migration "models
    -- none for it" — refusing a valid state, with FK-14 and FK-15 unreachable
    -- behind it. The message is only true while the spec still models nothing
    -- for the table, so the condition asserts exactly that.
    IF tspec.child = 'public.content_quality' AND tspec.expected = 0
       AND array_length(tspec.parents, 1) IS NULL AND n_fk_total > 0 THEN
      RAISE EXCEPTION
        'FIX3-FK-13: % carries % foreign key(s), but this migration models none for it: content_quality.content_id is a SOFT reference by owner decision, and the companion verification script asserts the table is foreign-key-free. Refusing to remove them; resolve manually, or raise the owner decision to adopt a foreign key. Constraints: %',
        tspec.child, n_fk_total,
        COALESCE((SELECT string_agg(k.conname || ' -> ' || k.confrelid::regclass::text || ' => ' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname)
                    FROM pg_constraint k
                   WHERE k.conrelid = r_tbl AND k.contype = 'f'), '(none)');
    END IF;

    IF n_unmodelled > 0 THEN
      RAISE EXCEPTION
        'FIX3-FK-14: % carries % foreign key(s) referencing table(s) this migration does not model for it. The modelled parents are %. An unmodelled parent is never classified by the per-pair census above, so this file cannot reason about the delete semantics that constraint imposes. Refusing to remove it; resolve manually, or extend the spec. Constraints: %',
        tspec.child, n_unmodelled, tspec.parents,
        COALESCE((SELECT string_agg(k.conname || ' -> ' || k.confrelid::regclass::text || ' => ' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname)
                    FROM pg_constraint k
                   WHERE k.conrelid = r_tbl AND k.contype = 'f'
                     AND NOT (k.confrelid = ANY (v_parents))), '(none)');
    END IF;

    IF n_fk_total <> tspec.expected THEN
      RAISE EXCEPTION
        'FIX3-FK-15: % carries % foreign key(s), but this migration intends exactly %. Every one of them references a modelled parent, so this is either a surplus constraint on a pair the census already examined or an intended constraint that is missing after STEP 4. Refusing to proceed; resolve manually. Constraints: %',
        tspec.child, n_fk_total, tspec.expected,
        COALESCE((SELECT string_agg(k.conname || ' -> ' || k.confrelid::regclass::text || ' => ' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname)
                    FROM pg_constraint k
                   WHERE k.conrelid = r_tbl AND k.contype = 'f'), '(none)');
    END IF;

    RAISE NOTICE 'FIX3 STEP 4: % reconciled against its whole foreign-key population — % of % expected, every one to a modelled parent (%).',
      tspec.child, n_fk_total, tspec.expected, tspec.parents;
  END LOOP;
END $$;



-- ===========================================================================
-- STEP 4b — AUDIT PRESERVATION IS NOT A FOREIGN-KEY PROPERTY ALONE
--
-- WHY THIS EXISTS. Everything STEP 4 establishes is about foreign keys: that
-- content_approval_history references public.content with ON DELETE SET NULL,
-- so an approval row survives the deletion of the content it describes. An
-- independent review pointed out that this file then treated that as proof that
-- deleting content cannot remove audit history — and it is not. A foreign-key
-- census says nothing about:
--
--   * a ROW-LEVEL TRIGGER that deletes audit rows itself. STEP 7 adds only
--     BEFORE UPDATE triggers, so this file never creates one — but a
--     pre-existing AFTER DELETE trigger on content, or on
--     content_approval_history, would do exactly what the FK was chosen to
--     prevent, and nothing in this file looked.
--   * a TRUNCATE trigger, which removes every row regardless of any FK.
--   * a REWRITE RULE. `pg_rewrite` was read NOWHERE in this file. A rule on
--     DELETE can turn a delete of one row into a delete of others, and a rule
--     is invisible to every constraint check here.
--   * the SCOPE of what was examined: the trigger censuses this file already
--     performs are all scoped to `tgrelid = r_block`, i.e. content_block
--     alone. The other three tables of the family — content_quality,
--     content_recommendation and content_approval_history, the audit table
--     itself — were never inspected for triggers at all.
--
-- WHAT THIS ASSERTS, and the scope it asserts it over. For EACH of the four
-- tables this migration owns, plus public.content as the parent whose deletion
-- is the event in question:
--   AUDIT-01  no non-internal trigger whose event set includes DELETE;
--   AUDIT-02  no non-internal trigger whose event set includes TRUNCATE;
--   AUDIT-03  no rewrite rule other than a view's own _RETURN.
-- Each is a catalog fact with a well-defined query. `tgisinternal` excludes the
-- triggers PostgreSQL maintains for the foreign keys this file itself adds,
-- which are the ones that IMPLEMENT ON DELETE SET NULL rather than threaten it.
--
-- WHAT IT DOES NOT ESTABLISH, stated so no reader over-reads it:
--   * It does not prove audit rows survive a delete. It proves that no trigger
--     or rule of the listed kinds exists to remove them at the moment this
--     migration runs. Something added later is outside its reach entirely.
--   * It says nothing about DELETE permissions, about RLS on the audit table,
--     or about application code that deletes audit rows directly — all three
--     are live paths that no catalog query here can see.
--   * It does not inspect triggers or rules on any OTHER table that might
--     cascade into this family. The population is the five relations named
--     below and nothing else, which is the scope the messages claim.
--   * Whether the FK's ON DELETE SET NULL itself behaves as deparsed is a
--     database behaviour this file asserts from pg_constraint and has not
--     executed. That remains unverified here, as STEP 4's own notes say.
--
-- Nothing is dropped. An unexpected trigger or rule is named with its
-- definition and this file refuses.
-- ===========================================================================
DO $$
DECLARE
  spec record;
  r_tbl regclass;
  v_bad text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('public.content'),
      ('public.content_quality'),
      ('public.content_block'),
      ('public.content_recommendation'),
      ('public.content_approval_history')
    ) AS v(tbl)
  LOOP
    r_tbl := to_regclass(spec.tbl);
    -- public.content is the only one that may legitimately be absent here:
    -- this file does not create it, and STEP 1's own guards cover the four it
    -- does. A missing relation is not an audit-preservation failure.
    CONTINUE WHEN r_tbl IS NULL;

    -- THE SAME CENSUS-SCOPE PRECONDITION FK-17 ASSERTS, applied here too.
    -- AUDIT-01/02 read `pg_trigger.tgrelid = r_tbl` and AUDIT-03 reads
    -- `pg_rewrite.ev_class = r_tbl` — one relation's own oid. On a PARTITIONED
    -- relation a trigger or rule created directly on a PARTITION carries that
    -- partition's oid and is invisible, while the messages below state the
    -- property as though the census were complete.
    --
    -- For the four tables this file owns, FK-17 already proved `relkind = 'r'`
    -- with no pg_inherits participation, and it runs in STEP 4 — before this
    -- step. public.content was the gap: PRECOND-02 deliberately accepts
    -- `relkind IN ('r','p')` for it, and nothing else constrained it. So the
    -- one relation whose deletion is the event in question was the one whose
    -- trigger census could be incomplete.
    IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = r_tbl AND c.relkind <> 'r') THEN
      RAISE EXCEPTION
        'FIX3-AUDIT-00: % is not an ordinary table (relkind %), so this step''s trigger and rule censuses — which read this relation''s own oid — are not a complete population for it. A trigger or rule on a PARTITION is recorded against the partition and would be invisible. VALIDATION REQUIREMENT: either this relation is an ordinary unpartitioned table, or the censuses must be rewritten to walk pg_inherits. Resolve manually.',
        spec.tbl, (SELECT c.relkind FROM pg_class c WHERE c.oid = r_tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = r_tbl OR inhrelid = r_tbl) THEN
      RAISE EXCEPTION
        'FIX3-AUDIT-00: % takes part in an inheritance or partitioning hierarchy (pg_inherits), so the censuses below are not a complete population for it. VALIDATION REQUIREMENT: as for the relkind condition above. Resolve manually.',
        spec.tbl;
    END IF;

    -- AUDIT-01 — DELETE triggers. tgtype bit 8 is TRIGGER_TYPE_DELETE.
    SELECT string_agg(t.tgname || ' => ' || pg_get_triggerdef(t.oid), ' | ' ORDER BY t.tgname)
      INTO v_bad
      FROM pg_trigger t
     WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal AND (t.tgtype & 8) <> 0;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        'FIX3-AUDIT-01: % carries % non-internal trigger(s) firing on DELETE. This migration''s audit-preservation reasoning rests on foreign-key delete semantics (ON DELETE SET NULL to public.content), which a DELETE trigger can bypass entirely by removing rows itself. Refusing to proceed; resolve manually. Triggers: %',
        spec.tbl,
        (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal AND (t.tgtype & 8) <> 0),
        v_bad;
    END IF;

    -- AUDIT-02 — TRUNCATE triggers. tgtype bit 32 is TRIGGER_TYPE_TRUNCATE.
    SELECT string_agg(t.tgname || ' => ' || pg_get_triggerdef(t.oid), ' | ' ORDER BY t.tgname)
      INTO v_bad
      FROM pg_trigger t
     WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal AND (t.tgtype & 32) <> 0;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        'FIX3-AUDIT-02: % carries non-internal TRUNCATE trigger(s), which remove every row irrespective of any foreign key. Refusing to proceed; resolve manually. Triggers: %',
        spec.tbl, v_bad;
    END IF;

    -- AUDIT-03 — rewrite rules. pg_rewrite was read nowhere in this file
    -- before. `_RETURN` is a view's own definition rule and is the only one
    -- that is not a rewrite of DML on a table.
    -- THE PROPERTY, NOT THE NAME. An earlier version excluded any rule called
    -- `_RETURN`. Nothing in PostgreSQL ties that NAME to the SELECT event: a
    -- non-SELECT rule carrying it would have been skipped by name alone. A
    -- view's own definition rule is identified by all three facts together —
    -- the name, `ev_type = '1'` (SELECT), and the relation actually being a
    -- view — so that is what is tested.
    SELECT string_agg(r.rulename || ' (ev_type ' || r.ev_type::text || ')', ' | ' ORDER BY r.rulename)
      INTO v_bad
      FROM pg_rewrite r
     WHERE r.ev_class = r_tbl
       AND NOT (
         r.rulename = '_RETURN'
         AND r.ev_type = '1'
         AND (SELECT c.relkind FROM pg_class c WHERE c.oid = r.ev_class) = 'v'
       );
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        'FIX3-AUDIT-03: % carries rewrite rule(s). A rule on DELETE can redirect or multiply the rows a delete removes, which no foreign-key or trigger census in this file would see. Refusing to proceed; resolve manually. Rules: %',
        spec.tbl, v_bad;
    END IF;
  END LOOP;

  -- The census that WAS performed, recorded. This is a NOTICE and not an
  -- assertion: a BEFORE UPDATE trigger is expected here (STEP 7 adds one), and
  -- naming what survives the checks above is what lets an operator see the
  -- population rather than infer it from silence.
  FOR spec IN
    SELECT v.tbl,
           COALESCE((SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname)
                       FROM pg_trigger t
                      WHERE t.tgrelid = to_regclass(v.tbl) AND NOT t.tgisinternal), '(none)') AS trgs
      FROM (VALUES
        ('public.content'),
        ('public.content_quality'),
        ('public.content_block'),
        ('public.content_recommendation'),
        ('public.content_approval_history')
      ) AS v(tbl)
     WHERE to_regclass(v.tbl) IS NOT NULL
  LOOP
    RAISE NOTICE 'FIX3 STEP 4b: % — no DELETE/TRUNCATE trigger, no rewrite rule; surviving non-internal triggers: %.', spec.tbl, spec.trgs;
  END LOOP;
END $$;

-- ===========================================================================
-- STEP 5 — INDEXES
--
-- `CREATE INDEX IF NOT EXISTS` matches on NAME, not definition: an index already
-- holding one of these names with a DIFFERENT definition is skipped with a
-- notice and this migration reports success with an index that does not match
-- this file. The consequence is NOT confined to query-plan divergence — a
-- pre-existing UNIQUE index of one of these names would impose a uniqueness
-- constraint this design does not want, and an inverted partial predicate would
-- index exactly the rows meant to be excluded.
--
-- THAT LIMIT IS NO LONGER MERELY ACCEPTED. An earlier version of this header
-- said the limit "is accepted here because IF NOT EXISTS is the idempotency
-- form the repository gate requires, and it is covered by the companion
-- verification script". Both halves were weak: the gate requires the IF NOT
-- EXISTS form PER STATEMENT and never forbade a preceding probe, so the dilemma
-- was false; and the companion script is a separate manual paste, so deferring
-- to it meant a green apply was not gated on anything. This step now guards the
-- eight names BEFORE creating and RE-READS all eight after.
--
-- FIX3-IDX-04 re-reads: presence, host table, non-unique, non-exclusion,
-- non-primary, non-expression, INCLUDE-free, btree, valid/ready/live, the
-- intended KEY COLUMNS IN ORDER, their ORDERING OPTIONS (indoption, so
-- ASC-where-DESC-is-intended is caught), the DEFAULT operator class on every
-- key column, no COLLATE override, and the intended partial PREDICATE. An
-- earlier version of this sentence described it as "present, non-unique,
-- valid/ready/live, right table", which was its coverage several revisions ago.
--
-- THE PRE-CREATION GUARDS, and what each one closes:
--   IDX-01   the name holds a relation that is not an ORDINARY index. relkind
--            'I' (partitioned index) is rejected too; the companion artifact
--            accepted ('i','I') and now agrees on 'i' alone.
--   IDX-02   the index is on a different table than intended.
--   IDX-03   it is UNIQUE, imposing a rule this design does not want.
--   IDX-03a  it backs an EXCLUSION constraint. indisunique is FALSE for one of
--            those, so IDX-03 never saw it, and indisexclusion was read
--            nowhere in this file — an exclusion index would have been reused
--            silently while enforcing a rule nothing here intended.
--   IDX-03b  it is a PRIMARY KEY index, which is constraint-backed.
--   IDX-03c  THREE conditions, each with its own message and remediation:
--            (i)  it is an EXPRESSION index — this design creates none;
--            (ii) its partial PREDICATE is not the intended one, which covers
--                 unexpectedly-partial, unexpectedly-plain and
--                 wrong-predicate. The intended predicate is ACCEPTED: the
--                 deliberately partial content_quality_content_idx
--                 `(content_id) WHERE content_id IS NOT NULL` is what the
--                 frozen predecessor and the companion artifact both expect.
--                 An earlier version of this line read "it is an expression or
--                 partial index", which described the behaviour BEFORE that was
--                 fixed — the guard then aborted on this file's own output and
--                 on every database carrying the predecessor;
--            (iii) its KEY COLUMNS, in order, are not the intended ones.
--   IDX-03f  its per-column ORDERING OPTIONS (indoption) differ from the
--            intended ones — e.g. an ASC index where the design wants DESC.
--            Read nowhere in this file before: such an index satisfied every
--            other guard, was silently reused by IF NOT EXISTS, and only the
--            separately-pasted companion script would ever have caught it.
--   IDX-03g  it carries INCLUDE columns (indnatts <> indnkeyatts). This was
--            previously tested by IDX-04 ALONE, so the file still failed
--            closed, but after the reuse rather than before it — and this list
--            claimed to enumerate the states IF NOT EXISTS would skip while
--            omitting one of them.
--   IDX-03h  it uses a NON-DEFAULT operator class (indclass / opcdefault),
--            e.g. text_pattern_ops. Read nowhere in this file before.
--   IDX-03i  it OVERRIDES the column collation (indcollation), e.g. an
--            explicit COLLATE "C". Read nowhere in this file before.
--            03h and 03i change which queries an index can serve while leaving
--            every other property above identical, so such an index passed
--            IDX-01 through IDX-03g untouched and was reused.
--   IDX-03d  it is under a non-btree access method.
--   IDX-03e  it exists but is not valid/ready/live, so IF NOT EXISTS would
--            skip it and leave the broken one as the only index of that name.
-- Every one of these is a state CREATE INDEX IF NOT EXISTS would skip, because
-- it matches on NAME alone — so each is a way for this step to report success
-- having created nothing.
-- WHAT THIS STEP CHECKS ABOUT INDEX SHAPE, and what the companion script still
-- adds. This sentence has been wrong twice, so it is now stated as a complete
-- enumeration. It once listed "access method, key columns in order, absence of
-- INCLUDE columns, per-column ordering options, operator class, collation and
-- partial-predicate TEXT" as things "this step does not" check, then as five of
-- seven checked with two outstanding. ALL SEVEN ARE NOW CHECKED HERE:
--   access method ................ IDX-03d, IDX-04
--   key columns in order ......... IDX-03c (iii), IDX-04
--   absence of INCLUDE columns ... IDX-03g, IDX-04 (indnatts = indnkeyatts)
--   per-column ordering options .. IDX-03f, IDX-04 (indoption)
--   operator class ............... IDX-03h, IDX-04 (indclass / opcdefault)
--   collation .................... IDX-03i, IDX-04 (indcollation)
--   partial-predicate text ....... IDX-03c (ii), IDX-04
-- Each is checked BOTH before creation, where a name-matching index would
-- otherwise be reused, AND after, where IF NOT EXISTS may have skipped. The
-- predicates are the same ones the companion artifact uses in its section 8, so
-- the two files compare the same properties against the same expectations.
--
-- WHY THAT MATTERS RATHER THAN BEING TIDINESS: the companion script is a
-- separate manual paste, and NOTHING makes running it a condition of this file
-- applying. Every property delegated to it was a property on which a green
-- apply was gated on nothing at all. What the companion script still adds is
-- the rest of the schema — columns, CHECK definitions byte-exactly, foreign-key
-- actions, the trigger and executor, RLS policies, and its own audit-
-- preservation parity — none of which this step examines.
-- ===========================================================================
-- NAME-FREENESS FIRST. `CREATE INDEX IF NOT EXISTS` matches on NAME within the
-- schema and tests neither relkind, nor host table, nor definition — so a
-- pre-existing relation of one of these eight names is SKIPPED silently and the
-- required index is never created. A pre-existing UNIQUE index named
-- content_block_company_idx would, for instance, leave content_block limited to
-- one row per company while this file COMMITted reporting success. STEP 2 and
-- STEP 6 already guard their own names this way (FIX3-KEY-04, FIX3-LIFE-06);
-- the eight index names had no guard, which was the gap. The gate in
-- scripts/check-migration-quality.js requires the IF NOT EXISTS form per
-- statement; it does not forbid a preceding probe, so the two are compatible.
DO $$
DECLARE
  spec record;
  r_rel regclass;
  v_kind "char";
  v_pred text;
  v_cols text[];
  v_opts smallint[];
  v_cnt int;
BEGIN
  -- THE SPEC NOW CARRIES THE INTENDED SHAPE, not just the name and host.
  -- want_cols is the ordered key-column list; want_pred is the partial-index
  -- predicate as PostgreSQL deparses it, or NULL for a non-partial index. Both
  -- match the companion artifact's own table for these eight indexes, so the two
  -- files now compare the same properties against the same expectations.
  FOR spec IN
    SELECT * FROM (VALUES
      ('content_quality_company_idx',          'public.content_quality',          ARRAY['company_id','evaluated_at'], ARRAY[0,3]::smallint[], NULL::text),
      ('content_quality_content_idx',          'public.content_quality',          ARRAY['content_id'],                ARRAY[0]::smallint[],   '(content_id IS NOT NULL)'),
      ('content_block_content_idx',            'public.content_block',            ARRAY['content_id','position'],     ARRAY[0,0]::smallint[], NULL::text),
      ('content_block_company_idx',            'public.content_block',            ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text),
      ('content_recommendation_content_idx',   'public.content_recommendation',   ARRAY['content_id','status'],       ARRAY[0,0]::smallint[], NULL::text),
      ('content_recommendation_company_idx',   'public.content_recommendation',   ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text),
      ('content_approval_history_content_idx', 'public.content_approval_history', ARRAY['content_id','created_at'],   ARRAY[0,3]::smallint[], NULL::text),
      ('content_approval_history_company_idx', 'public.content_approval_history', ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text)
    ) AS v(idxname, host, want_cols, want_opts, want_pred)
  LOOP
    r_rel := to_regclass('public.' || quote_ident(spec.idxname));
    CONTINUE WHEN r_rel IS NULL;                      -- the name is free
    SELECT c.relkind INTO v_kind FROM pg_class c WHERE c.oid = r_rel;
    -- ONLY relkind 'i'. A PARTITIONED index ('I') is deliberately REJECTED and
    -- not merely tolerated: these four tables are created non-partitioned by
    -- STEP 1 of this same file, so this file can never itself produce an 'I'
    -- here, and a target that has partitioned them is a schema this file does
    -- not model — its FK census, its trigger census and its policy checks are
    -- all written against a single unpartitioned relation. Failing closed is
    -- the honest outcome; silently reusing the index would let every later
    -- check pass over a shape none of them inspected.
    -- The companion artifact's FIX3-VERIFY-08 accepted ('i','I'). The two now
    -- agree on 'i' alone, so neither accepts an index the other rejects.
    IF v_kind <> 'i' THEN
      RAISE EXCEPTION
        'FIX3-IDX-01: public.% already exists and is not an ordinary index (relkind %), so CREATE INDEX IF NOT EXISTS would skip it and the required index on % would never be created. relkind I (partitioned index) is rejected here as well: this file models these tables as unpartitioned throughout. Resolve manually.',
        spec.idxname, v_kind, spec.host;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indexrelid = r_rel AND i.indrelid = to_regclass(spec.host)
    ) THEN
      RAISE EXCEPTION
        'FIX3-IDX-02: index public.% exists but on a different table than %, so CREATE INDEX IF NOT EXISTS would skip it and the required index would never be created. Resolve manually.',
        spec.idxname, spec.host;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = r_rel AND i.indisunique) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03: index public.% already exists and is UNIQUE. This design wants a NON-unique index; a surviving unique one would impose a uniqueness rule this file never intended (one row per company, for the company indexes). Resolve manually.',
        spec.idxname;
    END IF;
    -- indisunique IS NOT THE ONLY WAY AN INDEX CONSTRAINS ROWS. An EXCLUSION
    -- constraint's index has indisunique = false and indisexclusion = true, so
    -- it passed FIX3-IDX-03 untouched while enforcing a rule this file never
    -- intended — and CREATE INDEX IF NOT EXISTS would then skip the index the
    -- design needs. indisexclusion was read nowhere in this file.
    IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = r_rel AND i.indisexclusion) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03a: index public.% already exists and backs an EXCLUSION constraint. It is not unique, so the uniqueness check above does not see it, but it still enforces a rule this design never intended and CREATE INDEX IF NOT EXISTS would skip the index this file needs. Resolve manually.',
        spec.idxname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = r_rel AND i.indisprimary) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03b: index public.% already exists and is a PRIMARY KEY index. It is constraint-backed, so it cannot be dropped or replaced independently of its constraint. Resolve manually.',
        spec.idxname;
    END IF;
    -- FAIL CLOSED ON INDEX SHAPES THIS FILE DOES NOT MODEL — but ONLY on shapes
    -- it does not model.
    --
    -- AN EARLIER VERSION OF THIS GUARD WAS A BLOCKER. It raised on
    -- `indpred IS NOT NULL`, i.e. on ANY partial index — and
    -- content_quality_content_idx is DELIBERATELY partial: this file creates it
    -- `(content_id) WHERE content_id IS NOT NULL`, the frozen predecessor
    -- creates the byte-identical index under the same name, and the companion
    -- artifact REQUIRES that predicate. So the guard aborted on the file's own
    -- output and on the legacy shape it exists to upgrade: the migration could
    -- not be re-applied after success, and could not be applied at all to a
    -- database carrying the predecessor — which is the premise of STEP 3's
    -- DROP NOT NULL, STEP 4's authorized 'c'→'n' transition and STEP 6's
    -- replacement path. It refused an index its own verifier demands.
    --
    -- An EXPRESSION index is still unconditionally wrong — this file creates
    -- none. A PARTIAL index is compared against the INTENDED predicate:
    -- unexpectedly partial, unexpectedly plain, and partial-with-a-different
    -- predicate are each a distinct refusal, and the intended predicate is
    -- accepted.
    IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = r_rel AND i.indexprs IS NOT NULL) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03c: index public.% already exists and is an EXPRESSION index. This design creates none; CREATE INDEX IF NOT EXISTS matches on name alone and would reuse it, leaving the intended index uncreated. Resolve manually.',
        spec.idxname;
    END IF;
    SELECT CASE WHEN i.indpred IS NULL THEN NULL ELSE pg_get_expr(i.indpred, i.indrelid) END
      INTO v_pred FROM pg_index i WHERE i.indexrelid = r_rel;
    IF v_pred IS DISTINCT FROM spec.want_pred THEN
      RAISE EXCEPTION
        'FIX3-IDX-03c: index public.% already exists with partial predicate %, but this design intends %. CREATE INDEX IF NOT EXISTS matches on name alone, so the existing index would be reused and the intended one never created. Resolve manually.',
        spec.idxname, COALESCE(v_pred, '(none — a plain index)'), COALESCE(spec.want_pred, '(none — a plain index)');
    END IF;
    -- KEY COLUMNS, IN ORDER. Nothing in this step read them before, so a
    -- pre-existing plain, non-unique, valid btree index of the right name on
    -- the WRONG COLUMN passed every guard, was skipped by IF NOT EXISTS, and
    -- passed the post-read too — the step reported success having created
    -- nothing useful. Opclass and collation remain the companion artifact's
    -- job; ORDERING OPTIONS are read immediately below, by FIX3-IDX-03f.
    SELECT array_agg(a.attname ORDER BY k.ord) INTO v_cols
      FROM pg_index i
      CROSS JOIN LATERAL unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                   WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indexrelid = r_rel AND k.ord <= i.indnkeyatts;
    IF v_cols IS DISTINCT FROM spec.want_cols THEN
      RAISE EXCEPTION
        'FIX3-IDX-03c: index public.% already exists on key column(s) %, but this design intends %. Resolve manually.',
        spec.idxname, COALESCE(v_cols::text, '(none)'), spec.want_cols::text;
    END IF;
    -- ORDERING OPTIONS, PER KEY COLUMN. The column set and order being right
    -- does not make the index the one this file designs: an index declared
    -- (company_id, evaluated_at) ASC has exactly the same key columns in
    -- exactly the same order as (company_id, evaluated_at DESC), satisfied
    -- every guard above, was silently reused by IF NOT EXISTS, and passed the
    -- post-read as well. Only the separately pasted companion script would
    -- ever have caught it, and nothing makes running that script a condition
    -- of this file applying.
    --
    -- indoption stores VALUES, not bit positions: DESC = 1, NULLS FIRST = 2.
    -- In CREATE INDEX, NULLS FIRST is the DEFAULT whenever DESC is given, so a
    -- column written as plain `DESC` stores 1 | 2 = 3, and only
    -- `DESC NULLS LAST` stores 1. The two `... DESC` columns in the eight
    -- statements below are therefore 3 and every other column is 0. These
    -- expectations are read off those statements; they are not tuned to make
    -- anything pass, and they are the same values the companion artifact uses.
    SELECT array_agg(o.opt ORDER BY o.ord) INTO v_opts
      FROM pg_index i
      CROSS JOIN LATERAL unnest(string_to_array(i.indoption::text, ' ')::smallint[])
                   WITH ORDINALITY AS o(opt, ord)
     WHERE i.indexrelid = r_rel AND o.ord <= i.indnkeyatts;
    IF v_opts IS DISTINCT FROM spec.want_opts THEN
      RAISE EXCEPTION
        'FIX3-IDX-03f: index public.% already exists with per-column ordering options %, but this design intends % (values: 1 = DESC, 2 = NULLS FIRST; plain DESC defaults to NULLS FIRST and so stores 3). CREATE INDEX IF NOT EXISTS matches on name alone, so the existing index would be reused and the intended ordering never established. Resolve manually.',
        spec.idxname, COALESCE(v_opts::text, '(none)'), spec.want_opts::text;
    END IF;
    -- INCLUDE COLUMNS. Checked HERE and not only at the post-read. Until now
    -- `indnatts = indnkeyatts` was tested by FIX3-IDX-04 alone, so an index of
    -- the right name, table, key columns, ordering and predicate that ALSO
    -- carried INCLUDE columns passed every pre-creation guard, was silently
    -- reused by CREATE INDEX IF NOT EXISTS, and was caught only after the fact.
    -- The file still failed closed — IDX-04 raises — but the operator got the
    -- post-read's message rather than a named pre-creation reason, and the
    -- pre-guard list claimed to enumerate the states IF NOT EXISTS would skip
    -- while omitting one of them.
    IF EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indexrelid = r_rel AND i.indnatts <> i.indnkeyatts
    ) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03g: index public.% already exists WITH INCLUDE column(s) (indnatts % <> indnkeyatts %). This design declares none; CREATE INDEX IF NOT EXISTS matches on name alone, so the existing index would be reused and the intended one never created. Resolve manually.',
        spec.idxname,
        (SELECT i.indnatts FROM pg_index i WHERE i.indexrelid = r_rel),
        (SELECT i.indnkeyatts FROM pg_index i WHERE i.indexrelid = r_rel);
    END IF;
    -- OPERATOR CLASS, and then COLLATION. Read NOWHERE in this file before:
    -- both were delegated entirely to the companion verification script, which
    -- is a separate manual paste that nothing makes a condition of this file
    -- applying. A non-default opclass such as text_pattern_ops, or an explicit
    -- COLLATE "C", changes which queries an index can serve while leaving every
    -- other property this step checks identical — so such an index satisfied
    -- all of IDX-01 through IDX-03g and was reused.
    --
    -- The predicates below are the SAME ones the companion artifact uses
    -- (verification.sql, section 8), so the two files now compare the same
    -- properties against the same expectations rather than dividing the work.
    -- `indclass` carries one opclass oid per key column; `opcdefault` is true
    -- for the type's default, which is what an unqualified CREATE INDEX
    -- produces. The eight statements below declare no opclass at all.
    SELECT count(*) INTO v_cnt
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indclass) WITH ORDINALITY AS kc(opc, ord)
      JOIN pg_opclass oc ON oc.oid = kc.opc
     WHERE i.indexrelid = r_rel AND kc.ord <= i.indnkeyatts AND NOT oc.opcdefault;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION
        'FIX3-IDX-03h: index public.% already exists using a NON-DEFAULT operator class on % key column(s); this design declares none. CREATE INDEX IF NOT EXISTS would reuse it. Resolve manually.',
        spec.idxname, v_cnt;
    END IF;
    -- `indcollation` is 0 for "the column's own collation", which is what an
    -- unqualified CREATE INDEX produces. A non-zero value that differs from
    -- the column's attcollation is an explicit COLLATE on the index.
    SELECT count(*) INTO v_cnt
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indcollation) WITH ORDINALITY AS kl(coll, ord)
     WHERE i.indexrelid = r_rel AND kl.ord <= i.indnkeyatts
       AND kl.coll <> 0
       AND kl.coll <> (SELECT a.attcollation FROM pg_attribute a
                        WHERE a.attrelid = i.indrelid
                          AND a.attnum = (string_to_array(i.indkey::text, ' ')::smallint[])[kl.ord]);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION
        'FIX3-IDX-03i: index public.% already exists overriding the column collation on % key column(s); this design declares no COLLATE. CREATE INDEX IF NOT EXISTS would reuse it. Resolve manually.',
        spec.idxname, v_cnt;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_am a ON a.oid = c.relam
       WHERE c.oid = r_rel AND a.amname = 'btree'
    ) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03d: index public.% already exists under a non-btree access method. Resolve manually.',
        spec.idxname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indexrelid = r_rel
         AND NOT (i.indisvalid AND i.indisready AND i.indislive)
    ) THEN
      RAISE EXCEPTION
        'FIX3-IDX-03e: index public.% already exists but is not valid/ready/live. CREATE INDEX IF NOT EXISTS would skip it and the broken index would remain the only one under this name. Resolve manually.',
        spec.idxname;
    END IF;
    RAISE NOTICE 'FIX3 STEP 5: index public.% already exists on %, non-unique — reused.', spec.idxname, spec.host;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS content_quality_company_idx            ON public.content_quality (company_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS content_quality_content_idx            ON public.content_quality (content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_block_content_idx              ON public.content_block (content_id, position);
CREATE INDEX IF NOT EXISTS content_block_company_idx              ON public.content_block (company_id);
CREATE INDEX IF NOT EXISTS content_recommendation_content_idx     ON public.content_recommendation (content_id, status);
CREATE INDEX IF NOT EXISTS content_recommendation_company_idx     ON public.content_recommendation (company_id);
CREATE INDEX IF NOT EXISTS content_approval_history_content_idx   ON public.content_approval_history (content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_approval_history_company_idx   ON public.content_approval_history (company_id);

-- POST-CREATION VERIFICATION. The eight statements above are the only DDL in
-- this file whose "did not raise" is genuinely different from "did what the file
-- says": IF NOT EXISTS can skip, so success alone proves nothing. Every other
-- create path either raises or produced the object itself. This re-reads what
-- STEP 5 was supposed to leave behind, so the step cannot report success on a
-- state it did not establish.
DO $$
DECLARE
  spec record;
  r_idx regclass;
  v_pred text;
  v_cols text[];
  v_opts smallint[];
  v_cnt int;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- (company_id, evaluated_at DESC) -> ASC, then DESC + NULLS FIRST = 3
      ('content_quality_company_idx',          'public.content_quality',          ARRAY['company_id','evaluated_at'], ARRAY[0,3]::smallint[], NULL::text),
      ('content_quality_content_idx',          'public.content_quality',          ARRAY['content_id'],                ARRAY[0]::smallint[],   '(content_id IS NOT NULL)'),
      ('content_block_content_idx',            'public.content_block',            ARRAY['content_id','position'],     ARRAY[0,0]::smallint[], NULL::text),
      ('content_block_company_idx',            'public.content_block',            ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text),
      ('content_recommendation_content_idx',   'public.content_recommendation',   ARRAY['content_id','status'],       ARRAY[0,0]::smallint[], NULL::text),
      ('content_recommendation_company_idx',   'public.content_recommendation',   ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text),
      -- (content_id, created_at DESC) -> ASC, then DESC + NULLS FIRST = 3
      ('content_approval_history_content_idx', 'public.content_approval_history', ARRAY['content_id','created_at'],   ARRAY[0,3]::smallint[], NULL::text),
      ('content_approval_history_company_idx', 'public.content_approval_history', ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text)
    ) AS v(idxname, host, want_cols, want_opts, want_pred)
  LOOP
    r_idx := to_regclass('public.' || quote_ident(spec.idxname));
    IF r_idx IS NULL THEN
      RAISE EXCEPTION 'FIX3-IDX-04: index public.% does not exist after STEP 5. Resolve manually.', spec.idxname;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indexrelid = r_idx
         AND i.indrelid = to_regclass(spec.host)
         AND NOT i.indisunique
         AND NOT i.indisexclusion
         AND NOT i.indisprimary
         AND i.indexprs IS NULL
         AND i.indisvalid AND i.indisready AND i.indislive
         AND i.indnatts = i.indnkeyatts            -- no INCLUDE columns
    ) THEN
      RAISE EXCEPTION
        'FIX3-IDX-04: index public.% is not a valid, ready, live, NON-unique, non-exclusion, non-primary, non-expression, INCLUDE-free index on % after STEP 5. Definition: %. Resolve manually.',
        spec.idxname, spec.host, COALESCE(pg_get_indexdef(r_idx), '(none)');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_am a ON a.oid = c.relam WHERE c.oid = r_idx AND a.amname = 'btree') THEN
      RAISE EXCEPTION 'FIX3-IDX-04: index public.% is not a btree index after STEP 5. Definition: %.', spec.idxname, pg_get_indexdef(r_idx);
    END IF;
    -- THE SHAPE, NOT MERELY THE EXISTENCE. An earlier version of this post-read
    -- asserted only existence, host table, non-uniqueness and valid/ready/live,
    -- while the header claimed it "re-reads what STEP 5 was supposed to leave
    -- behind, so the step cannot report success on a state it did not
    -- establish". It could: a pre-existing index of the right name on the wrong
    -- column, or with the wrong partial predicate, satisfied all of it.
    SELECT CASE WHEN i.indpred IS NULL THEN NULL ELSE pg_get_expr(i.indpred, i.indrelid) END
      INTO v_pred FROM pg_index i WHERE i.indexrelid = r_idx;
    IF v_pred IS DISTINCT FROM spec.want_pred THEN
      RAISE EXCEPTION
        'FIX3-IDX-04: index public.% has partial predicate % after STEP 5; % intended. Definition: %.',
        spec.idxname, COALESCE(v_pred, '(none)'), COALESCE(spec.want_pred, '(none)'), pg_get_indexdef(r_idx);
    END IF;
    SELECT array_agg(a.attname ORDER BY k.ord) INTO v_cols
      FROM pg_index i
      CROSS JOIN LATERAL unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                   WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indexrelid = r_idx AND k.ord <= i.indnkeyatts;
    IF v_cols IS DISTINCT FROM spec.want_cols THEN
      RAISE EXCEPTION
        'FIX3-IDX-04: index public.% is on key column(s) % after STEP 5; % intended. Definition: %.',
        spec.idxname, COALESCE(v_cols::text, '(none)'), spec.want_cols::text, pg_get_indexdef(r_idx);
    END IF;
    -- AND ITS ORDERING OPTIONS. Without this, an ASC index of the right name on
    -- the right columns was reused by IF NOT EXISTS and then CONFIRMED by this
    -- post-read, which is the state the header promises cannot be reported as
    -- success. Expectations and encoding are documented at FIX3-IDX-03f above.
    SELECT array_agg(o.opt ORDER BY o.ord) INTO v_opts
      FROM pg_index i
      CROSS JOIN LATERAL unnest(string_to_array(i.indoption::text, ' ')::smallint[])
                   WITH ORDINALITY AS o(opt, ord)
     WHERE i.indexrelid = r_idx AND o.ord <= i.indnkeyatts;
    IF v_opts IS DISTINCT FROM spec.want_opts THEN
      RAISE EXCEPTION
        'FIX3-IDX-04: index public.% has per-column ordering options % after STEP 5; % intended (1 = DESC, 2 = NULLS FIRST; plain DESC stores 3). Definition: %.',
        spec.idxname, COALESCE(v_opts::text, '(none)'), spec.want_opts::text, pg_get_indexdef(r_idx);
    END IF;
    -- AND THE OPERATOR CLASS AND COLLATION, re-read for the same reason every
    -- other property here is: IF NOT EXISTS can skip, so "did not raise" is not
    -- "did what this file says". Same predicates as FIX3-IDX-03h / FIX3-IDX-03i
    -- above and as the companion artifact's section 8. INCLUDE-freedom is
    -- already asserted in the composite check above (indnatts = indnkeyatts).
    SELECT count(*) INTO v_cnt
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indclass) WITH ORDINALITY AS kc(opc, ord)
      JOIN pg_opclass oc ON oc.oid = kc.opc
     WHERE i.indexrelid = r_idx AND kc.ord <= i.indnkeyatts AND NOT oc.opcdefault;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION
        'FIX3-IDX-04: index public.% uses a NON-DEFAULT operator class on % key column(s) after STEP 5; this design declares none. Definition: %.',
        spec.idxname, v_cnt, pg_get_indexdef(r_idx);
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indcollation) WITH ORDINALITY AS kl(coll, ord)
     WHERE i.indexrelid = r_idx AND kl.ord <= i.indnkeyatts
       AND kl.coll <> 0
       AND kl.coll <> (SELECT a.attcollation FROM pg_attribute a
                        WHERE a.attrelid = i.indrelid
                          AND a.attnum = (string_to_array(i.indkey::text, ' ')::smallint[])[kl.ord]);
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION
        'FIX3-IDX-04: index public.% overrides the column collation on % key column(s) after STEP 5; this design declares no COLLATE. Definition: %.',
        spec.idxname, v_cnt, pg_get_indexdef(r_idx);
    END IF;
  END LOOP;
  RAISE NOTICE 'FIX3 STEP 5: all eight indexes verified present, non-unique, non-exclusion, non-primary, non-expression, INCLUDE-free, btree, valid/ready/live, on their intended tables, with the intended key columns in order, the intended per-column ordering options, the default operator class on every key column, no collation override, and the intended partial predicate.';
END $$;



-- ===========================================================================
-- STEP 6 — LIFECYCLE CHECK: EXACT SUPPORTED DEFINITION FORM, FAIL CLOSED
--
-- WHY THE APPROACH CHANGED, TWICE. The first version dropped the constraint by
-- a GUESSED NAME, which could fail open (drop nothing, add a second CHECK whose
-- conjunction still rejects quality_reviewed) or silently clobber a deliberate
-- tightening. The second version replaced the name guess with a comparison of
-- the quoted LITERALS extracted from pg_get_constraintdef. That was still
-- fail-open, because it ignored everything AROUND the literals:
--     CHECK (lifecycle_status = ANY (ARRAY[...nine...])
--            AND lifecycle_status <> 'quality_reviewed')
-- carries exactly the nine literals once de-duplicated, so it was ACCEPTED and
-- LEFT IN PLACE while rejecting the one value this migration exists to permit;
-- and a negated or tightened EIGHT-literal constraint was classified as the
-- predecessor and DROPPED, then replaced with something more permissive.
--
-- HOW IT WORKS NOW. No literal extraction and no pattern heuristics, and no
-- normalisation either: the WHOLE definition must be exactly the one supported
-- form, BYTE FOR BYTE, with the value list as its only variable part:
--     CHECK ((lifecycle_status = ANY (ARRAY[<elements>])))
-- That template is PostgreSQL's own deparse output for a membership CHECK — the
-- form recorded for this very constraint in supabase/_schema/baseline.sql. The
-- prefix and the suffix together must consume the entire string, so an extra
-- conjunct, a negation, a COALESCE or any other wrapper CANNOT hide inside it:
-- such a definition does not end in `])))` or does not begin with the prefix,
-- and is REJECTED UNCHANGED.
--
-- Each element is then compared against a CONSTRUCTED expected element
-- (`'<value>'::text`), order-insensitively, so literal order and the source
-- spelling — `IN (...)` and `= ANY (ARRAY[...])` deparse identically — are
-- immaterial. This matters concretely: baseline.sql records the live constraint
-- with the nine values in a DIFFERENT ORDER from this file's, and it must be
-- recognised.
--
-- EXACTLY TWO DEFINITIONS ARE SUPPORTED
--   the NINE-value target   — already correct; LEFT EXACTLY AS IT IS, no DDL at
--     all, which also avoids re-validating every row under ACCESS EXCLUSIVE.
--   the EIGHT-value predecessor from 20260718000000 — the ONLY state this
--     migration is authorized to replace. Dropped BY ITS ACTUAL CATALOG NAME.
-- Everything else fails closed and is never altered: a different value set
-- (LIFE-05), an unsupported definition form (LIFE-07), more than one covering
-- CHECK (LIFE-02), a multi-column CHECK (LIFE-03), a NOT VALID one (LIFE-04).
--
-- STATED LIMITS, not assumed away:
--   - NOTHING IS NORMALISED. The actual definition is compared BYTE FOR BYTE
--     against `CHECK ((lifecycle_status = ANY (ARRAY[<elements>])))`, the exact
--     output of single-argument `pg_get_constraintdef`, with `, ` as the
--     element separator. It is neither lower-cased nor whitespace-stripped: an
--     earlier version did both, which folded `'Draft'` onto `'draft'` and so
--     accepted a CHECK that would reject the canonical lower-case value the
--     application actually writes. Any deviation now fails closed with the
--     actual definition printed.
--   - The form `= ANY ('{draft,...}'::text[])` (an array CONSTANT rather than an
--     ARRAY constructor) and a regex form such as `~ '^(draft|...)$'` are
--     semantically valid but are NOT supported forms: they are rejected by
--     LIFE-07 with their definition printed, and nothing is changed. That is a
--     deliberate fail-closed choice, not an oversight.
--   - This establishes the constraint's DEFINITION, not its runtime behaviour.
--     No behavioural probe exists in this repository; adding one would be a data
--     operation requiring separate authorization. The companion verification
--     script asserts the same definition form and makes no behavioural claim.
--   - A restriction that is not a CHECK — a BEFORE trigger or a rule on
--     public.content rejecting quality_reviewed — is outside this step entirely
--     and is not detected here or by the verification script.
-- ===========================================================================
DO $$
DECLARE
  r_content  regclass := to_regclass('public.content');
  a_life     smallint;
  v_ncons    int;
  v_name     text;
  v_def      text;
  v_nkeys    int;
  v_valid    boolean;
  v_pre      text  := 'CHECK ((lifecycle_status = ANY (ARRAY[';
  v_suf      text  := '])))';
  v_inner    text;
  v_got      text[];
  v_exp9     text[];
  v_exp8     text[];
  v_form_ok  boolean;
  v_nine     text[] := ARRAY['draft','generated','edited','approved','adapted','scheduled','published','archived','quality_reviewed'];
  v_eight    text[] := ARRAY['draft','generated','edited','approved','adapted','scheduled','published','archived'];
  c_name     text  := 'content_lifecycle_status_check';
BEGIN
  IF r_content IS NULL THEN
    RAISE EXCEPTION 'FIX3-LIFE-01: public.content is absent at STEP 6.';
  END IF;
  SELECT attnum INTO a_life FROM pg_attribute
    WHERE attrelid = r_content AND attname = 'lifecycle_status'
      AND attnum > 0 AND NOT attisdropped;
  IF a_life IS NULL THEN
    RAISE EXCEPTION 'FIX3-LIFE-01: public.content.lifecycle_status is absent at STEP 6, which contradicts FIX3-PRECOND-15.';
  END IF;

  SELECT array_agg(quote_literal(w) || '::text' ORDER BY quote_literal(w) || '::text') INTO v_exp9
    FROM unnest(v_nine) AS w;
  SELECT array_agg(quote_literal(w) || '::text' ORDER BY quote_literal(w) || '::text') INTO v_exp8
    FROM unnest(v_eight) AS w;

  SELECT count(*) INTO v_ncons FROM pg_constraint
    WHERE conrelid = r_content AND contype = 'c' AND a_life = ANY (conkey);

  IF v_ncons > 1 THEN
    RAISE EXCEPTION
      'FIX3-LIFE-02: public.content has % CHECK constraints covering lifecycle_status. Their CONJUNCTION, not any one of them, defines the permitted domain, so this migration cannot reconcile them. Resolve manually, then re-apply.',
      v_ncons;
  END IF;

  IF v_ncons = 0 THEN
    -- Only a same-named CONSTRAINT on this table can collide: a CHECK name is
    -- unique per (conrelid, conname) in pg_constraint and occupies no pg_class
    -- entry, so the relation-squatting probe this check used to also run was a
    -- false premise and could abort a valid apply. See the note on the other
    -- LIFE-06 site.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r_content AND conname = c_name) THEN
      RAISE EXCEPTION
        'FIX3-LIFE-06: no CHECK covers lifecycle_status, but a constraint named % already exists on public.content. Resolve manually.',
        c_name;
    END IF;
    EXECUTE format(
      'ALTER TABLE public.content ADD CONSTRAINT %I CHECK (lifecycle_status IN (''draft'',''generated'',''edited'',''approved'',''adapted'',''scheduled'',''published'',''archived'',''quality_reviewed''))',
      c_name);
    RAISE NOTICE 'FIX3 STEP 6: no lifecycle CHECK existed; added % with the nine-value domain.', c_name;
    RETURN;
  END IF;

  SELECT conname, pg_get_constraintdef(oid), array_length(conkey,1), convalidated
    INTO v_name, v_def, v_nkeys, v_valid
    FROM pg_constraint
    WHERE conrelid = r_content AND contype = 'c' AND a_life = ANY (conkey);

  IF v_nkeys IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'FIX3-LIFE-03: the CHECK % covering public.content.lifecycle_status spans % column(s); a single-column lifecycle CHECK is expected. This migration will not alter it. Definition: %. Resolve manually.',
      v_name, COALESCE(v_nkeys, 0), v_def;
  END IF;

  IF NOT v_valid THEN
    RAISE EXCEPTION
      'FIX3-LIFE-04: the lifecycle CHECK % is NOT VALID, so existing rows were never checked against it. Validate or remove it deliberately, then re-apply. Definition: %.',
      v_name, v_def;
  END IF;

  -- NOTHING IS NORMALISED — see the long note in STEP 1B. An earlier version
  -- lowercased the actual definition and stripped its whitespace while building
  -- the expected elements unfolded, which was FAIL-OPEN on the literal payload:
  -- a nine-element CHECK permitting 'QUALITY_REVIEWED' folded down, matched,
  -- and was LEFT UNCHANGED while rejecting every 'quality_reviewed' write; and
  -- a mis-cased EIGHT-element CHECK folded into the predecessor set and was
  -- DROPPED without authorization. The comparison is now byte-exact against
  -- PostgreSQL's deterministic deparse form, with element order the only
  -- variable part.
  v_form_ok := length(v_def) > length(v_pre) + length(v_suf)
           AND left(v_def, length(v_pre)) = v_pre
           AND right(v_def, length(v_suf)) = v_suf;

  IF NOT v_form_ok THEN
    RAISE EXCEPTION
      'FIX3-LIFE-07: the lifecycle CHECK % is not in the one supported definition form. The WHOLE definition must be exactly CHECK ((lifecycle_status = ANY (ARRAY[''a''::text, …]))) and nothing else, so that no additional condition, negation, wrapper, cast or whitespace variation can hide inside it — an earlier version compared only the quoted literals and would have ACCEPTED "... = ANY (ARRAY[nine values]) AND lifecycle_status <> ''quality_reviewed''" as correct. Unsupported-but-valid forms such as = ANY (''{...}''::text[]), a regex, or a non-text column cast also land here. Nothing has been changed. Actual definition: %. Resolve manually, then re-apply.',
      v_name, v_def;
  END IF;

  v_inner := substr(v_def, length(v_pre) + 1,
                    length(v_def) - length(v_pre) - length(v_suf));
  SELECT array_agg(e ORDER BY e) INTO v_got
    FROM unnest(string_to_array(v_inner, ', ')) AS e;

  IF v_got = v_exp9 THEN
    RAISE NOTICE 'FIX3 STEP 6: lifecycle CHECK % is already the supported nine-value definition and is validated — LEFT UNCHANGED (no DDL, no revalidation scan).', v_name;
    RETURN;
  END IF;

  IF v_got = v_exp8 THEN
    -- NOTE ON A PREMISE THAT WAS WRONG HERE. An earlier version ran the
    -- relation-squatting probe used by FIX3-KEY-04 at this point and claimed a
    -- same-named RELATION would collide with `ADD CONSTRAINT ... CHECK`. It
    -- would not: a CHECK constraint name lives only in pg_constraint, unique
    -- per (conrelid, conname), and creates no pg_class entry. That probe is
    -- correct for KEY-04, where ADD CONSTRAINT ... UNIQUE does create an index,
    -- and false here — it would have aborted a valid apply, with a stated
    -- reason that does not exist, merely because some unrelated index or view
    -- happened to share the name. The real collision risk for a CHECK is a
    -- same-named CONSTRAINT on this table, which the next check covers.
    IF v_name <> c_name AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r_content AND conname = c_name) THEN
      RAISE EXCEPTION
        'FIX3-LIFE-06: the eight-value predecessor is named %, and the intended name % is occupied by another constraint on public.content. Resolve manually.',
        v_name, c_name;
    END IF;
    EXECUTE format('ALTER TABLE public.content DROP CONSTRAINT %I', v_name);
    EXECUTE format(
      'ALTER TABLE public.content ADD CONSTRAINT %I CHECK (lifecycle_status IN (''draft'',''generated'',''edited'',''approved'',''adapted'',''scheduled'',''published'',''archived'',''quality_reviewed''))',
      c_name);
    RAISE NOTICE 'FIX3 STEP 6: replaced the eight-value predecessor % with % (adds quality_reviewed). The dropped name came from pg_constraint and the dropped definition was: %', v_name, c_name, v_def;
    RETURN;
  END IF;

  RAISE EXCEPTION
    'FIX3-LIFE-05: the lifecycle CHECK % is in the supported definition form but its element list is %, which is neither the nine intended values nor the eight-value predecessor. Expected nine: %. Expected eight: %. This migration will not alter a constraint it does not recognise. Actual definition: %. Resolve manually, then re-apply.',
    v_name, COALESCE(v_got::text,'{}'), v_exp9::text, v_exp8::text, v_def;
END $$;


-- ===========================================================================
-- STEP 7 — updated_at EXECUTOR AND THE content_block TRIGGER
--
-- THE FACT THAT DRIVES THIS DESIGN. public.set_content_updated_at() is declared
-- with CREATE OR REPLACE by FOUR other repository migrations — 20260718000000,
-- 20260718000001, 20260718000002 and 20260718000003 (this file is a fifth
-- declarer, but only on the conditional create branch below) — and it is
-- ABSENT from
-- supabase/_schema/baseline.sql — the production-shaped dump — which instead
-- carries public.omnivyra_touch_updated_at() whose body is semantically
-- identical (`NEW.updated_at = NOW(); RETURN NEW;`) and which is the executor
-- for the content-family updated_at triggers that actually exist there. An
-- earlier version of this step asserted the five-trigger blast radius as a fact
-- about the TARGET; it is a fact about the REPOSITORY. On the real target that
-- version would have taken its create branch, leaving its entire drift-guard
-- apparatus as dead code and adding a second, redundant updated_at function.
--
-- WHAT THIS DOES — EXISTING TRIGGER FIRST, THEN REUSE, THEN CREATE
--   0. If the trigger content_block_set_updated_at ALREADY EXISTS and executes
--      one of the two approved equivalents, ADOPT THAT FUNCTION as the chosen
--      executor. This step is why the migration is idempotent, and it is not
--      cosmetic: an earlier version chose by NAME PRIORITY alone, so a database
--      where this very file had created the trigger on omnivyra_touch_updated_at
--      would, after any later migration declared set_content_updated_at, select
--      set_content_updated_at on re-apply, find the trigger pointing elsewhere,
--      and ABORT THE WHOLE MIGRATION on a correct schema it had produced itself.
--      Adoption does NOT relax verification: the adopted function still has to
--      pass every FN check below, and an adopted function that diverges raises.
--   1. Otherwise, if public.set_content_updated_at() exists, verify and use it.
--   2. Otherwise, if public.omnivyra_touch_updated_at() exists, verify it by the
--      SAME checks and use it. This avoids adding a duplicate object and keeps
--      content_block on the same executor as its live sibling content tables.
--   3. Only if NEITHER exists is public.set_content_updated_at() created, with
--      a bare CREATE FUNCTION (see the TOCTOU note below).
-- A function that exists but diverges is NEVER replaced: every divergence
-- raises. All candidates are held to identical checks.
--
-- THE EXECUTOR CHOICE, AND WHAT IT MEANS FOR LATER WAVE-4 MIGRATIONS.
-- Choosing omnivyra_touch_updated_at unconditionally would diverge from those
-- four repository migrations; choosing set_content_updated_at unconditionally adds a
-- duplicate updated_at function to the real target. Reusing what the target
-- already has does neither, and is reversible.
--   An earlier version of this comment claimed that "a future migration that
--   re-declares set_content_updated_at will not affect this trigger". THAT WAS
--   FALSE and is corrected here. 20260718000002_content_quality_collaboration.sql
--   lines 92-94 do not merely re-declare the function — they
--   `DROP TRIGGER IF EXISTS content_block_set_updated_at ON public.content_block`
--   and recreate it pointing at set_content_updated_at, unexamined. That file is
--   the repository's declaration of record for THIS trigger, so any manual or
--   ledger-repair run of it will silently repoint the trigger. The adoption rule
--   in step 0 means this file then tolerates that state on its next apply rather
--   than aborting; it does not prevent the repoint. Consolidating the shared
--   trigger-function family is deliberately OUT OF SCOPE here and is recorded as
--   an owner decision.
--
-- FN-04 / FN-05 / FN-07 NOTE. An earlier version raised on SECURITY DEFINER, on
-- a pinned search_path, and on non-membership of the owning role, justifying
-- each by what `CREATE OR REPLACE` would do. Nothing is ever replaced, so that
-- justification was false. They are WARNINGS: each names a state that is
-- harmless-or-safer for this migration's single use of the function, and none
-- should abort an eight-step apply. FN-01, FN-02, FN-03 and FN-06 remain hard
-- failures because the trigger created below genuinely depends on them.
--
-- TOCTOU. The create branch uses a bare `CREATE FUNCTION`, not
-- `CREATE OR REPLACE`. No lock protects pg_proc between the existence test and
-- the create, and `OR REPLACE` would have silently overwritten a function that
-- appeared in that window — bypassing every FN check, and contradicting this
-- step's own "nothing is ever replaced" invariant. A bare CREATE raises 42723
-- instead, which fails closed.
-- ===========================================================================
DO $fixthree$
DECLARE
  r_fn            oid;
  r_setfn         oid;
  r_omnifn        oid;
  v_existing_foid oid;
  v_chosen    text;
  v_rettype   oid;
  v_nargs     int;
  v_lang      text;
  v_secdef    boolean;
  v_config    text[];
  v_src       text;
  v_owner     oid;
  v_norm      text;
  v_accepted  text[] := ARRAY[
                 'begin new.updated_at = now(); return new; end;',
                 'begin new.updated_at := now(); return new; end;'
               ];
  v_ntrig     int;
  v_tgname    text;
  v_tgfoid    oid;
  v_tgtype    smallint;
  v_tgenabled "char";
  v_tghasqual boolean;
  v_tgnattr   int;
  v_tgnargs   int;
  v_tgdef     text;
  r_block     regclass := to_regclass('public.content_block');
  v_other     int;
BEGIN
  IF r_block IS NULL THEN
    RAISE EXCEPTION 'FIX3-TRG-03: public.content_block is absent at STEP 7, which contradicts STEP 1.';
  END IF;

  r_setfn := to_regprocedure('public.set_content_updated_at()');
  r_omnifn := to_regprocedure('public.omnivyra_touch_updated_at()');

  -- STEP 0 of the selection: adopt whatever the EXISTING trigger already
  -- executes, when that is one of the two approved equivalents. This is what
  -- makes a second application of this file a no-op instead of an abort.
  SELECT t.tgfoid INTO v_existing_foid
    FROM pg_trigger t
   WHERE t.tgrelid = r_block AND NOT t.tgisinternal
     AND t.tgname = 'content_block_set_updated_at';

  IF v_existing_foid IS NOT NULL
     AND ( v_existing_foid = r_setfn OR v_existing_foid = r_omnifn ) THEN
    r_fn := v_existing_foid;
    v_chosen := v_existing_foid::regprocedure::text;
    RAISE NOTICE 'FIX3 STEP 7: adopting % — the function the existing content_block_set_updated_at trigger already executes. It is still verified below.', v_chosen;
  ELSIF r_setfn IS NOT NULL THEN
    r_fn := r_setfn;
    v_chosen := 'public.set_content_updated_at()';
  ELSIF r_omnifn IS NOT NULL THEN
    r_fn := r_omnifn;
    v_chosen := 'public.omnivyra_touch_updated_at()';
  END IF;

  IF r_fn IS NULL THEN
    -- Bare CREATE, deliberately: see the TOCTOU note in the step header.
    EXECUTE 'CREATE FUNCTION public.set_content_updated_at() '
         || 'RETURNS trigger LANGUAGE plpgsql AS $body$ '
         || 'BEGIN NEW.updated_at = now(); RETURN NEW; END; $body$';
    r_fn := to_regprocedure('public.set_content_updated_at()');
    v_chosen := 'public.set_content_updated_at()';
    RAISE NOTICE 'FIX3 STEP 7: neither public.set_content_updated_at() nor public.omnivyra_touch_updated_at() existed; created the former (SECURITY INVOKER).';
  ELSE
    SELECT p.prorettype, p.pronargs, l.lanname, p.prosecdef, p.proconfig, p.prosrc, p.proowner
      INTO v_rettype, v_nargs, v_lang, v_secdef, v_config, v_src, v_owner
      FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
     WHERE p.oid = r_fn;

    SELECT count(*) INTO v_ntrig FROM pg_trigger
     WHERE tgfoid = r_fn AND NOT tgisinternal;

    IF v_rettype IS DISTINCT FROM ('trigger'::regtype)::oid THEN
      RAISE EXCEPTION 'FIX3-FN-01: % returns %, not trigger, so it cannot execute the content_block trigger. Resolve manually.',
        v_chosen, v_rettype::regtype;
    END IF;
    IF v_nargs <> 0 THEN
      RAISE EXCEPTION 'FIX3-FN-02: % takes % argument(s); zero are expected.', v_chosen, v_nargs;
    END IF;
    IF v_lang <> 'plpgsql' THEN
      RAISE EXCEPTION 'FIX3-FN-03: % is written in %, not plpgsql. Resolve manually.', v_chosen, v_lang;
    END IF;

    v_norm := lower(btrim(regexp_replace(COALESCE(v_src,''), '\s+', ' ', 'g')));
    IF NOT (v_norm = ANY (v_accepted)) THEN
      RAISE EXCEPTION
        'FIX3-FN-06: % has a body this repository does not declare, so this migration will not point a trigger at it. Normalised actual: "%". Accepted: "%" or "%". It is executed by % existing trigger(s). Resolve manually.',
        v_chosen, v_norm, v_accepted[1], v_accepted[2], v_ntrig;
    END IF;

    IF v_secdef THEN
      RAISE WARNING 'FIX3-FN-04: % is SECURITY DEFINER where SECURITY INVOKER is this migration''s intent. Nothing is replaced, and for setting NEW.updated_at the difference is immaterial, so this is informational. % trigger(s) execute it.',
        v_chosen, v_ntrig;
    END IF;
    IF v_config IS NOT NULL THEN
      RAISE WARNING 'FIX3-FN-05: % carries a pinned configuration (proconfig = %). Nothing is replaced, so it is preserved; recorded for the apply log.',
        v_chosen, v_config::text;
    END IF;
    IF NOT pg_has_role(current_user, v_owner, 'USAGE') THEN
      RAISE WARNING 'FIX3-FN-07: % is owned by % and the applying role % is not a member. This migration does not replace the function, so that is not a blocker; recorded because it would block any future replacement.',
        v_chosen, v_owner::regrole, current_user;
    END IF;

    RAISE NOTICE 'FIX3 STEP 7: using % as the updated_at executor (trigger / 0 args / plpgsql / known body; % existing trigger(s) depend on it) — LEFT UNCHANGED.',
      v_chosen, v_ntrig;
  END IF;

  -- ---- the content_block trigger, verified before it is touched ----------
  -- An earlier version ran a bare DROP TRIGGER IF EXISTS + CREATE TRIGGER
  -- outside every DO block, so a pre-existing trigger of that name with a
  -- different executor, timing, event set or WHEN clause was dropped
  -- unexamined. That is the silent-clobber class this file refuses everywhere
  -- else, so it is now enumerated and verified first.
  -- Expected tgtype = 19 = ROW(1) | BEFORE(2) | UPDATE(16), and nothing else.
  --
  -- tgattr IS ALSO READ. `UPDATE OF <column>` stores its column restriction in
  -- pg_trigger.tgattr and leaves tgtype UNCHANGED, so a
  -- `BEFORE UPDATE OF text` trigger has tgtype = 19 exactly like the
  -- unrestricted form. An earlier version did not read tgattr and therefore
  -- reported such a trigger as "matches exactly" while updated_at silently
  -- stopped advancing on every other column's UPDATE. tgnargs is read for the
  -- same reason: a trigger declared with arguments is not this definition.
  SELECT t.tgname, t.tgfoid, t.tgtype, t.tgenabled, (t.tgqual IS NOT NULL),
         COALESCE(array_length(string_to_array(btrim(t.tgattr::text), ' '), 1), 0),
         t.tgnargs, pg_get_triggerdef(t.oid)
    INTO v_tgname, v_tgfoid, v_tgtype, v_tgenabled, v_tghasqual,
         v_tgnattr, v_tgnargs, v_tgdef
    FROM pg_trigger t
   WHERE t.tgrelid = r_block AND NOT t.tgisinternal
     AND t.tgname = 'content_block_set_updated_at';

  -- Any OTHER non-internal trigger on content_block that maintains updated_at
  -- would fire alongside this one.
  --
  -- DETECTED BY BODY, NOT BY NAME — and that is a two-element BODY allowlist,
  -- not a behavioural analysis. An earlier version tested `tgfoid IN` a
  -- hardcoded allowlist of the two function NAMES this file knows. The
  -- production-shaped dump carries 28 zero-argument plpgsql trigger functions
  -- whose bodies normalise to one of this file's accepted strings, so 27
  -- equivalent executors were invisible to that check and a second timestamp
  -- trigger could be added past a guard whose own message claimed to prevent
  -- exactly that. The predicate below instead matches ANY other non-internal
  -- BEFORE UPDATE FOR EACH ROW trigger whose function is a zero-argument
  -- plpgsql trigger function whose NORMALISED SOURCE equals one of the two
  -- strings in v_accepted, using the same normalisation as FN-06. That is name
  -- independent, which is the improvement; it is NOT a claim about behaviour.
  --
  -- STATED LIMIT. A function that maintains updated_at by any other spelling —
  -- `clock_timestamp()`, `timezone('utc', now())`, an extra statement, a
  -- different variable style — does not match v_accepted and is therefore NOT
  -- counted here. The guard is a bound on the KNOWN equivalents, not a proof
  -- that no second timestamp trigger exists. Widening it would mean parsing
  -- function bodies, which this file does not do; the companion verification
  -- script asserts the same bounded property and makes no wider claim.
  SELECT count(*) INTO v_other
    FROM pg_trigger t
    JOIN pg_proc p   ON p.oid = t.tgfoid
    JOIN pg_language l ON l.oid = p.prolang
   WHERE t.tgrelid = r_block AND NOT t.tgisinternal
     AND t.tgname <> 'content_block_set_updated_at'
     AND (t.tgtype & 2) = 2            -- BEFORE
     AND (t.tgtype & 1) = 1            -- FOR EACH ROW
     AND (t.tgtype & 16) = 16          -- UPDATE
     AND p.prorettype = ('trigger'::regtype)::oid
     AND p.pronargs = 0
     AND l.lanname = 'plpgsql'
     AND lower(btrim(regexp_replace(COALESCE(p.prosrc,''), '\s+', ' ', 'g'))) = ANY (v_accepted);
  IF v_other > 0 THEN
    RAISE EXCEPTION
      'FIX3-TRG-02: public.content_block already carries % other non-internal BEFORE UPDATE FOR EACH ROW trigger(s) whose function body is one of the TWO known updated_at equivalents (matched by body against an allowlist — not by name, and NOT by behaviour: a function that maintains updated_at by any other spelling is not counted). Two such triggers would both fire. Refusing to add another; resolve manually. Offenders: %',
      v_other,
      COALESCE((SELECT string_agg(t.tgname || ' => ' || t.tgfoid::regprocedure::text, ' | ')
                  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                       JOIN pg_language l ON l.oid = p.prolang
                 WHERE t.tgrelid = r_block AND NOT t.tgisinternal
                   AND t.tgname <> 'content_block_set_updated_at'
                   AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1 AND (t.tgtype & 16) = 16
                   AND p.prorettype = ('trigger'::regtype)::oid AND p.pronargs = 0
                   AND l.lanname = 'plpgsql'
                   AND lower(btrim(regexp_replace(COALESCE(p.prosrc,''), '\s+', ' ', 'g'))) = ANY (v_accepted)), '(none)');
  END IF;

  IF v_tgname IS NULL THEN
    EXECUTE format(
      'CREATE TRIGGER content_block_set_updated_at BEFORE UPDATE ON public.content_block FOR EACH ROW EXECUTE FUNCTION %s',
      v_chosen);
    RAISE NOTICE 'FIX3 STEP 7: created trigger content_block_set_updated_at executing %.', v_chosen;
  ELSIF v_tgfoid = r_fn AND v_tgtype = 19 AND v_tgenabled = 'O'
        AND NOT v_tghasqual AND v_tgnattr = 0 AND v_tgnargs = 0 THEN
    RAISE NOTICE 'FIX3 STEP 7: trigger content_block_set_updated_at already matches exactly (BEFORE UPDATE FOR EACH ROW, all columns, enabled, no WHEN clause, no arguments, executing %) — LEFT UNCHANGED.', v_chosen;
  ELSE
    RAISE EXCEPTION
      'FIX3-TRG-01: public.content_block already has a trigger named content_block_set_updated_at that does NOT match this migration''s definition. Actual: executor=%, tgtype=% (expected 19 = ROW|BEFORE|UPDATE), enabled=% (expected O), has WHEN clause=% (expected false), column-restricted on % column(s) (expected 0 — an UPDATE OF <column> trigger leaves tgtype unchanged), argument count=% (expected 0). Definition: %. Refusing to drop a trigger this migration did not create; resolve manually.',
      v_tgfoid::regprocedure, v_tgtype, v_tgenabled, v_tghasqual, v_tgnattr, v_tgnargs, v_tgdef;
  END IF;
END $fixthree$;


-- ===========================================================================
-- STEP 8 — RLS + POLICIES
--
-- WHAT THESE POLICIES ACTUALLY DO, stated accurately. RLS here is DEFENCE IN
-- DEPTH against direct PostgREST access, not the operative tenant boundary:
--   - public.user_company_roles itself has RLS enabled with only a service_role
--     policy, so the sub-select in the predicate below returns no rows for anon
--     or authenticated, and for those roles the net effect of these policies is
--     indistinguishable from RLS-enabled-with-no-policy: default deny.
--   - The service role has BYPASSRLS, and every application path to these four
--     tables uses it (backend/db/supabaseClient.ts). These policies do NOT
--     constrain it.
--   - RLS is ENABLEd, not FORCEd, so the owning role — including the role that
--     applies this migration — is not subject to the policies either. (FORCE
--     would not help against a BYPASSRLS role; it would only bind the owner.)
--   - This migration issues NO GRANT or REVOKE, so whether anon/authenticated
--     can reach these four new tables through PostgREST at all depends on the
--     applying role's default privileges in schema public. That is an
--     environment setting this file does not control and does not assert.
-- THE OPERATIVE TENANT BOUNDARY for these tables is therefore: the DECISION B
-- composite foreign keys (which bind even the service role, because they are
-- constraints), plus route authorization, plus explicit company scoping in the
-- backend/services/content/* writers THAT HAVE IT. That qualifier is load
-- bearing: an earlier version of this sentence claimed the filtering as a
-- property of those services generally, and it is not one.
-- contentService.upsertVariant, in that same directory, writes with the
-- conflict target 'content_id,platform' — no company column — and its route
-- never proves the supplied content id belongs to the caller's company. That
-- path is an OPEN OWNER DECISION recorded below, not a boundary. RLS alone
-- does NOT guarantee tenant isolation here, and nothing in this file should be
-- read as claiming it does. content_quality is additionally outside the
-- composite-FK guarantee entirely.
--
-- HOW THE ALREADY-EXISTS PATH IS VERIFIED. No predicate string is compared: the
-- qual/with_check columns hold PostgreSQL's DEPARSED form, and comparing them
-- against a hand-written expectation is what made an earlier version abort on a
-- RE-RUN against a correct schema. Instead the existing policy is verified
-- against catalog facts that are independent of deparsing, and is then DROPPED
-- AND RECREATED from this migration's own definition — `DROP POLICY IF EXISTS` +
-- `CREATE POLICY` being the guarded pattern the repository prescribes for
-- statements that lack IF NOT EXISTS. Recreating, rather than accepting, is what
-- makes the step rerunnable: the predicate afterwards is this file's.
--
-- WHAT THE FIVE CHECKS DO AND DO NOT ESTABLISH. Dropping is gated on: exactly
-- one policy on the table; its name being this migration's `<table>_company_rw`;
-- polcmd = '*', permissive, granted to PUBLIC; both USING and WITH CHECK
-- present; and a real pg_depend dependency on public.user_company_roles, proven
-- from the catalog rather than by matching a substring. Together these establish
-- the policy's SHAPE and its DEPENDENCY on the membership table. They do NOT
-- establish semantic equivalence: two different expressions over
-- user_company_roles both pass, including one STRICTER than this file's (for
-- example additionally requiring an owner/admin role), which would then be
-- replaced by this file's looser predicate; and an unconditional predicate
-- written as `EXISTS (SELECT 1 FROM user_company_roles)` or `1 = 1` does not
-- deparse to `true`, so the literal-true test below does not catch it — it
-- would be REPLACED by the correct predicate rather than preserved. These checks
-- are a guard against overwriting an unrelated object, not a proof of
-- correctness; the RECREATION is what makes the end state known. The NOTICE
-- below prints the predicate being discarded so a privilege change lands in the
-- apply log.
--
-- KNOWN FALSE-ABORT CASES, recorded as open items rather than fixed here:
-- four per-command policies, a correct policy plus a RESTRICTIVE deny policy,
-- a policy granted TO authenticated rather than PUBLIC, and a policy reaching
-- membership through a SECURITY DEFINER helper, are all strictly safer than what
-- this file installs and each aborts this step.
-- No static analysis can establish runtime RLS enforcement; only execution can.
-- ===========================================================================
ALTER TABLE public.content_quality          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_block            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_recommendation   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_approval_history ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t            text;
  pol          text;
  v_policy_oid oid;
  v_count      int;
  v_name       text;
  v_cmd        "char";
  v_permissive boolean;
  v_roles      oid[];
  v_has_qual   boolean;
  v_has_check  boolean;
  v_qual_text  text;
  v_check_text text;
  v_depends    boolean;
  r_tbl        regclass;
  r_ucr        regclass := to_regclass('public.user_company_roles');
BEGIN
  FOREACH t IN ARRAY ARRAY['content_quality','content_block','content_recommendation','content_approval_history'] LOOP
    pol   := t || '_company_rw';
    r_tbl := to_regclass('public.' || t);
    IF r_tbl IS NULL THEN
      RAISE EXCEPTION 'FIX3-RLS-02: public.% is absent at STEP 8.', t;
    END IF;

    SELECT count(*) INTO v_count FROM pg_policy WHERE polrelid = r_tbl;

    IF v_count > 0 THEN
      IF v_count <> 1 THEN
        RAISE EXCEPTION
          'FIX3-RLS-01: public.% carries % policies; this migration models exactly one (%). Refusing to drop or merge an unmodelled access path — resolve manually.',
          t, v_count, pol;
      END IF;

      SELECT p.oid, p.polname, p.polcmd, p.polpermissive, p.polroles,
             (p.polqual IS NOT NULL), (p.polwithcheck IS NOT NULL),
             btrim(COALESCE(pg_get_expr(p.polqual, p.polrelid), '')),
             btrim(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''))
        INTO v_policy_oid, v_name, v_cmd, v_permissive, v_roles,
             v_has_qual, v_has_check, v_qual_text, v_check_text
        FROM pg_policy p WHERE p.polrelid = r_tbl;

      IF v_name IS DISTINCT FROM pol THEN
        RAISE EXCEPTION
          'FIX3-RLS-01: the single policy on public.% is named %, not %. Refusing to drop a policy whose shape this migration does not model — resolve manually.',
          t, v_name, pol;
      END IF;

      IF v_cmd IS DISTINCT FROM '*' OR v_permissive IS NOT TRUE OR v_roles IS DISTINCT FROM ARRAY[0]::oid[] THEN
        RAISE EXCEPTION
          'FIX3-RLS-01: policy % on public.% has an unexpected shape (polcmd=%, permissive=%, roles=%); expected ALL / PERMISSIVE / PUBLIC. Resolve manually.',
          pol, t, v_cmd, v_permissive, v_roles;
      END IF;

      IF NOT v_has_qual OR NOT v_has_check THEN
        RAISE EXCEPTION
          'FIX3-RLS-01: policy % on public.% is missing USING or WITH CHECK (using=%, with_check=%). Resolve manually.',
          pol, t, v_has_qual, v_has_check;
      END IF;

      -- A literal-true predicate is unconditional cross-tenant access. This is a
      -- literal test only; see the step header for what it does not catch.
      IF v_qual_text IN ('true', '(true)') OR v_check_text IN ('true', '(true)') THEN
        RAISE EXCEPTION
          'FIX3-RLS-01: policy % on public.% is UNCONDITIONAL (true). That is cross-tenant access and is never this migration''s policy. Resolve manually.',
          pol, t;
      END IF;

      IF r_ucr IS NULL THEN
        RAISE EXCEPTION 'FIX3-RLS-01: public.user_company_roles is absent; cannot verify policy % on public.%.', pol, t;
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid    = 'pg_policy'::regclass
          AND d.objid      = v_policy_oid
          AND d.refclassid = 'pg_class'::regclass
          AND d.refobjid   = r_ucr
      ) INTO v_depends;
      IF NOT v_depends THEN
        RAISE EXCEPTION
          'FIX3-RLS-01: policy % on public.% does not depend on public.user_company_roles, so it does not scope by company membership. Resolve manually.',
          pol, t;
      END IF;

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
      RAISE NOTICE 'FIX3 STEP 8: policy % on % verified by shape + dependency; RECREATING from this migration. The discarded USING predicate was: %. The discarded WITH CHECK was: %',
        pol, t, v_qual_text, v_check_text;
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = ''active'')) WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = ''active''))',
      pol, t
    );
    RAISE NOTICE 'FIX3 STEP 8: policy % on % created.', pol, t;
  END LOOP;
END $$;


COMMIT;
