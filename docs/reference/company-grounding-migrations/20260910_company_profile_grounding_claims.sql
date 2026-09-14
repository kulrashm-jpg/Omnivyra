-- CPG-001/005 — company-profile grounding: claim-level evidence + confirmation history.
--
-- ⚠️ NOT APPLIED TO PRODUCTION. Authored for a non-production environment only.
--
-- WHY NEW TABLES RATHER THAN NEW COLUMNS
-- --------------------------------------
-- The existing provenance model on `company_profiles` (`field_confidence`,
-- `user_locked_fields`, `report_settings.discovered_metadata.provenance`) is ONE
-- ROW PER COMPANY and one value per field. It cannot hold N competing claims for
-- the same field, each with its own source URL, access date and entity-match
-- verdict — which is exactly what conflict detection and traceability require.
-- These tables are additive: nothing in the existing company-profile model
-- changes, and the existing provenance surface keeps working untouched.
--
-- CPG-005 HARDENING (four real gaps found by the CPG-005 audit):
--   1. IDEMPOTENCY. The original had NO uniqueness on claims, so re-running
--      acquisition would have grown duplicates without bound. A natural key now
--      makes "same claim, observed again" an UPDATE of observation metadata
--      rather than a new row — while a CHANGED value is still a new row, so
--      history survives. This is the §8 requirement.
--   2. FACT vs SYNTHESIS is now enforced by CHECK, not convention: a SYNTHESIS
--      or RECOMMENDATION cannot carry a source URL, and cannot claim an external
--      source type. Synthesis can no longer masquerade as evidenced fact.
--   3. HISTORY IS APPEND-ONLY BY TRIGGER, not merely by an absent policy. A
--      service-role client bypasses RLS; a trigger it cannot.
--   4. FOREIGN KEYS to public.companies, so grounding cannot outlive its tenant.
--
-- RETENTION / PRIVACY: `excerpt` is capped and intended for a short supporting
-- snippet only. It must not mirror third-party article bodies. `source_url` is
-- the durable reference; the excerpt is a convenience.

-- ── evidence claims ─────────────────────────────────────────────────────────
create table if not exists public.company_grounding_claims (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  field                 text not null,
  value                 text not null,
  normalized_value      text not null,
  claim_kind            text not null check (claim_kind in ('FACT','SOURCE_DERIVED_FACT','SYNTHESIS','RECOMMENDATION')),
  source_type           text not null,
  source_name           text not null,
  source_url            text,
  -- CPG-005: which provider FAMILY this came from, so corroboration cannot be
  -- inflated by counting two pages of one site as two sources.
  provider_family       text not null default 'unknown',
  source_published_at   timestamptz,
  source_accessed_at    timestamptz not null,
  source_tier           smallint not null check (source_tier between 1 and 4),
  -- CPG-005: authority is CLAIM-RELATIVE (CPG-003), so it is stored per claim.
  field_authority       text not null default 'unrated'
                          check (field_authority in ('authoritative','weak','never','unrated')),
  excerpt               text check (excerpt is null or char_length(excerpt) <= 1000),
  verification_method   text not null check (verification_method in ('crawl','provider_api','user_input','derivation')),
  entity_match_status   text not null check (entity_match_status in ('exact','strong','weak','mismatch','unresolved')),
  entity_match_score    numeric(4,3) not null default 0,
  freshness             text not null default 'unknown'
                          check (freshness in ('fresh','aging','stale','unknown')),
  -- CPG-005 idempotency bookkeeping: re-observing a claim updates these.
  observation_count     integer not null default 1 check (observation_count >= 1),
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  last_verified_at      timestamptz,
  stale_after           timestamptz,
  created_by            text not null,
  created_at            timestamptz not null default now(),

  -- §5 — a non-user, non-synthesis claim MUST carry a traceable URL.
  constraint company_grounding_claims_url_required
    check (source_type in ('user','omnivyra_synthesis') or source_url is not null),

  -- §4 — synthesis can NEVER masquerade as externally evidenced fact.
  constraint company_grounding_claims_synthesis_unsourced
    check (
      claim_kind not in ('SYNTHESIS','RECOMMENDATION')
      or (source_url is null and source_type = 'omnivyra_synthesis')
    ),
  -- …and conversely, an external source type may not be filed as synthesis.
  constraint company_grounding_claims_fact_not_synthetic
    check (
      claim_kind not in ('FACT','SOURCE_DERIVED_FACT')
      or source_type <> 'omnivyra_synthesis'
    )
);

-- §8 — THE IDEMPOTENCY KEY. Same field + same value + same document = ONE row,
-- re-observed. A different value from the same document, or the same value from
-- a different document, is a genuinely different claim and gets its own row.
create unique index if not exists uq_cgc_natural_key
  on public.company_grounding_claims (company_id, field, normalized_value, coalesce(source_url, ''));

create index if not exists idx_cgc_company_field
  on public.company_grounding_claims (company_id, field);
create index if not exists idx_cgc_company_accessed
  on public.company_grounding_claims (company_id, source_accessed_at desc);

-- ── resolved per-field state ────────────────────────────────────────────────
create table if not exists public.company_grounding_fields (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete cascade,
  field                  text not null,
  claim_kind             text not null,
  status                 text not null check (status in
                           ('USER_PROVIDED','PUBLICLY_VERIFIED','PUBLICLY_REPORTED','CONFLICTING','UNVERIFIED','SYNTHESIZED')),
  effective_value        text,
  effective_value_source text not null check (effective_value_source in ('user','public_evidence','user_correction','none')),
  user_value             text,
  user_asserted_at       timestamptz,
  confidence_score       smallint not null default 0 check (confidence_score between 0 and 100),
  confidence_band        text not null,
  -- Inputs to the score, so the number stays inspectable rather than magic.
  confidence_components  jsonb not null default '{}'::jsonb,
  freshness              text not null default 'unknown',
  entity_match_status    text not null default 'unresolved',
  -- CPG-005: how many INDEPENDENT provider families corroborate the value.
  independent_families   integer not null default 0 check (independent_families >= 0),
  is_material_conflict   boolean not null default false,
  confirmation_status    text not null default 'NOT_REQUIRED',
  -- §14 — an unavailable/failed source must stay explicitly represented.
  acquisition_outcome    jsonb not null default '{}'::jsonb,
  last_verified_at       timestamptz,
  stale_after            timestamptz,
  updated_at             timestamptz not null default now(),
  unique (company_id, field)
);

create index if not exists idx_cgf_company_conflict
  on public.company_grounding_fields (company_id, is_material_conflict)
  where is_material_conflict = true;

-- ── append-only history ─────────────────────────────────────────────────────
create table if not exists public.company_grounding_history (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  field         text not null,
  occurred_at   timestamptz not null default now(),
  actor         text not null,
  action        text not null check (action in
                  ('user_asserted','evidence_discovered','conflict_detected','user_confirmed_own',
                   'user_accepted_public','user_corrected','user_marked_source_stale',
                   'user_supplied_source','user_deferred','value_changed','acquisition_failed')),
  from_value    text,
  to_value      text,
  note          text,
  evidence_ids  uuid[] not null default '{}'
);

create index if not exists idx_cgh_company_field_time
  on public.company_grounding_history (company_id, field, occurred_at desc);

-- §3 — APPEND-ONLY ENFORCED BY TRIGGER.
-- An absent RLS policy stops a normal client but NOT a service-role client,
-- which bypasses RLS entirely. A trigger stops both. A user correction must
-- never be able to erase the public claim that preceded it.
create or replace function public.company_grounding_history_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'company_grounding_history is append-only: % is not permitted', tg_op;
end $$;

drop trigger if exists trg_cgh_no_update on public.company_grounding_history;
create trigger trg_cgh_no_update before update on public.company_grounding_history
  for each row execute function public.company_grounding_history_append_only();

drop trigger if exists trg_cgh_no_delete on public.company_grounding_history;
create trigger trg_cgh_no_delete before delete on public.company_grounding_history
  for each row execute function public.company_grounding_history_append_only();

-- ── tenant isolation ────────────────────────────────────────────────────────
-- Every table is company-scoped and RLS-enforced. Membership resolves through
-- the existing user_company_roles seam rather than a new authorization concept.
alter table public.company_grounding_claims  enable row level security;
alter table public.company_grounding_fields  enable row level security;
alter table public.company_grounding_history enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'company_grounding_claims','company_grounding_fields','company_grounding_history'
  ] loop
    execute format($f$
      drop policy if exists %1$s_tenant_select on public.%1$I;
      create policy %1$s_tenant_select on public.%1$I
        for select using (
          exists (
            select 1 from public.user_company_roles ucr
            where ucr.company_id = %1$I.company_id
              and ucr.user_id = auth.uid()
          )
        );
      drop policy if exists %1$s_tenant_insert on public.%1$I;
      create policy %1$s_tenant_insert on public.%1$I
        for insert with check (
          exists (
            select 1 from public.user_company_roles ucr
            where ucr.company_id = %1$I.company_id
              and ucr.user_id = auth.uid()
          )
        );
    $f$, t);
  end loop;
end $$;

-- Resolved-state rows may be updated by a member; history may not (trigger).
-- Claims may be updated ONLY to record re-observation (see the service layer).
drop policy if exists company_grounding_fields_tenant_update on public.company_grounding_fields;
create policy company_grounding_fields_tenant_update on public.company_grounding_fields
  for update using (
    exists (
      select 1 from public.user_company_roles ucr
      where ucr.company_id = company_grounding_fields.company_id
        and ucr.user_id = auth.uid()
    )
  );

drop policy if exists company_grounding_claims_tenant_update on public.company_grounding_claims;
create policy company_grounding_claims_tenant_update on public.company_grounding_claims
  for update using (
    exists (
      select 1 from public.user_company_roles ucr
      where ucr.company_id = company_grounding_claims.company_id
        and ucr.user_id = auth.uid()
    )
  );

comment on table public.company_grounding_claims is
  'CPG-001/005: one externally discovered or user-asserted claim about a company field, with its traceable source. Natural key (company_id, field, normalized_value, source_url) makes re-observation idempotent.';
comment on table public.company_grounding_history is
  'CPG-001/005: append-only, enforced by trigger. A user correction is a new row, never an overwrite.';
