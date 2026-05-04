-- Fix calendar_events_index trigger to resolve "operator does not exist: text = uuid"
--
-- Root cause: The trigger's WHERE clause compares campaign_versions.campaign_id (TEXT)
-- with NEW.campaign_id (UUID) which can produce type-operator errors if the production
-- DB schema differs from migrations. The fix:
--  1. Cast both sides of the WHERE comparison to TEXT explicitly
--  2. Keep v_company_id as TEXT until it is validated, cast to UUID only when safe
--  3. Use to_jsonb(NEW) to safely read repurpose_* columns that may not exist yet
--     (if scheduled_posts_repurpose_lineage.sql hasn't been applied in production)
--  4. Wrap entire body in EXCEPTION WHEN OTHERS so a trigger error never blocks
--     the parent scheduled_posts INSERT (the index is denormalized and rebuildable)

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
      RETURN NEW;  -- company_id stored as non-UUID text — skip index entry
    END;

    -- Safely read repurpose columns via JSONB so this function compiles and runs
    -- even when scheduled_posts_repurpose_lineage.sql hasn't been applied yet.
    -- to_jsonb(NEW) returns NULL for keys that don't exist in the row type.
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
    -- Log but never block the parent INSERT — the index is rebuildable
    RAISE WARNING '[calendar_events_index trigger] non-fatal error on scheduled_post %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS trg_calendar_events_index_on_scheduled_post_insert ON scheduled_posts;
CREATE TRIGGER trg_calendar_events_index_on_scheduled_post_insert
  AFTER INSERT ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION fn_calendar_events_index_on_scheduled_post_insert();
