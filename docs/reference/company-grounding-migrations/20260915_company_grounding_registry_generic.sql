-- ============================================================================
-- CPG-011 — country-neutral registry identity persistence
-- ============================================================================
--
-- ADDITIVE and IDEMPOTENT. Extends company_grounding_claims; creates no table;
-- rewrites no observation.
--
-- ⚠️ CPG-010 (20260914) encoded two COUNTRIES into constraints:
--     registry_provider in ('sec_edgar','mca','other')
--     registry_id ~ 'CIK:…|CIN:…|LLPIN:…|EIN:…|RAW:…'
--   so a French SIREN, an LEI or any future registry could not be stored at
--   all. They are replaced by FORMAT constraints: a provider is any registered
--   provider id; an identifier is any SCHEME-QUALIFIED value ("SIREN:…").
--   Which schemes exist is the provider registry's business, not the schema's.
--
-- New, for the generic registry response (API §22):
--   registry_jurisdiction  country-qualified jurisdiction ("US-DE", "FR",
--                          "GLOBAL") — a bare subdivision is not accepted
--                          (SEC "DE" = Delaware ≠ ISO "DE" = Germany);
--   registry_scheme        the identifier scheme ("CIK", "SIREN", "LEI");
--   registry_status        as the registry states it (active / inactive);
--   registry_role          subject | site_publisher | related_entity — which
--                          legal entity the declared identity is FOR THE COMPANY.
-- The declared scheme and jurisdiction are provenance (immutable once
-- written); status and role are decisions (re-evaluated).
--
-- NOT APPLIED TO PRODUCTION. Local, conclusively non-production database only.
-- ============================================================================

alter table public.company_grounding_claims
  add column if not exists registry_jurisdiction text,
  add column if not exists registry_scheme       text,
  add column if not exists registry_status       text,
  add column if not exists registry_role         text;

alter table public.company_grounding_claims
  -- replaced: no provider list in the schema
  drop constraint if exists chk_cgc_registry_provider,
  add constraint chk_cgc_registry_provider check (registry_provider is null
    or registry_provider ~ '^[a-z][a-z0-9_]{1,63}$'),

  -- replaced: any scheme-qualified identifier; RAW stays for unqualified legacy values
  drop constraint if exists chk_cgc_registry_id,
  add constraint chk_cgc_registry_id check (registry_id is null
    or registry_id ~ '^[A-Z][A-Z0-9_]{1,15}:[^[:space:]].{0,119}$'),

  drop constraint if exists chk_cgc_registry_scheme,
  add constraint chk_cgc_registry_scheme check (registry_scheme is null
    or registry_scheme ~ '^[A-Z][A-Z0-9_]{1,15}$'),

  -- the scheme is the identifier's own prefix — they cannot disagree
  drop constraint if exists chk_cgc_registry_scheme_matches_id,
  add constraint chk_cgc_registry_scheme_matches_id check (registry_scheme is null
    or (registry_id is not null and split_part(registry_id, ':', 1) = registry_scheme)),

  drop constraint if exists chk_cgc_registry_jurisdiction,
  add constraint chk_cgc_registry_jurisdiction check (registry_jurisdiction is null
    or registry_jurisdiction ~ '^(GLOBAL|[A-Z]{2}(-[A-Z0-9]{1,3})?)$'),

  drop constraint if exists chk_cgc_registry_status,
  add constraint chk_cgc_registry_status check (registry_status is null
    or registry_status in ('active','inactive')),

  drop constraint if exists chk_cgc_registry_role,
  add constraint chk_cgc_registry_role check (registry_role is null
    or registry_role in ('subject','site_publisher','related_entity'));

-- Re-declared (from 20260914) to add the declared scheme and jurisdiction to the
-- immutable provenance set. Status and role are decisions: NOT included.
create or replace function public.company_grounding_claims_extraction_immutable()
returns trigger language plpgsql as $$
begin
  if new.extraction_statement is distinct from old.extraction_statement
     or new.temporal_type      is distinct from old.temporal_type
     or new.period_label       is distinct from old.period_label
     or new.period_year        is distinct from old.period_year
     or new.currency           is distinct from old.currency
     or new.approximation      is distinct from old.approximation
     or new.money_kind         is distinct from old.money_kind
     or new.extraction_method  is distinct from old.extraction_method
     or new.accepted_because   is distinct from old.accepted_because
     or new.discovery_provider is distinct from old.discovery_provider
     or new.discovery_query    is distinct from old.discovery_query
     or new.discovery_rank     is distinct from old.discovery_rank
     or new.measure_qualifier  is distinct from old.measure_qualifier
     or new.source_host        is distinct from old.source_host
     or new.publisher          is distinct from old.publisher
     or new.identity_evidence  is distinct from old.identity_evidence
     or (old.registry_id is not null and new.registry_id is distinct from old.registry_id)
     or (old.registry_provider is not null and new.registry_provider is distinct from old.registry_provider)
     or (old.legal_entity_name is not null and new.legal_entity_name is distinct from old.legal_entity_name)
     or (old.registry_scheme is not null and new.registry_scheme is distinct from old.registry_scheme)
     or (old.registry_jurisdiction is not null and new.registry_jurisdiction is distinct from old.registry_jurisdiction) then
    raise exception 'company_grounding_claims extraction provenance is immutable';
  end if;
  return new;
end $$;

comment on column public.company_grounding_claims.registry_jurisdiction is
  'CPG-011: country-qualified jurisdiction of the declared legal entity ("US-DE", "FR", "GLOBAL"). Immutable once written.';
comment on column public.company_grounding_claims.registry_scheme is
  'CPG-011: identifier scheme of registry_id ("CIK", "SIREN", "LEI", …) — an open code defined by a registry provider, not a schema list.';
comment on column public.company_grounding_claims.registry_role is
  'CPG-011: subject (the company) | site_publisher (named by the company''s legal notice, not shown to be it) | related_entity (explicit registry relationship).';
