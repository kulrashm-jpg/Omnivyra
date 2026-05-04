BEGIN;

ALTER TABLE public.canonical_sessions
  ADD COLUMN IF NOT EXISTS external_session_id TEXT;

UPDATE public.canonical_sessions
SET external_session_id = external_session_key
WHERE external_session_id IS NULL
  AND external_session_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canonical_sessions_company_external_id_unique'
  ) THEN
    ALTER TABLE public.canonical_sessions
      ADD CONSTRAINT canonical_sessions_company_external_id_unique
      UNIQUE (company_id, external_session_id);
  END IF;
END
$$;

ALTER TABLE public.canonical_page_views
  ADD COLUMN IF NOT EXISTS page_url TEXT;

UPDATE public.canonical_page_views AS pv
SET page_url = cp.url
FROM public.canonical_pages AS cp
WHERE pv.page_id = cp.id
  AND pv.company_id = cp.company_id
  AND pv.page_url IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_page_views_company_page_url_viewed_session
  ON public.canonical_page_views(company_id, page_url, viewed_at, session_id)
  WHERE page_url IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canonical_events_company_session_external_fk'
  ) THEN
    ALTER TABLE public.canonical_events
      ADD CONSTRAINT canonical_events_company_session_external_fk
      FOREIGN KEY (company_id, session_id)
      REFERENCES public.canonical_sessions(company_id, external_session_id)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'canonical_conversions_company_session_external_fk'
  ) THEN
    ALTER TABLE public.canonical_conversions
      ADD CONSTRAINT canonical_conversions_company_session_external_fk
      FOREIGN KEY (company_id, session_id)
      REFERENCES public.canonical_sessions(company_id, external_session_id)
      NOT VALID;
  END IF;
END
$$;

COMMIT;
