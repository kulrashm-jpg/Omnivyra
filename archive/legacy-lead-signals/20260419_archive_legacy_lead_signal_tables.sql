CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS archive.lead_signals_v1 AS
SELECT *
FROM public.lead_signals_v1
WITH NO DATA;

INSERT INTO archive.lead_signals_v1
SELECT *
FROM public.lead_signals_v1
WHERE NOT EXISTS (
  SELECT 1
  FROM archive.lead_signals_v1 archived
  WHERE archived.id = public.lead_signals_v1.id
);

CREATE TABLE IF NOT EXISTS archive.engagement_lead_signals AS
SELECT *
FROM public.engagement_lead_signals
WITH NO DATA;

INSERT INTO archive.engagement_lead_signals
SELECT *
FROM public.engagement_lead_signals
WHERE NOT EXISTS (
  SELECT 1
  FROM archive.engagement_lead_signals archived
  WHERE archived.id = public.engagement_lead_signals.id
);
