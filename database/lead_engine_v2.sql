-- Active Leads Engine v2: Reactive + Predictive modes, signal_type, dedupe_hash, confidence.
-- Run after lead_engine_v1.sql. Safe for existing data.

-- lead_jobs_v1: listening mode
alter table lead_jobs_v1 add column if not exists mode text default 'REACTIVE';
alter table lead_jobs_v1 drop constraint if exists lead_jobs_v1_mode_check;
alter table lead_jobs_v1 add constraint lead_jobs_v1_mode_check
  check (mode is null or mode in ('REACTIVE','PREDICTIVE'));

-- lead_jobs_v1: confidence_index (may already exist from v1 dedup migration)
alter table lead_jobs_v1 add column if not exists confidence_index integer default 0;

-- lead_jobs_v1: platform_errors (fail-soft: JSON array of { platform, error })
alter table lead_jobs_v1 add column if not exists platform_errors jsonb default null;

-- lead_signals_v1: signal type (EXPLICIT = reactive, LATENT = predictive)
alter table lead_signals_v1 add column if not exists signal_type text default 'EXPLICIT';
alter table lead_signals_v1 drop constraint if exists lead_signals_v1_signal_type_check;
alter table lead_signals_v1 add constraint lead_signals_v1_signal_type_check
  check (signal_type is null or signal_type in ('EXPLICIT','LATENT'));

alter table lead_signals_v1 add column if not exists trend_velocity numeric default 0;
alter table lead_signals_v1 add column if not exists conversion_window_days integer default 0;
alter table lead_signals_v1 add column if not exists dedupe_hash text;
alter table lead_signals_v1 add column if not exists post_created_at timestamptz;

-- One row per dedupe_hash globally (conflict = skip insert)
create unique index if not exists lead_signal_dedupe_idx
  on lead_signals_v1 (dedupe_hash) where dedupe_hash is not null;
