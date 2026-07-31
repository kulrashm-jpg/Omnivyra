# OmniVYRA — Phase 2A-2.2: Execution Equivalence Validation

**Scope:** prove, evidence-based, that the resolver's execution semantics equal legacy's — *before* the resolver is ever made authoritative. Verification only. **No execution behavior changes, no gateway edit, no routing/provider/persistence/schema changes. Resolver stays shadow-only.** All new code is pure. Gated OFF by default → byte-identical to today.
**Builds on:** [2A-2](AI-ORCHESTRATION-PHASE-2A2-CONFIGURATION-RESOLVER-SHADOW.md) + [2A-2.1](AI-ORCHESTRATION-PHASE-2A2.1-SHADOW-WIRING.md).
**Date:** 2026-07-31.

> **No execution-path edit this phase.** The 2A-2.1 fire-and-forget hook already invokes the shadow runner; 2A-2.2 only extends the *downstream pure logic* it calls (snapshot builder, comparator, metrics). `git status` shows the only modified existing file is still `aiGatewayProvidersOps.ts` from 2A-2.1 — unchanged here.

---

## 1. ExecutionSnapshot Architecture

The question moves from *"are these fields equal?"* to *"would these two configs EXECUTE identically?"*. The answer is built on a **canonical ExecutionSnapshot** — a normalized, provider-agnostic view of a configuration's execution semantics.

```
LegacyExecutionConfig ──rawConfigFromLegacy──┐
ResolvedExecutionPlan ──rawConfigFromPlan────┤
                                             ▼
                                RawExecutionConfig  (raw values; null ≠ undefined)
                                             │  ExecutionSnapshotBuilder.build (normalize)
                                             ▼
                                    ExecutionSnapshot  (canonical execution meaning)
                                             │  ExecutionSnapshotHasher.hash (execution fields only → SHA-256)
                                             ▼
                                    snap:v1:<hex>   →  quick semantic equality
```

**Two field sets:** `EXECUTION_FIELDS` (24 — provider, model, version, deployment, temperature, topP, penalties, maxOutputTokens, streaming, structuredOutput, vision, reasoning, responseFormat, toolCalling, timeout, retries, retryPolicy, routingPolicy, safetyPolicy, cachePolicy, seedPolicy, costLimit, tokenLimit) participate in the hash + equivalence. `PROVENANCE_FIELDS` (6 — executionProfile, executionProfileVersion, configurationFingerprint, executionSchemaVersion, canonicalizationVersion, fingerprintAlgorithm) are carried for logging/identity but **excluded** from equivalence (a legacy call has no profile/fingerprint — comparing identity would spuriously force DIFFERENT).

New file: `backend/services/aiOrchestration/executionSnapshot.ts` — the one new pure abstraction (`ExecutionSnapshotBuilder`) + the pure `ExecutionSnapshotHasher`.

---

## 2. Normalization Rules (deterministic, documented — no heuristics)

Applied per field by `normalizeField(field, value)`:

1. **Strings** trimmed; empty string → treated as unset.
2. **Provider** mapped through the **PB-006 identity map** (`chatgpt`→`openai`, `claude`→`anthropic`; other aliases lowercased) — a documented, deterministic mapping, not a guess. So an alias and the canonical id agree.
3. **null / undefined / empty** → the **documented default** for that field, else the `UNSET` sentinel. Defaults (`NORMALIZATION_DEFAULTS`) are the clearly-documented platform defaults only: `streaming/structuredOutput/vision/toolCalling` = `false` (absent modality = off). No provider-specific default temperatures/tokens are invented (that would be a heuristic) — every other UNSET stays UNSET (conservative → surfaces the diff rather than hiding it).
4. **Objects** → canonical (sorted keys, null dropped, array order preserved — reusing the 2B.1A `canonicalize`). An **empty policy object → UNSET** (`{}` carries no execution meaning, so it agrees with "omitted").

Versioned by `NORMALIZATION_VERSION` (=1) and the hash tag `snap:v1` — any rules change is a new version, never a silent collision.

---

## 3. Snapshot Builder Summary

`ExecutionSnapshotBuilder.build(raw)` → an `ExecutionSnapshot` covering every EXECUTION + PROVENANCE field, each normalized by the rules above. Adapters `fromPlan(plan)` / `fromLegacy(legacy)` map the two sources into a common `RawExecutionConfig` first (empty policy objects dropped at the raw layer so `{}` and "omitted" agree). Pure; deterministic; no I/O.

---

## 4. Snapshot Hashing Summary

`ExecutionSnapshotHasher.hash(snapshot)` = `snap:v1:<64-hex>` = SHA-256 over canonical JSON of the **EXECUTION subset** (provenance excluded). Deterministic and machine-independent. Purpose: a single-value semantic-equality check. **Not persisted; not logged by default** (only the boolean `snapshotHashMatch` appears in the debug summary).

---

## 5. Equivalence Classification Summary

Binary parity is replaced by three evidence-based levels (`compareExecutionEquivalence(legacy, plan)`):

| Level | Meaning |
|---|---|
| **IDENTICAL** | raw AND normalized identical on every execution field |
| **SEMANTICALLY_EQUIVALENT** | normalized identical (hashes match) but some **raw** representations differ — null vs undefined, provider alias vs canonical id, explicit vs implicit default |
| **DIFFERENT** | a normalized execution field differs |

Per-difference categories: `NORMALIZATION_DIFFERENCE` (raw differs, normalized same), `CONFIGURATION_DIFFERENCE` (one side specifies a field the other leaves unset), `EXECUTION_DIFFERENCE` (both set, values differ). Reserved (documented, not yet assigned): `SEMANTIC_DIFFERENCE`, `UNSUPPORTED_DIFFERENCE`, `UNKNOWN_DIFFERENCE`.

---

## 6. Comparator Enhancements

`ResolverComparator` gains `compareExecutionEquivalence` (the field-parity `compareToLegacy` is retained, unchanged). It returns an `EquivalenceResult`:
```
{ level, reason,
  snapshotHashLegacy, snapshotHashResolver, snapshotHashMatch,
  rawDiffs[ {field, legacy, resolved, category} ],
  normalizedDiffs[ {field, legacy, resolved, category} ],
  rawDifferenceCount, normalizedDifferenceCount,
  executionDifferenceCount, normalizationDifferenceCount }
```
It builds both snapshots, diffs raw + normalized per execution field, hashes both, classifies each diff, and derives the level. Pure; deterministic; never throws; never touches execution.

---

## 7. Metrics Summary

`resolverShadowMetrics` extended (in-memory only, no persistence): `identical`, `semanticallyEquivalent`, `different`, `snapshotHashMatches`, `snapshotHashMismatches`, `normalizationDifferences`, `executionDifferences`, and a `differenceCategories` map. `recordEquivalence(result)` updates them from each shadow observation.

**Historical validation report** (`getEquivalenceValidationReport()`, in-memory, derived): `{ requestsObserved, identical, semanticallyEquivalent, different, snapshotHashMatchRate, topDifferenceCategories[] }`. Surfaced through existing debug diagnostics only — no dashboards, APIs, or monitoring.

Shadow debug log gains a **summary** (never snapshot contents): `equivalence`, `snapshotHashMatch`, `rawDiffs`, `normalizedDiffs`, `executionDiffs` — alongside the 2A-2.1 parity line. Never logs prompts/outputs/PII.

---

## 8. Compatibility Report

1. **No execution-path edit** — the only modified existing file remains `aiGatewayProvidersOps.ts` from 2A-2.1 (untouched here). Everything 2A-2.2 added is new files or additive extensions inside the untracked `aiOrchestration/` dir.
2. **Pure + shadow-only** — the snapshot builder, hasher, comparator extension, and metrics are pure; they run only inside the already-gated, fail-safe, fire-and-forget shadow runner (flag OFF by default → they never execute).
3. **Reuses, does not redesign** — `ConfigurationResolver`, `ResolvedExecutionPlan`, `ExecutionMetadata`, `ResolutionTrace`, `ResolverComparator` (extended, not replaced), shadow runner, shadow metrics — all intact. Exactly one new pure abstraction (`ExecutionSnapshotBuilder`) + one pure utility (`ExecutionSnapshotHasher`).
4. **No persistence / schema / routing / provider / flag-default change.** No migration; no snapshot/hash/report persisted; `AI_CONFIG_RESOLVER_ENABLED` not enabled.
5. **Deterministic + evidence-based** — every normalization rule is a documented, versioned transform; no heuristics or probabilistic equivalence.

---

## 9. Validation Report

**Unit/integration tests: 85/85 passed** (81 across the 6 orchestration suites + the gateway-barrel integration).

New `aiExecutionEquivalence.test.ts` (16):
- ✅ **Builder + hasher pure/deterministic** — same input → identical snapshot + hash; hash format `snap:v1:<64hex>`; hash excludes provenance.
- ✅ **Normalization rules** — null/undefined → UNSET; modality flags default false; provider aliases (`chatgpt`→`openai`, `claude`→`anthropic`) + trim; empty policy object → UNSET.
- ✅ **Three levels (the brief's cases):** identical → `IDENTICAL`; null vs undefined → `SEMANTICALLY_EQUIVALENT`; explicit vs implicit default → `SEMANTICALLY_EQUIVALENT`; provider alias → `SEMANTICALLY_EQUIVALENT`; different provider / timeout / retries → `DIFFERENT`.
- ✅ **Classification** — provider diff = `EXECUTION_DIFFERENCE`; one-side-unset = `CONFIGURATION_DIFFERENCE`; alias = `NORMALIZATION_DIFFERENCE`.
- ✅ **Determinism** — repeated runs identical.
- ✅ **Metrics + report** — counters + `snapshotHashMatchRate` + top categories.

Regression: `aiResolverShadowWiring` (updated metrics-shape assertion), `aiConfigurationResolver`, `aiOrchestrationMetadata`, `aiConfigFingerprint`, `aiOrchestrationFlags` — all green. Integration `defineTargetCustomerCompletionPilot` (4) passes → gateway barrel loads the extended modules and flag-OFF behavior is byte-identical.

**Confirmations:** ✓ no runtime behavior change · ✓ gateway byte-identical · ✓ existing orchestration suites green · ✓ no persistence · ✓ resolver reproducible · ✓ snapshot hashes + normalization deterministic.

---

## 10. Operational Readiness Assessment

**Exit criteria for enabling `AI_CONFIG_RESOLVER_ENABLED` (Phase 2A-3) — measured, not assumed:**

| Criterion | How it is met / measured |
|---|---|
| No unexplained DIFFERENT results | `getEquivalenceValidationReport().different` with `topDifferenceCategories` — every `EXECUTION_DIFFERENCE` must be understood; `CONFIGURATION_DIFFERENCE` (resolver specifies a field a legacy call-site left unset, e.g. profile-driven `maxOutputTokens`/`timeout`) is expected and documented, not a regression |
| Semantic differences documented | `SEMANTICALLY_EQUIVALENT` is driven only by the documented normalization rules (null/undefined, alias, modality default) — each is in §2 |
| Normalization rules stable | Versioned (`NORMALIZATION_VERSION`/`snap:v1`); a change mints a new version, never a silent shift |
| Snapshot hashes deterministic | Proven by tests; machine-independent SHA-256 over canonical JSON |
| Resolver reproducible | 2A-2 determinism tests + these equivalence tests |

**Recommended operation:** enable `AI_CONFIG_RESOLVER_SHADOW` in a non-prod (then canary prod) environment; watch `getEquivalenceValidationReport()` — a high `identical + semanticallyEquivalent` share with only well-understood `EXECUTION_DIFFERENCE`/`CONFIGURATION_DIFFERENCE` categories is the green light. **Do not** enable `AI_CONFIG_RESOLVER_ENABLED` until the DIFFERENT set is fully explained. This phase gives the evidence instrument; the decision remains gated and manual.

---

## Files delivered

```
backend/services/aiOrchestration/executionSnapshot.ts          (new — ExecutionSnapshotBuilder + ExecutionSnapshotHasher)
backend/services/aiOrchestration/resolverComparator.ts         (extended — compareExecutionEquivalence + 3-level types)
backend/services/aiOrchestration/resolverShadowMetrics.ts      (extended — equivalence counters + validation report)
backend/services/aiOrchestration/resolverShadow.ts             (extended — record equivalence + summary log)
backend/tests/unit/aiExecutionEquivalence.test.ts              (new)
backend/tests/unit/aiResolverShadowWiring.test.ts              (updated metrics-shape assertion)
```

*Phase 2A-2.2 complete. Execution equivalence is now measured through canonical snapshots — deterministic, evidence-based, shadow-only, zero behavioral change and no execution-path edit. The resolver can be evaluated for authoritative promotion (Phase 2A-3) on evidence, not assumption.*
