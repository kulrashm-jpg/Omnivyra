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
  v_company_id_text TEXT;
  v_company_id      UUID;
  v_new_json        JSONB;
  v_repurpose_index INTEGER;
  v_repurpose_total INTEGER;
  v_execution_id    TEXT;
BEGIN
  BEGIN  -- inner block: errors here produce a WARNING but never abort the INSERT

    IF NEW.campaign_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Cast both sides to TEXT so the comparison works regardless of whether
    -- campaign_versions.campaign_id is TEXT or UUID in the production schema.
    SELECT company_id::text INTO v_company_id_text
    FROM campaign_versions
    WHERE campaign_id::text = NEW.campaign_id::text
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_company_id_text IS NULL OR v_company_id_text = '' THEN
      RETURN NEW;
    END IF;

    -- Validate company_id is a valid UUID string before casting
    BEGIN
      v_company_id := v_company_id_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NEW;
    END;

    -- Safely read repurpose columns via JSONB so this function compiles and runs
    -- even when scheduled_posts_repurpose_lineage.sql hasn't been applied yet.
    v_new_json        := to_jsonb(NEW);
    v_repurpose_index := COALESCE((v_new_json->>'repurpose_index')::integer, 1);
    v_repurpose_total := COALESCE((v_new_json->>'repurpose_total')::integer, 1);
    v_execution_id    := v_new_json->>'repurpose_parent_execution_id';

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
      v_repurpose_index,
      v_repurpose_total,
      NEW.id,
      v_execution_id
    );

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[calendar_events_index trigger] non-fatal error on scheduled_post %: %', NEW.id, SQLERRM;
  END;

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
