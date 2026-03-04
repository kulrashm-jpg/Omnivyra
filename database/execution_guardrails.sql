-- Execution guardrails: company-scoped limits for auto and scheduler execution.
-- No foreign key. No migration of existing data. No seed.

create table if not exists execution_guardrails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique,
  auto_execution_enabled boolean not null default true,
  daily_platform_limit integer null,
  per_post_reply_limit integer null,
  per_evaluation_limit integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_execution_guardrails_company
  on execution_guardrails(company_id);

-- Extend community_ai_actions: allow status 'skipped_guardrail' (if status is text, no enum change).
-- Add skip_reason for guardrail block reason.
alter table community_ai_actions
  add column if not exists skip_reason text;

-- executed_at: single source of truth for when an action was executed (guardrail and audit).
alter table community_ai_actions
  add column if not exists executed_at timestamptz null;
