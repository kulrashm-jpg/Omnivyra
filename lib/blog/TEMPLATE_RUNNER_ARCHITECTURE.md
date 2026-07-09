# runTemplateBlogGeneration — Architecture & Change-Safety Contract

_Audited 2026-07-09. Covers `lib/blog/runTemplateBlogGeneration.ts` (1,498 LOC) —
the template-driven generation runner for blog / newsletter / article / guide /
story / whitepaper content._

## Classification

`runTemplateBlogGenerationPath`: **Orchestrator** (AI-call sequencing + repair
state machine). Pure analysis/repair/scoring helpers were already extracted to
`runBlogGenerationPureHelpers.ts`; prompt building + output parsing live in
`blogGenerationEngine` (dynamic import); the four dedicated template runners
(classic/tutorial/comparison/editorial) are separate modules.

## Execution pipeline (order is behavior — do not reorder)

```
identity assembly (answers > profile fetch; pain-point extraction from
must_include_points) → repair anchor + enforcement prefix → template-type flag
matrix (~20 flags from contentType × normalized template name × formatType)
→ DEDICATED RUNNER DISPATCH (classic → tutorial → comparison → editorial;
  each: run → injectInternalLinks → hook check → RETURN; any throw/null
  FALLS OPEN to the shared path — fail-open is the contract)
→ SHARED TEMPLATE PATH:
  system prompt (buildTemplateAwareSystemPromptV2 wrapped with identity lock /
  anti-generic rules; governance preamble prepended — no-op when absent)
  → AI call #1 (operation 'blogGeneration', gpt-4o, temp 0.5, json_object)
  → parseTemplateResult (fence-strip → JSON.parse → parseTemplateOutput with
    flexible block keys: blocks|template_blocks|filled_blocks|content_blocks|content;
    blocks merged into template BY INDEX, ids preserved)
  → IF targetWc ≥ 300: best-candidate retry/repair state machine —
    candidateScore (word count + paragraph depth − thin/empty penalties −
    block-count mismatch ×250), needsRetry loop with retry AI call, classic
    structured repair, template structured repair, focused repair, second
    structured repair, paragraph deepening (deepenTemplateParagraphsIndividually)
    — each best-effort (try/catch), each may consume an AI call
  → managed-longform rejection gate (article/guide/story/whitepaper below
    88% of target or with thin/empty blocks ⇒ fall through to standard HTML)
  → injectInternalLinks → company-context enforcement gate (only when an
    identity exists AND paragraph text > 200 chars: scoreCompanyContext ≥
    dynamic threshold, section-level context + strategy checks — failure
    THROWS CompanyContextEnforcementError, it does not fall through)
  → hook strength check (best-effort) → result envelope
→ parse failure at any point where tplParsed is null ⇒ RETURN NULL
  (caller falls through to standard HTML generation — the null contract)
```

## Boundaries & side effects

AI: `runCompletionWithOperation` — up to ~6 call sites (initial + retry +
4 repair variants + deepening module). DB: profile fetch, internal-link
injection. No direct supabase writes. Console telemetry (`[template-gen]`,
`[content-enforcement]`) is observable output.

## Never change silently

- The **null contract**: template failure returns null so the caller's
  standard path runs — never throw for parse failures.
- The **enforcement contract**: identity-backed content below the context
  threshold THROWS (does not fall through) — weak content must not ship.
- Dedicated-runner fail-open, flexible block-key parsing, by-index block
  merge with template-id preservation, fence stripping, the candidateScore
  weights, the `targetWc >= 300` retry guard, the 88% managed-longform gate,
  repair prompts' identity-lock prefix.

## Characterization

`backend/tests/unit/runTemplateBlogGenerationCharacterization.test.ts` —
7 tests + 1 golden-master snapshot. Locks: dedicated classic routing (shared AI
path NOT called), fail-open to shared path, shared-path envelope (by-index
merge, id preservation, seo passthrough), null contract for non-JSON and
missing-blocks outputs, fence stripping, enforcement-gate throw for generic
content with a supplied identity. Prompt builders, parser, pure helpers, and
companyContextBlock enforcement all run REAL; mocks only at aiGateway, profile,
link injection, hook assessment, sub-runners, deepening.

**Uncovered paths** (extend before touching): the `targetWc >= 300`
retry/repair state machine (all 5 repair variants + deepening), newsletter/
managed-longform template flags, managed-longform rejection gate, dedicated
tutorial/comparison/editorial routing (mirrors classic; sub-runners have their
own modules).

## Governance verdict (2026-07-09)

Architecture 58/100 · Testability 66/100 (was ~10) · Maintainability 55/100.
Coupling: moderate (12 modules, clean seams). Cohesion: high. Runtime risk of
decomposition: HIGH — the repair state machine threads best*/needsRetry
mutable state through six AI-call sites with deliberate prompt sequencing
(NEVER change AI prompt timing), and the flag matrix encodes product routing.
**Verdict B: optimal maintainable form under the behavior-preservation
constraint.** The extraction that was safe (pure helpers, engine, dedicated
runners) has already been done; what remains is the sequencing itself. If the
repair chain ever needs surgery, first extend the characterization suite with
a targetWc ≥ 300 scenario scripting all repair AI responses.
