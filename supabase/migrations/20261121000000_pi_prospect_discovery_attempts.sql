-- B4-A1 — the prospect DISCOVERY execution ledger.
--
-- ─── WHY A SIBLING TABLE AND NOT A WIDENED ENRICHMENT LEDGER ───────────────
-- `prospect_enrichment_attempts` carries, deliberately, the invariant that an
-- attempt is ABOUT one canonical entity:
--
--   CONSTRAINT prospect_enrichment_attempts_one_subject CHECK (
--     (person_id IS NOT NULL AND account_id IS NULL)
--  OR (person_id IS NULL     AND account_id IS NOT NULL))
--
-- D22-B4-A established that discovery cannot satisfy it and must not be made
-- to: a discovery search is executed precisely BECAUSE the person or account is
-- not yet known to Omnivyra. Nulling the subject, minting a sentinel entity or
-- relaxing the CHECK would each take a table G-6 hardened and give it two
-- unrelated meanings, and the invariant would stop meaning anything for the
-- enrichment rows that genuinely need it.
--
-- So the subject of a row here is THE SEARCH. Nothing in this file touches
-- `prospect_enrichment_attempts`, and the G-6 tenant-FK work is untouched.
--
-- ─── WHAT IS DELIBERATELY NOT COPIED FROM ENRICHMENT ──────────────────────
--   requested_attributes   An enrichment attempt asks for canonical ATTRIBUTES
--                          of a known entity. A search has FILTERS, which are
--                          provider-neutral criteria and not PI attribute
--                          names. `pi_canonical_attribute_set` would be the
--                          wrong canonicaliser and is not used here.
--   person_id / account_id There is no subject entity. See above.
--   source_record_id       One execution produces MANY source records, so a
--                          single FK cannot hold the result. The ledger keeps
--                          COUNTS and the source records carry their own
--                          provenance; that keeps `source_records` the single
--                          authority on what was ingested.
--
-- ─── WHAT IS REUSED, AND WHY THAT IS NOT BLIND COPYING ────────────────────
-- Three conventions are reused because they answer questions discovery asks in
-- exactly the same form, and a second spelling of either would drift:
--
--   the three-valued transport truth (A4Q) `not_called | called | unknown`.
--     `unknown` must never collapse into `not_called`: that collapse is what
--     lets a retry spend a tenant's provider quota twice.
--   the LIVE PARTIAL UNIQUE INDEX as the concurrency arbiter (A4N), rather than
--     a lock table — nothing enqueues a search before the attempt itself, so the
--     claim has to BE the insert and the arbiter has to be an index.
--   the lease pair `claimed_by` / `claimed_until`, so an executor that dies
--     cannot hold the live slot forever.
--
-- ─── THE BOUNDS ARE SCHEMA-ENFORCED, NOT APPLICATION-ENFORCED ─────────────
-- D-4 requires every discovery execution to be bounded. An application-only
-- bound is one forgetful caller away from being no bound, so the ceilings are
-- CHECKs: `pages_fetched <= max_pages`, `results_observed <= max_results`,
-- `provider_calls_made <= max_provider_calls`. An executor that tries to exceed
-- one is refused by the database, not by a code review.
--
-- ─── WHY THE COST CEILING IS DENOMINATED IN PROVIDER CALLS ────────────────
-- Not in credits. D22-B4-A left Apollo's free-account billing behaviour
-- UNVERIFIED — its own reference documents People Search at 0 credits while
-- independent analyses say the free plan has no API at all. A credit-denominated
-- ceiling would require a number nobody here has observed, and inventing one is
-- exactly the fabricated zero-cost declaration the gate forbids. A call count is
-- provider-neutral, is knowable in advance, and bounds spend under every reading
-- of the pricing. `provider_cost_state` defaults to `unknown` and stays there
-- until a real provider response states otherwise.
--
-- SAFE TO APPLY. One new table. No existing table, constraint, index or row is
-- touched. NOT APPLIED to production by this gate.

CREATE TABLE IF NOT EXISTS public.prospect_discovery_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TENANT. uuid, matching `prospect_enrichment_attempts.organization_id`.
  -- Discovery is never platform-owned: the credential, the quota and the bill
  -- all belong to the tenant, so a tenant-less row is meaningless.
  organization_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- The provider, by its canonical A3C source id (e.g. 'apollo'). Free text for
  -- the same reason `source_records.provider` is: a new provider must never
  -- require a migration.
  provider_key        text NOT NULL,

  -- ── THE SUBJECT: THE SEARCH ─────────────────────────────────────────────
  -- The CANONICAL form of the search, as the application normalised it. It is
  -- the request that was (or will be) issued, not a copy of what a caller typed:
  -- storing the canonical form is what makes `search_digest` reproducible from
  -- the row, and what stops two spellings of one search looking like two
  -- searches.
  search_criteria     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- sha256 of the canonical search, lowercase hex. Computed by the application
  -- from `search_criteria` plus the provider and the bounds.
  search_digest       text NOT NULL,

  -- ── D-4 BOUNDS ──────────────────────────────────────────────────────────
  max_pages           integer NOT NULL,
  max_results         integer NOT NULL,
  -- The cost ceiling, in provider calls. See the header.
  max_provider_calls  integer NOT NULL,

  -- The Nth execution of THIS search for this tenant and provider.
  attempt_number      integer NOT NULL,

  -- Existing tracing, reused rather than replaced.
  correlation_id      text NOT NULL,

  -- ── EXECUTION STATE, PROVIDER TRANSPORT AND PROVIDER VERDICT ────────────
  -- Three columns because they answer three different questions, and collapsing
  -- any two of them is how a tenant gets billed for a call nobody can prove
  -- happened:
  --   execution_status     how OUR execution stands
  --   provider_call_state  whether transport happened (the A4Q three-valued truth)
  --   outcome              what the PROVIDER said, or the refusal WE made
  execution_status    text NOT NULL DEFAULT 'pending',
  provider_call_state text NOT NULL DEFAULT 'not_called',
  outcome             text,

  -- ── LEASE (A4N convention) ──────────────────────────────────────────────
  -- Who holds the execution, and until when. Free text: a worker/process
  -- identifier, never a credential and never a user.
  claimed_by          text,
  claimed_until       timestamptz,

  -- ── BOUNDED PAGINATION ──────────────────────────────────────────────────
  pages_fetched       integer NOT NULL DEFAULT 0,
  -- Provider-neutral continuation. Opaque to everything except the provider
  -- adapter that produced it: this column deliberately does NOT model a cursor,
  -- an offset or a page token, because assuming any one of them would bake one
  -- provider's pagination into the generic ledger. NULL until a provider states
  -- that more results exist.
  continuation_state  jsonb,

  -- ── RESULTS ─────────────────────────────────────────────────────────────
  -- `results_observed` counts records this bounded execution ACCEPTED from the
  -- provider; the executor stops requesting at `max_results`, so a page larger
  -- than the remaining budget is consumed only up to it. `results_ingested`
  -- counts those the ingestion boundary accepted, and can only be lower — a
  -- record can be rejected by normalisation or identity resolution.
  results_observed    integer NOT NULL DEFAULT 0,
  results_ingested    integer NOT NULL DEFAULT 0,
  -- What was actually spent against `max_provider_calls`.
  provider_calls_made integer NOT NULL DEFAULT 0,

  -- ── PROVIDER EVIDENCE ───────────────────────────────────────────────────
  -- The provider's own identifier for the request, when it supplies one. Never
  -- synthesised: a value invented here would be indistinguishable from one the
  -- provider stated.
  provider_request_id text,
  -- Cost evidence. `unknown` is the default and the honest value until a real
  -- provider response says otherwise. See the header.
  provider_cost_state text NOT NULL DEFAULT 'unknown',
  provider_cost_units integer,

  -- Short, safe diagnostic classification. Never a secret, never a credential.
  detail              text,
  executor_version    text,

  -- ── TIMESTAMPS ──────────────────────────────────────────────────────────
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  -- Failure and recovery, kept separate from `completed_at`: a failed page may
  -- be retried within one execution, so the execution can carry a failure
  -- without being closed.
  last_failure_at     timestamptz,
  recovered_at        timestamptz,
  -- The retry horizon, read from a provider's own `Retry-After` and never
  -- synthesised — the A6A convention.
  next_retry_at       timestamptz,

  -- ── EXECUTION STATE VOCABULARY ──────────────────────────────────────────
  -- `pending` is the insert-time value: B4-A1 creates the execution record and
  -- stops there. Provider invocation is a separately gated step.
  --
  -- `abandoned` is registered so the vocabulary and this CHECK are complete, and
  -- is deliberately never written — exactly as `prospect_enrichment_attempts`
  -- treats its own `abandoned`. An expired lease is RECLAIMED on the same row,
  -- which preserves `continuation_state` so a partially paginated search can
  -- resume rather than restart and pay twice.
  --
  -- There is deliberately no `ambiguous`: "we cannot prove what the provider
  -- did" is already expressible, and more precisely, as a closed execution whose
  -- `provider_call_state` is `unknown`. A fourth name for it would be a second
  -- representation of one fact.
  -- `refused_pre_call` is carried for the reason A4T established on the
  -- enrichment ledger: "WE declined before transport" and "it failed" have
  -- OPPOSITE retry safety, and no combination of `outcome` and
  -- `provider_call_state` separates them — a refusal and a provider error can
  -- both be `not_called` with an outcome set. Without it the two are
  -- distinguishable only by reading free-text `detail`.
  CONSTRAINT prospect_discovery_attempts_status_valid CHECK (
    execution_status IN ('pending', 'claimed', 'provider_running',
                         'refused_pre_call', 'completed', 'failed',
                         'cancelled', 'abandoned')
  ),

  CONSTRAINT prospect_discovery_attempts_call_state_valid CHECK (
    provider_call_state IN ('not_called', 'called', 'unknown')
  ),

  CONSTRAINT prospect_discovery_attempts_cost_state_valid CHECK (
    provider_cost_state IN ('unknown', 'free', 'billed')
  ),

  -- An execution is OPEN exactly while it is not finished. This is what keeps
  -- the live partial index below coherent with the status column: without it a
  -- row could claim `completed` while still occupying the live slot, or claim
  -- `pending` while closed.
  CONSTRAINT prospect_discovery_attempts_open_iff_uncompleted CHECK (
    (execution_status IN ('pending', 'claimed', 'provider_running'))
      = (completed_at IS NULL)
  ),

  -- ── THE BOUNDS, ENFORCED ────────────────────────────────────────────────
  CONSTRAINT prospect_discovery_attempts_bounds_positive CHECK (
    max_pages >= 1 AND max_results >= 1 AND max_provider_calls >= 1
  ),
  CONSTRAINT prospect_discovery_attempts_counters_nonnegative CHECK (
    pages_fetched >= 0 AND results_observed >= 0
    AND results_ingested >= 0 AND provider_calls_made >= 0
  ),
  CONSTRAINT prospect_discovery_attempts_within_page_bound CHECK (
    pages_fetched <= max_pages
  ),
  CONSTRAINT prospect_discovery_attempts_within_result_bound CHECK (
    results_observed <= max_results
  ),
  CONSTRAINT prospect_discovery_attempts_within_call_bound CHECK (
    provider_calls_made <= max_provider_calls
  ),
  -- Nothing can be ingested that was never observed.
  CONSTRAINT prospect_discovery_attempts_ingested_within_observed CHECK (
    results_ingested <= results_observed
  ),

  -- ── NO PROVIDER RESULT WITHOUT A PROVIDER CALL ──────────────────────────
  -- The invariant that makes "did we pay for this?" answerable from the row.
  -- Results, a provider request id or a cost claim can only exist once transport
  -- is admitted to have happened. `unknown` is accepted because a call that died
  -- mid-flight may genuinely have produced a bill.
  CONSTRAINT prospect_discovery_attempts_results_need_transport CHECK (
    (results_observed = 0 AND provider_calls_made = 0
       AND provider_request_id IS NULL)
    OR provider_call_state IN ('called', 'unknown')
  ),
  -- Units cannot be stated while the cost is claimed to be unknown.
  CONSTRAINT prospect_discovery_attempts_cost_units_consistent CHECK (
    provider_cost_state <> 'unknown' OR provider_cost_units IS NULL
  ),
  CONSTRAINT prospect_discovery_attempts_cost_units_nonnegative CHECK (
    provider_cost_units IS NULL OR provider_cost_units >= 0
  ),

  CONSTRAINT prospect_discovery_attempts_attempt_number_positive CHECK (
    attempt_number >= 1
  ),
  CONSTRAINT prospect_discovery_attempts_provider_not_blank CHECK (
    length(btrim(provider_key)) > 0
  ),
  CONSTRAINT prospect_discovery_attempts_correlation_not_blank CHECK (
    length(btrim(correlation_id)) > 0
  ),
  -- A digest is a sha256 in lowercase hex or it is not a digest. This is what
  -- stops a caller-supplied label being stored where an identity belongs.
  CONSTRAINT prospect_discovery_attempts_digest_shape CHECK (
    search_digest ~ '^[0-9a-f]{64}$'
  ),
  -- The criteria must be an OBJECT. A bare array, string or number would make
  -- the canonical form ambiguous and the digest unreproducible.
  CONSTRAINT prospect_discovery_attempts_criteria_is_object CHECK (
    jsonb_typeof(search_criteria) = 'object'
  )
);

-- ── THE CONCURRENCY ARBITER ────────────────────────────────────────────────
-- At most ONE live execution per (tenant, provider, search). A duplicate click,
-- a double-submitted form or a racing retry is rejected by the database with
-- 23505; there is no window in which two executions of one search can both
-- proceed to a provider, and no dependence on two callers reading the same
-- count first.
--
-- PARTIAL on the open predicate, which is the load-bearing detail: a COMPLETED
-- execution leaves this index immediately, so running the same search again
-- LATER is always permitted. That is the distinction D-4/§6 requires —
--
--   idempotent replay of ONE execution   -> the caller's Idempotency-Key, held
--                                           by the existing withIdempotency
--                                           middleware in api_idempotency_keys
--   a NEW execution of the same search   -> allowed, and gets attempt_number N+1
--   two executions at ONCE               -> refused, by this index
--
-- A permanent unique constraint over the search would have collapsed the second
-- and third cases and locked a tenant out of ever repeating a search.
CREATE UNIQUE INDEX IF NOT EXISTS prospect_discovery_attempts_live
  ON public.prospect_discovery_attempts (organization_id, provider_key, search_digest)
  WHERE completed_at IS NULL;

-- Attempt-number identity: the Nth execution of ONE search. Not partial —
-- unlike the enrichment ledger there is no nullable subject leg to split on,
-- which is one of the simplifications a dedicated table buys.
CREATE UNIQUE INDEX IF NOT EXISTS prospect_discovery_attempts_number_unique
  ON public.prospect_discovery_attempts
     (organization_id, provider_key, search_digest, attempt_number);

-- The read a reclaimer performs: "which live executions have expired leases?".
-- Partial on the same open predicate so it indexes in-flight work only.
CREATE INDEX IF NOT EXISTS idx_prospect_discovery_attempts_expired_claims
  ON public.prospect_discovery_attempts (organization_id, claimed_until)
  WHERE completed_at IS NULL;

-- The tenant's own history of a search, newest first.
CREATE INDEX IF NOT EXISTS idx_prospect_discovery_attempts_tenant_recent
  ON public.prospect_discovery_attempts (organization_id, provider_key, started_at DESC);

COMMENT ON TABLE public.prospect_discovery_attempts IS
  'B4-A1: one tenant-owned provider DISCOVERY execution. Its subject is the '
  'SEARCH, not a canonical person or account — that is why it is a sibling of '
  'prospect_enrichment_attempts and not a widening of it. Bounds are enforced '
  'by CHECK, and provider cost defaults to unknown until a real response says '
  'otherwise.';

COMMENT ON COLUMN public.prospect_discovery_attempts.search_criteria IS
  'B4-A1: the CANONICAL normalised search, as issued. Reproduces search_digest.';
COMMENT ON COLUMN public.prospect_discovery_attempts.search_digest IS
  'B4-A1: sha256 (lowercase hex) of the canonical search with provider and '
  'bounds. Work-item identity; never a caller-supplied label.';
COMMENT ON COLUMN public.prospect_discovery_attempts.continuation_state IS
  'B4-A1: provider-neutral opaque continuation. Models no cursor, token or '
  'offset — that belongs to the provider adapter that produced it.';
COMMENT ON COLUMN public.prospect_discovery_attempts.max_provider_calls IS
  'B4-A1: the cost ceiling, denominated in provider CALLS because Apollo''s '
  'credit behaviour is UNVERIFIED and a credit ceiling would require an '
  'invented number.';
COMMENT ON COLUMN public.prospect_discovery_attempts.provider_cost_state IS
  'B4-A1: unknown | free | billed. Defaults to unknown and stays there until a '
  'real provider response establishes the truth.';
COMMENT ON COLUMN public.prospect_discovery_attempts.provider_call_state IS
  'B4-A1 reuses the A4Q three-valued transport truth. unknown MUST NEVER be '
  'collapsed into not_called.';
