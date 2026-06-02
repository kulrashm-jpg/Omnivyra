-- =============================================================================
-- Phase 2 — Credit catalog coverage for LEAD-CAPTURE INTELLIGENCE
--
-- Closes the last AI-activity gap found by the 2026-06-02 refresh scan: the
-- lead-capture intelligence surface was the ONLY major AI path not represented
-- in the credit ledger. Every other §C.4 activity already has a catalog key
-- (migration 20260665) and a wirePhase2Route() wrapper.
--
-- Activities covered (each calls runDiagnosticPrompt today):
--   * qualifyLead()           backend/services/leadQualifier.ts:97
--                             processType 'qualifyLead'  → action 'lead_qualification'
--   * qualifyPredictiveLead() backend/services/leadPredictiveQualifier.ts:108
--                             processType 'qualifyPredictiveLead' → 'lead_predictive_scoring'
--   Both are invoked in batch by leadJobProcessor.ts (one call PER scanned post).
--
-- CHARGING MODEL (value-gated, PER QUALIFIED lead — NOT per scanned post):
--   leadJobProcessor charges once at job completion via deductCreditsIfValueAwaited
--   with multiplier = total_qualified (a lead is "qualified" when
--   total_score >= 0.6 && !risk_flag). Skipped entirely when 0 qualified.
--   Idempotent on jobId. The raw per-post LLM token cost is captured separately
--   in usage_events (process_type → action_key mapping) for margin visibility;
--   the user-facing credit charge lands per actionable/qualified lead.
--
-- SAFETY:
--   * Purely additive. No existing row modified, no schema change.
--   * Idempotent: ON CONFLICT (action_type) DO UPDATE keeps it re-runnable.
--   * Pricing kept low because it scales × qualified-lead count (a productive
--     scan must not bankrupt a wallet): reactive 2, predictive 3. Tune freely —
--     getCreditCost reads this row at charge time, so the number is a knob.
--   * smart_dedup_seconds = 0: per-job idempotency (referenceId = jobId) is the
--     dedup mechanism, not a time window.
--
-- NOT APPLIED by this change. Apply only via the controlled migration process
-- (prod migration ledger is intentionally not bulk-pushed).
-- =============================================================================

INSERT INTO credit_cost_config (action_type, credits, category, description, smart_dedup_seconds) VALUES
  ('lead_qualification',       2, 'medium', 'LLM lead qualification — charged per qualified lead (value-gated, x qualified count); per-post token cost captured in usage_events', 0),
  ('lead_predictive_scoring',  3, 'medium', 'Predictive lead scoring — charged per qualified latent lead (value-gated, x qualified count); per-post token cost captured in usage_events', 0)
ON CONFLICT (action_type) DO UPDATE SET
  credits             = EXCLUDED.credits,
  category            = EXCLUDED.category,
  description         = EXCLUDED.description,
  smart_dedup_seconds = EXCLUDED.smart_dedup_seconds,
  updated_at          = NOW();
