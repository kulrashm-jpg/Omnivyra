-- A6A — preserve the provider's own retry horizon.
--
-- WHAT WAS BEING DESTROYED. The A6 audit found exactly one piece of information
-- the enrichment pipeline throws away rather than merely omits. A rate-limited
-- attempt records THAT it was limited — `outcome = 'rate_limited'` — and nothing
-- about when the limit lifts. The provider states that in a `Retry-After`
-- response header, and the header was read by nothing and dropped at the
-- adapter boundary.
--
-- Every other field a retry consumer needs turned out to be DERIVABLE from what
-- is already stored:
--
--   retry class / terminal   from `outcome` + `execution_status`
--   the attempt chain        from A4Y's work-item-scoped `attempt_number`,
--                            unique per (tenant, entity, provider, attributes)
--   max attempts             policy, not per-row state
--
-- This one is not derivable, because it never existed anywhere but in a header
-- on a response that has already been discarded. Reconstructing it later is
-- impossible; guessing it is how a tenant's provider account gets hammered.
--
-- ABSOLUTE, NOT RELATIVE. RFC 9110 allows `Retry-After` to be delta-seconds or
-- an HTTP-date. Delta-seconds is meaningless once stored — "120 seconds" from
-- WHEN? — so it is resolved against the moment of reading and persisted as an
-- instant. `timestamptz` matches `started_at`, `completed_at` and
-- `claimed_until` on this table.
--
-- NULLABLE, AND NULL MEANS "NO OPINION". Absent is the normal case: most
-- responses carry no horizon at all, and a malformed one is deliberately
-- treated as absent rather than repaired. NULL must never be read as "retry
-- now" — it means the provider said nothing usable, and the decision belongs to
-- a policy that does not exist yet.
--
-- DELIBERATELY NOT HERE. No `retry_class`, no `terminal`, no `max_attempts`, no
-- `prior_attempt_id`, no `retry_policy_version`, and no separate
-- `rate_limit_reset_at` — two horizons on one row could contradict each other,
-- so there is exactly one. No retry consumer, no scheduler, no reclaimer, no
-- backoff policy. This column RECORDS what a provider said; it decides nothing.
--
-- NO INDEX. An index would only pay off for a scheduler scanning for due work,
-- and no such reader exists. The table holds zero rows in production, so adding
-- one later is free — and doing it now would be guessing at the query shape of
-- a component that has not been designed.
--
-- SAFE TO APPLY. One nullable column, no default, no backfill, no constraint
-- change, no index, no other table. Nothing existing can violate it. Rollback is
-- a single DROP COLUMN.

ALTER TABLE public.prospect_enrichment_attempts
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

COMMENT ON COLUMN public.prospect_enrichment_attempts.next_retry_at IS
  'A6A: the provider''s OWN retry horizon, as an absolute instant, or NULL. '
  'Populated only from a usable Retry-After the provider actually sent; never '
  'synthesised, never a backoff, never derived from attempt_number. NULL means '
  'the provider expressed no opinion — it does NOT mean "retry now". This '
  'column records a provider statement and expresses no retry policy.';
