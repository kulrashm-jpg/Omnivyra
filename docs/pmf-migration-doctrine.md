# Platform Migration Doctrine (PMF-001)

The canonical guide for migrating a product module onto the Omnivyra platform
(CKC-001 knowledge, AIC-001 execution, AIA-001 agents). Content Writer is the
first migration and the reference blueprint. **Every future module migration
follows this doctrine.**

## Prime directive

**Zero regressions, zero feature loss, reversible at every step.** The new runtime
becomes the default *only after parity is confirmed*. If a responsibility cannot be
migrated without feature loss, it is migrated *incrementally* (knowledge first, then
inference) and the gap is documented — never forced.

## The 8-step migration recipe

1. **Inventory** the module's AI execution path — entry points, knowledge
   acquisition, prompt assembly, inference call, validation, retry, response shape,
   billing, queues. Do not redesign. (PMF §1.)
2. **Map** each responsibility to its platform home (§2 table below). Anything with
   no platform home stays put and is documented.
3. **Single-source the prompt.** Extract inline prompt/spec strings into one module
   both the legacy path and the migrated capability import — a *verbatim* move so
   generation behavior is unchanged. This removes duplicate prompt assembly up front.
4. **Adopt CKC** for knowledge behind a compatibility adapter that reproduces the
   legacy context shape (same fields, order, labels). CKC reads the same columns, so
   values match; an ACTIVE knowledge version is an improvement, guarded by the flag.
5. **Adopt AIC** for inference: register a capability and route the model call
   through `executeCapability`, injecting the **exact** legacy prompt (`promptAssembler`),
   the **exact** legacy model/operation/temperature (`modelRunner`), and the legacy
   output parsing (`outputParser`). Validation is tuned so the migrated path never
   rejects an output the legacy path would have returned.
6. **Gate with a reversible flag** (`<MODULE>_RUNTIME` = `legacy | platform | dual`,
   default `legacy`). `dual` serves legacy and shadow-runs platform for parity.
7. **Preserve the envelope**: billing (`runAiExecution`), permissions, queues,
   post-processing, and the response shape stay exactly as they were; only the two
   inner seams (knowledge, inference) move.
8. **Prove parity, then flip.** Tests for parity/CKC/AIC/output/flag/rollback; run
   `dual` in production; flip default to `platform`; then remove the legacy seam.

## §2 — Responsibility → platform mapping (Content Writer)

| Legacy responsibility | Migrated to | How |
| --- | --- | --- |
| Knowledge (`getProfile` + `buildCompanyContext`) | **CKC-001** | `getContentWriterKnowledge` → `getKnowledgeContext(CONTENT_WRITER)`; `knowledgeToBrandContext` reproduces the legacy lines. |
| Prompt assembly (inline in route) | **Capability Registry + shared source** | `workspaceContentPrompt.ts` (verbatim); injected `promptAssembler`. |
| Inference (`runCompletionWithOperation`) | **AIC-001** | `executeCapability('CONTENT_WRITER_WORKSPACE', …)` with an injected `modelRunner` that makes the byte-identical gateway call. |
| Validation / JSON parse | **AIC-001 validation** + injected `outputParser` | lenient (no confidence/grounding gate) so no output is newly rejected. |
| Retry / recovery | **AIC-001 recovery** | deterministic; `maxRetries` tuned, no model fallback (parity). |
| Telemetry | **HARDEN-001 registry** | `capability.*`, `consumption.*`, `contentwriter.runtime_usage`. |
| Events | **AUTH-001 envelope** | `capability.*` + `consumption.*` flow automatically. |
| Billing | **unchanged** (`runAiExecution`, `content_basic`) | the executor now calls the migrated function; billing scope identical. |
| Permissions | **unchanged** (`enforceCompanyAccess`) | untouched. |
| Post-processing (`processContent`) | **unchanged, shared** | applied in the route for both runtimes (resume-safe). |
| Queue/inline execution | **unchanged** | still inline inside the request. |

## Compatibility & rollback

- **Output contract:** the response (`{ variants }`) is byte-shape-identical. The
  migrated path returns the same raw platform→content map; `processContent` runs
  identically afterward. A parity comparator (`compareVariantParity`) backs `dual`.
- **Rollback:** set `CONTENT_WRITER_RUNTIME=legacy` (or unset) — one env change,
  no code/schema change, full revert. The legacy inference path remains intact
  behind the flag.
- **Value parity:** CKC composes from the same `company_profiles` columns
  `buildCompanyContext` read, so the brand-context block is identical when the live
  profile is the active knowledge; a captured ACTIVE version is a deliberate,
  flag-guarded improvement.

## Lessons learned (for the next migration)

1. **Extend the platform additively, not the module.** AIC gained optional
   `promptAssembler`/`outputParser` deps (defaults preserved) so a migrated module
   supplies its exact prompt — no AIC behavior change, all existing callers unaffected.
2. **Keep the billing/permission/queue envelope untouched.** Migrate only the two
   inner seams (knowledge, inference); wrap them in the existing envelope.
3. **Single-source the prompt first.** It removes the biggest duplication safely and
   guarantees the legacy and migrated prompts can't drift.
4. **Tune capability validation to "never newly reject."** The platform's generic
   validators must not fail outputs the legacy path accepted.
5. **Not everything migrates at once.** Complex, domain-validated engines (see below)
   migrate knowledge-first; their bespoke validation/repair is preserved until it has
   a platform home. Document the deferral precisely.

## Scope note — the long-form engine

The inventory found two Content Writer engines: the one-shot **workspace/platform
writer** (migrated here, end-to-end) and the **long-form blog/article engine**
(`runUnifiedLongFormGeneration`). The long-form engine is a multi-step orchestration
with domain-specific gates (planner stability, differentiation scoring, duplication
gate, thought-leadership quality gate) and repair loops that AIC's generic pipeline
does not replicate. Migrating its inference wholesale would **lose those features**,
violating the prime directive. Per this doctrine it migrates **incrementally**: adopt
CKC for its knowledge seam first (the `contentWriterKnowledge` adapter is reusable for
`buildContentContext`), then move each inference call under AIC only once its
surrounding gate has a platform home (as an AIA agent step or an AIC validator).
That work is a separate mission, not forced here.

## Reusable assets produced

- `backend/services/contentWriter/contentWriterMigrationFlag.ts` — the flag pattern.
- `backend/services/contentWriter/contentWriterKnowledge.ts` — CKC→context adapter pattern.
- `backend/services/contentWriter/contentWriterCapability.ts` — injected prompt/model/parser pattern.
- AIC `promptAssembler`/`outputParser` deps — the migration seam every module reuses.
