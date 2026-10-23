# Personnel automation audit — what the frozen instrument checks, and what it does not

**DEEPTECH-PARALLEL-008 / stream H (personnel automation).**
**CLASSIFICATION: PROPOSAL / ENGINEERING ARTIFACT.** Not U1 evidence, not independent validation, not a
registered artefact. No U1 company was executed, no enumeration performed, no network call made, no key
created, no identity or declaration invented. Every identity named below is synthetic (`SYN-P-*`,
`.example`). **No byte of the frozen instrument was changed.**

## Baselines re-verified for this document

| Item | Value | How |
|---|---|---|
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum /c/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md` |
| Instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | `toolingManifest()` over `C:/tmp/dt002/research/cpg-u1/tooling`, **593 files** |
| Registered tree, re-checked after all work below | `f7699f05…` (unchanged) | recomputed at the end of the session |

**Trap recorded.** This worktree contains its own `research/cpg-u1/tooling`, a **stale 587-file tree** whose
aggregate is `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`. It loads and runs, and it
produces a *self-consistent wrong* aggregate — nothing in it announces that it is stale. Every tool in
`tools/` therefore refuses to run unless `CPG_U1_TOOLING` recomputes to `f7699f05…`
(`tools/instrument.mjs:69-71`), and the instrument was read **only** from `C:/tmp/dt002`.

---

## The headline gap, stated once

The frozen instrument validates `enumerated_by` **as text and nothing else**, and **no frozen command reads a
frame and a personnel register together.** `enumerated_by` occurs in exactly two places in the whole 593-file
tree:

```
lib/schema.mjs:32    'enumerated_by',                                       # a column name
lib/schema.mjs:124   if (!r.enumerated_by.trim()) errors.push('enumerated_by is required');
```

(`grep -rn enumerated_by --include=*.mjs lib/ harness/ rules/` returns those two lines and no others.)

So a frame row may be attributed to a person who holds no role, holds a *different* role, is the operator, or
does not exist, and the instrument will accept it. The instrument's **own self-test proves this**: its
Omnivyra regression fixture at `test/selftest.mjs:2260` reads

```js
enumerated_by: 'cpg-implementer-NOT-INDEPENDENT', enumerated_at: '2026-09-16',
```

and the very next assertion is

```js
const oc = checkFrameRow(omni);
ok(oc.errors.length === 0, 'OMNIVYRA: honest-unknown record is no longer malformed');
```

**Verified.** A row whose attribution names, in plain text, a person who is *by that text* not independent is
`errors.length === 0`. The field is unchecked against anything. (Independently reproduced as `T01`/`T01b` in
`tools/test_bind.mjs:46-55`.)

The instrument **already has the pattern** for closing this, just not for the frame. `lib/assignment.mjs:19`
takes an optional register and binds each rater label to it:

```js
export function checkRaterAssignment(a, { personnel } = {}) {          // :19
  …
  if (personnel !== undefined) {                                        // :34
    const reg = checkPersonnelRegister(personnel);                      // :35
    for (const l of ASSIGNED_LABELS) {
      const holders = (personnel?.assignments ?? []).filter((x) => x.role === l).map((x) => x.person_id);
      if (holders.length !== 1 || holders[0] !== m[l]) errors.push(…);   // :39
    }
  }
```

and `cpg_u1_data.mjs:945` supplies it: `checkRaterAssignment(a, { personnel: readJson(need(o, 'personnel')) })`.
`cmdFrame` (`cpg_u1_data.mjs:204-217`) takes no such option. **The precedent exists for raters and was not
extended to enumerators.** That asymmetry, not a missing idea, is the gap.

---

## Capability 1 — `enumerated_by` against the personnel register

**What the frozen tooling already does.** Only `lib/schema.mjs:124`, quoted above: a non-blank-string test.
Nothing else. No cross-reference, no role check, no operator check.

**What I built outside it.** `tools/bind.mjs:79` `checkFrameAttribution(rows, reg, deps)`, driven by the CLI
`tools/frame_attribution_check.mjs`. It parses the frame with the **frozen** `parseCsv`/`checkFrameRow` and the
register with the **frozen** `checkPersonnelRegister`, then refuses, per row, in row order, reporting every
offending row rather than the first (`bind.mjs:85-96`):

| Refusal | Line | §|
|---|---|---|
| blank attribution | `:88` | §5 |
| leading/trailing whitespace — never silently trimmed into a match | `:89` | — |
| not `person_id`-shaped | `:90` | §4A.3 |
| a placeholder (`UNASSIGNED`, `TBD`, `operator`, …) is not a person | `:91` | workflow Step 3 |
| **attributed to the operator** | `:92` | §4A.2(c), §4A.3 |
| holds a **different** role — and the role is named | `:94` | §4A.2(d) |
| **not in the register at all** | `:95` | §4A.2 |

It is pure: no clock, no RNG, no network, no write to its inputs; `at`/`date` fields are read, never generated
(`bind.mjs:10-12`).

**What would require a frozen-byte change.** Making the *frozen* `frame` command itself refuse. See
**STOP-condition analysis** below. Nothing about capability 1 requires it in order to be *enforced* — it is
fully enforceable outside the tree as a pre-registration gate — but the frozen command will keep printing
`frame rows: N  malformed: 0` for a frame attributed to nobody, and anyone who runs only the frozen command
will see a pass.

## Capability 2 — distinctness of Enumerator A and Enumerator B

**What the frozen tooling already enforces** (`lib/personnel.mjs`):

```js
:24   const n = assignments.filter((a) => a.role === role).length;
:25   if (n === 0) blockers.push(`role ${role} is UNFILLED`);
:26   else if (role !== 'enumerator' && n > 1) errors.push(`role ${role} must be held by exactly one person`);
…
:34   if (holder.has(a.person_id)) errors.push(`${where}: ROLE COLLISION — ${a.person_id} already holds
        ${holder.get(a.person_id)}; all independent roles are mutually exclusive`);
```

`:26` permits `n > 1` **only** for `enumerator` (§4A.3 "Several enumerators are permitted"); `:34` raises
`ROLE COLLISION` when a `person_id` repeats in **any** role, which also catches the same person listed twice as
an enumerator; `:33` keeps the operator out of every independent role. **This capability is largely already
mechanical, and I say so in the tests** (`test_bind.mjs:83` is labelled `T11 ALREADY MECHANICAL`).

**What I added.** `tools/bind.mjs:52` `checkEnumeratorDistinctness`, which examines the enumerator ids **as a
set** — something the frozen check never does, because it iterates assignments one at a time:

1. `BLOCKED` when the register assigns **nobody** the enumerator role (`:55`). The frozen check does emit a
   blocker here (`personnel.mjs:25`), so this is defence in depth, not a new finding.
2. A malformed or **placeholder** enumerator id (`:57-58`).
3. **The prefix rule** (`:65-66`) — the genuinely new rule:

```js
} else if (sorted[i].startsWith(sorted[i - 1])) {
  errors.push(`ENUMERATOR ID PREFIX COLLISION: ${sorted[i - 1]} is a prefix of ${sorted[i]} — the
    candidate_id namespaces derived from them are not disjoint`);
```

**Why a prefix matters.** `candidate_id` namespaces are *derived* from `person_id`, not supplied:
`dt007-eight-person/C-partition-tooling/partition/partition.mjs:87` is
`export const prefixFor = (personId) => `${personId}-`;` (verified verbatim). If one enumerator's namespace is a
prefix of another's, two enumerators can mint colliding `candidate_id`s, which `cpg_u1_data.mjs:99` then rejects
as duplicate rows **after the enumeration work is already done** — the worst possible time. The frozen check
accepts `SYN-P-ENUM` alongside `SYN-P-ENUM-B` with zero errors (`test_bind.mjs:90-91`, `T13`).

**Honest limitation — the rule is a deliberate over-approximation, not an exact one.** Because `prefixFor`
appends a `-` separator, the namespaces of `X` and `XY` are `X-` and `XY-`, which do **not** overlap. My guard
compares the *ids*, not the derived prefixes, so it flags that pair too. Measured:

| pair | namespaces actually overlap | my guard flags |
|---|---|---|
| `X` / `XY` | no | **yes** (over-refusal) |
| `X` / `X-1` | **yes** | yes |
| `SYN-P-1` / `SYN-P-12` | no | **yes** (over-refusal) |
| `SYN-P-1` / `SYN-P-1-A` | **yes** | yes |
| `A` / `B` | no | no |

The exact rule is "`b` starts with `a + '-'`"; mine is "`b` starts with `a`", a strict superset. I am keeping
the broader rule and disclosing it rather than narrowing it: these tools only ever **refuse** — they never
repair, rewrite or proceed — so a fail-closed over-approximation costs the operator nothing but choosing
non-prefix pseudonyms, whereas the narrow rule has a sharp edge at the separator. `test_bind.mjs:97-98`
(`T16`) bakes the broad behaviour in deliberately. **A reader who wants the exact rule must change
`bind.mjs:65`, and that is a change to my tool, not to the instrument.**

**What would require a frozen-byte change.** Nothing. The equality and role-collision halves are already in
the instrument; the prefix rule is an *additional* pre-registration convention about how pseudonyms are
chosen, and is satisfied by choosing them well. No frozen byte is implicated.

## Capability 3 — declaration currency

**What the frozen tooling already does.** One line, and it is a string test:

```js
lib/personnel.mjs:37
for (const k of DECLARATION_KEYS) if (d[k] !== 'no')
  errors.push(`${where}: declaration ${k} must be "no" (got ${JSON.stringify(d[k])}) — not independent`);
```

This correctly implements §4A.1's "An unknown answer is not 'no'" — `'unknown'`, `''` and a missing key all
fail. But the register carries **no notion of when a declaration was signed, or of what roster it was signed
against**, so the frozen checker **cannot detect a declaration signed before the roster changed.**

**Why that is a real hole and not a formality.** §4A.1 item 6 excludes a person who

> is the spouse or partner, a family member or a household member of, or has a current or former direct
> reporting relationship with, any person who developed CPG, the operator (key custodian), **or any holder of
> another §4A.3 role**.

The clause quantifies over *the other role holders*. **The question a declaration answers therefore changes
whenever the roster changes.** Add an eighth person, or swap `rater-2`, and every previously signed item-6
declaration answered a question about a different set of people. The frozen checker sees seven `"no"` strings
and reports 0 errors either way.

**What I built outside it.** `tools/bind.mjs:110` `rosterDigest` and `:125` `checkDeclarationCurrency`, driven by
`tools/declaration_currency_check.mjs`. The digest is domain-separated and covers the operator and every holder
*with its role*, order-independently:

```js
:113-116  .sort((x, y) => { const a = `${x.person_id}\u0000${x.role}`; … })
:117      const body = { operator: reg?.operator?.person_id ?? null, holders };
:118      return sha256(`${ROSTER_DIGEST_DOMAIN}|${canonicalJson(body)}`);
```

Each holder re-affirms against a digest; `:142` raises `STALE DECLARATION` on a mismatch, `:145` **BLOCKS** a
holder with no declaration bound to any roster ("nothing is assumed on their behalf"), `:146` rejects a stray
entry for a non-holder, `:138` rejects a double re-affirmation. Domain separation and the role field are both
mutation-tested (`mutate_bind.mjs`: "roster digest loses domain separation", "…drops each role",
"…drops the operator", "…comparator always ties").

**The tolerance question, verified independently.** I re-ran the check myself against the frozen
`checkPersonnelRegister` with synthetic ids. Results — all five scenarios **0 errors, 0 blockers**:

| # | Register | errors | blockers |
|---|---|---|---|
| 1 | 7-person baseline | 0 | 0 |
| 2 | + unknown **root-level** keys (`roster_digest_sha256`, `as_of`, `totally_unknown_root_key`) | 0 | 0 |
| 3 | + unknown **per-assignment** keys (`declared_against_roster_sha256`, `unknown_assignment_key`) | 0 | 0 |
| 4 | **8-person register, two enumerators** | 0 | 0 |
| 5 | 8-person **+ roster-hash fields at both levels** | 0 | 0 |

**Confirmed:** `checkPersonnelRegister` validates only the keys it names — it has no "exactly these keys"
check (contrast `lib/assignment.mjs:22`, which *does* enforce `Object.keys(a).length !== KEYS.length` and would
have rejected an added field). So **a roster-hash field can be added to the restricted register with no
instrument change and therefore no change to the aggregate.**

**Does my design rely on that? No — and this is worth being exact about.** `checkDeclarationCurrency` reads a
**separate sidecar** (`CURRENCY_SCHEMA = 'cpg-u1-declaration-currency/v1'`, `bind.mjs:24`), so the currency
record lives entirely outside the register and the tolerance is not load-bearing for me. The tolerance matters
as a *second available option*: an operator who would rather carry `signed_against_roster_sha256` inside the
restricted register, next to the declaration it qualifies, can do that, and the frozen checker will accept it.
I verified that (row 5) so the choice is open rather than assumed. **Both routes leave the aggregate at
`f7699f05…`.**

**What would require a frozen-byte change.** Nothing, for detection. Making the *frozen* `check-personnel`
command refuse a stale declaration would require teaching `lib/personnel.mjs` the roster digest — a frozen-byte
change, and unnecessary, because the sidecar check is a pre-registration gate that produces the same refusal.

## Capability 4 — role eligibility

**Most of this capability is not mechanically checkable at all, and the instrument says so in its own voice.**
`lib/personnel.mjs:1-3`:

> Personnel register checks (CPG_U1_PROTOCOL_004 §4A). The register itself is restricted; the tooling checks its
> **STRUCTURE**: every independent role filled, seven roles mutually exclusive, the operator in none, every
> §4A.1 declaration answered "no", and the §4A.1 evidence fingerprints present. **It cannot verify that
> declarations are true.**

§4A.3 repeats it for the CLI ("`check-personnel` verifies structure … It cannot verify that declarations are
true"), and §20.23 makes it a published limitation: "Personnel independence rests on declarations and
organisational confirmation (§4A.1), not on verifiable proof. The tooling checks the register's structure only."

Being explicit about the two families the task names:

**§4A.1 item 6's relational exclusions are NOT mechanically checkable.** Spouse, partner, family member,
household member, current or former direct reporting relationship — these are facts about human relationships
outside every artefact the study holds. No file records them; no tool can observe them. The declaration answer
is the *only* checkable surface, and checking it verifies that a `"no"` was written, not that it is true. What I
made mechanical is strictly narrower and I do not overclaim it: item 6's **roster dependence** (capability 3) —
*which* set of people the answer was given about — is now checkable. Its **truth** is not, and cannot be.

**§4A.2(a) and (b) are NOT mechanically checkable either**, because both are conditions on what a person has
done or seen:

- (a) "not have implemented CPG, this protocol, the tooling or the development-only registry" — a fact about
  authorship history. Git history names commit identities, not study pseudonyms, and the register is
  pseudonymous by design (§4A.1 "a pseudonymous ID is used in study artifacts"), so the two namespaces cannot
  be joined without breaking the pseudonymity the protocol requires.
- (b) "not have run CPG or seen any CPG output (including the development pilot and instrument check) before
  completing the frame" — a fact about a person's **knowledge**. Nothing observable distinguishes an enumerator
  who saw pilot output from one who did not. What *is* mechanical is the information **barrier** around the
  inputs (dt007 `partition.mjs` `barrierViolations`): a tool can refuse to *hand* an enumerator a file
  containing CPG output. It cannot establish what they already saw.

`tools/bind.mjs:156` `ELIGIBILITY` is the honest table — 18 rows, each marked `true`, `false` or `'partial'`
with the reason and the citation; `tools/eligibility_matrix.mjs` prints it. It **decides nothing**
(`bind.mjs:153`: "This table is documentation the tools print; it decides nothing"). Of the 18 rows, 8 are
mechanical, 2 partial, 8 not mechanical.

**What would require a frozen-byte change.** Nothing — and nothing *could* help. This capability is bounded by
the world, not by the tooling. A frozen-byte change cannot make a declaration true.

## Capability 5 — assignment boundaries against a partition allocation

**What the frozen tooling already does.** Nothing. There is no frozen notion of an enumeration allocation at
all; the partition schema `cpg-u1-enumeration-allocation/v1` is a dt007 artefact, not an instrument one. The
frozen tree contributes only the **domain constants** — `FAMILY_ORDER` and `OUTCOME_CLASSES` from
`lib/schema.mjs`.

**What I built outside it.** `tools/bind.mjs:183` `checkAllocationBoundaries`, driven by
`tools/allocation_boundary_check.mjs`. It refuses to guess the domain (`:185-187`) — the families and classes
must be passed in from the frozen constants, so the tool "can never validate against a domain the instrument no
longer defines" (`:180-181`). Against that domain it refuses: a cell allocated twice (`:217`), a cell allocated
to nobody (`:221`), a cell outside the domain (`:216`), an **idle** enumerator allocated no cell (`:213` — "an
allocated person with no work is not an allocation"), a person allocated twice (`:203`), the **operator**
allocated work (`:205`), a non-enumerator or unregistered allocatee (`:206-210`, naming the role actually held),
and a **registered enumerator left out of the allocation entirely** (`:222`). Both directions are checked:
allocation → register and register → allocation.

**What would require a frozen-byte change.** Nothing. The instrument defines no allocation to validate, and the
one thing it does supply — the domain — is *read*, which is the correct dependency direction.

---

## STOP-condition analysis: did any capability require editing the frozen tree?

*(`tools/frame_attribution_check.mjs:10` refers to this section as "§6"; that comment predates this
document and its numbering. This is the section it means.)*

**No STOP condition fired.** All five capabilities are **enforceable outside** `C:/tmp/dt002/research/cpg-u1/tooling`
as pre-registration gates, and no frozen byte was changed. The registered aggregate was recomputed after all work
and is still `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` over 593 files.

One capability has a **conditional** frozen-byte cost, and the condition is a choice about *who runs what*, not
about feasibility. **If** the operator wants the frozen `frame` command itself to refuse an unattributed frame —
rather than relying on a separate tool being run — then `frame` needs a `--personnel` option, which means editing:

> **`C:/tmp/dt002/research/cpg-u1/tooling/cpg_u1_data.mjs`, `cmdFrame`, lines 204-217** — specifically an
> insertion after **line 206** (read `--personnel`, run the frozen `checkPersonnelRegister`, build the enumerator
> set) and after **line 210** (refuse a row whose `enumerated_by` is not in that set).

**I did not do it.** To quantify the cost I applied that patch to a **scratch copy** at
`…/scratchpad/frozen-scratch/tooling` (a `cp -r` of the registered tree, which reproduced `f7699f05…` over 593
files *before* the edit, confirming the copy was faithful). The patch is a 13-line addition to one file, adds no
file, and parses (`node --check`). The resulting aggregate is:

```
before:  f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd   (registered, 593 files)
after:   8d67ddd74f3000ba948f98a5c8185a461bf3488699c376ffb904430b66ad2786   (scratch only, 593 files)
```

**§19.1 lists "Tooling aggregate SHA-256; development-only registry SHA-256" among the items that must be *in
the registration*, "computed by `registration-fields`".** The aggregate is fixed at registration and is then
checked against it: **§21** (sampling-integrity verification procedure, for an outsider) step 2 is
"`verify-protocol` and `verify-registration` (protocol, **tooling aggregate** and registry hashes; authority;
completeness)", and §13.2A puts "protocol and tooling files" in the mandatory sampling archive. Therefore **adoption must precede registration or never happen**: after
registration, this edit cannot be made without invalidating the registered aggregate and failing
`verify-registration`, and the study would have to be re-registered. There is no later window. The same applies
to any other frozen-byte adoption contemplated here.

(For precision: the tooling aggregate is *not* one of the items bound into the §13.2 dataset seal — that seal
binds the manifests, screening logs, sizing, blind records and reconciled reference file. The aggregate is
pinned by the **registration** (§19.1) and, per **§7.1** (evaluated software identity), "the tooling and harness
that run the study are pinned separately by the tooling aggregate (§19.1), and a change to them never changes
the evaluated resolver identity" — distinct from the resolver identity at `f01a7eb4`.)

The scratch copy is disposable and is **not** the instrument; `C:/tmp/dt002` was never written to, and
`git status` in this worktree shows no path under `research/cpg-u1/**`.

---

## Classification summary

| # | Capability | Already mechanical (frozen) | Added outside | Frozen-byte change needed |
|---|---|---|---|---|
| 1 | `enumerated_by` → register | **No** — `schema.mjs:124` non-blank only; no cross-reference anywhere | `checkFrameAttribution` (7 refusals) | **Only** to make the frozen `frame` command itself refuse — `cpg_u1_data.mjs:206,210` |
| 2 | Enumerator A ≠ B | **Mostly** — `personnel.mjs:26` (n>1 enumerator only), `:33`, `:34` ROLE COLLISION | set-level checks + the **prefix** rule (fail-closed superset) | No |
| 3 | Declaration currency | **No** — `personnel.mjs:37` tests the string `"no"`; no roster, no time | `rosterDigest` + `checkDeclarationCurrency` (sidecar) | No — sidecar, or a tolerated extra register field |
| 4 | Role eligibility | **Structure only** — `personnel.mjs:25,33,34,37,38,39` | the honest `ELIGIBILITY` table; decides nothing | No — and none would help |
| 5 | Allocation boundaries | **Nothing** (no frozen allocation notion; supplies the domain) | `checkAllocationBoundaries`, both directions | No |

## Verification: mutation coverage of the decision-bearing comparisons

Every refusal above is a comparison that could silently stop working. `tools/mutate_bind.mjs` breaks each one
in turn, in a temp copy of `tools/`, and re-runs the suite: a comparison whose removal the suite does not notice
is not verified. The harness prints each verdict as it is reached, so an abrupt death can never be read as a
score, and it re-runs an apparent survivor twice more in isolation before reporting it (a prior agent in this
programme ran `taskkill /F /IM node.exe` across all node processes, which can make a healthy mutant look like a
survivor).

**First pass: 47 mutants — 42 KILLED, 2 SURVIVED, 3 NOT_APPLIED.** Reported honestly, then each closed:

| First-pass finding | Cause | How it was closed |
|---|---|---|
| SURVIVED `placeholder enumerator id tolerated` | `bind.mjs:58` was genuinely unreached: `T05` tested a placeholder in a frame **row**, never in the **register** | `T18b`/`T18c` added — the guard is real and useful, so it was made reachable, not deleted |
| SURVIVED `malformed ids enter the prefix comparison` | `bind.mjs:60` unreached: `T17b`'s fixture (`SYN P ENUM A`) does not change the outcome when the filter is removed | `T18d`/`T18e` added — a malformed id that *starts with* a well-formed one must be refused as malformed **only**, never additionally as a prefix collision; plus a non-string id must be refused, not crash |
| NOT_APPLIED `malformed allocatee id tolerated` | **harness defect**: the find text is byte-identical at `bind.mjs:137` (currency) and `:202` (allocation), so it matched twice | split into two mutants, each anchored by its own `const where` line — which also gave the currency guard the mutant it never had |
| INDETERMINATE ×2 (`domain not supplied…`, `non-array allocated_cells…`) | **harness defect**: the mutation caused an uncaught `TypeError`, so the suite never printed its tally and was classified as an external kill | `mutate_bind.mjs:115-122` now distinguishes the two: a mutation-caused crash leaves a Node stack trace on stderr and counts **KILLED**; a silent death still counts INDETERMINATE. Windows has no real signals, so `taskkill` also surfaces as status 1 — the stack trace, not the exit code, separates them |

**Second pass: 48 mutants — 47 KILLED, 1 SURVIVED, 0 NOT_APPLIED, 0 INDETERMINATE.** The single survivor was
the *newly added* `malformed currency-entry id tolerated` (`bind.mjs:137`) — a guard that the ambiguous find text
had hidden from the first pass entirely. Closed by `T32b`, which asserts that a malformed currency entry is named
**as malformed** (without the guard it slips through and is mis-reported as a non-holder at `:146`).

**Third pass: 48 mutants — 48 KILLED, 0 SURVIVED, 0 NOT_APPLIED, 0 INDETERMINATE.** Suite: **82 assertions, 82
passed, 0 failed.**

**No test was weakened to reach this.** Each closure added an assertion or corrected a harness
misclassification; no `bind.mjs` guard was deleted, because none turned out to be dead code — both first-pass
survivors were live guards that no test had reached, and the third was a live guard no mutant had targeted.

## Risks and things a reader should not conclude

1. **These tools are not evidence.** Every one prints an `ENGINEERING ARTIFACT (not U1 evidence)` banner
   (`instrument.mjs:109-111`). They are a pre-registration proposal.
2. **Capability 1 is only enforced if someone runs the tool.** Outside the frozen tree, the check is
   procedural: the frozen `frame` command will still report `malformed: 0` for an unattributed frame. That is
   the residual risk of *not* editing `cpg_u1_data.mjs`, and it is a governance choice, not a technical gap.
3. **The prefix rule over-refuses** (measured above). Disclosed, not narrowed.
4. **Capability 3 detects staleness, never falsity** (`bind.mjs:108`). A perfectly current declaration can be a
   lie, and no artefact in this study can tell.
5. **Pseudonymity blocks the one join that would make §4A.2(a) mechanical.** This is a deliberate protocol
   choice (§4A.1), not an oversight to be fixed.
6. **The stale 587-file tree in this worktree is a live hazard** for anyone repeating this work; only the
   aggregate guard catches it.

See `MANUAL_CHECKS_REMAINING.md` for the checks that stay human.
