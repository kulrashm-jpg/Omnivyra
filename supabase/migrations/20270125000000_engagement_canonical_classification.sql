-- Engagement Intelligence (closure B, SC-7): where a message's CANONICAL classification
-- is stored, beside the legacy one rather than in it.
--
-- NOT APPLIED ANYWHERE. Written for, and tested only on, a disposable test database.
-- Applying it to any real environment needs a separate owner decision.
--
-- WHY NEW COLUMNS. `engagement_thread_classification.classification_category` and
-- `engagement_message_intelligence.intent` are unconstrained TEXT, so canonical codes
-- could be written there without a schema change, but must not be: the engagement UI,
-- the inbox, priority and digest services read the six legacy categories, and
-- `response_rules.intent_type` keys on the legacy intents
-- (docs/outreach/platform/SC-7-CLASSIFICATION-VOCABULARY.md §7).
--
-- On both tables:
--   canonical_code  nullable. One of the 16 codes of vocabulary `sc7-draft-1`
--       (backend/services/engagementClassification/vocabulary.ts). The list is the DRAFT
--       sent to PI and Orchestration (CR-SC7); if the agreed vocabulary differs, amend
--       this file before it is applied anywhere.
--   governance_codes  NOT NULL DEFAULT '{}'. The deterministic governance classes the
--       message matched (stop, unsubscribe, complaint). A classification, not a
--       contact-governance restriction: those stay in contact_governance_records, whose
--       types are different (PI, CR-SC7 response).
--   classification_vocabulary_version  nullable; required whenever a canonical code or a
--       governance code is present, so every stored code names the vocabulary it was
--       decided under.
--
-- No existing row changes: the new columns are NULL / '{}' on every current row. The
-- legacy columns, their readers and the grants are untouched (adding a column does not
-- change table grants). No writer exists yet; the classifier writes these columns only
-- after this migration is applied and SC-7 is agreed.
--
-- Constraints are added NOT VALID and then validated, so the table is scanned under a
-- SHARE UPDATE EXCLUSIVE lock rather than ACCESS EXCLUSIVE.
--
-- Rollback: supabase/migrations/rollbacks/engagement_canonical_classification_rollback.sql

ALTER TABLE public.engagement_thread_classification
  ADD COLUMN IF NOT EXISTS canonical_code text,
  ADD COLUMN IF NOT EXISTS governance_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classification_vocabulary_version text;

ALTER TABLE public.engagement_message_intelligence
  ADD COLUMN IF NOT EXISTS canonical_code text,
  ADD COLUMN IF NOT EXISTS governance_codes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classification_vocabulary_version text;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['engagement_thread_classification', 'engagement_message_intelligence'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = format('public.%I', t)::regclass
                      AND conname = t || '_canonical_code_valid') THEN
      EXECUTE format($f$
        ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (canonical_code IS NULL OR canonical_code IN (
          'positive_interest', 'enquiry', 'information_request', 'pricing', 'meeting_request', 'objection',
          'not_interested', 'follow_up', 'complaint', 'support_request', 'unsubscribe', 'stop',
          'wrong_recipient', 'out_of_office', 'spam_suspicious', 'ambiguous')) NOT VALID
      $f$, t, t || '_canonical_code_valid');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = format('public.%I', t)::regclass
                      AND conname = t || '_governance_codes_valid') THEN
      EXECUTE format($f$
        ALTER TABLE public.%I ADD CONSTRAINT %I
          CHECK (governance_codes <@ ARRAY['stop', 'unsubscribe', 'complaint']::text[]) NOT VALID
      $f$, t, t || '_governance_codes_valid');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = format('public.%I', t)::regclass
                      AND conname = t || '_vocabulary_version_required') THEN
      EXECUTE format($f$
        ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
          (canonical_code IS NULL AND cardinality(governance_codes) = 0)
          OR length(btrim(coalesce(classification_vocabulary_version, ''))) > 0) NOT VALID
      $f$, t, t || '_vocabulary_version_required');
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_canonical_code_valid');
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_governance_codes_valid');
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, t || '_vocabulary_version_required');
  END LOOP;
END
$$;
