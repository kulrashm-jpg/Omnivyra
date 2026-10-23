# DEEPTECH-PARALLEL-013 — CLOSURE STREAM SUMMARY

Four items settled: **§7 EVIDENCE_SCHEMA · §8 TOOL_VERSION · §10 tracking hazard · §13 contamination
carrier.** Worktree `C:/tmp/dt4-uncert`, base `af2fb6e99ce461894bf16f18c2251f75088eba18`.

**Firewalls honoured.** Nothing was written under `C:/tmp/dt009-merge` (the live 404-mutant run, PID 4092)
or under `C:/tmp/dt013-candidate`. The candidate tree was read only, never opened for writing. The mutation
run was not restarted, not inspected and not interpreted. No mutation suite and no selftest was executed;
no CPU-heavy work was done. **No instrument code changed. No protocol change. No schema invented. Nothing
committed.**

Frozen and unmodified: protocol `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (hash
re-verified in both trees), treatment, evaluation tree, development registry.

---

## 1. DELIVERABLES

| File | Item |
|---|---|
| `EVIDENCE_SCHEMA_FREEZE.md` | §7 — freeze `/v1`, the one identity statement, the detached-bundle residual |
| `TOOL_VERSION_IDENTITY_MAP.md` | §8 — name -> source tree -> `<FINAL_AGG>`; why the `TOOL_VERSION` declaration must not change |
| `TRACKING_HAZARD_NEGATION.md` | §10 — the scoped negation and its proof |
| `CONTAMINATION_CARRIER_DETERMINATION.md` | §13 — determination on quoted protocol text |
| `negation-proof/PROOF_TRANSCRIPT.txt` | §10 — verbatim before/after `check-ignore` and dry-`add` evidence |
| `negation-proof/` (6 canaries) | §10 — one file per colliding pattern, incl. `REGISTRATION_READINESS_PACKAGE.md` |
| `CLOSURE_SUMMARY.md` | this file |
| `../../.gitignore`<br>(`research/deeptech-operations/.gitignore`) | §10 — the negation itself, the only file outside `closure/` |

`git check-ignore` was run on every deliverable. **Nothing git would ignore**, except the intentional
`negation-proof/CANARY.log` canary.

## 2. DOES IT MOVE THE AGGREGATE? — FOUR TIMES NO

Established mechanically for all four, not asserted: `toolingManifest(root)` (`lib/aggregate.mjs:8-23`)
walks `root` and hashes every file beneath it; `root` is `dirname(cpg_u1_data.mjs)`, i.e. the tooling tree
alone. Every deliverable lives under `research/deeptech-operations/`, outside that tree. No file inside the
tree was opened for writing.

| Item | Aggregate? | Mutation count? | Protocol? | Instrument? | Needs owner approval? |
|---|---|---|---|---|---|
| **§7 EVIDENCE_SCHEMA — freeze `/v1`** | **NO** | none | no | no | yes — the freeze ruling (costless, rulable now) |
| **§8 TOOL_VERSION — disclosure** | **NO** | none | no | no | **no** — documentary only |
| **§10 tracking hazard — scoped negation** | **NO** | none | no | no | yes — the negation; separately the `.log` |
| **§13 carrier — second branch, record the sentence** | **NO** | none | no | no | yes — the methodological decision |

Consistent with wave 012's cost table (D-5, D-6, contamination, git fix): these are the items that cost
nothing and can be ruled on without re-registration.

**All measurements of `C:/tmp/dt013-candidate/tooling` in these deliverables are timestamped snapshots**:
108 non-`node_modules` / 594 total at 04:47, **109 / 595 at 05:11**, because another stream was editing that
tree throughout. See the drift row in §8 Risks.

## 3. §7 — ONE SENTENCE

Confirmed: **no owner ruling requires a schema bump.** The `OWNER DECISION:` / `DECIDED:` convention exists
in exactly six places naming DR-1, DR-2 and DR-10 only; DR-1's ten adopted requirements never mention a
schema identifier and the record says "no additional requirement is inferred"; wave 012's later record
states on its own face that nothing in it is approved.

**Freeze `EVIDENCE_SCHEMA = 'cpg-u1-sampling-evidence/v1'`.** Declared once, imported once, stamped once,
gated once; not a `PROTOCOL_MARKER`; `sampling-evidence` occurs **0 times** in the protocol; **26** distinct
versioned identifiers, all `/v1`, plus one unversioned `TOOL_VERSION`; `grep /v2` over the 108
non-`node_modules` files -> zero.

The identity statement (full text in `EVIDENCE_SCHEMA_FREEZE.md` §4) resolves the six honestly: **four
classes carry an in-band schema string — nine strings in total, not one — and two carry none at all.** Frame
attribution is identified by `frame_hash`; contamination by `scan_sha256`; relay attribution has no identity
of its own and rides inside the bundle. The single thing that covers all six is the **registered tooling
aggregate**, and the statement says so rather than pretending to a string that does not exist.

**Residual:** a bundle detached from its registration package is not self-identifying, because pre- and
post-DR-1 bundles stamp the same `/v1` for incompatible contracts and only the aggregate disambiguates
them. Auditability, not integrity. **Mitigation: never publish a bundle alone** — publish the three-line
provenance header (`<FINAL_AGG>`, `<FINAL_N>`, `protocol_sha256`) beside it. Zero cost.

## 4. §8 — ONE SENTENCE

**CPG-U1 dataset tooling v6 — `cpg-u1-data-tooling-6` — current source tree `research/cpg-u1/tooling`
(`<FINAL_N>` files; 594 at 04:47, 595 at 05:11, still growing) — final tooling aggregate `<FINAL_AGG>` over
`<FINAL_N>` files.**

Three independent axes verified: the protocol's **"tooling v4"** (`:18, :25, :953, :1098`; never v5 or v6;
never a `data-tooling-N` string) is the CPG-043 governed generation and stays; the `TOOL_VERSION` constant
(`cpg_u1_data.mjs:49` at 04:47, `:50` at 05:11) is the **package** identity; the README's v3/v4/v5/v5.1/v6
are **feature generations** and must not be renumbered.

`TOOL_VERSION` is **pinned nowhere** — absent from `PROTOCOL_MARKERS` (`:321-323 -> :352-354`), from
`registrationTemplate`, from `SAMPLING_FIELDS`; its five `tool:` stamps
(`:289, :457, :484, :552, :629` -> `:320, :510, :537, :605, :682`) are **never read back** (zero `.tool`
reads in the tree, at both timestamps).

**The `TOOL_VERSION` declaration must not be edited:** it moves the aggregate, it contradicts every already-stamped
artefact, and it closes no verification gap. The answer is a disclosure, not an amendment.

**`<FINAL_AGG>` does not exist yet** — DR-11 unresolved, R28/R15/DR-12 in flight, each moving the tree. The
pre-decision candidate digest measured during the live run is not the final value and must never be written
as one.

## 5. §10 — ONE SENTENCE

New `research/deeptech-operations/.gitignore`, operative line `!*.md`, scoped to this tree only; the root
`.gitignore` is byte-unchanged and its five `.md` patterns still fire everywhere else.

**Proved, not asserted.** BEFORE: 63 files present, **56** staged, exit 0, seven dropped with no warning;
all five patterns confirmed firing at `.gitignore:50/51/55/58/77` plus `:12 *.log`. AFTER: 64 files present,
**63** staged; the only ignored path is the intentional `CANARY.log`, and naming it explicitly still fails
loudly at exit 1.

**The excluded-directory caveat does not bite** — all six patterns are file patterns with no trailing slash,
no ancestor directory is excluded (measured), and the negation demonstrably took effect. Fallback recorded
in case a future root pattern ever excludes an ancestor.

`*.log` was **not** negated. **Not committed** — every `git add` was `-n` / `-An`; the index was never
written (`git diff --cached` empty, `git ls-files research/deeptech-operations` = 0).

## 6. §13 — ONE SENTENCE

**The protocol does NOT specify a carrier.** §5.3 specifies the content (company, basis, date, discoverer),
the acts ("recorded ... and published") and the flag, and carries **no `[enforced]` and no `[NORMATIVE]`
tag** while three neighbouring rules in the same bullet list do. §13.2 and §13.2A list no
contamination-disclosure record. **Second branch applies: no carrier invented, none implemented.**

**Wave 012's reading is the one the text supports; wave 011's is refuted.** §13.2A is headed "Sampling
archive (**mandatory**)" — a floor; neither list carries exhaustiveness wording; prohibition-by-absence
holds only for vocabularies that are exhaustive **and selective** (§10.5 "exactly one", §5.10's states,
§15.1's dispositions), and a published addendum displaces nothing. §15.1 confirms the discriminator from the
inside: `CONTAMINATION-DISCLOSED` is introduced as "**and the flag**", explicitly non-selective, the
observation "remains VALID in the primary analysis".

**But lawful is not specified.** A published record being permitted is not the protocol naming the carrier.

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE METHODOLOGICAL DECISION
```

The §15.1 flag re-verified dead in all three senses: `contamination_disclosed` (`lib/analysis.mjs:159`) is
structurally always false because `lib/select.mjs:93` filters `ineligible` out of the held-out pool; it has
exactly one grep hit (the write) and no reader; and the literal `CONTAMINATION-DISCLOSED` appears in **none**
of the 594 files. **Not fixed — re-verified only.**

## 7. OWNER DECISION REQUIRED

1. **§7** — adopt the freeze of `cpg-u1-sampling-evidence/v1`; and whether the detached-bundle mitigation is
   the publication rule (free) or an in-band provenance field (moves the aggregate; pre-registration only).
2. **§10** — adopt the scoped `!*.md` negation; and **separately and narrowly, whether `*.log` under
   `research/deeptech-operations` is tracked** (`MUTATION_RUN.log`).
3. **§13** — the methodological decision the recorded sentence names: accept and publish the unfalsifiable-
   duty limitation, or elect a pre-registered attestation, which moves the aggregate and is
   pre-registration only.
4. **Whether the DeepTech record is committed to `C:/virality` at all** — currently zero files are tracked,
   and this stream did not commit.

**§8 needs no approval.** It is documentary.

## 8. RISKS

| Risk | Assessment |
|---|---|
| `<FINAL_AGG>` filled in from the live run's measured digest | **The single largest risk in this closure.** That digest is a pre-decision candidate. Any chain link written with it becomes a second wrong pin beside the existing `f7699f05...` ones. Mitigated here by using the placeholder everywhere and writing no concrete final digest. |
| The `!*.md` negation is wider than strictly necessary | Accepted deliberately, with the narrower five-line form costed and rejected in `TRACKING_HAZARD_NEGATION.md` §2. Measured blast radius: one previously-ignored non-canary file. Reversible by deleting one line. |
| `check-ignore -v` misread as "ignored" on a negation line | Real trap — `-v` prints negation matches too. The authoritative test in the transcript is `check-ignore --stdin` *without* `-v`. Flagged in the deliverable. |
| §13's second branch read as "nothing to do" | It is not: the *duty* to record and publish stands under §5.3. Only the *carrier* is unspecified. The deliverable says so explicitly. |
| Six chain links still hold `f7699f05...` | Another stream's scope; not touched. They fail **closed**, so today's hazard is a blocked workflow, not a false pass. They must be rewritten in one pass after `<FINAL_AGG>` exists, together with `REGISTERED_TOOLING_FILE_COUNT` (currently `593`, one less than the candidate's 594). |
| Line numbers cited from the candidate tree, not the in-repo tree | The in-repo `research/cpg-u1/tooling` at `af2fb6e9` is an **older** instrument (101 non-`node_modules` files; no `evidenceBundle.mjs`, `analysis.mjs`, `select.mjs`, `identity.mjs`). Every line number in these deliverables was verified against `C:/tmp/dt013-candidate/tooling`, the current source tree. Anyone re-checking against the in-repo tree will find files missing — expected, not a citation defect. |
| **The candidate tree moved WHILE these documents were written** | Detected and recorded, not glossed. Another DEEPTECH-PARALLEL-013 stream created `lib/identity.mjs` at 04:50 (R28 identity/authority validation plus the DR-12 sentinel normalisation) and then edited `lib/registration.mjs`, `lib/harness.mjs`, `cpg_u1_data.mjs`, `test/mutate.mjs` and `test/selftest.mjs` through 05:06. Non-`node_modules` count **108 -> 109**, total **594 -> 595**. Every load-bearing citation was **re-measured at 05:11**; `cpg_u1_data.mjs` and `lib/registration.mjs` line numbers are given as `04:47 -> 05:11` pairs and the **symbol** is authoritative. **No substantive finding changed** — notably `TOOL_VERSION`'s value, the 20 `PROTOCOL_MARKERS`, the five write-only stamps and the zero read-backs. Every file cited for §7's `lib/` sites and all of §13 was untouched. |
| A reader treats any file count here as final | Deliberately avoided: the mapping statement uses `<FINAL_N>`, and counts elsewhere are timestamped measurements. The tree was still being written at 05:11, which is itself proof that `<FINAL_AGG>`/`<FINAL_N>` cannot yet be computed. |

**DISPOSABLE.** Every file produced by this stream is documentation outside the instrument tree. Deleting
all of it changes no aggregate, no mutation count, no protocol hash and no registered value.
