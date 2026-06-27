-- Campaign Design Systems — a Campaign adopts ONE Template Collection.
--
-- Version-aware: stores the pinned collection version AND a frozen snapshot
-- (design_system_json) so the campaign's visual system never shifts when the
-- collection evolves. Upgrading re-pins to the latest version. References a
-- collection by id — never duplicates the template/collection model.
--
-- NOTE: created as a migration file only. Apply via the controlled deploy/DDL
-- path — do NOT bulk db:push (prod ledger is managed surgically).

create table if not exists campaign_design_systems (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  campaign_id         uuid not null,
  collection_id       uuid not null,
  pinned_version      integer not null default 1,
  status              text not null default 'active' check (status in ('active','detached')),
  required_families   jsonb not null default '[]'::jsonb,
  design_system_json  jsonb not null,
  attached_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (campaign_id)
);
create index if not exists idx_cds_company  on campaign_design_systems(company_id);
create index if not exists idx_cds_campaign on campaign_design_systems(campaign_id);
create index if not exists idx_cds_collection on campaign_design_systems(collection_id);

alter table campaign_design_systems enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'campaign_design_systems' and policyname = 'cds_company_rw') then
    create policy cds_company_rw on campaign_design_systems using (true) with check (true);
  end if;
end $$;
