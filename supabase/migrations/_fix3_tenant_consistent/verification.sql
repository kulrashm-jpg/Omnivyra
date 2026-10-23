-- ============================================================================
-- FIX 3 — VERIFICATION ONLY. THIS IS NOT AN APPLICATION SCRIPT.
--
-- It creates nothing, alters nothing and drops nothing. It reads the catalog and
-- RAISES an exception naming the first discrepancy it finds. The only SUCCESS
-- signal is the single final NOTICE; any failure is an exception. Note that a
-- successful run may ALSO emit WARNINGs — the security-mode and pinned-
-- configuration observations below are warnings, not assertions — so "one
-- NOTICE and nothing else" would be inaccurate.
--
-- WHAT IT PROVES (from the catalog, structurally):
--   - the four tables exist and are ordinary tables;
--   WHAT THIS SCRIPT DOES NOT ASSERT, stated here because a reader running it
--   standalone would otherwise assume it covers the migration's own
--   preconditions. It asserts NONE of them: not public.content.lifecycle_status
--   being exactly `text` (migration PRECOND-15), not content.company_id being
--   NOT NULL (PRECOND-05), not the three user_company_roles columns the STEP 8
--   predicate reads (PRECOND-16/17/18), not auth.uid() being resolvable
--   (PRECOND-19), and not the PostgreSQL version floor that confdelsetcols
--   needs (PRECOND-00 — so on a PG 14 target this script dies with a bare
--   42703 rather than a named identifier). A post-apply drift in any of those
--   passes this script while the policies or the lifecycle CHECK break at run
--   time. The migration asserts them; this script does not re-assert them.
--
--   - all 37 required columns, with their type (exactly, or by family where the
--     migration accepts a family), nullability where this design depends on it,
--     and the PRESENCE of a default where one is required;
--   - a usable unique key over id on each of the four tables;
--   - both vocabulary CHECKs and the lifecycle CHECK are in the ONE supported
--     definition form, compared BYTE-EXACTLY (case and literal contents
--     preserved; only element order is immaterial);
--   - two composite unique keys usable as foreign-key targets;
--   - all four composite foreign keys, with referencing and referenced columns
--     in order and with every delete action, update action, match type,
--     validation state, deferrability and delete-set-column property;
--   - that each child carries EXACTLY the expected number of foreign keys, both
--     to its modelled parent and in total — so a surviving legacy FK, a
--     same-column twin, or an FK to an unmodelled relation is caught;
--   - public.content_quality carries NO foreign key at all;
--   - the eight indexes: usability (valid/ready/live), non-uniqueness, access
--     method, key columns in order, absence of INCLUDE columns, per-column
--     ordering options, default operator class and collation, and the TEXT of
--     the partial predicate — so an inverted predicate is caught;
--   - the updated_at executor's return type, argument count, language and
--     normalised body (its security mode and pinned configuration are REPORTED
--     AS WARNINGS, not asserted);
--   - the content_block trigger's executor, timing, event set, row mode,
--     enabled state, absence of a WHEN clause and absence of a column
--     restriction, and that no second trigger on the table runs a function whose
--     normalised body is one of TWO known updated_at equivalents — matched by
--     the function's BODY, not by a name allowlist, and not by behaviour: a
--     function maintaining updated_at by another spelling is not detected (see
--     the STATED LIMIT at that assertion);
--   - RLS enabled on all four tables with exactly one policy of the modelled
--     shape, depending on public.user_company_roles;
--   - AUDIT-PRESERVATION PARITY with the migration's FIX3-AUDIT-00/01/02/03:
--     that none of the five relations in this family (the four it owns plus
--     public.content) carries a non-internal DELETE trigger, a non-internal
--     TRUNCATE trigger or a rewrite rule, and that each is an ordinary
--     unpartitioned table so those two censuses are a complete population for
--     it. This covers the window the migration cannot: a trigger or rule added
--     AFTER it applied. It does not prove audit rows survive a delete — see
--     WHAT IT DOES NOT PROVE below.
--
-- WHAT IT DOES NOT PROVE — read this before treating a pass as reassurance:
--   - NOTHING BEHAVIOURAL. It does NOT establish by execution that an INSERT of
--     lifecycle_status = 'quality_reviewed' is accepted. It asserts the CHECK's
--     exact definition form instead. No behavioural probe exists anywhere in
--     this repository; adding one would be a data operation requiring separate
--     authorization. If you need proof of acceptance, that is the authorization
--     to ask for.
--   - It does not attempt an INSERT in a rolled-back savepoint and does not
--     dynamically evaluate any catalog expression. Either technique would make
--     this file execute something rather than read something.
--   - It does not establish POLICY SEMANTICS. RLS here is defence in depth, not
--     the operative tenant boundary: public.user_company_roles is itself
--     RLS-closed to anon/authenticated, the service role bypasses RLS, and RLS
--     is ENABLEd rather than FORCEd, so the owning role is exempt. Tenant
--     isolation for these tables rests on the composite foreign keys, route
--     authorization and the explicit company filtering in
--     backend/services/content/*. A pass here says nothing about that.
--   - It does not establish that a restriction OUTSIDE a CHECK constraint — a
--     trigger or rule on public.content — does not reject a lifecycle value.
--     Section 11 reads triggers and rules on that relation, but for the
--     DELETE/TRUNCATE/rule-existence properties only; a BEFORE INSERT trigger
--     rejecting a lifecycle value passes both it and this script.
--   - Section 11 does not prove audit rows SURVIVE a delete. It proves that no
--     trigger or rule of the three listed kinds exists at the moment it runs,
--     over these five relations' OWN oids and nothing else. DELETE
--     permissions, RLS on the audit table, application code that deletes audit
--     rows directly, and triggers or rules on any OTHER table that cascade into
--     this family are all outside it — the same stated limits the migration's
--     own audit step carries.
--   - It does not check GRANTs or default privileges, so it says nothing about
--     whether these tables are reachable through PostgREST.
--
-- `scripts/verify-schema-parity.js` is NOT a substitute: its manifest carries
-- only two columns per table, all at WARN severity, and checks column presence
-- only — never CHECK definitions, defaults, keys, index definitions, foreign-key
-- delete actions, triggers or RLS.
--
-- IT LIVES IN A SUBDIRECTORY ON PURPOSE. scripts/check-migration-quality.js
-- validates only top-level supabase/migrations/*.sql files; subdirectory
-- companions are intentionally exempt. Placing it here keeps it out of the
-- migration sequence so no tool can mistake it for a migration to apply.
--
-- HOW TO RUN. Paste into the Supabase SQL editor against the target database,
-- AFTER the migration has been applied as a separately authorized step. It needs
-- only read access to the catalog.
-- ============================================================================

DO $verify$
DECLARE
  spec      record;
  r_tbl     regclass;
  r_parent  regclass;
  r_idx     regclass;
  v_type    text;
  v_notnull boolean;
  v_hasdef  boolean;
  v_valid   boolean;
  v_typeok  boolean;
  v_cnt     int;
  v_nkeys   int;
  v_name    text;
  v_def     text;
  v_norm    text;
  v_pre     text;
  v_suf     text;
  v_inner   text;
  v_got     text[];
  v_exp     text[];
  v_form_ok boolean;
  v_cols    text[];
  v_opts    smallint[];
  v_partial boolean;
  v_idxvalid boolean;
  v_idxready boolean;
  v_idxlive  boolean;
  v_unique  boolean;
  v_am      text;
  v_nkeyatt int;
  v_natt    int;
  v_pred    text;
  v_relkind "char";
  v_bad     text;
  v_nine    text[] := ARRAY['draft','generated','edited','approved','adapted','scheduled','published','archived','quality_reviewed'];
  a_col     smallint;
  a_company smallint;
  a_id      smallint;
  a_child   smallint[];
  a_parent  smallint[];
  a_setcols smallint[];
  v_secdef  boolean;
  v_config  text[];
  v_src     text;
  r_fn      oid;
  v_chosen  text;
  v_tgtype  smallint;
  v_tgen    "char";
  v_tgnattr int;
  v_tgnargs int;
  v_accepted text[] := ARRAY[
                'begin new.updated_at = now(); return new; end;',
                'begin new.updated_at := now(); return new; end;'
              ];
BEGIN

-- ---------------------------------------------------------------------------
-- 1. Tables exist and are ordinary tables.
-- ---------------------------------------------------------------------------
FOR spec IN
  SELECT * FROM (VALUES
    ('content_quality'), ('content_block'), ('content_recommendation'), ('content_approval_history')
  ) AS v(tbl)
LOOP
  r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
  IF r_tbl IS NULL THEN
    RAISE EXCEPTION 'FIX3-VERIFY-01: public.% does not exist. The migration did not apply.', spec.tbl;
  END IF;
  -- PARITY WITH THE MIGRATION'S FIX3-FK-17, which requires relkind 'r' exactly.
  -- This predicate accepted ('r','p') while its own message said "is not an
  -- ordinary table", so the artifact ACCEPTED a partitioned table the migration
  -- REFUSES — the two halves of one gate disagreeing, which is the class of
  -- defect the index-relkind parity fix already closed. They now agree on 'r'.
  IF (SELECT relkind FROM pg_class WHERE oid = r_tbl) <> 'r' THEN
    RAISE EXCEPTION 'FIX3-VERIFY-01: public.% is not an ordinary table (relkind=%). relkind p (partitioned) is rejected here as it is by the migration''s FIX3-FK-17, whose conrelid-scoped foreign-key census is only complete for an unpartitioned relation.',
      spec.tbl, (SELECT relkind FROM pg_class WHERE oid = r_tbl);
  END IF;
  -- AND THE SAME pg_inherits CONDITION, which the artifact asserted nowhere: its
  -- own VERIFY-07 foreign-key census is conrelid-scoped exactly as the
  -- migration's is, so passing this script did not establish the census
  -- completeness FK-17 insists on.
  IF EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = r_tbl OR inhrelid = r_tbl) THEN
    RAISE EXCEPTION 'FIX3-VERIFY-01: public.% takes part in an inheritance or partitioning hierarchy, so this script''s conrelid-scoped foreign-key census is not a complete population for it.', spec.tbl;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 2. All 37 required columns. `kind` matches the migration's STEP 1B:
--    'exact' = format_type equality; 'char' = any character type;
--    'numeric' = numeric with or without typmod.
--    want_notnull / want_hasdef: TRUE required, FALSE required absent,
--    NULL not asserted.
--    NOTE content_approval_history.content_id is asserted NULLABLE here (FALSE)
--    whereas the migration's STEP 1B deliberately does not assert it — after
--    the migration, DECISION C is in force. That is the ONE intended divergence
--    between the two manifests.
-- ---------------------------------------------------------------------------
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
    ('content_approval_history','content_id',    'uuid',                     'exact',   FALSE,         NULL::boolean),
    ('content_approval_history','from_status',   'text',                     'char',    NULL::boolean, NULL::boolean),
    ('content_approval_history','to_status',     'text',                     'char',    TRUE,          NULL::boolean),
    ('content_approval_history','actor',         'uuid',                     'exact',   NULL::boolean, NULL::boolean),
    ('content_approval_history','note',          'text',                     'char',    NULL::boolean, NULL::boolean),
    ('content_approval_history','created_at',    'timestamp with time zone', 'exact',   TRUE,          TRUE)
  ) AS v(tbl, col, want, kind, want_notnull, want_hasdef)
LOOP
  r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
  SELECT format_type(atttypid, atttypmod), attnotnull, atthasdef
    INTO v_type, v_notnull, v_hasdef
    FROM pg_attribute WHERE attrelid = r_tbl AND attname = spec.col
      AND attnum > 0 AND NOT attisdropped;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'FIX3-VERIFY-02: public.%.% is absent (expected %).', spec.tbl, spec.col, spec.want;
  END IF;
  v_typeok := CASE spec.kind
    WHEN 'exact'   THEN v_type = spec.want
    WHEN 'char'    THEN v_type IN ('text','character varying') OR v_type LIKE 'character varying(%'
    WHEN 'numeric' THEN v_type = 'numeric' OR v_type LIKE 'numeric(%'
    ELSE FALSE END;
  IF NOT v_typeok THEN
    RAISE EXCEPTION 'FIX3-VERIFY-02: public.%.% is % (expected % — comparison kind %).',
      spec.tbl, spec.col, v_type, spec.want, spec.kind;
  END IF;
  IF spec.want_notnull IS TRUE AND NOT v_notnull THEN
    RAISE EXCEPTION 'FIX3-VERIFY-02: public.%.% is nullable (expected NOT NULL).', spec.tbl, spec.col;
  END IF;
  IF spec.want_notnull IS FALSE AND v_notnull THEN
    RAISE EXCEPTION 'FIX3-VERIFY-02: public.%.% is NOT NULL (expected nullable).', spec.tbl, spec.col;
  END IF;
  IF spec.want_hasdef IS TRUE AND NOT v_hasdef THEN
    RAISE EXCEPTION 'FIX3-VERIFY-02: public.%.% has no DEFAULT (one is required).', spec.tbl, spec.col;
  END IF;
  IF spec.want_hasdef IS FALSE AND v_hasdef THEN
    RAISE EXCEPTION 'FIX3-VERIFY-02: public.%.% has a DEFAULT and none is expected.', spec.tbl, spec.col;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 3. A usable unique key over id on each of the four tables — either on exactly
--    (id) or on exactly (company_id, id), matching the migration's SHAPE-07.
-- ---------------------------------------------------------------------------
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
      AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (
        ( i.indnkeyatts = 1 AND (string_to_array(i.indkey::text,' ')::smallint[])[1] = a_id )
        OR
        ( i.indnkeyatts = 2
          AND (SELECT array_agg(t.attnum ORDER BY t.attnum)
                 FROM unnest(string_to_array(i.indkey::text,' ')::smallint[])
                        WITH ORDINALITY AS t(attnum, ord)
                WHERE t.ord <= i.indnkeyatts)
              = (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[a_company, a_id]) k) )
      )
  ) THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-03: public.% has no usable unique key on exactly (id) nor on exactly (company_id, id).', spec.tbl;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 4. Vocabulary CHECKs — WHOLE definition must be the one supported form.
--    The prefix and suffix must consume the entire normalised string, so an
--    extra conjunct, a negation or any wrapper cannot hide inside it. Elements
--    are then compared against CONSTRUCTED expected elements, order
--    insensitively. NOTHING IS NORMALISED: the definition is compared byte for
--    byte against `CHECK ((<col> = ANY (ARRAY[<elements>])))`, the exact output
--    of single-argument pg_get_constraintdef, with `, ` as the element
--    separator. It is neither lower-cased nor whitespace-stripped, so a CHECK
--    whose literals differ in case fails to match — fail-closed, and the same
--    comparison the migration performs. (The index PREDICATE comparison in
--    section 8 does normalise case and whitespace; that is a different check
--    and says so there.)
-- ---------------------------------------------------------------------------
FOR spec IN
  SELECT * FROM (VALUES
    ('content_block','block_type',      ARRAY['hook','opening','body','cta','hashtags','other']),
    ('content_recommendation','status', ARRAY['pending','accepted','rejected','superseded'])
  ) AS v(tbl, col, want_lits)
LOOP
  r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
  SELECT attnum INTO a_col FROM pg_attribute
    WHERE attrelid = r_tbl AND attname = spec.col AND attnum > 0 AND NOT attisdropped;
  SELECT count(*) INTO v_cnt FROM pg_constraint
    WHERE conrelid = r_tbl AND contype = 'c' AND a_col = ANY (conkey);
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'FIX3-VERIFY-04: public.%.% is covered by % CHECK constraint(s); exactly 1 expected.',
      spec.tbl, spec.col, v_cnt;
  END IF;
  SELECT conname, pg_get_constraintdef(oid), array_length(conkey,1), convalidated
    INTO v_name, v_def, v_nkeys, v_valid
    FROM pg_constraint WHERE conrelid = r_tbl AND contype = 'c' AND a_col = ANY (conkey);
  IF v_nkeys IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FIX3-VERIFY-04: CHECK % on public.% spans % column(s); 1 expected.',
      v_name, spec.tbl, COALESCE(v_nkeys,0);
  END IF;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'FIX3-VERIFY-04: CHECK % on public.%.% is NOT VALID.', v_name, spec.tbl, spec.col;
  END IF;

  -- NOTHING IS NORMALISED, matching the migration's STEP 1B exactly. An earlier
  -- version of BOTH files lowercased and whitespace-stripped the ACTUAL
  -- definition while building the expected elements unfolded — fail-OPEN on the
  -- literal payload, and identically so here, which is why this script could not
  -- have caught it. The comparison is byte-exact against PostgreSQL's
  -- deterministic deparse, with element order the only variable part.
  v_pre  := 'CHECK ((' || spec.col || ' = ANY (ARRAY[';
  v_suf  := '])))';
  v_form_ok := length(v_def) > length(v_pre) + length(v_suf)
           AND left(v_def, length(v_pre)) = v_pre
           AND right(v_def, length(v_suf)) = v_suf;
  IF NOT v_form_ok THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-04: CHECK % on public.%.% is not in the one supported definition form (the WHOLE definition must be exactly CHECK ((% = ANY (ARRAY[''a''::text, …])))). Actual: %.',
      v_name, spec.tbl, spec.col, spec.col, v_def;
  END IF;
  v_inner := substr(v_def, length(v_pre)+1, length(v_def)-length(v_pre)-length(v_suf));
  SELECT array_agg(e ORDER BY e) INTO v_got FROM unnest(string_to_array(v_inner, ', ')) AS e;
  SELECT array_agg(quote_literal(w) || '::text' ORDER BY quote_literal(w) || '::text') INTO v_exp
    FROM unnest(spec.want_lits) AS w;
  IF v_got IS DISTINCT FROM v_exp THEN
    RAISE EXCEPTION 'FIX3-VERIFY-04: CHECK % on public.%.% has the supported form but its element list is %, expected % (compared case-sensitively, literal contents preserved). Definition: %.',
      v_name, spec.tbl, spec.col, COALESCE(v_got::text,'{}'), v_exp::text, v_def;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 5. Lifecycle CHECK — same whole-definition technique. This is the assertion
--    that stands in for a behavioural probe, so its limit is restated here:
--    it establishes the constraint's DEFINITION, not that an INSERT of
--    'quality_reviewed' succeeds.
-- ---------------------------------------------------------------------------
r_tbl := to_regclass('public.content');
IF r_tbl IS NULL THEN
  RAISE EXCEPTION 'FIX3-VERIFY-05: public.content does not exist.';
END IF;
SELECT attnum INTO a_col FROM pg_attribute
  WHERE attrelid = r_tbl AND attname = 'lifecycle_status' AND attnum > 0 AND NOT attisdropped;
IF a_col IS NULL THEN
  RAISE EXCEPTION 'FIX3-VERIFY-05: public.content.lifecycle_status is absent.';
END IF;
SELECT count(*) INTO v_cnt FROM pg_constraint
  WHERE conrelid = r_tbl AND contype = 'c' AND a_col = ANY (conkey);
IF v_cnt <> 1 THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-05: % CHECK constraint(s) cover public.content.lifecycle_status; exactly 1 expected. With more than one, the permitted domain is their CONJUNCTION and may still reject quality_reviewed even though a nine-value CHECK is present.',
    v_cnt;
END IF;
SELECT conname, pg_get_constraintdef(oid), array_length(conkey,1), convalidated
  INTO v_name, v_def, v_nkeys, v_valid
  FROM pg_constraint WHERE conrelid = r_tbl AND contype = 'c' AND a_col = ANY (conkey);
IF v_nkeys IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'FIX3-VERIFY-05: lifecycle CHECK % spans % column(s); 1 expected. Definition: %.',
    v_name, COALESCE(v_nkeys,0), v_def;
END IF;
IF NOT v_valid THEN
  RAISE EXCEPTION 'FIX3-VERIFY-05: lifecycle CHECK % is NOT VALID; existing rows were never checked. Definition: %.',
    v_name, v_def;
END IF;
-- NOTHING IS NORMALISED — see section 4. Byte-exact against PostgreSQL's
-- deterministic deparse, so an altered literal (case or whitespace INSIDE a
-- quoted value) is a mismatch rather than harmless formatting, while element
-- ORDER remains immaterial.
v_pre  := 'CHECK ((lifecycle_status = ANY (ARRAY[';
v_suf  := '])))';
v_form_ok := length(v_def) > length(v_pre) + length(v_suf)
         AND left(v_def, length(v_pre)) = v_pre
         AND right(v_def, length(v_suf)) = v_suf;
IF NOT v_form_ok THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-05: lifecycle CHECK % is not in the one supported definition form. The WHOLE definition must be exactly CHECK ((lifecycle_status = ANY (ARRAY[''a''::text, …]))) and nothing else, so that no extra condition, negation, wrapper, cast or whitespace variation can hide inside it. Actual: %.',
    v_name, v_def;
END IF;
v_inner := substr(v_def, length(v_pre)+1, length(v_def)-length(v_pre)-length(v_suf));
SELECT array_agg(e ORDER BY e) INTO v_got FROM unnest(string_to_array(v_inner, ', ')) AS e;
SELECT array_agg(quote_literal(w) || '::text' ORDER BY quote_literal(w) || '::text') INTO v_exp
  FROM unnest(v_nine) AS w;
IF v_got IS DISTINCT FROM v_exp THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-05: lifecycle CHECK % has the supported form but its element list is %, expected exactly the nine % (compared case-sensitively, literal contents preserved). Definition: %.',
    v_name, COALESCE(v_got::text,'{}'), v_exp::text, v_def;
END IF;

-- ---------------------------------------------------------------------------
-- 6. Composite unique keys usable as FK targets on content and content_block.
--    A CONSTRAINT-backed key and a BARE unique index are both accepted: the
--    migration reuses an equivalent pre-existing key, so the named constraint
--    is not guaranteed to exist.
-- ---------------------------------------------------------------------------
FOR spec IN
  SELECT * FROM (VALUES ('public.content'), ('public.content_block')) AS v(tbl)
LOOP
  r_tbl := to_regclass(spec.tbl);
  SELECT attnum INTO a_company FROM pg_attribute
    WHERE attrelid = r_tbl AND attname = 'company_id' AND attnum > 0 AND NOT attisdropped;
  SELECT attnum INTO a_id FROM pg_attribute
    WHERE attrelid = r_tbl AND attname = 'id' AND attnum > 0 AND NOT attisdropped;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = r_tbl
      AND i.indisunique AND i.indimmediate AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 2
      AND (SELECT array_agg(t.attnum ORDER BY t.attnum)
             FROM unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                    WITH ORDINALITY AS t(attnum, ord)
            WHERE t.ord <= i.indnkeyatts)
          = (SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[a_company, a_id]) k)
  ) THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-06: % has no usable unique key on (company_id, id) — unique, immediate, valid, non-partial, non-expression, exactly those two key columns. The composite foreign keys cannot reference it.',
      spec.tbl;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 7. The four composite foreign keys, with every property asserted.
-- ---------------------------------------------------------------------------
FOR spec IN
  SELECT * FROM (VALUES
    ('public.content_block',            'public.content',       ARRAY['company_id','content_id'], 'c', NULL::text,   'content_block_content_fk'),
    ('public.content_recommendation',   'public.content',       ARRAY['company_id','content_id'], 'c', NULL::text,   'content_recommendation_content_fk'),
    ('public.content_recommendation',   'public.content_block', ARRAY['company_id','block_id'],   'c', NULL::text,   'content_recommendation_block_fk'),
    ('public.content_approval_history', 'public.content',       ARRAY['company_id','content_id'], 'n', 'content_id', 'content_approval_history_content_fk')
  ) AS v(child, parent, childcols, deltype, setcols, fkname)
LOOP
  r_tbl    := to_regclass(spec.child);
  r_parent := to_regclass(spec.parent);
  SELECT array_agg(a.attnum ORDER BY x.ord) INTO a_child
    FROM unnest(spec.childcols) WITH ORDINALITY AS x(cname, ord)
    JOIN pg_attribute a ON a.attrelid = r_tbl AND a.attname = x.cname
                       AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT array_agg(a.attnum ORDER BY x.ord) INTO a_parent
    FROM unnest(ARRAY['company_id','id']) WITH ORDINALITY AS x(cname, ord)
    JOIN pg_attribute a ON a.attrelid = r_parent AND a.attname = x.cname
                       AND a.attnum > 0 AND NOT a.attisdropped;
  IF spec.setcols IS NULL THEN
    a_setcols := NULL;
  ELSE
    SELECT array_agg(a.attnum) INTO a_setcols FROM pg_attribute a
      WHERE a.attrelid = r_tbl AND a.attname = spec.setcols
        AND a.attnum > 0 AND NOT a.attisdropped;
    IF a_setcols IS NULL THEN
      RAISE EXCEPTION 'FIX3-VERIFY-07: % is missing the SET NULL column %, so the delete action cannot be verified.',
        spec.child, spec.setcols;
    END IF;
  END IF;

  SELECT count(*) INTO v_cnt FROM pg_constraint k
    WHERE k.conrelid = r_tbl AND k.contype = 'f' AND k.confrelid = r_parent
      AND k.conkey = a_child AND k.confkey = a_parent
      AND k.confdeltype   = spec.deltype
      AND k.confupdtype   = 'a'
      AND k.confmatchtype = 's'
      AND k.convalidated
      AND NOT k.condeferrable
      AND NOT k.condeferred
      AND k.confdelsetcols IS NOT DISTINCT FROM a_setcols;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-07: % has % fully-compatible composite FK(s) to % on %; exactly 1 expected (on_delete=%, on_update=a, match=s, validated, non-deferrable, delsetcols=%). Actual FKs: %',
      spec.child, v_cnt, spec.parent, spec.childcols::text, spec.deltype, COALESCE(a_setcols::text,'NULL'),
      COALESCE((SELECT string_agg(k.conname || ' => ' || pg_get_constraintdef(k.oid), ' | ')
                  FROM pg_constraint k
                 WHERE k.conrelid = r_tbl AND k.contype = 'f' AND k.confrelid = r_parent), '(none)');
  END IF;

  -- EXACTLY ONE foreign key from this child to this parent may exist — the
  -- fully-compatible one counted above. An earlier version counted only FKs
  -- whose `conkey <> a_child`, which missed the case that matters most: a
  -- SECOND FK on the SAME columns (for instance a bare `ON DELETE SET NULL`
  -- twin, whose delete action would null the NOT NULL company_id). Counting
  -- the total instead catches both the surviving legacy single-column cascade
  -- and the same-column twin.
  SELECT count(*) INTO v_cnt FROM pg_constraint k
    WHERE k.conrelid = r_tbl AND k.contype = 'f' AND k.confrelid = r_parent;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-07: % carries % foreign key(s) to %; exactly 1 is expected. A surviving legacy single-column FK, or a second FK on the same columns, would still enforce its own delete action. Actual: %',
      spec.child, v_cnt, spec.parent,
      COALESCE((SELECT string_agg(k.conname || ' => ' || pg_get_constraintdef(k.oid), ' | ')
                  FROM pg_constraint k
                 WHERE k.conrelid = r_tbl AND k.contype = 'f' AND k.confrelid = r_parent), '(none)');
  END IF;
END LOOP;

-- NO FOREIGN KEY TO ANY OTHER PARENT either. The per-spec checks above are
-- scoped to the spec'd parent, so an earlier version's claim of "no surviving
-- legacy FK" was really "none to the SAME parent": a legacy FK pointing at a
-- different relation survived undetected.
-- The expected totals below are the complete FK inventory for these tables, and
-- they are the SAME four totals the migration itself now reconciles in STEP 4
-- (FIX3-FK-13 / FK-14 / FK-15, plus FK-16 for an absent child table), so this
-- script and the migration examine the
-- same population and claim the same numbers. Before that reconciliation
-- existed, the migration's own census was per-pair and this script was the only
-- place an FK to an unmodelled relation was caught — a state the migration
-- could commit and its verifier then reject.
FOR spec IN
  SELECT * FROM (VALUES
    ('public.content_block',            1),   -- → content
    ('public.content_recommendation',   2),   -- → content, → content_block
    ('public.content_approval_history', 1),   -- → content
    ('public.content_quality',          0)    -- soft reference, by owner decision
  ) AS v(tbl, want_total)
LOOP
  r_tbl := to_regclass(spec.tbl);
  SELECT count(*) INTO v_cnt FROM pg_constraint
    WHERE conrelid = r_tbl AND contype = 'f';
  IF v_cnt <> spec.want_total THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-07: % carries % foreign key(s) in total; exactly % expected. An unexpected FK — including one to a relation this migration does not model, and including any FK on content_quality, whose content_id is a SOFT reference by owner decision — is a silent design change. Actual: %',
      spec.tbl, v_cnt, spec.want_total,
      COALESCE((SELECT string_agg(k.conname || ' => ' || pg_get_constraintdef(k.oid), ' | ')
                  FROM pg_constraint k WHERE k.conrelid = r_tbl AND k.contype = 'f'), '(none)');
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 8. The eight indexes.
--
--    PARITY NOTE. Every index property this section checks is now ALSO checked
--    by the migration itself, both before creation (FIX3-IDX-01 … IDX-03i) and
--    after (FIX3-IDX-04), using the same catalog predicates and the same
--    expectation table. That was previously untrue of the per-column ordering
--    options, the operator class and the collation, which this script alone
--    asserted — and since this script is a separate manual paste that nothing
--    makes a condition of the migration applying, those three properties were
--    effectively ungated. This section is therefore now a genuine SECOND
--    reading of the same facts rather than the only reading of some of them.
--
--    Checked: existence, relkind, host table, NON-uniqueness,
--    btree access method, no INCLUDE columns, key columns by name IN ORDER,
--    per-column ordering options (so a DESC/ASC flip is caught), partiality AND
--    the TEXT of the partial predicate (so an INVERTED predicate is caught).
--
--    indoption VALUES (not bit positions): INDOPTION_DESC = 1,
--    INDOPTION_NULLS_FIRST = 2.
--
--    CRITICAL, AND PREVIOUSLY WRONG: in CREATE INDEX, **NULLS FIRST is the
--    DEFAULT whenever DESC is specified**. A column written as plain `DESC`
--    therefore stores 1 | 2 = 3, NOT 1. Only `DESC NULLS LAST` stores 1.
--    The two DESC columns below (`evaluated_at DESC` and `created_at DESC` in
--    the migration's STEP 5) are consequently 3. An earlier version of this
--    file expected 1 for both, which meant it RAISED on a correctly applied
--    schema at its FIRST index assertion — so index specs 2-8 and sections 9
--    and 10 were never evaluated and the final notice could never be emitted.
--    These values are derived from the migration's actual CREATE INDEX
--    statements, not adjusted to make this script pass.
-- ---------------------------------------------------------------------------
FOR spec IN
  SELECT * FROM (VALUES
    -- (company_id, evaluated_at DESC) → ASC, DESC+NULLS FIRST
    ('content_quality_company_idx',          'public.content_quality',          ARRAY['company_id','evaluated_at'], ARRAY[0,3]::smallint[], NULL::text),
    ('content_quality_content_idx',          'public.content_quality',          ARRAY['content_id'],                ARRAY[0]::smallint[],   '(content_id IS NOT NULL)'),
    ('content_block_content_idx',            'public.content_block',            ARRAY['content_id','position'],     ARRAY[0,0]::smallint[], NULL::text),
    ('content_block_company_idx',            'public.content_block',            ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text),
    ('content_recommendation_content_idx',   'public.content_recommendation',   ARRAY['content_id','status'],       ARRAY[0,0]::smallint[], NULL::text),
    ('content_recommendation_company_idx',   'public.content_recommendation',   ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text),
    -- (content_id, created_at DESC) → ASC, DESC+NULLS FIRST
    ('content_approval_history_content_idx', 'public.content_approval_history', ARRAY['content_id','created_at'],   ARRAY[0,3]::smallint[], NULL::text),
    ('content_approval_history_company_idx', 'public.content_approval_history', ARRAY['company_id'],                ARRAY[0]::smallint[],   NULL::text)
  ) AS v(idxname, tbl, want_cols, want_opts, want_pred)
LOOP
  r_idx := to_regclass('public.' || quote_ident(spec.idxname));
  IF r_idx IS NULL THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% does not exist.', spec.idxname;
  END IF;
  -- PARITY WITH THE MIGRATION'S FIX3-IDX-01, which accepts relkind 'i' ALONE.
  -- This predicate used to accept ('i','I'), so a PARTITIONED index under one
  -- of these names was rejected by the migration and ACCEPTED here — the two
  -- halves of one gate disagreeing about the same catalog state. They now
  -- agree on 'i', the conservative direction: the migration creates these four
  -- tables unpartitioned, so it can never produce an 'I' itself, and a target
  -- that has partitioned them is a shape neither file models.
  SELECT relkind INTO v_relkind FROM pg_class WHERE oid = r_idx;
  IF v_relkind <> 'i' THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: public.% exists but is not an ordinary index (relkind=%). relkind I (partitioned index) is rejected here as it is by the migration''s FIX3-IDX-01.', spec.idxname, v_relkind;
  END IF;
  -- indisunique is checked below, but it is not the only way an index
  -- constrains rows: an EXCLUSION constraint's index has indisunique = false.
  -- The migration refuses one at FIX3-IDX-03a; this asserts the same fact
  -- after the fact, so neither file accepts an index the other rejects.
  IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = r_idx AND i.indisexclusion) THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: public.% backs an EXCLUSION constraint. It is not unique, so the uniqueness assertion below does not see it, but it enforces a rule this design never intended.', spec.idxname;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = r_idx AND i.indisprimary) THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: public.% is a PRIMARY KEY index, which is constraint-backed and cannot be the plain index this design creates.', spec.idxname;
  END IF;
  r_tbl := to_regclass(spec.tbl);

  SELECT i.indisunique, i.indnkeyatts, i.indnatts, (i.indpred IS NOT NULL),
         am.amname, i.indisvalid, i.indisready, i.indislive,
         CASE WHEN i.indpred IS NULL THEN NULL
              ELSE pg_get_expr(i.indpred, i.indrelid) END
    INTO v_unique, v_nkeyatt, v_natt, v_partial, v_am,
         v_idxvalid, v_idxready, v_idxlive, v_pred
    FROM pg_index i
    JOIN pg_class c  ON c.oid = i.indexrelid
    JOIN pg_am    am ON am.oid = c.relam
   WHERE i.indexrelid = r_idx;

  IF (SELECT indrelid FROM pg_index WHERE indexrelid = r_idx) IS DISTINCT FROM r_tbl THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% is not on %.', spec.idxname, spec.tbl;
  END IF;

  -- INDEX STATE. An earlier version of this section omitted these three, so an
  -- interrupted CREATE INDEX CONCURRENTLY left an index of the right name that
  -- the planner can never use, STEP 5's name-only `IF NOT EXISTS` skipped it,
  -- and this script reported it as correct. Fail-open; closed here. The five
  -- unique-KEY predicates in sections 3 and 6 always carried these.
  IF NOT v_idxvalid OR NOT v_idxready OR NOT v_idxlive THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-08: index public.% is not usable (indisvalid=%, indisready=%, indislive=%) — an interrupted CREATE INDEX CONCURRENTLY leaves exactly this state, and the planner will never use it. Definition: %.',
      spec.idxname, v_idxvalid, v_idxready, v_idxlive, pg_get_indexdef(r_idx);
  END IF;
  IF v_unique THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-08: index public.% is UNIQUE. This design expects a non-unique index; a unique one imposes a constraint the migration does not want (for example only one block per company). Definition: %.',
      spec.idxname, pg_get_indexdef(r_idx);
  END IF;
  IF v_am <> 'btree' THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% uses access method %, expected btree. Definition: %.',
      spec.idxname, v_am, pg_get_indexdef(r_idx);
  END IF;
  IF v_natt <> v_nkeyatt THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% carries % INCLUDE column(s); none expected. Definition: %.',
      spec.idxname, v_natt - v_nkeyatt, pg_get_indexdef(r_idx);
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO v_cols
    FROM pg_index i
    CROSS JOIN LATERAL unnest(string_to_array(i.indkey::text, ' ')::smallint[])
                 WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indexrelid = r_idx AND k.ord <= i.indnkeyatts;
  IF v_cols IS DISTINCT FROM spec.want_cols THEN
    RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% has key columns %, expected %. Definition: %.',
      spec.idxname, COALESCE(v_cols::text,'{}'), spec.want_cols::text, pg_get_indexdef(r_idx);
  END IF;

  SELECT array_agg(o.opt ORDER BY o.ord) INTO v_opts
    FROM pg_index i
    CROSS JOIN LATERAL unnest(string_to_array(i.indoption::text, ' ')::smallint[])
                 WITH ORDINALITY AS o(opt, ord)
   WHERE i.indexrelid = r_idx AND o.ord <= i.indnkeyatts;
  IF v_opts IS DISTINCT FROM spec.want_opts THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-08: index public.% has per-column ordering options %, expected % (values: 1 = DESC, 2 = NULLS FIRST; plain DESC defaults to NULLS FIRST and so stores 3). Definition: %.',
      spec.idxname, COALESCE(v_opts::text,'{}'), spec.want_opts::text, pg_get_indexdef(r_idx);
  END IF;

  -- OPERATOR CLASS AND COLLATION. The migration declares no explicit opclass
  -- or COLLATE on any of these indexes, so every key column must carry its
  -- type's DEFAULT opclass and the column's own collation (indcollation = 0
  -- means "the column's collation", which is what an unqualified CREATE INDEX
  -- produces). A non-default opclass such as text_pattern_ops, or an explicit
  -- COLLATE "C", changes which queries the index can serve while leaving every
  -- other property above identical.
  SELECT count(*) INTO v_cnt
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indclass) WITH ORDINALITY AS kc(opc, ord)
    JOIN pg_opclass oc ON oc.oid = kc.opc
   WHERE i.indexrelid = r_idx AND kc.ord <= i.indnkeyatts AND NOT oc.opcdefault;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-08: index public.% uses a NON-DEFAULT operator class on % key column(s); the migration declares none. Definition: %.',
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
      'FIX3-VERIFY-08: index public.% overrides the column collation on % key column(s); the migration declares no COLLATE. Definition: %.',
      spec.idxname, v_cnt, pg_get_indexdef(r_idx);
  END IF;

  IF spec.want_pred IS NULL THEN
    IF v_partial THEN
      RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% is PARTIAL and should not be. Predicate: %. Definition: %.',
        spec.idxname, v_pred, pg_get_indexdef(r_idx);
    END IF;
  ELSE
    IF NOT v_partial THEN
      RAISE EXCEPTION 'FIX3-VERIFY-08: index public.% is NOT partial; expected the predicate %. Definition: %.',
        spec.idxname, spec.want_pred, pg_get_indexdef(r_idx);
    END IF;
    -- Compare the predicate TEXT, whitespace-insensitively, so an INVERTED
    -- predicate (IS NULL instead of IS NOT NULL) is caught rather than passing
    -- a mere "is partial" boolean.
    IF lower(regexp_replace(v_pred, '\s', '', 'g'))
       IS DISTINCT FROM lower(regexp_replace(spec.want_pred, '\s', '', 'g')) THEN
      RAISE EXCEPTION
        'FIX3-VERIFY-08: index public.% has partial predicate %, expected %. An inverted predicate would index exactly the rows meant to be excluded. Definition: %.',
        spec.idxname, v_pred, spec.want_pred, pg_get_indexdef(r_idx);
    END IF;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 9. The updated_at executor and the content_block trigger.
--    EITHER public.set_content_updated_at() or public.omnivyra_touch_updated_at()
--    is accepted, because the migration reuses whichever equivalent function the
--    target already has rather than adding a duplicate. Whichever is in use must
--    be the one the trigger executes.
-- ---------------------------------------------------------------------------
r_tbl := to_regclass('public.content_block');
SELECT t.tgfoid, t.tgtype, t.tgenabled, (t.tgqual IS NOT NULL),
       COALESCE(array_length(string_to_array(btrim(t.tgattr::text), ' '), 1), 0),
       t.tgnargs
  INTO r_fn, v_tgtype, v_tgen, v_form_ok, v_tgnattr, v_tgnargs
  FROM pg_trigger t
 WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal
   AND t.tgname = 'content_block_set_updated_at';
IF r_fn IS NULL THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: trigger content_block_set_updated_at on public.content_block is absent.';
END IF;
IF r_fn NOT IN (
     COALESCE(to_regprocedure('public.set_content_updated_at()'), 0),
     COALESCE(to_regprocedure('public.omnivyra_touch_updated_at()'), 0)
   ) THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-09: trigger content_block_set_updated_at executes %, which is neither public.set_content_updated_at() nor public.omnivyra_touch_updated_at().',
    r_fn::regprocedure;
END IF;
v_chosen := r_fn::regprocedure::text;
IF v_tgtype <> 19 THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-09: trigger content_block_set_updated_at has tgtype %, expected 19 = ROW(1)|BEFORE(2)|UPDATE(16). Definition: %.',
    v_tgtype, (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid = r_tbl AND t.tgname = 'content_block_set_updated_at');
END IF;
IF v_tgen <> 'O' THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-09: trigger content_block_set_updated_at has tgenabled = %, expected O. A disabled trigger leaves the pg_trigger row intact while updated_at silently stops advancing.',
    v_tgen;
END IF;
IF v_form_ok THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: trigger content_block_set_updated_at carries a WHEN clause; none is expected. Definition: %.',
    (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid = r_tbl AND t.tgname = 'content_block_set_updated_at');
END IF;
-- tgattr / tgnargs. `UPDATE OF <column>` stores its restriction in tgattr and
-- leaves tgtype at 19, so without this a column-restricted trigger passed as
-- "matches exactly" while updated_at stopped advancing for every other column.
IF v_tgnattr <> 0 OR v_tgnargs <> 0 THEN
  RAISE EXCEPTION
    'FIX3-VERIFY-09: trigger content_block_set_updated_at is column-restricted on % column(s) and/or declares % argument(s); 0 and 0 expected (an UPDATE OF <column> trigger leaves tgtype unchanged at 19). Definition: %.',
    v_tgnattr, v_tgnargs,
    (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid = r_tbl AND t.tgname = 'content_block_set_updated_at');
END IF;

-- DUPLICATE TIMESTAMP TRIGGERS, DETECTED BY BODY ALLOWLIST, NOT BY NAME — and
-- that is name independence, NOT behavioural analysis. An earlier version tested
-- membership of a two-name allowlist; the production-shaped dump carries 28
-- zero-argument plpgsql trigger functions whose bodies normalise to one of the
-- accepted strings, so 27 equivalent executors were invisible to it. The
-- predicate below instead matches any other non-internal BEFORE UPDATE FOR EACH
-- ROW trigger whose function is a zero-argument plpgsql trigger function whose
-- NORMALISED SOURCE equals one of the two strings in v_accepted.
--
-- STATED LIMIT. It is NOT identical to the migration's — an earlier version of
-- this sentence claimed it was. This list is STRICTLY STRONGER: the migration's
-- note at its TRG-02 guard names four escapes and, materially, omits
-- `CURRENT_TIMESTAMP`, which is the spelling of the one real counter-example in
-- the production-shaped dump. The two files enforce the SAME predicate against
-- the SAME two-string allowlist; only the prose differs, and this is the fuller
-- version. v_accepted holds exactly two strings. A function that maintains
-- updated_at by any other spelling is NOT counted here — `CURRENT_TIMESTAMP`,
-- `clock_timestamp()`, `timezone('utc', now())`, a DECLARE section, an inline
-- comment, a second assignment, a quoted identifier, a SQL-language function,
-- or contrib's `moddatetime` (excluded twice over, by language and by argument
-- count). That is not hypothetical: public.update_updated_at_column() exists in
-- the same production-shaped dump with the body `NEW.updated_at =
-- CURRENT_TIMESTAMP`, drives nine triggers there, and would not match.
-- So what this assertion establishes is "no second trigger whose function body
-- is one of the two known equivalents", NOT "no second trigger that maintains
-- updated_at". Establishing the latter would require analysing function bodies,
-- which neither this script nor the migration does.
SELECT count(*) INTO v_cnt
  FROM pg_trigger t
  JOIN pg_proc p     ON p.oid = t.tgfoid
  JOIN pg_language l ON l.oid = p.prolang
 WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal
   AND t.tgname <> 'content_block_set_updated_at'
   AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1 AND (t.tgtype & 16) = 16
   AND p.prorettype = ('trigger'::regtype)::oid
   AND p.pronargs = 0
   AND l.lanname = 'plpgsql'
   AND lower(btrim(regexp_replace(COALESCE(p.prosrc,''), '\s+', ' ', 'g'))) = ANY (v_accepted);
IF v_cnt <> 0 THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: public.content_block carries % other non-internal BEFORE UPDATE FOR EACH ROW trigger(s) whose function body is one of the two known updated_at equivalents; both would fire. (Matched by body, not by name, and not by behaviour — a function maintaining updated_at by another spelling is not counted.)', v_cnt;
END IF;

SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_secdef, v_config, v_src
  FROM pg_proc p WHERE p.oid = r_fn;
IF (SELECT prorettype FROM pg_proc WHERE oid = r_fn) IS DISTINCT FROM ('trigger'::regtype)::oid THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: % does not return trigger.', v_chosen;
END IF;
IF (SELECT pronargs FROM pg_proc WHERE oid = r_fn) <> 0 THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: % does not take zero arguments.', v_chosen;
END IF;
IF (SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = r_fn) <> 'plpgsql' THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: % is not written in plpgsql.', v_chosen;
END IF;
v_norm := lower(btrim(regexp_replace(COALESCE(v_src,''), '\s+', ' ', 'g')));
IF NOT (v_norm = ANY (v_accepted)) THEN
  RAISE EXCEPTION 'FIX3-VERIFY-09: % body normalises to "%", which is not a declared definition ("%" or "%").',
    v_chosen, v_norm, v_accepted[1], v_accepted[2];
END IF;
IF v_secdef THEN
  RAISE WARNING 'FIX3-VERIFY-09: % is SECURITY DEFINER where SECURITY INVOKER is intended. Informational: for setting NEW.updated_at the difference is immaterial.', v_chosen;
END IF;
IF v_config IS NOT NULL THEN
  RAISE WARNING 'FIX3-VERIFY-09: % carries proconfig %. Informational.', v_chosen, v_config::text;
END IF;

-- ---------------------------------------------------------------------------
-- 10. RLS enabled on all four tables, with exactly one policy each of the
--     modelled shape, depending on public.user_company_roles.
--     A pass here establishes SHAPE and DEPENDENCY only — not policy semantics,
--     and not tenant isolation. See the header.
-- ---------------------------------------------------------------------------
r_parent := to_regclass('public.user_company_roles');
IF r_parent IS NULL THEN
  RAISE EXCEPTION 'FIX3-VERIFY-10: public.user_company_roles is absent; the policies cannot be scoped.';
END IF;
FOR spec IN
  SELECT * FROM (VALUES
    ('content_quality'), ('content_block'), ('content_recommendation'), ('content_approval_history')
  ) AS v(tbl)
LOOP
  r_tbl := to_regclass('public.' || quote_ident(spec.tbl));
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = r_tbl) THEN
    RAISE EXCEPTION 'FIX3-VERIFY-10: RLS is not enabled on public.%.', spec.tbl;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policy WHERE polrelid = r_tbl;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'FIX3-VERIFY-10: public.% carries % policies; exactly 1 is expected (%_company_rw).',
      spec.tbl, v_cnt, spec.tbl;
  END IF;
  SELECT p.polname INTO v_name FROM pg_policy p WHERE p.polrelid = r_tbl;
  IF v_name <> spec.tbl || '_company_rw' THEN
    RAISE EXCEPTION 'FIX3-VERIFY-10: the policy on public.% is named %, expected %.',
      spec.tbl, v_name, spec.tbl || '_company_rw';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    WHERE p.polrelid = r_tbl
      AND p.polcmd = '*' AND p.polpermissive
      AND p.polroles = ARRAY[0]::oid[]
      AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
      AND btrim(pg_get_expr(p.polqual, p.polrelid))      NOT IN ('true','(true)')
      AND btrim(pg_get_expr(p.polwithcheck, p.polrelid)) NOT IN ('true','(true)')
  ) THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-10: the policy on public.% does not have the modelled shape (ALL / PERMISSIVE / PUBLIC, both USING and WITH CHECK present, neither literally true). USING: %. WITH CHECK: %.',
      spec.tbl,
      COALESCE((SELECT pg_get_expr(p.polqual, p.polrelid)      FROM pg_policy p WHERE p.polrelid = r_tbl), '(none)'),
      COALESCE((SELECT pg_get_expr(p.polwithcheck, p.polrelid) FROM pg_policy p WHERE p.polrelid = r_tbl), '(none)');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = p.oid
    WHERE p.polrelid = r_tbl
      AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid   = r_parent
  ) THEN
    RAISE EXCEPTION 'FIX3-VERIFY-10: the policy on public.% does not depend on public.user_company_roles, so it does not scope by company membership.', spec.tbl;
  END IF;
END LOOP;

-- ---------------------------------------------------------------------------
-- 11. AUDIT-PRESERVATION PARITY with the migration's FIX3-AUDIT-00/01/02/03.
--
--     WHY THIS SECTION EXISTS. The migration refuses to apply if any of the
--     five relations in this family carries a non-internal DELETE trigger, a
--     non-internal TRUNCATE trigger, or a rewrite rule, because its whole
--     audit-preservation argument rests on foreign-key delete semantics that
--     such a trigger or rule bypasses. This script re-read NONE of that: its
--     only trigger assertions (section 9) are scoped to content_block and look
--     at the updated_at trigger. So a DELETE trigger added to the audit table
--     AFTER the migration applied — precisely the window a post-apply
--     verification script exists to cover — passed this script silently while
--     invalidating the reasoning the migration refused to proceed without.
--
--     SCOPE, STATED EXACTLY AS THE MIGRATION STATES IT. The population is
--     these five relations' own oids and nothing else. It does not prove audit
--     rows survive a delete; it proves no trigger or rule of the listed kinds
--     exists at the moment this script runs. It says nothing about DELETE
--     permissions, about RLS on the audit table, about application code that
--     deletes audit rows directly, or about triggers on any other table that
--     might cascade into this family.
-- ---------------------------------------------------------------------------
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
  -- public.content is the only one that may legitimately be absent: the
  -- migration does not create it, and sections 1-10 above cover the four it
  -- does. Absence is not an audit-preservation failure. Parity with the
  -- migration's own CONTINUE.
  CONTINUE WHEN r_tbl IS NULL;

  -- THE CENSUS-SCOPE PRECONDITION FIRST, as FIX3-AUDIT-00 does. The two
  -- censuses below read one relation's own oid, so on a partitioned relation a
  -- trigger or rule created directly on a PARTITION is invisible while the
  -- messages state the property as though the population were complete.
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = r_tbl AND c.relkind <> 'r') THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-11: % is not an ordinary table (relkind %), so the trigger and rule censuses below are not a complete population for it; a trigger or rule on a partition would be invisible. The migration refuses on this same condition (FIX3-AUDIT-00).',
      spec.tbl, (SELECT c.relkind FROM pg_class c WHERE c.oid = r_tbl);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = r_tbl OR inhrelid = r_tbl) THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-11: % takes part in an inheritance or partitioning hierarchy (pg_inherits), so the censuses below are not a complete population for it. The migration refuses on this same condition (FIX3-AUDIT-00).',
      spec.tbl;
  END IF;

  -- DELETE triggers. tgtype bit 8 is TRIGGER_TYPE_DELETE. `tgisinternal`
  -- excludes the triggers PostgreSQL maintains for the foreign keys the
  -- migration itself adds — those IMPLEMENT ON DELETE SET NULL rather than
  -- threaten it.
  SELECT string_agg(t.tgname || ' => ' || pg_get_triggerdef(t.oid), ' | ' ORDER BY t.tgname)
    INTO v_bad
    FROM pg_trigger t
   WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal AND (t.tgtype & 8) <> 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-11: % carries non-internal trigger(s) firing on DELETE. The migration''s audit-preservation reasoning rests on foreign-key delete semantics (ON DELETE SET NULL to public.content), which a DELETE trigger can bypass by removing rows itself; the migration refuses to apply in this state (FIX3-AUDIT-01), so finding it here means it was introduced after the migration ran. Triggers: %',
      spec.tbl, v_bad;
  END IF;

  -- TRUNCATE triggers. tgtype bit 32 is TRIGGER_TYPE_TRUNCATE.
  SELECT string_agg(t.tgname || ' => ' || pg_get_triggerdef(t.oid), ' | ' ORDER BY t.tgname)
    INTO v_bad
    FROM pg_trigger t
   WHERE t.tgrelid = r_tbl AND NOT t.tgisinternal AND (t.tgtype & 32) <> 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'FIX3-VERIFY-11: % carries non-internal TRUNCATE trigger(s), which remove every row irrespective of any foreign key (migration: FIX3-AUDIT-02). Triggers: %',
      spec.tbl, v_bad;
  END IF;

  -- Rewrite rules. A view's own definition rule is identified by all three
  -- facts together — the name, ev_type '1' (SELECT) and the relation actually
  -- being a view — not by the name alone, which is not tied to the SELECT
  -- event. Same predicate as FIX3-AUDIT-03.
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
      'FIX3-VERIFY-11: % carries rewrite rule(s). A rule on DELETE can redirect or multiply the rows a delete removes, which no foreign-key or trigger census in this script would see (migration: FIX3-AUDIT-03). Rules: %',
      spec.tbl, v_bad;
  END IF;
END LOOP;

RAISE NOTICE 'FIX3 VERIFICATION PASSED (STRUCTURAL ONLY): 4 tables; 37 columns; 4 usable unique keys over id; 2 vocabulary CHECKs and the lifecycle CHECK each matched BYTE-EXACTLY against the one supported definition form, with exactly the intended nine lifecycle elements; 2 composite unique keys; 4 composite foreign keys with all delete/update/match/validation/deferrability properties; each child carries exactly its expected FK count both to its parent and in total, so no legacy FK, same-column twin or FK to an unmodelled relation survives; content_quality carries no FK at all; 8 indexes incl. valid/ready/live, non-uniqueness, btree, column order, ordering options, default opclass and collation, and partial-predicate text; the updated_at executor (%) and the content_block trigger incl. timing, events, row mode, enabled state, WHEN clause and column restriction, with duplicate timestamp triggers detected by a two-string function-body allowlist rather than by name — name independence, not behavioural detection; RLS with one modelled policy per table; and audit-preservation parity with the migration''s FIX3-AUDIT-00/01/02/03 over five relations (public.content plus the four owned tables, each an ordinary unpartitioned table, none carrying a non-internal DELETE trigger, a non-internal TRUNCATE trigger or a rewrite rule) — which proves no such trigger or rule EXISTS right now, not that audit rows survive a delete. NO BEHAVIOUR WAS EXERCISED: acceptance of lifecycle_status = ''quality_reviewed'' is NOT established by this script — only the CHECK''s definition is — and policy SEMANTICS are not established at all. A WARNING may also have been emitted for the executor''s security mode or pinned configuration; those are reported, not asserted.', v_chosen;
END $verify$;
