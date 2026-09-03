# PI-P1-W03 — Wire the ratified ICP into scoring: audit and specification

**Parent:** [`PHASE-1-DERIVED-PLAN.md`](./PHASE-1-DERIVED-PLAN.md) · **Architecture:** [`../PI-ADR-001.md`](../PI-ADR-001.md)
**Verdict:** `READY WITH PREREQUISITE`
**Audited:** 2026-09-03 against `origin/main` `6383e31f` and production `klkiseupptzbecbxwrky`

---

## 1. Baseline

| | |
|---|---|
| `origin/main` | `6383e31ff5089f516de3510983cf5f51d5ebaf9f` |
| Railway | `6383e31f` — SUCCESS (`9c4bf82d`) |
| Vercel | `6383e31f` — READY (`dpl_AR14LDCc45P61Wscf6mLM3q9bUNW`) |
| W01 | `ENABLE_LEAD_INGESTION="true"`; `/api/lead-ingestion/manual` → 400 (gate open) |
| W02 | `/api/lead-ingestion/csv` → 405 (deployed) |

Production, read-only: **`prospect_icps` 0 · `prospect_icp_versions` 0** (no rows of any status) · `unified_persons` 23 · `identity_claims` 42 · `contacts` 10 · `leads` 18 · `lead_signals` 10 · `lead_intelligence` 18 · `canonical_leads` 18 · `companies` 40.

**No ICP has ever been created.** W03 must therefore be certifiable without fabricating one.

---

## 2. D1 trace — complete, and better than expected

| Concern | Where | State |
|---|---|---|
| Storage | `prospect_icps`, `prospect_icp_versions` | applied, certified, empty |
| Propose / ratify | `pages/api/prospect-icp/{propose,ratify}.ts` | live (405/401 verified) |
| Persistence | `prospectIcp/persistence.ts` | tenant-scoped via `ownedDbTable` |
| Criteria vocabulary | `prospectIcp/criteria.ts` | closed vocabularies |
| Evaluation | `prospectIcp/evaluate.ts` → `evaluateIcpFit` | complete |
| Immutability | DB trigger `trg_prospect_icp_versions_immutable` | enforced in Postgres |
| One ratified version | partial unique index `uq_prospect_icp_versions_one_ratified` | enforced in Postgres |

**`evaluateIcpFit` is pure.** `IcpEvaluationInput.ratified` is `RatifiedIcp | null`, and the header states why: *"`null` is a first-class input rather than a reason to skip the call: a caller that only invokes the evaluator when an ICP exists has to remember to abstain itself."* The evaluator performs no I/O and no tenant lookup — the **caller** supplies the ratified version.

**Abstention is already complete**, with three distinct reasons: `no_ratified_icp`, `no_criteria_for_subject`, `no_evaluable_criteria`.

**Its output is already the right shape.** `IcpFitEvaluation.contributions: IcpContribution[]`, documented as:

> *"ZERO OR ONE contribution. Empty when abstaining — never a contribution carrying `value: 0`, and never one carrying `0.5`. `combineDimension` treats an absent contribution as an abstention; a zero is a claim."*

`IcpContribution = ScoreContribution<'icp'>` — the exact type the score combiner consumes.

---

## 3. The scoring system — it already exists, and already has an `icp` dimension

Repository-wide search found many scorers (competitor qualification, engagement, credit health, long-form recommendation…). Only one is the Prospect/Lead Intelligence scorer:

**`backend/services/leadUnderstanding/`** — engines emit `ScoreContribution`s; `combineScoresFor` blends them. Person/lead-level, evidence-based, abstention-aware.

```
leadUnderstanding/types.ts:97
  SCORE_DIMENSIONS = ['intent', 'icp', 'urgency', 'opportunity', 'priority']
                                ↑ already exists
```

`personaIcp.ts` already emits `dimension: 'icp'` contributions, an `icp_fit` qualification facet and a reasoning trace, and abstains when it has no evidence.

**D1's author designed for exactly this.** `prospectIcp/types.ts:50-56`:

> *"Declared LOCALLY and deliberately NOT added to `leadUnderstanding`'s `SCORE_DIMENSIONS`: wiring ICP fit into lead scoring is a later phase with a different owner. The string matches the `icp` dimension `personaIcp.ts` already emits, so when that wiring happens the contributions land in the dimension that already exists rather than opening a second one."*

That removes all ambiguity about the correct consumer. **No new scoring engine, formula, persona model, ICP table or score table is required, and none may be created.**

---

## 4. The gap, precisely

Both earlier findings **re-verified on `6383e31f`**: `prospectIcp` is consumed only by its own module and the two ICP routes; `personaIcp` → `prospectIcp` = **0** references; `evaluateIcpFit` is called only inside `prospectIcp/`.

```
ratified prospect ICP  (prospect_icp_versions, status='ratified')      EXISTS
        ↓
evaluateIcpFit(ratified, facts, asOf) → IcpContribution[]              EXISTS, correct shape
        ↓
   ▓▓▓▓▓  NOTHING CALLS IT FROM THE SCORING PATH  ▓▓▓▓▓                THE GAP
        ↓
assembly.ts:61  contributions = engines.flatMap(e => e.contributions)  EXISTS
        ↓
combineScoresFor(SCORE_DIMENSIONS, contributions)  — 'icp' ∈ set       EXISTS
        ↓
LeadUnderstanding → LeadProjection                                     EXISTS
```

**The missing connection is one engine-shaped call inside `assembleLeadUnderstanding`.**

A second, subtler gap sits beside it: `LeadIntelligenceContext.icp` (`engineTypes.ts:49`) is `{ industryMatch?, sizeMatch?, geoMatch?, source?, observedAt? }` — three booleans nominally from `company_profile`. **Nothing in the repository ever populates it.** Every `icp: {` match is in competitor services, an unrelated concept. So `personaIcp`'s ICP branch is unreachable today.

W03 must **not** map D1's rich criteria into those three booleans. That would discard the evaluator, the evidence and the abstention reasons in order to satisfy a field no producer ever filled. The correct integration adds a contribution alongside `personaIcp`, exactly as `types.ts` describes.

---

## 5. Why the verdict is not READY

**The consumer is dark, and not merely flag-dark.**

- `isLeadUnderstandingEnabled()` reads `LEAD_UNDERSTANDING_ENABLED`, which is **ABSENT on Railway and on Vercel**.
- **No runtime entry point exists.** Nothing under `backend/workers`, `backend/queue` or `pages/api` imports `leadUnderstanding`. Its only external importers are `companyIntelligence/adoption/consumers/leadIntelligenceConsumer.ts`, three `intelligence/canonical/*` contract modules, and `prospectIcp/types.ts` (a type-only import).

So W03 is implementable and unit-certifiable, but **will have no observable production effect and cannot be production-verified** — the same shape as W01's gate and W04's missing producer, recorded in the derived plan.

**The bounded prerequisite is a scope confirmation, not an engineering unknown:**

> **(A) W03 ships dark** — behind `LEAD_UNDERSTANDING_ENABLED`, acceptance is unit + integration, production verification deferred and reported as NOT PROVEN. *Recommended*, and consistent with how W02 shipped.
>
> **(B) W03 also activates Lead Understanding** — a materially larger change requiring an entry point and the authoritative-projection decision that programme owns. This would change W03's dependencies, classification and risk, and should be its own package.

This specification assumes **(A)**. Choosing (B) requires re-scoping.

---

## 6. Intended Phase-1 semantics

A ratified ICP **will** influence exactly one thing: the **`icp` score dimension of Lead Understanding**, by contributing an evidence-backed `IcpContribution` to the existing combiner.

It **will not** influence — in Phase 1 — account fit, company fit, opportunity score, ranking/prioritisation, next-best-action, or outreach eligibility. Those consume the blended score downstream and inherit any effect automatically; none needs its own wiring, and giving each one a bespoke ICP path is how a single dimension becomes five disagreeing ones.

---

## 7. Implementation specification

```text
Package:            PI-P1-W03
Objective:          A tenant's ratified ICP contributes an evidence-backed value to the
                    existing `icp` score dimension of Lead Understanding; with no ratified
                    ICP the dimension abstains rather than defaulting.

Authoritative ICP:  prospect_icp_versions WHERE status='ratified', for the subject's tenant,
                    read through prospectIcp/persistence.ts. Never the table directly.

Ratified-version selection:
                    Delegated entirely to D1. The partial unique index
                    uq_prospect_icp_versions_one_ratified guarantees at most one ratified
                    version per (organization_id, icp_id), so selection is a lookup, not a
                    choice. A proposed/draft version is unreachable by construction — the
                    query filters on status='ratified'. No version-merging, ever.

Scoring consumer:   backend/services/leadUnderstanding — the `icp` dimension already present
                    in SCORE_DIMENSIONS (types.ts:97), blended by combineScoresFor.

Existing implementation to reuse:
                    prospectIcp/evaluate.ts  evaluateIcpFit   (pure; do not modify)
                    prospectIcp/persistence.ts                (tenant-scoped read)
                    prospectIcp/criteria.ts                   (closed vocabularies)
                    leadUnderstanding/engines/assembly.ts     (engine orchestration)
                    leadUnderstanding/scoring.ts              (combineDimension/-ScoresFor)
                    leadUnderstanding/evidence.ts             (EvidenceRef)
                    personaIcp.ts                             (UNCHANGED — its formula stays)

New logic required: ONE thin engine adapter, e.g.
                    leadUnderstanding/engines/prospectIcpFit.ts — maps the subject's facts
                    into IcpSubjectFacts, calls evaluateIcpFit, and returns an EngineOutput
                    carrying the resulting contribution, evidence and reasoning. No formula.

Input contract:     LeadIntelligenceContext, extended with the RESOLVED ratified ICP
                    (RatifiedIcp | null). assembleLeadUnderstanding is SYNCHRONOUS and must
                    stay so, and evaluateIcpFit is pure — therefore the async, tenant-scoped
                    read happens in the caller that builds the context, never inside an
                    engine. This is the one design point that must not be got wrong.

Output contract:    EngineOutput with zero-or-one ScoreContribution<'icp'>, its evidence and
                    a reasoning trace. Shape unchanged from every other engine.

Evidence semantics: D1 already attaches evidence to every non-abstaining contribution.
                    W03 adds no evidence of its own and invents none.

Abstention:         No ratified ICP → zero contributions (reason `no_ratified_icp`).
                    No criteria for the subject → `no_criteria_for_subject`.
                    No evaluable criteria → `no_evaluable_criteria`.
                    combineDimension treats an absent contribution as abstention. A zero is
                    a claim and must never be emitted — D1 already guarantees this.

Tenant boundary:    tenant → prospectIcp/persistence (ownedDbTable, tenant-scoped)
                    → ratified version → context → engine → contribution → score.
                    The tenant is taken from the subject's verified context, NEVER from a
                    request body. No new authorization system; the existing one is reused.

Files/modules expected to change:
                    NEW  backend/services/leadUnderstanding/engines/prospectIcpFit.ts
                    EDIT backend/services/leadUnderstanding/engines/assembly.ts   (add engine)
                    EDIT backend/services/leadUnderstanding/engines/engineTypes.ts (context field)
                    EDIT backend/services/leadUnderstanding/engines/index.ts       (export)
                    EDIT the async context builder that resolves the ratified ICP
                    NEW  tests (below)

Schema scope:       NONE
API scope:          NONE
Credential scope:   NONE
Migration:          NO
Deployment:         YES (after merge) — but with NO production behaviour change while
                    LEAD_UNDERSTANDING_ENABLED is absent.

Dependencies:       W01 complete. W02 NOT required. W04 NOT required.
Collision surfaces: leadUnderstanding/engines/** (assembly + engineTypes are single files),
                    prospectIcp/** (read-only import).
Parallelisation:    PARALLEL — see §9.

Production verification:
                    Deferred. Requires both a ratified ICP (none exists) and an activated
                    Lead Understanding runtime. Report NOT PROVEN, as W01 and W02 did.

Rollback:           Remove the engine from the assembly array — one line; the dimension
                    returns to abstaining. No data is written by W03, so nothing to undo.

Non-goals:          a second scoring engine or formula; changing personaIcp's formula;
                    populating LeadIntelligenceContext.icp's three legacy booleans;
                    activating Lead Understanding; account/company/opportunity/ranking/NBA
                    wiring; any ICP proposal or ratification semantics; persisting a score.
```

---

## 8. Reuse / duplication audit

| Would W03 duplicate… | Existing | Verdict |
|---|---|---|
| scoring formula | `leadUnderstanding/scoring.ts` `combineDimension` | **reused** — W03 adds no arithmetic |
| ICP evaluator | `prospectIcp/evaluate.ts` | **reused unchanged** |
| persona model | `personaIcp.ts` | **untouched** |
| qualification service | `engines/qualification.ts` | untouched |
| fit calculation | `evaluateIcpFit` | reused |
| evidence model | `leadUnderstanding/evidence.ts` + D1 evidence | reused |
| abstention mechanism | D1's three reasons + `combineDimension` | reused |
| tenant resolver | `ownedDbTable` in D1 persistence | reused |
| score dimension | `'icp'` in `SCORE_DIMENSIONS` | **reused — no new dimension** |

The only new artefact is a thin engine adapter that calls an existing evaluator and returns an existing output shape. Nothing is duplicated.

---

## 9. Collision analysis

| Surface | Collision | Handling |
|---|---|---|
| `supabase/migrations/**` | **NO** | no migration |
| `config/env.schema.ts` | **NO** | no new variable |
| `capabilityRegistry.ts` / `SecurityCapabilities.ts` | **NO** | no new capability |
| `prospectIdentity/**` | **NO** | untouched |
| `prospectIcp/**` | **read-only** | imported, never modified |
| W02 files (`csvAdapter`, ingestion registry, source catalogue) | **NO** | disjoint |
| W01 configuration | **NO** | untouched |
| `leadUnderstanding/engines/assembly.ts`, `engineTypes.ts`, `index.ts` | **YES** | single files — serialise against any other leadUnderstanding work |
| closed allow-list tests | **NO** expected | new files name no legacy key variable and touch no prospectIdentity DB path |

**PARALLEL confirmed.** W03's write surface is `leadUnderstanding/engines/**`; W02's was `leadIngestion/**` + the source catalogue; W04's is the queue enqueue. The three are disjoint. The classification holds on evidence, not on the absence of a migration.

---

## 10. Testing / certification plan

Unit and integration only — no production data, no fabricated ICP in production.

1. **No ratified ICP → abstention.** `icp` dimension `abstained: true`, `value: null`. No zero, no 0.5.
2. **Ratified ICP → the evaluator receives that exact version**, and its contribution reaches `combineScoresFor` under `dimension: 'icp'`.
3. **A proposed/draft version is ignored** — unreachable, because selection filters `status='ratified'`.
4. **Tenant A cannot receive tenant B's ICP** — resolution is tenant-scoped; a foreign ratified version never appears in A's context.
5. **Immutability respected** — W03 performs no write of any kind against `prospect_icp_versions`.
6. **Missing evidence → no authoritative result** — `no_criteria_for_subject` and `no_evaluable_criteria` both abstain.
7. **Existing behaviour unchanged when W03 is inapplicable** — with no ratified ICP, every other dimension and `personaIcp`'s own output are byte-identical to today.
8. **Existing suites stay green** — `leadUnderstanding.test.ts`, `d1TenantIcpModel`, `d1ProspectIcpPersistence`, `d1ProspectIcpRoutes`, `d1_tenant_icp` (real-schema), plus `typecheck:ci` and `typecheck:certification` on the **merged** result.

Fixtures are in-memory `RatifiedIcp` objects built in the test file. No production row is created, and no fixture is written to any database.
