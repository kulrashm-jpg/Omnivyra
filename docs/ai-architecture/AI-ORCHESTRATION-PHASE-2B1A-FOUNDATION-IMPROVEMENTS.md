# OmniVYRA — Phase 2B.1A: Foundation Improvements (Resolution Reason & Configuration Fingerprint)

**Scope:** two additive persistence enhancements to the Phase 2B.1 foundation. **No resolver, no gateway change, no routing, no APIs, no UI, no observability, no runtime consumer.** With all `AI_*` flags OFF (default), behavior is byte-identical to today. Both features are dormant.
**Builds on:** [AI-ORCHESTRATION-PHASE-2B1-FOUNDATION.md](AI-ORCHESTRATION-PHASE-2B1-FOUNDATION.md).
**Date:** 2026-07-31.

---

## Architecture Description

### Resolution Reason — purpose, lifecycle, future usage, limitations

**Purpose.** Phase 2B.1 records *where* a configuration came from (`usage_events.resolution_source` ∈ platform_default | org_default | capability_default | capability_override | legacy_hardcoded). Resolution Reason records *why* it was chosen — a richer, explainable model: **`{ category, code, message, detail }`**.

**Model.** A queryable **catalog** of known reason codes (`ai_resolution_reason_codes`) plus three nullable `usage_events` columns to *record* the chosen reason at resolve time in a later phase. The free-form `detail jsonb` carries the placeholders a message template needs (e.g. `{ "provider":"openai", "model":"gpt-4o" }`). Category is a plain TEXT vocabulary (no enum/CHECK) so **new explanations require only a new catalog row — never a schema change.**

**Lifecycle.** (1) *Now (2B.1A):* catalog seeded with the canonical codes; `usage_events` columns added, INERT. (2) *Resolver phase (2A-2/3):* the resolver emits `{category, code, detail}` alongside its plan. (3) *Observability phase:* the reason is written to `usage_events` and surfaced in the admin console ("why did this call run this way?").

**Limitations.** Purely descriptive — a reason never influences a decision. In 2B.1A nothing writes the columns; the catalog is reference data. Message rendering (template + detail → string) is a later, trivial concern, deliberately not built here.

### Configuration Fingerprint — purpose, lifecycle, future usage, limitations

**Purpose.** A deterministic hash of the **effective execution semantics** of an immutable Execution Profile Version, enabling config comparison, audit, cache validation, rollback verification, and execution reproducibility — all keyed off ONE value.

**Single source of truth.** The fingerprint is defined by exactly one implementation — [`backend/services/aiOrchestration/configFingerprint.ts`](../../backend/services/aiOrchestration/configFingerprint.ts) (algorithm tag `sha256:v1`). This deliberately avoids the producer/verifier drift the platform's provider contracts (PB-001..006) guard against. The 10 seed fingerprints baked into the migration were produced by this util, and [`aiConfigFingerprint.test.ts`](../../backend/tests/unit/aiConfigFingerprint.test.ts) recomputes them and asserts equality with the baked SQL — a **seed↔util lock** that makes silent drift impossible.

**Algorithm (documented + tested).**
- **Included (execution semantics only):** `mode`, `quality_tier`, `capability_requirements`, resolved **provider ref** (name, not id), resolved **model ref** (key, not id), `model_version_tag`, `deployment_id`, resolved **routing content** (chain + breaker, not id), `params` (temperature/top_p/max_output_tokens/reasoning_level/seed_policy/…), `modality` (streaming/structured_output/response_format/tool_calling/vision/image_params), `reliability` (timeout_ms/max_retries/retry_policy/circuit_breaker/partial_allowed), `limits` (max_cost_usd_per_call/token_ceiling), `caching` (cacheable/ttl), `safety` **content** (moderation/prompt_injection_guard/resolved policy body).
- **Excluded:** surrogate ids (id, profile_id, provider_id, model_id, model_family_id, routing_policy_id, safety_policy_id), version number, status, created_by, created_at/updated_at, display names, descriptions, all audit fields. *(Id-typed references are excluded, but the resolved CONTENT they point at is included — the caller resolves refs → content before fingerprinting.)*
- **Canonicalization:** object keys sorted recursively (**key-order independent**); array order **preserved** (semantic — a provider fallback chain / stop_sequences reordering is a real change); `null` == absent (dropped). Canonical form = JSON with sorted keys; digest = SHA-256 hex; result = `sha256:v1:<64-hex>`.
- **Versioning:** any change to the field set or canonicalization is a NEW tag (`sha256:v2`), never a silent change — old fingerprints stay comparable.

**Lifecycle.** (1) *Now (2B.1A):* columns `config_fingerprint` + `fingerprint_algo` added to `ai_execution_profile_versions`; the 10 seeded v1 versions backfilled by the util. (2) *Resolver/admin phases:* new/edited profile versions get their fingerprint from the SAME util at write time; equality checks power cache validation, rollback verification ("does the restored version match?"), and diff/audit reports. (3) *Observability:* fingerprint stamped alongside `profile_version` for execution reproducibility.

**Limitations.** No fingerprint is computed at runtime in 2B.1A (no hashing inside any execution path). The fingerprint captures execution *semantics*, not the prompt bytes (prompt-template fingerprinting is a separate, later program). Fingerprints are comparable only within the same `algo` tag.

---

## 1. Migration Summary

Four SQL files (two forward + two matching rollbacks), placed after the 2B.1 migrations. Idempotent, additive, reversible.

| # | File | Purpose |
|---|---|---|
| 1 | `supabase/migrations/20260906000003_ai_orchestration_resolution_reason.sql` | Catalog table `ai_resolution_reason_codes` (+ seed of 14 codes) + 3 nullable `usage_events` columns + RLS |
| 1r | `…_resolution_reason_rollback.sql` | Drop the catalog table + the 3 columns |
| 2 | `supabase/migrations/20260906000004_ai_orchestration_config_fingerprint.sql` | Add `config_fingerprint` + `fingerprint_algo` to `ai_execution_profile_versions`; backfill the 10 seeded v1 versions with util-computed hashes; audit row |
| 2r | `…_config_fingerprint_rollback.sql` | Drop the 2 columns + audit row |

Non-migration files:
- `backend/services/aiOrchestration/configFingerprint.ts` — the single canonical fingerprint util (pure, **dormant** — no runtime consumer).
- `backend/tests/unit/aiConfigFingerprint.test.ts` — util contract + seed↔util lock (18 tests).

---

## 2. Schema Changes

### New table (1)
| Table | Columns | Notes |
|---|---|---|
| `ai_resolution_reason_codes` | `code` PK, `category`, `message_template`, `description`, `is_active`, timestamps | Category is free TEXT (no enum) for zero-schema-change extensibility; RLS enabled; index on `category` |

### Modified tables (2) — all columns nullable, no default, `ADD COLUMN IF NOT EXISTS`
| Table | Added columns |
|---|---|
| `usage_events` | `resolution_reason_code`, `resolution_reason_category`, `resolution_reason_detail` (jsonb) |
| `ai_execution_profile_versions` | `config_fingerprint`, `fingerprint_algo` |

No existing column altered, dropped, retyped, or re-constrained. No existing table's data semantics changed. (Nullable-no-default adds are catalog-only in PostgreSQL — fast, no rewrite.)

---

## 3. Resolution Reason Design

**Structure:** `{ category, code, message_template, detail }`.

- **category** — coarse bucket (`PlatformDefault`, `OrganizationDefault`, `OrganizationOverride`, `CapabilityDefault`, `CapabilityOverride`, `Governance`, `RequestHint`, `Legacy`).
- **code** — stable machine id (PK in the catalog), e.g. `ORG_PINNED_MODEL`.
- **message_template** — human-readable, may contain `{placeholders}`.
- **detail** — free-form `jsonb` supplying placeholder values + context (recorded on `usage_events.resolution_reason_detail`).

**Seeded catalog (14 codes):** `PLATFORM_DEFAULT_APPLIED`, `NO_ORG_OVERRIDE`, `ORG_DEFAULT_APPLIED`, `ORG_PINNED_MODEL`, `CAP_DEFAULT_APPLIED`, `CAP_OVERRIDE_APPLIED`, `CAP_OVERRIDE_STRUCTURED`, `CAP_DEEP_REASONING`, `PLAN_LIMIT_DOWNGRADE`, `BUDGET_DOWNGRADE`, `HINT_STRUCTURED_REQUIRED`, `HINT_VISION_REQUIRED`, `LEGACY_RESOLVER_UNAVAILABLE`, `LEGACY_UNMAPPED_OPERATION`.

**Example (matching the brief):**
```
category: OrganizationOverride
code:     ORG_PINNED_MODEL
message:  "Organization has pinned {provider}/{model}"
detail:   { "organizationId": "…", "provider": "openai", "model": "gpt-4o" }
```

**Generic by construction:** future explanations = one new catalog row + a `code`; the `jsonb detail` absorbs any new metadata with no schema change.

---

## 4. Configuration Fingerprint Design

See the Architecture Description above for the full algorithm. Summary of the persistence:
- `ai_execution_profile_versions.config_fingerprint` (`sha256:v1:<hex>`) + `fingerprint_algo` (`sha256:v1`).
- One canonical util (`configFingerprint.ts`) exports `computeConfigFingerprint`, `extractExecutionSemantics`, `canonicalize`, `canonicalConfigString`, `EXECUTION_SEMANTIC_FIELDS`, `CONFIG_FINGERPRINT_ALGO`.
- The 10 seeded v1 versions are backfilled with util-computed hashes; the test locks seed↔util.

**Seeded fingerprints (v1):**

| Profile | Fingerprint |
|---|---|
| HIGH_QUALITY | `sha256:v1:5b17a0c9…d2b9d3` |
| BALANCED | `sha256:v1:9dbba7cc…c92910` |
| ECONOMY | `sha256:v1:a6a79f9b…6f5680` |
| JSON_EXTRACTION | `sha256:v1:9f2689d3…bc6d95` |
| DEEP_REASONING | `sha256:v1:9060abdf…59024c` |
| CREATIVE_WRITING | `sha256:v1:ca0f3805…902329` |
| GROUNDED_RESEARCH | `sha256:v1:f8ca06f4…d70146` |
| VISION_ANALYSIS | `sha256:v1:8940955a…0370d5` |
| IMAGE_GENERATION | `sha256:v1:c6e55c9b…cd75e2` |
| MODERATION | `sha256:v1:1e17ad3c…5279b938` |

(All 10 distinct — verified in the DB.)

---

## 5. Compatibility Report

1. **Purely additive.** One new table + `ADD COLUMN IF NOT EXISTS` only; no existing column/table/data altered.
2. **No runtime consumer.** The `usage_events` reason columns and the profile-version fingerprint columns are INERT — nothing reads or writes them in 2B.1A. `executeGatewayCompletion`, `resolveLlmConfig`, `resolveEffectiveModel`, `resolveTransport`, `aiCapabilityRuntime`, and the gateway are untouched (git: only new files + the fingerprint test).
3. **The fingerprint util is dormant.** It is imported only by its unit test and was used offline to bake the seed; no execution path imports it.
4. **Existing 2B.1 seed unchanged.** The fingerprint backfill only fills NULL `config_fingerprint` on existing rows; it adds no profile, changes no param, alters no binding/operation-map/version. Verified: after 2B.1A, 2B.1 counts are unchanged (10 profiles intact).
5. **No flag consumption.** No `AI_*` flag is read; all remain OFF.
6. **Idempotent + reversible.** Re-running either migration is a no-op; each rollback returns to the prior state (verified: 2B.1 stays intact after 2B.1A rollback).

---

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Fingerprint producer/verifier drift | Low | ONE util is the source of truth; the seed↔util lock test recomputes all 10 seeds and asserts equality with the baked SQL — CI fails on any drift |
| SQL-vs-JS canonicalization mismatch | Avoided | Fingerprints are computed by the JS util (never in SQL); the migration only stores the util's output |
| `usage_events` column-add lock (hot table) | Low | Nullable, no-default → metadata-only catalog change; no index built |
| Reason-category vocabulary lock-in | Low | Category is free TEXT (no enum/CHECK) — new categories need no migration |
| Fingerprint captures semantics, not prompt bytes | Accepted (by design) | Documented limitation; prompt-template fingerprinting is a separate future program |
| Applying to production | Managed externally | Authored to convention, **not applied here**; controlled migration process, non-prod first |

---

## 7. Validation Report

Verified in an **isolated in-process PostgreSQL engine** (PGlite/WASM in the session scratchpad — no daemon, no connection to any live/production DB; production was never touched). The full base + 2B.1 stack was applied first, then the two 2B.1A migrations.

**Results (all PASSED):**
- ✅ **Migrations apply** — resolution_reason + config_fingerprint applied cleanly on top of 2B.1.
- ✅ **Seed correct** — 14 reason codes; 3 new `usage_events` columns; 2 new `ai_execution_profile_versions` columns; **10 of 10** v1 versions fingerprinted, **all 10 distinct**; the DB-stored BALANCED fingerprint equals the util output (`sha256:v1:9dbba7cc…c92910`).
- ✅ **Idempotent** — re-running both migrations produced no error and no change (14 codes, 10 fingerprints stable).
- ✅ **Rollback succeeds** — reason table gone, all 3 reason columns gone, both fingerprint columns gone; **2B.1 remained fully intact** (10 profiles).
- ✅ **Unit tests: 30/30 passed** — `aiConfigFingerprint.test.ts` (18): determinism, key-order independence, array-order significance, id/timestamp/display exclusion, real-change sensitivity, and the **seed↔util lock** (all 10 baked hashes recomputed and matched in the migration file); `aiOrchestrationFlags.test.ts` (12): unchanged, still green.

**Confirmations:**
- ✓ Existing seed unchanged (2B.1 profiles/bindings/op-map intact).
- ✓ No existing profile behavior changes (fingerprint is metadata only; params untouched).
- ✓ No runtime behavior changes (no consumer; util dormant; flags OFF).
- ✓ No existing tests fail (flags suite still 12/12).
- ✓ Gateway / resolver chokepoints / UI untouched (git shows only new files + the fingerprint test).

**Not performed here (by design / safety):** migrations were **not applied to any real database** (Docker daemon down; the only configured DB is production, which must never be bulk-migrated). Application goes through the team's controlled migration process, non-prod first. The full apply+idempotency+rollback cycle was proven in isolated WASM Postgres above.

---

## Files delivered

```
supabase/migrations/20260906000003_ai_orchestration_resolution_reason.sql     (+ _rollback)
supabase/migrations/20260906000004_ai_orchestration_config_fingerprint.sql    (+ _rollback)
backend/services/aiOrchestration/configFingerprint.ts
backend/tests/unit/aiConfigFingerprint.test.ts
```

*Phase 2B.1A complete. Two dormant foundation improvements; no runtime behavior changed. The fingerprint util is the single source of truth for later phases; the resolution-reason catalog is ready for the resolver to emit against.*
