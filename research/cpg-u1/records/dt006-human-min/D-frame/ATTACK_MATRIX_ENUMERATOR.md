# ATTACK_MATRIX_ENUMERATOR — §22, attack by attack, against the enumerator

**Classification: METHODOLOGY REVIEW (PROPOSAL).** Creates no protocol change, no registration and no part of
any frame. Nothing here is registered evidence. No frozen byte was modified.

**Sources.** `CPG_U1_PROTOCOL_004` §22 (attack matrix), §23 (trust model), §20.18, §4A, §5.3–§5.7.2, §21
(`sha256 c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`); instrument at
`C:/tmp/dt002/research/cpg-u1/tooling`, aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (recomputed, 593 files — matches).

**The ATTACK and CURRENT DEFENCE columns are quoted verbatim from §22.** The remaining three columns are this
review's analysis. `LOAD-BEARING` answers one question only: *if the enumerator were replaced by a machine with
no independence property, would this row's defence weaken?*

Legend for LOAD-BEARING: **NO** = the row is held by consensus/commitment/registry machinery and the enumerator
contributes nothing · **PARTIAL** = the row's post-commitment half is machine-held, but its pre-commitment twin
(authoring the thing that is later frozen) is held only by the enumerator · **YES** = the enumerator is the
defence.

| # | ATTACK (§22, verbatim) | CURRENT DEFENCE (§22 Class + Control, verbatim) | ENUMERATOR INDEPENDENCE LOAD-BEARING | MECHANICAL SUBSTITUTE | RESIDUAL RISK |
|--:|---|---|---|---|---|
| 1 | "Seed chosen after the list" | PREVENTED — "No seed input; randomness block follows the commitment (`H_commit + 12`)" | **NO** | None needed | Unchanged by mechanisation |
| 2 | "List chosen after the seed" | PREVENTED — "`frame_hash` in the on-chain digest before `H_rand` exists" | **NO** | None needed. A derived frame binds the same `frame_hash` | Unchanged |
| 3 | "Multiple candidate lists in one study" | PREVENTED — "Outpoint spendable once (consensus); cross-slot spend VOID" | **NO** | None needed | Unchanged |
| 4 | "Favourable list selected after randomness" | PREVENTED — "As 3; finality rule" | **NO** | None needed | Unchanged |
| 5 | "Favourable randomness selected after the list" | PREVENTED — "Height rule; drand round unknown when `H_rand` is mined" | **NO** | None needed | Unchanged |
| 6 | "Commitment deleted" | PREVENTED — "Proof-of-work depth ≥ 6" | **NO** | None needed | Unchanged |
| 7 | "Commitment rewritten" | PREVENTED — "Depth; post-finality reorg VOID" | **NO** | None needed | Unchanged |
| 8 | "Identifier changed after commitment" | PREVENTED — "Frame hash committed; tool refuses a differing frame" | **PARTIAL** — *changing* an identifier is machine-prevented; *choosing* which identifier a row carries is enumeration | Derivation: the identifier is copied from the pinned snapshot record, so the choice is re-derivable, not authored | A snapshot whose identifier↔entity linkage is wrong propagates silently; §5.9 then makes the observations INVALID, never replaced |
| 9 | "Class changed after commitment" | PREVENTED — "Class is inside committed rows" | **PARTIAL** — post-commitment change prevented; the class *prediction itself* is the enumerator's judgement (§5.2) | Derived class from pre-registered predicates over the snapshot (prototype: collision-group + field-bearing-filing rules) | The class proxy is the most endpoint-adjacent predicate; see MECHANICAL_FRAME_DESIGN §5 (A6/class) and §15.5(5) coupling |
| 10 | "Quota changed after commitment" | PREVENTED — "Development quota in protocol; held-out sizing hash in binding" | **NO** | None needed — quotas are protocol constants and `lib/sizing.mjs` | Unchanged |
| 11 | "Beacon round / randomness block changed" | PREVENTED — "K, D, Δ, chain pinned in tooling and registration; round computed; caller rounds ignored" | **NO** | None needed | Unchanged |
| 12 | "Randomness output discarded (declare failure, restart)" | DETECTABLE — "Public outpoints and recomputable draws; abandonment disclosed; restart needs new registration" | **NO** | None needed | A restart re-opens frame authorship: the new registration may carry a *different* frame. §31 residual applies again |
| 13 | "Chain / log changed after randomness" | PREVENTED — "Registered checkpoint; two agreeing sources; PoW" | **NO** | None needed | Unchanged |
| 14 | "Candidate list reconstructed differently" | PREVENTED — "Canonical frame hash" | **NO** | Mechanisation **strengthens** this row: the frame is not merely hash-comparable but re-*derivable* from published inputs | Re-derivability depends on the snapshot remaining obtainable at its pinned digest (archive loss → §23 "claim lapses") |
| 15 | "Randomness learned early / miner withholding" | "PREVENTED for miners (blind); drand threshold collusion assumed" — "Δ = 3 h after `MTP(H_rand + 6)`" | **NO** | None needed | Unchanged (§20.15) |
| 16 | "Study-level grinding" | PARTIALLY MITIGATED — "Public identity-bound registration naming outpoints; residual under other identities (§20.13)" | **NO** | None. A parallel study under another identity re-authors *everything*, frame included | Unchanged and unresolvable (§20.13); mechanisation does not touch it |
| 17 | "`O_ho` spent early with junk to kill held-out" | DETECTABLE — "Stage VOID, public; no information advantage" | **NO** | None needed | Unchanged |
| 18 | "Multiple registrations, same identity" | DETECTABLE → VOID — "`checkAuthority`" | **NO** | None needed | Unchanged |
| 19 | "Multiple registrations, different identities" | UNRESOLVED (identity-level) — "Evidence rule: accountable identity only" | **NO** | None | Unchanged |
| 20 | "Registry replacement" | PREVENTED as evidence — "Registry pinned to OSF Registries" | **NO** | None needed | Institutional (§20.14) |
| 21 | "Registration edited or embargoed" | "PREVENTED (OSF immutability) / DETECTABLE (withdrawal)" — "public/embargo enforced; withdrawal VOID" | **NO** | Mechanisation *adds load* here: the predicate set and snapshot digest must be inside the immutable registration, so OSF trust now also carries the derivation | If OSF immutability fails, a silently re-authored predicate set is as damaging as a re-authored frame |
| 22 | "Registration backdated" | PREVENTED under registry trust — "Registry timestamp; payload binds `registration_id`" | **NO** | None needed | Institutional |
| 22a | "Grind-then-register (commit against an old checkpoint, see the draw, register only if favourable)" | PREVENTED under registry trust — "`registration_timestamp` ≥ `R_dev` scheduled time → study VOID; identity-bound listing" | **NO** | None needed | Institutional |
| 23 | "Miner-set block time manipulation" | PREVENTED — "Height rules; MTP-based round rule and windows" | **NO** | None needed | Unchanged |
| 24 | "Seed substitution" | PREVENTED — "Seed recomputed; manifest record compared to chain (abort on mismatch)" | **NO** | None needed | Unchanged |
| 25 | "Candidate-list replacement after commitment" | PREVENTED — "Frame hash abort" | **PARTIAL** — replacement prevented; the *original* list is authored | `frame = D(snapshot, predicates)`, both pinned in the registration | Authorship of the predicate set survives (see 31) |
| 26 | "Candidate-list extension" | PREVENTED — "Single frozen frame: held-out frame hash = development frame hash (§5.5); sufficiency verified before commitment (§5.7.2)" | **PARTIAL** — same distinction | Derivation is total over the snapshot: there is no "extend" operation, only a different snapshot with a different digest | A larger snapshot pinned *before* registration is indistinguishable from a smaller one — the *pin instant* is operator-chosen |
| 26a | "Outcome-dependent frame composition (appending after pilot sizing)" | PREVENTED — "Frame complete and sufficient before any CPG outcome; held-out frame hash = development frame hash (§5.5, §5.7.2)" | **PARTIAL** — the *append-after-pilot* channel is closed by the chain; the *initial* composition is attack 31 | Derivation makes composition a published function, so composition cannot depend on anything not in the snapshot | Operator expectations about CPG behaviour at predicate-authoring time (§3 of ENUMERATOR_ELIMINATION_ANALYSIS) |
| 27 | "Post-randomness change of rows, scan or registry" | "PREVENTED for committed artifacts; attestation truthfulness not cryptographic" — "Frame, scan, registry hashes committed" | **YES** for the attestation half — C1(2)–C1(5) are cells a human writes, and §22 itself concedes their truthfulness is not cryptographic | Prototype: fix C1(2)–C1(5) to `no` in the pre-registration and delegate *all* held-out ineligibility to the mechanical C1(1) scan and the frozen C1(6) registry | Removes a per-row discretion channel but makes registry completeness (H2, §20.12) the sole safeguard against genuinely contaminated companies |
| 27a | "Registry growth or change after the pilot to exclude unfavourable companies (e.g. after private CPG runs)" | PREVENTED — "Registry frozen at registration; held-out registry hash = registered; held-out scan = development scan (§5.3, §5.5.3)" | **NO** — the registry is the developing organisation's own list, not the enumerator's | None needed for the *post-pilot* channel | The registry's content *at registration* is operator-authored and attested only (H2). A pre-registration over-broad registry silently shrinks the eligible pool |
| 28 | "Commitment withholding" | DETECTABLE — "180-day abandonment" | **NO** | None needed | Unchanged |
| 29 | "Blockchain reorganisation" | "PREVENTED within depth; VOID after finality" — "`--prior-final` check" | **NO** | None needed | Unchanged |
| 30 | "Development ↔ held-out cross-contamination / cross-binding" | PREVENTED — "Held-out after dev finality; binding to dev txid/digest/manifest/pilot/sizing" | **NO** | None needed | Unchanged |
| 31 | **"Operator authors a globally biased frame"** | **UNRESOLVED by sampling integrity — "Enumerator independence (§4A.2, §19.3)"** | **YES — this is the only row where the enumerator IS the defence** | **The substitute: `frame = D(snapshot, predicates)` with both pinned in the public registration and byte-reproducible by any outsider.** It converts "trust a declaration" into "recompute and compare" | Not eliminated, **compressed**: the operator still chooses the source, the pin instant and ~19 predicate parameters. Falsifiable only in the sense that an outsider can re-derive and can re-derive from an *alternative* admissible source; no outsider can evaluate ex-ante "easiness" without running CPG |
| 32 | "Private preview of held-out candidates before the authorised run" | **DETECTABLE (procedural/audit only)** → VOID if detected — "§6.5 window, authorisation, harness logging, declaration, exports; unlogged queries cannot be excluded (§20.20)" | **PARTIAL** — §4A.2(b) ("not have run CPG or seen any CPG output … before completing the frame") is what stops preview knowledge from entering frame composition | A derived frame cannot carry preview knowledge at all: the prototype refuses any input bearing CPG output (test T7, 4 checks) | The operator may still preview after the frame exists; and preview knowledge *before predicate authoring* reaches the frame through the predicates, not the rows. §20.20 unchanged |
| 33 | "Re-running or timing held-out execution after seeing outcomes" | "PREVENTED for logged runs (single run, no restart) / DETECTABLE otherwise" — "§6.5; repeated / post-window execution VOID" | **NO** | None needed | Unchanged |
| 34 | "Role conflicts (enumerator adjudicating reference truth; shared or operator-held roles)" | "PREVENTED structurally in the register; truthfulness PROCEDURAL" — "§4A; `check-personnel`" | **YES (definitional)** — the row is about the enumerator role itself | Eliminating the role removes one node from the conflict graph: 7 mutually exclusive independent persons → 6 | `check-personnel` would need a protocol amendment to accept a derivation identity where it expects a person; §15.3 `screened_by` likewise |
| 35 | "Reference adjudication leakage (class, split, CPG output, recorder identity, tallies)" | "PREVENTED in the packet; other channels PROCEDURAL" — "§9.2.1; deterministic packet verification" | **PARTIAL** — the class is one of the leaked items, and §4A.3 bars the enumerator from adjudicating *because* "the enumerator authored the class predictions whose mismatches with reference truth are published (§9.2, §9.7)" | A derived class has **no human author**, so this particular exclusion becomes vacuous; the packet rule is unaffected | Other leakage channels remain PROCEDURAL |
| 36 | "Rating adjudication leakage (rater identity, tallies, class, split, pilot)" | "PREVENTED in the packet; other channels PROCEDURAL" — "§12.2; deterministic packet verification" | **PARTIAL** — same reasoning as 35, and this is why folding the enumerator into a rating role is *not* information-neutral | Same: no class author exists to leak to | Other channels PROCEDURAL |
| 37 | "Rater-order substitution or seed substitution" | PREVENTED — "§12.1 derivation from the sealed held-out record; verification refuses substitutes" | **NO** | None needed | Unchanged |

## Tally

| LOAD-BEARING | Rows | Which |
|---|--:|---|
| **YES** | 3 | 27 (attestation half), **31**, 34 (definitional) |
| **PARTIAL** | 8 | 8, 9, 25, 26, 26a, 32, 35, 36 |
| **NO** | 29 | all remaining rows |

**Reading.** 29 of the 40 rows are held entirely by Bitcoin consensus, the commitment scheme, the drand round
rule or OSF institutional trust, and the enumerator contributes nothing to them. 8 rows are "post-commitment
prevented / pre-commitment unprotected" pairs, whose unprotected half collapses into row 31. Exactly **one**
row, 31, names enumerator independence as its whole control, and §22 classes it **UNRESOLVED by sampling
integrity**. §23 states the same thing structurally: enumerators are trusted for "Truthful attestations;
independence from CPG" and can still "Bias frame composition globally", limitation "Not cryptographic".

Two rows (27, 34) plus the two leakage rows (35, 36) are *artefacts of there being a human enumerator at all*:
they exist to contain the enumerator, so removing the role removes them rather than substituting for them.

**The single-row conclusion.** Enumerator independence is load-bearing for one attack. A mechanical derivation
substitutes for that one attack by changing its class from "trust a declaration" (UNRESOLVED, procedural) to
"recompute the published function and compare bytes" (re-derivable, falsifiable) — while leaving a smaller,
published and named discretion surface: the source, the pin instant and the predicate set.
