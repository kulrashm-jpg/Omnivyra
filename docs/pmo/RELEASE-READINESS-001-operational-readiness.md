# RELEASE-READINESS-001 — Strategic Recommendation Intelligence: Operational Readiness

**Assigned:** Agent 1 (Platform / Release Engineering) · **Type:** operational only — **no recommendation
logic, no narrative field, and no product behaviour changed.**
**Date:** 2026-07-22. **Subject:** flag `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED`.
**Predecessor:** PRODUCT-RELEASE-001 (Agent 2) certified the capability functionally ready and named two
operational blockers: *uncommitted* and *no observability*. Both are addressed here.

---

## 1. Release notes (internal)

**Strategic Recommendation Intelligence is restored, behind a flag that ships OFF.**

Recommendation cards carry six strategic narrative fields — `problem_being_solved`, `gap_being_filled`,
`why_now`, `authority_reason`, `expected_transformation`, `campaign_angle`. Their producer was deleted as
collateral in a 901-file bulk commit on 2026-05-16, and every field has silently resolved to `null` since.
Downstream, that meant generic week-topic copy, a missing `authority` / `conversion` execution stage, and a
strategic-content validator scoring a vacuous 0.

With the flag ON (measured on the canonical 60-profile / 300-card corpus):

| | Before | After |
|---|---|---|
| Cards with populated narrative | 0 / 300 | **300 / 300** |
| Content-bridge synthetic-copy fallback | fired on 100% of profiles | **0%** |
| Distinct-value average, six fields | — | **0.733** |
| Specificity | 80.4% | **84.2%** |
| Determinism | — | **absolute** (1 hash / 3 runs) |

The producer is template composition over existing profile fields: no LLM, no DB, no network, no new
dependency, no schema change, no migration. **Fabrication is structurally impossible, not merely
unobserved.** Blast radius when enabled is 100% of weekly-plan copy — intended, but user-visible on every
campaign.

## 2. Rollout instructions

The flag is read at exactly two call sites, both in `backend/services/recommendationEngine/engine.ts`
(primary path and fallback path), through the single helper
`strategicRecommendationIntelligenceEnabled()`.

1. **Confirm the gate is green** on the branch — check `Strategic narrative regression lock`
   (`.github/workflows/strategic-recommendation-intelligence.yml`), 75 tests.
2. **Set the env var on ONE non-production environment first:**
   `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED=true`
   The value is compared with `===` against the exact string `'true'`. `TRUE`, `1`, `yes`, `on` and
   `' true '` all leave the capability OFF — this is asserted in
   `backend/tests/unit/strategicIntelligenceObservability.test.ts`.
3. **Restart / redeploy the process** that runs recommendation generation so it picks up the env var.
   Both the Vercel app and the Railway worker read `process.env` at call time, but the platforms only
   deliver a changed variable on a new deploy.
4. **Generate one full recommendation cycle** and inspect the cards, the week topics and the content
   bridge.
5. **Widen only after** the two rollout criteria PRODUCT-RESTORE-001 left open are met:
   (a) a human copy review with the flag ON, and (b) a re-baseline of the strategic-content-transformation
   validator's score distribution against non-null intelligence.

The flag is deliberately **not** registered in `config/env.schema.ts`, so neither setting nor unsetting it
can fail startup validation.

## 3. Rollback procedure

**Unset `STRATEGIC_RECOMMENDATION_INTELLIGENCE_ENABLED`. No code deployment. No data to reverse.**

- Both call sites short-circuit to the pre-restoration pass-through; all six fields resolve to `null`
  exactly as they did before the restoration.
- Nothing is persisted by enrichment — it is a pure in-memory transform of the recommendation list. There
  is no migration, no table, no cache to purge.
- Recovery time is one process restart / redeploy.
- Setting the variable to any value other than the literal `'true'` (including `false`) is equally
  effective; unsetting is preferred because it leaves no ambiguous state.

**Partial rollback is not available** — the flag is all-or-nothing per environment. There is no
per-company or percentage rollout. If a single company's copy is wrong, the lever is the whole
environment.

## 4. Operational ownership

| Concern | Owner |
|---|---|
| Producer + narrative rules (`strategicRecommendationIntelligenceService.ts`) | Recommendations / Product |
| Compatibility harness (`backend/tests/support/strategicNarrativeCompatibility.ts`) | Recommendations / Product — **any** narrative change must keep it green **unmodified** |
| Flag decision points (`recommendationEngine/engine.ts`) | Recommendations / Product |
| CI gate (`strategic-recommendation-intelligence.yml`) | Platform / Release Engineering |
| Metrics module (`backend/observability/strategicIntelligenceMetrics.ts`) | Platform / Release Engineering |
| Enabling / disabling the flag per environment | Whoever owns environment configuration (Vercel + Railway) |

Escalation for a copy-quality complaint is **not** a code change: unset the flag first, then triage.

## 5. Monitoring expectations

Five bounded signals, emitted through the canonical HARDEN-001 registry
(`backend/observability`) and visible via `getObservabilitySnapshot()` / the Prometheus exporter:

| Metric | Type | Labels |
|---|---|---|
| `recommendation.strategic_intelligence.invoked` | counter | `path` |
| `recommendation.strategic_intelligence.succeeded` | counter | `path` |
| `recommendation.strategic_intelligence.skipped` | counter | `path`, `reason` |
| `recommendation.strategic_intelligence.failed` | counter | `path`, `reason` |
| `recommendation.strategic_intelligence.duration_ms` | histogram | `path` |

`path` ∈ `primary` | `fallback`. `reason` ∈ `flag_disabled` | `empty_result` | `producer_fallback`.

**What to expect:**

- **Flag OFF (today):** `skipped{reason=flag_disabled}` only. `invoked` stays at zero. This is the
  positive confirmation that the default really is inert.
- **Flag ON, healthy:** `invoked` ≈ `succeeded`, one per generation cycle per path;
  `duration_ms` in the low single-digit milliseconds (pure in-memory string composition over ≤ a few dozen
  recommendations).
- **Investigate:** any non-zero `failed{reason=producer_fallback}`. It means the producer's fail-safe
  `catch` fired and every card in that batch received the generic fallback narrative. It is silent to the
  user and was previously undetectable. This is the single most important signal to alert on.
- **Investigate:** a rising `skipped{reason=empty_result}` while the flag is ON — enrichment ran and
  returned nothing to adopt.
- **Watch:** `duration_ms` p95 drifting above ~50 ms would indicate the recommendation list has grown
  unexpectedly large.

**Privacy contract (do not relax).** The six narrative fields carry company-specific strategic content.
Every emitter takes compile-time literal unions only — no emitter accepts a caller-supplied value — so no
narrative text, profile text, topic string, company id, name or domain can reach the registry. There is no
tenant dimension on these metrics **by design**: you can see *that* enrichment degraded, not *for whom*.
Diagnosing a specific company requires reproducing locally with that company's profile.

**Instrumentation is fail-safe.** Every emitter is double-wrapped; a throwing sink is swallowed and
enrichment output is unaffected. Enrichment output is byte-identical with observability ON vs OFF. All
three properties are asserted in `backend/tests/unit/strategicIntelligenceObservability.test.ts`.

## 6. CI protection — and its exact limit

`.github/workflows/strategic-recommendation-intelligence.yml` runs 75 tests in four scoped steps
(compatibility 13 · producer/restoration 34 · downstream consumers 21 · observability 7). It is
deliberately **not** a whole-repo jest job: the repo has ~55 integration suites plus pre-existing red
suites unrelated to this capability, and a permanently red gate protects nothing.

> **A workflow file makes a check RUN. Only GitHub branch protection makes it BLOCK a merge — and that is
> a repository setting no file in this repo can perform.** Until an admin adds the check named
> **`Strategic narrative regression lock`** to the protected branch's required status checks, this gate is
> **advisory**: it will go red on a regression, but the merge button stays green.

## 7. Verification performed

| Gate | Result |
|---|---|
| `node scripts/typecheck-certification.js` | **PASS** — production 1/1, tests 443/443, net-new 0 |
| Capability suites | **75 / 75 across 8 suites** (the certified 68/68 unchanged + 7 new observability contracts) |
| Compatibility harness file | **unmodified** — no assertion weakened, skipped or disabled |
| Program B suites (gateway + 4 adapters + identity/metadata) | **403 / 403 across 12 suites** |
| `npm run typecheck:ci` | **PASS** |
| `npm run check:ssrf` | **PASS** |
| `.github/workflows/typecheck-baseline.yml` | byte-identical to pre-work HEAD |
| Flag OFF ⇒ byte-identical behaviour | asserted |

## 8. Known remainders

1. **Branch-protection registration** — owner action, cannot be done from a file. See §6.
2. **Human copy review** and **validator score re-baseline** — PRODUCT-RESTORE-001 rollout criteria 2 and
   3, still open. They gate *widening* the rollout, not the internal enable.
3. **`companyContextFoundationFix.test.ts` sections 1–2 (3 tests) are red and excluded from the gate.**
   They mock `companyProfileService.getProfile`, but `buildCompanyMissionContext` reaches the DB through
   `context/canonicalProfileAdapter` → `companyProfileServiceRest1Rest2Pulse`, bypassing the mock and
   hitting live Supabase. Pre-existing and unrelated to this capability — the file's section 6, which the
   restoration actually touched, passes. Fixing that mock is separate work.
4. **`scripts/typecheck-baseline.json` (the legacy, non-certification baseline) reads 86 while actual is
   54.** Pre-existing and out of scope here; locking it is a separate dedicated commit.
   → **Resolved (TECH-DEBT-001 / DOC-HYGIENE-001, 2026-07-26):** baseline lowered **86 → 47** after
   `tsconfig.json` and `tsconfig.backend.json` reached 0; current guidance lives in the canonical
   `docs/TYPESCRIPT-VALIDATION-STRATEGY.md`.
