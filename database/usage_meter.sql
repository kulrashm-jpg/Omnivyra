-- Monthly usage meter: real-time atomic counters. No billing, no enforcement.
-- Incremented when LLM/external_api/automation_execution is logged; never scans usage_events.

create table if not exists usage_meter_monthly (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  year integer not null,
  month integer not null,

  llm_input_tokens bigint not null default 0,
  llm_output_tokens bigint not null default 0,
  llm_total_tokens bigint not null default 0,

  external_api_calls bigint not null default 0,
  automation_executions bigint not null default 0,

  total_cost numeric not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, year, month)
);

create index if not exists idx_usage_meter_org
  on usage_meter_monthly(organization_id, year, month);

-- Atomic increment: single RPC to avoid read-modify-write in JS.
create or replace function increment_usage_meter(
  p_organization_id uuid,
  p_year integer,
  p_month integer,
  p_llm_input_tokens bigint default 0,
  p_llm_output_tokens bigint default 0,
  p_llm_total_tokens bigint default 0,
  p_external_api_calls bigint default 0,
  p_automation_executions bigint default 0,
  p_total_cost numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into usage_meter_monthly (
    organization_id, year, month,
    llm_input_tokens, llm_output_tokens, llm_total_tokens,
    external_api_calls, automation_executions, total_cost,
    created_at, updated_at
  )
  values (
    p_organization_id, p_year, p_month,
    coalesce(p_llm_input_tokens, 0), coalesce(p_llm_output_tokens, 0), coalesce(p_llm_total_tokens, 0),
    coalesce(p_external_api_calls, 0), coalesce(p_automation_executions, 0), coalesce(p_total_cost, 0),
    now(), now()
  )
  on conflict (organization_id, year, month)
  do update set
    llm_input_tokens = usage_meter_monthly.llm_input_tokens + coalesce(EXCLUDED.llm_input_tokens, 0),
    llm_output_tokens = usage_meter_monthly.llm_output_tokens + coalesce(EXCLUDED.llm_output_tokens, 0),
    llm_total_tokens = usage_meter_monthly.llm_total_tokens + coalesce(EXCLUDED.llm_total_tokens, 0),
    external_api_calls = usage_meter_monthly.external_api_calls + coalesce(EXCLUDED.external_api_calls, 0),
    automation_executions = usage_meter_monthly.automation_executions + coalesce(EXCLUDED.automation_executions, 0),
    total_cost = usage_meter_monthly.total_cost + coalesce(EXCLUDED.total_cost, 0),
    updated_at = now();
end;
$$;
