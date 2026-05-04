-- Campaign Plan Jobs — status tracking for async v2 pipeline
-- Run once in Supabase SQL editor

create table if not exists campaign_plan_jobs (
  id            text primary key,          -- stable job ID (SHA-256 of inputs)
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  status        text not null default 'pending',  -- pending|processing|layer1|layer2|layer3|layer4|complete|failed
  partial_result jsonb,                    -- partial output or error info
  updated_at    timestamptz not null default now()
);

-- Index for fast poll lookups
create index if not exists campaign_plan_jobs_campaign_idx on campaign_plan_jobs(campaign_id);
create index if not exists campaign_plan_jobs_status_idx   on campaign_plan_jobs(status);

-- Auto-update updated_at
create or replace function update_campaign_plan_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists campaign_plan_jobs_updated_at_trigger on campaign_plan_jobs;
create trigger campaign_plan_jobs_updated_at_trigger
  before update on campaign_plan_jobs
  for each row execute function update_campaign_plan_jobs_updated_at();

-- Row level security: users can only read jobs for their company's campaigns
alter table campaign_plan_jobs enable row level security;

create policy "users can read their campaign plan jobs"
  on campaign_plan_jobs for select
  using (
    campaign_id in (
      select c.id from campaigns c
      join user_company_roles ucr on ucr.organization_id = c.user_id
      where ucr.user_id = auth.uid()
    )
  );

-- Service role can do everything (used by API routes with adminSupabase)
create policy "service role full access"
  on campaign_plan_jobs for all
  using (auth.role() = 'service_role');
