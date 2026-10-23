# AMENDMENT ORDERING — the sequence that moves the aggregate once

**CLASSIFICATION: PREPARATION. This decides nothing and authorises nothing.** No commit, no registration, no
network call. `research/cpg-u1/**` and `C:/tmp/dt002` are unmodified.

**The governing fact.** Nothing is registered yet. `registration-fields` reads the tooling aggregate from disk
at run time (`cpg_u1_data.mjs:269` calls `toolingManifest(ROOT).aggregate`), so whatever the tree hashes to at
that moment simply becomes the registered value. **This is the only window in which the instrument or the
protocol may change at all.** After registration, every sampling command recomputes both hashes and aborts
(`cpg_u1_data.mjs:177-179`; `lib/harness.mjs:43-44`), and re-registering to fix it is **study VOID** because
`protocol_sha256` and `tooling_aggregate_sha256` are both in `SAMPLING_FIELDS` (`lib/registration.mjs:119`,
`checkAuthority` at `:140-145`). After the development commitment the aggregate is inside the OP_RETURN digest
(`lib/commitment.mjs:11`) and no lawful edit exists.

**The cost being sequenced.** Each time the aggregate moves, the full re-verification set is paid: selftest
(baseline measured **1022 passed, 0 failed, exit 0**), `test/mutate.mjs --anchors` (**389** anchors at
`f7699f05...`, each exactly once), the **full mutation run** with every mutant KILLED, `adapter_conformance`,
and a rebuild of the identity table in the eight dt004 documents that quote `f7699f05...`. The mutation run is
the expensive step. **Moving the aggregate three times costs it three times.**

---

## 1. The three pending things that all land on the same two identities

| # | Decision | Moves protocol sha | Moves aggregate | Files it touches |
|---|---|---|---|---|
| **DR-1** | drand relay-count floor — option (b) | no | **yes** | `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `README.md` (5); anchors 389 → 391 |
| **DR-2** | §19.3 certenv wording — option (b) (new protocol version as a new file) | **yes** | **yes if the version literal is renamed**, which §6.2 (line 446) requires for a substantive change | the protocol file; `lib/registration.mjs:9`; `test/selftest.mjs:1217, 1422` |
| **G** | two-human personnel design (this analysis) | **yes** | **yes** | `lib/personnel.mjs`, `lib/assignment.mjs`, `lib/reconcile.mjs`, `lib/ratings.mjs`, `lib/packets.mjs`, `lib/analysis.mjs`, `lib/registration.mjs`, `cpg_u1_data.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `rules/analysis_decisions.json`, `README.md` (12) |

They **overlap**: all three touch `test/selftest.mjs` and `test/mutate.mjs`; DR-2 and G both touch
`lib/registration.mjs` and both need the same new protocol file. **Done together, the aggregate moves once.
Done separately, three times.**

DR-2 option (b) already requires a new protocol version in a new file, which is exactly the vehicle a
two-human version needs. If the owner is going to do both, doing them in one file is nearly free relative to
doing either alone.

---

## 2. The correct order of operations

### Step 0 — decide whether to proceed at all (no cost, and the only decision that matters)

Read `CLAUSE_IMPACT_TABLE.md` §5. Eleven class-D rows. The decisive one is **D11**: a two-human CPG-U1 caps
the study at **Rung ≤ 2** with **no claim of independent validation**, in every outcome including SUCCESS.
Everything below is wasted effort if that ceiling is unacceptable. **This step is free; every later step is
not.** Decide it first.

### Step 1 — obtain the fresh owner approval (governance, before any byte moves)

CPG-042 A-1…A-6 are **recorded approvals** (§19.2, line 953: "**Approved for CPG-043**"). A two-human design
partially reverses them. A protocol version cannot un-approve a recorded human decision by drafting. The owner
must record, verbatim and on the record:

- approval to reduce personnel independence from seven mutually exclusive persons to two;
- acknowledgement of the forfeited claims: §22 #34 **PREVENTED → UNRESOLVED**, §23 claim (2) unsupported,
  evidence rung ≤ 2, no independent-validation claim;
- the new decision id for §19.2.

**Do this before any file changes.** It is free to obtain and it is the only thing that legitimises the rest.
If it is refused, stop here at zero cost.

### Step 2 — settle DR-1 and DR-2 in the same sitting

Both memos are written and both end in a clean two-or-three-way choice. Settle them now, because both move the
same identities:

- **DR-1:** (a) accept as procedural and disclose — aggregate unchanged; or (b) add the relay-count floor —
  aggregate moves, and a **second-order decision** comes with it: whether to bump `EVIDENCE_SCHEMA` from
  `cpg-u1-sampling-evidence/v1` to `/v2`, which is itself another aggregate-moving edit and changes every
  fixture-built bundle in the selftest (DR-1 §232). **Decide the schema bump in the same sitting or the
  aggregate moves twice inside DR-1 alone.**
- **DR-2:** (a) register as-is and disclose the divergence — nothing moves; or (b) new protocol version as a
  new file — which is the same vehicle as Step 4 below.

**Do not settle DR-1 or DR-2 after Step 4.** Either one arriving late re-runs the whole mutation set.

### Step 3 — settle every remaining decision that lives inside the aggregate

The aggregate covers **every** file of the tooling tree including `rules/` and `test/fixtures/`
(`lib/aggregate.mjs:8-22`, "vendored dependencies included"). So these are aggregate-moving decisions too, and
they belong here, not later:

- **AD-1…AD-9** in `rules/analysis_decisions.json`. **Already DECIDED** — 0 undecided, per `ERRATA.md` E-1,
  re-confirmed by direct read in this task (`status: "DECIDED"`, all nine carry values). The values are already
  inside `f7699f05...`. **No aggregate movement is pending from this source.** If the two-human design is
  adopted, the §12.4 resolution rule should be recorded as a **new** decision here (e.g. AD-10, the adversity
  order), which moves the aggregate — hence its place in this step, not later.
- Any further §24 canonicalization the owner wants.

### Step 4 — write the new protocol file ONCE, containing everything

One new file, one new version name, containing:

1. the DR-2 §19.3 wording resolution (if option b);
2. every class-C amendment of `PROPOSED_AMENDMENT_TWO_HUMAN.md` §2–§4;
3. the new §4A.4 (§5 of that draft), including the Rung-≤-2 ceiling stated, not evaded;
4. the rewritten §19.1, §19.2 (with the Step-1 approval id), §19.3, §20, §22, §23 and §24 rows;
5. every `PROTOCOL_MARKERS` string preserved verbatim — all twenty, listed in `REFREEZE_COST.md` §2.3. In
   particular **`cpg-u1-rater-order/v1`** and **`E ≥ 126 / 52 / 32`** must survive the edit, or
   `verify-protocol` fails.

**Protocol-004 is not edited.** It is preserved byte-identically and marked "must not be registered", exactly
as protocol-004 §0 line 5 does for protocol-003.

### Step 5 — change the tooling ONCE

All seventeen files in one pass — the five of DR-1(b) if taken, plus the twelve of G, which overlap:

`lib/registration.mjs` (the `PROTOCOL_VERSION` pin at line 9) · `lib/personnel.mjs` (`INDEPENDENT_ROLES`,
the fill and mutual-exclusion checks) · `lib/assignment.mjs` (`ASSIGNED_LABELS`, the three-distinct-people
check) · `lib/reconcile.mjs` (lines 34–41, 52–72: route a difference to `REFERENCE_CONFLICT`) ·
`lib/ratings.mjs` (replace the `RATING_ADJUDICATION_MISSING` throw with the §12.4 rule) · `lib/packets.mjs`
(the two packet builders become unreachable) · `lib/analysis.mjs` (two scorings; the `RATER-DISAGREEMENT-RESOLVED`
flag) · `cpg_u1_data.mjs` (the CLI paths at 641, 717, 953–1040) · `rules/analysis_decisions.json` (AD-10) ·
`README.md` · `test/selftest.mjs` (**including the duplicated version literal at line 1422 and the filename at
1217 — see the caution below**) · `test/mutate.mjs` (new anchors for the new guards).

**Leave `lib/raterOrder.mjs` alone.** Keeping all four `ORDER_LABELS` and both `ASSIGNMENT_LABELS` defined but
unused avoids one more changed file and leaves §12.1's derivation and the `cpg-u1-rater-order/v1` domain
untouched.

> **Measured caution.** Changing only `lib/registration.mjs:9` leaves the instrument RED — **1021 passed, 2
> failed, exit 1** — with the message "protocol does not state: CPG_U1_PROTOCOL_005", which points at the
> protocol when the defect is the duplicated literal in `test/selftest.mjs:1422`. The functional minimum is
> **two** files, not one. An operator given a one-line instruction will be misled.

### Step 6 — re-verify, in this order, and stop on the first failure

1. `node -e "…toolingManifest…"` — record the new aggregate. (Measured ladder for a bare version rename:
   `f7699f05…` → `ca976f1a…` at one file → `d4cb0522…` at two files. The full amendment lands somewhere else.)
2. `node cpg_u1_data.mjs verify-protocol --protocol <new file>` — must exit **0** and print the new protocol
   sha. Confirms all twenty markers survived.
3. `CPG_U1_RESOLVER_CLONE=<clean clone at f01a7eb4…> node test/selftest.mjs` — must exit **0**. Baseline for
   comparison: **1022 passed, 0 failed**.
4. `node test/mutate.mjs --anchors` — every anchor exactly once; the count rises from **389** by the number of
   new guards.
5. `CPG_U1_ADAPTER_CLONE=… CPG_U1_RESOLVER_CLONE=… node test/mutate.mjs --jobs 4` — **every** mutant KILLED.
   The expensive step, and not optional: the new personnel and reconciliation guards are worthless unkilled.
6. `CPG_U1_RESOLVER_CLONE=… node test/adapter_conformance.mjs`.
7. `node cpg_u1_data.mjs registration-fields --protocol <new file> --registry rules/development_only_registry.json --out reg.json`
   — the registered record now carries the new version, the new protocol sha and the new aggregate.
8. `node cpg_u1_data.mjs verify-registration --registration reg.json --registry …` — expect exit **4** with
   only the named human prerequisites BLOCKED and **zero ERRORs**. An ERROR here means Step 5 is incomplete.

### Step 7 — rebuild every document that quotes an old identity

`REGISTRATION_PACKAGE.md`, `OPERATOR_CHECKLIST.md`, `REMAINING_FIELDS.md`, `HEADER_AND_RELAY_SOURCES.md`,
`BITCOIN_RANDOMNESS_RUNBOOK.md`, `registration_record.DRAFT.json`, `DR1_DRAND_RELAY_FLOOR_MEMO.md`,
`DR2_CERTENV_WORDING_MEMO.md`, and `ERRATA.md`. Per `ERRATA.md` E-3, two of these filenames are git-ignored
(`.gitignore` lines 50 and 58: `*_CHECKLIST.md`, `*_RUNBOOK*.md`) and would need `git add -f` or renaming if
ever committed.

### Step 8 — the named human prerequisites, which nothing above supplies

Nine remain after `ERRATA.md` E-2: Bitcoin wallet-key custodian · accountable OSF identity · persistent
identifier type · persistent identifier value · `registration_id` · `registration_timestamp` · outpoints
(`O_dev`, `O_ho`) · checkpoint (height, hash) · `as_of`. Plus, for a two-human design, **the two people**, with
§4A.1 declarations and the developing organisation's written confirmation for each.

### Step 9 — registration, and the door closes

Funding confirmed (≥ 6 at the checkpoint) → **public OSF registration** → then and only then the frame. From
the moment `registration-fields` output is registered, neither identity may change again without voiding the
study.

---

## 3. What must NOT be sequenced late — the three traps

| Trap | Why it is a trap |
|---|---|
| Settling DR-1 or DR-2 **after** the two-human edit | Each is a separate aggregate movement and a separate full mutation run. DR-1's `EVIDENCE_SCHEMA` bump is a trap inside a trap: deciding it after DR-1(b) moves the aggregate twice inside one decision (DR-1 §232) |
| Recording the §12.4 adversity order (AD-10) **after** the tooling change | `rules/analysis_decisions.json` is inside the aggregate. A decision recorded later is another movement |
| Any edit **after** `registration-fields` has been registered | `cpg_u1_data.mjs:177-179` aborts every sampling command; re-registering is study VOID (`lib/registration.mjs:119, 140-145`); after the development commitment the aggregate is on the Bitcoin blockchain (`lib/commitment.mjs:11`) |

---

## 4. Minimum-cost summary

| Path | Aggregate movements | Full mutation runs |
|---|--:|--:|
| DR-1(a) + DR-2(a) + no two-human change | **0** | **0** — register at `f7699f05…` / `c50fc680…` as they stand |
| DR-1(b), DR-2(b) and the two-human version settled and applied in one pass | **1** | **1** |
| The same three applied as they are decided, one at a time | **3** | **3** |

**The aggregate moves once if and only if Steps 1–3 are all settled before Step 4 begins.**

---

## 5. Open questions only the owner can answer

1. **Is Rung ≤ 2 with no independent-validation claim acceptable?** If not, stop at Step 0. Nothing below has
   any value.
2. **Will the owner record a fresh approval partially reversing CPG-042 A-1…A-6?** A protocol version cannot
   give itself that approval.
3. **Is the §12.4 adversity order (`PROPOSED_AMENDMENT_TWO_HUMAN.md` §3.3) the owner's order?** It is
   pre-registered arithmetic, and any order is defensible only if fixed before data. Both scorings and every
   label pair are published so a reader may re-score under another order.
4. **Is the elevated INCONCLUSIVE risk accepted in advance?** Removing the reference adjudicator converts every
   Author/Confirmer disagreement into a `REFERENCE_CONFLICT` exclusion, which spends the §15.5(2) 90 %-VALID
   budget and the G1 fill count. §5.6's `capped` clause is the protocol's existing idiom for declaring elevated
   INCONCLUSIVE risk in advance; this needs the same treatment.
5. **DR-1: (a) or (b)?** And if (b), **is `EVIDENCE_SCHEMA` bumped to `/v2`?**
6. **DR-2: (a) or (b)?** If (b), it and the two-human version should be **one** file.
7. **Could a third independent person be found after all?** One more person restores the reference
   adjudicator **or** the rating adjudicator, but not both. If exactly three are available, which adjudicator
   is worth more? On this analysis the **rating** adjudicator is: removing the reference adjudicator is cheap
   because `REFERENCE-CONFLICT` already exists and routes to an exclusion, whereas removing the rating
   adjudicator required inventing §12.4 and rewriting the outcome ladder. Even with three, D5 (class-prediction
   blindness) and D6 (rater independence from reference truth) survive, so **Rung ≤ 2 still binds at three
   people.** The ceiling lifts only near seven.
