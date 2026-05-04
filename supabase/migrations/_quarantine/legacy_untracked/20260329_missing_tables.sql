-- ─────────────────────────────────────────────────────────────────────────────
-- Missing tables required by cron jobs and background workers
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. governance_audit_runs
-- Stores results of governance policy audit runs per company
create table if not exists public.governance_audit_runs (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  campaigns_scanned           integer not null default 0,
  drifted_campaigns           integer not null default 0,
  policy_upgrade_campaigns    integer not null default 0,
  average_replay_coverage     numeric(5,2) not null default 0,
  integrity_risk_score        numeric(5,2) not null default 0,
  audit_status                text not null default 'ok',
  created_at                  timestamptz not null default now()
);

create index if not exists idx_governance_audit_runs_company
  on public.governance_audit_runs (company_id, created_at desc);

-- 2. lead_thread_recompute_queue
-- Queue for background recomputation of lead thread scores
create table if not exists public.lead_thread_recompute_queue (
  thread_id        text not null,
  organization_id  uuid not null,
  retry_count      integer not null default 0,
  claimed_at       timestamptz,
  enqueued_at      timestamptz not null default now(),
  primary key (thread_id, organization_id)
);

create index if not exists idx_lead_thread_recompute_claimed
  on public.lead_thread_recompute_queue (claimed_at nulls first, enqueued_at);

-- Helper functions used by leadThreadRecomputeWorker
create or replace function public.get_lead_recompute_queue_approx_count()
returns bigint
language sql stable as $$
  select count(*) from public.lead_thread_recompute_queue where claimed_at is null;
$$;

create or replace function public.claim_lead_thread_recompute_batch(p_limit integer)
returns table(thread_id text, organization_id uuid, retry_count integer)
language plpgsql as $$
begin
  return query
    update public.lead_thread_recompute_queue q
    set claimed_at = now()
    where (q.thread_id, q.organization_id) in (
      select lq.thread_id, lq.organization_id
      from public.lead_thread_recompute_queue lq
      where lq.claimed_at is null
        or lq.claimed_at < now() - interval '5 minutes'
      order by lq.enqueued_at
      limit p_limit
      for update skip locked
    )
    returning q.thread_id, q.organization_id, q.retry_count;
end;
$$;

create or replace function public.cleanup_lead_thread_recompute_queue_orphans()
returns integer
language sql as $$
  with deleted as (
    delete from public.lead_thread_recompute_queue q
    where not exists (
      select 1 from public.engagement_threads t
      where t.id::text = q.thread_id
    )
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- 3. Fix external_api_health unique constraint
-- The table may exist but be missing the unique constraint on api_source_id
-- that the ON CONFLICT clause requires
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name   = 'external_api_health'
      and constraint_type = 'UNIQUE'
  ) then
    -- Create the table if it doesn't exist, otherwise add the constraint
    create table if not exists public.external_api_health (
      id                    uuid primary key default gen_random_uuid(),
      api_source_id         text not null,
      last_success_at       timestamptz,
      last_failure_at       timestamptz,
      success_count         integer not null default 0,
      failure_count         integer not null default 0,
      freshness_score       numeric(5,2) not null default 0,
      reliability_score     numeric(5,2) not null default 0,
      health_score          numeric(5,2),
      avg_latency_ms        numeric(10,2),
      last_test_status      text,
      last_test_at          timestamptz,
      last_test_latency_ms  integer,
      updated_at            timestamptz not null default now()
    );
  end if;
end $$;

-- Add the unique constraint if missing (idempotent)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
    where tc.table_schema = 'public'
      and tc.table_name   = 'external_api_health'
      and tc.constraint_type = 'UNIQUE'
      and ccu.column_name = 'api_source_id'
  ) then
    alter table public.external_api_health
      add constraint external_api_health_api_source_id_key unique (api_source_id);
  end if;
end $$;

create index if not exists idx_external_api_health_source
  on public.external_api_health (api_source_id);
