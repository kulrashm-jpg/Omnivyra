# VP-2 — jurisdiction-coverage gate: verification

**Wave:** DEEPTECH-PARALLEL-011, verification stream (directive §4)
**Candidate:** `C:/tmp/dt009-merge/tooling`, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files
**Protocol:** `C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md`
**Method:** static read of the candidate tree, plus one targeted read-only Node probe against a **scratch copy** of `lib/` (no write under `C:/tmp/dt009-merge`; no mutation suite, no selftest).
**Labels used:** VERIFIED / OWNER DECISION REQUIRED / BLOCKED / NOT EXECUTED

---

## 0. The prior wave's claim — independently confirmed

**Claim.** `frameSufficiency()` never reads `jurisdiction_family`; it counts only per-`expected_outcome_class`
minima, so a frame that is sufficient by outcome class may be wholly concentrated in one jurisdiction family
and pass.

**CONFIRMED — VERIFIED.**

`lib/frame.mjs:41-50` is the whole function. The only row field it reads is `expected_outcome_class`
(`lib/frame.mjs:45`) plus `candidate_id` for the ineligibility set:

```
lib/frame.mjs:44    for (const c of OUTCOME_CLASSES) {
lib/frame.mjs:45      const have = admissible.filter((r) => r.expected_outcome_class === c && !ineligible.has(r.candidate_id)).length;
lib/frame.mjs:47      if (have < FRAME_MINIMUM[c]) shortfall.push({ class: c, eligible_admissible: have, required: FRAME_MINIMUM[c] });
```

The string `jurisdiction` does not occur anywhere in `lib/frame.mjs` (whole-file grep, 50 lines).
`assertUnique` (`lib/select.mjs:44-51`), the only other row-level check inside `frameSufficiency`, reads
`identifier_scheme`, `identifier_value` and `canonical_domain` only.

A frame of 126 `fill-expected` + 52 `abstention-expected` + 32 `identity-hazard` rows
(`FRAME_MINIMUM`, `lib/frame.mjs:33-35`; asserted numerically at `test/selftest.mjs:742`) all carrying
`jurisdiction_family: 'US-SEC'` therefore returns `{ ok: true }`. Nothing downstream re-tests it (see §1).

---

## 1. Is the gate implemented anywhere in the candidate?

**VERIFIED — NO. The gate does not exist anywhere in the candidate.**

Whole-tree grep for `jurisdiction` (`--include=*.mjs --include=*.md --include=*.json --include=*.js`,
`node_modules` excluded) returns 22 hits. Every one is enumerated below with its role:

| file:line | role | is it a coverage gate? |
|---|---|---|
| `lib/schema.mjs:16` | `jurisdiction_family` declared as a FRAME_COLUMN | no — column declaration |
| `lib/schema.mjs:42-48` | `JURISDICTION_FAMILIES` — family → permitted identifier schemes | no — A3 scheme table |
| `lib/schema.mjs:50` | `FAMILY_ORDER = ['US-SEC','FR-SIRENE','BR-CNPJ','LEI-ONLY']` | no — round-robin order only |
| `lib/schema.mjs:104` | `jurisdiction_family` must be non-blank (malformed-row check) | no — per-row presence |
| `lib/schema.mjs:138-139` | admissibility A5: family accessible or `UNKNOWN` | no — per-row admissibility |
| `lib/select.mjs:4, 24-29` | `orderedClass()` interleaves families round-robin (decision D-A) | **no — ordering, not a floor** |
| `cpg_u1_data.mjs:135` | manifest entry records `jurisdiction_family` | no — recording |
| `cpg_u1_data.mjs:139, 152` | screening-log column `jurisdiction` | no — recording |
| `lib/packets.mjs:12, 37` | `jurisdiction_family` carried into reference/adjudication packets | no — recording |
| `templates/rules.json:15-30` | the family→scheme table, published | no — reference data |
| `test/selftest.mjs:128,163-165,171,250,267,806,1132,2373` | fixtures + A5/A3 assertions + one ordering assertion | see §6 |

`FAMILY_ORDER` — the only constant that could carry a coverage requirement — has exactly **two** consumers
tree-wide: its own declaration at `lib/schema.mjs:50` and the round-robin at `lib/select.mjs:29`. No third
reader exists, so no code compares realised family counts against anything.

There is also **no tally**: `cmdFrame` (`cpg_u1_data.mjs:205-225`) prints rows, malformed count, an
exclusion-reason tally, the attested-ineligible count, `frame_hash` and the attribution result. It does not
group by `jurisdiction_family`. Tree-wide grep for `coverage|composition|balance` over `lib/`, `harness/`,
`cpg_u1_data.mjs` and `test/` returns two hits, both unrelated (`lib/harness.mjs:17` provider-config file
paths; `lib/reconcile.mjs:81` a comment about stratum prediction).

---

## 2. Is it enforced — does anything refuse, or only warn?

**VERIFIED — NEITHER. There is no refusal and no warning.** Nothing is emitted at all.

For contrast, the outcome-class minimum *is* hard-enforced at the pre-commitment chokepoint:

- `cpg_u1_data.mjs:660` — `check-frame-sufficiency` calls `fail('FRAME_INSUFFICIENT: …')`.
- `cpg_u1_data.mjs:369-370` — `commitment-payload --stage development` recomputes sufficiency and
  `fail('FRAME_INSUFFICIENT: no development commitment may be made — …')`, so an insufficient frame cannot
  reach an on-chain commitment even if `check-frame-sufficiency` was never run.

No jurisdiction analogue of either line exists. Grep for `FRAME_INSUFFICIENT` shows exactly two call sites,
both the outcome-class one. A one-family frame produces byte-identical tool output to a four-family frame of
the same class composition.

---

## 3. Does it run before the frame is sealed, or after?

**VERIFIED — N/A; it never runs.** Recorded here because the *slot* where it would have to run is
unambiguous and currently unoccupied:

- the frame is frozen at the **development commitment**: `frame_hash` is a committed `PAYLOAD_KEYS` field
  (`lib/commitment.mjs:11-12`) written into the OP_RETURN payload (`cpg_u1_data.mjs:371-373`);
- after that, `cpg_u1_data.mjs:497` refuses any held-out frame whose hash differs
  (`FRAME_CHANGED … the single frame is frozen before the development commitment`), and
  `lib/sampling.mjs:151` returns `STAGE_VOID_BINDING_MISMATCH` on a held-out/development `frame_hash`
  divergence;
- therefore the only usable slot is alongside `sufficiencyOf` at `cpg_u1_data.mjs:369`, i.e. **before** the
  commitment. README places this as step `3a` ("BEFORE the development commitment", `README.md:54-55`).

Nothing occupies that slot for jurisdiction. Post-commitment insertion is impossible without moving
`frame_hash`, i.e. without voiding the commitment.

---

## 4. Is a minimum coverage requirement defined numerically anywhere, and by whom?

**VERIFIED — NO numeric jurisdiction minimum exists anywhere in the candidate or the protocol.**

Every numeric minimum in the candidate is per-outcome-class or per-stage, never per-family:

| constant | value | file:line | axis |
|---|---|---|---|
| `DEVELOPMENT_QUOTA` | 6 / 2 / 2 | `lib/schema.mjs:55` | outcome class |
| `HELD_OUT_BASE` | 12 / 5 / 3 | `lib/schema.mjs:57` | outcome class |
| `POOL_MULTIPLIER` | 2 | `lib/schema.mjs:59` | outcome class |
| `MAX_HELD_OUT_QUOTAS` | derived over 4096 pilot outcomes | `lib/frame.mjs:25-27` | outcome class |
| `FRAME_MINIMUM` | 126 / 52 / 32 | `lib/frame.mjs:33-35`; asserted `test/selftest.mjs:742` | outcome class |
| `FAMILY_ORDER` | 4 named families | `lib/schema.mjs:50` | **a list, not a floor** |

`FAMILY_ORDER.length === 4` is the only number in the tree that even mentions families, and it is consumed
only as a loop domain (`lib/select.mjs:29`), never as a required count. **Defined by nobody** — there is no
author to attribute the requirement to, because the requirement is not written down in code.

The nearest numeric statement is a **test** assertion, not a gate: `test/selftest.mjs:250` asserts
`…map(c => c.jurisdiction_family)).size === 4` for the `fill-expected` slice of one synthetic held-out draw.
That is an assertion about `orderedClass`'s behaviour on a deliberately balanced synthetic frame, and it
constrains no production frame (see §6).

---

## 5. Is the requirement traceable to Protocol-004?

**VERIFIED — NO. Protocol-004 contains no jurisdiction-coverage minimum. VP-2 as a coverage *gate* is an
operator-added control with no protocol basis.**

The protocol's only NORMATIVE statement on the axis is the decision-D-A bullet in the §5.7 bullet list
(`CPG_U1_PROTOCOL_004.md:379`, formally inside subsection §5.7.1 whose heading is at `:355`; the §5.7
"Ordering, tie-breaking, pool minimum" heading is at `:333`). It is quoted in full:

> `CPG_U1_PROTOCOL_004.md:379` — "**Jurisdiction balance** (decision D-A) [NORMATIVE]: within each class,
> families are interleaved round-robin in the fixed order `US-SEC, FR-SIRENE, BR-CNPJ, LEI-ONLY`, each
> family's queue in rank order. An exhausted family stops contributing and the others continue. **The
> realised jurisdiction composition is published**, and missing families are declared as a scope limitation."

Read plainly, this requires three things and **no minimum**: (a) round-robin interleaving — implemented at
`lib/select.mjs:28-35`; (b) publication of the realised composition; (c) *declaring missing families as a
scope limitation*. Clause (c) is the protocol explicitly **contemplating and permitting** a frame that is
missing families — which is the opposite of a gate. A gate would make (c) unreachable.

Two further protocol passages put the matter beyond doubt:

> `CPG_U1_PROTOCOL_004.md:965` — limitation §20.1: "Small, clustered, exploratory; no population, customer or
> **jurisdiction generalisation**."
> `CPG_U1_PROTOCOL_004.md:967` — limitation §20.3: "Four accessible jurisdiction families; identity
> resolution is under-tested elsewhere."

The protocol's declared posture is that jurisdiction breadth is a **known limitation to be published**, not a
property to be enforced. Grep for `jurisdiction` across all 1000+ protocol lines returns 10 hits
(`:167, :206, :208, :212, :214, :379, :569, :574, :830, :857, :965, :967`); none states a minimum
family count, a minimum per-family row count, or a refusal condition.

**Separate finding, OWNER DECISION REQUIRED.** Clause (b) of §5.7.1 — "The realised jurisdiction composition
is published" — is itself **NOT implemented**. No command computes or prints a family tally (§1). The raw
data is recorded (§8), so an outsider can compute it, but the tool does not publish it. Whether "published"
is satisfied by "derivable from the published screening log" is an owner call, not a verifier call. This is a
gap against a `[NORMATIVE]` protocol clause and is distinct from the (nonexistent) VP-2 minimum.

---

## 6. Is it testable — does any test in `test/` exercise it?

**VERIFIED — NO test exercises a jurisdiction-coverage gate, because there is nothing to exercise.**

All nine `jurisdiction`-bearing lines in `test/selftest.mjs` are accounted for:

| file:line | what it tests |
|---|---|
| `test/selftest.mjs:128, 806, 1132, 2373` | fixture construction — sets `jurisdiction_family` on synthetic rows |
| `test/selftest.mjs:163` | A5 `UNKNOWN` family → `A5_NOT_ESTABLISHED` (per-row admissibility) |
| `test/selftest.mjs:164` | A5 `GB-COMPANIES-HOUSE` → `A5_INACCESSIBLE_JURISDICTION` (per-row) |
| `test/selftest.mjs:165` | A3 wrong scheme for family → `A3_INVALID_IDENTIFIER` (per-row) |
| `test/selftest.mjs:171` | blank family → malformed row (per-row) |
| `test/selftest.mjs:267` | duplicate canonical domain refused (uniqueness, not coverage) |
| `test/selftest.mjs:250` | `orderedClass` round-robin reaches all 4 families **on a balanced synthetic frame** |

Only `:250` touches breadth, and it is a behavioural assertion about the ordering function given a frame that
already contains all four families. It would pass unchanged if a coverage gate were deleted, and it fails to
detect a one-family frame because such a frame is never constructed in the test.

The sufficiency tests (`test/selftest.mjs:742-773`) cover the outcome-class axis exhaustively — exact minimum,
one-short shortfall, ineligible rows excluded, class re-labelling, duplicate refusal — and **none** varies
`jurisdiction_family`.

**Mutation coverage: NONE, structurally.** `test/mutate.mjs` carries one sufficiency mutant,
`test/mutate.mjs:180` (`M131 sufficiency off by one`, `FRAME_MINIMUM[c]` → `FRAME_MINIMUM[c] - 1`). There is
no jurisdiction mutant, and there cannot be one: a mutation suite can only mutate code that exists. The
389/389-killed and 404-mutant certification results therefore say **nothing** about VP-2 — a passing mutation
score is not evidence that this gate works, because the gate is not in the mutant population.

**Stronger form of the same finding — the round-robin itself is not mutation-certified.**
`test/mutate.mjs` carries **404** mutants (`grep -cE '^\s*\['` over the file = 404, matching the
"404-mutant" suite). Grep over `test/mutate.mjs` for `jurisdiction`, `FAMILY` and `orderedClass` returns
**zero** hits. The six `lib/select.mjs` mutants (`test/mutate.mjs:54-59`: M14, M15, M16, M17, M18, M19) target
held-out eligibility, the pool multiplier, the development cap, domain uniqueness and the rank key — **none**
touches `orderedClass` (`lib/select.mjs:28-35`). So decision D-A, the one jurisdiction behaviour the protocol
*does* require (`CPG_U1_PROTOCOL_004.md:379`), is exercised by exactly one selftest assertion
(`test/selftest.mjs:250`) and by **no mutant at all**. Deleting the round-robin and returning `byRank(candidates, seed)`
would change the drawn sample, so some assertion would likely fail — but that is an inference, not a
certified result (see *Not executed*).

---

## 7. Does the VOID path cover a coverage failure?

**VERIFIED — NO. There is no VOID state, and no other terminal state, for a coverage failure.**

The complete terminal-state inventory:

- `lib/sampling.mjs:28-36` — `VOID_REGISTRATION`, `VOID_PRE_REGISTRATION_SPEND`, `VOID_MALFORMED`,
  `VOID_CROSS_SPEND`, `VOID_BINDING`, `VOID_REORG`, `VOID_RANDOMNESS`
- `lib/execution.mjs:13-16` — `STUDY_VOID_PREVIEW`, `STUDY_VOID_UNAUTHORIZED_EXECUTION`,
  `STUDY_VOID_POST_WINDOW_EXECUTION`, `STUDY_VOID_REPEATED_EXECUTION`
- `lib/harness.mjs:42, 66` — `STUDY_VOID_REGISTRATION`, `STUDY_VOID`
- `lib/analysis.mjs:29, 123-128` — `AD-7 ∈ {INCONCLUSIVE, VOID}`; a VOID study reports no endpoint

None names coverage, jurisdiction, family or breadth. Note also that the **outcome-class** failure is not a
VOID either: it is a pre-commitment `fail()` (`cpg_u1_data.mjs:370, 660`), which is the correct design — the
frame is fixed before any chain event, so a shortfall is refused rather than voided. A coverage gate, if
added, would belong in the same class of refusal, and likewise would need no new VOID state. The absence of a
VOID state is therefore **not** the defect; the absence of the refusal is.

One adjacent route exists and is worth recording so it is not mistaken for coverage enforcement:
`lib/analysis.mjs:127` routes a **declared** protocol violation to `AD-7 = VOID`. A one-family frame is not a
protocol violation under §5.7.1 (which permits missing families, §5), so this route does not fire, and the
operator would have nothing to declare.

---

## 8. Is coverage recorded in the frame artefact so an outsider could check it post hoc?

**VERIFIED — YES, the per-row data is recorded and the tally is recomputable; NO, the tally itself is never
computed or published.**

Per-row `jurisdiction_family` is recorded in four independent places, and three of them are hash-sealed:

1. **The frame CSV itself** — `jurisdiction_family` is FRAME_COLUMN index 3 (`lib/schema.mjs:16`;
   header at `templates/candidate_frame.template.csv:1`).
2. **Inside `frame_hash`, hence on-chain.** `frame_hash = hashRecords(frame, 'candidate_id')`
   (`cpg_u1_data.mjs:104`) → `canonicalRecords` → `canonicalJson` over the **whole** record object
   (`lib/canonical.mjs:7-21`, `Object.keys(value).sort()` — no field subset). `frame_hash` is a committed
   `PAYLOAD_KEYS` field (`lib/commitment.mjs:11-12`) written into the OP_RETURN payload
   (`cpg_u1_data.mjs:372`). So the realised composition is cryptographically bound to the Bitcoin
   commitment, and an outsider holding the frame CSV can prove the tally is the committed one.
3. **The screening log** — column `jurisdiction`, one row per candidate per stage
   (`cpg_u1_data.mjs:139` `LOG_COLUMNS`; populated at `cpg_u1_data.mjs:152` from `r.jurisdiction_family`),
   written write-once by both draw commands (`cpg_u1_data.mjs:466`, `:561`) and sealed via
   `screening_log_sha256` (`cpg_u1_data.mjs:632-633`). This matches the protocol's own screening-log column
   list (`CPG_U1_PROTOCOL_004.md:857`, which names `jurisdiction`).
4. **Every manifest entry** — `entry()` carries `jurisdiction_family` (`cpg_u1_data.mjs:133-137`), and
   reference/adjudication packets carry it too (`lib/packets.mjs:12, 37`).

So post-hoc checkability is **good**: the axis is auditable, and tamper-evident. What is missing is only the
derived statement. No artefact contains a field such as `jurisdiction_composition`, and no command prints one
(§1, §5 separate finding). An outsider must run their own `GROUP BY` over the screening log — which
`CPG_U1_PROTOCOL_004.md:991` ("Sampling-integrity verification procedure (outsider)") does not instruct them
to do.

---

## Decision: is VP-2 a code gate, an operator procedure, or absent?

**ABSENT as a gate. It is, at most, an undocumented operator expectation.** VERIFIED.

- Not a **code gate**: no implementation (§1), no refusal, no warning (§2), no numeric requirement (§4), no
  test (§6), no terminal state (§7).
- Not an **operator procedure** in any auditable sense either: `README.md`'s step list (`README.md:50-66`)
  and the `README.md:195-220` protocol-coverage table contain no jurisdiction-coverage row, and the protocol
  prescribes no operator check — §5.7.1 asks the operator to *publish* the composition and *declare* missing
  families (`CPG_U1_PROTOCOL_004.md:379`), not to reject a frame. There is no checklist item, runbook step or
  attestation field anywhere in the candidate that an auditor could tick.
- It is therefore **absent**: a control that exists only in the wave record's description of itself.

### Is the record's "operational, no aggregate cost" claim true?

**Half true, and the true half is true for the wrong reason. OWNER DECISION REQUIRED.**

- **"No aggregate cost" — TRUE, and verified.** Nothing was added, so aggregate
  `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` is untouched. The reason is simply that
  no code was written, not that a cost-free implementation was found.
- **"Operational" — NOT SUPPORTED.** The word implies a control discharged by procedure. There is no
  procedure: no README step, no protocol operator duty, no checklist, no attestation. Calling it
  "operational" records an intention, not a control.
- **"Silently depends on code that does not exist" — the specific question asked: NO, with one
  qualification.** VP-2 does not *depend* on absent code in the sense of a dangling call, a dead branch or a
  reference that fails at runtime: `frameSufficiency` is self-consistent, and no caller expects a
  jurisdiction verdict from it. There is no latent crash and no silent pass-through of a check that was
  supposed to run. The qualification is that the **round-robin it relies on is load-bearing and blind**:
  `orderedClass` (`lib/select.mjs:28-35`) distributes *whatever families the frame contains* and a family
  that runs out "simply stops contributing" (`lib/select.mjs:25-26`). On a one-family frame, round-robin
  degenerates to plain rank order and emits nothing — so the mechanism the protocol names as the balance
  mechanism silently provides zero balance, and no artefact says so. That is the real residual exposure, and
  it is an exposure of *disclosure*, not of code correctness.

**Bottom line for the record:** VP-2 should be re-labelled from "operational, no aggregate cost" to
"**not implemented; jurisdiction breadth is an undisclosed property of the enumerated frame, auditable post
hoc from the sealed screening log but never asserted, published or gated**". The aggregate claim survives;
the control claim does not.

---

## What closing VP-2 would require, and at what cost

*Stated for the owner's decision only. No change is proposed and none was made.*

### Minimum viable closure — code

1. A per-family floor constant beside the class minima (`lib/schema.mjs`, near `:50-59`).
2. `frameSufficiency` extended to count `jurisdiction_family` per class and return a coverage shortfall
   (`lib/frame.mjs:41-50`) — a signature/return-shape change, since `shortfall` entries are currently
   `{class, eligible_admissible, required}` and are formatted by `describeShortfall`
   (`cpg_u1_data.mjs:652`).
3. Enforcement at both existing chokepoints: `cpg_u1_data.mjs:660` (`check-frame-sufficiency`) and
   `cpg_u1_data.mjs:369-370` (`commitment-payload --stage development`). Enforcing at only one leaves the
   other as a bypass.
4. A published tally, to close the §5.7.1 clause-(b) gap as well (`cmdFrame`, `cpg_u1_data.mjs:213-216`,
   and a manifest/seal field).
5. Tests: positive control, one-family negative control, per-class boundary
   (`test/selftest.mjs`, near `:742-773`) and at least one mutant (`test/mutate.mjs`, near `:180`).

Roughly 3 lib/CLI files + 2 test files. Small in lines; not small in consequence.

### Cost — the part that matters

**Any of the five items above moves the tooling aggregate, including item 5 alone.**
`toolingManifest` (`lib/aggregate.mjs:8-23`) walks **every regular file of the tooling tree**
(`lib/aggregate.mjs:19` `walk(root, '')`; `:15` includes every file; vendored dependencies included per
`:3`). Adding only a test, or only a comment, changes `aggregate`. There is no "test-only, aggregate-free"
option.

Consequences, in order of severity:

1. **`638d68e6…` is void as a candidate.** A new aggregate must be computed, and the 404-mutant
   certification suite plus the selftest must be re-run from scratch against it. The suite **currently
   running** against this tree would be certifying a superseded artefact.
2. **If the aggregate has already been registered, this is a re-registration.**
   `tooling_aggregate_sha256` is a `SAMPLING_FIELDS` member (`lib/registration.mjs:119`). `checkAuthority`
   then bites twice: a second registration naming different sampling fields yields
   `duplicate registration … names different sampling fields — study VOID` (`lib/registration.mjs:141`), and
   the earliest registration remains the authoritative one (`lib/registration.mjs:136`), so the new
   registration is **not authoritative**. Closing VP-2 after registration is not a patch; it is a restart of
   the registration.
3. **Post-commitment it is impossible.** `frame_hash` is committed on-chain
   (`lib/commitment.mjs:11-12`; `cpg_u1_data.mjs:372`), and a changed frame is refused
   (`cpg_u1_data.mjs:497`, `:765`) or voids the binding (`lib/sampling.mjs:151`). A gate cannot be applied
   retroactively to a committed frame.
4. **A protocol amendment is arguably required, not merely permitted.** A per-family floor is not derivable
   from §5.7.1 — it *contradicts* its clause (c), which instructs the operator to declare missing families
   as a scope limitation (`CPG_U1_PROTOCOL_004.md:379`). Introducing a refusal where the protocol prescribes
   a declaration is a normative change, so `protocol_sha256` — also a `SAMPLING_FIELDS` member
   (`lib/registration.mjs:119`) — would move as well, compounding consequence 2.

### The cheap alternative, for completeness

Closing only §5.7.1 clause (b) — *publish* the realised composition, refuse nothing — is a strictly smaller
change (a tally in `cmdFrame` plus a manifest field), is *required* by a `[NORMATIVE]` protocol clause rather
than contradicting one, and needs no protocol amendment. It still moves the aggregate (consequence 1, and 2
if registered). It would convert VP-2 from an absent gate into a genuine disclosure, which is what the
protocol actually asks for. **Not proposed — recorded as the owner's lower-cost option.**

---

## Not executed

- **The 404-mutant certification suite and the full selftest were NOT run** (firewall: a suite is running
  against `C:/tmp/dt009-merge/tooling`). Not needed for any verdict above: every finding here is an absence
  established by exhaustive grep plus line-level reading, and an absence cannot be demonstrated by a passing
  suite. Indeed §6 shows the suite is *structurally incapable* of covering VP-2.
- **NOT EXECUTED — whether decision D-A's round-robin is in fact protected by the existing suite.** Verified
  statically: no mutant targets `orderedClass` (§6). **What would verify it:** on a scratch copy, replace
  `lib/select.mjs:28-35` with `byRank(candidates, seed)` and run the selftest, checking whether
  `test/selftest.mjs:250` or any draw-determinism assertion fails. Requires a selftest run, so **not done**
  here. Until it is, the protocol's only NORMATIVE jurisdiction requirement has no certified guard.

- **NOT EXECUTED — end-to-end confirmation that a real one-family frame of 126/52/32 rows passes
  `check-frame-sufficiency` and `commitment-payload` in the actual CLI.** The static argument is complete
  (`lib/frame.mjs:45` reads only `expected_outcome_class`; `cpg_u1_data.mjs:369, 660` are the only
  enforcement points), but a live demonstration would require building a 210-row synthetic frame and running
  two CLI commands against the tree. **What would verify it:** on a scratch copy of the tooling tree, build a
  210-row frame with all rows `jurisdiction_family: 'US-SEC'`, `identifier_scheme: 'CIK'`, distinct CIKs and
  domains, and run `node cpg_u1_data.mjs check-frame-sufficiency` plus
  `node cpg_u1_data.mjs commitment-payload --stage development`. Expected: both succeed. Cost: two
  single-command runs, no mutation, no selftest. Deferred here only to stay well inside the CPU firewall.
