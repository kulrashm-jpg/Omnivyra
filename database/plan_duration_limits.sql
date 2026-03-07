-- Campaign duration limits per plan (Starter=4, Growth=6, Pro=8, Enterprise=12 weeks).
-- Uses plan_limits.limit_value to store max_campaign_duration_weeks (4, 6, 8, 12).
-- Run after: plan_limits_feature_unification.sql

-- Upsert max_campaign_duration_weeks for each plan by plan_key
insert into plan_limits (plan_id, resource_key, limit_value, created_at)
select pp.id, 'max_campaign_duration_weeks', v.weeks, now()
from pricing_plans pp
cross join (
  values ('starter', 4), ('growth', 6), ('pro', 8), ('enterprise', 12)
) as v(plan_key, weeks)
where pp.plan_key = v.plan_key
  and pp.is_active = true
on conflict (plan_id, resource_key) do update
  set limit_value = excluded.limit_value;
