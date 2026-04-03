-- reports table
-- Stores generated content/SEO reports per company/domain
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies(id) on delete cascade,
  user_id          uuid references public.users(id) on delete set null,
  domain           text,
  is_free          boolean not null default true,
  report_type      text not null default 'content_readiness',
  status           text not null default 'generating' check (status in ('generating','completed','failed')),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  error_message    text,
  data             jsonb,
  metadata         jsonb
);

create index if not exists idx_reports_company on public.reports (company_id, created_at desc);
create index if not exists idx_reports_domain  on public.reports (domain, created_at desc);
