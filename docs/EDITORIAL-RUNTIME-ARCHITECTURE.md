# Editorial Runtime Architecture — Snapshot

Lightweight internal snapshot of the long-form editorial advisory architecture.
Every layer below is **advisory-only, non-mutating, non-executing**. No layer
executes validators, enforces outcomes, mutates scores, gates runtime, or
regenerates content.

## Editorial-runtime chain

`observeEditorialDiagnostics` produces the base `EditorialDiagnosticReport`,
then post-generation enrichment attaches the advisory layers below
(`runBlogGeneration.ts`, inside a non-fatal `try/catch`).

## Diagnostic chain

editorial diagnostics → behavioral adherence → quality signals → quality
readiness → remediation hints → remediation plan → regeneration readiness /
candidate / execution manifest → recovery dry-run / executor / verification
contracts → acceptance readiness / review package.

## Normalization chain

validator readiness observation → execution manifest → review sequence →
result contracts → decision preparation → acceptance simulation → recovery
decision sequence → audit trail → review snapshot → coverage ledger →
decision trace → handoff readiness / manifest → execution preparation →
operational readiness → preflight readiness gate → execution adapter contract →
invocation dry-run plan → invocation result contract → output normalization
contract → normalized validator output envelope.

## Governance chain

execution eligibility policy → runtime eligibility interpreter → runtime
readiness envelope → runtime governance envelope → runtime stabilization
envelope.

## Activation-readiness chain

runtime activation readiness gate — consolidates stabilization, governance,
readiness, eligibility, normalization, and decision trace into a single
advisory `activate` / `hold` / `withhold` recommendation. Final advisory
checkpoint before any execution-adjacent work.

## Content-type compatibility layer

`crossContentTypeEditorialCompatibility.ts` — advisory capability matrix for
blog / article / guide / newsletter / story / long-form-educational
(case-study isolation deferred). Contract-only: narrative-stage allowances,
section density, depth / authority / anti-repetition / transition expectations.

## Compression / compaction flow

- `editorialRuntimeCompression.ts` — interns repeated advisory fragment arrays
  into a shared pool; loss-free `expand` for debug. Non-mutating view only.
- `editorialDiagnosticCompaction.ts` — interns repeated diagnostic indicator /
  drift / risk arrays; produces a compact projection + serializer. Never edits
  the source report.
- `editorialPromptBudgetGuard.ts` — measures editorial context size, duplicated
  payload, repeated fragments, oversized segments; emits advisory warnings
  only. Never truncates, gates, or mutates prompts.

## Deferred (NOT implemented)

validator execution, enforcement, runtime gating, regeneration, score
mutation, semantic / vector / embedding scoring, adaptive correction, real
acceptance logic, runtime activation execution.

## Operational prerequisite

Before any concurrency / runtime-validator phase: `REDIS_URL` must move from
`redis://` to `rediss://` (Upstash TLS) and concurrency stability must be
verified.
