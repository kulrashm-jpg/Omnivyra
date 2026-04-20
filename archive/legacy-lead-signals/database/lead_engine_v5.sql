-- Active Leads Engine v5: Emerging Intent Clusters.
-- Run after lead_engine_v4.sql.

-- problem_domain from qualifier for clustering (read from signals)
alter table lead_signals_v1 add column if not exists problem_domain text;

create table if not exists lead_intent_clusters_v1 (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  problem_domain text not null,
  cluster_hash text not null,
  signal_count integer not null default 0,
  avg_icp_score numeric default 0,
  avg_urgency_score numeric default 0,
  avg_intent_score numeric default 0,
  avg_trend_velocity numeric default 0,
  regions text[] default '{}',
  platforms text[] default '{}',
  earliest_post_at timestamptz,
  latest_post_at timestamptz,
  priority_score numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists lead_clusters_company_idx
  on lead_intent_clusters_v1(company_id);

create unique index if not exists lead_clusters_hash_idx
  on lead_intent_clusters_v1(cluster_hash);
