alter table if exists public.scheduled_posts
  add column if not exists creator_attachment_metadata jsonb;

create index if not exists idx_scheduled_posts_creator_attachment_metadata
  on public.scheduled_posts using gin (creator_attachment_metadata);
