-- Engagement sync integrity metadata for extension-driven ingestion.
-- Adds platform-level parent/thread IDs and timestamp provenance without
-- changing execution or AI tables.

alter table if exists engagement_messages
  add column if not exists sync_thread_id text,
  add column if not exists platform_parent_id text,
  add column if not exists raw_time text,
  add column if not exists normalized_time timestamptz,
  add column if not exists scraped_at timestamptz,
  add column if not exists sync_source text,
  add column if not exists actor_type text,
  add column if not exists actor_external_id text;

create unique index if not exists idx_engagement_messages_platform_message_global
  on engagement_messages (platform, platform_message_id)
  where platform_message_id is not null;

create index if not exists idx_engagement_messages_sync_thread
  on engagement_messages (platform, sync_thread_id)
  where sync_thread_id is not null;

create index if not exists idx_engagement_messages_platform_parent
  on engagement_messages (platform, platform_parent_id)
  where platform_parent_id is not null;

alter table if exists engagement_messages
  drop constraint if exists engagement_messages_sync_source_check;

alter table if exists engagement_messages
  add constraint engagement_messages_sync_source_check
  check (sync_source is null or sync_source in ('omniverva', 'platform_sync'));

alter table if exists engagement_messages
  drop constraint if exists engagement_messages_actor_type_check;

alter table if exists engagement_messages
  add constraint engagement_messages_actor_type_check
  check (actor_type is null or actor_type in ('user', 'company'));
