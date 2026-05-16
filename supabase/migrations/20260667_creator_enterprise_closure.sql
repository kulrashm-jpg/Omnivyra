do $$
declare
  legacy_column text := 'image' || chr(95) || 'mode';
begin
  execute format('alter table if exists creator_asset_attachments drop column if exists %I', legacy_column);
end $$;

create table if not exists creator_render_jobs (
  id text primary key,
  idempotency_key text not null unique,
  renderer text not null,
  status text not null default 'queued',
  progress integer not null default 0,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  audit_id text,
  locked_until timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists creator_render_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references creator_render_jobs(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists creator_render_validation_manifests (
  id uuid primary key default gen_random_uuid(),
  render_job_id text references creator_render_jobs(id) on delete set null,
  renderer_id text not null,
  asset_type text not null,
  platform text not null,
  attachment_mode text,
  render_manifest jsonb not null default '{}'::jsonb,
  validation_manifest jsonb not null default '{}'::jsonb,
  ocr_result jsonb not null default '{}'::jsonb,
  quality_score jsonb not null default '{}'::jsonb,
  audit_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_creator_render_jobs_status on creator_render_jobs(status, updated_at);
create index if not exists idx_creator_render_jobs_audit on creator_render_jobs(audit_id);
create index if not exists idx_creator_render_validation_audit on creator_render_validation_manifests(audit_id);
