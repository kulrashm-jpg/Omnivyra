# Long-form Capability Platform (PMF-003)

The Long-form Content Engine, executed through the canonical platform as a
**Capability Profile** + a platform **runtime**, behind a reversible flag. The
engine's prompts, inference, quality gates, and repair loops are **unchanged** —
they run as the inference backend inside the AIC pipeline. Production behaviour is
identical (guaranteed by construction); the platform path is opt-in and defaults
off.

## The wiring, not a rewrite

PMF-002 turned the engine's deterministic intelligence into platform services.
PMF-003 wires the engine into the platform:

```
runManagedContentGeneration(input, contentType)      ← default 'legacy' = unchanged
  └─ shouldRunPlatform()?  ── platform ──▶ runLongFormCapability({ engineContentType, engineRequest, companyId })
                                              resolve Capability Profile (config)
                                              executeCapability('LONG_FORM_CONTENT', … , {
                                                modelRunner:  runs the ENGINE (inference backend)
                                                outputParser: returns the EXACT engine object
                                              })
                                              → AIC pipeline: CKC knowledge · validation · telemetry · recovery · output contract
                                              → serve the exact engine result (parity)
                                              ↳ SAFETY NET: pipeline didn't complete → run engine directly
                             ── legacy  ──▶ runUnifiedLongFormGeneration(engineRequest)   (byte-identical)
```

Key property: the engine result is captured via **closure** and served verbatim —
no JSON round-trip, no reshaping — so the platform path is byte-identical to legacy
on success, and the **safety net** runs the engine directly on any pipeline hiccup,
so it can never be worse than legacy.

## Modules (`backend/services/longFormCapability/`)

| Module | Role |
| --- | --- |
| `longFormCapabilityProfile.ts` | §1/§2 — the Capability Profile schema + registry of all 10 long-form types. |
| `longFormPlatformRuntime.ts` | §1/§4/§5/§6/§11 — executes a profile through AIC, with the engine as inference backend, closure-capture parity, safety net, and telemetry. |
| `longFormMigrationFlag.ts` | §10 — `LONG_FORM_RUNTIME` = legacy \| platform \| dual (default legacy). |
| `index.ts` | Single import surface. |
| (AIC) `LONG_FORM_CONTENT` capability + `long_form` contract | The AIC registration the runtime executes. |

## Capability Profile (§1)

Each profile declares: `id`, `engineContentType` (selects the engine's existing
prompts — §7), `knowledge` (CKC consumer/confidence/freshness/mode), `planningStrategy`,
`validationStrategy`, `repairStrategy`, `qualityGates`, `postProcessing` (all by
PMF-002 component id), `outputContract`, `preferredModels`, `fallbackModels`,
`timeoutMs`, `retryPolicy`, `approvalRequirements`, `featureFlags`, and
`executionMetadata`. The runtime executes the profile — orchestration is config, not
hardcoded. **Adding a new long-form type = adding a profile.**

## Registration (§2)

`LONG_FORM_PROFILES` registers BLOG, ARTICLE, GUIDE, NEWSLETTER, CASE_STUDY,
WHITEPAPER, LANDING_PAGE, PILLAR_PAGE, STORY, EBOOK — one registry, no scattered
registrations. `profileForEngineContentType(engineContentType)` is the wiring key.

## CKC adoption (§3)

On the platform path, knowledge is acquired through **AIC's knowledge stage, which
is CKC-001** (`getKnowledgeContext(CONTENT_WRITER)`): the CKC consumer is consulted,
consumption events fire, and the knowledge **version consumed** is recorded
(`longform.knowledge_version_usage`). CKC supports domains/confidence/freshness/
language/version/token-mode via the profile's `knowledge` spec. **Caveat (stated
precisely):** the engine's prompt consumes a ~40-field company-profile projection
that is richer than CKC's composed subset; feeding a CKC-only context to the engine
would change the prompt and therefore generation quality, violating the
zero-quality-change rule. So the engine keeps receiving its exact context while CKC
is the versioned knowledge authority for the platform pipeline. Full context
substitution is deferred until CKC exposes the engine's full field set (a CKC
extension, not an engine change).

## AIC execution (§4)

All long-form inference on the platform path executes **through** AIC:
`executeCapability('LONG_FORM_CONTENT', …)` runs the pipeline, and the engine
performs the actual generation inside the injected `modelRunner`. AIC owns knowledge,
validation, telemetry, recovery, and the output contract; the engine owns prompts +
inference + its own multi-step quality/repair. This is execution-through-AIC without
migrating (rewriting) the inference — exactly the PMF-001 injected-runner pattern
applied to a multi-step engine.

## PMF-002 integration (§5)

The profile references the extracted intelligence by component id
(`OUTLINE_VALIDATOR`, `QUALITY_SCORER`, `DIFFERENTIATION_SCORER`,
`DUPLICATION_DETECTOR`, `THOUGHT_LEADERSHIP_VALIDATOR`, `REGENERATION_STRATEGY`,
`POST_PROCESSING`, …). These are the SAME functions the engine already runs
internally (PMF-002 delegation), so referencing them adds no duplicate logic and
changes no behavior. The platform can additionally surface them as AIC validation
rules for observability without altering the engine's output.

## AIA adoption (§6)

**Not used — correctly.** The primary long-form path runs inline as a single
(multi-internal-step) generation, i.e. a single AIC execution. §6 explicitly allows
single-step generations to remain direct AIC executions. The profile carries
`approvalRequirements` and `executionMetadata.multiStep`, so if long-form later
becomes a queued/approval/resumable workflow, an AIA agent hosts it then — no
redesign, just a profile that flips `approvalRequirements.required` and a thin agent.

## Prompt preservation (§7)

No prompt is rewritten. Prompt SELECTION moves behind the profile: the profile's
`engineContentType` is what selects the engine's existing prompts. The platform
`modelRunner` runs the engine, which picks its prompts exactly as today.

## Output compatibility (§8)

Guaranteed: the exact engine result object is captured via closure and returned
verbatim (no serialization). No compatibility adapter is needed because nothing is
reshaped. The safety net guarantees the platform path always yields at least the
legacy result.

## Legacy retirement (§9)

**None yet — by design.** The flag defaults to `legacy`; the platform path becomes
default only after parity is validated in `dual`. The legacy engine call remains the
default and the safety net, so nothing is removed. Once `platform` is the confirmed
default and soaked, the legacy branch in `runManagedContentGeneration` (and the blog
route) can be retired — a one-line change, tracked as the post-parity step.

## Feature flag (§10) & rollback

`LONG_FORM_RUNTIME` = `legacy` (default) | `platform` | `dual`. Rollback is a single
env change (or unset) — no code/schema change. `dual` runs the platform path with the
legacy engine as the guaranteed fallback for parity validation at zero risk.

## Observability (§11)

`longform.runtime_usage{runtime,contentType}`, `longform.migration_coverage`,
`longform.knowledge_version_usage{version}`, `longform.token_usage{runtime}`,
`longform.quality_gate{outcome}`, `longform.validation_failures`, plus AIC's
`capability.*` and CKC's `consumption.*` on the platform path — all on the existing
telemetry registry.

## Creating a new long-form capability (future)

1. Add a `LONG_FORM_PROFILES` entry (id, `engineContentType`, strategies, models,
   timeouts, approval, flags).
2. Ensure the engine supports the content type (existing) — or map to the closest.
3. That's it: the runtime executes the new profile. No new execution flow.

## Wiring the remaining entry point

`runManagedContentGeneration` (article/guide/story/whitepaper managed path) is wired.
The blog route (`pages/api/blogs/generate.ts`) calls `runUnifiedLongFormGeneration`
directly; wiring it is the identical one-line flag branch — deferred here to keep the
first wiring to the safe 20-line wrapper, and enabled the same way when parity is
validated.

## Tests

- `pmf003LongFormCapability.test.ts` — profiles/registration, flag, platform-runtime
  output parity (exact object identity), observability, determinism, safety net.
- `pmf003Wiring.test.ts` — managed wrapper flag branch (legacy engine vs platform runtime).
