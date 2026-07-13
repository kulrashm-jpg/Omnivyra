# Content Creator Capability Platform (PMF-004)

Content Creator, executed through the canonical platform as **Creator Capability
Profiles + a platform runtime**, behind a reversible flag. The existing asset
pipeline (LLM blueprint → render → storage → governance) is **unchanged** — it runs
as the generation backend inside the AIC pipeline. Production behaviour is identical
(guaranteed by construction); the platform path is opt-in and defaults off.

## The wiring, not a rewrite

`runCreatorOrchestration` is the single shared façade all three creator origins
converge on (direct API, BOLT runtime, queue worker, + variant fan-out). PMF-004
wires the flag there — one seam migrates every flow.

```
runCreatorOrchestration(input)                     ← default 'legacy' = unchanged
  └─ shouldRunPlatform()?  ── platform ──▶ runCreatorCapability({ assetType, companyId,
                                              generate: () => runCreatorOrchestrationCore(input) })
                                              resolve Creator Capability Profile (config)
                                              executeCapability('CREATOR_ASSET', … , {
                                                modelRunner:  runs the ASSET PIPELINE (backend)
                                                outputParser: returns the EXACT asset result
                                              })
                                              → AIC pipeline: CKC knowledge · validation · telemetry · recovery · output contract
                                              → serve the exact orchestration result (parity)
                                              ↳ SAFETY NET: pipeline didn't complete → run the core directly
                             ── legacy  ──▶ runCreatorOrchestrationCore(input)   (byte-identical)
```

The core orchestration was renamed `runCreatorOrchestrationCore`; the public
`runCreatorOrchestration` is now a thin flag branch. With the default flag it calls
the core directly — byte-identical to before. On the platform path the SAME core
runs inside the AIC pipeline, and its exact result object is captured via closure and
served verbatim (no reshape), with a safety net that runs the core directly if the
AIC pipeline doesn't complete — so the platform path can never be worse than legacy.

## Modules (`backend/services/creatorCapability/`)

| Module | Role |
| --- | --- |
| `creatorCapabilityProfile.ts` | §2 — the Creator Capability Profile schema + registry of 8 asset types + alias-tolerant `profileForAssetType`. |
| `creatorPlatformRuntime.ts` | §2/§4/§5/§6/§11 — executes a profile through AIC with the asset pipeline as backend; closure-capture parity, safety net, telemetry. |
| `creatorMigrationFlag.ts` | §10 — `CREATOR_RUNTIME` = legacy \| platform \| dual (default legacy). |
| `index.ts` | Single import surface. |
| (AIC) `CREATOR_ASSET` capability + `creator_asset` contract | The AIC registration the runtime executes. |
| (wiring) `creatorOrchestrator.ts` | The one flag branch at the shared façade. |

## Capability Profile (§2)

Each profile declares: `id`, `assetType` (selects the pipeline's prompts/layout/
renderer — §7), `knowledge` (CKC consumer/confidence/freshness/mode), `planningStrategy`,
`layoutStrategy`, `validationStrategy`, `brandRules`, `assetRules`, `outputContract`,
`preferredModels`, `fallbackModels`, `timeoutMs`, `retryPolicy`, `approvalRequirements`,
`featureFlags`, `executionMetadata`. The runtime executes the profile —
orchestration is config, not a bespoke per-type flow. **Adding a new asset type =
adding a profile.**

## Registration (§2)

`CREATOR_PROFILES` registers IMAGE, CAROUSEL, INFOGRAPHIC, BANNER, PDF, PRESENTATION,
SOCIAL_GRAPHIC, THUMBNAIL — one registry. `profileForAssetType(assetType)` is the
wiring key and is alias-tolerant (deck→PRESENTATION, thumb→THUMBNAIL, slides→CAROUSEL,
…) to match the pipeline's runtime aliases.

## CKC Adoption (§3)

On the platform path, knowledge is acquired through **AIC's knowledge stage, which is
CKC-001** (`getKnowledgeContext(CONTENT_CREATOR)`): the CKC consumer is consulted,
`consumption.*` events fire, and the consumed **knowledge version** is recorded
(`creator.knowledge_version_usage`). CKC supports domains/confidence/freshness/
language/version/mode via the profile's `knowledge` spec. **Caveat (stated
precisely):** the creator pipeline builds its prompt/render context from a much richer
bespoke source — `resolveCreatorCopyContext` (company profile + brand runtime: brand
kit, visual brand memory, voice, vocabulary, compliance) — than CKC composes;
substituting a CKC-only context would change prompts/renders and therefore generation
quality, violating the zero-quality rule. So the pipeline keeps its exact brand
context while CKC is the versioned knowledge authority for the platform pipeline. Full
context substitution is deferred to a future CKC extension (a CKC change, not a
pipeline change).

## AIC Execution (§4)

All creator AI execution on the platform path runs **through** AIC:
`executeCapability('CREATOR_ASSET', …)` runs the pipeline, and the asset pipeline
performs the actual blueprint LLM call + image render inside the injected
`modelRunner`. AIC owns knowledge, validation, telemetry, recovery, and the output
contract; the pipeline owns prompts + inference + rendering + governance. This is
execution-through-AIC without migrating (rewriting) the inference — the PMF-001/003
injected-runner pattern applied to the asset pipeline. The `CREATOR_ASSET` capability
has lenient validation and disabled recovery (`maxRetries: 0`) so AIC never rejects or
re-runs an asset the legacy path would have returned (the pipeline owns its own
governance/diagnostics/regeneration).

## AIA Adoption (§5)

**Not used for the current inline paths — correctly.** All renderable creator types
run `render_strategy: 'inline'` (a single in-request generation), i.e. a direct AIC
execution — §5 permits single-step generations to remain direct AIC. Profiles that are
multi-stage / review-bearing carry `executionMetadata.multiStep` / `assetReview` +
`approvalRequirements` (e.g. PRESENTATION), so when a workflow needs asset review,
approval, or the durable render queue (`creator-render`), an AIA agent hosts it then —
no redesign, just a profile that flips `assetReview`/`approvalRequirements` and a thin
agent over the existing durable queue.

## Asset Orchestration (§6)

No new asset framework. The existing pipeline is reused end-to-end: generation
(`createCreatorExecutionEngine`), rendering (`renderAsset` / sharp+SVG / OpenAI
images), storage (Supabase, `creatorAssetPersistenceService`), versions/metadata
(`creator_assets`/`creator_asset_attachments`), governance (semantic validation,
enterprise governance hooks), and publishing prep — all via the SAME
`runCreatorOrchestrationCore`. The platform runtime wraps that core; it orchestrates,
it does not re-implement.

## Prompt Preservation (§7)

No prompt is rewritten. Prompt SELECTION moves behind the profile: `assetType` is what
selects the pipeline's existing prompts/templates/layout. The platform `modelRunner`
runs the pipeline, which picks its prompts exactly as today.

## Output Compatibility (§8)

Guaranteed: the exact `CreatorOrchestrationResult` is captured via closure and returned
verbatim (no reshape), so downstream consumers (persistence, lifecycle FSM, governance
hooks, the UI) are unaffected. No compatibility adapter is needed. The safety net
guarantees the platform path always yields at least the legacy result.

## Legacy Retirement (§9)

**None yet — by design.** The flag defaults to `legacy`; the core call remains the
default and the safety net. Nothing is removed. Once `platform` is the confirmed
default and soaked, obsolete legacy branches can be retired — tracked as the
post-parity step.

## Feature Flag (§10) & rollback

`CREATOR_RUNTIME` = `legacy` (default) | `platform` | `dual`. Rollback is a single env
change (or unset) — no code/schema change. `dual` runs the platform path with the core
as the guaranteed fallback for parity validation at zero risk.

## Observability (§11)

`creator.runtime_usage{runtime,assetType}`, `creator.migration_coverage`,
`creator.knowledge_version_usage{version}`, `creator.token_usage{runtime}`,
`creator.asset_quality{outcome}`, `creator.validation_failures`, plus AIC's
`capability.*` and CKC's `consumption.*` on the platform path — all on the existing
telemetry registry (the pipeline's own generation/governance telemetry is unchanged).

## Creating a new Creator capability (future)

1. Add a `CREATOR_PROFILES` entry (id, `assetType`, strategies, brand/asset rules,
   models, timeouts, approval, flags).
2. Ensure the pipeline supports the asset type (existing) — or add its renderer.
3. That's it: the runtime executes the new profile. No new execution flow.

## Tests

- `pmf004CreatorCapability.test.ts` — profiles/registration + aliases, flag, platform
  runtime output parity (exact object identity), observability, determinism, safety net.
- Legacy path (default flag) is covered by the existing creator characterization suites
  running the real `runCreatorOrchestration` — verified green after the rename.
