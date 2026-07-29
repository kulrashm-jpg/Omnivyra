# VISITOR-JOURNEY-INTELLIGENCE-PROGRAM-005 — Phase B

## Visitor Intelligence Enrichment — Certification

**Type:** Enrichment engines on an existing canonical entity (deterministic contributors; additive,
flag-dark, shadow-only). **Verified 2026-07-28.** Branch `feat/lead-understanding-foundation`.
**Authority:** Programs 1–4 (production-certified) + Program 5 Phase A (Visitor Understanding certified).
**Nature:** adds `backend/services/visitorIntelligence/engines/` — deterministic evidence contributors
that enrich Visitor Understanding (behavioral/engagement/session/activity/acquisition/confidence/health)
while the Phase-A builder stays the **sole owner** and the platform is **consumed unmodified**.

---

## 0. Certification Decision

# ✅ PHASE B CERTIFIED

Visitor Understanding is enriched into a production-grade behavioral model by **deterministic, evidence-
first contributors** — the builder remains the sole owner of the understanding/score/graph/projection, and
engines only emit contributions/facets/reasoning and **abstain** when evidence is absent. It **owns only
visitor semantics**, reuses the shared `Facet`/`EvidenceRef`/`ReasoningTrace`/scoring/explainability
primitives (**no new primitive, no new scoring system**), stays **references-only**, and the enriched
visitor still **integrates natively through the UNMODIFIED Program-4 graph + cross-entity + platform APIs**.
Descriptive only — no prediction, intent, journeys, or attribution. **114/114** tests across 12 suites;
flags default OFF; tsc-clean. The only existing-file edit is Program 5's own barrel gaining Phase-B exports
(purely additive); Programs 1–4 and all Phase-A core files are byte-unchanged.

| Validation requirement | Result |
|---|---|
| Visitor owns only visitor semantics | ✅ engines enrich visitor facets/dims only; reference other entities, own none |
| Deterministic execution | ✅ no `Date.now`/`Math.random`; `asOf` passed in; repeat-equal test |
| Evidence-first | ✅ every contribution/facet cites `EvidenceRef`; engines gate on evidence presence |
| Abstains when insufficient | ✅ each engine returns `emptyOutput` (abstained) without its evidence (tested) |
| Shared EvidenceRef / ReasoningTrace / Facet reused | ✅ `mkEvidence`/`reasoningTrace`/`facet`; traces pass `validateReasoning` |
| Shared scoring reused | ✅ contributions feed `combineScoresFor`; confidence reuses `facetConfidenceFromEvidence`+`decayFactor` |
| Shared explainability reused | ✅ Phase-A `explainVisitor*` unchanged over enriched reasoning |
| Graph / cross-entity / platform unchanged | ✅ those modules byte-unchanged; enriched visitor consumed as-is |
| References-only | ✅ assembled graph edges all originate from `visitor`; only owned node is the root |
| No duplicate primitives / persistence | ✅ reuses spine primitives; one builder/projection/persistence (Phase A) |
| Programs 1–5 Phase A unchanged | ✅ Programs 1–4 + Phase-A types/builder/fromRaw/graph byte-unchanged; barrel gained additive exports only |

---

## 1. Deliverables

**1. Behavioral Intelligence Engine** (`behavioral.ts`, V-B201) — content categories, engagement +
interaction diversity, navigation, search, downloads, repeat behaviors → `behavioral` facet + `reach` +
`engagement` contributions; descriptive, no prediction.

**2. Engagement Intelligence** (`engagement.ts`, V-B202) — page/content engagement, interaction intensity,
visit consistency, activity richness → `engagement` facet + contribution; evidence-backed.

**3. Session Intelligence** (`session.ts`, V-B203) — average duration/pages (over history), visit
intervals, return cadence, recent activity, historical summaries → enriched `session` facet + `recency`
(decay) + `loyalty` contributions; no journey inference.

**4. Activity Pattern Engine** (`activityPattern.ts`, V-B204) — first/last seen, activity trend (from
inter-visit intervals), stability, repeat frequency, dormant periods → `recency` + `loyalty` contributions;
descriptive.

**5. Acquisition Intelligence** (`acquisition.ts`, V-B205) — acquisition consistency, source/campaign
confidence, referral stability, entry quality → enriched `acquisition`/`referral` facets + `reach`
contribution; **no attribution modelling**.

**6. Visitor Confidence Framework** (`confidence.ts`, V-B206) — deterministic confidence over four factors
(quantity/quality/freshness/agreement) **reusing** `facetConfidenceFromEvidence`+`decayFactor`+`clamp01`;
no new scoring system.

**7. Visitor Health Summary** (`healthSummary.ts`, V-B207) — descriptive classification
(highly_active/occasionally_active/inactive/re_engaging/anonymous/identified) from decided facets + recency.

**8. Explainability** (V-B208) — Phase-A `explainVisitor`/`explainVisitorAll` (shared
`explainUnderstanding`) unchanged; enriched reasoning traces flow through it.

**9. Compatibility Validation** (V-B209) — §0 matrix + the platform-integration test (enriched visitor →
first-class graph citizen through the unmodified session).

**Assembly** (`engines/assembly.ts`) — `assembleVisitorIntelligence` is THE sole owner: runs engines over
the Phase-A ingestion baseline, merges facets (highest-confidence non-null wins), aggregates evidence/
contributions/edges/reasoning, and calls `buildVisitorUnderstanding` + `projectVisitor` + health +
confidence. No engine assembles independently.

---

## 2. Executive Architecture Assessment

Phase B matures Visitor Understanding exactly as the platform intends a domain to grow: **more intelligence,
same architecture.** The enrichment is a set of pure contributors that mirror the Programs 1–3 Phase-C engine
pattern one-for-one — evidence-gated, abstaining, emitting `ScoreContribution`/`ReasoningTrace`/`Facet`
fragments that the single builder blends. Scoring activates precisely because contributors now exist (Phase A
abstained); nothing about the scoring *algorithm* changed. The confidence framework is the discipline made
concrete: rather than inventing a bespoke scorer, it composes the shared `facetConfidenceFromEvidence` and
`decayFactor` into a four-factor summary. And the compatibility test closes the loop — an *enriched* visitor,
richer facets and all, still flows into the unmodified `openIntelligencePlatform` and is traversable to its
`lead` reference. The scope boundary held exactly: behavioral/engagement/session/activity/acquisition/
confidence/health only — **no Journey, Intent, Qualification, Opportunity, Decision, Automation, Campaign, or
attribution** logic was implemented. This is the authoritative behavioral foundation those future programs
will consume through the platform, not extend.

---

## 3. Verification

- **Tests:** `visitorIntelligenceEnrichment.test.ts` (5) + Programs 1–4 + Phase-A regression = **114/114
  green across 12 suites**, deterministic — each engine emits contributions/facets/valid reasoning across
  all 4 dimensions, engines **abstain** without evidence, assembly **activates scoring** (non-null overall),
  references-only preserved, confidence + health reuse shared primitives, determinism, and **native platform
  integration** of the enriched visitor.
- **Types:** visitor engines **tsc-clean** (0 errors).
- **Additivity:** the only existing-file change is Program 5's own barrel (additive Phase-B export block);
  Programs 1–4, the graph/cross-entity/platform modules, and Phase-A `types`/`builder`/`fromRaw`/`graph` are
  byte-unchanged.

---

## 4. Certification Statement

Visitor Intelligence Enrichment is implemented exactly to scope: deterministic, evidence-first, abstaining
contributors that mature Visitor Understanding into a rich behavioral model while the single builder retains
ownership, the shared evidence/reasoning/scoring/explainability primitives are reused (**no new primitive or
scoring system**), the graph stays references-only, and the platform is consumed unmodified — with no
predictive or higher-order business intelligence, and **no change to Programs 1–4 or Phase-A semantics**.

**Decision: ✅ PHASE B CERTIFIED. Authorize Phase C — Visitor Explainability, Canonical Validation &
Authoritative Readiness.**

*Enrichment only — flag-dark, shadow-only, additive; no Journey/Intent/other downstream domain, no
authoritative mode, no deploy, no merge, no consumer migration. Advancing to Phase C is your decision.*
