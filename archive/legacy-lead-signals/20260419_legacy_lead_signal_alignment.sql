ALTER TABLE IF EXISTS lead_signals_v1
  ADD COLUMN IF NOT EXISTS signal_type TEXT DEFAULT 'EXPLICIT';

ALTER TABLE IF EXISTS lead_signals_v1
  ADD COLUMN IF NOT EXISTS trend_velocity NUMERIC DEFAULT 0;

ALTER TABLE IF EXISTS lead_signals_v1
  ADD COLUMN IF NOT EXISTS conversion_window_days INTEGER DEFAULT 0;

ALTER TABLE IF EXISTS lead_signals_v1
  ADD COLUMN IF NOT EXISTS dedupe_hash TEXT;

ALTER TABLE IF EXISTS lead_signals_v1
  ADD COLUMN IF NOT EXISTS post_created_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS lead_signals_v1
  ADD COLUMN IF NOT EXISTS problem_domain TEXT;

UPDATE lead_signals_v1
SET snippet = raw_text
WHERE snippet IS NULL;

UPDATE lead_signals_v1
SET source_url = CONCAT('legacy://lead-signal/', id::text)
WHERE source_url IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_signals_v1'
      AND column_name = 'posted_at'
  ) THEN
    EXECUTE $sql$
      UPDATE lead_signals_v1
      SET post_created_at = COALESCE(post_created_at, posted_at, created_at)
      WHERE post_created_at IS NULL
    $sql$;
  ELSE
    EXECUTE $sql$
      UPDATE lead_signals_v1
      SET post_created_at = COALESCE(post_created_at, created_at)
      WHERE post_created_at IS NULL
    $sql$;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS lead_signal_dedupe_idx
  ON lead_signals_v1 (dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;
