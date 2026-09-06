-- A4Q — three-valued provider-call state (B3).
--
-- WHAT THE BOOLEAN CANNOT SAY. `provider_called boolean NOT NULL DEFAULT false`
-- has two values for a question with three answers. A4E made it truthful
-- whenever the process SURVIVES: the recorder observes entry into `enrich()`
-- and writes the answer on completion. But nothing runs after a process dies,
-- so a worker killed between transport and completion leaves the row holding
-- its insert-time `false` — asserting that no call was made when the tenant's
-- provider was contacted and their quota spent.
--
-- A4N made that row recoverable, which turned the ambiguity from a curiosity
-- into a hazard: a reclaimer inherits the abandoned attempt and, reading
-- `provider_called = false`, would conclude it is safe to call again.
--
-- WHY A THIRD VALUE AND NOT A CLEVERER INFERENCE. The state must reflect what
-- the system can PROVE, and after a process death there is nothing left to
-- infer from. `outcome` is null for both "never asked" and "died mid-call".
-- `completed_at` is null for both "in flight" and "abandoned". The existence of
-- the row proves only that an attempt began. Every available signal is silent
-- on the one question that matters, so the honest answer is a value that says
-- so — and `unknown` must never be collapsed into `not_called`.
--
-- HOW `unknown` COMES TO BE WRITTEN. Not by guessing after the fact, which is
-- impossible, but by recording the intent to call BEFORE calling. The recorder
-- persists `unknown` immediately before entering transport and overwrites it
-- with the proven answer on completion. So:
--
--   not_called  the attempt was opened and transport was never entered —
--               provable, because the marker was never written
--   unknown     transport was about to be entered; the process did not survive
--               to say what happened
--   called      transport was definitely entered; the executor said so
--
-- A row still holding `unknown` is therefore exactly a process that died around
-- the call, which is the state B3 exists to name.
--
-- WHY `provider_called` STAYS. It is load-bearing in the A3/A4A/A4E/A4J/A4N
-- contracts and in 53 assertions across 11 suites, and its meaning is unchanged
-- and still correct: "we can prove a call happened". It answers a NARROWER
-- question than the new column and must not be read as its negation —
-- `provider_called = false` covers both `not_called` and `unknown`, and only
-- `provider_call_state` distinguishes them. Retry logic must read the STATE.
--
-- DELIBERATELY NOT HERE. No retry metadata, no execution-status taxonomy, no
-- attempt lineage, no rate-limit horizon, no scheduler. Those remain later work.
--
-- SAFE TO APPLY. One column with a default and a CHECK, on a table holding zero
-- rows. The default matches the boolean's own insert-time value, so nothing is
-- backfilled inconsistently and no existing constraint changes.

ALTER TABLE public.prospect_enrichment_attempts
  ADD COLUMN IF NOT EXISTS provider_call_state text NOT NULL DEFAULT 'not_called';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.prospect_enrichment_attempts'::regclass
       AND conname  = 'prospect_enrichment_attempts_call_state_valid'
  ) THEN
    ALTER TABLE public.prospect_enrichment_attempts
      ADD CONSTRAINT prospect_enrichment_attempts_call_state_valid
      CHECK (provider_call_state IN ('not_called', 'called', 'unknown'));
  END IF;
END $$;

-- The read a reclaimer performs before deciding anything: "of the live attempts
-- I could take over, which ones cannot prove whether a provider was paid?".
-- Partial on the live predicate so it indexes in-flight work only.
CREATE INDEX IF NOT EXISTS idx_prospect_enrichment_attempts_call_state
  ON public.prospect_enrichment_attempts (organization_id, provider_call_state)
  WHERE completed_at IS NULL;

COMMENT ON COLUMN public.prospect_enrichment_attempts.provider_call_state IS
  'A4Q: three-valued provider-call state — not_called | called | unknown. '
  'Authoritative for retry safety. `unknown` means the process did not survive '
  'to say whether transport occurred and MUST NOT be treated as not_called.';
