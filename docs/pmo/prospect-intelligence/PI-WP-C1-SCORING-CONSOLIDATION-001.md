# PI-WP-C1 — Scoring Consolidation

**Status:** AUDIT + PLAN. No consumer was moved and no scorer was retired.
**Baseline:** `6ad638dd`
**Scope:** lead / prospect qualification, fit and prioritisation scoring only. Report,
authority, competitor, content and campaign scoring are a different domain and are
separately governed; they are out of scope and were deliberately not touched.

---

## 1. Hypothesis, and what the evidence did to it

**Going in:** the canonical scorer at `backend/services/leadUnderstanding/engines/**` is
the platform's real scoring path, one or two legacy scorers survive alongside it, and
consolidation is mostly a matter of redirecting their consumers.

**What the repository actually shows:** the relationship is inverted.

The canonical scorer has **exactly one live production consumer**. Thirteen other
lead-scoring paths are live, they write to seven different tables, and two of them
publish *contradictory* scores into the same database row. The canonical scorer is not
the incumbent that legacy code has failed to adopt — it is the newcomer, and the reason
adoption has not happened is not neglect: **it cannot currently express most of what the
incumbents express, because the evidence is not being captured.**

That reframes this package. Consolidation is not blocked on engineering effort. It is
blocked on evidence acquisition, and the honest deliverable is to say exactly which
dimensions are unpopulatable and why.

---

## 2. The canonical scorer: what it is and who actually calls it

`backend/services/leadUnderstanding/engines/**` — 20 modules, ~1,330 LOC. Nine primary
engines emit evidence-backed contributions; three derived engines synthesise over them;
`assembly.ts` is the sole owner of the resulting Understanding and projection. Engines
are pure, synchronous, deterministic and abstain rather than guess.

Its dimension vocabulary is five, declared once
(`backend/services/leadUnderstanding/types.ts:97`):

```
intent · icp · urgency · opportunity · priority
```

### Consumers — the complete list

| Consumer | Reached from | Live? |
|---|---|---|
| `backend/apiHandlers/prospects/prospectIntelligenceRead.ts:315` | `GET /api/prospects/[id]` | **YES — ungated** |
| `backend/services/prospectOutreach/readiness.ts` | called by the above | YES (same request) |
| `backend/services/intelligence/canonical/fusion.ts` | re-export of `fuseEvidence` only | type-level |
| 14 test files | — | no |

Two findings sit in that table.

**The canonical scorer is live but narrow.** `assembleLeadUnderstanding` runs on every
prospect-detail request with no feature flag. `LEAD_UNDERSTANDING_ENABLED` /
`LEAD_UNDERSTANDING_AUTHORITATIVE` (`leadUnderstanding/flags.ts`) gate only the *shadow
persistence* path — they do not gate this read. So "the canonical scorer is flag-dark"
is false, and any plan that assumes it can be changed freely is wrong: one live surface
depends on it.

**Nothing persists a canonical score.** `canonical_leads.qualification_score` exists and
`prospectIntelligenceRead` reports it verbatim, but WS-1 never writes it
(`prospectIdentity/prospectResolution.ts:189` says so explicitly, and
`piWs1ProspectResolution.test.ts:231` asserts it). The only writer of that column is a
revenue heuristic in `crmIngestionService.ts` (see §3). The canonical score is computed
per-request and discarded.

---

## 3. Competing systems found, with their consumers

Thirteen live paths, grouped by what they do. Every one is currently working and none is
retired by this package.

### Group A — rival five-dimension qualification contracts (the sharpest problem)

Two engines score the same lead across the same five named dimensions with **different
weights**, and both persist into the **same** `lead_intelligence_profiles.intelligence`
JSONB row.

| | `leadIntelligenceEngine` | `qualificationPlanning` |
|---|---|---|
| Weight table | `engineConfig.ts:245` | `planningConfig.ts:9` |
| intent | 0.35 | 0.30 |
| persona | 0.15 | 0.15 |
| companyFit | 0.20 | 0.20 |
| behavior / behavioralFit | 0.20 | 0.15 |
| urgency | 0.10 | 0.20 |
| Bands | hot 75 / warm 50 / cool 25 | hot 75 / warm 50 / cool 25 |
| Persisted at | `intelligence.summary.qualification` | `intelligence.qualificationPlanning` |

Identical band thresholds over differently-weighted totals means the two bands **can
disagree for the same lead** — a lead can be `warm` under one and `hot` under the other,
in one row, with no field saying which is authoritative.

**Consumers (live).** Both run inside
`leadIntelligenceOrchestration/orchestrator.ts`, triggered by
`leadIntelligenceActivation` from four production entry points:
`pages/api/leads/index.ts`, `pages/api/website-events/track.ts`,
`backend/services/leadCaptureService.ts`, `backend/services/crmIngestionService.ts`.
Read back through `backend/services/leadIntelligenceReadApi/` →
`pages/api/leads/intelligence.ts` and `pages/api/leads/[id]/intelligence.ts`, and
consumed by `automationExecution/taskGenerator.ts`.

This is the **largest and most-integrated scoring system in the repository** and the one
the canonical scorer is furthest from being able to replace (§4).

### Group B — LLM qualifiers on the social-listening path

| File | Formula |
|---|---|
| `leadQualifier.ts` | `0.4·icp + 0.3·urgency + 0.3·intent`, freshness ±, ×0.5 if no problem indicated, × platform weight |
| `leadPredictiveQualifier.ts` | `0.35·icp + 0.25·urgency + 0.25·intent + min(0.15, trend·0.15)`, same penalties |
| `leadJobProcessor.ts` | re-combines either of the above + platform weight, applies `QUALIFIED_THRESHOLD` |

Two near-duplicate formulas differing only in weights. Consumers: `leadJobProcessor.ts`
(lines 190, 218) — the social-listening lead job. Both are **billed credit activities**
(`shared/monetization/featureRegistry.ts:177,199`), which materially raises the cost of
changing them.

### Group C — rule and heuristic scorers writing `lead_signals`

| File | Formula | Consumers |
|---|---|---|
| `leadDetectionService.ts` | regex pattern table (60–90) + intent bonus (40–60) ± sentiment 10 | `pages/api/engagement/detect-leads.ts`, `engagementNormalizationService`, `engagementConversationIntelligenceService`, extension adapter |
| `listeningSignalPipeline.ts:78` | keyword density 0.7 + length 0.3, ×moderation penalty; `icp := intent`, `urgency := intent×1.1` | the listening pipeline |
| `communitySignalService.ts` | hardcoded `60` for competitor mentions | community ingestion |
| `crmIngestionService.ts:408` | `revenue != null ? clamp(revenue/100, 40, 100) : 40` | CRM import |

`listeningSignalPipeline` is worth naming plainly: it sets `icp_score = intent_score` and
`urgency_score = intent_score × 1.1`. Three of its four dimensions are one number wearing
three labels. Anything downstream that treats them as independent evidence is
double-counting.

`crmIngestionService.ts:408` is the **only writer of
`canonical_leads.qualification_score`** — the column the prospect API surfaces as *the*
qualification score. Company revenue is being reported to operators as lead
qualification.

### Group D — rollups and re-derivers

`leadThreadScoring.ts` (thread rollup, written to `lead_thread_score_cache` by
`backend/workers/leadThreadRecomputeWorker.ts`), `leadClusterService.ts` (cluster
priority over `lead_signals`), `conversionPredictionRepository.predictFromInputs`
(0–100 conversion score + high/medium/low/cold tiers; consumed by
`commercialIntelligence` and `marketingConversionPredictionService`),
`lib/leadIntelligence/scoreMaterialization.ts` (kill-switch **default ON**, materialises
`buyingIntent.ts` scores into the `lead_intelligence.scores` JSONB when no source score
exists).

### Group E — dormant, not competing

`backend/services/qualificationIntelligence/**` (Program 8, the "7th Understanding") has
**zero non-test consumers** and both flags default off. It is not a competing production
path and needs no retirement plan — only a decision, later, about whether it is ever
activated.

`backend/services/prospectIcp/evaluate.ts` is **not** a competing scorer: the canonical
`prospectIcpFit` engine delegates to it. It is the canonical ICP dependency.
*(Owned by another agent this cycle; read only, not modified.)*

### Two defects proven while auditing

**D-1 — a fabricated default score.** `leadIntelligenceService.ts:27`:

```ts
const score = Number(lead.qualification_score ?? 35);
```

An unscored lead is reported as 35/100, not as unscored. This is the exact failure mode
`prospectIntelligenceRead` was written to prevent, reintroduced two files away.

It is not cosmetic. At `leadIntelligenceService.ts:114-140`, that fabricated 35 raises a
`low_quality_lead` issue whose operator-facing text reads *"Lead from {source} scored
35/100 on qualification readiness"*, and drives `impact_conversion`, `impact_revenue`
and `priority_score`. Since `crmIngestionService` is the only writer of that column, every
lead from every non-CRM source is permanently 35/100 — so the platform is telling
operators that leads it has never scored are below its quality threshold, and ranking
remediation work off that number.

**D-2 — `active_leads` exists in two incompatible shapes.** Detailed in §6; it is the
central C2 finding.

---

## 4. Can the canonical scorer express today's evidence?

**Partially — and the gap is evidence, not code.**

`leadUnderstanding/prospectContext.ts` is the only production builder of a
`LeadIntelligenceContext`. It populates: `identity` (job title, department, seniority
only), `behaviour`, `behaviouralHistory`, `relationships`, `ratifiedIcp`, `account`
attributes, `companyId`.

It leaves **unpopulated**: `signals`, `qualification`, `icp` (the boolean triple),
`enrichment`, `strategicInputs`, `offeringId`, `competitorId`, `identity.geography`, and
`BehaviouralEvent.stage`. Each omission is deliberate and documented in that file — they
are refusals to fabricate, not oversights.

Tracing that context through the engines gives the real picture:

| Engine | Required input | Populated today? | Effect |
|---|---|---|---|
| `intent` | `behaviour` | yes | contributes `intent` |
| `behavioral` | `behaviouralHistory` | yes | contributes `intent` |
| `prospectIcpFit` | `ratifiedIcp` | only if the tenant ratified an ICP | contributes `icp`, else abstains |
| `personaIcp` | `identity` ✓ / `ctx.icp` ✗ | facet only | **emits no `icp` contribution** |
| `relationship` | `relationships` | yes | graph edges only, no score |
| `buyingSignal` | `signals` | **never** | **always abstains** |
| `qualification` | `qualification` | **never** | **always abstains** |
| `enrichment` | `enrichment` | **never** | always abstains |
| `strategic` | `strategicInputs` | **never** | always abstains |
| `prioritization` | derived | partial | see below |

### The load-bearing consequence

`buyingSignal` is the **sole producer** of the `opportunity` dimension. `buyingSignal`
and `qualification` are the **only** producers of `urgency`. Both always abstain.

**Two of the canonical scorer's five dimensions — `opportunity` and `urgency` — have no
producer in production today.** They are not weak. They are structurally empty.

`prioritization` blends intent 0.35 / opportunity 0.30 / urgency 0.20 / icp 0.15, but
correctly renormalises over the drivers that answered (`wSum`). With only `intent`
answering, `priority` is a rescaled restatement of `intent`. With a ratified ICP present
it becomes a two-driver blend. Either way, **`priority` today carries no independent
information** — a fact no consumer is currently told.

So of five canonical dimensions, at most two (`intent`, `icp`) are genuinely evidenced,
`icp` only for tenants that have ratified an ICP, and `priority` is derivative.

### Why `signals` is empty — the specific, fixable blocker

`prospectContext.ts` records the reason: `lead_signals.source_type` carries
`'engagement'` / `'listening'`, which does not map to the closed `BuyingSignalType`
vocabulary (`hiring`, `funding`, `exec_change`, …). Rather than map by resemblance, the
builder contributes those rows as behavioural observations and records a gap. That is the
right call — but it means the `opportunity` dimension is dark for a reason that is a
**vocabulary mismatch, not an absence of data**. This is the single highest-leverage fix
available, and it belongs to an evidence-acquisition package, not to this one.

---

## 5. Unpopulatable dimensions — stated explicitly

Per this package's hard rule, these are named rather than filled. None of them may be
synthesised, defaulted, or inferred from a proxy.

| Dimension | Status | Why |
|---|---|---|
| **Opportunity** | no evidence source | only `buyingSignal` produces it; `ctx.signals` is never populated (vocabulary mismatch, §4) |
| **Urgency** | no evidence source | only `buyingSignal` + `qualification` produce it; both always abstain |
| **Problem relevance / Problem Fit** | **not in the model at all** | not in `SCORE_DIMENSIONS`; no representation, no weight, no evidence source. `prospectIntelligenceRead` already reports it `not_implemented` |
| **Authority** | no evidence source | a `QualificationDimension` the context never populates. `active_leads.authority_score` exists as a column with no writer |
| **Buying role** | **observed attribute only, never scored** | available from the WS-7 roster and reported as an attribute; there is no scored representation and no basis for one |
| **Influence** | no evidence source | `EnrichmentInput.publicInfluence` exists in the type; `ctx.enrichment` is never populated |
| **Engagement (as a score)** | no evidence source | engagement *events* are captured and feed `intent`; there is no separate engagement dimension and `active_leads.engagement_score` has no writer |
| **Intent** | **populated** | the one dimension with a genuine production evidence path |
| **Account Potential / Relationship Strength** | not in the model | already reported `not_implemented` by the prospect API |
| **Timing** | no evidence source | `active_leads.timing_score` has no writer; `QualificationInput.timing` is never populated |

Six of the ten are unpopulatable because **the evidence is not captured**, not because
the scorer cannot represent them. That is the finding.

---

## 6. `active_leads` — what C2 needs from this package

C2 (Active Leads retirement) should start here, because the table is not what it appears
to be.

### Two incompatible tables share one name

| | Production shape (`supabase/_schema/baseline.sql:5483`) | Migration shape (`supabase/migrations/20260817_active_leads_object_model.sql:41`) |
|---|---|---|
| Tenant column | `company_id` | `organization_id` |
| Identity | `run_id` + `canonical_lead_key` | `contact_id` + `opportunity_type` |
| Scores | `intent`, `fit`, `authority`, `timing`, `engagement`, `overall` (6) | `intent`, `icp`, `confidence`, `total` (4) |
| Grade | `bucket` — suspect / prospect / qualified / needs_review | `status` |

The migration uses `CREATE TABLE IF NOT EXISTS` and adds **no reconciling columns**. In
any environment where the baseline table already exists — production does — **the
migration is a silent no-op** and the two shapes never converge.

### The consumers split across the two shapes

- `backend/services/intelligence/snapshotRouteHandler.ts:110` reads
  `.eq('company_id', …)` and `bucket` → **baseline shape**.
- `backend/services/leadIntelligence/leadIntelligenceReadService.ts:85` reads
  `readTable('active_leads', 'organization_id', …)` → **migration shape**.
- `scripts/operator/db/backfill-active-leads.ts` writes the **migration shape**.

`readTable` **fails open to `[]`** (`leadIntelligenceReadService.ts:74-81`). So against
the production shape, the `activeLeads` source of the unified lead read model returns
zero rows, silently, on every call. **The Active Leads source in the canonical read model
is already dark and nobody is being told.** Verify this against production before C2
acts on it — it is proven from code, not from a live query.

### The three columns C2 cannot migrate

`active_leads.authority_score`, `timing_score` and `engagement_score` (plus `fit_score`
and `overall_score`) have **no writer anywhere in the TypeScript codebase**, and
`active_lead_runs`, the parent of the baseline shape, has **no TypeScript writer at
all**. They are also precisely the dimensions §5 lists as unpopulatable.

So for C2:

1. **Do not map them.** There is no canonical counterpart and no evidence to fill one.
   Mapping `authority_score` to anything is fabrication.
2. **The `bucket` grade has no canonical equivalent.** `SCORE_DIMENSIONS` has no grade or
   tier concept; `suspect`/`prospect`/`qualified` is a fourth vocabulary alongside
   `hot/warm/cool/cold` (×2) and the raw 0–1 scores. Retiring `bucket` needs a product
   decision about whether the platform has a grade at all, not an engineering mapping.
3. **Settle the schema collision first.** Which shape is live in production is a
   prerequisite for every other C2 question, and this audit could not run a query to
   determine it.
4. **The read-path defect is separable and cheap.** Fixing the `organization_id` /
   `company_id` mismatch (or making `readTable` report rather than swallow the error) is
   a small, isolated change that does not depend on consolidation.

---

## 7. Migration boundaries

### Could move to the canonical scorer

| Consumer | Condition |
|---|---|
| `crmIngestionService.ts:408` (revenue proxy) | Move only after `canonical_leads.qualification_score` gets a defined owner. Even unmoved, the current formula should be reconsidered — revenue is not qualification. |
| `leadIntelligenceService.ts:27` (the `?? 35` default) | **Fix independently of consolidation.** Replace the fabricated default with an explicit unscored state. This is a bug fix, not a migration, and needs no canonical adoption. |
| `communitySignalService.ts` (hardcoded 60) | A constant is not a score. Could become an explicit abstention with no canonical dependency. |

### Could NOT move — and why

| Consumer | Blocker |
|---|---|
| `leadIntelligenceEngine` + `qualificationPlanning` (Group A) | Scores `persona`, `companyFit` and `behavior` — **none exist in `SCORE_DIMENSIONS`**. Moving them requires either widening the canonical vocabulary (a new scoring contract, forbidden here) or discarding three of five dimensions. Also the deepest-integrated system in the repo. |
| `leadQualifier` / `leadPredictiveQualifier` (Group B) | LLM-produced, **billed credit activities**. Changing what they emit changes what customers are charged for. Needs a commercial decision, not an engineering one. |
| `listeningSignalPipeline`, `leadDetectionService` (Group C) | Operate on social/listening content with **no resolved person or account**. The canonical context builder requires a prospect with a resolved person; these scorers run upstream of that resolution. |
| `leadThreadScoring`, `leadClusterService` (Group D) | Score **threads and clusters**, not leads. The canonical scorer has no thread or cluster subject. Out of scope by shape, not by quality. |
| `conversionPredictionRepository` | Predicts **conversion**, a different question from fit. Canonical `predictive.ts` exists but is unreachable from the production context. |

---

## 8. Migration / retirement plan

Ordered by dependency. **Nothing here is executed by this package.** No step retires a
system without consumer proof.

**Phase 0 — mechanism (done in this commit).**
`backend/tests/unit/piC1ScoringConsolidation.test.ts` freezes the inventory of 19
score-writing files and the two rival weight tables, and asserts `SCORE_DIMENSIONS` is
declared exactly once. A fourteenth scorer now fails the build; a retirement must be a
visible edit to a list. The standing decision is no longer held by convention alone.

**Phase 1 — defect fixes, independent of consolidation.** No canonical adoption required.
1. `leadIntelligenceService.ts:27` — remove the fabricated `?? 35`.
2. `active_leads` read-path mismatch — make `readTable`'s failure visible (§6).
3. Resolve the `active_leads` schema collision. **Blocks C2.**

**Phase 2 — evidence acquisition. This is the real unlock.** Until it lands, no Group A
consumer can move without losing information.
1. Map `lead_signals.source_type` into `BuyingSignalType`, or widen the vocabulary
   deliberately → populates `ctx.signals` → **revives `opportunity` and `urgency`**.
2. Decide whether `persona`, `companyFit` and `behavior` become canonical dimensions.
   This is a **contract decision requiring explicit sign-off**, not an implementation
   choice, and it is the gate on retiring Group A.
3. Decide whether the platform has a *grade* (`bucket` / `hot-warm-cool-cold`) at all.

**Phase 3 — consolidation, gated on Phase 2.**
1. Collapse `leadIntelligenceEngine` and `qualificationPlanning` into **one** contract —
   they duplicate each other before they duplicate anything canonical, and fixing that
   removes the contradictory-band defect regardless of what happens to the canonical
   scorer. **Highest value per unit of risk in this entire plan.**
2. Collapse `leadQualifier` / `leadPredictiveQualifier` into one weight table behind a
   flag; requires a commercial decision on the billed activities.
3. Give `canonical_leads.qualification_score` a single declared owner, or drop it.

**Phase 4 — retirement, only with consumer proof.** Nothing is deleted until every
consumer in §3 is proven redirected or proven dead. `qualificationIntelligence` (Group E)
is the only stack that could be retired on consumer evidence today — it has none — and
even that is a separate decision about whether Program 8 is ever activated.

---

## 9. Blockers

| | Blocker |
|---|---|
| **E** (engineering) | Group A scores three dimensions the canonical vocabulary does not have. Not resolvable without a contract decision (Phase 2.2). |
| **E** | `opportunity` and `urgency` have no producer. Not a code defect — an evidence gap (Phase 2.1). |
| **V** (verification) | The `active_leads` schema collision and the silent `[]` read are proven from code but **not from production**. No credentials in this worktree; the Supabase MCP server also failed to connect this session. C2 must verify against the live database. |
| **O** (ownership) | `canonical_leads.qualification_score` has no declared owner. `active_leads.authority/timing/engagement/fit/overall_score` have no writer at all. |
| **D** (decision) | Three product decisions gate Phase 3: does the platform have a grade; do `persona`/`companyFit`/`behavior` become canonical; may the billed LLM qualifiers change what they emit. |

---

## 10. Verdict

There is **not** one canonical scoring path today, and there cannot be one until the
evidence layer supports it. The canonical scorer is correct, well-guarded and honest
about its abstentions — and it is running at roughly two of five dimensions on a single
API surface, while thirteen other scorers serve the rest of the platform.

The most valuable near-term work is **not** canonical adoption. It is: fix the fabricated
default (Phase 1.1), settle `active_leads` (Phase 1.3), map the buying-signal vocabulary
(Phase 2.1), and collapse the two rival weight tables that already contradict each other
in the same database row (Phase 3.1). None of those requires a new scoring engine, and
each is independently valuable.

The frozen inventory in Phase 0 is what keeps the count from reaching fourteen while that
work is decided.
