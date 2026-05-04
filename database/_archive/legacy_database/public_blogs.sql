-- Super Admin Blog / CMS – public_blogs table and RLS
-- Run in Supabase SQL Editor. Public read for published only; write via service role (API).

create table if not exists public_blogs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  excerpt text,
  content_markdown text not null,
  content_html text,
  featured_image_url text,
  category text,
  tags text[],
  media_blocks jsonb,
  seo_meta_title text,
  seo_meta_description text,
  status text check (status in ('draft','scheduled','published')) default 'draft',
  is_featured boolean default false,
  published_at timestamptz,
  views_count integer default 0,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_public_blogs_status on public_blogs(status);
create index if not exists idx_public_blogs_slug on public_blogs(slug);
create index if not exists idx_public_blogs_published_at on public_blogs(published_at desc nulls last);
create index if not exists idx_public_blogs_category on public_blogs(category);
create index if not exists idx_public_blogs_is_featured on public_blogs(is_featured) where is_featured = true;

-- Optional: trigger to keep updated_at in sync
create or replace function public_blogs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists public_blogs_updated_at_trigger on public_blogs;
create trigger public_blogs_updated_at_trigger
  before update on public_blogs
  for each row execute function public_blogs_updated_at();

-- RLS: public read only for published rows; writes via service role (bypass RLS)
alter table public_blogs enable row level security;

drop policy if exists "Public read published blogs" on public_blogs;
create policy "Public read published blogs"
  on public_blogs for select
  using (status = 'published');

-- No insert/update/delete policies for anon or authenticated; super admin writes go through API using service role.
