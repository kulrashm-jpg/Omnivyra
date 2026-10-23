# WP-14 — Owner Authorization Request: one real-tenant Report 1 generation in production

**Companion to:** `docs/WP14_REAL_TENANT_VALIDATION.md` (the runbook). This document authorizes;
the runbook executes. Neither has been executed.
**Prepared by:** Track C, Report 1 pre-T3 material closure.
**Prepared on:** 2026-10-03. **Status:** AWAITING SIGNATURE — NOT SIGNED, NOT EXECUTED.

> **Nothing in this document has been run.** No report was generated, no flag was changed, no
> production row was written, nothing was pushed, merged or deployed in producing it. Every
> production fact cited below was obtained by a read-only query or by reading committed source,
> and the provenance table at the end names how each one was established.

---

## 0. RECOMMENDATION — DO NOT SIGN YET. SIGN AFTER DEPLOYMENT.

**Recommendation: withhold signature until the integrated Report 1 tree is deployed, then sign.**
This is not risk aversion. Signing today would spend the exercise and fail to achieve the thing the
exercise exists for.

The argument is §1 of the runbook, which states the purpose exactly:

> *"Every one of them is verified **only by unit tests over synthetic inputs**. Their
> customer-visible behaviour has never been observed on a real report. That is the largest
> un-retired risk in Report 1, and this plan is how it gets retired."*

The purpose is **to retire a risk by observing real customer-visible behaviour**. Measured against
that purpose, a run today cannot succeed, for three independent reasons.

**1. At the deployed SHA the run is guaranteed to observe nothing, and §7 forbids calling that a pass.**
At `3d643f5c` — the deployed build — `resolveCompanyComparisonBaseline` **does not exist**
(`git show 3d643f5c:backend/services/reportCompetitorIntelligenceServiceEngine.ts` piped to
`grep -c resolveCompanyComparisonBaseline` returns `0`), and `computeCompanyMetrics` returns `null`
for every input. The async delta site at `:722` reads
`resolution.metrics ? subtractMetrics(resolution.metrics, companyMetrics) : null` — one-sided.
So for **any** subject with at least one successfully crawled competitor, `subtractMetrics(metrics,
null)` throws, and the runbook's own containment trace (§4b) shows the throw is swallowed at
`reportCardServiceAssembly.ts:441` and not rethrown for `snapshot`. The report **completes with no
Report 1 payload at all**. All seven slices then return `surface_absent`, and §7 is explicit:
*"NOT OBSERVED is not a pass… It means this exercise did not test the slice."* The run would retire
**zero** of the seven risks it exists to retire.

**2. The only other branch is worse, not better.** If the chosen subject happens to have *no*
crawlable competitor, the `TypeError` is dodged — but then §4 **S5** is unmet, the Phase 4b priority
scenario is `not_observed` by construction, and slice 003's null-versus-zero path is unobservable.
Either branch forfeits the highest-value case in the plan. There is no branch in which signing today
produces the observation §1 asks for.

**3. A run today would also block the run that would have worked.** §4b's stop rule is
unconditional: on a SEV-1, *"Stop… do **not** regenerate — that destroys the evidence."* A run now
produces exactly that SEV-1, which freezes the subject. The best subject available would be spent
certifying a build that is about to be replaced.

And the superseding point: six further defects of the same class are now fixed and **none is
deployed**. §1 asks whether *what customers get* is sound. After deployment, what customers get is
the integrated tree. A green run against `3d643f5c` would retire risk on code nobody will be
running, while the code they *will* be running stays unobserved — the precise condition §1 was
written to end.

**Therefore:** hold this form. On the day the integrated tree is deployed, re-run Phase 0.1 against
the new SHA, re-run Phase 0.2 (nine suites, two trees — see the corrected step), and sign then. The
form below is complete and needs no rework; only the `DEPLOYED SHA` line changes.

### A correction the owner must carry into that decision

A prior run reported *"Report 1 has never been generated in production,"* from
`select count(*) from reports where report_type='snapshot'` returning `0`. **That conclusion is
wrong, and the reason matters.** `shared/monetization/featureRegistry.ts` maps the `reports.snapshot`
feature to `report_type: 'content_readiness'`; no row is ever written with `report_type = 'snapshot'`.
Queried on the correct predicate, production holds **300 Report 1 generations** between 2026-03-30
and 2026-09-06:

| `report_type` | `metadata->>'requested_report_category'` | `requested_type` | rows | oldest | newest |
|---|---|---|---|---|---|
| `content_readiness` | `snapshot` | *(null)* | 221 | 2026-04-01 | 2026-09-05 |
| `content_readiness` | `snapshot` | `free` | 77 | 2026-03-30 | 2026-09-06 |
| `content_readiness` | `snapshot` | `premium` | 2 | 2026-03-31 | 2026-09-05 |
| `performance_intelligence` | `performance` | `premium` / `free` | 6 | 2026-05-13 | 2026-09-06 |

This **strengthens** the recommendation rather than weakening it. The runbook's §1 premise survives
intact, and for a sharper reason: `3d643f5c` merged **2026-09-30**, and the newest Report 1 in
production is **2026-09-06**. No Report 1 has been generated since the slices shipped, so slices
001–007 are indeed unobserved on real data. But the prior run's inference that A1 therefore has
near-zero blast radius — *"there is no visible latest snapshot report to overwrite, for any tenant"*
— **does not hold.** These tenants have visible report histories. Statement 5 below gives the real
position.

---

## A1 / A2 / A3 / A4 / A5 — disposition of each authorization

| ID | What it authorizes | Classification | Disposition |
|---|---|---|---|
| **A1** | One `POST /api/reports/generate`, `reportCategory=snapshot`, for the single named tenant and single named domain in statements 1–3. | **Production mutation.** Writes a `reports` row, updates one `company_profiles` row, writes crawl artifacts. | **REQUESTED — hold until deployed** (§0). |
| **A2** | Read that one new `reports.data` row and export it to the controlled location in statement 8. | **Production read + customer-data egress.** | **REQUESTED**, scoped to the one report id A1 produces. |
| **A3** | Fetch and retain the customer-visible HTML for that one report (`?format=html`). | **Production read + customer-data egress**; may embed company identity. | **REQUESTED**, scoped to the same report id. |
| **A4** | A fresh Ads Transparency acquisition for the subject (`ADS_TRANSPARENCY_ACQUISITION_ENABLED` + trigger token). | Third-party, browser-driven acquisition from the Railway vantage; the highest-risk item in the plan. | **DENIED — AND NOT REQUIRED.** Reason below. |
| **A5** | The signature record: approver, timestamp, tenant id, deployed SHA. | Attestation, not an action. | **REQUESTED** — it carries the one §4 property no query can settle (M3). |

### A4 — recorded DENIED / NOT REQUIRED, with the reason

A4 is **not merely unapproved; it is unnecessary**, and the distinction is the point. §4 **S6** asks
only that *a row already exist in the ads evidence store for this `company_id` + `domain_id`*. It
does. Verified read-only:

```sql
select company_id, scope->>'domain_id', evidence_count, observed_at
from report_evidence_history
where scope->>'kind' = 'ads_transparency';
```

returns **five** domain-scoped rows, written 2026-09-27 08:08:24Z–08:09:59Z by the single PO-3
acquisition cycle, each resolving through `canonical_domains` to the correct company. **S6 is
already satisfied for the named subject.** Slice 006 observes the *read* seam, and the read seam has
something to read. Running an acquisition would add nothing the exercise needs while incurring the
plan's largest risk — so A4 is denied on **sufficiency**, not on caution, and §10.3 stands: the
acquisition plane is a different exercise with a different risk profile.

---

## The eleven required statements

### 1. Tenant selection rule

Deterministic, applied in order; the first tenant surviving every filter is the subject.

| # | Filter | Basis |
|---|---|---|
| R1 | Must already hold a domain-scoped `ads_transparency` row in `report_evidence_history`, so A4 can be denied. | §4 **S6** |
| R2 | Exclude the test tenant `0eda0896` and any seeded/synthetic tenant. | §4 "Explicitly disqualifying" |
| R3 | Exclude `73e5fa6f` (Embrosales) — standing never-touch rule on that tenant, independent of this exercise. | Operating rule |
| R4 | Exclude any tenant with **no** resolvable subject domain **and** no prior Report 1: neither M1 nor M2 can be established in advance, and the generation path is unproven there. | §4 M1/M2 |
| R5 | Exclude any tenant with a **connected source integration** — §4 makes that a separately-authorized run because it raises blast radius. | §4 "Explicitly disqualifying" |
| R6 | Among survivors, take the tenant whose prior Report 1 history shows the lowest commercial exposure, and generate against a subject domain that is **the same canonical domain the ads evidence is scoped to** and that has **no prior report of its own**, so nothing existing is displaced. | §4 M3, §4 S6 |

Applied to production:

| Tenant | `company_id` | S6 row | Survives? | Why not |
|---|---|---|---|---|
| Unfinished Innovations LLP | `7a606a40-4d8e-4d23-b967-3df0ca4b0c8a` | yes | **no** | R5 — connected WordPress integration, `status: connected` |
| Embrosales | `73e5fa6f-822d-4eb5-8c85-42d79b25f394` | yes | **no** | R3 |
| Afrost | `1d0460ab-faaa-4fee-b857-37cb0a83caad` | yes | **no** | R4 — no `company_domains` row, 0 prior reports |
| Infitoo Systems llp | `16b49c52-849f-47fd-95f2-3f3cb19b658f` | yes | **no** | R4 — no `company_domains` row, 0 prior reports |
| **Drishiq** | **`4dae7f7a-b518-4557-b8cb-5c6123ff9658`** | yes | **YES** | — |

**The rule selects exactly one tenant. No alternate is authorized by this form.**

### 2. Why that tenant is eligible

| Property | Status | Evidence |
|---|---|---|
| M1 — real tenant, reachable public website | met | `canonical_domains` resolves `drishiq.com` for this company; a real product site, not a placeholder |
| M2 — crawl reads ≥ 3 pages | **cannot be pre-confirmed** | No prior report exists for `drishiq.com` itself. Record it as a predicted risk per step 1.1 |
| M3 — regenerable without commercial consequence | **owner attests; evidence strongly supportive** | All 214 prior Report 1s for this tenant ran against **third-party domains** — `calendly.com` (123), `hubspot.com` (59), `carrd.co` (32) — and **none against `drishiq.com`**. That is an exercise/validation usage pattern, not a customer-deliverable workload. It is nonetheless the one property no query can settle, which is what A5 is for |
| M4 — snapshot category | met by construction | The request sets `reportCategory=snapshot`. Note the corrected predicate: it persists as `report_type='content_readiness'` |
| Not seeded/synthetic | met | A real tenant with a real 214-report history; not `0eda0896` |
| No connected source | met | `company_integrations` for this company: **0 rows** |
| S6 — ads evidence present | met | One row, `canonical_domains.id = df63de89-bb2a-43a8-842c-002a45a67da6` (`drishiq.com`), observed 2026-09-27 08:09:59.384Z |
| S5 — ≥1 crawlable competitor | **cannot be pre-confirmed** | `company_intelligence_competitors` = 0 for every candidate; competitors are discovered at generation time. Predict `not_observed` for slice 003's delta path and record it **before** the run, per step 1.1 |

### 3. The exact production action

**One** authenticated request, then two reads. Nothing else.

```
POST /api/reports/generate
  Authorization: a session for a COMPANY_ADMIN of 4dae7f7a-b518-4557-b8cb-5c6123ff9658
  body: {
    "companyId":      "4dae7f7a-b518-4557-b8cb-5c6123ff9658",
    "domain":         "drishiq.com",
    "reportCategory": "snapshot"
  }
```

`type` is **omitted deliberately**: `generate.ts:89` resolves
`const type = body.type === 'premium' ? 'premium' : 'free'`, so omitting it selects the free path and
bypasses the credit machinery entirely (statement 6). Then, per Phase 2/3:
`GET /api/reports/<id>?type=snapshot` (poll to terminal — this, and only this, establishes
*route reachable*), and `GET /api/reports/<id>?format=html`.

**Retry ceiling: two, per step 2.2, each recorded.** No second tenant, no second domain, no re-run
after a SEV-1.

### 4. The expected `reports`-row mutation

One **INSERT** into `reports` (`reportCardServiceModel.ts:656`):

| Column | Value | Source |
|---|---|---|
| `company_id` | `4dae7f7a-b518-4557-b8cb-5c6123ff9658` | request |
| `user_id` | the operating admin | session |
| `domain` | `drishiq.com` | request |
| `is_free` | **`false`** | `isFree: !RELAX_FREE_REPORT_LIMIT`, and `RELAX_FREE_REPORT_LIMIT = true` |
| `report_type` | **`content_readiness`** | `featureRegistry` maps `reports.snapshot` to `content_readiness` |
| `status` | `generating` then terminal | updated in place, on this new row only |
| `attempt_count` | previous for (company, domain) + 1 | `deriveNextAttemptCount` |
| `metadata.requested_report_category` | `snapshot` | the only correct Report 1 predicate |
| `metadata.monetization.charge_mode` | `free` | `createFreeReport` |

**Two further durable writes, stated because the runbook does not mention them:**

- **`company_profiles` is UPDATED for this company.** `persistSnapshotReportInputs` calls
  `persistReportInputsWithoutProfileMutation`, which writes `report_settings` (including
  `report_input_observation`) onto the tenant's existing profile row. It will **not create** a
  profile (`if (!input.profile) return;`), but it does modify an existing customer row in place, and
  the previous `report_settings` value is not snapshotted first.
- **Crawl artifacts** are written to `canonical_pages` by `reportCrawlEvidenceService`.

No existing `reports` row is modified; the status transitions apply to the newly inserted row only.

### 5. Whether a visible latest report can be overwritten

**Partly — and the honest answer is not the reassuring one a prior run gave.**

- **For the subject domain `drishiq.com`: NO.** This tenant has **zero** prior reports for
  `drishiq.com`; its 214 reports cover `calendly.com`, `hubspot.com` and `carrd.co` only. Nothing
  domain-scoped is displaced. That is exactly why R6 selects this domain.
- **For the tenant as a whole: YES.** The new report becomes this tenant's newest, ahead of
  `472ad389-25c6-4307-9a04-45a8b72b30cb` (2026-09-05, `completed`, `calendly.com`). Any surface that
  shows "your latest report" will show the new one.
- **No report is deleted or rewritten.** The prior 214 remain readable by id.
- **No notification or email is emitted** by the generate path: `reportCardServiceModel.ts` and
  `reportCardServiceAssembly.ts` contain no notification, email or notify call (verified by absence
  of any such symbol in either module).

Record `472ad389-25c6-4307-9a04-45a8b72b30cb` in the §8 run sheet at step 1.2 as the pre-run latest,
so "which report is new" is never in doubt.

### 6. Expected credit consumption

**ZERO credits. ZERO free-report allowance.** Verified in source, and **identical at `3d643f5c` and
in the integrated tree**:

1. `pages/api/reports/generate.ts:89` — `const type = body.type === 'premium' ? 'premium' : 'free'`.
2. The entire reservation block — `getCreditCost`, `reserveCreditsForWork`, the admission boundary,
   the 402 insufficient-credits path — sits inside `if (type === 'premium')` at `:172`. The free path
   never enters it.
3. `createFreeReport` passes `isFree: !RELAX_FREE_REPORT_LIMIT`, and
   `RELAX_FREE_REPORT_LIMIT = true` (`reportCardServiceModel.ts:138`), so the row is written
   `is_free = false`: the `unique_free_report_per_domain` constraint is not engaged and no
   free-report entitlement is spent.

**This is not the same as zero cost.** The run performs real crawls of `drishiq.com` and of any
discovered competitor, plus real model calls — billed to the platform, not to the tenant. The
authorization sought here is for a customer-visible mutation, not for a charge.

### 7. The Ads evidence already present

One row, for this exact subject:

| Field | Value |
|---|---|
| `company_id` | `4dae7f7a-b518-4557-b8cb-5c6123ff9658` |
| `scope->>'kind'` | `ads_transparency` |
| `scope->>'domain_id'` | `df63de89-bb2a-43a8-842c-002a45a67da6` → `canonical_domains.primary_domain = 'drishiq.com'` |
| `observed_at` | `2026-09-27 08:09:59.384+00` |
| `evidence_count` | **`0`** |

Two things the gate must carry forward:

- **The scope key is a `canonical_domains.id`, not a `company_domains.id`.** The two differ for every
  subject that has both. If the generated report resolves a different domain identity, the read seam
  finds nothing and slice 006 returns `not_observed` *despite a row existing* — an outcome easily
  misread as a slice-006 defect.
- **`evidence_count = 0` is the most valuable input available, not a weak one.** A zero-evidence Ads
  Transparency read is precisely the input that tempts the report into saying *"this company does not
  advertise"* — the claim slice 007 (`S-01`/`S-05`) exists to forbid, and the one §7 marks as *"the
  single most damaging advertising claim the report can make."* Observing slice 007 against a genuine
  zero-evidence production read is a materially better test than observing it against a populated one.

### 8. What A2 and A3 will read

Nothing beyond the single report id that A1 produces.

| Capture | Authorization | Exact source |
|---|---|---|
| **C1** | A2 | `reports.data` for the new report id, read-only |
| **C2** | A2 | `GET /api/reports/<id>?type=snapshot` |
| **C3** | A3 | `GET /api/reports/<id>?format=html` |

**Controlled location (owner to confirm or replace):** the operator's local WP-14 worktree, under a
path that is **git-ignored and never committed**, deleted once the §8 run sheet is filled. The three
captures carry company identity and crawl content; they are not to be pasted into an issue tracker, a
chat, or any shared document. **Only the harness summary and the finding paths leave that location.**
Slice 003 is observable on **C1 only** — the HTML path carries `competitive_tables`, not
`competitor_intelligence` — so if C1 cannot be captured, slice 003 is `surface_absent`, never a pass.

### 9. What A5 validates

A5 is not a formality; it records the one thing no query settled.

1. **M3 — that this tenant's report may be regenerated without commercial consequence.** Statement 2
   gives strong supporting evidence (214 reports, none against the tenant's own domain), but the
   commercial relationship is the owner's knowledge, not the database's. **Signing A5 is the
   attestation of M3.**
2. **Attribution** — named approver, UTC timestamp, tenant id — so the run is auditable.
3. **The deployed SHA at the moment of the run**, which per §0 must be the integrated tree, not
   `3d643f5c`. If the SHA on the signature line is `3d643f5c`, the §0 recommendation was overruled,
   and that must be visible on the record.
4. **That A4 was considered and denied**, with the stated reason, so the denial reads as a decision
   rather than an omission.

### 10. The rollback / containment boundary

**There is no rollback. Stated plainly: once A1 executes, it cannot be undone.**

- A `reports` row cannot be un-inserted by any product path. There is no "delete report" step in this
  plan and none is requested.
- The `company_profiles.report_settings` update overwrites the previous value in place; the generate
  path does not snapshot the prior value first.
- `canonical_pages` crawl artifacts persist.
- The tenant's newest-report position changes and stays changed.

**What exists instead is containment, which is not the same thing:**

| Boundary | Mechanism |
|---|---|
| One tenant | `4dae7f7a-b518-4557-b8cb-5c6123ff9658` only. No other company id is touched |
| One domain | `drishiq.com` only — chosen because it has no prior report to displace |
| One report | One generate call, at most two retries, each recorded |
| No acquisition | A4 denied; `ADS_TRANSPARENCY_ACQUISITION_ENABLED` stays absent/off |
| No re-run after a defect | §4b stop rule: on a SEV-1, preserve and escalate; do not regenerate |
| Reads are id-scoped | A2/A3 cover exactly the one report id A1 produced |

The honest summary: **the containment boundary is the scope of the request, and the scope of the
request is the entire mitigation.** That is also the strongest argument for §0 — an irreversible
action should not be spent on a build that is about to be replaced.

### 11. What will NOT be touched

Explicitly excluded, and not requested under any reading of this form:

1. **No production code change, no deploy, no merge, no push, no migration.**
2. **No feature-flag change.** `ADS_TRANSPARENCY_ACQUISITION_ENABLED` stays absent/off (A4 denied).
3. **No Ads Transparency acquisition**, and no contact with the third-party provider.
4. **No scheduler or worker activation** — the PI scoring job and the 24h ads worker stay disarmed.
5. **No credential, secret or token access**, and no credential rotation.
6. **No other tenant.** Specifically not `0eda0896` (test), not `73e5fa6f` (Embrosales), not
   `7a606a40`, `1d0460ab` or `16b49c52`, and not the Omnivyra tenant.
7. **No other domain** for the subject tenant — not `calendly.com`, `hubspot.com` or `carrd.co`.
8. **No deletion or modification of any existing report**, including
   `472ad389-25c6-4307-9a04-45a8b72b30cb`.
9. **No credit grant, deduction, wallet adjustment or cost-config change.**
10. **No advertising account connection**, and no connected-source integration added or removed.
11. **No bulk or exploratory production querying** beyond the id-scoped reads of A2/A3 and the
    pre-run facts already recorded in this document.

---

## Railway prerequisite — Phase 0.4 cannot be discharged from this host

Phase 0.4 asks the operator to *confirm `ADS_TRANSPARENCY_ACQUISITION_ENABLED` is absent/off*.
**It cannot be confirmed from this worktree**, and the gate must not record it as verified:

- `railway status` in `C:/tmp/r1-a14` returns **`No linked project found. Run railway link to connect
  to a project`**. The environment-variable surface is unreachable from here.
- The only in-code seam that exposes the flag's value **runs an acquisition cycle** in order to do so,
  which is the very action A4 denies. Reading the flag through code would perform the thing the
  reading was meant to rule out.

**Required of the owner before A1 executes:** either

- **(a)** link the Railway project and read the variable on the worker service directly, recording the
  observed state verbatim in the §8 sheet; or
- **(b)** record Phase 0.4 as **UNVERIFIED — flag state not observable from the operator's host**, and
  accept that the A4 denial rests on the authorization record rather than on an observed flag state.

**Option (b) is acceptable and is what this form assumes**, provided it is written down as (b) and not
silently ticked. Supporting fact: the single PO-3 acquisition cycle ran once on 2026-09-27 and the
flag was turned off afterwards; all five evidence rows bear that one 95-second window, and nothing has
been written since.

---

## Signature block — A5

```
THIS AUTHORIZATION IS NOT VALID UNTIL EVERY LINE BELOW IS FILLED.

Recommendation of section 0 (sign after deployment):   FOLLOWED [ ]    OVERRULED [ ]
DEPLOYED SHA AT TIME OF RUN: ______________________
  (must NOT be 3d643f5c if section 0 was followed)
Phase 0.1 re-run against that SHA, no slice reverted:  [ ]
Phase 0.2 re-run, nine suites across two trees:        [ ]   counts: ______________

SUBJECT TENANT:       Drishiq
COMPANY ID:           4dae7f7a-b518-4557-b8cb-5c6123ff9658
SUBJECT DOMAIN:       drishiq.com
CANONICAL DOMAIN ID:  df63de89-bb2a-43a8-842c-002a45a67da6
PRE-RUN LATEST REPORT ID: 472ad389-25c6-4307-9a04-45a8b72b30cb

A1  generate ONE snapshot report for the tenant+domain above   GRANTED [ ]  REFUSED [ ]
A2  read reports.data for the resulting report id only         GRANTED [ ]  REFUSED [ ]
A3  fetch the customer-visible HTML for that report id only    GRANTED [ ]  REFUSED [ ]
A4  Ads Transparency acquisition                               DENIED  [X]  NOT REQUIRED [X]
      reason: S6 already satisfied - a domain-scoped ads_transparency row exists for this
      company_id + canonical domain (observed 2026-09-27 08:09:59Z). Acquisition is
      unnecessary, not merely unapproved.
A5  I attest M3: this tenant's report may be regenerated
    without commercial consequence.                            ATTESTED [ ]

I have read statement 10 and I understand A1 CANNOT BE ROLLED BACK.   [ ]
Phase 0.4 flag state: OBSERVED as ______________ | recorded UNVERIFIED (option b) [ ]

APPROVER (name): ______________________
APPROVER (role): ______________________
TIMESTAMP (UTC): ______________________
SIGNATURE:       ______________________
```

---

## Provenance of every production fact in this document

All reads were read-only, against project ref `klkiseupptzbecbxwrky`.

| Claim | How established |
|---|---|
| 306 `reports` rows; 300 carry `requested_report_category='snapshot'`; newest 2026-09-06 | `select` over `reports` grouped by `report_type` and `metadata->>'requested_report_category'` |
| `report_type='snapshot'` returns 0 rows | the same query, plus `featureRegistry.ts` mapping `reports.snapshot` to `content_readiness` |
| Five `ads_transparency` rows, 2026-09-27, `evidence_count = 0` each | `select` over `report_evidence_history` where `scope->>'kind'='ads_transparency'` |
| The scope `domain_id` is a `canonical_domains.id` | join of those rows to `canonical_domains`: all five resolve, and `company_id` matches in every case |
| Drishiq: 214 reports over `calendly.com` / `hubspot.com` / `carrd.co`, none on `drishiq.com` | `select domain, count(*)` over `reports` for that company |
| Drishiq pre-run latest `472ad389-…`, 2026-09-05, `completed` | ordered `array_agg` over that company's snapshot-category reports |
| Drishiq has 0 `company_integrations`; Unfinished Innovations has a connected WordPress | `select` over `company_integrations` |
| `3d643f5c` merged 2026-09-30 (PR #284) | `git log -1 --format='%H %ci %s' 3d643f5c` |
| 27 commits `3d643f5c..origin/main` (`c9763b2d`), **none** touching `backend/services`, `pages/api/reports` or `shared/monetization` | `git rev-list --count`, and `git log 3d643f5c..origin/main -- <paths>` returning empty |
| `resolveCompanyComparisonBaseline` absent at `3d643f5c`; guard one-sided at `:459` / `:722` | `git show 3d643f5c:…Engine.ts` piped to `grep` |
| Guard two-sided at `:522` / `:808` in the integrated tree | `grep -n 'subtractMetrics(resolution.metrics'` |
| Credit block gated on `type === 'premium'`; `RELAX_FREE_REPORT_LIMIT = true` | read at both `3d643f5c` and the integrated tree — identical in each |
| `railway status` returns `No linked project found` | run in `C:/tmp/r1-a14` |
