-- Active Leads Engine v1: async multi-platform social listening.
-- Does NOT modify Trend engine, recommendation_jobs_v2, or opportunity tables.

create table if not exists lead_jobs_v1 (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  platforms text[] not null,
  regions text[] not null,
  keywords text[] null,
  status text not null check (status in ('PENDING','RUNNING','COMPLETED','COMPLETED_WITH_WARNINGS','FAILED')),
  total_found integer default 0,
  total_qualified integer default 0,
  error text null,
  confidence_index integer default 0,
  created_at timestamptz default now(),
  completed_at timestamptz null
);

create index if not exists idx_lead_jobs_company on lead_jobs_v1(company_id);

create table if not exists lead_signals_v1 (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references lead_jobs_v1(id) on delete cascade,
  company_id uuid not null,
  platform text not null,
  region text null,
  raw_text text not null,
  snippet text not null,
  source_url text not null,
  author_handle text null,
  language text null,
  content_hash text null,
  posted_at timestamptz null,
  icp_score numeric default 0,
  urgency_score numeric default 0,
  intent_score numeric default 0,
  total_score numeric default 0,
  engagement_potential numeric default 0,
  risk_flag boolean default false,
  status text default 'ACTIVE',
  created_at timestamptz default now()
);

create index if not exists idx_lead_signals_company on lead_signals_v1(company_id);
create index if not exists idx_lead_signals_job on lead_signals_v1(job_id);
create unique index if not exists idx_lead_signals_company_content_hash
  on lead_signals_v1(company_id, content_hash) where content_hash is not null;

-- Outreach plans for qualified leads (LLM-generated).
create table if not exists lead_outreach_plans (
  id uuid primary key default gen_random_uuid(),
  lead_signal_id uuid not null references lead_signals_v1(id) on delete cascade,
  opening_line text null,
  engagement_strategy text null,
  call_to_action text null,
  follow_up_sequence text null,
  risk_notes text null,
  created_at timestamptz default now()
);

create index if not exists idx_lead_outreach_plans_signal on lead_outreach_plans(lead_signal_id);
