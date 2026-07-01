# Beta Testing Infrastructure

Goal: verify the complete authenticated customer journey **without touching production data or
spending production credits**. This document tracks what exists today and what each remaining piece
requires.

## ✅ Built: Beta AI render mode (zero-cost image generation) — BETA-020 RULE 4

The single biggest blocker to runtime testing was that every POST+IMAGE / TEXT-INSIDE generation
made a **paid** OpenAI image call. Beta AI mode removes that.

- **Enable:** set `BETA_AI_MODE=1` (or `true`) in the environment running the app/worker.
- **Effect:** `generateProviderImage` (`backend/services/creatorAssetRenderer.ts`) returns a
  **deterministic fixture image** (valid 1024×1024 PNG, generated locally with `sharp`) instead of
  calling OpenAI. Different prompts → different fixtures; the **same** prompt → byte-identical output
  (reproducible tests / stable Playwright snapshots). Model tag is `beta-mock`.
- **Production-safe:** off by default. When `BETA_AI_MODE` is unset the pipeline is byte-identical to
  before (falls straight through to the real OpenAI provider). Verified by
  `backend/tests/unit/betaMockRenderProvider.test.ts` (4 tests).
- **Implementation:** `backend/services/creator/rendering/providers/betaMockRenderProvider.ts`
  (`isBetaAiRenderMode()`, `createBetaMockImage(prompt)`), wired as a top-of-function gate in
  `generateProviderImage`.

With `BETA_AI_MODE=1`, the full Writer→POST+IMAGE→editor→regenerate→download image path runs with
**zero OpenAI spend**, and the BETA-015 canonical render policy still applies (supporting_visual →
clean fixture, embedded_copy → fixture + deterministic overlay).

## ⛔ Not yet built — requires a sandbox Supabase project

The remaining Beta rules all depend on an **isolated (non-production) Supabase database**, which does
not exist in this repo (`.env.local` points at the production project `klkiseupptzbecbxwrky`, and the
local Supabase stack has a known migration-collision blocker — see
`project_local_supabase_migration_collision`). Standing these up safely requires provisioning a
throwaway Supabase project (or a working local stack) first. Sequenced work, each verifiable once a
sandbox DB exists:

1. **Environment separation (RULE 2):** add a `beta` deployment env to `config/env.schema.ts` (a
   `beta` value alongside `development`/`production`), plus an `.env.beta.example` wiring isolated
   database / storage / redis / OAuth / email / billing / OpenAI(=Beta AI mode) credentials.
2. **Runtime Test Mode (RULE 6):** a canonical `RUNTIME_TEST_MODE=1` flag that makes background jobs,
   email, notifications, OAuth callbacks, billing, and publishing **simulate completion** (no external
   platform receives data). Same gated pattern as Beta AI mode.
3. **Seed system (RULE 3) + test accounts (RULE 5):** one deterministic `scripts/seed-beta.ts` that
   provisions a complete Beta org (company, users by role, brand, website, reports, content,
   campaigns, creator assets, engagement, analytics, credits, notifications) against the sandbox DB.
4. **Playwright authenticated suite (RULE 7):** extend the existing `tests/**/*.spec.ts` Playwright
   setup with `tests/e2e/beta-journey.spec.ts` that logs in as a seeded user and drives Login →
   Website Analysis → Reports → Writer → POST+IMAGE → TEXT INSIDE IMAGE → Editor → Regenerate →
   Download → Campaign → Schedule → Publish → Engagement → Dashboard, failing on the first defect.

## Verification status

| Piece | Status | Verification |
|---|---|---|
| Beta AI render mode | ✅ built | 4/4 unit tests; worker tsc clean; gate off by default |
| Environment separation | ⛔ pending sandbox DB | — |
| Runtime Test Mode | ⛔ pending | — |
| Seed + test accounts | ⛔ pending sandbox DB | — |
| Playwright journey | ⛔ pending sandbox DB + seed | — |

## Reset / enable (today)
- Enable zero-cost rendering: `BETA_AI_MODE=1 npm run dev:full`.
- Disable (production behavior): unset `BETA_AI_MODE`.
