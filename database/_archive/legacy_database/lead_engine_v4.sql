-- Active Leads Engine v4: Platform stats for conversion-rate learning.
-- Run after lead_engine_v3.sql.

create table if not exists lead_platform_stats_v1 (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  platform text not null,
  total_signals integer default 0,
  total_converted integer default 0,
  conversion_rate numeric default 0,
  last_updated timestamptz default now()
);

create unique index if not exists lead_platform_company_idx
  on lead_platform_stats_v1 (company_id, platform);

-- Atomic upsert: increment total_signals on insert
create or replace function lead_platform_increment_signals(p_company_id uuid, p_platform text)
returns void as $$
begin
  insert into lead_platform_stats_v1 (company_id, platform, total_signals)
  values (p_company_id, p_platform, 1)
  on conflict (company_id, platform) do update set
    total_signals = lead_platform_stats_v1.total_signals + 1,
    last_updated = now();
end;
$$ language plpgsql;

-- Update total_converted and conversion_rate when lead converts
create or replace function lead_platform_increment_converted(p_company_id uuid, p_platform text)
returns void as $$
begin
  insert into lead_platform_stats_v1 (company_id, platform, total_signals, total_converted, conversion_rate)
  values (p_company_id, p_platform, 1, 1, 1.0)
  on conflict (company_id, platform) do update set
    total_converted = lead_platform_stats_v1.total_converted + 1,
    conversion_rate = (lead_platform_stats_v1.total_converted + 1)::numeric / nullif(lead_platform_stats_v1.total_signals, 0),
    last_updated = now();
end;
$$ language plpgsql;
