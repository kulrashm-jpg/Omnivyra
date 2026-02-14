-- Non-campaign artifacts: outreach plans and collaboration plans.
-- These do NOT trigger campaign lifecycle.

create table if not exists public.outreach_plans (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunity_items(id) on delete cascade,
  notes text,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists idx_outreach_plans_opportunity_id
on public.outreach_plans(opportunity_id);

create table if not exists public.collaboration_plans (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunity_items(id) on delete cascade,
  strategy text,
  created_by uuid,
  created_at timestamptz default now()
);

create index if not exists idx_collaboration_plans_opportunity_id
on public.collaboration_plans(opportunity_id);
