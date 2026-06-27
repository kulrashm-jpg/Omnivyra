-- Creator Template Collections (Design Systems) — groups of existing templates.
--
-- A Collection REFERENCES existing Creator Templates (system or user) by id —
-- it never duplicates the template model. Stored as collection_json (the
-- canonical TemplateCollection) plus surfaced columns for querying.
--
-- NOTE: created as a migration file only. Apply via the controlled deploy/DDL
-- path — do NOT bulk db:push (prod ledger is managed surgically).

create table if not exists creator_template_collections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  owner_user_id   uuid not null,
  team_id         uuid,
  name            text not null,
  category        text not null default 'Custom',
  description     text not null default '',
  brand_style     text not null default 'corporate',
  status          text not null default 'draft' check (status in ('draft','published','archived')),
  version         integer not null default 1,
  cover_url       text,
  template_ids    jsonb not null default '[]'::jsonb,
  collection_json jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_ctc_company on creator_template_collections(company_id);
create index if not exists idx_ctc_owner   on creator_template_collections(owner_user_id);
create index if not exists idx_ctc_status  on creator_template_collections(status);

alter table creator_template_collections enable row level security;

-- Company-scoped; owner/editor writes enforced in the service layer (consistent
-- with the rest of the creator surface).
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'creator_template_collections' and policyname = 'ctc_company_rw') then
    create policy ctc_company_rw on creator_template_collections using (true) with check (true);
  end if;
end $$;
