-- ============================================================================
-- CPG-010 — authoritative registry identity & source authority (B-18 storage)
-- ============================================================================
--
-- ADDITIVE and IDEMPOTENT. Extends company_grounding_claims only; creates no
-- table; rewrites no prior observation. Rows written before CPG-010 keep the
-- new columns NULL (source_kind / source_registry_id included — they were never
-- recorded, and are not back-filled by guess).
--
-- What a future audit must be able to reconstruct for each claim:
--   · WHICH SOURCE it was attributed to (source_registry_id: the CPG-003
--     descriptor, e.g. sec_edgar_registrant, first_party_ir, tracxn) and WHAT
--     KIND of document it is (source_kind). A kind is a description, never an
--     authority: authority stays field-specific (field_authority).
--   · the REGISTRY IDENTITY the document itself declares — provider, normalised
--     identifier (CIK:0001477333, CIN:L85110KA1981PLC013115) and legal entity
--     name. IMMUTABLE provenance, like everything the document states.
--   · HOW that identity was tied to the company (identity_association: how it
--     was established, whether the registry itself confirmed it, the chain of
--     source URLs), and the explicit DOMAIN association the attribution rests
--     on (domain_association_reason + detail). These are DECISIONS: they are
--     re-evaluated on re-observation, as identity_class is.
--
-- NOT APPLIED TO PRODUCTION. Local, conclusively non-production database only.
-- ============================================================================

alter table public.company_grounding_claims
  add column if not exists source_registry_id        text,
  add column if not exists source_kind               text,
  add column if not exists registry_provider         text,
  add column if not exists registry_id               text,
  add column if not exists legal_entity_name         text,
  add column if not exists identity_association      jsonb,
  add column if not exists domain_association_reason text,
  add column if not exists domain_association        jsonb;

alter table public.company_grounding_claims
  drop constraint if exists chk_cgc_source_kind,
  add constraint chk_cgc_source_kind check (source_kind is null or source_kind in (
    'corporate_registry','regulatory_filing','company_owned','financial_database',
    'news_media','knowledge_graph','other')),

  drop constraint if exists chk_cgc_source_registry_id,
  add constraint chk_cgc_source_registry_id check (source_registry_id is null
    or source_registry_id ~ '^[a-z][a-z0-9_]{1,63}$'),

  drop constraint if exists chk_cgc_registry_provider,
  add constraint chk_cgc_registry_provider check (registry_provider is null
    or registry_provider in ('sec_edgar','mca','other')),

  -- Normalised, scheme-prefixed identifiers only — a bare number is not an id.
  drop constraint if exists chk_cgc_registry_id,
  add constraint chk_cgc_registry_id check (registry_id is null
    or registry_id ~ '^(CIK:[0-9]{10}|CIN:[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}|LLPIN:[A-Z]{3}-[0-9]{4}|EIN:[0-9]{9}|RAW:.{1,120})$'),

  drop constraint if exists chk_cgc_legal_entity_name,
  add constraint chk_cgc_legal_entity_name check (legal_entity_name is null
    or char_length(legal_entity_name) between 1 and 300),

  -- A provider is only recorded with the identifier it issued.
  drop constraint if exists chk_cgc_registry_provider_has_id,
  add constraint chk_cgc_registry_provider_has_id check (registry_provider is null or registry_id is not null),

  -- coalesce(…, false): a missing key makes jsonb_typeof NULL, and a CHECK
  -- that evaluates to NULL PASSES — the chain would silently be optional.
  drop constraint if exists chk_cgc_identity_association_object,
  add constraint chk_cgc_identity_association_object check (identity_association is null
    or coalesce(jsonb_typeof(identity_association) = 'object'
        and identity_association ? 'establishedBy'
        and identity_association ? 'registryVerified'
        and jsonb_typeof(identity_association -> 'chain') = 'array', false)),

  drop constraint if exists chk_cgc_domain_association_reason,
  add constraint chk_cgc_domain_association_reason check (domain_association_reason is null
    or domain_association_reason in (
      'registry_record','official_filing_statement','first_party_statement',
      'first_party_ir_link','first_party_json_ld_sameAs','redirect_from_canonical')),

  -- The reason and its detail travel together.
  drop constraint if exists chk_cgc_domain_association_pair,
  add constraint chk_cgc_domain_association_pair check ((domain_association_reason is null) = (domain_association is null)),

  drop constraint if exists chk_cgc_domain_association_object,
  add constraint chk_cgc_domain_association_object check (domain_association is null
    or (jsonb_typeof(domain_association) = 'object' and domain_association ? 'domain' and domain_association ? 'source'));

-- Re-declared (from 20260913) to add the document's declared registry identity
-- to the immutable set. The association / attribution DECISIONS are not included.
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
     or (old.legal_entity_name is not null and new.legal_entity_name is distinct from old.legal_entity_name) then
    raise exception 'company_grounding_claims extraction provenance is immutable';
  end if;
  return new;
end $$;

create index if not exists idx_cgc_registry_id
  on public.company_grounding_claims (company_id, registry_id) where registry_id is not null;

comment on column public.company_grounding_claims.source_kind is
  'CPG-010: corporate_registry | regulatory_filing | company_owned | financial_database | news_media | knowledge_graph | other. A description of the document, NOT its authority (see field_authority).';
comment on column public.company_grounding_claims.registry_id is
  'CPG-010: the registry identifier the DOCUMENT declares, normalised (CIK:0001477333). Immutable once written.';
comment on column public.company_grounding_claims.identity_association is
  'CPG-010: how the declared registry identity was tied to the company — establishedBy, registryVerified, chain of source URLs. Re-evaluated on re-observation.';
comment on column public.company_grounding_claims.domain_association_reason is
  'CPG-010: the explicit association (registry record, official filing, first-party IR link …) the claim''s host or entity rests on. Never a hosting platform.';
