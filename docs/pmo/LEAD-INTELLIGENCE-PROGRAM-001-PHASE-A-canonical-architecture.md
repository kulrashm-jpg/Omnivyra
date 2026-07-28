# LEAD-INTELLIGENCE-PROGRAM-001 — Phase A

## Canonical Lead Intelligence Platform — Architecture, Ontology & Gap Analysis

**Type:** Architecture blueprint (design only — no code). **Verified 2026-07-28** against repository
source (LC-001/LC-002 audits + an independent current-state code inventory).
**Roles:** Chief Product/AI/Data/Intelligence-Systems Architect · Staff Backend Engineer · Product
Intelligence Lead · Independent Platform Certification Authority.
**Mandate:** define the ONE canonical architecture every future Lead Intelligence capability builds on;
reach 95–100% analyst-grade maturity with zero duplicate intelligence and zero architectural drift.

---

## 0. Executive Architecture Assessment

Omnivyra's Lead Intelligence is **already a strong, evidence-first read layer** — a single unified read
service (`leadIntelligenceReadService.collectViews`) fusing four lineages, a deterministic scorer
(`buildBuyingIntentProfile`), BANT/MEDDIC qualification, stakeholder detection, action planning, and a
hexagonal ingestion core (`ingestCanonicalLead` + 15 source adapters). This session added the
operational core (W2), audience segmentation (W3), campaign intelligence (W4), and guarded execution
(W5.1 + ES-001). **The foundation is canonical and clean; the deficits are not "missing features" but
five structural fractures** that prevent analyst-grade maturity:

1. **Three scoring paradigms coexist** — deterministic `buildBuyingIntentProfile` (0–100, System A,
   read-time) vs two LLM qualifiers `qualifyLead`/`qualifyPredictiveLead` (0–1, System B, write-time).
   Reconciled by precedence in `scoreMaterialization`, but there is **no single canonical scoring
   contract**.
2. **No formal `Facet<T>` on leads** — evidence/confidence/provenance are modeled ad-hoc per struct
   (`EvidenceItem`, `QualificationField{value,known,evidence}`, `Stakeholder.evidence`). Company and
   Offering Understanding already use the canonical `Facet<T> = {value, confidence, evidence[]}`; leads
   do not — so the three Understanding entities are **not yet one spine**.
3. **No contradiction/conflict representation** anywhere in the lead types — the platform cannot express
   "signal X contradicts signal Y," which is table stakes for analyst-grade reasoning.
4. **Missing dedicated engines** — no standalone persona/ICP-inference engine (ICP only emerges inside
   the LLM qualifier), no cross-lead prioritization/ranking engine (only per-action priority +
   `sortLeads`), no graph/network influence model (only title-heuristic role classification).
5. **Fragmented persistence + partial graph** — four lineages (`lead_intelligence`, `active_leads`,
   `leads`, `canonical_leads`) unioned at read time; Competitor Intelligence is **not** wired into the
   lead domain.

**The canonical answer is one unifying thesis:** **Lead Understanding is the third canonical Understanding
entity** (Company · Offering · Lead), built on the **same certified spine** — `Facet<T>`, evidence-first,
single-owner projection, ontology-activation with abstention, the generic Entity Governance Framework,
and flag-dark shadow-first rollout. Every existing engine becomes an **evidence contributor** into one
`LeadUnderstanding` object; nothing is duplicated, nothing is forked.

**Certification: ✅ PHASE A CERTIFIED** (§13).

---

## 1. LI-101 — Lead Intelligence Capability Matrix

Legend: ✅ implemented · ◐ partial · ⧉ duplicated · ⌫ obsolete · ❌ missing. Every row cites source.

| Capability | State | Where (evidence) | Deficit → target |
|---|---|---|---|
| Lead enrichment (behavioural) | ✅ | `profileEnrichment.ts` (visitorJourney/campaignAttribution/contentReference/websiteBehaviour projections) | keep; feed Facets |
| Firmographic / contact enrichment | ❌ | none (self-reported form fields only) — G6 | enrichment port + provider (abstain when absent) |
| Lead profile generation | ✅ | `leadIntelligenceReadService.getEnrichedLeadProfile` | reshape into `LeadUnderstanding` |
| Scoring (buying intent) | ✅⧉ | `buildBuyingIntentProfile` (0–100 det.) **+** `qualifyLead`/`qualifyPredictiveLead` (0–1 LLM) | **unify** into one canonical scoring contract |
| ICP fit | ◐⧉ | `CanonicalLeadScores.icp` via LLM qualifier consuming `companyProfileService` | dedicated ICP-fit engine, evidence-cited |
| Persona inference | ◐ | `companyIntelligence` roles (title heuristics) | dedicated persona engine (title+behaviour evidence) |
| Engagement signals | ✅ | `tracking_events`, `buyingIntent` evidence, `profileEnrichment` | canonical Intent/Engagement domains |
| Outreach recommendations | ✅ | `leadActions.buildLeadActionPlan`, `buyingIntent.recommendations`, `recommendations.recommendNextAction` | consolidate into NBA engine family |
| Qualification | ✅⧉ | framework `leadActions.Qualification` (BANT+MEDDIC) **+** LLM `QualificationResult` | one qualification contract; LLM = evidence source |
| Ranking / prioritization | ◐ | `leadActions ActionPriority`, `query.sortLeads`, `qualify engagement_potential` | **new** cross-lead prioritization engine |
| Segmentation | ✅ | `lib/audience/segmentation.ts` + `audienceService` (W3) | keep; predicate on canonical Facets |
| AI reasoning | ◐ | LLM qualifiers; `summarizeLead` is **rule-based** (mislabeled "AI Summary", G7) | grounded reasoning contract (LI-105) |
| Evidence generation | ✅ | `EvidenceItem`, `QualificationField.evidence`, `Stakeholder.evidence`, `decisionJourney.provenance` | lift to canonical `Facet<T>.evidence` |
| Confidence scoring | ✅ | `buyingIntent.confidence`, `Score/Field/Stakeholder.confidence` | canonical confidence on every Facet |
| Contradiction awareness | ❌ | **no conflict type anywhere** | **new** contradiction model (LI-105) |
| Relationship / stakeholder mapping | ◐ | `companyIntelligence Stakeholder/StakeholderRole/classifyStakeholder` | buying-committee + org graph (LI-102 D3) |
| Influence detection | ◐ | role heuristics only | graph/network influence model |
| Opportunity scoring | ✅ | `opportunityFeedService` (explanation JSONB), `projections.opportunityProjection` | canonical Opportunity domain |
| Workflow integration | ✅ | operational core (W2), audiences (W3), campaigns (W4), guarded execution (W5.1/ES-001) | consume `LeadUnderstanding` projection |
| Score materialization | ✅ | `scoreMaterialization` (G3 fixed, precedence-safe) | becomes Facet materialization |
| Persistence lineage | ⧉ | 4 stores unioned in `collectViews` | converge on canonical store, union as compat |

---

## 2. LI-102 — Canonical Lead Understanding Specification

**`LeadUnderstanding`** is the single semantic owner of a lead — a *living intelligence object*, not a
CRM row. Every field is a **`Facet<T> = { value: T | null; confidence: 0..1; evidence: EvidenceRef[];
provenance: SourceRef[]; asOf: timestamp; contradictions: ContradictionRef[]; assumptions: string[] }`**
— the **same generic** already proven in Company/Offering Understanding (reused, not redefined). Absent
evidence ⇒ `value:null, confidence:0` (**abstain, never fabricate**). Fields decompose into 8 domains
over a shared Evidence Layer.

**D1 — Identity.** person, role/title, organization (→ Company Understanding id), geography, seniority,
department, tenure. *(Seed: `CanonicalLeadView`, identity gateway, `companyIntelligence` role parse.)*

**D2 — Professional Context.** responsibilities, KPIs, decision authority, influence, reporting chain,
buying-committee role. *(Seed: title heuristics; most Facets abstain until enrichment — honest nulls.)*

**D3 — Relationship Intelligence.** internal/external/partner/customer relationships, mutual
connections, **organizational graph** (nodes = people/accounts, edges = reports-to/influences/
co-engaged). *(Seed: `Stakeholder`/`StakeholderRole`; graph is new, evidence-gated.)*

**D4 — Buying Intelligence.** pain points, initiatives, urgency, budget likelihood, timing, authority,
competitive context. *(Seed: `buyingIntent` interests/stage + BANT/MEDDIC `leadActions`; competitive
context = **new** edge to Competitor Understanding.)*

**D5 — Intent Intelligence.** explicit signals, implicit signals, aggregated intent, **freshness +
decay**, confidence. *(Seed: `buildBuyingIntentProfile` evidence + System-B `lead_signals`; decay is a
first-class Facet modifier — intent Facets carry `asOf` + a decay policy.)*

**D6 — Engagement Intelligence.** channel preferences, responsiveness, historical engagement,
communication style, content affinity. *(Seed: `profileEnrichment` behaviour/content projections,
`ReadinessChannel`.)*

**D7 — Opportunity Intelligence.** strategic value, revenue potential, expansion/cross-sell/upsell,
retention relevance. *(Seed: `opportunityFeedService`, `opportunityProjection`.)*

**D8 — Risk Intelligence.** blockers, objections, procurement risk, compliance concerns, org
instability. *(Seed: `ReadinessItem.blockers/missingInformation`, `Qualification` unknowns; compliance
ties to G10 DSAR/consent.)*

**Evidence Layer (mandatory on every Facet):** provenance (`SourceRef`), timestamp (`asOf`), confidence
(0..1, derived deterministically from evidence breadth/recency), supporting evidence (`EvidenceRef[]`),
**contradictions** (`ContradictionRef[]` — new), **unknowns** (explicit `known:false`, preserved from
`QualificationField`). No score is stored without its evidence set.

**Ownership rule:** `LeadUnderstanding` is produced by **one** builder
(`buildLeadUnderstanding(resolved)` — mirrors `buildOfferingUnderstanding`); a single-owner
`LeadProjection` reshapes it for consumers and **never recomputes a semantic**. Company/Offering are
**upstream** (leads read their ids/types); leads never write back (strict DAG, §4).

---

## 3. LI-103 — Lead Intelligence Engine Map

Every engine becomes an **evidence contributor** into `LeadUnderstanding` Facets — no engine owns a
parallel score. Ownership / overlap / gap:

| Engine | Owner (canonical) | Contributes to | Overlap resolved | Status |
|---|---|---|---|---|
| Buying-signal | `buildBuyingIntentProfile` (the ONE deterministic core) | D4/D5 intent Facets | LLM qualifiers become **evidence inputs**, not rival scores | reuse |
| Qualification | one `Qualification` contract (BANT+MEDDIC) | D4 authority/budget/timing | framework + LLM merge into one field set w/ `known` | unify ◐→✅ |
| Prioritization / ranking | **NEW** `LeadPrioritizationEngine` | cross-lead ordering (queue) | subsumes `sortLeads` + `ActionPriority` deterministically | **build** |
| Relationship mapping | `companyIntelligence` → **org-graph engine** | D3 graph | title heuristics become graph seed evidence | extend |
| Opportunity scoring | `opportunityFeedService` | D7 | single explanation contract | reuse |
| Influence detection | **NEW** graph-influence over D3 | D3 influence Facet | replaces title-only heuristic | **build** |
| Stakeholder detection | `classifyStakeholder` | D3 buying-committee | keep; feed graph | reuse |
| Persona / ICP inference | **NEW** `PersonaEngine` + ICP-fit | D1/D2/D4 | extracts ICP out of the LLM qualifier into an explainable engine | **build** |
| Next-best action | `leadActions.buildLeadActionPlan` | D6/D8 readiness | canonical | reuse |
| Next-best message | `buyingIntent.recommendations` + campaign messaging (W4) | D6 | grounded by reasoning contract | reuse |
| Next-best timing | `FollowUpStrategy` cadence/expiry | D5/D6 | intent-decay-aware | reuse+extend |
| Next-best channel | `ReadinessChannel` | D6 | canonical | reuse |

**Scoring unification contract (the critical design element):** ONE `LeadScore` Facet family
(`intent/icp/urgency/opportunity/priority`, 0..1) with a **precedence + evidence-merge** rule: the
deterministic engine is the base; LLM qualifiers and System-B signals contribute **weighted evidence**
(never overwrite a higher-confidence source — the existing `hasRealScores` precedence generalizes).
This eliminates the three-paradigm fracture without deleting any engine.

---

## 4. LI-104 — Lead Intelligence Graph Specification

Strict acyclic dependency graph; **no duplicate representation** (each entity owns its semantics once):

```
Company Understanding ──id/ICP──►┐          Offering Understanding ──id──►┐
Competitor Understanding ─────────┼─(read-only refs, upstream)────────────┤
                                  ▼                                        ▼
     Signals / tracking_events ─► Lead Resolution ─► LEAD UNDERSTANDING ─► Lead Projection
     (System A capture +          (identity +          (single owner,        (single reshape)
      System B lead_signals)       dedupe)              8 domains, Facets)        │
                                                                                  ▼
                                          Consumers ── Audiences (W3) · Campaigns (W4) ·
                                                       Operational core (W2) · Guarded execution (W5.1)
                                                       Opportunities · Accounts · GTM
```

**Invariants:** (a) Company/Offering/Competitor are **upstream, read-only** to leads; leads never write
back (no reverse edge). (b) Consumers read the **projection**, never recompute lead semantics.
(c) `Account` = the org node shared with Company Understanding (one representation, not a lead-local
copy). (d) `Opportunity` references a `LeadUnderstanding`, not a duplicate lead. (e) **Competitor edge is
new**: D4 competitive-context Facets cite Competitor Understanding (closing the integration gap).
Enforcement: the generic Entity Governance compatibility guard (per-entity layering rule, F-A5 pattern).

---

## 5. LI-105 — Evidence & Reasoning Framework

A canonical **`ReasoningTrace`** attached to every AI/derived conclusion — the contract that makes the
platform analyst-grade and answers the six mandatory questions:

```
ReasoningTrace {
  claim: string                      // WHAT is concluded (e.g. "high buying intent")
  because: EvidenceRef[]             // BASED ON WHAT — the exact evidence, with source + asOf
  confidence: 0..1                   // HOW CONFIDENT — deterministic from evidence breadth/recency/agreement
  contradictions: ContradictionRef[] // WHAT CONTRADICTS — conflicting evidence, never hidden
  unknowns: string[]                 // WHAT IS UNKNOWN — explicit gaps (from QualificationField.known:false)
  assumptions: string[]              // WHAT IS ASSUMED — every inference dependency named
  method: 'deterministic' | 'llm-grounded' | 'hybrid'
}
```

- **Deterministic-first:** rule/weight conclusions (buyingIntent, qualification) emit traces
  mechanically. **LLM-grounded:** every LLM claim must cite `EvidenceRef`s from the lead's own evidence
  set (reuse `ai/safety` grounding + `ai/grounding` enforcement) — **no ungrounded claim ships** (fixes
  the G7 mislabel).
- **Contradiction model (new):** `ContradictionRef { a: EvidenceRef; b: EvidenceRef; kind:
  'stale-vs-fresh' | 'source-conflict' | 'stated-vs-observed'; resolution: 'prefer-fresh' |
  'prefer-higher-confidence' | 'flag-unresolved' }`. Contradictions **lower** the Facet confidence and
  surface in the trace — they are never silently dropped.
- **Freshness/decay:** intent Facets apply a decay function on `asOf`; a contradiction between a stale
  high-intent signal and a fresh low-intent signal resolves `prefer-fresh` and is shown.
- **Determinism:** the trace and all deterministic Facets are pure (no `Date.now` in scoring; `asOf`
  passed in) — reproducible, testable.

---

## 6. LI-106 — Master Gap Analysis

Current → target. Ranked by impact (I), complexity (C), dependency (D), priority (P0–P3). Carries LC-001
G1–G16 forward and adds architecture-tier gaps A1–A8 surfaced by this assessment.

| Gap | Type | I | C | D | P | Wave |
|---|---|---|---|---|---|---|
| **A1** No canonical `LeadUnderstanding` / `Facet<T>` on leads | Architecture | ★★★ | L | — | P0 | B |
| **A2** Three scoring paradigms unmerged (no one contract) | Duplication | ★★★ | L | A1 | P0 | C |
| **A3** No contradiction/conflict model | Reasoning | ★★★ | M | A1 | P0 | C |
| **A4** No `ReasoningTrace` contract / ungrounded "AI Summary" (G7) | Explainability | ★★★ | M | A1 | P0 | C |
| **A5** No dedicated persona/ICP-fit engine | Engine | ★★ | M | A1 | P1 | D |
| **A6** No cross-lead prioritization/ranking engine | Engine | ★★ | M | A1,A2 | P1 | D |
| **A7** No org/influence graph (heuristic only) | Engine | ★★ | L | A1 | P1 | D |
| **A8** Competitor Understanding not wired into leads | Integration | ★★ | S | A1 | P1 | D |
| **G3** website leads unscored in list (materialization) | Intelligence | ★★★ | S | — | P0 | *shipped W1.2* |
| **G6** no firmographic/contact enrichment | Enrichment | ★★ | L | A1 | P1 | D |
| **G4** two tracking pipelines / two stores | Data | ★★ | M | — | P1 | *W1.2 partial* |
| **G8/G9** fire-and-forget adopt / silent side-effects | Reliability | ★★ | M | — | P1 | *W1.2 partial* |
| **G10** no consent lifecycle / DSAR | Compliance | ★★★ | M | A1 | P1 | E |
| **G5** no device/geo parse | Visitor | ★ | M | G4 | P2 | E |
| **G13/G14/G15** segment persistence / lead→campaign bridge / guarded action exec | Workflow | ★★ | — | — | *shipped W3/W4/W5.1* |
| **A-obs** no lead-domain reasoning telemetry / contradiction metrics | Observability | ★★ | S | A4 | P1 | C |

Technical debt: four persistence lineages (converge behind canonical, keep union as compat); rule-based
`summarizeLead` mislabeled AI (relabel or make grounded); System-B LLM scores 0–1 vs det. 0–100 (unify
scale in the contract).

---

## 7. LI-107 — Lead Intelligence Engineering Master Plan

Wave-based, additive, flag-dark, shadow-first — the **same governance posture** as Company/Offering
Understanding and the GTM program. Each wave: objectives · ownership · dependencies · rollout · rollback
· certification.

| Wave | Objective | Owns | Depends | Rollout | Rollback | Cert criteria |
|---|---|---|---|---|---|---|
| **B — Canonical Foundation** | `LeadUnderstanding` + `Facet<T>` reuse + single-owner projection + shadow bundle | `backend/services/leadUnderstanding/` (new, independent) | Company/Offering `Facet<T>` | flag `lead-understanding` OFF; shadow-only | delete module / flag OFF | ontology materialized in shadow; det.; abstains; 0 prod impact; reuses Facet (no redefine) |
| **C — Reasoning & Unified Scoring** | `ReasoningTrace` + contradiction model + ONE `LeadScore` contract (det. base + LLM/System-B as evidence) | reasoning contract; score-merge | B | shadow scores vs live; A/B parity | precedence keeps legacy scores | every conclusion has a trace; contradictions lower confidence; no scorer deleted; parity ≥ threshold |
| **D — Intelligence Engines** | persona/ICP-fit + prioritization + org/influence graph + competitor edge; enrichment port | new engines as evidence contributors | B,C | flag per engine; shadow Facets | flag OFF → Facets abstain | each engine cites evidence; no duplicate score; graph acyclic |
| **E — Compliance, Data Unification, Rollout** | DSAR/consent (G10); tracking-store unify (G4); device/geo (G5); authoritative projection flip | consent lifecycle; unified events | B–D | `lead-understanding-authoritative` OFF→per-tenant | O(1) flag-off → legacy read layer | DSAR erase+suppress; one event store; per-tenant flip safe; kill-switch verified |

**Cross-wave guarantees:** zero duplicate implementation (engines contribute, never fork a score);
zero drift (single owner + projection + governance guard); zero conflicting ownership (Facet single-
owner rule); additive evolution (new module, union old lineages as compat); production-safe
(shadow-first, flag-dark, per-tenant, kill-switch — reuses the certified rollout machinery).

---

## 8. Reuse Ledger (no duplicate intelligence)

| Reused asset | Role in canonical platform |
|---|---|
| `Facet<T>` (Company/Offering Understanding) | the shared field spine — **reused, not redefined** |
| `buildBuyingIntentProfile` + `EvidenceItem` | the ONE deterministic intent core → D4/D5 evidence |
| `scoreMaterialization` precedence (`hasRealScores`) | generalizes into the score-merge rule |
| `leadActions` BANT/MEDDIC, `companyIntelligence` stakeholders | qualification + D3 seed |
| `leadIntelligenceReadService.collectViews` | resolution input (4-lineage union) |
| `lib/audience/segmentation` (W3), campaign (W4), operational core (W2), guarded execution (W5.1/ES-001) | consumers of the projection — unchanged |
| `ai/safety` + `ai/grounding` | enforce LLM-grounded reasoning traces |
| Entity Governance Framework + flag-dark rollout | wave governance, per-tenant flip, kill-switch |
| `lead_intelligence_events` + telemetry `lead_management` | reasoning/contradiction telemetry surface |

---

## 9. Production Readiness Target

95–100% maturity = : one canonical `LeadUnderstanding` (8 domains, `Facet<T>`); one scoring contract
(no rival scores); every conclusion carries a `ReasoningTrace` (why/evidence/confidence/contradiction/
unknowns/assumptions); persona/prioritization/influence engines live and evidence-cited; competitor +
company + offering edges wired (acyclic); DSAR/consent complete; one event store; per-tenant
authoritative flip with kill-switch; full reasoning telemetry. All additive, reversible, tenant-safe,
observable, AI-native — no hardcoded heuristics, no disconnected engines, no isolated scores.

---

## 10. Boundary Validation

| Property | Result |
|---|---|
| No duplicate intelligence | ✅ engines become evidence contributors into one `LeadUnderstanding`; three scorers unify via one contract |
| No isolated scoring | ✅ single `LeadScore` Facet family; precedence-merge, not rivals |
| No architectural drift | ✅ single-owner builder + projection + governance guard |
| No circular dependency | ✅ strict DAG; Company/Offering/Competitor upstream read-only; leads never write back |
| Evidence-first / no fabrication | ✅ abstain on absent evidence; every Facet cites evidence + provenance |
| Contradiction-aware | ✅ new `ContradictionRef`, lowers confidence, surfaced in trace |
| One coherent platform | ✅ Lead = third Understanding entity on the same certified spine |

---

## 11. Genuine residual refinements (sequenced into Phase B/C, not open holes)

1. **Scoring-unification contract is the highest-risk element** — Phase C must land it as a
   shadow/precedence merge validated by A/B parity against all three existing scorers **before** any
   authoritative flip; no scorer is deleted. *(Design decided; validation is the gate.)*
2. **Enrichment (G6) is an external-provider dependency** — the port is canonical; providers are
   evidence sources that **abstain** when unavailable (no fabrication, fail-open). *(Design decided.)*
3. **System A/B convergence** stays a read-time union (compat) until the canonical store is proven —
   never a big-bang migration. *(Design decided.)*

These are addressed by the roadmap's shadow-first sequencing; none is an architectural conflict or hole.

---

## 12. Verification Matrix

| Deliverable | Status | Section |
|---|---|---|
| Capability Matrix | ✅ | §1 |
| Canonical Lead Understanding Specification | ✅ | §2 |
| Intelligence Engine Map | ✅ | §3 |
| Intelligence Graph Specification | ✅ | §4 |
| Evidence & Reasoning Framework | ✅ | §5 |
| Master Gap Analysis | ✅ | §6 |
| Engineering Master Plan | ✅ | §7 |
| Executive Architecture Assessment | ✅ | §0 |
| Production Readiness Target | ✅ | §9 |

---

## 13. Certification

# ✅ PHASE A CERTIFIED

The canonical architecture is **complete, internally consistent, reuse-first, and conflict-free**, and
it can support a 95–100% maturity Lead Intelligence platform: a single canonical `LeadUnderstanding`
ontology (8 domains on the reused `Facet<T>` spine), a unified reasoning model with a contradiction-aware
`ReasoningTrace`, an evidence-first architecture that abstains rather than fabricates, an engine map that
turns every existing scorer into a non-duplicating evidence contributor, an acyclic intelligence graph
that wires Company/Offering/Competitor without reverse edges, and a wave-based additive roadmap (B→E)
under the certified flag-dark, shadow-first, per-tenant governance. The current-state assessment is
grounded in verified repository evidence; the three residual items (§11) are sequenced into the roadmap
as design-first gates, not open architectural holes.

**Decision: ✅ PHASE A CERTIFIED. Authorize Phase B — Canonical Lead Intelligence Foundation.**

*Architecture blueprint only — no production code, no schema, no flag, no behavior change. It does not
reopen Company, Competitor, Offering, GTM, or release governance. Beginning Phase B is your decision.*
