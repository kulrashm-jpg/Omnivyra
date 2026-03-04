-- Usage events: append-only financial telemetry ledger.
-- LLM usage, external API usage, automation execution.
-- No updates allowed to this table anywhere in code.

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  campaign_id uuid null,
  user_id uuid null,

  source_type text not null,
  -- 'llm' | 'external_api' | 'automation_execution'

  provider_name text null,
  model_name text null,
  model_version text null,

  source_name text not null,
  -- canonical identifier (e.g. openai:gpt-4o-mini)

  process_type text not null,

  input_tokens integer null,
  output_tokens integer null,
  total_tokens integer null,

  latency_ms integer null,
  error_flag boolean not null default false,
  error_type text null,

  unit_cost numeric null,
  total_cost numeric null,

  pricing_snapshot jsonb null,

  metadata jsonb null,

  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_org
  on usage_events(organization_id, created_at);

create index if not exists idx_usage_events_campaign
  on usage_events(campaign_id, created_at);

create index if not exists idx_usage_events_source
  on usage_events(source_type, source_name);

create index if not exists idx_usage_events_provider_model
  on usage_events(provider_name, model_name);
