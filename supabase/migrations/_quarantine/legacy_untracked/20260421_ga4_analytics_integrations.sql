do $$
begin
  if not exists (select 1 from pg_type where typname = 'analytics_provider') then
    create type public.analytics_provider as enum ('GA4');
  end if;
  if not exists (select 1 from pg_type where typname = 'analytics_integration_status') then
    create type public.analytics_integration_status as enum ('connected', 'disconnected', 'error');
  end if;
end
$$;

create table if not exists public.analytics_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider public.analytics_provider not null,
  status public.analytics_integration_status not null default 'disconnected',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (company_id, provider)
);

create table if not exists public.analytics_properties (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.analytics_integrations(id) on delete cascade,
  property_id text not null,
  property_name text not null,
  account_id text,
  is_active boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (integration_id, property_id)
);

create table if not exists public.analytics_tokens (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.analytics_integrations(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expiry_date timestamptz,
  scope text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (integration_id)
);

create unique index if not exists analytics_properties_one_active_idx
  on public.analytics_properties (integration_id)
  where is_active = true;

create index if not exists analytics_integrations_company_provider_idx
  on public.analytics_integrations (company_id, provider);

create index if not exists analytics_properties_integration_idx
  on public.analytics_properties (integration_id, property_id);

create index if not exists analytics_tokens_integration_idx
  on public.analytics_tokens (integration_id);
