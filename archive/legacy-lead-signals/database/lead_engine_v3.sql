-- Active Leads Engine v3: Lifecycle & Watchlist.
-- Run after lead_engine_v2.sql. Safe for existing data.

-- converted_at: when lead reached CONVERTED status
alter table lead_signals_v1 add column if not exists converted_at timestamptz;

-- Expand status constraint for full lifecycle funnel
alter table lead_signals_v1 drop constraint if exists lead_signals_v1_status_check;
alter table lead_signals_v1 add constraint lead_signals_v1_status_check check (
  status in (
    'ACTIVE',
    'WATCHLIST',
    'OUTREACH_PLANNED',
    'OUTREACH_SENT',
    'ENGAGED',
    'CONVERTED',
    'DISMISSED',
    'ARCHIVED'
  )
);
