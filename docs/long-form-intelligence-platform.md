# Long-form Intelligence Platform (PMF-002)

The Long-form Content Engine's unique **deterministic intelligence** — extracted
into one registry plus reusable frameworks and AIC integration, **by delegation**.
Every extracted component calls the engine's *existing* function; nothing is
reimplemented, no inference is migrated, and the engine is unchanged. The result:
the engine's private intelligence now also exists as platform-owned, reusable,
AIC-pluggable services. **Zero production behaviour change.**

## Why delegation (not reimplementation)

The prime directive is zero regression / zero quality change. Reimplementing a
validator or scorer risks drift. Instead each platform component is a thin delegate
to the engine's proven function, so behaviour is **identical by construction**
(a test asserts function-reference identity + deep-equal output). The engine keeps
calling its own functions directly; the platform re-surfaces the same functions.

## Modules (`backend/services/longFormIntelligence/`)

| Module | Role |
| --- | --- |
| `intelligenceRegistry.ts` | The canonical registry (§2): 13 catalogued components, each delegating to the engine function; inference boundaries marked `extracted: false`. |
| `planningFramework.ts` | §3 — outline validation (planner stability → planning confidence/metadata) + plan normalization. |
| `qualityFramework.ts` | §4 — content scoring, differentiation, authority/quality evaluation, thought-leadership gate, quality report. |
| `validationFramework.ts` | §5 — deterministic validators (outline, section, duplication, authority, quality) + AIC rule adapters. |
| `repairFramework.ts` | §6 — repair trigger (`scoreNeedsRepair`) + regeneration strategy (`computeAdaptiveRecoveryBudget`). |
| `postProcessingFramework.ts` | §7 — plan sanitization/normalization + quality-metadata generation. |
| `longFormAicIntegration.ts` | §8 — extracted validators as AIC `CapabilityRule`s + the reusable service list. |
| `index.ts` | Single import surface. |

## Registry (§2)

`LONG_FORM_INTELLIGENCE` maps each component id → `{ id, kind, description,
deterministic, extracted, sourceModule, invoke }`. Kinds: `planner | validator |
scorer | detector | repair | post_processing`. `invoke` is a uniform async delegate
to the engine function. Inference-free modules are imported statically; the two
functions that live in inference-bearing modules (`sanitizeContentPlan`,
`validateLongFormQuality`) are loaded lazily, so importing the registry never pulls
the LLM gateway into a consumer.

| Component | Kind | Extracted | Delegates to |
| --- | --- | --- | --- |
| OUTLINE_PLANNER | planner | ❌ (inference boundary) | `generateContentPlan` (LLM) |
| OUTLINE_VALIDATOR | validator | ✅ | `validatePlannerStability` |
| SECTION_VALIDATOR | validator | ✅ | `scoreNeedsRepair` |
| QUALITY_SCORER | scorer | ✅ | `scoreLongFormContent` |
| QUALITY_VALIDATOR | validator | ✅ (lazy) | `validateLongFormQuality` |
| DIFFERENTIATION_SCORER | scorer | ✅ | `scoreDifferentiation` |
| AUTHORITY_VALIDATOR | validator | ✅ | `evaluateLongFormContent` |
| DUPLICATION_DETECTOR | detector | ✅ | `validateContentDuplication` |
| THOUGHT_LEADERSHIP_VALIDATOR | validator | ✅ | `evaluateThoughtLeadershipQuality` |
| SECTION_REPAIR | repair | ❌ (inference boundary) | `repair*Sections` (LLM) |
| REGENERATION_STRATEGY | repair | ✅ | `computeAdaptiveRecoveryBudget` |
| POST_PROCESSING | post_processing | ✅ (lazy) | `sanitizeContentPlan` |
| POST_PROCESSING_STORY | post_processing | ✅ (lazy) | `sanitizeStoryContentPlan` |

## Frameworks (§3–§7)

Each framework is a thin, concern-grouped barrel re-exporting the delegating
callables (typed). They exist so a future capability imports, e.g.,
`repairFramework.computeAdaptiveRecoveryBudget` rather than reaching into the
engine's internals. No logic lives in the frameworks — they are curated views over
the same functions.

## AIC integration (§8)

`longFormAicIntegration` exposes the extracted intelligence to AIC-001 as **optional**
reusable services, without touching the AIC core or the engine:

- `LONG_FORM_INTELLIGENCE_SERVICES` — the extracted components any AIC capability
  can call directly (as tools or scorers).
- `longFormValidationRuleFor(componentId, adapter)` — adapts a deterministic
  validator/detector into an AIC `CapabilityRule` (`(result, ctx) => string | null`)
  that a capability plugs in via `deps.rules`. Rules are **synchronous** and
  **fail-open**: an adapter mismatch or thrown delegate yields `null`, so a rule can
  only *add* a validation signal, never break a capability or change engine output.
- `duplicationCapabilityRule` — a ready-made rule flagging repeated sections in any
  result carrying `content_html`.

## Feature parity (§9)

Guaranteed by delegation: the platform component and the engine share the **same
function object**. Tests assert reference identity (`framework.fn === engine.fn`)
and deep-equal output for the registry `invoke`. No adapter reshapes inputs/outputs
except the AIC rule adapters, which are additive and fail-open.

## Code cleanup (§10)

**None required, by design.** Because extraction is by delegation (not a copy), no
duplicate implementation was created — so there is nothing to delete. The single
implementation stays in the engine and is now also platform-owned. Engine-specific
orchestration (the generation/repair loops) is intentionally left intact.

## Future migration path (→ PMF-003)

The engine's intelligence is now addressable as platform services, so PMF-003 becomes
**wiring, not redesign**:

1. Where the engine calls its intelligence internally, it can (optionally, later) call
   the platform framework instead — a pure import swap with identical behaviour.
2. A future AIC long-form capability composes these services: `OUTLINE_VALIDATOR` +
   `QUALITY_SCORER` + `DIFFERENTIATION_SCORER` + `DUPLICATION_DETECTOR` +
   `THOUGHT_LEADERSHIP_VALIDATOR` as AIC validation rules, `REGENERATION_STRATEGY` as
   its recovery budget, and `POST_PROCESSING` as its output adapter — leaving only the
   two inference boundaries (`OUTLINE_PLANNER`, `SECTION_REPAIR`) to wire to AIC/AIA
   model calls. No intelligence needs to be rebuilt.

## Tests

`backend/tests/unit/pmf002LongFormIntelligence.test.ts` — registry completeness +
boundaries, delegation identity + deep-equal parity, determinism, AIC rule
(flag/clean/fail-open/non-sync), exposed-service invariants.
