-- W0 — Engagement Threads schema reconciliation (ADDITIVE ONLY).
--
-- Restores the two columns production is missing while application code
-- already reads and writes them. This is a REMEDIATION of an existing
-- schema/code contract, not a new feature: nothing here changes behaviour
-- that was ever working, and no new capability is introduced.
--
-- ─── THE DEFECT ────────────────────────────────────────────────────────────
-- `database/whatsapp_system.sql` §2 declares four additive columns on
-- engagement_threads:
--     social_account_id, raw_payload, window_expires_at, window_open
-- That file lives OUTSIDE supabase/migrations/ and was only PARTIALLY applied
-- to production: social_account_id and raw_payload landed; the two window
-- columns did not. Verified 2026-08-12 against the production pooler —
-- information_schema reports the first two present and the latter two absent.
--
-- The consequence is not latent. Three code paths reference the missing
-- columns today:
--   pages/api/engagement/threads.ts:60      SELECTs both  → 42703 for EVERY
--                                            tenant, on a route that is not
--                                            WhatsApp-specific
--   backend/queue/jobProcessors/whatsappWebhookProcessor.ts:109-110
--                                            UPSERTs both → WhatsApp inbound
--                                            can never persist a thread
--   pages/whatsapp/inbox.tsx:31-32,167-168   consumes both for the 24h
--                                            messaging-window UI
--
-- ─── WHY THE DEFINITION IS COPIED, NOT DESIGNED ────────────────────────────
-- The column types, the default, the nullability and the index below are
-- reproduced verbatim from database/whatsapp_system.sql:29-36 — the canonical
-- declaration the application was written against. Nothing here is invented.
-- Choosing a "better" shape would substitute a new contract for the one the
-- running code already expects, which is how a reconciliation becomes a
-- second defect.
--
-- ─── EXISTING ROWS ─────────────────────────────────────────────────────────
-- production holds 126 engagement_threads rows at the time of authoring.
-- ADD COLUMN with a non-volatile DEFAULT does not rewrite them: window_open
-- reads as FALSE for every pre-existing row, window_expires_at as NULL.
--
-- That is the correct historical answer, and it is deliberately NOT a
-- backfill. window_open=TRUE means "a WhatsApp 24-hour customer-service
-- window is currently open", a claim that can only be established by an
-- inbound message this platform has never received (0 WhatsApp threads, 0
-- WhatsApp messages in production). Backfilling either column would fabricate
-- a compliance-relevant state — asserting a reply window that Meta's policy
-- says does not exist. FALSE/NULL is the only truthful default.
--
-- ─── SCOPE ─────────────────────────────────────────────────────────────────
-- Adds two columns and one index. Alters no existing column, drops nothing,
-- renames nothing, touches no other table, and writes no row. Idempotent:
-- safe to re-apply.
--
-- Rollback: supabase/migrations/rollbacks/engagement_threads_window_columns_rollback.sql

ALTER TABLE public.engagement_threads
  ADD COLUMN IF NOT EXISTS window_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS window_open        BOOLEAN     DEFAULT FALSE;

-- Verbatim from database/whatsapp_system.sql:34-36. Partial index: only rows
-- with an OPEN window are candidates for expiry sweeps, so the predicate keeps
-- the index proportional to open conversations rather than to all history.
CREATE INDEX IF NOT EXISTS idx_eng_threads_window
  ON public.engagement_threads (window_expires_at)
  WHERE window_open = TRUE;

COMMENT ON COLUMN public.engagement_threads.window_open IS
  'WhatsApp 24h customer-service window state. FALSE (the default) means no open window. Set TRUE only by an observed inbound message — never backfilled.';

COMMENT ON COLUMN public.engagement_threads.window_expires_at IS
  'Instant the WhatsApp 24h customer-service window closes. NULL when no window has ever opened. Derived from an observed inbound message; never inferred.';
