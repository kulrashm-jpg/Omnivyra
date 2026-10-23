# DR-11 — determined by CPG_U1_PROTOCOL_004, not by the owner

DEEPTECH-PARALLEL-014 · STREAM A · read-only analysis. **No code written. No run started. Nothing in
`C:/tmp/dt013-candidate/` touched. Protocol not modified.**

Protocol read at `C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md`,
SHA-256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **matches the expected value**,
1098 lines.

---

## 0. VERDICT

> **DOES THE PROTOCOL DETERMINE DR-11? — YES.**

The protocol requires the committed scan to determine, **per frame row**, that row's CPG-C1(1)/C1(6)
answer. A `scan.results` array carrying two results for one `candidate_id` does not determine that
answer — it offers two — so it is **malformed input by definition**, and the protocol's disposition for
malformed input is **refusal before any draw**, never silent repair. Refusing it is protocol compliance.

The protocol is *silent* only on **which** of the two results would win — and it is silent on that
because it never permits the question to arise. That silence is not a decision gap; it is the absence
of a permitted state. **No owner ruling is required to refuse a state the protocol does not permit.**

Consequence: `C:/tmp/dt013-final/orchestrator/DR11_STOP.md` is **correct on its own terms** (no owner
ruling exists, and one must not be inferred from a recommendation) but asked the wrong question. The
wave-014 directive's rule applies: *do not ask the owner to decide something that can be established
from the authoritative protocol.*

---

## 1. THE DEFECT, RE-MEASURED

`C:/tmp/dt013-candidate/tooling/cpg_u1_data.mjs:115` (the line has drifted from the `:233` of the DR-10
finding and from earlier DR-11 write-ups):

```
115:  const byId = new Map(scan.results.map((x) => [x.candidate_id, x]));
```

inside `contamination(o, frame, checked, frameHash)` — declared at `cpg_u1_data.mjs:109`, entered by
**four** commands, all of which therefore inherit the defect:

| Command | Call site |
|---|---|
| `commitment-payload` (`cmdCommitmentPayload`, :412) | `cpg_u1_data.mjs:420` |
| `draw-development` (`cmdDrawDevelopment`, :486) | `cpg_u1_data.mjs:490` |
| `size` (`cmdSize`, :527) | `cpg_u1_data.mjs:554` |
| `check-frame-sufficiency` (`cmdCheckFrameSufficiency`, :707) | `cpg_u1_data.mjs:710` |

`Map` construction from pairs keeps the **last** value for a repeated key, so a second result for an
already-seen `candidate_id` silently overwrites the first. Via `lib/select.mjs:93`
(`drawHeldOut` → `admissible.filter((c) => !ineligible.has(c.candidate_id) && …)`) a CPG-C1-contaminated
company enters the **held-out pool** and is then recorded as fact in the manifest, the §15.3 screening
log and the §9 seal.

**Why nothing catches it (re-verified in this tree):**

| Existing check | Why it misses |
|---|---|
| `if (!s) fail(\`scan has no result for ${r.candidate_id}\`)` (`cpg_u1_data.mjs:119`) | Catches a **missing** result. A collapsed duplicate returns a truthy result — the wrong company's. |
| `assertUnique` (`lib/select.mjs:44-51`) | Runs over the admissible **frame**, keyed on `identifier_scheme\|identifier_value` and `canonical_domain`. Never touches `scan.results`. |
| `loadFrame` duplicate guard (`cpg_u1_data.mjs:101`) + `refuseMalformed` (:129) | Guards the **frame**, not the supplied scan. A clean frame passes. |
| DR-10 refusal in `cmdScan` (`cpg_u1_data.mjs:312`) | Guards the **frame CSV given to `scan`**. It cannot see a scan artefact that was edited after `scan` produced it. |
| `scan.frame_hash !== frameHash` (:113), `scan.registry_sha256` (:114) | Both still **match**: the frame and registry are unchanged. Only `scan.results` was edited. |
| `hashRecords` | Never applied to `scan.results`. |
| `scan.results.length` vs `frame.length` | Never compared. |

**The committed hash does not help.** `scan_sha256` is `fileSha(scanPath)` (`cpg_u1_data.mjs:121`) — the
hash of the *edited* file. If the edit precedes the development commitment, the commitment binds the
tampered scan as authentic. §22 row 27 (`:1037`, "Post-randomness change of rows, scan or registry |
PREVENTED for committed artifacts") is not violated, because the change is **pre**-commitment. This is
precisely why the defect is silent rather than detectable.

---

## 2. THE GOVERNING TEXT

### 2.1 Primary — the scan must *determine* eligibility per row (§5.7.2)

`CPG_U1_PROTOCOL_004.md:383` — section tag:

```
383  #### 5.7.2 Frame sufficiency [NORMATIVE; DERIVED; APPROVED CPG-043]
```

`CPG_U1_PROTOCOL_004.md:385, 389-391`:

```
385  **Rule.** Before the development commitment, for each class c, the number `E_c` of **admissible,
     held-out-eligible** rows in F must satisfy:
...
389  - `E_c` is determined by §5.1–§5.4, using the scan committed in the development payload and the
     registered registry.
390  - If unmet, **no development commitment may be made**; enumeration continues first (enforced:
     `check-frame-sufficiency`, `commitment-payload`).
391  - A development commitment to an insufficient frame is **STAGE_VOID_FRAME_INSUFFICIENT**: the slot
     is consumed and there is no retry (enforced at `draw-development`).
```

`E_c` is a count of **rows**. It is *determined by* §5.1–§5.4 **using the scan**. A scan holding two
results for one `candidate_id` yields two different `E_c` values depending on which is read — so it does
not determine `E_c`. The protocol asserts determinacy for a quantity whose determinacy the input has
destroyed. That is the definition of malformed input, not a matter of taste.

Note also that §5.7.2 names by hand the *exact three commands* that reach the defect
(`check-frame-sufficiency`, `commitment-payload`, `draw-development`) as the enforcement points for this
determination, and `size` (the fourth) consumes the same `E_c`.

### 2.2 C1(1) is established per company, from that company's own tokens (§5.3, §5.4)

`CPG_U1_PROTOCOL_004.md:232`:

```
232  | **C1(1)** | Name, domain or identifier appears in a committed path within scan scope at the
     resolver SHA | Scanner (§5.4) |
```

`CPG_U1_PROTOCOL_004.md:257` (§5.4): tokens are *that row's* name, domain and identifier. A scan result
produced from company Y's tokens cannot establish C1(1) for company X. Under the collapse, it does
exactly that: `cpg_u1_data.mjs:120` reads `s.repository_hits` and `s.registry_matches` — Y's hits — and
writes them (or their absence) as X's `held_out_ineligible_basis`.

### 2.3 The forbidden end state is absolute (§5.3, §5.8)

`CPG_U1_PROTOCOL_004.md:228`:

```
228  A company is **held-out-ineligible** if **any** of the following holds. Ineligibility never excludes
     a company from research: it can only be drawn into development.
```

`CPG_U1_PROTOCOL_004.md:414` (§5.8, decision D-B):

```
414  Development is filled class by class: … Ineligible admissible companies not drawn are
     `DEVELOPMENT_SURPLUS` and **never enter held-out**.
```

"can only be drawn into development" and "**never enter held-out**" are unconditional. The defect
produces exactly the state both sentences forbid. A tool that produces a protocol-forbidden state from
input it accepted has an implementation defect, not an open design question.

### 2.4 Malformed input is refused before any draw, never repaired (§15.2, §5.1, §12.3)

`CPG_U1_PROTOCOL_004.md:851` (§15.2 disposition table):

```
851  | Malformed fixture | Refused at `frame`, **before** any draw |
```

`CPG_U1_PROTOCOL_004.md:212` (§5.1 Representation rules):

```
212  … **A blank cell is always malformed**, so an omission can never pass for a deliberate "not
     established". …
```

The collapse is exactly an *omission passing for an assessment*: the frame row's C1(1) question is not
answered from its own scan, yet the pipeline proceeds as though it were.

`CPG_U1_PROTOCOL_004.md:791` (§12.3, tagged `[NORMATIVE; APPROVED CPG-045]` at :783) states the
protocol's general posture on malformed artefact content, and forecloses the "merge/union the two
results" alternative:

```
791  - **Absent and malformed URLs.** … A `sourceUrl` that is present but is not an https URL is
     **refused** under the existing URL contract, and no packet is produced from that archive until the
     response is understood — it is never silently dropped or repaired.
```

"Refused … never silently dropped or repaired" is the rule. A union of the two results would be a
repair; picking first-wins would be a repair. Neither is available. **Refusal is the only compliant
behaviour**, which is why the protocol's silence on *which result wins* is not a decision gap.

### 2.5 `candidate_id` is required to be an unambiguous key, and duplicates on it are refused (§12.1, §5.7.1, §15.3)

`CPG_U1_PROTOCOL_004.md:744, 749` (§12.1, tagged `[NORMATIVE; DERIVED; APPROVED CPG-043]` at :738):

```
744    - `candidate_id` matches `[A-Za-z0-9_-]{1,64}` and `field` ∈ {…}, so the `|`-joined preimage is
       unambiguous.
749    - **Tie handling:** … Duplicate items are refused.
```

`CPG_U1_PROTOCOL_004.md:380` (§5.7.1):

```
380  - **Uniqueness** [enforced]: one row per legal entity. Duplicate identifiers or duplicate canonical
     domains are refused.
```

`CPG_U1_PROTOCOL_004.md:857` (§15.3 pre-execution screening log — a **write-once, sealed, published**
artefact, §13.2 at :809):

```
857  One row per frame candidate per stage: `candidate_id`, … `held_out_eligible`,
     `held_out_ineligible_basis`, `admitted`, … Written by the tool, write-once, sealed.
```

Each of the frame's candidates must carry **its own** `held_out_eligible` / `held_out_ineligible_basis`.
Under the collapse the sealed log asserts, as a published fact about company X, an eligibility derived
from company Y's scan. `screeningLog` at `cpg_u1_data.mjs:144-151` reads `basis[r.candidate_id]`, which
`contamination()` populated from the wrong result.

### 2.6 Corroboration from inside the tooling: the same rule is already implemented elsewhere

Not protocol text, but it shows how the instrument's own protocol-clause map reads these clauses.

`C:/tmp/dt013-candidate/tooling/lib/evaluation.mjs:5-8` (cited to §12, §13.1, §15.2):

```
5  // Completeness (B5): every held-out company appears exactly once … A company missing from both, a
7  // record no event names, a **duplicate**, a record of another run, stage or study, or a record whose
8  // hash differs from the logged hash is REFUSED. A company cannot be dropped silently.
```

implemented at `lib/evaluation.mjs:144`:

```
144    if (records.has(id)) throw new Error(`ARCHIVE_REFUSED ${id}: duplicate record`);
```

That is the *exact structural analogue* of DR-11 — a duplicate keyed on the company id inside a
**supplied** artefact — already refused, already cited to the protocol, already unmutated-around.
`tooling/README.md:198` maps it to protocol §§12, 13.1, 15.2. DR-11 is the one artefact (`scan.results`)
where this settled reading was never applied.

---

## 3. HOW THE TAGGED-ENFORCEMENT TEST WAS APPLIED

Wave 013's discriminator: the protocol **tags what it enforces** (`[NORMATIVE]`, `[enforced]`,
`(enforced: …)`, `[APPROVED …]`); an untagged rule among tagged neighbours is deliberately untagged, so
silence there is a real gap rather than an oversight.

Applied clause by clause:

| Clause cited | Tag present? | Verbatim tag |
|---|---|---|
| §5.7.2 heading (`:383`) | **YES** | `[NORMATIVE; DERIVED; APPROVED CPG-043]` |
| §5.7.2 enforcement (`:390`, `:391`) | **YES** | `(enforced: check-frame-sufficiency, commitment-payload)` · `(enforced at draw-development)` |
| §5.1 representation (`:200`, governing `:212`) | **YES** | `[enforced: checkFrameRow; exhaustive 81-combination test]` |
| §5.3 unestablished-contamination (`:239`) | **YES** | `[enforced]` |
| §5.3 frozen registry (`:245`, `:247`) | **YES** | `[NORMATIVE; APPROVED CPG-043]` · `(enforced: CLI refusal before commitment; VOID at chain verification)` |
| §5.5 single frozen frame (`:284`, `:287`) | **YES** | `[NORMATIVE; APPROVED CPG-043]` · `(enforced: CLI refusal before the held-out commitment; VOID at chain verification)` |
| §5.7.1 Uniqueness (`:380`) | **YES** | `[enforced]` |
| §12.1 `candidate_id` unambiguity (`:738`, governing `:744`, `:749`) | **YES** | `[NORMATIVE; DERIVED; APPROVED CPG-043]` |
| §12.3 refused-not-repaired (`:783`, governing `:791`) | **YES** | `[NORMATIVE; APPROVED CPG-045]` |
| §5.8 "never enter held-out" (`:412`, `:414`) | **NO per-rule tag** | heading reads only `(decision D-B)` |
| §15.2 malformed-fixture row (`:851`) | **NO per-rule tag** | plain table row |

**Result of the test.** Every clause on which the verdict actually rests — §5.7.2, §5.1, §5.3, §5.7.1,
§12.1, §12.3 — is **tagged**, most of them with an *explicit named enforcement point*. §5.7.2 goes
further and names three of the four defective commands as its enforcement points. The test therefore
**passes affirmatively**; it is not being invoked to excuse an untagged rule.

**Two untagged clauses are handled honestly.** §5.8 (`:414`) and §15.2 (`:851`) carry no per-rule tag, so
under wave 013's discriminator I do **not** rest the verdict on either. They are cited as *corroboration*
for two reasons: (i) §5 as a whole is declared normative at its own heading —
`CPG_U1_PROTOCOL_004.md:192`, `## 5. Dataset construction (normative; executed by independent people,
not by this document)` — so the absent tag marks "not separately tooling-enforced", not "not binding";
and (ii) §5.8 is in fact already implemented (`lib/select.mjs:93`), which demonstrates that an absent tag
does not mean the tooling is excused from the rule. Removing both clauses from the argument leaves
§§5.7.2 / 5.1 / 5.3 / 5.7.1 / 12.1 / 12.3 — still sufficient.

---

## 4. THE DERIVED REQUIRED BEHAVIOUR

> **Required behaviour.** A supplied `scan` whose `results` array contains more than one entry for the
> same `candidate_id` is **malformed and must be refused**, before any contamination basis is computed
> and therefore before any sufficiency check, sizing, commitment payload or draw. The refusal must
> **name every repeated `candidate_id`**, and must report **each occurrence's own contamination content**
> so the occurrence the old code dropped remains attributable. No artefact is written and no draw is
> performed. The refusal is **not** a VOID state: it is a pre-commitment refusal.

Derivation in one line each:

1. §5.7.2 `:389` — `E_c` must be *determined* by the scan; a duplicate makes it indeterminate ⇒ malformed input.
2. §5.3 `:232` + §5.4 `:257` — C1(1) is established from *that row's own* tokens; the collapse substitutes another row's.
3. §12.3 `:791` — malformed artefact content is *refused*, "never silently dropped or repaired" ⇒ no first-wins, no union.
4. §15.2 `:851` + §5.1 `:212` — refusal happens *before any draw*; an omission may never pass for an assessment.
5. §5.3 `:228` + §5.8 `:414` — the state the defect produces is unconditionally forbidden.
6. §15.3 `:857` + §13.2 `:809` — the sealed, published screening log must carry each candidate's own basis.

**Why this is not an owner decision.** The owner's own DR-10 ruling characterises the identical defect
shape as *no protocol clause at all*: `C:/tmp/dt009-closure/G-registration/DECISION_DISCLOSURES.md:277-280`
— *"### 3.2 The clause it touches — **None.** DR-10 touches no protocol clause. It is a defect in the
instrument's implementation of CPG-C1(1)/CPG-C1(6) contamination scanning, not a rule change."* An
implementation defect against an unchanged rule is resolved by conforming to the rule. (Cited as the
owner's *characterisation of the class*; the DR-10 ruling is **not** treated as a ruling on DR-11.)

---

## 5. MINIMAL IMPLEMENTATION SPECIFICATION (specification only — no code written)

**Location.** Inside `contamination()` in `cpg_u1_data.mjs`, **after** the `frame_hash` check (`:113`) and
the `registry_sha256` check (`:114`) and **immediately before** the `byId` construction (`:115`).

*Why there and nowhere else:* all four defective commands route through `contamination()`, so one guard
covers `commitment-payload`, `draw-development`, `size` and `check-frame-sufficiency` and cannot be
bypassed by a future command that forgets it. Placing it after the two hash checks preserves the existing
diagnostic precedence — a scan for the wrong frame still reports *that*, not a duplicate.

**Behaviour, in order.**

1. Tally occurrences of each `candidate_id` over **`scan.results`** (not over `frame`, not over `checked`
   — the frame is already guarded at `:101`/`:129`/`:312`; the supplied scan is the unguarded input).
2. Collect ids whose occurrence count is **> 1**, preserving first-appearance order.
3. If that collection is non-empty, for each repeated id write to **stderr**: the id, its occurrence
   count, and one line per occurrence giving that occurrence's ordinal index in `scan.results`, its
   `repository_hits` count with the first hit rendered as `<scope> <file>:<line>`, each of its
   `registry_matches` rendered as `CPG-C1(6) development-only registry <entry_id> (<matched>)`, and its
   `held_out_ineligible_by_scan` flag — or the explicit phrase for a benign occurrence.
4. Then call the existing `fail(...)` with a message that contains, verbatim and in this order: the
   count of repeated ids, the **scan file path** (`scanPath`), the phrase
   `duplicate candidate_id(s) in scan results`, and the instruction to re-run `scan` on the frame rather
   than edit the artefact.

**Exit code: 1** — i.e. `fail(msg)` with its default (`cpg_u1_data.mjs:68`,
`function fail(msg, code = 1)`; `EXIT.REFUSED = 1` at `:54`). **Not 6 (`EXIT.VOID`)** and not 2
(`EXIT.POOL`). Justification: §15.2 `:851` places malformed input at *refusal before any draw*, and the
existing sibling guard on the same artefact — `fail(\`scan has no result for …\`)` at `:119` — already
exits 1. `EXIT.VOID` is reserved for §5.10 states such as `STAGE_VOID_FRAME_INSUFFICIENT`
(`cpg_u1_data.mjs:498`), which describe a frame **already committed on chain**; nothing has been
committed here.

**Message-content requirement (load-bearing for the mutants).** The message must be textually distinct
from both `'scan was produced for a different frame (frame_hash mismatch) — re-scan the exact frame'`
(`:113`) and `'scan has no result for …'` (`:119`), and must name `scanPath` rather than `framePath`, so a
test can prove *which* guard fired.

**Deliberately out of scope** (and the reason, so this is not re-litigated):

- A `scan.results.length === frame.length` cardinality assertion, and refusal of results whose
  `candidate_id` is **not** in the frame. Neither is eligibility-bearing once duplicates are refused, and
  folding them in would broaden scan semantics — which the owner's DR-10 ruling forbids verbatim
  (*"scan semantics are not broadened beyond the defect"*). Recorded here as an **observation**, not a
  recommendation.
- Any change to `lib/select.mjs`, `lib/schema.mjs`, `lib/scan.mjs`, the protocol, the treatment, the
  evaluation tree or the registry.

---

## 6. THE FOUR RESERVED MUTANTS — M468 to M471

The reservation is real and contiguous: `tooling/test/mutate.mjs:524-526` reads
*"RESERVED, NOT ALLOCATED: M468-M471 are held for DR-11 (the cpg_u1_data.mjs scan `byId` collapse) …
The block is contiguous and empty so the later one-line DR-11 fix and its mutants land without
renumbering anything above."* Highest allocated id is **M467** (`mutate.mjs:523`); the array holds 441
entries; `M468` and `M471` appear only inside that comment. The four replace the comment; nothing above
renumbers.

Harness contract (`mutate.mjs:1-3`, `:33-38`): each entry is `["Mxxx description", FILE, from, to]`,
`from` must occur **exactly once** in `FILE` (`--anchors` enforces this), the mutation is applied to a
throwaway copy, and the mutant is **KILLED iff `test/selftest.mjs` then fails**. `CLI` is the existing
constant for `cpg_u1_data.mjs` (`mutate.mjs:29`).

### The fixture all four depend on (and the trap it must avoid)

**DUP-FIX-1.** A frame CSV with **unique** `candidate_id`s, one of whose rows is genuinely contaminated
(repository hits **and** a `DEV-001` registry match, as in the DR-10 fixture at `selftest.mjs:2659-2683`).
Run `scan` normally to produce a **valid** artefact. Then, as a separate fixture file, append to
`results` a **second, clean** entry for that same `candidate_id` (`repository_hits: []`,
`registry_matches: []`, `held_out_ineligible_by_scan: false`) — leaving `frame_hash` and
`registry_sha256` **byte-identical**, because the frame and registry are unchanged.

> **The trap.** If the fixture perturbs `frame_hash` or `registry_sha256`, the guards at
> `cpg_u1_data.mjs:113`/`:114` fire first. The test would then see "refused" for the wrong reason and
> **pass against all four mutants**, silently. Every killing assertion below therefore pins the **exact
> message** in addition to the exit code, and §6.5 adds an explicit negative control.

**DUP-FIX-0 (positive control).** The same artefact **without** the appended duplicate: every command
must exit **0**, and the contaminated company must be recorded ineligible with its `CPG-C1(1)` and
`CPG-C1(6)` bases — proving the guard does not simply refuse everything.

### 6.1 M468 — the DR-11 defect restored (guard deleted)

| | |
|---|---|
| Mutation | `["M468 DR-11 defect restored: a duplicate candidate_id in the supplied scan results is not refused", CLI, <the `if (<repeated>.length) fail(` head of the new guard>, `if (false) fail(`]` |
| Effect | `byId` collapses again; the last (clean) entry wins; the contaminated company becomes held-out-eligible. |
| **Failure mode without a good assertion** | The mutated command **succeeds, exit 0**, and silently emits a manifest. A `!== 0` assertion would catch that, but a *bare* "it refused" assertion in the **un**mutated direction would not distinguish this guard from `:113`/`:119`. |
| **Killing assertion** | Run `check-frame-sufficiency` on DUP-FIX-1 and require **all** of: exit code **exactly 1**; stderr matches `/duplicate candidate_id\(s\) in scan results/`; stderr contains the DUP-FIX-1 **scan** path; **and** — the decisive part — a second assertion that `draw-development` on DUP-FIX-1 exits **1** and that **no manifest file exists** afterwards, and a third that the contaminated `candidate_id` **does not appear** in any produced held-out manifest. Under M468 the first two assertions see exit 0 and an absent message; the third sees the contaminated id present. |

### 6.2 M469 — guard keyed on the frame instead of the supplied scan

| | |
|---|---|
| Mutation | `["M469 the DR-11 guard tallies the frame instead of the supplied scan results", CLI, <the `for (… of scan.results)` (or `scan.results.map/reduce`) head of the tally>, <the same construct over `frame`>]` |
| Effect | The guard **exists and compiles**, but tallies a collection already guaranteed duplicate-free by `loadFrame` (`:101`) and `refuseMalformed` (`:129`). It never fires for the DR-11 attack. This is exactly the DR-10 ↔ DR-11 distinction, made mechanical. |
| **Failure mode without a good assertion** | Identical to M468's surface behaviour — silent exit 0. An assertion phrased as "a duplicate is refused" that used a duplicate-bearing *frame* would pass, because `:101`/`:129`/`:312` still refuse that. |
| **Killing assertion** | The DUP-FIX-1 assertions of §6.1 **must use a frame with unique `candidate_id`s** — asserted explicitly in the test (`new Set(ids).size === ids.length`) so the fixture cannot silently regress into a duplicate-frame fixture. Then require exit **1** and the `duplicate candidate_id(s) in scan results` message. Under M469 the run exits 0 with no message. Retain the existing DR-10 assertions (`selftest.mjs:2676-2683`) unchanged as the complementary side. |

### 6.3 M470 — off-by-one: a plain pair passes, only triples refuse

| | |
|---|---|
| Mutation | `["M470 the DR-11 guard refuses only three or more occurrences, so an ordinary duplicate pair passes", CLI, <the `> 1` occurrence-count predicate>, `> 2`]` |
| Effect | DUP-FIX-1 — **two** occurrences, which is the entire attack — passes. Only a contrived triple refuses. |
| **Failure mode without a good assertion** | A test that only ever exercises a three-occurrence fixture would pass. |
| **Killing assertion** | DUP-FIX-1 must have **exactly two** occurrences of the repeated id, asserted in the test, and must be refused with exit **1** and the exact message; additionally assert the stderr occurrence report names **`2` occurrences** (`/DUPLICATE candidate_id \S+: 2 occurrences/` or the chosen wording) so the boundary is pinned at 2, not at 3. Under M470 the run exits 0. |

### 6.4 M471 — the dropped occurrence's contamination reason is not reported

| | |
|---|---|
| Mutation | `["M471 the DR-11 refusal does not report the dropped occurrence's contamination reason", CLI, <the per-occurrence reason expression, e.g. `why.length ? why.join(' ; ') : '<benign phrase>'`>, `''`]` |
| Effect | The refusal still fires with the right code and message, but the occurrence the old code silently dropped is no longer attributable — violating the DR-10 requirement adopted verbatim by the owner: *"a duplicate stays attributable to source file, source location where available, matched identifier/name/domain, and contamination reason"* and *"a contaminated occurrence must never vanish because an identical one was seen first"* (`DECISION_DISCLOSURES.md:263-268`). Directly mirrors the existing **M422** (`mutate.mjs:472`). |
| **Failure mode without a good assertion** | This is the mutant the brief's warning is about: exit code and top-level message are **unchanged**, so any assertion checking only "refused" / only the exit code **survives**. |
| **Killing assertion** | Assert on **stderr content**, not on the outcome: require `/record 1:[^\n]*CPG-C1\(6\) development-only registry DEV-001/` **and** `/record 1:[^\n]*CPG-C1\(1\) repository (TEST\|CPG_IMPLEMENTATION) \S+:\d+/` for the contaminated occurrence, **and** the benign-occurrence phrase for the appended clean one — mirroring `selftest.mjs:2680-2682`. Under M471 all three regexes fail while the exit code stays 1. |

### 6.5 Shared negative controls (guard the fixture, not just the guard)

Required alongside the four, and not attached to any single mutant:

1. **Wrong-guard exclusion.** On DUP-FIX-1, assert stderr does **not** match
   `/frame_hash mismatch/` and does **not** match `/scan has no result for/` — proving the DR-11 guard
   fired and the fixture did not accidentally trip `:113` or `:119`.
2. **Positive control.** DUP-FIX-0 exits **0** on `check-frame-sufficiency`, and the contaminated
   company's basis contains both `CPG-C1(1)` and `CPG-C1(6)`.
3. **All four entry points.** Assert exit **1** and the message for each of `check-frame-sufficiency`,
   `size`, `commitment-payload` and `draw-development` on DUP-FIX-1 — otherwise a future refactor that
   moves the guard out of `contamination()` into one command would pass.
4. **Fail-closed.** After each refusal, assert **no output artefact exists** (mirrors
   `selftest.mjs:2677`).

---

## 7. AGGREGATE IMPACT AND FILES TOUCHED

**The tooling aggregate MOVES. Yes.**

`lib/aggregate.mjs` computes `tooling_aggregate_sha256` over **every regular file of the tooling tree**,
sorted by path — matching §24 `:1088` (*"sha256 of `"<sha256>  <path>\n"` lines over every file of the
tooling tree (incl. vendored BLS and fixtures), sorted by path"*). Test files are inside that tree, so
the selftest and mutate changes move it too.

`tooling_aggregate_sha256` is a **mandatory registration field** — §5.5.1 `:297` and §19.1. After
registration it is fixed; a repair would require a second registration, and §5.5.1 `:300` makes a second
registration with differing sampling fields **study VOID**. So the fix is free now and **impossible
later** — the identical timing argument the owner accepted for DR-10
(`DECISION_DISCLOSURES.md:282-290`: *"tooling_aggregate_sha256 … YES … This is precisely why the fix is
free now"*).

**Files touched (3):**

| File | Change |
|---|---|
| `tooling/cpg_u1_data.mjs` | the guard in `contamination()` before `:115` (~8-12 lines incl. the occurrence report) |
| `tooling/test/selftest.mjs` | DUP-FIX-0 / DUP-FIX-1 fixtures + the §6.1-6.5 assertions |
| `tooling/test/mutate.mjs` | M468-M471 replacing the reservation comment at `:524-526` |

**Files NOT touched:** `CPG_U1_PROTOCOL_004.md`, `lib/select.mjs`, `lib/schema.mjs`, `lib/scan.mjs`,
`rules/development_only_registry.json`, the evaluation tree, the treatment, the registry. Therefore
`protocol_sha256`, `registry_sha256`, `provider_configuration_sha256`, the treatment commit and the
evaluation-tree aggregate are **all unchanged**.

`tooling/README.md` is **optional**: its protocol-clause map (e.g. `:198`) would read more completely with
a row for the scan-results uniqueness refusal, but omitting it changes nothing evidence-bearing. Adding it
would also move the aggregate — so if it is added, it must be added **in the same move**, not afterwards.

**No real artefact is affected**: no frame has been enumerated and no real scan produced, so no
`scan_sha256` or `frame_hash` of any study artefact changes.

**Sequencing.** This must land in the **same single aggregate move** as R28/R15/DR-12, exactly as
`DR11_STOP.md` argued. That argument was right; only its premise (that an owner ruling was needed first)
was wrong.

---

## 8. THE REGISTER — CONFIRMED SILENT (recorded for completeness; step 2 is moot)

The verdict rests on §2, so the register is not load-bearing. Confirmed anyway, and the trap avoided:

- Ruling-convention lines (`OWNER DECISION:` / `DECIDED:` naming an adopted option) exist in **six**
  places, naming **DR-1, DR-2 and DR-10 only** — `dt009-closure/orchestrator/DECISION_RECORD.md:19,40,53`
  and `dt009-closure/G-registration/DECISION_DISCLOSURES.md:31,137,243`.
- **No ruling names DR-11.** The only two DR-11 ruling-shaped lines are:
  - `C:/tmp/dt012-decisions/D3-D5/DR11_RESOLUTION.md:361` — **the known trap.** Inside a blockquote under
    `### EXACT WORDING TO RECORD`, and the same document states four lines above (`:355`) *"**YES.** No
    `OWNER DECISION:` or `DECIDED:` line naming DR-11 exists anywhere in the corpus."* **Proposed
    wording, not authority. Not relied on.**
  - `C:/tmp/dt013-final/orchestrator/DR11_STOP.md:17` — a **quotation of that trap**, presented there
    expressly as the trap. Not authority. Not relied on.
- `PMO-ADR-11` in `dt002/docs/pmo/OMNIVYRA-PMO-002.md` — unrelated namespace, **excluded**.

Corollary and the actual point of this stream: **register silence was never sufficient to escalate.** The
correct sequence is protocol first, register second. Applied in that order, DR-11 closes without the
owner.

---

## 9. RISKS

1. **The verdict is an interpretation, however well-grounded.** §5.7.2 `:389` does not contain the
   sentence *"scan.results contains exactly one result per frame row."* The conclusion is entailed by
   "determined by … using the scan" plus the per-company basis of C1(1) plus the refuse-never-repair rule,
   not stated. **Mitigation that costs nothing:** the fix is a *refusal*, the strictly conservative
   direction. If the owner later prefers first-wins or a union, the refusal has excluded no legitimate
   input — §5.4 `:257` notes the scan is conservative and a false positive only moves a company to
   development. A refusal cannot contaminate held-out; the collapse can. The asymmetry is total.
2. **Disclosure is still owed.** DR-11 is *protocol-determined*, not *invisible*. It should appear in the
   decision log and the OSF registration narrative in DR-10's form — as a **disclosure of a
   pre-registration instrument defect**, explicitly *not* as a protocol amendment and *not* as an owner
   decision. Drafting that wording is out of this stream's scope; flagging that it is required is not.
   Someone must also confirm this stream's reading before the aggregate is sealed — one reviewer reading
   §2 against the protocol, not a new wave.
3. **The residual hole DR-11 does not close.** If the scan artefact is edited to *replace* the truthful
   result rather than *append* a duplicate, nothing in the tooling catches it — `scan_sha256` is the hash
   of the edited file. That is the pre-existing §22 row 27 / §23 posture (*"attestation truthfulness not
   cryptographic"*; *"Tooling v4 trusted for: Implements this protocol"*), whose only defence is the
   outsider re-running `scan` per §21 steps 8-9 (`:1000-1001`). **DR-11 must not be described as closing
   it.** Worth confirming separately whether §21 step 9 obliges the outsider to *re-run* the scanner or
   merely to *re-use* the archived scan — if the latter, the residual hole is wider than the attack
   matrix implies. **Not a DR-11 blocker; a separate finding.**
4. **Fixture fragility is the real implementation risk.** The DUP-FIX-1 fixture must keep `frame_hash`
   and `registry_sha256` byte-identical. If it does not, all four mutants survive while the suite looks
   green. §6.5 control 1 exists solely to make that failure loud, and must not be dropped as redundant.
5. **Anchor uniqueness.** All four `from` strings must occur exactly once in `cpg_u1_data.mjs`
   (`mutate.mjs:33-38`). `> 1` (M470) and `if (false) fail(` (M468) are common substrings — the anchors
   must be widened with surrounding context. `mutate.mjs --anchors` verifies this **without** a mutation
   run, and is the only check this stream would recommend running.
6. **No mutation run was started and none should be** until the guard exists. 389/389 (now 393/393 with
   M468-M471) is not re-established by this document.

---

## 10. PROVENANCE

- Worktree `C:/tmp/dt4-corp`, base SHA **`af2fb6e99ce461894bf16f18c2251f75088eba18`**.
- Only path written: `research/deeptech-operations/prereg-014/dr11/DR11_PROTOCOL_DETERMINATION.md`.
- Read-only sources: `C:/tmp/dt013-candidate/CPG_U1_PROTOCOL_004.md` (SHA verified),
  `C:/tmp/dt013-candidate/tooling/**`, `C:/tmp/dt009-closure/**`, `C:/tmp/dt012-decisions/**`,
  `C:/tmp/dt013-final/**`.
- **DISPOSABLE.** Analysis artefact only. Nothing here is registered, committed elsewhere, or
  evidence-bearing.
