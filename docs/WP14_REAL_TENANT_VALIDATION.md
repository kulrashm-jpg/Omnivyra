# WP-14 — Controlled Real-Tenant Validation of the Report 1 Integrity Remediations

**Workstream:** REPORT-1-COMPLETION-PARALLEL-ORCHESTRATION-012, Track M
**Subject commit:** `3d643f5c` — the production-verified Report 1 release carrying slices 001–007
**Status of this document:** PREPARED, NOT EXECUTED.

> **THIS EXERCISE HAS NOT BEEN RUN AND IS NOT AUTHORIZED TO RUN.**
> No production report was generated, no tenant was queried, no Ads acquisition was enabled, and
> no production flag, row or deployment was touched in producing this document. Every statement
> below is an instruction for a later, authorized run. Nothing below is an observation.
> If you are reading this looking for results, there are none, and that is correct.

---

## 1. Why this exists

Seven Report 1 integrity remediations shipped to production at `3d643f5c`:

| Slice | Guarantee |
|---|---|
| 001 | A website presence check never reports `pass` / "Observed" for an asset that was never observed. |
| 002 | Report 1 carries only `PUBLIC_OBSERVED` / `INFERRED` / `ESTIMATED` / `UNAVAILABLE`; never `COMPANY_CONFIRMED`, `OMNIVYRA_OBSERVED` or `CONNECTED_SOURCE`. |
| 003 | No synthesized company baseline; a gap needs two observed sides; `null` never renders as zero. |
| 004 | A single critical conversion defect is sufficient; conversion remediation outranks demand generation. |
| 005 | The producer raises the no-conversion-path defect at `critical`, and `dependsOn` survives to the customer-visible plan. |
| 006 | The ads read seam reaches the customer, scoped by company **and** domain. |
| 007 | Advertising participates in the decision model, never claims the company does not advertise, states no spend/CTR/ROAS/CAC/impressions, and leaks no internal enum. |

Every one of them is verified **only by unit tests over synthetic inputs**. Their
customer-visible behaviour has never been observed on a real report. That is the largest
un-retired risk in Report 1, and this plan is how it gets retired.

## 2. The six levels — the discipline this plan exists to enforce

A validation that reports a lower level as though it were a higher one is worse than no
validation, because it retires a risk that is still live. These six are kept apart everywhere in
this document, in the recording sheet of §8, and in the code of
`backend/services/report1Validation/report1ArtifactAssertions.ts`:

| Level | Means | Established by |
|---|---|---|
| **artifact present** | A file/row exists and parses. | §6 capture step. |
| **route reachable** | An HTTP route answered with a success status. | §6 capture step, recorded separately. **Never inferred from a payload.** |
| **report generated** | The artifact carries a Report 1 payload with the surface in question. | The harness, as `surface_absent` when it does not. |
| **behaviour observed** | The surface held at least one instance the slice's contract applies to. | The harness, as `not_observed` when it did not. |
| **expected behaviour** | Those instances satisfied the contract. | The harness, as `expected`. |
| **unexpected behaviour** | They did not. | The harness, as `unexpected`. |

**Absence is never success.** A report in which nothing happened must never read as a report in
which everything passed. The harness enforces this mechanically: `surface_absent` and
`not_observed` are separate counts in the summary and are never folded into `expected`.

`route reachable` is deliberately unreachable from the harness — nothing about a JSON payload
establishes that a route answered. The operator records it in §8 by hand, from the HTTP status.

## 3. What is executable code, and what is written procedure

**Executable, committed and T1-verified (runs offline, no production access):**

- `backend/services/report1Validation/report1ArtifactAssertions.ts` — pure assertion helpers
  that take a captured report payload (and optionally the rendered HTML) and emit structured
  findings for all seven slices.
- `backend/tests/unit/report1ArtifactAssertions.test.ts` — exercises the helpers against
  synthetic healthy fixtures, synthetic reconstructions of each original defect, and the
  nothing-to-judge cases. **71 tests, all passing.**
- `backend/tests/unit/report1NullBaselineDeltaContract.test.ts` — the WP-12 null-baseline
  scenario, run against the **real** `computeCompanyMetrics`, `resolveCompetitorMetrics` and
  `subtractMetrics` with no stubs. **8 tests, all passing.** It pins the two facts the fix rests
  on (the baseline is always null; `subtractMetrics` cannot take a null baseline) without
  asserting the shape of any call site, so it stays green across WP-12's fix and any later
  refactor, while still failing if a one-sided guard is reintroduced anywhere.

**Written procedure, to be carried out by a human or agent at the later gate:**
§§4–9 of this document — tenant selection, authorization, capture, recording, triage.

**Deliberately not built:** anything that generates a report, reads production, enables a flag,
or triggers Ads acquisition. Those are the authorized actions, and building a convenience
wrapper for them here would make it one keystroke easier to run an exercise that is not
authorized.

## 4. Candidate tenant — a SPECIFICATION, not an identity

No production system was queried to find a tenant. The later gate selects one meeting these
properties. Properties are split by which slice they exercise, so a tenant that misses some is
still usable — it just leaves those slices `not_observed`, which the harness will say plainly.

**Mandatory (without these the exercise observes almost nothing):**

| # | Property | Why |
|---|---|---|
| M1 | A real customer tenant with a reachable public website. | Slices 001/004/005 all rest on crawl output. |
| M2 | The crawl reads ≥ 3 pages (`website_checks.pagesEvaluated ≥ 3`). | Below that the seven presence checks may not be emitted at all. |
| M3 | A tenant whose report may be regenerated without commercial consequence — internal, sandbox, or one with explicit account-owner consent. | §5 A1. |
| M4 | `report_type = 'snapshot'`. Growth and performance carry no Report 1 surfaces. | Slice 006 is snapshot-only by construction. |

**Strongly preferred (each one turns a `not_observed` into a real observation):**

| # | Property | Turns on |
|---|---|---|
| S1 | The site **lacks** at least one of: testimonials, case studies, a pricing page, legal pages. | Slice 001's false-positive path — the actual defect. A site that has all seven can only confirm the true-positive path. |
| S2 | The Company Profile carries **declared** data (declared social links, declared offering/positioning). | Slice 002's exclusion path. Without it nothing is ever excluded and the boundary is never exercised. |
| S3 | The site has **no discoverable conversion path** (no contact/demo/pricing route and no on-page form) **or** weak CTAs plus an unclear offering. | Slices 004/005. Without a materially deficient conversion path there is no sequencing and no `dependsOn`. |
| S4 | At least one demand-generation opportunity also fires (thin pages, or missing titles/meta). | Slices 004/005 — a dependency needs something to depend. |
| S5 | At least one competitor is discovered and crawled successfully. | Slice 003's null-versus-zero path. |
| S6 | A row already exists in the ads evidence store for this `company_id` + `domain_id`. | Slice 006. **See §5 A4: if none exists, slice 006 stays unobserved. Do NOT enable acquisition to manufacture one in this exercise.** |

**Explicitly disqualifying:**

- The test tenant `0eda0896` and any seeded/synthetic tenant — a synthetic tenant would
  reproduce the synthetic-input limitation this whole workstream exists to escape.
- Any tenant with a connected GSC property, **unless** slice 002 is the specific target: a
  connected source is the strongest test of the `CONNECTED_SOURCE` boundary, but it also raises
  the blast radius of a mistake. Treat it as a separate, separately-authorized run.

## 5. What the later gate must authorize — explicitly

The exercise cannot begin until a named approver records each of these. Each is a separate
decision; approving A1 does not approve A4.

| ID | Authorization required | Risk if skipped |
|---|---|---|
| **A1** | **Generate one Report 1 for a named real tenant in production.** This consumes the tenant's credits (or an exempted path), writes a `reports` row, writes crawl evidence, and may overwrite the tenant's visible latest report. | Customer-visible change to a real account without consent. |
| **A2** | **Read that tenant's persisted `reports.data` row** and export it to a controlled location for offline inspection. | Customer data leaves the production boundary. Governs where the file may be stored and for how long. |
| **A3** | **Render and read the customer-visible HTML** for that report (`?format=html`). | Same as A2, plus the rendered document may embed company identity. |
| **A4** | **ONLY IF slice 006/007 must be observed and no ads evidence row exists:** a separate, separately-approved Ads acquisition for that subject. Requires `ADS_TRANSPARENCY_ACQUISITION_ENABLED` and the trigger token. | **This is the highest-risk item in the plan.** It starts a browser-driven acquisition against a third-party provider from the Railway vantage and writes new evidence rows. **Default: DENY.** Prefer a tenant that already satisfies S6 and observe the read seam only. |
| **A5** | Named approver, timestamp, and the tenant identifier recorded in the run sheet. | Without it the run is unattributable and cannot be audited. |

**Not authorized by this plan under any circumstances, and not requested:** modifying production
code or flags beyond A4, merging, deploying, running migrations, rotating credentials, or
connecting an advertising account.

## 6. Procedure

> Run steps in order. Record the outcome of **every** step in the §8 sheet before moving on,
> including steps that produce nothing. A step with no recorded outcome is a step that did not
> happen.

### Phase 0 — preconditions (no production contact)

| Step | Action | Record |
|---|---|---|
| 0.1 | Confirm the deployed Report 1 commit is `3d643f5c` or a descendant that has not reverted slices 001–007. | The deployed SHA, and `git log 3d643f5c..<sha> -- backend/services/` reviewed for reverts. |
| 0.2 | Check out `3d643f5c` (or the deployed SHA) in a clean worktree and run the eight suites in §9. | Pass/fail counts verbatim. |
| 0.3 | Confirm A1–A5 are recorded and signed. | Approver, timestamp, tenant id. |
| 0.4 | Confirm `ADS_TRANSPARENCY_ACQUISITION_ENABLED` is **absent/off** unless A4 was explicitly granted. | The observed flag state. |

**Stop condition:** if 0.1 shows a revert, or 0.2 fails, the exercise is invalid — it would be
validating something other than the shipped slices. Abort and report.

### Phase 1 — select and freeze the subject

| Step | Action | Record |
|---|---|---|
| 1.1 | Select a tenant meeting §4 M1–M4. Record which of S1–S6 it meets and which it does not. | The S-list. Each unmet S is a slice that **will** come back `not_observed`; predict them now so the result cannot be rationalised afterwards. |
| 1.2 | Record the subject domain, `company_id`, and the current latest report id **before** generating. | Enables rollback-by-reference and tells you which report is new. |
| 1.3 | Record whether an ads evidence row exists for this `company_id` + `domain_id`. | Determines whether slice 006 is observable at all without A4. |

### Phase 2 — generate (level: *report generated*) — **requires A1**

| Step | Action | Record |
|---|---|---|
| 2.1 | `POST /api/reports/generate` with the subject's `companyId` and `domain`, `type=snapshot`. | HTTP status, the returned report id, the request timestamp. |
| 2.2 | Poll `GET /api/reports/<id>?type=snapshot` until status is terminal. | Final status, elapsed time, and **the HTTP status** — this, and only this, establishes *route reachable*. |

**Record *route reachable* here as its own line.** Do not let it stand in for anything else.

**Stop condition:** a non-terminal or failed status. A report that did not generate cannot
validate anything; record *report generated = NO* and abort. Do not retry more than twice, and
record each attempt.

### Phase 3 — capture three artifacts (level: *artifact present*) — **requires A2, A3**

The three captures are not interchangeable. Each carries surfaces the others do not.

| Capture | Source | Carries | Needed for |
|---|---|---|---|
| **C1 — persisted row** | `reports.data` for the report id (read-only). | `website_checks`, `digital_snapshot`, `advertising`, `competitor_intelligence`, `canonical.evidence_trace`, `company_identity`. | **The authoritative capture.** Slices 001–007. `competitor_intelligence` exists *only* here. |
| **C2 — API view payload** | `GET /api/reports/<id>?type=snapshot` (JSON). | camelCase `websiteChecks`, `digitalSnapshot`, `advertising`; sanitized. | What the app actually reads. Catches loss between the row and the UI. |
| **C3 — rendered document** | `GET /api/reports/<id>?format=html`. | The customer-visible HTML. | Slices 001 and 007 at the only layer the customer sees. |

Save each verbatim to the controlled location named in A2. **Do not normalise, reformat or
hand-edit them** — the harness accepts all three shapes precisely so no normalisation step can
quietly lose the thing being inspected.

> **Known structural gap, recorded here so it is not discovered as a surprise:** the HTML export
> path (`renderCanonicalReportHtml`) carries `competitive_tables`, not `competitor_intelligence`.
> Slice 003 is therefore observable on **C1 only**. If C1 cannot be captured, slice 003 must be
> reported as `surface_absent`, never as passing.

### Phase 4 — run the harness (levels: *behaviour observed* → *expected* / *unexpected*)

Offline. No production contact. From a worktree at the subject commit:

```js
// scripts/wp14-run.mjs — written at the gate, NOT committed here, since it names a capture path
const { validateReport1Artifact } = require('./backend/services/report1Validation/report1ArtifactAssertions');
const artifact = JSON.parse(readFileSync('<C1 path>', 'utf8'));
const html = readFileSync('<C3 path>', 'utf8');
const { findings, summary } = validateReport1Artifact(artifact, html);
console.log(JSON.stringify({ summary, findings }, null, 2));
```

Run it three times: **C1 + C3**, then **C2 alone**, then **C1 alone**. Differences between the
C1 and C2 runs are losses between the persisted row and the app, and are findings in their own
right.

Paste the full JSON output into the run sheet. **Do not summarise it by hand.**

### Phase 4b — THE PRIORITY SCENARIO: the null-baseline delta (WP-12)

The highest-value case in the exercise, because it is the only one backed by a **confirmed
production defect** rather than a hypothetical regression.

**The scenario to exercise:**

1. the company baseline is unavailable / null — after slice 003 it **always** is;
2. a competitor crawl **succeeds**;
3. that competitor therefore **has** metrics;
4. competitive delta / comparison processing **executes**;
5. Report 1 generation **completes** without the previous null-baseline `TypeError`.

**What WP-14 established, and at which level** — the two are kept strictly apart:

| Finding | Level | How |
|---|---|---|
| `computeCompanyMetrics` returns `null` for every input. | **behaviour observed** | Executed, real function — `report1NullBaselineDeltaContract.test.ts`. |
| A successful crawl yields non-null competitor metrics; a failed crawl yields `null` and short-circuits. | **behaviour observed** | Executed, real `resolveCompetitorMetrics`. |
| `subtractMetrics(metrics, null)` throws a `TypeError`. | **behaviour observed** | Executed, real function. |
| The one-sided guard, composed from those three real functions, throws on exactly these inputs. | **behaviour observed** | Executed — the defect reproduced with no stubs. |
| A composition failure does **not** crash generation and does **not** merely degrade the competitive section. | **code trace — NOT executed** | Read at this SHA. Sites named below. Re-verify by execution at the gate. |

**The containment trace** (read, not run):

| # | Site | Behaviour |
|---|---|---|
| 1 | `reportCompetitorIntelligenceServiceEngine.ts:459` (sync), `:722` (async) | `resolution.metrics ? subtractMetrics(resolution.metrics, companyMetrics) : null` — competitor guarded, company **not**. |
| 2 | same module | No `catch`; the `TypeError` propagates. |
| 3 | `snapshotReportService.ts` → `composeSnapshotReport` | `try { … } finally { … }` with **no catch**; the `finally` only closes the scan-budget ledger. Its own comment: the return is "Reachable only when the try completed without throwing". |
| 4 | `reportCardServiceAssembly.ts:440` | `catch (composeError)` → `console.warn('[reportCardService] composed report generation failed:', …)`. |
| 5 | `reportCardServiceAssembly.ts:442` | Rethrows **only** when `requestedCategory === 'performance'`. Report 1 is `snapshot`, so it is **not** rethrown. |
| 6 | `reportCardServiceAssembly.ts:207`, `:461` | Returns normally; `enrichComposedReportWithInputContext` returns `undefined` for an undefined input. |

> **CONSEQUENCE — and the reason check R-00 exists.** At this SHA a composition failure produces
> a report that **completes** and carries **no Report 1 payload at all**: not a crash, not a
> partial section, with the only trace a server-side `console.warn`. To a reader, and to a naive
> validation, that is indistinguishable from a tenant that simply had nothing to say.
> **This is exactly why `surface_absent` must never be read as a pass.** One absent surface is an
> abstention; every surface absent at once is an incident. `assertReport1PayloadPresent` (R-00)
> is the check that tells the two apart, and it is read **first**.

**Sync vs async.** The sync site (`:459`) passes `crawlOutcome: 'not_attempted'` with
`signals: null`, so `resolution.metrics` is always `null` and the expression short-circuits — the
module's own comment confirms that path observes no competitor. The **async** site (`:722`) is
the one that crawls, so it is the only site that reached the throw in practice. The gate must
therefore exercise a real snapshot generation with competitor discovery enabled.

**Steps at the gate:**

| Step | Action | Record |
|---|---|---|
| 4b.1 | Confirm the subject meets §4 **S5** (≥1 discoverable, crawlable competitor). Without it this scenario cannot be observed at all. | The competitor list and each `crawl_outcome`. |
| 4b.2 | Generate (Phase 2) and capture C1 (Phase 3). | As Phase 3. |
| 4b.3 | Run the harness and read **R-00 first**, before any other finding. | R-00 status verbatim. |
| 4b.4 | Read **C-07**. | C-07 status verbatim. |
| 4b.5 | Regardless of outcome, retrieve the generation logs and grep for `composed report generation failed`. | Present / absent, with the stack if present. |

**Pass / fail for this scenario:**

| Outcome | Verdict | Action |
|---|---|---|
| `R-00 = expected` **and** `C-07 = expected` | **PASS** — observed end to end and held: null baseline, successful crawl, metrics present, delta processing ran, deltas null, report complete. | Record; the risk is retired for this subject. |
| `R-00 = unexpected` (no payload) **and** the log shows `composed report generation failed` with a `TypeError` in `subtractMetrics` | **FAIL — the defect is live in the deployed build.** | **SEV-1.** Stop. The deployed SHA predates WP-12's fix, or it regressed. Escalate; do **not** regenerate — that destroys the evidence. |
| `R-00 = unexpected` with **no** such log line | **FAIL, different cause.** | Capture the log and escalate; something else emptied the payload. |
| `C-07 = unexpected` (a delta exists against a null baseline) | **FAIL.** A delta was computed from one observed side. | **SEV-1**, same family as C-04. Escalate. |
| `C-07 = not_observed` because no competitor crawl succeeded | **NOT OBSERVED** — not a pass. | Re-run on a subject meeting S5. Record which competitors were attempted and why each failed. |

**Do not** manufacture a competitor, inject metrics, or relax subject selection to make this
scenario produce a result. If no competitor is crawlable for the chosen subject, the honest
outcome is `not_observed` plus a second subject.

### Phase 5 — the two things the harness cannot decide

Two contracts cannot be settled from an artifact. They are listed as manual steps rather than
quietly omitted.

| Step | Action | Why the harness cannot do it |
|---|---|---|
| 5.1 | If `competitor_intelligence.comparison.company` is **non-null**, trace its producer by hand to `computeCompanyMetrics` and confirm it rests on observation. | Slice 003 forbids a *synthesized* baseline, not a baseline. The artifact cannot distinguish the two. The harness reports `C-01 = not_observed` and says so. |
| 5.2 | If the harness reports `D-05 = not_observed` with a conversion remediation present, read `digital_snapshot.opportunities` and determine whether any demand-generation opportunity existed. | "The dependency was dropped" and "no demand item reached the plan" are structurally identical in the plan alone. Only the opportunity list separates them. |

Record the conclusion of each with the evidence that supports it.

## 7. Pass / fail criteria, per item

The run has **one** overall verdict and **seven** per-slice verdicts. They are not the same
thing, and the overall verdict is never better than the weakest slice.

### Per-slice verdict

| Verdict | Condition |
|---|---|
| **PASS** | ≥ 1 `expected` finding for the slice and **0** `unexpected`. |
| **FAIL** | ≥ 1 `unexpected` finding for the slice. |
| **NOT OBSERVED** | 0 `expected` and 0 `unexpected` for the slice (only `not_observed` / `surface_absent`). |

**NOT OBSERVED is not a pass.** It means this exercise did not test the slice. Report it as an
open risk, unchanged, and state which tenant property (§4 S1–S6) was missing.

### Per-check criteria and failure response

| Check | Slice | Expected | On `unexpected` |
|---|---|---|---|
| `R-00` | — | A Report 1 payload reached the artifact (canonical + ≥1 surface). **Read this first.** | **SEV-1.** Every surface absent at once is the fingerprint of a thrown composition, not an abstention — see Phase 4b. Pull the generation log and grep `composed report generation failed`. |
| `C-07` | 003 | Null baseline + ≥1 successfully crawled competitor with metrics ⇒ every delta null, report complete. | **SEV-1.** A delta was computed against a baseline that was never observed. See Phase 4b. |
| `P-01` | 001 | No check carries `"...detected on the site"`. | **SEV-1.** The fabricated string means a pre-remediation engine produced this report. Confirm the deployed SHA (0.1); if correct, slice 001 regressed in production. Halt the exercise and escalate. |
| `P-03` | 001 | A detail stating absence never sits on `pass`. | **SEV-1.** This is the original defect verbatim, reaching a customer. Escalate; do not continue to other slices until triaged. |
| `P-04` | 001 | A `pass` names what was observed and over how many pages. | **SEV-2.** Either the engine's wording drifted or a pass is unsupported. Compare against `report1PresenceCheckIntegrity.test.ts`. |
| `P-05` | 001 | The seven state absence rather than abstaining when pages were read. | **SEV-2.** The fix degenerated into mass-abstention — the failure mode slice 001 explicitly guarded against. |
| `P-H1`/`P-H3` | 001 | No row renders "Observed" without a pass. | **SEV-1.** The false positive reached the customer-visible document, which is the whole point of slice 001. |
| `P-H4` | 001 | A pass renders as Observed. | **SEV-3.** The report understates an observation it did make. Not an integrity breach; still wrong. |
| `V-01` | 002 | No private provenance literal outside the exclusion record and `company_identity`. | **SEV-1.** Private evidence is being asserted on a public report. Capture the path, identify the producer, escalate. |
| `V-02` | 002 | Every verdict retains only the four public classes. | **SEV-1.** As above. |
| `V-03` | 002 | No retained evidence source is private. | **SEV-1.** As above. The path names the producer. |
| `V-04` | 002 | `report1Clean=false` always carries a non-empty exclusion list. | **SEV-2.** The verdict contradicts its own record; the exclusion machinery is half-wired. |
| `C-02` | 003 | The three uncrawlable dimensions are `null`, never `0`. | **SEV-1.** A zero is a measurement. Under `"strict": false`, `null` in arithmetic yields a number silently — this is the compiler hole slice 003 documented. |
| `C-03` | 003 | An `unavailable` competitor carries `null` metrics. | **SEV-2.** An unobserved competitor is being described. |
| `C-04` | 003 | A numeric delta requires both sides observed, and equals their difference. | **SEV-1.** The null-coerced-to-zero defect, reaching a customer-visible gap narrative. |
| `C-05` | 003 | No competitor mirrors the company on an uncrawlable dimension. | **SEV-1.** The mirroring path returned. |
| `C-06` | 003 | No gap without a company baseline. | **SEV-1.** A competitor's value is being republished as the gap. |
| `D-01` | 004 | Conversion remediation outranks every demand item by position **and** score. | **SEV-1.** The report tells a customer to buy more traffic for a site a visitor cannot act on. |
| `D-02` | 004 | Demand generation is re-sequenced, not stripped. | **SEV-2.** Over-correction; the customer loses legitimate work. |
| `D-03` | 004 | The conversion item admits it is not measurable from public evidence. | **SEV-2.** A fabricated measurement claim. |
| `D-04` | 004 | Conversion remediation leads `topPriorities`. | **SEV-2.** The headline contradicts the ordering. |
| `D-05` | 005 | `dependsOn="conversion_readiness"` reaches the plan, and only where earned. | **SEV-2** on `unexpected`. On `not_observed`, go to §5.2 before concluding anything. |
| `D-07` | 004 | No conversion-rate / session / visitor / bounce / CRM language. | **SEV-1.** Report 1 is claiming to observe visitors. |
| `A-01` | 006 | `PUBLIC_OBSERVED` / `ads_transparency`. | **SEV-1.** Provenance mislabelled on a public report. |
| `A-03` | 006 | Only `MATCHED` advertisers are attributed to the company. | **SEV-1.** The report is telling a company it runs ads that belong to someone else. |
| `A-04`/`A-05` | 006 | Counts agree with the arrays; no attribution without a legal name used. | **SEV-1.** Attribution is structurally unsound. |
| `A-06` | 006 | Ad counts stay provider labels, never integers. | **SEV-2.** `~40 ads` became `40` — false precision on a third-party approximation. |
| `S-01`/`S-05` | 007 | Never affirms the company does not advertise. | **SEV-1.** The single most damaging advertising claim the report can make. |
| `S-02`/`S-06` | 007 | No spend / CTR / ROAS / CAC / impressions / revenue. | **SEV-1.** A performance claim the Ads Transparency record cannot support. |
| `S-03` | 007 | An advertising decision rests on an `observed` read. | **SEV-1.** A failed read was treated as an observation. |
| `S-04` | 007 | The consideration never lands day one and never recommends spend. | **SEV-2.** A conditional question became a recommendation. |
| `S-07` | 007 | No internal resolution enum reaches the reader. | **SEV-3.** Cosmetic leak, no false claim — but it exposes an internal conclusion the customer cannot interpret. |

**Response to any SEV-1:** stop, preserve all three captures, record the finding path verbatim,
and escalate to the integration gate. Do **not** regenerate the report — regenerating destroys
the evidence that the defect occurred.

**Response to any `surface_absent`:** record which capture was missing and why. Re-capture if the
cause was the capture step; otherwise report the slice as NOT OBSERVED.

## 8. Run sheet — fill every row

```
RUN ID: ______________   DATE (UTC): ______________   OPERATOR: ______________
APPROVER (A5): ______________   AUTHORIZATIONS GRANTED: A1 [ ] A2 [ ] A3 [ ] A4 [ ]
DEPLOYED SHA: ______________   SHA == 3d643f5c or clean descendant? [Y/N]
TENANT: ______________   DOMAIN: ______________   REPORT ID: ______________
TENANT PROPERTIES MET: M1[ ] M2[ ] M3[ ] M4[ ] | S1[ ] S2[ ] S3[ ] S4[ ] S5[ ] S6[ ]
PREDICTED NOT-OBSERVED SLICES (from unmet S, recorded BEFORE the run): ______________

LEVEL LADDER — one line each, no line left blank:
  artifact present     C1 [ ]  C2 [ ]  C3 [ ]           bytes: ____ / ____ / ____
  route reachable      generate HTTP ____  fetch HTTP ____  html HTTP ____
  report generated     status: __________  pagesEvaluated: ____
  behaviour observed   slices with >=1 expected-or-unexpected finding: ______________
  expected behaviour   count: ____
  unexpected behaviour count: ____

HARNESS SUMMARY (paste verbatim):
  total ____ expected ____ unexpected ____ notObserved ____ surfaceAbsent ____
  slicesObserved: ______________   slicesNotObserved: ______________

PER-SLICE VERDICT:  001 ____  002 ____  003 ____  004 ____  005 ____  006 ____  007 ____
MANUAL STEPS:       5.1 conclusion ______________   5.2 conclusion ______________
C1-vs-C2 DIFFERENCES: ______________
SEV-1 FINDINGS: ______________
OVERALL VERDICT: PASS / FAIL / PARTIAL (slices NOT OBSERVED: ______________)
```

## 9. Supporting suites to re-run at the gate (offline, free)

These are the merged contract. They do not validate production, but a failure here invalidates
the exercise before it starts.

```
npx jest backend/tests/unit/report1PresenceCheckIntegrity.test.ts        --runInBand --forceExit
npx jest backend/tests/unit/report1ProvenanceBoundaryOrigin.test.ts      --runInBand --forceExit
npx jest backend/tests/unit/report1CompetitiveBaselineIntegrity.test.ts  --runInBand --forceExit
npx jest backend/tests/unit/report1ConversionDecisionIntegrity.test.ts   --runInBand --forceExit
npx jest backend/tests/unit/report1ConversionContractAndDependency.test.ts --runInBand --forceExit
npx jest backend/tests/unit/report1AdsIntegration.test.ts                --runInBand --forceExit
npx jest backend/tests/unit/report1AdvertisingDecision.test.ts           --runInBand --forceExit
npx jest backend/tests/unit/report1ArtifactAssertions.test.ts            --runInBand --forceExit
npx jest backend/tests/unit/report1NullBaselineDeltaContract.test.ts     --runInBand --forceExit
```

Do **not** run the whole suite: ~98 tests fail on `main` for unrelated pre-existing reasons and
that noise is not a signal about Report 1.

**Machine note.** This host has 4 logical CPUs and ~16 GB RAM, and `npm run typecheck` runs three
TypeScript projects at an 8 GB heap. Run the suites **one at a time**, and use
`node ./node_modules/jest/bin/jest.js <path> --runInBand --forceExit` — `npx` can hang here. Do
not run a full-repo lint or a full-repo Jest as part of this exercise.

## 10. What this plan CANNOT validate, under any authorization

Stated plainly so the gate does not over-read a green run.

1. **Slice 005's producer contract.** That `assessDigitalExperience` raises the no-conversion-path
   defect at `critical` is asserted by `report1ConversionContractAndDependency.test.ts` against
   crawl-shaped pages. The persisted artifact does not carry finding severities, so no artifact
   inspection can confirm it. It stays unit-verified.
2. **Slice 002 for sources that never appear.** The boundary is only exercised for origins the
   subject tenant actually has. A tenant with no declared data and no connected source leaves
   the exclusion path untested however green the run looks — hence §4 S2.
3. **The acquisition plane (PO-3).** This plan observes the *read* seam. Whether acquisition
   correctly resolves advertiser identity against a live provider is a different exercise with a
   different risk profile, and A4 is set to DENY by default.
4. **Any behaviour on a site that does not exhibit the precondition.** A site with all seven
   trust assets cannot demonstrate slice 001's false-negative guard; a site with a healthy
   conversion path cannot demonstrate slice 004's sequencing. One tenant will not observe all
   seven slices. **Expect a PARTIAL verdict and plan a second subject rather than stretching the
   first one's result to cover slices it never touched.**
5. **Anything about tenants other than the one run.** A single real report retires the
   "never observed on real data" risk for the behaviours it exercised, on one site. It does not
   establish a population property.
