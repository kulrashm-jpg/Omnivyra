-- Design Attribution propagation — dedicated column on scheduled_posts.
--
-- Additive + idempotent. Holds the immutable Design Attribution (campaign_id /
-- campaign_design_system_id / collection_id / collection_version / template_id /
-- template_version) copied at the single creator scheduling seam, so the
-- Performance Intelligence reader consumes it directly (no transformation, no
-- collision with the variant subsystem's creator_attachment_metadata array).
--
-- NOTE: applied to prod via the controlled pooler DDL path, NOT db push.

alter table scheduled_posts add column if not exists design_attribution jsonb;
