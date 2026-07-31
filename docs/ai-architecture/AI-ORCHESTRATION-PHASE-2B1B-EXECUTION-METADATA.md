# OmniVYRA — Phase 2B.1B: Execution Metadata Foundation (FINAL persistence phase)

**Scope:** the last persistence phase before the Configuration Resolver. Additive metadata for future explainability/reproducibility only. **No resolver, no gateway change, no routing, no execution change, no APIs, no UI, no observability, no runtime consumer.** With all `AI_*` flags OFF (default), behavior is byte-identical to today. Everything here is dormant.
**Builds on:** [2B.1](AI-ORCHESTRATION-PHASE-2B1-FOUNDATION.md) + [2B.1A](AI-ORCHESTRATION-PHASE-2B1A-FOUNDATION-IMPROVEMENTS.md).
**Status after this phase: the AI Orchestration persistence layer is FROZEN.** All subsequent phases implement behavior only.
**Date:** 2026-07-31.

---

## Architecture Description — the four explainability axes

The orchestration foundation now models four independent, composable axes of "what happened when a call was resolved". Each has its own persisted home:

| Axis | Question | Persisted home | Introduced |
|---|---|---|---|
| **Reason** | **WHY** was it chosen | `ai_resolution_reason_codes` + `usage_events.resolution_reason_*` | 2B.1A |
| **Decision** | **WHAT** was decided | `ai_resolution_decision_codes` | **2B.1B** |
| **Trace** | **HOW** it was resolved (ordered steps) | `ResolutionTrace` contract (type) | **2B.1B** |
| **Fingerprint** | **EXACTLY WHICH** configuration ran | `ai_execution_profile_versions.config_fingerprint` + separated versions | 2B.1A / **2B.1B** |

`ExecutionMetadata` (a type) is the single object that binds all four for a resolved execution. A later phase populates it; nothing does today.

### Fingerprint versioning — separation of concerns
The 2B.1A combined tag `sha256:v1` conflated three independently-evolving concepts. 2B.1B separates them into their own nullable columns so each can version alone:

```
Execution semantics   → execution_schema_version   (which fields are fingerprinted)   = 1
Canonicalization      → canonicalization_version   (key-sort / null-drop / array-order) = 1
Hash algorithm        → fingerprint_algorithm       ('sha256')
```
The legacy `config_fingerprint` (`sha256:v1:<hex>`) and `fingerprint_algo` (`sha256:v1`) columns are **kept, unchanged** (legacy metadata — not removed, not renamed). Relationship (asserted in code + test): `CONFIG_FINGERPRINT_ALGO === '${FINGERPRINT_ALGORITHM}:v${CANONICALIZATION_VERSION}'` → `'sha256:v1'`. **No fingerprint value changed.**

---

## 1. Migration Summary

Four SQL files (two forward + two rollbacks), after the 2B.1A migrations. Additive, nullable, idempotent, reversible.

| # | File | Purpose |
|---|---|---|
| 1 | `…20260906000005_ai_orchestration_fingerprint_version_separation.sql` | Add `execution_schema_version` / `canonicalization_version` / `fingerprint_algorithm` (nullable) to `ai_execution_profile_versions`; seed 1/1/`sha256` for the 10 fingerprinted rows; audit row. **config_fingerprint + fingerprint_algo untouched.** |
| 1r | `…_rollback.sql` | Drop the 3 separated columns + audit row |
| 2 | `…20260906000006_ai_orchestration_decision_catalog.sql` | Create `ai_resolution_decision_codes` (+ seed 18 codes) + index + RLS |
| 2r | `…_rollback.sql` | Drop the decision-catalog table |

Non-migration files:
- `backend/services/aiOrchestration/configFingerprint.ts` — **additively** gains `EXECUTION_SCHEMA_VERSION`, `CANONICALIZATION_VERSION`, `FINGERPRINT_ALGORITHM` constants (no export removed; no hash value changed).
- `backend/services/aiOrchestration/types/ResolutionTrace.ts` — the trace contract (type only, dormant).
- `backend/services/aiOrchestration/types/ExecutionMetadata.ts` — the metadata contract (type only, dormant).
- `backend/tests/unit/aiOrchestrationMetadata.test.ts` — constants + contract smoke + fingerprint-unchanged anchor.

---

## 2. Schema Summary

### New table (1)
| Table | Columns | Notes |
|---|---|---|
| `ai_resolution_decision_codes` | `code` PK, `category`, `message_template`, `description`, `is_active`, timestamps | Free-TEXT category (no enum); RLS enabled; index on `category` |

### Modified table (1) — nullable, no default, `ADD COLUMN IF NOT EXISTS`
| Table | Added columns | Seed |
|---|---|---|
| `ai_execution_profile_versions` | `execution_schema_version` INT, `canonicalization_version` INT, `fingerprint_algorithm` TEXT | 1 / 1 / `sha256` for the 10 fingerprinted v1 rows |

No existing column altered/dropped/renamed/retyped. `config_fingerprint` and `fingerprint_algo` are untouched.

---

## 3. Decision Catalog Summary

Purpose: a queryable catalog of WHAT the resolver decided, so decisions are not hardcoded in logic. 18 seeded codes by category:

- **ProfileSelection:** `SELECT_PROFILE`
- **ProviderSelection:** `SELECT_PROVIDER`
- **ModelSelection:** `SELECT_MODEL`
- **VersionSelection:** `SELECT_MODEL_VERSION`
- **ScopeSelection:** `USE_PLATFORM_DEFAULT`, `USE_ORG_DEFAULT`, `USE_CAPABILITY_DEFAULT`, `USE_OVERRIDE`
- **ModelAdjustment:** `DOWNGRADE_MODEL`, `UPGRADE_MODEL`
- **Routing:** `SELECT_ROUTING_POLICY`
- **Modality:** `ENABLE_STREAMING`, `DISABLE_STREAMING`, `ENABLE_STRUCTURED_OUTPUT`, `ENABLE_VISION`
- **Reasoning:** `ENABLE_REASONING`
- **Fallback:** `FALLBACK_PROVIDER`
- **Legacy:** `LEGACY_SELECTION`

Each carries a `message_template` (with `{placeholders}`) and a `description`. New decisions = one new row (no schema change).

---

## 4. Metadata Contract Summary

**`ResolutionTrace`** (`types/ResolutionTrace.ts`) — the HOW. `ResolutionTrace = { steps: ResolutionTraceStep[]; totalDurationMs? }`; each step = `{ sequence, step, decisionCode?, reasonCode?, source?, metadata?, durationMs? }`. `decisionCode`→decision catalog, `reasonCode`→reason catalog, `source`→`usage_events.resolution_source`. Ordered by `sequence`.

**`ExecutionMetadata`** (`types/ExecutionMetadata.ts`) — the complete, all-optional metadata bound to a resolved execution: profile id/key, profile version, `configFingerprint`, the three separated versions + legacy tag, resolution source/decision/reason(+category)/detail, the `resolutionTrace`, and an optional `executionTimestamp`.

**Relationship:** `ExecutionMetadata` composes the four axes — `resolutionReasonCode` (WHY) + `resolutionDecisionCode` (WHAT) + `resolutionTrace` (HOW) + `configFingerprint`/versions (EXACTLY WHICH CONFIG). Both are **type contracts only** — imported by nothing in 2B.1B, populated by nothing.

---

## 5. Compatibility Report — why runtime remains identical

1. **Purely additive.** One new table + three nullable columns; no existing column/table/data altered.
2. **Fingerprints unchanged.** The version-separation migration only *fills new NULL columns*; it never touches `config_fingerprint` or `fingerprint_algo`. Verified: all 10 fingerprints + the legacy `sha256:v1` tag are byte-identical before/after.
3. **Reason catalog unchanged.** 2B.1A's `ai_resolution_reason_codes` is not referenced by these migrations (still 14 rows).
4. **Util edit is additive.** `configFingerprint.ts` gained three constants; no existing export changed and `computeConfigFingerprint` is byte-for-byte the same (the seed↔util lock test still passes 10/10).
5. **No runtime consumer.** The new table, columns, constants, and both type files are imported by nothing on any execution path. `executeGatewayCompletion`, `resolveLlmConfig`, `resolveEffectiveModel`, `resolveTransport`, `aiCapabilityRuntime`, and the gateway are untouched (git: only new files).
6. **No flag consumption.** All `AI_*` flags remain OFF and unread.
7. **Idempotent + reversible.** Re-running is a no-op; rollback restores the prior state with 2B.1A fully intact.

---

## 6. Risk Assessment

| Risk | Severity | Mitigation / note |
|---|---|---|
| Accidentally changing a fingerprint value | Avoided | Migration writes only new columns; the metadata test asserts the BALANCED fingerprint is unchanged; the seed↔util lock still passes |
| Legacy vs separated versioning divergence | Low | Code asserts `CONFIG_FINGERPRINT_ALGO === '${FINGERPRINT_ALGORITHM}:v${CANONICALIZATION_VERSION}'`; both are `sha256`/`1` today |
| Decision/reason category lock-in | Low | Both catalogs use free-TEXT categories (no enum) — extend by inserting a row |
| Column-add lock on `ai_execution_profile_versions` | Very low | Small table; nullable-no-default = catalog-only change |
| **Future migration considerations (post-freeze)** | — | The persistence layer is now frozen. New execution-affecting fields → bump `execution_schema_version` and mint a new fingerprint `algo` tag (`sha256:v2`), never mutate existing rows. New decisions/reasons → catalog rows, not schema. New trace fields → additive optional fields on the contract. |

---

## 7. Validation Report

Verified in an **isolated in-process PostgreSQL engine** (PGlite/WASM in the session scratchpad — no daemon, no connection to any live/production DB; production was never touched). Full base + 2B.1 + 2B.1A stack applied first, then the two 2B.1B migrations.

**Results (all PASSED):**
- ✅ **Migrations apply** on top of the full prior stack.
- ✅ **Existing fingerprints UNCHANGED** — all 10 `config_fingerprint` values and the legacy `fingerprint_algo='sha256:v1'` are byte-identical before vs after; BALANCED anchor = `sha256:v1:9dbba7cc…c92910`.
- ✅ **Existing reason catalog UNCHANGED** — still 14 codes; the 2B.1B migrations never reference it.
- ✅ **Decision catalog seeded correctly** — 18 codes.
- ✅ **Separated versioning seeded** — 3 new columns; the 10 fingerprinted rows carry `execution_schema_version=1, canonicalization_version=1, fingerprint_algorithm='sha256'`.
- ✅ **Idempotent** — re-running both migrations = no error, no change.
- ✅ **Rollback succeeds** — decision table gone, 3 separated columns gone; **2B.1A fully intact** (fingerprints + legacy tag + 14 reason codes remain).
- ✅ **Unit tests: 35/35 passed** across 3 suites — new `aiOrchestrationMetadata.test.ts` (7: constants, legacy-tag decomposition, fingerprint-unchanged anchor, ResolutionTrace + ExecutionMetadata contract smoke); `aiConfigFingerprint.test.ts` (18, incl. seed↔util lock — still green after the additive util edit); `aiOrchestrationFlags.test.ts` (12).

**Confirmations:**
- ✓ Existing Gateway unchanged.
- ✓ Existing Resolver chokepoints unchanged.
- ✓ Existing Runtime unchanged.
- ✓ Existing UI unchanged.
- ✓ Existing Fingerprints unchanged.
- ✓ Existing Reason Catalog unchanged.
- ✓ No runtime consumer (new table/columns/constants/types imported by nothing on any execution path).
- ✓ Byte-identical behavior (all flags OFF, unread).

**Not performed here (by design / safety):** migrations were **not applied to any real database** (Docker daemon down; the only configured DB is production, which must never be bulk-migrated). Application goes through the team's controlled migration process, non-prod first. The full apply+idempotency+rollback cycle was proven in isolated WASM Postgres above.

---

## Files delivered

```
supabase/migrations/20260906000005_ai_orchestration_fingerprint_version_separation.sql  (+ _rollback)
supabase/migrations/20260906000006_ai_orchestration_decision_catalog.sql                (+ _rollback)
backend/services/aiOrchestration/configFingerprint.ts        (additive: 3 version constants)
backend/services/aiOrchestration/types/ResolutionTrace.ts    (new — contract only)
backend/services/aiOrchestration/types/ExecutionMetadata.ts  (new — contract only)
backend/tests/unit/aiOrchestrationMetadata.test.ts           (new)
```

---

## Persistence layer — FROZEN

With 2B.1 + 2B.1A + 2B.1B applied, the AI Orchestration persistence model is complete and frozen:

- **Config plane:** `llm_providers`/`llm_models`(+family/versions/capability flags)/`company_llm_configs` · `ai_model_families` · `ai_model_versions`
- **Profiles:** `ai_execution_profiles` · `ai_execution_profile_versions` (params/modality/reliability/limits/caching/safety + `config_fingerprint` + separated versioning)
- **Bindings & routing:** `ai_capability_profile_bindings` · `ai_routing_policies` · `ai_operation_capability_map`
- **Explainability catalogs:** `ai_resolution_reason_codes` (WHY) · `ai_resolution_decision_codes` (WHAT)
- **Contracts (code):** `ExecutionSemantics`/fingerprint util · `ResolutionTrace` (HOW) · `ExecutionMetadata`
- **Versioning/audit:** `ai_config_versions` · `config_change_logs` integration
- **Flags:** 5 rollout flags, all OFF

**Next: Phase 2A-2 — the Configuration Resolver in SHADOW mode.** It reads this frozen schema, emits `ExecutionMetadata` + a `ResolutionTrace`, and compares plan-vs-legacy without changing behavior — a separate, flag-gated change. No further schema redesign is required.
