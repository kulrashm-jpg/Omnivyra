-- =============================================================================
-- PI-LDB-5 — catalog rows for the `lead_attribute_mapping` credit action
--
-- WHY THIS MIGRATION EXISTS AT ALL
-- --------------------------------
-- AI semantic attribute mapping is a new billable capability, so it needs its
-- own action key. Reusing an existing one (content_rewrite was the tempting
-- shortcut, since creator field-assist already borrows it) would have made the
-- usage ledger attribute import-mapping spend to content generation, and the
-- ledger is what the per-activity credit question is answered from. A wrong
-- attribution is worse than a new row.
--
-- Two code-side gates already fail CLOSED without these rows, which is why
-- this migration is a hard dependency rather than a nice-to-have:
--
--   * `assertCanonicalCreditAction()` throws when the monetization registry
--     cannot resolve the action. That part ships in code (featureRegistry.ts).
--   * `fetchActionPricingRow()` throws `Missing action_pricing_config row for
--     actionKey='lead_attribute_mapping'`. That is THIS migration.
--
-- Until this is applied, `createGatewayMappingProposer` throws on every call,
-- `proposeFieldMappings` catches it and records one `degraded` entry, and the
-- import maps deterministically. No credits are reserved and no model call is
-- made, because the pricing lookup happens before the executor runs. The
-- feature is dark, not broken — but it IS dark, and that is the point of
-- saying so here.
--
-- PRICING
-- -------
-- Token-priced through `llm_model_pricing`, like master content generation:
-- the HOLD comes from `estimateLlmHoldCredits(provider, model, maxTokens)` and
-- is partially confirmed against the actual token counts. So:
--
--   * `credit_cost_config.credits` is ONLY the resolver fallback, for a caller
--     that passes the action without `llmPricing`. It reuses the existing
--     low/1 tier (the ai_reply tier). No new pricing tier is invented.
--   * `action_pricing_config.cost_multiplier` is 1.0 — no markup. A mapping
--     call on gpt-4o-mini within this operation's token budget (12k in /
--     3k out) costs about 0.0036 USD at the current rate card.
--   * `ceiling_usd` is 0.05, roughly fourteen times that worst case. A
--     ceiling is set deliberately rather than left NULL: a NULL ceiling means
--     a model swap or a rate-card error bills a tenant whatever it costs, and
--     `estimateMaxHoldCredits` then falls back to `minimum_charge_usd * 5`,
--     which is 0 — so the hold ceiling would be the floor of 1 credit while
--     the confirm was unbounded.
--
-- SAFETY
-- ------
--   * Purely additive. No schema change, no existing row modified.
--   * Idempotent and re-runnable: the credit row uses ON CONFLICT DO UPDATE
--     on its unique `action_type`, and the pricing row is guarded by
--     NOT EXISTS against the partial unique index on active rows.
--   * NOT APPLIED anywhere real by this change. Apply only through the
--     controlled migration process; the production ledger is deliberately
--     never bulk-pushed.
-- =============================================================================

-- ONE TRANSACTION (2026-11-11): the snapshot below is ON COMMIT DROP, and the
-- two seeds plus their postconditions must land together or not at all.
BEGIN;

-- ── 0. Snapshot any PRE-EXISTING billing row (GOV-SECURITY, 2026-11-11) ─────
-- A re-applied seed must NEVER overwrite a live billing row. The insert below is
-- DO NOTHING on conflict, and the postcondition proves an existing row's
-- credits are unchanged against this snapshot.
CREATE TEMP TABLE pi_ldb_m04_prior ON COMMIT DROP AS
  SELECT credits FROM credit_cost_config WHERE action_type = 'lead_attribute_mapping';

-- ── 1. Resolver fallback (flat) ─────────────────────────────────────────────
INSERT INTO credit_cost_config (action_type, credits, category, description, smart_dedup_seconds)
VALUES (
  'lead_attribute_mapping',
  1,
  'low',
  'AI semantic attribute mapping for an imported prospect schema (token-priced; flat = resolver fallback)',
  -- No smart dedup. Re-proposing is already deduplicated where it belongs, by
  -- the billing idempotency key, which keys on the actor, the action, the
  -- source + schema fingerprint and a digest of the prompt. A time window here
  -- would additionally suppress a genuinely different question asked about the
  -- same file within the window.
  0
)
ON CONFLICT (action_type) DO NOTHING;

-- ── 2. Token pricing layer ──────────────────────────────────────────────────
INSERT INTO action_pricing_config (
  action_key,
  -- NOT NULL, and CHECK-restricted to ('llm','embedding','fixed'). 'llm'
  -- because the hold comes from `estimateLlmHoldCredits(provider, model,
  -- maxTokens)` and is confirmed against actual token counts; 'fixed' would
  -- describe the flat `credit_cost_config` fallback, which is not how this
  -- action is priced. Omitting it is what the first version of this migration
  -- did, and the real-schema replay refused it on the NOT NULL — in
  -- production that would have been a failed apply.
  source_type,
  cost_multiplier,
  minimum_charge_usd,
  ceiling_usd,
  effective_from,
  is_active,
  notes
)
SELECT
  'lead_attribute_mapping',
  'llm',
  1.0,
  0,
  0.05,
  now(),
  true,
  'PI-LDB-5: AI attribute mapping, token-priced via llm_model_pricing; no markup, ceiling ~14x worst-case'
WHERE NOT EXISTS (
  SELECT 1 FROM action_pricing_config
   WHERE action_key = 'lead_attribute_mapping' AND is_active = true
);

-- ── Postconditions ─────────────────────────────────────────────────────────
-- These assert the two things the code actually requires at runtime. They are
-- written as counts rather than as "the insert succeeded", because on a replay
-- neither statement inserts anything and a success check would be vacuous.
DO $$
DECLARE
  v_credit  integer;
  v_pricing integer;
  v_ceiling numeric;
  v_mult    numeric;
BEGIN
  SELECT count(*) INTO v_credit
    FROM credit_cost_config WHERE action_type = 'lead_attribute_mapping';
  IF v_credit <> 1 THEN
    RAISE EXCEPTION 'PI-LDB-5 postcondition: expected exactly 1 credit_cost_config row for lead_attribute_mapping, found %. getCreditCost() is the resolver fallback and would have nothing to fall back to.', v_credit;
  END IF;

  -- A row that existed before this file ran keeps its credits EXACTLY (the
  -- seed is DO NOTHING; this pins it).
  IF EXISTS (SELECT 1 FROM pi_ldb_m04_prior p
              WHERE p.credits IS DISTINCT FROM
                    (SELECT credits FROM credit_cost_config WHERE action_type = 'lead_attribute_mapping')) THEN
    RAISE EXCEPTION 'PI-LDB-5 postcondition: the PRE-EXISTING credit_cost_config row for lead_attribute_mapping had its credits changed by this seed (a replay must never overwrite a live billing row)';
  END IF;

  SELECT count(*) INTO v_pricing
    FROM action_pricing_config
   WHERE action_key = 'lead_attribute_mapping' AND is_active = true;
  IF v_pricing <> 1 THEN
    RAISE EXCEPTION 'PI-LDB-5 postcondition: expected exactly 1 ACTIVE action_pricing_config row for lead_attribute_mapping, found %. fetchActionPricingRow() throws on 0, and >1 would mean the partial unique index is gone.', v_pricing;
  END IF;

  SELECT ceiling_usd, cost_multiplier INTO v_ceiling, v_mult
    FROM action_pricing_config
   WHERE action_key = 'lead_attribute_mapping' AND is_active = true;

  -- A NULL ceiling is the specific defect this guards: it is what the house
  -- seeding pattern produces by default, and it would leave the confirm
  -- unbounded while the hold stayed at the 1-credit floor.
  IF v_ceiling IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-5 postcondition: ceiling_usd is NULL. applyPricingLayer() then applies no cap at confirm, and estimateMaxHoldCredits() falls back to minimum_charge_usd * 5 = 0.';
  END IF;

  -- Asserted because the column is NOT NULL *and* CHECK-constrained, so a
  -- wrong-but-valid value ('fixed') would apply cleanly and then price every
  -- call at the flat fallback instead of by tokens. The NOT NULL catches an
  -- omission; only this catches the wrong member.
  IF (SELECT source_type FROM action_pricing_config
       WHERE action_key = 'lead_attribute_mapping' AND is_active = true) <> 'llm' THEN
    RAISE EXCEPTION 'PI-LDB-5 postcondition: source_type must be ''llm'' for a token-priced action; anything else bills from credit_cost_config instead of the model rate card.';
  END IF;

  IF v_mult IS NULL OR v_mult <= 0 THEN
    RAISE EXCEPTION 'PI-LDB-5 postcondition: cost_multiplier is %, which would price every mapping call at the minimum charge regardless of tokens used.', v_mult;
  END IF;

  RAISE NOTICE 'PI-LDB-5: lead_attribute_mapping catalog rows present (multiplier %, ceiling % USD).', v_mult, v_ceiling;
END
$$;

COMMIT;
