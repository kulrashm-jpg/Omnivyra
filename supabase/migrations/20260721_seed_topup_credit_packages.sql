-- ============================================================================
-- Seed top-up credit packages (250 / 750 / 1500) — PREPARED, **NOT APPLIED**
-- ----------------------------------------------------------------------------
-- ⚠ NOT APPLIED. Controlled billing-migration process only.
-- ⚠ PRICES ARE PLACEHOLDERS — set the APPROVED prices before applying. Per the
--   Phase A.1 gate ("validate pricing values; if correct, apply"), this seed
--   does NOT pass until the real prices are confirmed.
--
-- Schema-validated against the live DDL (20260322_monetization_foundation.sql):
--   credit_packages(id UUID PK, name TEXT NOT NULL, credits INT, price NUMERIC,
--                   is_active BOOL).  The order path reads id/credits/price/
--                   is_active (razorpayStagingService.ts:187) and derives the
--                   charge from `price` (currency hardcoded INR).
-- Fixed UUIDs make this idempotent (ON CONFLICT (id)) and give the catalog a
-- stable package id to pass to create-order. They mirror lib/billing/topupCatalog.ts.
-- ============================================================================

-- Canonical SKUs 250 / 500 / 1000. `price` is the INR charge (Razorpay India);
-- ids mirror lib/billing/{commercialPlans,topupCatalog}.ts. INR amounts are
-- ~₹84/USD conversions of $30/$55/$100 — confirm approved values before applying.
INSERT INTO credit_packages (id, name, credits, price, is_active)
VALUES
  ('0a0a0a25-0000-4000-8000-000000000250'::uuid, 'Top-up 250 credits',   250,  2499.00, true),
  ('0a0a0500-0000-4000-8000-000000000500'::uuid, 'Top-up 500 credits',   500,  4599.00, true),
  ('0a0a1000-0000-4000-8000-000000001000'::uuid, 'Top-up 1000 credits', 1000,  8299.00, true)
ON CONFLICT (id) DO NOTHING;
