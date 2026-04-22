BEGIN;

ALTER TABLE public.ingestion_runs
  ADD COLUMN IF NOT EXISTS events_processed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS events_inserted INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversions_inserted INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canonical_events_company_session_name_timestamp_unique'
  ) THEN
    ALTER TABLE public.canonical_events
      ADD CONSTRAINT canonical_events_company_session_name_timestamp_unique
      UNIQUE (company_id, session_id, event_name, event_timestamp);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canonical_conversions_company_session_name_timestamp_unique'
  ) THEN
    ALTER TABLE public.canonical_conversions
      ADD CONSTRAINT canonical_conversions_company_session_name_timestamp_unique
      UNIQUE (company_id, session_id, conversion_name, conversion_timestamp);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.omnivyra_upsert_behavioral_analytics(
  p_events JSONB DEFAULT '[]'::jsonb,
  p_conversions JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  inserted_events INTEGER := 0;
  inserted_conversions INTEGER := 0;
BEGIN
  INSERT INTO public.canonical_events (
    company_id,
    session_id,
    user_id,
    event_name,
    event_category,
    page_url,
    event_timestamp,
    source,
    metadata
  )
  SELECT
    (row_data->>'company_id')::uuid,
    row_data->>'session_id',
    row_data->>'user_id',
    row_data->>'event_name',
    row_data->>'event_category',
    NULLIF(row_data->>'page_url', ''),
    (row_data->>'event_timestamp')::timestamptz,
    (row_data->>'source')::public.canonical_event_source,
    COALESCE(row_data->'metadata', '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_events, '[]'::jsonb)) AS row_data
  ON CONFLICT ON CONSTRAINT canonical_events_company_session_name_timestamp_unique DO NOTHING;

  GET DIAGNOSTICS inserted_events = ROW_COUNT;

  INSERT INTO public.canonical_conversions (
    company_id,
    session_id,
    user_id,
    conversion_name,
    conversion_value,
    page_url,
    conversion_timestamp,
    source,
    metadata
  )
  SELECT
    (row_data->>'company_id')::uuid,
    row_data->>'session_id',
    row_data->>'user_id',
    row_data->>'conversion_name',
    NULLIF(row_data->>'conversion_value', '')::numeric,
    NULLIF(row_data->>'page_url', ''),
    (row_data->>'conversion_timestamp')::timestamptz,
    (row_data->>'source')::public.canonical_event_source,
    COALESCE(row_data->'metadata', '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_conversions, '[]'::jsonb)) AS row_data
  ON CONFLICT ON CONSTRAINT canonical_conversions_company_session_name_timestamp_unique DO NOTHING;

  GET DIAGNOSTICS inserted_conversions = ROW_COUNT;

  RETURN jsonb_build_object(
    'events_inserted', inserted_events,
    'conversions_inserted', inserted_conversions
  );
END;
$$;

COMMIT;
