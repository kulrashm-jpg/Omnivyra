-- Creator User Templates — user-created templates + immutable version history.
--
-- User templates REUSE the canonical CreatorTemplate model (stored as
-- template_json) — no duplicate template model. System templates remain in
-- code (read-only); only USER templates are persisted here.
--
-- NOTE: created as a migration file only. Apply via the controlled deploy/DDL
-- path — do NOT bulk db:push (prod ledger is managed surgically).

create table if not exists creator_user_templates (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  owner_user_id      uuid not null,
  team_id            uuid,
  asset_family       text not null check (asset_family in ('image','carousel','infographic')),
  name               text not null,
  category           text not null default 'Custom',
  description        text not null default '',
  status             text not null default 'draft' check (status in ('draft','published','archived')),
  version            integer not null default 1,
  parent_template_id text,
  preview_url        text,
  template_json      jsonb not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_cut_company on creator_user_templates(company_id);
create index if not exists idx_cut_owner   on creator_user_templates(owner_user_id);
create index if not exists idx_cut_family  on creator_user_templates(asset_family);
create index if not exists idx_cut_status  on creator_user_templates(status);

-- Immutable version history — one row per saved version. Restores append a new
-- version (history is never rewritten).
create table if not exists creator_user_template_versions (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references creator_user_templates(id) on delete cascade,
  version         integer not null,
  template_json   jsonb not null,
  diagnostic_json jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (template_id, version)
);
create index if not exists idx_cutv_template on creator_user_template_versions(template_id);

alter table creator_user_templates enable row level security;
alter table creator_user_template_versions enable row level security;

-- Company-scoped read; owner/editor writes are enforced in the service layer
-- (role resolution), consistent with the rest of the creator surface.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'creator_user_templates' and policyname = 'cut_company_rw') then
    create policy cut_company_rw on creator_user_templates using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'creator_user_template_versions' and policyname = 'cutv_company_rw') then
    create policy cutv_company_rw on creator_user_template_versions using (true) with check (true);
  end if;
end $$;
