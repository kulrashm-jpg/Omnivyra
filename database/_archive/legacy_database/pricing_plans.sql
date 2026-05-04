-- Plan configuration layer: tier definitions, limits, org assignment, overrides.
-- Purely declarative. No enforcement. No coupling to meter/ledger/guardrails.

-- 1.1 Tier definitions
create table if not exists pricing_plans (
  id uuid primary key default gen_random_uuid(),

  plan_key text unique not null,
  name text not null,
  description text null,

  monthly_price numeric null,
  currency text default 'USD',

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.2 Resource ceilings per plan (one row per resource type per plan)
create table if not exists plan_limits (
  id uuid primary key default gen_random_uuid(),

  plan_id uuid not null,
  resource_key text not null,

  monthly_limit bigint null,

  created_at timestamptz not null default now(),

  unique(plan_id, resource_key)
);

-- 1.3 Organization → plan assignment
create table if not exists organization_plan_assignments (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null unique,
  plan_id uuid not null,

  assigned_at timestamptz not null default now(),
  assigned_by uuid null
);

create index if not exists idx_organization_plan_assignments_org
  on organization_plan_assignments(organization_id);

-- 1.4 Optional per-organization overrides
create table if not exists organization_plan_overrides (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null,
  resource_key text not null,

  monthly_limit bigint null,

  unique(organization_id, resource_key)
);

create index if not exists idx_organization_plan_overrides_org
  on organization_plan_overrides(organization_id);
