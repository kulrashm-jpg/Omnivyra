-- ---------------------------------------------------------------------------
-- PI — person/account canonical write atomicity.
--
-- THE DEFECT THIS CLOSES
--
-- `ingestionBoundary.ingestSourceRecord` committed three independent writes:
-- the canonical UPDATE, then one `canonical_attribute_decisions` INSERT per
-- applied attribute, then the `source_assertions` provenance stamp. There was no
-- transaction around them and no error handler. A failure after the first write
-- left a canonical value that no decision row explains.
--
-- A retry could not repair it. Arbitration skips any attribute whose canonical
-- value already matches the winner, so on the second pass the apply list is
-- empty and the boundary returns before provenance is ever reached. The missing
-- decision row is therefore PERMANENT, which is why the fix is atomicity rather
-- than a retry.
--
-- WHAT THIS FUNCTION IS, AND IS NOT
--
-- It is the write half of the boundary, moved into one statement so the three
-- writes share one transaction. It is NOT arbitration: it performs no ordering,
-- no recency comparison and no confidence comparison, and it cannot choose a
-- winner. It verifies the decision it was handed and writes it, or raises.
--
-- Winner selection stays in `decideCanonicalUpdates`, byte-frozen. Source
-- arbitration remains an unresolved owner matter and nothing here ratifies it.
--
-- NOT `SECURITY DEFINER`, exactly like `pi_relationship_set_primary`: it runs
-- with the caller's rights, so RLS and table grants still apply and this adds no
-- new privilege path. PUBLIC EXECUTE (the PostgreSQL default) therefore widens
-- nothing — a caller who cannot write the tables directly cannot write them
-- through this function either.
--
-- The relationship ingestion path is NOT touched. Its own atomicity is a
-- separate remediation scope by owner decision.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The authorized attribute surface, per entity type.
--
-- These are copies of `PERSON_ATTRIBUTE_COLUMNS` and
-- `ACCOUNT_ATTRIBUTE_COLUMNS` in `backend/services/prospectIdentity/
-- attributes.ts`. A caller cannot widen them: an attribute outside the list is
-- refused before any write, so passing `id`, `company_id` or any other column
-- name cannot reach the UPDATE.
--
-- Two copies of one list is a drift risk, so a test asserts SET EQUALITY
-- between these literals and the TypeScript constants. Drift is a failing test
-- rather than a silent widening of what the boundary may write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_canonical_attribute_allowlist(p_entity_type text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_entity_type
    WHEN 'person' THEN ARRAY[
      'full_name', 'first_name', 'last_name', 'job_title', 'department', 'seniority',
      'country_code', 'region', 'city', 'timezone',
      'authority', 'influence', 'buying_role',
      'attributes_source', 'attributes_updated_at'
    ]
    WHEN 'account' THEN ARRAY[
      'industry', 'employee_count', 'employee_band', 'country_code', 'region', 'city',
      'description',
      'annual_revenue', 'revenue_band', 'founded_year', 'technologies', 'funding_stage',
      'last_funding_at',
      'market', 'business_model', 'growth_stage',
      'attributes_source', 'attributes_updated_at'
    ]
    ELSE NULL::text[]
  END
$$;

COMMENT ON FUNCTION public.pi_canonical_attribute_allowlist(text) IS
  'The canonical columns the ingestion boundary may write, per entity type. Mirrors PERSON_ATTRIBUTE_COLUMNS / ACCOUNT_ATTRIBUTE_COLUMNS in attributes.ts; a test asserts set equality so the two cannot drift. Returns NULL for any other entity type, which the writer treats as a refusal.';

-- ---------------------------------------------------------------------------
-- The atomic write.
--
-- `p_decisions` is a JSONB array of objects, each:
--   { "attribute": text, "value": text, "assertion_id": uuid, "reason": text }
--
-- Returns the number of attributes applied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_apply_canonical_decisions(
  p_organization_id uuid,
  p_entity_type     text,
  p_target_id       uuid,
  p_provider        text,
  p_now             timestamptz,
  p_decisions       jsonb
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_table       text;
  v_tenant_col  text;
  v_subject_col text;
  v_allowed     text[];
  v_patch       jsonb;
  v_decision    jsonb;
  v_attribute   text;
  v_value       text;
  v_assertion   uuid;
  v_reason      text;
  v_applied     integer := 0;
  v_exists      uuid;
  v_match       integer;
  v_set_cols    text;
  v_set_vals    text;
  v_key         text;
BEGIN
  -- -------------------------------------------------------------------------
  -- Arguments. Every one is required: a NULL tenant or subject would otherwise
  -- widen the WHERE clause rather than narrow it.
  -- -------------------------------------------------------------------------
  IF p_organization_id IS NULL OR p_target_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'pi_apply_canonical_decisions: tenant, target and timestamp are all required';
  END IF;

  IF p_entity_type = 'person' THEN
    v_table := 'unified_persons'; v_tenant_col := 'company_id';      v_subject_col := 'person_id';
  ELSIF p_entity_type = 'account' THEN
    v_table := 'prospect_accounts'; v_tenant_col := 'organization_id'; v_subject_col := 'account_id';
  ELSE
    -- 'relationship' included: that path has its own writer and is out of scope.
    RAISE EXCEPTION 'pi_apply_canonical_decisions: unsupported entity type %', p_entity_type;
  END IF;

  IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' THEN
    RAISE EXCEPTION 'pi_apply_canonical_decisions: decisions must be a JSON array';
  END IF;

  IF jsonb_array_length(p_decisions) = 0 THEN
    RETURN 0;
  END IF;

  v_allowed := public.pi_canonical_attribute_allowlist(p_entity_type);

  -- -------------------------------------------------------------------------
  -- LOCK the canonical row, scoped to the tenant, before validating anything.
  -- Absence is a REFUSAL, not a skip: the TypeScript boundary already read this
  -- row, so a miss here means it was deleted or re-tenanted in between. That is
  -- a race, and failing closed is the only honest answer.
  -- -------------------------------------------------------------------------
  EXECUTE format(
    'SELECT id FROM public.%I WHERE id = $1 AND %I = $2 FOR UPDATE',
    v_table, v_tenant_col
  ) INTO v_exists USING p_target_id, p_organization_id;

  IF v_exists IS NULL THEN
    RAISE EXCEPTION 'pi_apply_canonical_decisions: no % row % in tenant %',
      v_table, p_target_id, p_organization_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- Validate EVERY decision before writing ANY of them, so a bad element in a
  -- multi-attribute batch cannot leave a partial canonical row behind. The
  -- transaction would roll it back regardless; validating first makes the
  -- refusal cheap and the error message precise.
  -- -------------------------------------------------------------------------
  v_patch := jsonb_build_object(
    'attributes_source', p_provider,
    'attributes_updated_at', p_now
  );

  FOR v_decision IN SELECT jsonb_array_elements(p_decisions)
  LOOP
    v_attribute := v_decision ->> 'attribute';
    v_value     := v_decision ->> 'value';
    v_reason    := v_decision ->> 'reason';

    IF v_attribute IS NULL OR v_value IS NULL OR v_reason IS NULL
       OR v_decision ->> 'assertion_id' IS NULL THEN
      RAISE EXCEPTION 'pi_apply_canonical_decisions: a decision is missing attribute, value, assertion_id or reason';
    END IF;

    v_assertion := (v_decision ->> 'assertion_id')::uuid;

    -- THE WRITE SURFACE. Refused before anything is written, and before the
    -- column name can reach dynamic SQL.
    IF NOT (v_attribute = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'pi_apply_canonical_decisions: attribute % is not writable for entity type %',
        v_attribute, p_entity_type;
    END IF;

    -- THE EVIDENCE. The named assertion must belong to this tenant, describe
    -- THIS subject on the subject leg, be about THIS attribute and carry
    -- EXACTLY this normalized value.
    --
    -- This is verification, not selection. There is no ORDER BY, no timestamp
    -- comparison and no confidence comparison anywhere in this function, so it
    -- cannot pick a winner — only confirm that the winner it was handed says
    -- what the caller claims it says.
    --
    -- `superseded_at` is deliberately NOT filtered. A superseded assertion may
    -- not WIN, which arbitration already enforced upstream, but it still
    -- attests that its value passed through this layer; re-deciding liveness
    -- here would silently change the ratified attestation semantics.
    EXECUTE format(
      'SELECT count(*) FROM public.source_assertions
        WHERE id = $1 AND organization_id = $2 AND entity_type = $3
          AND %I = $4 AND attribute = $5 AND normalized_value = $6',
      v_subject_col
    ) INTO v_match
      USING v_assertion, p_organization_id, p_entity_type, p_target_id, v_attribute, v_value;

    IF v_match = 0 THEN
      -- The VALUE is deliberately absent from this message. A canonical
      -- attribute value can be a person's name, title or location, and a
      -- refusal message travels into application logs. The assertion id and
      -- the attribute name are enough to diagnose it and are not personal data.
      RAISE EXCEPTION 'pi_apply_canonical_decisions: assertion % does not attest attribute % with the supplied value for this tenant and subject',
        v_assertion, v_attribute;
    END IF;

    -- Overlay onto the patch. Later elements win, which is exactly what the
    -- TypeScript object assignment it replaces did.
    v_patch := v_patch || jsonb_build_object(v_attribute, v_value);
  END LOOP;

  -- -------------------------------------------------------------------------
  -- 1. The canonical UPDATE. One statement for every attribute.
  --
  -- Column names come ONLY from the allowlist and are quoted with %I.
  -- `jsonb_populate_record` casts each value to the real column type, so an
  -- integer or timestamptz column is not assigned raw text.
  -- -------------------------------------------------------------------------
  SELECT string_agg(format('%I', k), ', ' ORDER BY k),
         string_agg(format('r.%I', k), ', ' ORDER BY k)
    INTO v_set_cols, v_set_vals
    FROM jsonb_object_keys(v_patch) AS k;

  FOR v_key IN SELECT jsonb_object_keys(v_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      -- Unreachable: the patch is seeded with two allowlisted keys and
      -- extended only by validated attributes. Asserted anyway, because this is
      -- the last point before a column name becomes SQL.
      RAISE EXCEPTION 'pi_apply_canonical_decisions: refusing to write non-allowlisted column %', v_key;
    END IF;
  END LOOP;

  EXECUTE format(
    'UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) r)
      WHERE t.id = $2 AND t.%I = $3',
    v_table, v_set_cols, v_set_vals, v_table, v_tenant_col
  ) USING v_patch, p_target_id, p_organization_id;

  -- -------------------------------------------------------------------------
  -- 2. The decision log, and 3. the provenance stamp — SAME TRANSACTION.
  --
  -- If either raises, the canonical UPDATE above is rolled back with it. That
  -- is the entire point of this function.
  -- -------------------------------------------------------------------------
  FOR v_decision IN SELECT jsonb_array_elements(p_decisions)
  LOOP
    v_attribute := v_decision ->> 'attribute';
    v_value     := v_decision ->> 'value';
    v_reason    := v_decision ->> 'reason';
    v_assertion := (v_decision ->> 'assertion_id')::uuid;

    INSERT INTO public.canonical_attribute_decisions (
      organization_id, entity_type, person_id, account_id,
      attribute, assertion_id, value, reason, decided_at
    ) VALUES (
      p_organization_id, p_entity_type,
      CASE WHEN p_entity_type = 'person'  THEN p_target_id ELSE NULL END,
      CASE WHEN p_entity_type = 'account' THEN p_target_id ELSE NULL END,
      v_attribute, v_assertion, v_value, v_reason, p_now
    );

    -- Stamped only where it is not already stamped. `applied_to_canonical_at`
    -- and `applied_reason` are tied by a CHECK and are never cleared and never
    -- overwritten: the decision log carries any later re-win. Tenant-filtered
    -- so it can only ever touch this tenant's evidence.
    UPDATE public.source_assertions
       SET applied_to_canonical_at = p_now,
           applied_reason          = v_reason
     WHERE id = v_assertion
       AND organization_id = p_organization_id
       AND applied_to_canonical_at IS NULL;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN v_applied;
END
$$;

COMMENT ON FUNCTION public.pi_apply_canonical_decisions(uuid, text, uuid, text, timestamptz, jsonb) IS
  'THE authoritative canonical write for person and account attributes. Applies the canonical UPDATE, appends one canonical_attribute_decisions row per attribute and stamps each winning assertion in ONE transaction, so a canonical value can never exist without the decision that explains it. Verifies each decision against its assertion (tenant, subject, attribute, normalized value) but performs no winner selection — arbitration stays in decideCanonicalUpdates. Refuses any attribute outside pi_canonical_attribute_allowlist, so a caller cannot widen the write surface. Does not handle the relationship path.';
