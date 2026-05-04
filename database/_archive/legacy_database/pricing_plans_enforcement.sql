-- Feature-flagged hard enforcement: plan-level switches.
-- No other schema changes.

alter table pricing_plans
  add column if not exists enforcement_enabled boolean default false;

alter table pricing_plans
  add column if not exists allow_overage boolean default false;

alter table pricing_plans
  add column if not exists grace_percent integer default 0;
