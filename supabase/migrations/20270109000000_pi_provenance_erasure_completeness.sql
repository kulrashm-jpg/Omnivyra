-- PI / Prospect provenance — erasure COMPLETENESS (closure A: privacy).
--
-- Supersedes the contribution-only redaction of 20270108000001 with one
-- SECURITY DEFINER function that erases the whole provenance/evidence graph of
-- an erased person (and/or of explicitly named canonical prospects) in ONE
-- transaction. Policy, per table and field, with the reasoning:
-- docs/architecture/PROSPECT-PROVENANCE-ERASURE-POLICY.md.
--
-- Gaps closed (left open by 20270108000001, recorded in its report):
--   * source_records.source_url / raw_payload / source_record_id were kept;
--   * evidence tables keyed to the person/prospect kept personal values
--     (source_assertions, lead_intelligence(+events, +profiles), lead_signals,
--     opportunity_feed_items, contacts, engagement_threads/messages and the
--     engagement tables that copy their text, canonical_leads.lead_metadata,
--     canonical_users);
--   * contributions kept a linkable external_ref (`apollo:<person id>`, …);
--   * tombstones kept an UNSALTED sha256 of the redacted values — a guessable
--     value (a LinkedIn URL, an email) could be CONFIRMED by recomputing it.
--
-- ─── Hashing decision: value hashes are RETIRED, not re-keyed ─────────────
-- Auditability needs proof that erasure HAPPENED (who, when, why, which fields,
-- how many rows, which tenant) — not proof of WHICH VALUES were removed. A value
-- hash, salted or not, exists only to confirm a candidate value later, i.e. it
-- is a re-identification oracle. A keyed HMAC would need a key the database
-- must never hold, and losing or rotating it would silently void the evidence.
-- So: `prospect_source_contribution_redactions.values_sha256` is nulled for
-- every existing tombstone and a CHECK (values_sha256 IS NULL) forbids it from
-- ever being written again. The column itself stays (nullable) so that the
-- validated 20270108000001 remains re-runnable byte-for-byte and the
-- schema-parity manifest keeps its pinned entry; a re-run of that migration's
-- old function body would hit the CHECK and fail closed, never re-hash.
--
-- Replacement IDs (`redacted:<row id>`) are derived from the row's own random
-- uuid, never from the value, so they carry no information about the subject.
-- source_assertions.value_hash / source_records.payload_hash keep their hex64
-- shape CHECKs by hashing the marker (`redacted:<row id>` / the marker payload),
-- never a personal value.
--
-- ─── external_ref decision ────────────────────────────────────────────────
-- A contribution's external_ref is `<provider>:<id>` and the id is frequently a
-- provider person id or handle (apollo:<person id>, community:<feed id>,
-- crm:<id>, inbound_person:<uuid>) that can be looked up at the provider. It is
-- replaced with `redacted:<contribution id>` (namespaced — passes the contract
-- CHECK; unique per lead because the contribution id is). Trade-off, accepted:
-- uq_psc_org_lead_external_ref no longer recognises a re-delivery of THAT
-- source event for THAT lead, so a provider that re-sends the erased person
-- would append a new contribution instead of being deduplicated against the
-- erased one. Every OTHER (non-erased) row keeps its key and its idempotency
-- unchanged. Re-ingestion of an erased subject is a suppression question
-- (contact_governance), not something a retained identifier should answer.
-- The same applies to source_records.source_record_id (uq_source_records_tenant_identity),
-- contacts.platform_user_id/contact_key, lead_signals.source_id,
-- engagement_threads.platform_thread_id, engagement_messages.platform_message_id.
--
-- ─── Tombstones: minimum proof, no values ─────────────────────────────────
-- `prospect_provenance_erasures`: one row per successful call — tenant, subject
-- kind, reason, requester, time, the surviving canonical lead ids (internal
-- surrogate keys of rows that remain and no longer carry personal data), the
-- per-table row counts and the `table.column` names changed. It deliberately
-- does NOT store the erased person's id: a surviving row that names the erased
-- subject's key is not an erasure (the same rule personErasure.ts applies to
-- re-anchored governance records). Per-contribution tombstones continue in
-- prospect_source_contribution_redactions (now with erasure_id, never a hash).
-- Both are append-only by privilege: service_role SELECT only.
--
-- ─── Failure safety ───────────────────────────────────────────────────────
-- One function call = one statement = one transaction: any failure rolls back
-- every change and every tombstone. Cross-tenant requests (a person or a lead
-- of another tenant) raise 42501 before anything is written. Repeat calls find
-- nothing left to change and report zero counts. The person row is NOT deleted
-- here; personErasure.ts deletes it only after this call succeeds (fail closed).
-- prospect_source_contributions stays append-only BY PRIVILEGE: service_role
-- still holds exactly {INSERT, SELECT}; this function (owner) is the only
-- sanctioned mutator, as in 20270108000001.

BEGIN;

DO $preflight$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)') IS NULL
     OR to_regclass('public.prospect_source_contribution_redactions') IS NULL THEN
    RAISE EXCEPTION 'PEC preflight: apply 20270108000001 (redaction tombstones + function) first';
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'companies', 'unified_persons', 'canonical_leads', 'canonical_users',
    'prospect_source_contributions', 'source_records', 'source_assertions',
    'contacts', 'lead_signals', 'opportunity_feed_items',
    'lead_intelligence', 'lead_intelligence_events', 'lead_intelligence_profiles',
    'engagement_threads', 'engagement_messages', 'engagement_message_sources',
    'engagement_insight_evidence', 'engagement_opportunities', 'engagement_thread_memory',
    'engagement_thread_intelligence', 'engagement_lead_signals', 'engagement_identity_candidates']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'PEC preflight: public.% is missing', t;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'PEC preflight: auth.role() is missing — the house service_role policy cannot be expressed';
  END IF;
END
$preflight$;

-- ── A. Erasure events (one per successful call) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.prospect_provenance_erasures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  subject_kind        text NOT NULL,
  reason              text NOT NULL,
  requested_by        text NOT NULL,
  canonical_lead_ids  uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  table_counts        jsonb NOT NULL DEFAULT '{}'::jsonb,
  redacted_fields     text[] NOT NULL DEFAULT ARRAY[]::text[],
  erased_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ppe_subject_kind_valid      CHECK (subject_kind IN ('person', 'prospect')),
  CONSTRAINT ppe_reason_nonblank         CHECK (btrim(reason) <> ''),
  CONSTRAINT ppe_requested_by_nonblank   CHECK (btrim(requested_by) <> ''),
  CONSTRAINT ppe_table_counts_object     CHECK (jsonb_typeof(table_counts) = 'object'),
  CONSTRAINT uq_ppe_id_org               UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_ppe_org_erased_at
  ON public.prospect_provenance_erasures (organization_id, erased_at DESC);

ALTER TABLE public.prospect_provenance_erasures ENABLE ROW LEVEL SECURITY;

DO $ppe_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'prospect_provenance_erasures'
       AND policyname = 'prospect_provenance_erasures_service_role'
       AND roles::text[] <> ARRAY['service_role']
  ) THEN
    DROP POLICY prospect_provenance_erasures_service_role ON public.prospect_provenance_erasures;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'prospect_provenance_erasures'
       AND policyname = 'prospect_provenance_erasures_service_role'
  ) THEN
    CREATE POLICY prospect_provenance_erasures_service_role
      ON public.prospect_provenance_erasures
      FOR SELECT
      TO service_role
      USING (auth.role() = 'service_role');
  END IF;
END
$ppe_rls$;

REVOKE ALL ON TABLE public.prospect_provenance_erasures
  FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT ON TABLE public.prospect_provenance_erasures TO service_role;

COMMENT ON TABLE public.prospect_provenance_erasures IS
  'One row per completed provenance erasure: tenant, subject kind, reason, requester, time, '
  'surviving canonical lead ids, per-table row counts and changed table.column names. Never a '
  'value, a value hash, or the erased person''s id. Append-only: service_role SELECT only; '
  'written solely by public.pi_erase_prospect_provenance.';

-- ── B. Per-contribution tombstones: retire value hashing, link the event ──

-- Existing hashes are confirmation oracles for guessable values: remove them.
UPDATE public.prospect_source_contribution_redactions
   SET values_sha256 = NULL
 WHERE values_sha256 IS NOT NULL;

ALTER TABLE public.prospect_source_contribution_redactions
  ALTER COLUMN values_sha256 DROP NOT NULL;

DO $pscr_retire$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pscr_values_sha256_retired'
                    AND conrelid = 'public.prospect_source_contribution_redactions'::regclass) THEN
    ALTER TABLE public.prospect_source_contribution_redactions
      ADD CONSTRAINT pscr_values_sha256_retired CHECK (values_sha256 IS NULL);
  END IF;
END
$pscr_retire$;

ALTER TABLE public.prospect_source_contribution_redactions
  ADD COLUMN IF NOT EXISTS erasure_id uuid;

DO $pscr_erasure_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pscr_erasure_tenant_fk') THEN
    ALTER TABLE public.prospect_source_contribution_redactions
      ADD CONSTRAINT pscr_erasure_tenant_fk
      FOREIGN KEY (erasure_id, organization_id)
      REFERENCES public.prospect_provenance_erasures (id, organization_id)
      ON DELETE SET NULL (erasure_id);
  END IF;
END
$pscr_erasure_fk$;

CREATE INDEX IF NOT EXISTS idx_pscr_erasure
  ON public.prospect_source_contribution_redactions (erasure_id);

COMMENT ON COLUMN public.prospect_source_contribution_redactions.values_sha256 IS
  'RETIRED by 20270109000000: always NULL (CHECK pscr_values_sha256_retired). A value hash '
  'confirms guessable values; erasure proof is the field names, counts, reason and requester.';
COMMENT ON COLUMN public.prospect_source_contribution_redactions.erasure_id IS
  'The prospect_provenance_erasures event that redacted this contribution (NULL for tombstones '
  'written before 20270109000000).';

-- ── C. The erasure function ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pi_erase_prospect_provenance(
  p_organization_id    uuid,
  p_person_id          uuid,
  p_canonical_lead_ids uuid[],
  p_reason             text,
  p_requested_by       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_req_leads  uuid[] := coalesce(p_canonical_lead_ids, ARRAY[]::uuid[]);
  v_erasure    uuid := gen_random_uuid();
  v_mark       jsonb;
  v_counts     jsonb := '{}'::jsonb;
  v_fields     text[] := ARRAY[]::text[];
  v_n          integer;
  -- scope sets (tenant-first, all of them)
  v_leads      uuid[];
  v_users      uuid[];
  v_contacts   uuid[];
  v_threads    uuid[];
  v_messages   uuid[];
  v_signals    uuid[];
  v_feed       uuid[];
  v_records    uuid[];
  v_li         uuid[];
  v_psc_contacts uuid[]; v_psc_signals uuid[]; v_psc_feed uuid[];
  v_psc_messages uuid[]; v_psc_records uuid[];
  -- contributions
  v_row        record;
  v_tomb_id    uuid;
  v_cfields    text[];
  v_redacted   integer := 0;
  v_already    integer := 0;
  v_ids        uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: organization_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_requested_by IS NULL OR btrim(p_requested_by) = '' THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: requested_by is required' USING ERRCODE = '22023';
  END IF;
  IF array_position(v_req_leads, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: lead ids must not contain NULL' USING ERRCODE = '22023';
  END IF;
  IF p_person_id IS NULL AND cardinality(v_req_leads) = 0 THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: a person or at least one canonical lead is required'
      USING ERRCODE = '22023';
  END IF;

  -- TENANT CHECKS, before anything is written. A person or lead that exists
  -- under ANOTHER tenant refuses the whole call. (An id that no longer exists
  -- anywhere is not an error: there is nothing of it left to erase.)
  IF p_person_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.unified_persons p
     WHERE p.id = p_person_id AND p.company_id IS DISTINCT FROM p_organization_id
  ) THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: the person belongs to another tenant' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.canonical_leads l
     WHERE l.id = ANY (v_req_leads) AND l.company_id IS DISTINCT FROM p_organization_id
  ) THEN
    RAISE EXCEPTION 'pi_erase_prospect_provenance: a requested lead belongs to another tenant' USING ERRCODE = '42501';
  END IF;

  -- Serialise concurrent erasures of the same person.
  IF p_person_id IS NOT NULL THEN
    PERFORM 1 FROM public.unified_persons p
     WHERE p.id = p_person_id AND p.company_id = p_organization_id
       FOR UPDATE;
  END IF;

  v_mark := jsonb_build_object('redacted', true, 'erasure_id', v_erasure);

  -- The event row first (the per-contribution tombstones reference it); its
  -- counts are filled at the end. A failure anywhere rolls it back with
  -- everything else: no tombstone ever claims an erasure that did not happen.
  INSERT INTO public.prospect_provenance_erasures
    (id, organization_id, subject_kind, reason, requested_by)
  VALUES
    (v_erasure, p_organization_id,
     CASE WHEN p_person_id IS NULL THEN 'prospect' ELSE 'person' END,
     btrim(p_reason), btrim(p_requested_by));

  -- ── scope ──────────────────────────────────────────────────────────────
  SELECT coalesce(array_agg(DISTINCT l.id), ARRAY[]::uuid[]) INTO v_leads
    FROM public.canonical_leads l
   WHERE l.company_id = p_organization_id
     AND (l.id = ANY (v_req_leads)
          OR (p_person_id IS NOT NULL AND l.unified_person_id = p_person_id));

  SELECT coalesce(array_agg(DISTINCT c.contact_id) FILTER (WHERE c.contact_id IS NOT NULL), ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT c.lead_signal_id) FILTER (WHERE c.lead_signal_id IS NOT NULL), ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT c.opportunity_feed_item_id) FILTER (WHERE c.opportunity_feed_item_id IS NOT NULL), ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT c.engagement_message_id) FILTER (WHERE c.engagement_message_id IS NOT NULL), ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT c.source_record_id) FILTER (WHERE c.source_record_id IS NOT NULL), ARRAY[]::uuid[])
    INTO v_psc_contacts, v_psc_signals, v_psc_feed, v_psc_messages, v_psc_records
    FROM public.prospect_source_contributions c
   WHERE c.organization_id = p_organization_id
     AND c.canonical_lead_id = ANY (v_leads);

  SELECT coalesce(array_agg(DISTINCT u.id), ARRAY[]::uuid[]) INTO v_users
    FROM public.canonical_users u
   WHERE u.company_id = p_organization_id
     AND (u.id IN (SELECT l.user_id FROM public.canonical_leads l
                    WHERE l.company_id = p_organization_id AND l.id = ANY (v_leads))
          OR (p_person_id IS NOT NULL AND u.unified_person_id = p_person_id));

  SELECT coalesce(array_agg(k.id), ARRAY[]::uuid[]) INTO v_contacts
    FROM public.contacts k
   WHERE k.organization_id = p_organization_id
     AND ((p_person_id IS NOT NULL AND k.unified_person_id = p_person_id) OR k.id = ANY (v_psc_contacts));

  SELECT coalesce(array_agg(t.id), ARRAY[]::uuid[]) INTO v_threads
    FROM public.engagement_threads t
   WHERE t.organization_id = p_organization_id
     AND ((p_person_id IS NOT NULL AND t.unified_person_id = p_person_id) OR t.contact_id = ANY (v_contacts));

  SELECT coalesce(array_agg(m.id), ARRAY[]::uuid[]) INTO v_messages
    FROM public.engagement_messages m
   WHERE m.organization_id = p_organization_id
     AND (m.thread_id = ANY (v_threads) OR m.id = ANY (v_psc_messages));

  SELECT coalesce(array_agg(s.id), ARRAY[]::uuid[]) INTO v_signals
    FROM public.lead_signals s
   WHERE s.organization_id = p_organization_id
     AND (s.contact_id = ANY (v_contacts) OR s.thread_id = ANY (v_threads) OR s.id = ANY (v_psc_signals));

  SELECT coalesce(array_agg(f.id), ARRAY[]::uuid[]) INTO v_feed
    FROM public.opportunity_feed_items f
   WHERE f.organization_id = p_organization_id
     AND (f.signal_id = ANY (v_signals) OR f.id = ANY (v_psc_feed));

  -- PERSON-level source records only. An account record cited by the person's
  -- contribution describes a company and may back other prospects; it is not
  -- the subject's data (policy doc, source_records).
  SELECT coalesce(array_agg(r.id), ARRAY[]::uuid[]) INTO v_records
    FROM public.source_records r
   WHERE r.organization_id = p_organization_id
     AND r.source_entity_type = 'person'
     AND ((p_person_id IS NOT NULL AND r.person_id = p_person_id) OR r.id = ANY (v_psc_records));

  SELECT coalesce(array_agg(li.id), ARRAY[]::uuid[]) INTO v_li
    FROM public.lead_intelligence li
   WHERE li.company_id = p_organization_id
     AND p_person_id IS NOT NULL AND li.unified_person_id = p_person_id;

  -- ── 1. contributions (per-row tombstone; never deleted) ────────────────
  SELECT count(*)::int INTO v_already
    FROM public.prospect_source_contributions c
   WHERE c.organization_id = p_organization_id
     AND c.canonical_lead_id = ANY (v_leads)
     AND EXISTS (SELECT 1 FROM public.prospect_source_contribution_redactions t
                  WHERE t.contribution_id = c.id);

  FOR v_row IN
    SELECT c.id, c.canonical_lead_id, c.source_url, c.evidence, c.source_metadata
      FROM public.prospect_source_contributions c
     WHERE c.organization_id = p_organization_id
       AND c.canonical_lead_id = ANY (v_leads)
       AND NOT EXISTS (SELECT 1 FROM public.prospect_source_contribution_redactions t
                        WHERE t.contribution_id = c.id)
     ORDER BY c.id
     FOR UPDATE OF c
  LOOP
    v_cfields := ARRAY['external_ref']::text[];
    IF v_row.source_url IS NOT NULL THEN
      v_cfields := v_cfields || 'source_url'::text;
    END IF;
    v_cfields := v_cfields
      || coalesce((SELECT array_agg('evidence.' || k ORDER BY k)
                     FROM jsonb_object_keys(v_row.evidence) AS k), ARRAY[]::text[])
      || coalesce((SELECT array_agg('source_metadata.' || k ORDER BY k)
                     FROM jsonb_object_keys(v_row.source_metadata) AS k), ARRAY[]::text[]);

    v_tomb_id := gen_random_uuid();
    INSERT INTO public.prospect_source_contribution_redactions
      (id, organization_id, contribution_id, canonical_lead_id, reason, requested_by,
       redacted_fields, values_sha256, erasure_id)
    VALUES
      (v_tomb_id, p_organization_id, v_row.id, v_row.canonical_lead_id, btrim(p_reason),
       btrim(p_requested_by), v_cfields, NULL, v_erasure)
    ON CONFLICT (contribution_id) DO NOTHING;

    IF NOT FOUND THEN
      v_already := v_already + 1;      -- a concurrent call tombstoned it first
      CONTINUE;
    END IF;

    UPDATE public.prospect_source_contributions c
       SET source_url      = NULL,
           external_ref    = 'redacted:' || c.id::text,
           evidence        = v_mark || jsonb_build_object('redaction_id', v_tomb_id),
           source_metadata = v_mark || jsonb_build_object('redaction_id', v_tomb_id)
     WHERE c.id = v_row.id
       AND c.organization_id = p_organization_id;

    v_redacted := v_redacted + 1;
    v_ids := v_ids || v_row.id;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('prospect_source_contributions', v_redacted);
  IF v_redacted > 0 THEN
    v_fields := v_fields || ARRAY['prospect_source_contributions.source_url',
      'prospect_source_contributions.external_ref', 'prospect_source_contributions.evidence',
      'prospect_source_contributions.source_metadata'];
  END IF;

  -- ── 2. source_records (person-level) ───────────────────────────────────
  UPDATE public.source_records r
     SET source_url       = NULL,
         raw_payload      = v_mark,
         payload_hash     = encode(pg_catalog.sha256(convert_to(v_mark::text, 'UTF8')), 'hex'),
         source_record_id = 'redacted:' || r.id::text
   WHERE r.organization_id = p_organization_id
     AND r.id = ANY (v_records)
     AND (r.source_url IS NOT NULL
          OR r.source_record_id IS DISTINCT FROM 'redacted:' || r.id::text
          OR NOT (r.raw_payload @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('source_records', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['source_records.source_url', 'source_records.raw_payload',
      'source_records.payload_hash', 'source_records.source_record_id'];
  END IF;

  -- ── 3. source_assertions (of those records, and the person's own) ──────
  UPDATE public.source_assertions a
     SET raw_value        = NULL,
         normalized_value = '[redacted]',
         value_hash       = encode(pg_catalog.sha256(convert_to('redacted:' || a.id::text, 'UTF8')), 'hex'),
         account_id       = CASE WHEN a.entity_type = 'person' THEN NULL ELSE a.account_id END
   WHERE a.organization_id = p_organization_id
     AND (a.source_record_id = ANY (v_records)
          OR (p_person_id IS NOT NULL AND a.person_id = p_person_id AND a.entity_type = 'person'))
     AND (a.raw_value IS NOT NULL
          OR a.normalized_value IS DISTINCT FROM '[redacted]'
          OR (a.entity_type = 'person' AND a.account_id IS NOT NULL));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('source_assertions', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['source_assertions.raw_value', 'source_assertions.normalized_value',
      'source_assertions.value_hash'];
  END IF;

  -- ── 4. contacts ────────────────────────────────────────────────────────
  UPDATE public.contacts k
     SET display_name     = NULL,
         profile_url      = NULL,
         platform_user_id = 'redacted:' || k.id::text,
         contact_key      = 'redacted:' || k.id::text
   WHERE k.organization_id = p_organization_id
     AND k.id = ANY (v_contacts)
     AND (k.display_name IS NOT NULL OR k.profile_url IS NOT NULL
          OR k.platform_user_id IS DISTINCT FROM 'redacted:' || k.id::text
          OR k.contact_key IS DISTINCT FROM 'redacted:' || k.id::text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('contacts', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['contacts.display_name', 'contacts.profile_url',
      'contacts.platform_user_id', 'contacts.contact_key'];
  END IF;

  -- ── 5. lead_signals ────────────────────────────────────────────────────
  UPDATE public.lead_signals s
     SET content_text     = NULL,
         platform_user_id = NULL,
         contact_key      = NULL,
         crm_lead_id      = NULL,
         metadata         = v_mark,
         source_id        = 'redacted:' || s.id::text
   WHERE s.organization_id = p_organization_id
     AND s.id = ANY (v_signals)
     AND (s.content_text IS NOT NULL OR s.platform_user_id IS NOT NULL OR s.contact_key IS NOT NULL
          OR s.crm_lead_id IS NOT NULL OR s.source_id IS DISTINCT FROM 'redacted:' || s.id::text
          OR NOT (s.metadata @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lead_signals', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['lead_signals.content_text', 'lead_signals.platform_user_id',
      'lead_signals.contact_key', 'lead_signals.crm_lead_id', 'lead_signals.metadata', 'lead_signals.source_id'];
  END IF;

  -- ── 6. opportunity_feed_items ──────────────────────────────────────────
  UPDATE public.opportunity_feed_items f
     SET author_metadata        = v_mark,
         source_context         = v_mark,
         explanation            = v_mark,
         recommendation_context = v_mark,
         source_identifier      = NULL,
         detected_reason        = '[redacted]'
   WHERE f.organization_id = p_organization_id
     AND f.id = ANY (v_feed)
     AND (f.source_identifier IS NOT NULL OR f.detected_reason IS DISTINCT FROM '[redacted]'
          OR NOT (f.author_metadata @> '{"redacted": true}'::jsonb)
          OR NOT (f.source_context @> '{"redacted": true}'::jsonb)
          OR NOT (f.explanation @> '{"redacted": true}'::jsonb)
          OR NOT (f.recommendation_context @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('opportunity_feed_items', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['opportunity_feed_items.author_metadata', 'opportunity_feed_items.source_context',
      'opportunity_feed_items.explanation', 'opportunity_feed_items.recommendation_context',
      'opportunity_feed_items.source_identifier', 'opportunity_feed_items.detected_reason'];
  END IF;

  -- ── 7. engagement threads / messages and the tables that copy their text ─
  UPDATE public.engagement_threads t
     SET raw_payload        = NULL,
         platform_thread_id = 'redacted:' || t.id::text
   WHERE t.organization_id = p_organization_id
     AND t.id = ANY (v_threads)
     AND (t.raw_payload IS NOT NULL OR t.platform_thread_id IS DISTINCT FROM 'redacted:' || t.id::text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_threads', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['engagement_threads.raw_payload', 'engagement_threads.platform_thread_id'];
  END IF;

  UPDATE public.engagement_messages m
     SET content             = NULL,
         raw_payload         = NULL,
         actor_external_id   = NULL,
         author_id           = NULL,
         platform_parent_id  = NULL,
         sync_thread_id      = NULL,
         platform_message_id = 'redacted:' || m.id::text
   WHERE m.organization_id = p_organization_id
     AND m.id = ANY (v_messages)
     AND (m.content IS NOT NULL OR m.raw_payload IS NOT NULL OR m.actor_external_id IS NOT NULL
          OR m.author_id IS NOT NULL OR m.platform_parent_id IS NOT NULL OR m.sync_thread_id IS NOT NULL
          OR m.platform_message_id IS DISTINCT FROM 'redacted:' || m.id::text);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_messages', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['engagement_messages.content', 'engagement_messages.raw_payload',
      'engagement_messages.actor_external_id', 'engagement_messages.author_id',
      'engagement_messages.platform_parent_id', 'engagement_messages.sync_thread_id',
      'engagement_messages.platform_message_id'];
  END IF;

  UPDATE public.engagement_message_sources ms
     SET platform_message_id = 'redacted:' || ms.id::text
   WHERE ms.engagement_message_id = ANY (v_messages)
     AND ms.platform_message_id IS DISTINCT FROM 'redacted:' || ms.id::text;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_message_sources', v_n);
  IF v_n > 0 THEN v_fields := v_fields || 'engagement_message_sources.platform_message_id'::text; END IF;

  UPDATE public.engagement_insight_evidence e
     SET author_name = NULL, text_snippet = NULL
   WHERE (e.thread_id = ANY (v_threads) OR e.message_id = ANY (v_messages))
     AND (e.author_name IS NOT NULL OR e.text_snippet IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_insight_evidence', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['engagement_insight_evidence.author_name', 'engagement_insight_evidence.text_snippet'];
  END IF;

  UPDATE public.engagement_opportunities o
     SET opportunity_text = NULL, author_id = NULL
   WHERE o.organization_id = p_organization_id
     AND (o.source_thread_id = ANY (v_threads) OR o.source_message_id = ANY (v_messages))
     AND (o.opportunity_text IS NOT NULL OR o.author_id IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_opportunities', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['engagement_opportunities.opportunity_text', 'engagement_opportunities.author_id'];
  END IF;

  UPDATE public.engagement_thread_memory tm
     SET conversation_summary = NULL
   WHERE tm.thread_id = ANY (v_threads) AND tm.conversation_summary IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_thread_memory', v_n);
  IF v_n > 0 THEN v_fields := v_fields || 'engagement_thread_memory.conversation_summary'::text; END IF;

  UPDATE public.engagement_thread_intelligence ti
     SET priority_reason = NULL
   WHERE ti.thread_id = ANY (v_threads) AND ti.priority_reason IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_thread_intelligence', v_n);
  IF v_n > 0 THEN v_fields := v_fields || 'engagement_thread_intelligence.priority_reason'::text; END IF;

  UPDATE public.engagement_lead_signals els
     SET author_id = NULL
   WHERE els.organization_id = p_organization_id
     AND (els.message_id = ANY (v_messages) OR els.thread_id = ANY (v_threads))
     AND els.author_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('engagement_lead_signals', v_n);
  IF v_n > 0 THEN v_fields := v_fields || 'engagement_lead_signals.author_id'::text; END IF;

  -- The handle → person link of THIS tenant's person. The table has no tenant
  -- column; the person id is tenant-checked above, so the rows are this
  -- tenant's. The row has no content besides the handle, so it is removed.
  IF p_person_id IS NOT NULL THEN
    DELETE FROM public.engagement_identity_candidates ic
     WHERE ic.unified_person_id = p_person_id
       AND EXISTS (SELECT 1 FROM public.unified_persons p
                    WHERE p.id = p_person_id AND p.company_id = p_organization_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    v_n := 0;
  END IF;
  v_counts := v_counts || jsonb_build_object('engagement_identity_candidates', v_n);
  IF v_n > 0 THEN v_fields := v_fields || 'engagement_identity_candidates.*'::text; END IF;

  -- ── 8. lead_intelligence (+ events, + profiles) ────────────────────────
  -- unified_person_id is cleared too: lead_intelligence_person_tenant_fk is ON
  -- DELETE RESTRICT, so a linked row would make the person undeletable, and the
  -- link itself is the last thing tying the residue to the subject.
  UPDATE public.lead_intelligence_events ev
     SET metadata = v_mark, entity_id = NULL
   WHERE ev.lead_id = ANY (v_li)
     AND ev.company_id = p_organization_id::text
     AND (ev.entity_id IS NOT NULL OR NOT (ev.metadata @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lead_intelligence_events', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['lead_intelligence_events.metadata', 'lead_intelligence_events.entity_id'];
  END IF;

  UPDATE public.lead_intelligence_profiles pr
     SET intelligence = v_mark, diagnostics = v_mark
   WHERE pr.company_id = p_organization_id
     AND pr.lead_id = ANY (SELECT x::text FROM unnest(v_li) AS x)
     AND (NOT (pr.intelligence @> '{"redacted": true}'::jsonb)
          OR pr.diagnostics IS NULL OR NOT (pr.diagnostics @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lead_intelligence_profiles', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['lead_intelligence_profiles.intelligence', 'lead_intelligence_profiles.diagnostics'];
  END IF;

  UPDATE public.lead_intelligence li
     SET identity          = v_mark,
         attribution       = v_mark,
         content           = v_mark,
         metadata          = v_mark,
         dedupe_key        = 'redacted:' || li.id::text,
         source_id         = NULL,
         unified_person_id = NULL
   WHERE li.company_id = p_organization_id
     AND li.id = ANY (v_li);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lead_intelligence', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['lead_intelligence.identity', 'lead_intelligence.attribution',
      'lead_intelligence.content', 'lead_intelligence.metadata', 'lead_intelligence.dedupe_key',
      'lead_intelligence.source_id', 'lead_intelligence.unified_person_id'];
  END IF;

  -- ── 9. the prospect rows themselves (rows survive: PL-DEC-003 is the owner's) ─
  UPDATE public.canonical_leads l
     SET lead_metadata     = v_mark,
         external_lead_key = NULL
   WHERE l.company_id = p_organization_id
     AND l.id = ANY (v_leads)
     AND (l.external_lead_key IS NOT NULL OR NOT (l.lead_metadata @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('canonical_leads', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['canonical_leads.lead_metadata', 'canonical_leads.external_lead_key'];
  END IF;

  UPDATE public.canonical_users u
     SET email             = NULL,
         full_name         = NULL,
         phone             = NULL,
         geo               = NULL,
         external_user_key = NULL,
         user_metadata     = v_mark
   WHERE u.company_id = p_organization_id
     AND u.id = ANY (v_users)
     AND (u.email IS NOT NULL OR u.full_name IS NOT NULL OR u.phone IS NOT NULL OR u.geo IS NOT NULL
          OR u.external_user_key IS NOT NULL OR NOT (u.user_metadata @> '{"redacted": true}'::jsonb));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('canonical_users', v_n);
  IF v_n > 0 THEN
    v_fields := v_fields || ARRAY['canonical_users.email', 'canonical_users.full_name', 'canonical_users.phone',
      'canonical_users.geo', 'canonical_users.external_user_key', 'canonical_users.user_metadata'];
  END IF;

  UPDATE public.prospect_provenance_erasures e
     SET canonical_lead_ids = v_leads,
         table_counts       = v_counts,
         redacted_fields    = v_fields
   WHERE e.id = v_erasure;

  RETURN jsonb_build_object(
    'erasure_id', v_erasure,
    'redacted', v_redacted,
    'already_redacted', v_already,
    'contribution_ids', to_jsonb(v_ids),
    'canonical_lead_ids', to_jsonb(v_leads),
    'counts', v_counts);
END
$fn$;

REVOKE ALL ON FUNCTION public.pi_erase_prospect_provenance(uuid, uuid, uuid[], text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.pi_erase_prospect_provenance(uuid, uuid, uuid[], text, text)
  TO service_role;

COMMENT ON FUNCTION public.pi_erase_prospect_provenance(uuid, uuid, uuid[], text, text) IS
  'Complete provenance erasure for a person and/or canonical prospects of ONE tenant, in one '
  'transaction: contributions (+tombstones), person source records and assertions, contacts, '
  'lead signals, feed items, engagement threads/messages and their text copies, '
  'lead_intelligence(+events,+profiles), canonical_leads metadata, canonical_users. Refuses '
  '(42501) another tenant''s person or lead with nothing changed. Idempotent. Never deletes the '
  'person (the caller does, after success). SECURITY DEFINER; EXECUTE service_role only. '
  'Policy: docs/architecture/PROSPECT-PROVENANCE-ERASURE-POLICY.md.';

-- The 20270108000001 entry point keeps its signature and grants (re-stated
-- explicitly below) but can no longer write a value hash and now performs the
-- complete prospect-level erasure.
CREATE OR REPLACE FUNCTION public.pi_redact_prospect_source_contributions(
  p_organization_id    uuid,
  p_canonical_lead_ids uuid[],
  p_reason             text,
  p_requested_by       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_r jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'pi_redact_prospect_source_contributions: organization_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_canonical_lead_ids IS NULL OR cardinality(p_canonical_lead_ids) = 0 THEN
    IF p_reason IS NULL OR btrim(p_reason) = '' OR p_requested_by IS NULL OR btrim(p_requested_by) = '' THEN
      RAISE EXCEPTION 'pi_redact_prospect_source_contributions: reason and requested_by are required'
        USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('redacted', 0, 'already_redacted', 0, 'contribution_ids', '[]'::jsonb);
  END IF;
  v_r := public.pi_erase_prospect_provenance(
    p_organization_id, NULL, p_canonical_lead_ids, p_reason, p_requested_by);
  -- The 20270108000001 result shape, unchanged for its callers.
  RETURN jsonb_build_object(
    'redacted', v_r -> 'redacted',
    'already_redacted', v_r -> 'already_redacted',
    'contribution_ids', v_r -> 'contribution_ids');
END
$fn$;

REVOKE ALL ON FUNCTION public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)
  TO service_role;

COMMENT ON FUNCTION public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text) IS
  'Prospect-level entry point (20270108000001 signature). Since 20270109000000 it delegates to '
  'public.pi_erase_prospect_provenance(org, NULL, leads, reason, requested_by): complete erasure, '
  'no value hash. SECURITY DEFINER; EXECUTE service_role only.';

-- ── D. Postconditions ─────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_n      int;
  v_rls    boolean;
  v_force  boolean;
  v_priv   text[];
  v_leaked text[];
  v_secdef boolean;
  v_config text[];
  v_fn     regprocedure;
  r        record;
BEGIN
  IF to_regclass('public.prospect_provenance_erasures') IS NULL THEN
    RAISE EXCEPTION 'PEC postcondition: prospect_provenance_erasures is missing';
  END IF;

  -- value hashing is retired and enforced
  IF EXISTS (SELECT 1 FROM public.prospect_source_contribution_redactions WHERE values_sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'PEC postcondition: a tombstone still carries a value hash';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'pscr_values_sha256_retired' AND contype = 'c'
                    AND conrelid = 'public.prospect_source_contribution_redactions'::regclass
                    AND pg_get_constraintdef(oid) = 'CHECK ((values_sha256 IS NULL))') THEN
    RAISE EXCEPTION 'PEC postcondition: pscr_values_sha256_retired must be CHECK (values_sha256 IS NULL)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'prospect_source_contribution_redactions'
                AND column_name = 'values_sha256' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'PEC postcondition: values_sha256 must be nullable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'pscr_erasure_tenant_fk' AND c.confdeltype = 'n'
       AND c.conrelid = 'public.prospect_source_contribution_redactions'::regclass
       AND c.confrelid = 'public.prospect_provenance_erasures'::regclass
       AND array_length(c.confdelsetcols, 1) = 1) THEN
    RAISE EXCEPTION 'PEC postcondition: pscr_erasure_tenant_fk must be a composite FK ON DELETE SET NULL (erasure_id)';
  END IF;

  -- the event table never stores a person reference or a value hash
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'prospect_provenance_erasures'
     AND (column_name LIKE '%person%' OR column_name LIKE '%hash%' OR column_name LIKE '%sha%' OR column_name LIKE '%value%');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'PEC postcondition: prospect_provenance_erasures must not carry a person reference or a value/hash column';
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.prospect_provenance_erasures'::regclass AND contype = 'c'
     AND conname IN ('ppe_subject_kind_valid', 'ppe_reason_nonblank', 'ppe_requested_by_nonblank', 'ppe_table_counts_object');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'PEC postcondition: expected 4 named CHECKs on prospect_provenance_erasures, found %', v_n;
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'public.prospect_provenance_erasures'::regclass;
  IF NOT v_rls OR v_force THEN
    RAISE EXCEPTION 'PEC postcondition: prospect_provenance_erasures must have RLS enabled and not forced';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'prospect_provenance_erasures';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PEC postcondition: prospect_provenance_erasures must carry exactly one policy, found %', v_n;
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('prospect_provenance_erasures',             ARRAY['SELECT']),
      ('prospect_source_contribution_redactions',  ARRAY['SELECT']),
      ('prospect_source_contributions',            ARRAY['INSERT', 'SELECT'])) AS t(tbl, expected)
  LOOP
    SELECT array_agg(DISTINCT a.privilege_type ORDER BY a.privilege_type) INTO v_priv
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r2 ON r2.oid = a.grantee
     WHERE c.oid = ('public.' || r.tbl)::regclass AND r2.rolname = 'service_role';
    IF v_priv IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'PEC postcondition: service_role on % must hold exactly %, found %',
        r.tbl, r.expected, coalesce(v_priv::text, '{}');
    END IF;
    SELECT array_agg(DISTINCT r2.rolname || ':' || a.privilege_type) INTO v_leaked
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      JOIN pg_roles r2 ON r2.oid = a.grantee
     WHERE c.oid = ('public.' || r.tbl)::regclass
       AND r2.rolname IN ('anon', 'authenticated', 'authenticator');
    IF v_leaked IS NOT NULL THEN
      RAISE EXCEPTION 'PEC postcondition: client roles must hold nothing on %, found %', r.tbl, v_leaked;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE c.oid = ('public.' || r.tbl)::regclass AND a.grantee = 0;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'PEC postcondition: PUBLIC must hold nothing on %', r.tbl;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
      to_regprocedure('public.pi_erase_prospect_provenance(uuid, uuid, uuid[], text, text)'),
      to_regprocedure('public.pi_redact_prospect_source_contributions(uuid, uuid[], text, text)')]
  LOOP
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'PEC postcondition: an erasure function is missing';
    END IF;
    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
    IF NOT v_secdef OR v_config IS NULL OR NOT (v_config @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'PEC postcondition: % must be SECURITY DEFINER with search_path pinned to empty', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticator', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'PEC postcondition: EXECUTE on % must be service_role only', v_fn;
    END IF;
    SELECT count(*) INTO v_n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
     WHERE p.oid = v_fn AND a.grantee = 0;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'PEC postcondition: PUBLIC must not EXECUTE %', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'PEC: verified — pi_erase_prospect_provenance + pi_redact_prospect_source_contributions SECURITY DEFINER, search_path pinned, EXECUTE service_role only; prospect_provenance_erasures (4 CHECKs, no person/value/hash column, RLS, service_role SELECT only); tombstone value hashes retired (all NULL, CHECK enforced); prospect_source_contributions still service_role {INSERT,SELECT}.';
END
$verify$;

COMMIT;
