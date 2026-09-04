# PI ICP-SELECTION-CONTRACT-001 — company-aware ICP target selection

**Status:** CONTRACT FREEZE — frozen 2026-09-04. Documentation only.
**Scope:** how Prospect Intelligence SELECTS 2–5 ICP targets for a tenant from that tenant's stored
company intelligence. No application code, schema, migration, flag, ICP or production data was created
or changed by this document.

**Governing parent:** `IMPLEMENTATION-MANIFEST-001.md` §C-4, which freezes ICP *architecture*. This
document does **not** restate or amend §C-4; it adds the *selection* model §C-4 does not cover. Where the
two ever appear to disagree, §C-4 wins and this document is the one that must change.

**Inherited from §C-4 and NOT re-legislated here:** the four distinct ICP concepts (declared / AI-proposed
/ observed evidence / learned recommendation); an AI-proposed ICP is a draft version and may never
self-ratify; `prospectIcp/**` is the canonical ICP policy store; **a second ICP engine is prohibited**.

---

## 1. Purpose

To replace a static, universal list of job titles with an evidence-driven decision model that selects a
small ranked shortlist of ICP targets per tenant, and to record why each target was selected so a human
can review, edit and ratify it.

The model produces a **recommendation**. It never ratifies, and it never becomes authoritative without a
human act (§C-4, and `ratifyIcpVersion` which requires `ratifiedByUserId` with no default).

---

## 2. The two-company distinction (FROZEN)

Two different companies feed the model. Conflating them breaks it.

| Company | What it determines | Read from |
|---|---|---|
| **Target company** (who we sell *to*) | founder-vs-functional-leader | the tenant's declared `target_customer_segment`, `ideal_customer_profile` |
| **Selling tenant** (whose ICP this is) | the **authority ceiling** — how senior a buyer is realistic at all | `avg_deal_size`, `pricing_model`, `sales_cycle`, `sales_motion` |

A low-priced, self-serve product does not reach a C-suite signature regardless of how large the target
company is. Company size raises the ceiling; it does not remove it.

At ICP-definition time the target company is known only as a *declared segment*. Per-prospect company
attributes are an evaluation-time concern, not a selection-time one.

---

## 3. Evidence inputs (FROZEN)

All inputs are stored tenant intelligence. Nothing is invented.

| Signal | Source |
|---|---|
| S1 Nature of business | `industry`, `category`, `products_services_list` |
| S2 Problem solved | `core_problem_statement`, `pain_symptoms`, `problem_impact` |
| S3 Target company stage | `target_customer_segment`, `ideal_customer_profile` |
| S4 Named audience roles | `target_audience_list` |
| S5 Seller commercial scale | `avg_deal_size`, `pricing_model`, `sales_cycle`, `sales_motion` |
| S6 Geography | `geography_list`; `company_geographic_exposures` is **advisory only** |
| S7 Corroborating intelligence | `brand_memory`, `market_pulse_findings` |
| S8 Confidence / trust | `field_confidence`, `overall_confidence`, `user_locked_fields` |

**S6 constraint.** `company_geographic_exposures` describes the *tenant's own* revenue exposure. It may
corroborate but may never become prospect geography. This mirrors the standing WS-7 rule that a tenant's
own regions are not an account's geography.

**S7 constraint.** Corroborating intelligence may confirm **segment and problem only, never a role**.
MarketPulse in particular carries no person-level evidence: `entities` is empty on every finding observed
to date. Synthetic/test rows (titles matching validation- or synthetic-signal patterns) are excluded from
evidence entirely.

---

## 4. Derived concepts (FROZEN)

| Concept | Derivation | Vocabulary |
|---|---|---|
| `ORG_STAGE` | S3 normalised onto employee bands | `micro` (1-10, 11-50) · `smb` (51-200, 201-500) · `structured` (501+) — the existing `EMPLOYEE_BANDS` |
| `AUTHORITY_CEILING` | S5 | expressed in the existing `SENIORITY_VALUES` |
| `PROBLEM_FUNCTION` | S1 + S2 | the department that owns the problem |
| `FUNCTION_EXISTS_AT_STAGE` | `ORG_STAGE` × `PROBLEM_FUNCTION` | whether that function plausibly exists at all |

`AUTHORITY_CEILING` mapping:

| Commercial shape | Ceiling |
|---|---|
| self-serve / low ACV | `head` \| `director` |
| demo-assisted / mid ACV | `vp` |
| enterprise motion / high ACV | `c_suite` |

---

## 5. The invariant (FROZEN)

> **Every proposed role must trace to named evidence. No evidence = no candidate.
> No static title list may drive selection.**

A global role-category vocabulary may exist as *reference material only*. It may never be a source of
selection, a default, or a fallback set. A role that cannot cite a source field is not a candidate,
however plausible it sounds.

---

## 6. Decision tree (FROZEN)

```
1  PROBLEM_FUNCTION <- products + problem statement
   |- not determinable -> ABSTAIN (propose nothing). Never guess a function.

2  ORG_STAGE <- target_customer_segment -> employee bands
   |- absent -> skip stage branching; select from S4 evidence alone

3  AUTHORITY_CEILING <- avg_deal_size + sales_cycle + sales_motion

4  BRANCH on ORG_STAGE

   micro:
     - founder | owner | CEO-equivalent = decision maker AND economic buyer
     - add ONE functional operator ONLY IF target_audience_list names it
     - never assume a department exists

   smb:
     - senior functional owner of PROBLEM_FUNCTION = primary
     - functional operator (user / evaluator) = secondary
     - founder retained ONLY on founder-led-buying evidence, which means any of:
         * segment includes micro or startup
         * sales_cycle floor < 2 weeks
         * sales_motion is self-serve

   structured:
     - C-level / VP / functional head of PROBLEM_FUNCTION, capped by AUTHORITY_CEILING
     - founder NOT included for seniority alone

5  FALLBACK - stage implies a function that the evidence does not show:
     -> founder | owner | CEO-equivalent where supported
     -> else the strongest evidenced business decision-maker
     -> else ABSTAIN
   Never fabricate an organizational role.
```

---

## 7. Ranking (FROZEN)

Five additive factors, each traceable to a named field, times one confidence multiplier.

| Factor | 0 | 1 | 2 |
|---|---|---|---|
| **E** Evidence directness | not evidenced → **hard exclude** | implied by product or segment | named verbatim in `target_audience_list` |
| **P** Problem ownership | none | partial / one lane | owns `PROBLEM_FUNCTION` |
| **B** Buying authority at stage | none | influences | owns budget |
| **F** Organizational fit | implausible at stage | plausible | reliably exists at stage |
| **R** Product relevance | none | adjacent | a named product serves them |

**Confidence multiplier C:** ×1.0 for High or `user_locked` · ×0.8 for Medium · ×0.5 for Low, taken from
`field_confidence`.

```
rank_score = (E + P + B + F + R) x C
```

Ties break by **E**, then by **B**.

**Two hard exclusions override the score entirely:**

1. `E = 0` — no evidence.
2. Role above `AUTHORITY_CEILING`.

A role excluded by either gate cannot be reinstated by a high score on other factors.

---

## 8. The 2–5 selection rule (FROZEN)

1. Drop every `E = 0` candidate.
2. Drop everything above `AUTHORITY_CEILING`.
3. Sort by `rank_score`; take the top 5.
4. **Coverage check** — where both are evidenced, the set must contain at least one
   *decision-maker / economic-buyer* role **and** at least one *user / evaluator* role.
5. **Minimum 2, only when two defensible candidates exist.** If fewer than two survive, **abstain with a
   stated reason**. Never pad the list to reach the floor.
6. Surplus candidates become **alternates**, each carrying its rejection reason.

The output is a **ranked shortlist of targets**, not five mandatory filters. The 2–5 band is the AI's
recommendation, never a product limit.

---

## 9. Abstention rules (FROZEN)

The model abstains — proposes nothing — rather than guess, in every one of these cases:

| Condition | Rule |
|---|---|
| `PROBLEM_FUNCTION` not determinable | ABSTAIN |
| Fewer than 2 candidates survive the gates | ABSTAIN with reason; never pad |
| No functional decision-maker evidenced **and** no founder-equivalent supported | ABSTAIN |
| Evidence exists only for roles above `AUTHORITY_CEILING` | ABSTAIN |

An abstention is a first-class, reportable outcome. It is never rendered as an empty ICP or as a
zero-confidence proposal.

---

## 10. Evaluator / scoring boundary (FROZEN — MANDATORY)

> **The ranked 2–5 targets MUST NOT become separate ICP scoring criteria.**

The evaluator computes `value = satisfied / evaluable`. Five ranked targets modelled as five criteria
would score a person matching one role at **1/5 = 0.2**. That is a scoring defect that presents as poor
data quality, and it is the single most likely mis-implementation of this contract.

**Therefore:**

| Concern | Where it lives |
|---|---|
| The selected title set | **ONE union `one_of` criterion** on `job_title` in `criteria` |
| Function, where evidenced | one `optional` criterion on `department` |
| Rank, role type, provenance, confidence, organizational reasoning | **`proposal` target metadata only** |

Ranking has **no** effect on ICP fit scoring, and must not acquire one. Ranking is a targeting and
prioritisation concept, consumed downstream; ICP fit remains unweighted, per `evaluate.ts`
("there is no weighting, because there are no weights"). Existing evaluator behaviour is unchanged by
this contract.

---

## 11. User override (FROZEN)

The user may **remove · edit · add · reorder · refocus · replace wholesale · explicitly expand beyond 5**.

Every override is expressed as a **new immutable version** (propose v*n+1* → ratify), so the AI original
survives intact and remains auditable. The existing `IcpProposal.status` vocabulary carries the workflow:

```
ai_suggested -> approved | edited | rejected | regenerate_requested
```

Any surface presenting the recommendation must communicate that 2–5 is the AI's recommendation and that
expanding beyond 5 is a supported action, not an error state.

---

## 12. Provenance (FROZEN)

Each recommended target retains:

- `rank`
- `roleType` (user / evaluator / economic buyer / decision maker / influencer / sponsor)
- `derivation` — `directly_evidenced` | `inferred`
- `confidence`
- `evidenceFields[]` — the named source fields
- `evidenceQuotes[]` — verbatim
- `orgAssumption` — the stage assumption that drove the selection
- `factors` — the E/P/B/F/R/C breakdown

Each rejected alternative retains its **rejection reason**.

> **An inferred title is never presented as a directly observed fact.** `derivation` is mandatory on every
> target for exactly this reason.

---

## 13. Contract extension (FROZEN — minimum only)

Persisting target metadata requires **no database migration**. `prospect_icp_versions.proposal` is `jsonb`
constrained only to `jsonb_typeof(proposal) = 'object'`, and `createIcpVersion` writes it unvalidated and
unstripped.

Permitted additions, and nothing beyond them:

1. `IcpProposal.targets` — the ranked target array of §12.
2. `IcpProposal.rejected` — alternates with reasons.
3. `IcpProposal.stageAssumption` — the `ORG_STAGE` conclusion.
4. `validateProposalTargets()` in `backend/services/prospectIcp/`, mirroring `validateCriteria`'s
   discipline so the blob does not drift into free-form.

**Explicitly out of scope:**

- **No database migration.**
- **No change to existing evaluator behaviour.**
- **No change to `criteria`**, which stays the sole scoring surface. `validateCriterion` returns via
  `built()`, which emits exactly `id, kind, subject, attribute, predicate, description`; any extra key is
  silently dropped. Target metadata must therefore never be attached to a criterion.
- **`executive_sponsor` is NOT added to `BUYING_ROLES`**, and the `unified_persons_buying_role_valid`
  CHECK constraint is NOT changed. Buying-role population remains **enrichment-dependent**; nothing can
  populate it through the current import contract.

---

## 14. Worked example — Omnivyra (reference fixture, NOT written to production)

Tenant `4bdbec26-4f7e-4e77-a965-d499e1472f5c`, from `company_profiles` (`overall_confidence` 83,
`source: ai_refined`, refined 2026-09-01).

**Derived signals**

| Concept | Value | Evidence |
|---|---|---|
| `ORG_STAGE` | micro + smb; 501+ aspirational only | "Startups, micro, SMB, and later enterprises" |
| `AUTHORITY_CEILING` | `head` \| `director` | $5–499/mo/person · 1 week–4 months · social + email, demos as needed |
| `FUNCTION_EXISTS_AT_STAGE` | often **not** at the low end | "limited teams or budgetary constraints" |
| `PROBLEM_FUNCTION` | Marketing | products + `core_problem_statement` + `pain_symptoms` |

**Ranked shortlist**

| # | Role | E·P·B·F·R ×C | Score | Derivation | Role type |
|---|---|---|---|---|---|
| 1 | Marketing Manager | 2·2·1·2·2 ×1.0 | 9.0 | directly evidenced — "Marketing managers" verbatim | user · evaluator |
| 2 | Head of Marketing | 1·2·2·2·2 ×1.0 | 9.0 | inferred — senior-most marketer at SMB | economic buyer · decision maker |
| 3 | Digital Marketing Manager | 2·2·1·1·2 ×1.0 | 8.0 | directly evidenced — "Digital marketers" | user · evaluator |
| 4 | Founder / Co-Founder | 1·1·2·2·1 ×1.0 | 7.0 | inferred — "micro", "limited teams", 1-week cycle | decision maker · economic buyer · sponsor |
| 5 | Marketing Director | 1·2·2·1·2 ×0.8 | 6.4 | inferred — "Business decision-makers" | decision maker |

#1 and #2 tie at 9.0; the **E** tie-break places the operator first, which is correct for a self-serve
motion where the evaluator starts the trial. Coverage check passes: buyers (#2, #4, #5) and
users/evaluators (#1, #3) are both present.

**Rejected alternatives**

| Rejected | Reason |
|---|---|
| Content Marketing Manager | 4.0 — "Content creators" is adjacent, not the same role; B = 0. Top alternate. |
| Growth Marketing Manager | **E = 0, hard-excluded.** `goals_list` evidences the customer's growth *outcome*, not a growth *function*. |
| SEO Manager | 3.2 — a dedicated SEO hire contradicts "limited teams"; F = 0. |
| CMO / Chief Marketing Officer | **Above `AUTHORITY_CEILING`** — excluded by rule, not by score. |
| VP Marketing · Marketing Ops · Demand Gen · RevOps | E = 0 — no evidence anywhere in the profile. |

**Resulting criteria shape** (per §10 — one union criterion, not five):

```json
{
  "criteria": [
    { "id": "title-marketing-buyer", "kind": "required", "subject": "person",
      "attribute": "job_title",
      "predicate": { "op": "one_of", "values": [
        "Co-Founder", "Digital Marketing Manager", "Founder",
        "Head of Marketing", "Marketing Director", "Marketing Manager" ]}},
    { "id": "function-marketing", "kind": "optional", "subject": "person",
      "attribute": "department",
      "predicate": { "op": "one_of", "values": ["Marketing"] }}
  ]
}
```

Geography carries no criterion: `geography_list` is `["Global","India","Other"]`, and "Global" is an
instruction not to filter.

**This fixture is reference material. It has not been written to production.** At the time of freezing,
`prospect_icps` = 0 and `prospect_icp_versions` = 0.

---

## 15. Versioning expectations

**This document.** Frozen as `-001`. A substantive change to any FROZEN rule requires a superseding
numbered document (`-002`) that states what changed and why; this one is then marked superseded. Editorial
corrections may be made in place. Where this document and `IMPLEMENTATION-MANIFEST-001.md` §C-4 conflict,
§C-4 governs.

**ICP versions in the product.** Versions are immutable by database trigger and there is no un-ratify.
An edit is always a new version; the superseded chain is the history. Every regeneration of a
recommendation therefore produces a *new proposed version*, never a mutation of an existing one — which
is what keeps the AI original distinguishable from the human-edited set indefinitely.

**Model changes.** A change to the ranking factors, the confidence multipliers or the `AUTHORITY_CEILING`
mapping is a change to this contract, not a tuning exercise, and follows the `-002` route above.

---

## 16. Validation at freeze

| Check | Result |
|---|---|
| Application code changed | none |
| Database / schema / migration changed | none |
| Production ICP, feature flag or data changed | none — `prospect_icps` 0, `prospect_icp_versions` 0, `feature_flags` 0 |
| Ingestion state | `ENABLE_LEAD_INGESTION=false` |
| Contradiction with `IMPLEMENTATION-MANIFEST-001.md` §C-4 | none found |
