# OmniVYRA — Phase 2B.1: AI Orchestration Foundation (Persistence Layer)

**Scope:** persistence foundation ONLY — new tables, additive nullable extensions, seed data, and feature-flag registration. **No resolver, no gateway change, no admin API, no UI, no routing, no runtime consumer.** With all `AI_*` flags OFF (their default), the application behaves byte-identically to today.
**Implements:** the approved design in [AI-ORCHESTRATION-PHASE-2A-DESIGN.md](AI-ORCHESTRATION-PHASE-2A-DESIGN.md) §7 / §17 (phase 2A-1).
**Date:** 2026-07-31.

---

## 1. Migration Summary

Six SQL files (three forward + three matching rollbacks), placed after the latest existing migration (`20260905000000`) to guarantee ordering and avoid date-prefix collisions. All idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), all additive, all reversible.

| # | File | Purpose |
|---|---|---|
| 1 | `supabase/migrations/20260906000000_ai_orchestration_foundation.sql` | Create 8 new tables + indexes + RLS |
| 1r | `…_foundation_rollback.sql` | Drop all 8 tables (FK-safe order) |
| 2 | `supabase/migrations/20260906000001_ai_orchestration_extensions.sql` | Add nullable columns to 4 existing tables |
| 2r | `…_extensions_rollback.sql` | Drop the added columns + FKs |
| 3 | `supabase/migrations/20260906000002_ai_orchestration_seed.sql` | Seed profiles/versions/bindings/op-map/families/versions/config-version/audit |
| 3r | `…_seed_rollback.sql` | Delete seeded rows (data-only reversal) |

Non-migration files:
- `backend/services/aiOrchestration/orchestrationFlags.ts` — registers the 5 rollout flags (default OFF; not consumed).
- `backend/tests/unit/aiOrchestrationFlags.test.ts` — asserts all 5 registered + OFF.

---

## 2. Schema Summary

### New tables (8)

| Table | Purpose | Notes |
|---|---|---|
| `ai_model_families` | Group models under a provider family | FK → `llm_providers`; `UNIQUE(provider_id, family_key)` |
| `ai_model_versions` | Version pinning + lifecycle per model | FK → `llm_models`; `is_default` = "latest" target; `status ∈ active/deprecated/retired`; `UNIQUE(model_id, version_tag)` |
| `ai_routing_policies` | Ordered provider chain + circuit-breaker policy | `providers`/`circuit_breaker_policy` jsonb; INERT until 2A-7 |
| `ai_execution_profiles` | Profile pointer → current active version | `key` UNIQUE; `active_version_id` nullable FK → versions (circular ptr resolved by nullability + deferred `ADD CONSTRAINT`) |
| `ai_execution_profile_versions` | Immutable profile snapshots | `mode ∈ tier/explicit`; `quality_tier` check; params/modality/reliability/limits/caching/safety jsonb; `status` check; `UNIQUE(profile_id, version)` |
| `ai_capability_profile_bindings` | Bind capability/org → profile at a scope | `capability_id` TEXT (CAPABILITY_REGISTRY id, no FK); `org_id` UUID no-FK (mirrors `company_llm_configs.company_id`); `scope` check; `override_patch` jsonb; partial-unique index per (org,capability) coordinate |
| `ai_operation_capability_map` | Legacy `operation` → capability id | PK on `operation` |
| `ai_config_versions` | Monotonic config version for future cache invalidation | `BIGSERIAL`; NOT integrated in 2B.1 |

All 8 have RLS enabled (service-role bypass; admin writes via authenticated API in a later phase) — matching `20260320_admin_config_tables.sql`.

### Modified tables (4) — all columns nullable, no default, `ADD COLUMN IF NOT EXISTS`

| Table | Added columns |
|---|---|
| `llm_providers` | `priority`, `endpoint_url`, `supports_deployment`, `is_byok_allowed` |
| `llm_models` | `model_family_id` (FK→`ai_model_families` SET NULL), `supports_streaming`, `supports_structured`, `supports_vision`, `supports_tools`, `context_window`, `default_version_tag` |
| `company_llm_configs` | `deployment_id`, `default_profile_id` (FK→`ai_execution_profiles` SET NULL) |
| `usage_events` | `execution_profile_id`, `profile_version`, `capability_id`, `resolved_provider`, `fallback_used`, `resolution_source` |

**Deliberately deferred:** the `usage_events` analytics indexes from 2A §7.4 — building an index on the large billing table has no consumer until the observability phase, so it is not created here (keeps 2B.1 a pure, low-risk foundation).

---

## 3. Seed Summary (all INERT — no resolver reads it while flags are OFF)

### Execution Profiles (10, each with an immutable v1 `active` version)
`HIGH_QUALITY`, **`BALANCED` (platform default)**, `ECONOMY`, `JSON_EXTRACTION`, `DEEP_REASONING`, `CREATIVE_WRITING`, `GROUNDED_RESEARCH`, `VISION_ANALYSIS`, `IMAGE_GENERATION`, `MODERATION`. Params mirror today's documented defaults (e.g. BALANCED = temp 0.4 / 2000 tok / 60s / 2 retries; DEEP_REASONING = frontier / 240s; CREATIVE_WRITING = temp 0.7 / streaming). Exact parity vs the legacy path is proven later in the resolver SHADOW phase (2A-2).

### Capability Bindings (17)
1 `platform_default` → `BALANCED`, plus 16 `capability_default` bindings (org_id NULL) covering every `CAPABILITY_REGISTRY` capability + `GENERIC_COMPLETION`:
- writing family (`CONTENT_WRITER`, `CONTENT_CREATOR`, `CONTENT_WRITER_WORKSPACE`, `LONG_FORM_CONTENT`, `CREATOR_ASSET`) → `CREATIVE_WRITING`
- planning (`CAMPAIGN_PLANNER`, `CAMPAIGN_PLAN`) → `DEEP_REASONING`
- analysis/mix/recs (`STRATEGIC_MIX`, `STRATEGIC_MIX_DECISION`, `SEO_INTELLIGENCE`, `GROWTH_INTELLIGENCE`, `RECOMMENDATION_ENGINE`, `RECOMMENDATION_DECISION`, `WEBSITE_INTELLIGENCE`, `GENERIC_COMPLETION`) → `BALANCED`
- `COMPETITOR_INTELLIGENCE` → `GROUNDED_RESEARCH`

### Operation → Capability map (54)
The known gateway operations (recommendations, campaign/daily planning, content generation, blog/newsletter, engagement, creator, company-profile, competitor, chat) each mapped to one capability. Unmapped operations resolve to `GENERIC_COMPLETION` at resolve time (design §5.3).

### Model families + versions
1 family (`gpt-4o` for openai), 2 model versions (one per existing `llm_models` row: `gpt-4o-mini`, `gpt-4o`, `is_default=true`). openai models linked to the family.

### Config version + audit
1 `ai_config_versions` row (version 1); 1 `config_change_logs` row (`config_type='ai_orchestration_seed'`) recording the seed counts.

---

## 4. Compatibility Report — why this phase is backward compatible

1. **Purely additive DDL.** New tables and `ADD COLUMN IF NOT EXISTS` only; no column dropped, renamed, retyped, or constrained-tighter on any existing table. Nullable-no-default columns are catalog-only in PostgreSQL (no table rewrite, no long lock).
2. **No runtime consumer.** No existing code path reads or writes any new table/column in 2B.1. `executeGatewayCompletion`, `resolveLlmConfig`, `resolveEffectiveModel`, `aiCapabilityRuntime`, `resolveTransport`, and the gateway are untouched (verified: no source edits outside the new `aiOrchestration/` module + its test).
3. **Flags default OFF and unconsumed.** The 5 flags are registered for the operator surface only; nothing branches on them yet. `resolveRolloutSync` returns `off` for all five.
4. **Seed is inert reference data.** It changes no existing row's meaning; the only writes to existing tables are (a) the additive nullable columns and (b) a best-effort `model_family_id` linkage on openai models (nullable, ignorable by all current readers) and (c) one audit row.
5. **Idempotent + reversible.** Re-running any migration is a no-op; each has a rollback that returns the schema to its prior state with no data loss to any live feature.

---

## 5. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `usage_events` column-add lock (hot billing table) | Low | Nullable, no-default → metadata-only catalog change (fast); no index built here |
| Circular FK profiles ⇄ versions | Low | `active_version_id` nullable; FK added via guarded `DO $$` block after both tables exist; seed inserts profile → version → repoints |
| Migration ordering / date-prefix collision (known repo hazard) | Low | Placed at `20260906000000+`, strictly after the current max (`20260905000000`) |
| Seed param values not perfectly matching every legacy call-site literal | Low (by design) | Seed is INERT until the resolver; the SHADOW phase (2A-2) compares plan-vs-legacy and reconciles before anything goes authoritative |
| `org_id` / `capability_id` carry no hard FK | Accepted | Deliberate — mirrors existing `company_llm_configs.company_id`; avoids coupling to the org/capability owners (a code registry, not a table) |
| Applying to production | Managed externally | Migrations are authored to convention and **not applied here**; application is via the team's controlled migration process against non-prod first (repo convention: "NOT applied by this change") |

---

## 6. Validation Report

Verified in an **isolated in-process PostgreSQL engine** (PGlite/WASM in the session scratchpad — no daemon, no connection to any live/production database; the only configured DB is production and was never touched). The prerequisite base tables were created from their **real** migrations (`20260508_llm_provider_config.sql`, `20260508_company_llm_configs.sql`, `20260320_admin_config_tables.sql`) plus a minimal `usage_events` stub, then the three new migrations were applied.

**Results (all PASSED):**
- ✅ **Migrations execute successfully** — foundation → extensions → seed applied with no error on top of the real base schema.
- ✅ **Seed is deterministic + correct** — 10 profiles, 10 v1 versions, 17 bindings (1 platform_default + 16 capability_default), 54 operation mappings, 1 model family, 2 model versions, 1 config version, 1 audit row, 6 new `usage_events` columns, `BALANCED.active_version_id` repointed.
- ✅ **Idempotent** — re-running all three forward migrations produced no error and no duplicate rows (profiles still 10, bindings still 17).
- ✅ **Rollback succeeds** — running the three rollbacks in reverse left **0** `ai_*` orchestration tables, **0** of the 6 new `usage_events` columns, and **all 5 base tables intact** (`llm_providers`, `llm_models`, `company_llm_configs`, `usage_events`, `config_change_logs`).
- ✅ **Feature flags default OFF** — `aiOrchestrationFlags.test.ts`: 12/12 passed (all 5 flags registered on the operator surface and resolve to `off`).

**Confirmations:**
- ✓ Existing APIs unchanged — no route file modified.
- ✓ Existing Gateway unchanged — no edit to `aiGatewayCore` / `aiGatewayProviders*` / `executeGatewayCompletion`.
- ✓ Existing Resolver chokepoints unchanged — no edit to `resolveLlmConfig` / `resolveEffectiveModel` / `aiCapabilityRuntime` / `resolveTransport`.
- ✓ Existing UI unchanged — no `.tsx` touched.
- ✓ Existing AI behavior unchanged — no runtime path reads the new schema; all flags OFF and unconsumed.

**Not performed here (by design / safety):** the migrations were **not applied to any real database**. The Docker daemon was unavailable and the only configured DB (`.env.local`) is production, which must never be bulk-migrated. Application to a real environment must go through the team's controlled migration process (non-prod first). The full apply+rollback cycle was instead proven in the isolated WASM Postgres above.

---

## Files delivered

```
supabase/migrations/20260906000000_ai_orchestration_foundation.sql            (+ _rollback)
supabase/migrations/20260906000001_ai_orchestration_extensions.sql            (+ _rollback)
supabase/migrations/20260906000002_ai_orchestration_seed.sql                  (+ _rollback)
backend/services/aiOrchestration/orchestrationFlags.ts
backend/tests/unit/aiOrchestrationFlags.test.ts
```

*Phase 2B.1 complete. Persistence foundation only; no runtime behavior changed. Next: Phase 2A-2 (Configuration Resolver in shadow) — a separate, flag-gated change.*
