-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: queue claim/cleanup functions — 42P01 "relation does not exist".
--
-- claim_lead_thread_recompute_batch, claim_conversation_memory_rebuild_batch
-- and cleanup_lead_thread_recompute_queue_orphans were created with
--   SET search_path TO 'public, extensions'
-- where the entire value is quoted as ONE identifier, so the effective
-- search_path is a single non-existent schema literally named
-- `public, extensions`. Their bodies reference tables unqualified
-- (lead_thread_recompute_queue, conversation_memory_rebuild_queue,
-- engagement_threads, companies), which then cannot resolve → every call
-- raises 42P01 and the lead-thread / conversation-memory workers never drain.
--
-- Fix: re-set search_path with correct list syntax (`= public, extensions`,
-- a proper two-schema identifier list — matching the one correctly-formed
-- function in the schema). Configuration only — function bodies, signatures,
-- ownership and grants are untouched. Additive, non-destructive, reversible.
--
-- Scope: ONLY the three functions behind observed worker runtime errors.
-- ~34 other functions share the same malformed config but are not in scope
-- here (trigger functions / schema-qualified bodies that resolve regardless).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.claim_lead_thread_recompute_batch(integer)
  SET search_path = public, extensions;

ALTER FUNCTION public.claim_conversation_memory_rebuild_batch(integer)
  SET search_path = public, extensions;

ALTER FUNCTION public.cleanup_lead_thread_recompute_queue_orphans()
  SET search_path = public, extensions;
