# CUSTOMER_ACQUISITION_SIGNAL_AUDIT.md

Phase 13F · Phase 1 — inventory of every onboarding/acquisition source. **Audit only.**
Counts/columns probed live from production (read-only).

| Source | Owner table | Freshness | Coverage | Known gaps |
|---|---|---|---|---|
| **Signup attempts** | `signup_intents` (24) | real-time (`created_at`, `last_touch_at`) | **Partial** — invite/manual paths bypass it (24 intents vs 38 companies) | `stage` column not granular (always `pending`); `supabase_uid` empty → can't link intent → user/company |
| **Email verification** | `auth.users.email_confirmed_at` | real-time | **Not measurable** via PostgREST (auth schema not in `public`) | no persisted public-schema mirror; cannot count distinctly |
| **Domain validation** | `domain_eligibility_cache` (8) + `domain_events` (2) | cached per check | Sparse — passes recorded as `valid_company` (6); failures `no_mx` (2) | per-signup verdicts not persisted; `domain_events` currently only `DOMAIN_UNVERIFIED_USAGE` (a usage warning, not a signup loss) |
| **Claimed-domain failures** | `signup_referrals` (2) | real-time (`first/last_attempt_at`) | Good for what it captures | only prospect attempts on already-claimed domains |
| **Company creation** | `companies` (38) | real-time (`created_at`) | **Full** | multi-path (signup, invite, manual) — not all trace to a signup_intent |
| **Company profile creation** | `company_profiles` (29) | `last_refined_at` / `updated_at` | 29 of 38 companies | 9 companies have no profile row; only 3 reach `overall_confidence ≥ 60` |
| **Setup-company completion** | `signup_intents` (`status=completed`, 5) | `completed_at` | Partial (intent cohort only) | 5 completed of 24 tracked; the other 33 companies completed setup outside signup_intents |

## Key data-quality findings

1. **Two incompatible populations.** `signup_intents` (24, recent funnel) and `companies`
   (38, multi-path, 3-month accumulation) are *not* one cohort — companies exceed tracked
   intents. Cross-population "conversion" (signup → company) is **not computable** and is
   reported as such (never fabricated).
2. **Mid-funnel is dark.** EMAIL_VERIFIED and IDENTITY_VALIDATED have no per-signup
   persisted count → reported UNKNOWN, not guessed.
3. **Abandonment reason is not captured.** Pending intents (19) carry no granular stage, so
   their loss reason is genuinely UNKNOWN.
