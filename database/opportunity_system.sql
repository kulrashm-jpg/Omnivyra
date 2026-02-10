-- 1) Core table for all opportunity tabs
create table if not exists public.opportunity_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  type text not null, -- TREND | LEAD | PULSE | SEASONAL | INFLUENCER | DAILY_FOCUS
  title text not null,
  summary text,
  problem_domain text,
  region_tags text[],
  source_refs jsonb,
  conversion_score integer,
  status text default 'NEW', -- NEW | REVIEWED | PROMOTED | SCHEDULED | ARCHIVED | DISMISSED
  slot_state text default 'ACTIVE', -- ACTIVE | CLOSED
  action_taken text, -- PROMOTED | SCHEDULED | ARCHIVED | DISMISSED
  scheduled_for timestamptz,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_opportunity_items_company_type_active
on public.opportunity_items(company_id, type, slot_state);

-- 2) Link opportunities to campaigns
create table if not exists public.opportunity_to_campaign (
  opportunity_id uuid references public.opportunity_items(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  promoted_at timestamptz default now(),
  promoted_by uuid,
  primary key (opportunity_id, campaign_id)
);

-- 3) Optional: trigger to maintain updated_at
create or replace function public.set_opportunity_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_opportunity_updated_at on public.opportunity_items;
create trigger trg_opportunity_updated_at
before update on public.opportunity_items
for each row execute function public.set_opportunity_updated_at();
