# PARTITION_GOVERNANCE — what governs how two enumerators divide the work

DEEPTECH-PARALLEL-007, AGENT A. **METHODOLOGY REVIEW ONLY. No frozen byte changed.**
Protocol line numbers: `research/cpg-u1/CPG_U1_PROTOCOL_004.md` @ `c50fc680…00b719`.
Instrument line numbers: `research/cpg-u1/tooling/…` @ aggregate `f7699f05…e5cc5dd`.

**Reading discipline for this document.** Three columns, never merged:
**REQUIRED** = the frozen text or the frozen instrument compels it.
**PERMITTED** = the frozen text expressly allows it.
**SILENT** = the frozen text neither requires nor forbids it. **Silence is design space, not
permission.** Every SILENT row is an owner decision that should be recorded before enumeration
begins; treating any of them as "allowed because unmentioned" is the error this table exists to
prevent. Two SILENT rows are marked **SILENT-CRITICAL**: the default resolution of those two decides
whether the eighth person is evidentially positive, neutral, or *negative*.

## 1. Sources searched exhaustively

§5 in full: §5.1 (198–214), §5.2 (216–224), §5.3 (226–248), §5.4 (250–257), §5.5 (259–289) incl.
§5.5.1 (291–302), §5.5.2 (304–309), §5.5.3 (311–327), §5.6 (329–351), §5.7 (353–381) incl. §5.7.1
(355–375) and §5.7.2 (383–409), §5.8 (412–414), §5.9 (416–418), §5.10 (420–439). Plus §15.3 (855–857),
§4A (123–189), §9.1–§9.2 (559–569), §12 (721–736), §13.2/§13.2A (809–815), §19 (923–961),
§20 (963–987), §22 (1004–1049), §23 (1051–1067). Plus a whole-document grep for
`partition|allocat|divide|division|disjoint|overlap|among|blind` and for `enumerat*`.

**Headline result: the protocol contains no clause about how enumeration work is divided.** The words
"partition", "disjoint" and "overlap" do not occur in the document at all; "allocation" occurs once
(§5.8:412) and refers to *development-set* allocation of drawn rows, not to enumerators.

## 2. REQUIRED

| # | Requirement | Source | Effect on a two-enumerator partition |
|---|---|---|---|
| R1 | "Every person performing a §5 task satisfies §4A." | 194 | Both enumerators bound, individually. |
| R2 | Each enumerator satisfies §4A.2(a)–(e), incl. "(d) hold no other §4A.3 role" and "(e) satisfy §4A.1" | 156–161; 186 | Each must independently pass; two enumerators = two full declaration sets (§4A.1:140–143). |
| R3 | **Enumerator receive-list is closed:** "public sources; the frame template; §4A, **§5.1–§5.4**; the jurisdiction-family list; the development-only registry." | 163–168 | **§5.7.2 is NOT in the list** — the 126/52/32 thresholds are outside what an enumerator is given. A partition instruction that quotes them formally exceeds the list. See S7. |
| R4 | **Enumerator barrier:** "They never receive: pilot results, sizing output, quotas or any CPG output (§5.5, §5.7.2)" and "**Enumerator barrier.** Enumerators never receive pilot, sizing or quota information (§4A.2)." | 170; **288** | Any per-enumerator work target must be provably run-independent. *Attribution correction to the brief: the "Enumerator barrier" bullet is at line 288, inside the "**Single frozen frame**" bullet set of **§5.5** (284–289), not §5.5.3 (311–327).* |
| R5 | **Complete before the development commitment:** "The complete frame F must exist and meet the sufficiency rule (§5.7.2) before the development commitment." | **285**; step 3 at 266 ("enumerate the COMPLETE frame F … — NO LATER ADDITIONS") | Both enumerators must finish before commitment; there is no second enumeration window. |
| R6 | **No changes after the development commitment:** "Rows may never be added, removed, edited, re-identified or reclassified" | 287; 326; 432 | A partition cannot be rebalanced after commitment; mis-sizing one enumerator's share is unrecoverable. |
| R7 | Frame sufficiency `E_c ≥ 126/52/32`; if unmet "**no development commitment may be made**; enumeration continues first" | 385–390; 409 ("At least 210 eligible admissible rows") | The *joint* output must clear the thresholds per class — a partition must not be by class alone in a way that leaves one class short. |
| R8 | **Uniqueness [enforced]: "one row per legal entity. Duplicate identifiers or duplicate canonical domains are refused."** | 380 | **The only mechanical consequence of overlapping partitions.** Two enumerators finding the same company produce a refusal at `frame`; the duplicate must be resolved *before* the frame is hashed, i.e. by a human deciding which row survives — and that human's discretion is unrecorded. |
| R9 | Per-row enumeration provenance is mandatory: non-empty `enumerated_by`, `enumerated_at` = `YYYY-MM-DD`, `enumeration_source_url` = https | `lib/schema.mjs:124–126`; `FRAME_COLUMNS` `:32–34` | Per-row attribution is **required**, so a partition is *recordable* row by row with no protocol change. |
| R10 | Per-row attribution is **committed on-chain**: `frameHash = hashRecords(frame,'candidate_id')` over the whole row (`lib/canonical.mjs:16–21`), `frame_hash` → payload → digest → `OP_RETURN` | `cpg_u1_data.mjs:94`; `lib/commitment.mjs:12`; §5.5.3:313–317; §5.5:283 | The partition record is frozen before the randomness block exists. It cannot be retro-assigned. |
| R11 | Frame column set is **exact**: "columns must match the template exactly (missing: …; extra: …)" | `cpg_u1_data.mjs:64–69` | **No partition column may be added to the frame CSV.** Partition metadata must live in `enumerated_by`'s free text or entirely outside the frame. |
| R12 | Class prediction is "the enumerator's **prediction**, made **before any reference research**" | 218 | Each enumerator predicts for its own rows; no cross-enumerator review of predictions is contemplated. |
| R13 | Screening log carries **one** `screened_by` per stage, supplied on the CLI | `cpg_u1_data.mjs:131,146,418,513` | §15.3's log (855–857) does **not** carry per-row enumerator identity. The *only* per-row enumerator record is the frame's `enumerated_by`. |
| R14 | Consequence of a false enumerator declaration is **frame-level**: "**enumerator work:** the frame is not independent (§20.18)" | 149 | No per-row carve-out exists. With two enumerators, **two** persons each individually hold the power to void the frame-independence claim for the *whole* frame. |
| R15 | Nothing validates `enumerated_by` against the personnel register | whole-instrument grep: `enumerated_by` only in `lib/schema.mjs` + `test/selftest.mjs` | Attribution truthfulness is attested, never checked — consistent with §23:1055 "Not cryptographic". |

## 3. PERMITTED (express)

| # | Permission | Source |
|---|---|---|
| P1 | "Several enumerators are permitted; each holds no other role." | 186 |
| P2 | "enumerator (≥ 1)" — a floor with no ceiling | 176 |
| P3 | `check-personnel` accepts any number of distinct enumerators and only enumerators | `lib/personnel.mjs:26`; positively asserted by `test/selftest.mjs:824` |
| P4 | `enumerated_by` is free text subject only to non-emptiness — distinct per-enumerator pseudonymous IDs (per §4A.1:140 "a pseudonymous ID is used in study artifacts") are permitted, row by row | `lib/schema.mjs:124`; 140 |
| P5 | Any split of row counts between enumerators; no per-person minimum or maximum | absence of any clause + P1/P2 |
| P6 | Enumerators may communicate and may see each other's rows (no bar exists; contrast §9.1:563–564) | see `SECTION_4A3_VERIFICATION.md` §4.4 |

## 4. SILENT — the design space

| # | Question the protocol does not answer | Nearest text (which does *not* answer it) | Consequence of the silence |
|---|---|---|---|
| S1 **SILENT-CRITICAL** | **Who defines the partition?** Nothing names the person who decides which slice each enumerator takes. | §4A.3:174–187 lists roles but assigns no partitioning duty; §4A.2:163–168 says what an enumerator *receives*, not who composes it | If the **operator** allocates candidates, the operator reacquires influence over frame composition while the rows carry two independent-looking `enumerated_by` values — **strictly worse than one enumerator**, because §22 row 31 is dressed as mitigated when it is not. If the partition is a **mechanical, pre-published criterion** (e.g. jurisdiction family) it is neutral-to-positive. The protocol does not choose; the owner must. |
| S2 **SILENT-CRITICAL** | **May candidates be supplied to an enumerator, or must each enumerator source its own?** | §4A.2:164 says enumerators receive "public sources" — a *category*, not a curated list | A curated candidate list is not textually forbidden. If one is supplied, §22 row 31's attacker simply authors the list and the second enumerator adds nothing. The receive-list's "public sources" is the hook for the stricter operator rule, but it is not itself that rule. |
| S3 | Must the slices be **disjoint**? | 380 (uniqueness) refuses duplicate *rows*, not overlapping *search scopes* | Overlap is permitted; its only cost is R8 refusals and the unrecorded human choice of which duplicate survives. |
| S4 | **By what criterion** may work be divided — jurisdiction family, alphabet, source registry, class, none? | §5.7:379 fixes the *draw* round-robin over families; it says nothing about *enumeration* | Free choice. A class-based split interacts badly with R7; a family-based split interacts well with §5.7:379 and is auditable post hoc from the archived frame. |
| S5 | Is there any **blinding** between enumerators, or any bar on communication? | §9.1:563–564 imposes exactly that on Author/Confirmer; §12:728 on raters; nothing on enumerators | None. Deliberate by contrast, and coherent — enumeration is a union, not a double-entry comparison (`SECTION_4A3_VERIFICATION.md` §4.4). |
| S6 | Must **one enumerator's rows be invisible** to the other before the frame closes? | 569 ("never receive … each other's records") is confined to reference Author/Confirmer | No such rule. Practically they must share at least identifiers to satisfy R8. |
| S7 | May an enumerator be given a **numeric work target**? | R3 (receive-list excludes §5.7.2) vs R4 ("never receive … quotas") | **AMBIGUOUS-SILENT.** "Quotas" in R4 reads in context as the §5.6 *sampling* quotas (pilot-dependent), not enumeration workloads; and 126/52/32 is a pre-registered constant carrying **zero** outcome information (it is derived from CAP 60, registered per §19.1:933). But §5.7.2 is textually outside the receive-list. Conservative handling: express targets as run-independent coverage goals, and record that no pilot-, sizing- or draw-derived number was transmitted. |
| S8 | Must the **partition rule** be registered or published? | §19.1:927–941 has no personnel item; §19.3(3):959 requires only that personnel *exist*; §13.2:811 publishes only the §4A.3 rater-label fingerprint | Nothing requires it. Voluntarily publishing it before enumeration is the mitigation for S1/S2 — see `AMENDMENT_VERDICT.md` §3. |
| S9 | Must the **enumerator roster** be registered or fingerprinted? | 189 names only `rater-1`, `rater-2`, `rating-adjudicator`; `lib/registration.mjs:33–57` has no personnel field; `checkRegistration` (`:66–114`) never mentions personnel | No. See `AMENDMENT_VERDICT.md` §3 for the registered / committed / published distinction. |
| S10 | Does **§4A.1 item 6** (line 138, "any holder of **another** §4A.3 role") bind *between* two enumerators? | 138 vs `lib/personnel.mjs:10` (`close_relationship_with_developer_operator_or_role_holder`, unqualified) | Textually ambiguous; the instrument's broader key permits the strict reading with no amendment. **Must be resolved on the record before the roster is fixed** — it is the single point on which the eighth person's evidential value depends. |
| S11 | If **one of two** enumerators' declarations proves false, is the taint per-row or whole-frame? | 149 says "the frame is not independent" — whole-frame, no carve-out | Not truly silent: the plain text is whole-frame. Recorded here because it is the principal *cost* of the eighth person (R14). |
| S12 | May the partition be described in the frame itself? | R11 forbids extra columns | Only via `enumerated_by`'s free text, or outside the CSV. |

## 5. The one methodological finding the table implies

The protocol's silence on S1/S2 means **the eighth person's evidential effect is not determined by the
protocol — it is determined by an unwritten operational choice.** Three regimes, same protocol, same
tooling aggregate, same 8-person register, radically different evidential value:

1. **Family-partitioned, self-sourced** — partition fixed by a mechanical criterion and published
   before enumeration; each enumerator sources its own candidates from public sources; the two are
   independent under a strictly-read §4A.1 item 6. → **Genuine strengthening** of the basis for §23's
   claim (2). See §6.
2. **Unstructured co-enumeration** — both work the same space, duplicates resolved ad hoc. →
   **Neutral.** Faster, no new evidence, plus the R14 doubling of declaration exposure.
3. **Operator-allocated candidates** — the operator hands each enumerator a slice of a list it
   authored. → **Worse than a single enumerator**, because the frame now carries two independent
   `enumerated_by` values while its composition was authored by the party §22 row 31 names. The
   protocol does not forbid this. Nothing in the tooling can detect it.

**Regime 3 is available under the frozen text and is the principal hazard of the eight-person model.**
It should be closed by an explicit, recorded operational rule — not by an amendment, and not by
assuming it is already excluded.

## 6. Question 6 — attack-matrix effect

### 6.1 The clauses

§22 row 31 (line 1041):

> | 31 | Operator authors a globally biased frame | UNRESOLVED by sampling integrity | Enumerator independence (§4A.2, §19.3) |

§22 row 34 (line 1046):

> | 34 | Role conflicts (enumerator adjudicating reference truth; shared or operator-held roles) | PREVENTED structurally in the register; truthfulness PROCEDURAL | §4A; `check-personnel` |

§20.18 (line 982):

> 18. Cryptographic sampling integrity (the sample was not chosen) is **not** independent candidate
>     selection (the frame is unbiased); the latter rests on enumerator independence only.

§23 (line 1055): "| Enumerators | Truthful attestations; independence from CPG | **Bias frame
composition globally** | Not cryptographic |".
§23 (line 1067): "**Two claims, never merged:** (1) cryptographic sampling integrity … (2) independent
candidate selection — the frame is unbiased. Protocols 003–004 strengthen (1); protocol-004
additionally specifies the personnel rules on which (2) rests, **without making (2) cryptographic**."

### 6.2 Verdict: conditionally POSITIVE; neutral by default; negative under regime 3

**Row 34 — UNCHANGED.** Mutual exclusion is enforced over any number of enumerators
(`lib/personnel.mjs:23–35`), a repeated `person_id` is a ROLE COLLISION whatever the role (`:34`), and
§4A.3:187's enumerator ≠ reference-adjudicator bar applies to each. Row 34 stays "PREVENTED
structurally in the register; truthfulness PROCEDURAL". No weakening, no strengthening.

**Row 31 / §20.18 / claim (2) — the one place where eight persons can be evidentially positive.** The
argument, stated as rigorously as I can put it:

*Premises.* (i) Row 31's attacker is a party who authors the frame's global composition; the named
control is enumerator independence. (ii) Under regime 1, no single non-operator person authors the
whole frame: each enumerator's authorship is confined to its slice, and the slice boundary is a
mechanical criterion nobody chose per-company. (iii) Per-row authorship is **committed before the
randomness exists** (R10) and **archived** — §13.2A:815 mandates "the single frame F" in the sampling
archive — so an outsider performing §21 holds, for free, the full attribution of every row.

*Conclusions.* (a) **The cost of the unresolved attack rises from one false declaration to two
coordinated ones.** A globally biased frame under regime 1 requires either operator authorship
(procedurally excluded, and S1/S2 must be closed to keep it so) or collusion between two persons who
have each separately declared independence under §4A.1 and are mutually independent under a
strictly-read item 6. Collusion of two is strictly harder than misconduct by one; it is not
impossible, so the class stays **UNRESOLVED**, but the residual risk is smaller.
(b) **A new observable is created — this is the strongest positive.** With one enumerator there is
nothing to compare a frame against; global bias is by construction unobservable from the frame alone.
With two disjoint, criterion-defined partitions, an outsider can compute per-`enumerated_by`
composition statistics on the archived frame — class mix, jurisdiction mix, source-domain mix,
identifier-scheme mix, admissibility and C1-eligibility rates — and a **between-partition asymmetry is
evidence of bias in the deviating partition**. That audit costs an outsider nothing beyond the
existing §13.2A archive, needs no protocol change, and simply does not exist in the single-enumerator
design. It is a genuine, if modest, increase in the falsifiability of claim (2).
(c) **It is neutral if the partition is not criterion-defined**, because then a between-partition
difference is confounded with the difference in the slices themselves and the comparison carries no
information.
(d) **It is negative under regime 3** (§5), where the appearance of independent attribution exceeds
its substance — the worst possible outcome for a study whose value is adversarial verifiability.
(e) **It can never make claim (2) cryptographic.** What is cryptographically fixed is the *record* of
who claims which row (R10), never its truth (R15, §23:1055). Any write-up must respect §23:1067's
"never merged" and report this as a procedural strengthening of the *basis* for (2), with row 31
remaining **UNRESOLVED** and §20.18 unamended.

*Against all of that, one honest debit:* R14/S11. §4A.1:149 makes a false enumerator declaration a
**whole-frame** independence failure with no per-row carve-out. Two enumerators therefore double the
number of single points of unrecoverable failure for the very claim the partition is meant to
strengthen. Under regime 1 I judge the trade favourable — a doubled probability of a detectable,
declared-and-published failure, against a halved reliance on any one person's honesty plus a new
outsider audit. Under regimes 2 and 3 the trade is not favourable, because the debit is paid and
nothing is bought.
