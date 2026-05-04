-- Org-scoped read access for usage reporting (granted by Super Admin).
-- Non-super users with access see operational metrics only (cost masked).

create table if not exists usage_report_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  granted_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists idx_usage_report_access_org
  on usage_report_access(organization_id);

create index if not exists idx_usage_report_access_user
  on usage_report_access(user_id);
