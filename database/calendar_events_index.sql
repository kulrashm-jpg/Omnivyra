-- calendar_events_index: Denormalized index for fast calendar queries.
-- Populated by triggers and application hooks. Queried by /api/calendar/batch.
-- Improves performance by avoiding heavy joins on scheduled_posts + campaign_versions.

CREATE TABLE IF NOT EXISTS calendar_events_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('activity', 'message')),
  platform TEXT,
  title TEXT,
  repurpose_index INTEGER,
  repurpose_total INTEGER,
  scheduled_post_id UUID,
  activity_execution_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes for efficient calendar queries (Step 6)
CREATE INDEX IF NOT EXISTS idx_calendar_events_index_company_date
  ON calendar_events_index(company_id, event_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_index_campaign_date
  ON calendar_events_index(campaign_id, event_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_index_type_date
  ON calendar_events_index(event_type, event_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_index_scheduled_post
  ON calendar_events_index(scheduled_post_id) WHERE scheduled_post_id IS NOT NULL;

COMMENT ON TABLE calendar_events_index IS 'Denormalized calendar event index for batch API performance';

-- Trigger: Insert activity event when scheduled_posts row is created (Step 2)
CREATE OR REPLACE FUNCTION fn_calendar_events_index_on_scheduled_post_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_company_id UUID;
BEGIN
  IF NEW.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id INTO v_company_id
  FROM campaign_versions
  WHERE campaign_id = NEW.campaign_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_company_id IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO calendar_events_index (
    company_id,
    campaign_id,
    event_date,
    event_type,
    platform,
    title,
    repurpose_index,
    repurpose_total,
    scheduled_post_id,
    activity_execution_id
  ) VALUES (
    v_company_id,
    NEW.campaign_id,
    (NEW.scheduled_for AT TIME ZONE 'UTC')::date,
    'activity',
    NEW.platform,
    COALESCE(NEW.title, LEFT(NEW.content, 80)),
    COALESCE(NEW.repurpose_index, 1),
    COALESCE(NEW.repurpose_total, 1),
    NEW.id,
    NEW.repurpose_parent_execution_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_insert ON scheduled_posts;
CREATE TRIGGER trg_calendar_events_index_on_scheduled_post_insert
  AFTER INSERT ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_calendar_events_index_on_scheduled_post_insert();

-- Trigger: Update event_date when scheduled_posts.scheduled_for changes (Step 3)
CREATE OR REPLACE FUNCTION fn_calendar_events_index_on_scheduled_post_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for AND NEW.campaign_id IS NOT NULL THEN
    UPDATE calendar_events_index
    SET event_date = (NEW.scheduled_for AT TIME ZONE 'UTC')::date
    WHERE scheduled_post_id = NEW.id AND event_type = 'activity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_update ON scheduled_posts;
CREATE TRIGGER trg_calendar_events_index_on_scheduled_post_update
  AFTER UPDATE OF scheduled_for ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_calendar_events_index_on_scheduled_post_update();

-- Trigger: Delete from index when scheduled_posts row is deleted (Step 1 - sync enhancement)
CREATE OR REPLACE FUNCTION fn_calendar_events_index_on_scheduled_post_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM calendar_events_index
  WHERE scheduled_post_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_delete ON scheduled_posts;
CREATE TRIGGER trg_calendar_events_index_on_scheduled_post_delete
  AFTER DELETE ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_calendar_events_index_on_scheduled_post_delete();

-- Trigger: Update platform, title in index when scheduled_posts.platform or .title changes (Step 2 - sync enhancement)
CREATE OR REPLACE FUNCTION fn_calendar_events_index_on_scheduled_post_platform_title()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE calendar_events_index
  SET platform = NEW.platform,
      title = COALESCE(NEW.title, LEFT(NEW.content::text, 80))
  WHERE scheduled_post_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_platform_title ON scheduled_posts;
CREATE TRIGGER trg_calendar_events_index_on_scheduled_post_platform_title
  AFTER UPDATE OF platform, title ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_calendar_events_index_on_scheduled_post_platform_title();

-- Optional backfill: Run once after migration to populate index for existing scheduled_posts
-- INSERT INTO calendar_events_index (company_id, campaign_id, event_date, event_type, platform, title, repurpose_index, repurpose_total, scheduled_post_id, activity_execution_id)
-- SELECT cv.company_id, sp.campaign_id, (sp.scheduled_for AT TIME ZONE 'UTC')::date, 'activity', sp.platform,
--   COALESCE(sp.title, LEFT(sp.content, 80)), COALESCE(sp.repurpose_index, 1), COALESCE(sp.repurpose_total, 1),
--   sp.id, sp.repurpose_parent_execution_id
-- FROM scheduled_posts sp
-- JOIN campaign_versions cv ON cv.campaign_id = sp.campaign_id
-- WHERE sp.campaign_id IS NOT NULL AND sp.status IN ('scheduled', 'draft', 'publishing', 'published')
--   AND NOT EXISTS (SELECT 1 FROM calendar_events_index cei WHERE cei.scheduled_post_id = sp.id AND cei.event_type = 'activity');
