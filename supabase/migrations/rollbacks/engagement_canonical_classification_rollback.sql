-- Rollback of 20270125000000_engagement_canonical_classification.sql.
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. Dropping the columns deletes every canonical classification stored
-- in them; the legacy columns are untouched. Roll the classifier's writer back first:
-- once it writes these columns, its inserts fail without them. One transaction.

BEGIN;

ALTER TABLE public.engagement_thread_classification
  DROP CONSTRAINT IF EXISTS engagement_thread_classification_canonical_code_valid,
  DROP CONSTRAINT IF EXISTS engagement_thread_classification_governance_codes_valid,
  DROP CONSTRAINT IF EXISTS engagement_thread_classification_vocabulary_version_required,
  DROP COLUMN IF EXISTS canonical_code,
  DROP COLUMN IF EXISTS governance_codes,
  DROP COLUMN IF EXISTS classification_vocabulary_version;

ALTER TABLE public.engagement_message_intelligence
  DROP CONSTRAINT IF EXISTS engagement_message_intelligence_canonical_code_valid,
  DROP CONSTRAINT IF EXISTS engagement_message_intelligence_governance_codes_valid,
  DROP CONSTRAINT IF EXISTS engagement_message_intelligence_vocabulary_version_required,
  DROP COLUMN IF EXISTS canonical_code,
  DROP COLUMN IF EXISTS governance_codes,
  DROP COLUMN IF EXISTS classification_vocabulary_version;

COMMIT;
