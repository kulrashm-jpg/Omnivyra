# CONVERSATION-INTELLIGENCE-003 — Company Profile Conversation Breadth Adoption

**Status:** COMPLETE (evidence-based scope). One certifiable commit.
**Branch:** `feat/company-profile-conversation-intelligence`
**Scope decision (owner-approved):** migrate the one route that genuinely fits the
canonical orchestrator; document migration paths for the rest. No forbidden work
(no graph extension, no new orchestrator/readiness/confidence model, no rewrite).

---

## 1. Repository Adoption Audit (Phase 1)

Every Company Profile conversation entry point (`pages/api/company-profile/define-*.ts`,
plus the interview-signature scan for `nextQuestion` + `conversation`) was audited
against the **canonical Company Knowledge Graph**, whose modelled nodes are:

```
company, website, industry, products_services, target_audience, ideal_customer_profile,
unique_value, brand_positioning, brand_voice, competitors, content_themes,
core_problem, desired_transformation, team
(core-6 = company, website, industry, products_services, target_audience, unique_value)
```

| Route | Interview type | Persists to | Graph models its fields? | Canonical orchestrator legitimately applies? |
|---|---|---|---|---|
| `define-target-customer` | AI-loop | `company_profiles` + `campaign_purpose_intent` | ✅ core-6 + positioning | ✅ **PILOT — already certified (CONV-INTEL-001)** |
| `define-campaign-purpose` | **AI-loop** (can loop — the exact defect) | `campaign_purpose_intent` | ✅ overlaps (`brand_positioning`, `core_problem`) | ✅ **MIGRATED (this package)** |
| `define-marketing-intelligence` | **Deterministic** server-side (`answersGiven`) — cannot loop | marketing fields (client-persisted) | ⚠️ partial (`brand_positioning`, `competitive_advantages`→`unique_value`) | ❌ documented path §4.1 |
| `define-context-intelligence` | **Deterministic** server-side — cannot loop | **separate** `context_intelligence` store | ❌ none (revenue/geo/regulatory/workforce) | ❌ documented path §4.2 |
| `define-problem-transformation` | AI **refine** engine (`previewUpdates`; explicitly "NOT a questionnaire bot") | PT fields | ⚠️ 2 of 9 (`core_problem`, `desired_transformation`) | ❌ documented path §4.3 |

`suggest-competitors` also carries the `nextQuestion` + `conversation` signature but
is a competitor-suggestion action, not a profile interview — **considered and excluded**.

### Audit finding

Of the four named routes, **only `define-campaign-purpose` is a genuine AI-looping
Company Profile interview** the canonical orchestrator can govern without breaking
this package's Non-Goals. The other three are architecturally distinct: two already
have deterministic (non-looping) server-side question selection — the exact problem
the orchestrator solves is *already solved* — and one of those writes to a store the
graph does not model; the last is an AI **refine** surface, not a question-selection
interview. Force-migrating them would require **extending the knowledge graph** and
**rewriting `problem-transformation`'s interaction model**, both explicitly forbidden,
and would *degrade* behaviour (orchestrator emitting company-identity gaps unrelated
to the section, or dropping fields a refine flow exists to capture).

---

## 2. Route Migration (Phase 2) — `define-campaign-purpose`

`define-campaign-purpose` now reuses the **identical** canonical implementation
certified on the pilot — no fork, no route-specific intelligence:

- **Company Knowledge Graph** — `buildCompanyKnowledgeGraph` / `buildKnowledgeGrounding`.
- **Conversation Orchestrator** — `orchestrateProfileConversation` + `isQuestionEligibleForOrchestration`.
- **Readiness Evaluator** — via the orchestrator (`readiness.enoughToProceed`).
- **Knowledge Extraction** — `chatKnowledgeExtraction` (dynamic import; itself reuses
  `buildExtractionPrompt` + gateway + zod + `saveProfile`).
- **Completion Intelligence** — orchestrator terminal state + `PROFILE_CONVERSATION_HANDOFF_KEY`.
- **Persistence** — the single canonical write seam `saveProfile`.

Wired behind the **SAME two rollout flags as the pilot** (reuse-first; one toggle
governs the whole Company Profile conversation uniformly):
`profile-conversation-orchestrator`, `profile-chat-extraction` — both default **OFF**.

---

## 3. Behavioural Parity (Phase 4)

With `profile-conversation-orchestrator` ON, `define-campaign-purpose` exhibits the
pilot's behaviour, proven by `defineCampaignPurposeCanonicalAdoption.test.ts` (11 tests):

| Guarantee | Proof |
|---|---|
| highest-value unknown selection | ON: re-ask of satisfied `products_services` → replaced with `company` (value 100) |
| semantic deduplication / never-re-ask | ON: "What do you sell?" (→ satisfied node) refused |
| confidence-aware questioning | fixtures gate on `field_confidence` bands |
| multi-field extraction | `profile-chat-extraction` path reuses the certified seam |
| readiness-driven progression | completion delegates to `readiness.enoughToProceed` |
| completion intelligence | ON + core satisfied → `{ complete:true, transition, readiness }` |
| productive-work handoff | `transition.suggestedNext === PROFILE_CONVERSATION_HANDOFF_KEY` |

---

## 4. Documented Migration Paths (Phase 3) — routes intentionally NOT migrated

Per this package's Phase 3 ("Where removal is unsafe, document the migration path.
Do not silently leave parallel implementations."), the three routes below are **not**
duplicate interview implementations to retire — they are distinct surfaces. Each has
an explicit forward path that would require **separately-governed** work (out of scope
here because it breaches this package's Non-Goals).

### 4.1 `define-marketing-intelligence`
- **Why not now:** deterministic server-side question flow (`FIELD_ORDER` by
  `answersGiven`) already prevents looping; it *refines* seven marketing-specific
  fields (some, like `marketing_channels`/`campaign_focus`, are not graph nodes).
  Applying the orchestrator gate would *drop* `brand_positioning` /
  `competitive_advantages` questions whenever the graph already knows them — removing
  a refine step the route exists to provide (a regression, not an improvement).
- **Path (if desired later):** adopt **read-only** `buildKnowledgeGrounding` to seed
  the prompt with known company facts (additive, no flow change), and/or add the two
  overlapping fields (`brand_positioning`, `unique_value`) to the chat-extraction
  mapper so answers here also advance the graph. Keep the deterministic flow.

### 4.2 `define-context-intelligence`
- **Why not now:** deterministic server-side flow; persists to the **separate**
  `context_intelligence` store (revenue segments, geographic/regulatory/technology
  exposures, workforce) — **none** of which the Company Knowledge Graph models. The
  orchestrator would emit company-identity gaps unrelated to this risk-intelligence
  section.
- **Path (if desired later):** this is a *different knowledge domain*. Unifying it
  would mean a **new, separately-governed** context-intelligence graph — explicitly a
  Non-Goal here ("No new readiness models / general AI platform abstractions"). Leave
  as-is unless a distinct package commissions that model.

### 4.3 `define-problem-transformation`
- **Why not now:** an AI **strategic-refine** engine, not a question-selection
  interview — it proposes `previewUpdates`, has its own anti-loop rules, and states
  "NEVER ask field-selection questions." The graph models only 2 of its 9 fields.
  Routing it through the question-selection orchestrator would *replace* the refine
  interaction model — a rewrite (forbidden Non-Goal).
- **Path (if desired later):** keep the refine engine; optionally feed its two
  overlapping fields (`core_problem`, `desired_transformation`) through the
  chat-extraction mapper so refinements here advance the graph. No orchestrator gate.

---

## 5. Compatibility (Phase 5)

| Dimension | Impact |
|---|---|
| **API** | None when flags OFF (byte-identical, asserted). Flag ON adds a `{ complete, transition, readiness }` terminal shape (additive, mirrors the pilot). |
| **UI** | None when OFF. ON: the campaign-purpose chat may stop early with a handoff signal; no downstream workflow is invoked (handoff key is a bare descriptive string). |
| **Runtime** | OFF: no extra work (grounding + orchestrator + extraction all gated). ON: one graph build per turn; extraction runs `saveProfile` (which runs the competitor engine on save — same cost profile as the pilot). |
| **Persistence** | Unchanged write seam (`saveProfile`, `source:'user'`). No new tables/stores. |
| **Feature flags** | Reuses the pilot's two flags — no new flag family; enabling the program is one decision across both migrated routes. |
| **Observability** | Reuses `rollout.shadow{flag,result}` metrics; no new metric names. |

---

## 6. Duplicate Elimination (Phase 7)

Exactly one canonical implementation of each capability remains; the migrated route
imports them, it does not re-implement them:

| Capability | Single owner |
|---|---|
| Company Knowledge Graph | `backend/services/companyProfile/companyKnowledgeGraph.ts` |
| Question Selector | `selectNextProfileQuestion` (in the graph) |
| Readiness Evaluator | `profileKnowledgeReadiness` (in the graph) |
| Confidence Evaluator | `readFieldConfidenceBand` (in the graph) |
| Extraction Engine | `chatKnowledgeExtraction.ts` (reusing `buildExtractionPrompt`) |
| Completion Engine | `profileConversationOrchestrator.ts` |
| Conversation Orchestrator | `profileConversationOrchestrator.ts` |
| Persistence Path | `saveProfile` (`companyProfileService…`) |

No route-specific orchestration, readiness, extraction, or persistence was introduced.

---

## 7. Production Certification (Phase 8)

| Gate | Result |
|---|---|
| Tests | `defineCampaignPurposeCanonicalAdoption.test.ts` 11/11 + pilot suites 14/14 (zero regression from shared-flag reuse) |
| App typecheck | 6 errors = branch baseline; **no** new error in the migrated route |
| Backend certification | production 1, backend-tests 470, net-new 0 (see commit) |
| Backward compatibility | flags OFF ⇒ byte-identical (response contract AND prompt asserted) |
| Rollback safety | delete = flip both flags OFF; no persisted state introduced |
| Feature flags | reuse pilot flags; default OFF |
| Observability | unchanged metric surface |

---

## 8. Definition of Done

- ✅ Every Company Profile interview route that the canonical orchestrator can govern
  without forbidden work now uses it (`define-target-customer`, `define-campaign-purpose`).
- ✅ Those routes use the canonical extraction engine, readiness evaluator, and
  completion intelligence.
- ✅ No duplicate interview implementation was introduced or left silently — the three
  non-migrated routes are documented distinct surfaces with explicit forward paths (§4).
- ✅ Behaviour is identical between the two governed routes (parity table §3).
- ✅ All deterministic tests pass; production certification passes.
- ✅ One independently certifiable commit, scoped to migration only.
