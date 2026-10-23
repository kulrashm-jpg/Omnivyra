# OUTSIDER_VERIFIABILITY_DELTA — DEEPTECH-HUMAN-MIN-001 / AGENT E

**CLASSIFICATION: METHODOLOGY REVIEW.** Not U1 evidence. What an outsider following §21 can still
**check mechanically** under a reduced-headcount design, and what silently becomes an **attestation**.

§21 L991–1002 is the outsider procedure. §20.23 L987 already states the baseline honestly: "**Personnel
independence rests on declarations and organisational confirmation** (§4A.1), not on verifiable proof.
The tooling checks the register's structure only."

**The governing distinction.** A check can fail three ways. It can *refuse* — loudly, with an exit code.
It can *become unavailable*. Or it can **keep passing while its meaning drains away**. The third is the
danger a head-count reduction creates, because no artefact records it and §21 has no step that would
notice. Every row below is classified on that axis.

---

## 1. Unaffected by head-count — the cryptographic spine

None of these depends on how many humans hold which role. An outsider retains them in full.

| §21 step | Check | Exact artefacts |
|---|---|---|
| 1 | Registration is public, unembargoed, registry-timestamped; the accountable identity's registrations are listed | OSF persistent identifier; identity-registration list |
| 2 | `verify-protocol`, `verify-registration` (`--evidence`) | protocol sha256 `c50fc680…`; tooling aggregate `f7699f05…`; registry sha256; registration record |
| 3 | `verify-archive` against headers from two independent sources, retarget boundary ≤ checkpoint to tip | Bitcoin header ranges; registered checkpoint (height, hash) |
| 4 | Commitment transactions are the spends of `O_dev` / `O_ho` (full node) | both funding and commitment raw transactions with Merkle proofs |
| 5 | drand rounds `R_dev`, `R_ho` from ≥ 2 relays | drand chain info and rounds |
| 6 | `verify-sampling --stage development`, `--stage held-out` with `--prior-final` | both commitment payloads; both sampling records |
| 7 | `registration_timestamp` precedes the development commitment block | registration record; payload `registration_id` |
| 8 | `draw-development` / `draw-held-out` recomputed; manifests and seed fingerprints compared | frame F; scan; pilot result; sizing; both manifests |
| 9 | `check-frame-sufficiency`; both payloads carry the same frame and scan hashes and the registered registry hash | frame; scan; development-only registry |
| 10 | Published seal record; `authorize-execution` recomputed; `audit-execution-log`; `verify-rater-order`; `verify-adjudication-packet` | seal; execution authorisation; event log; rater-order artefacts; both adjudication packets |

Also head-count-independent: `verify-event-log` (hash chain, `eventlog.mjs:22-38`),
`verify-archive-record`, `archive-merkle-root`, `replay-archive`, `verify-evaluation`,
`verify-evaluation-tree`, `verify-rater-packet` (byte-identical rebuild).

**Two pre-existing limits, restated so they are not mistaken for merge effects.**
`eventlog.mjs:4` — "A truncated TAIL or a substituted whole log is **NOT** detectable from the file
alone: the head hash must be published (procedural)." And §20.20 L984 — `audit-execution-log` "examines
only the supplied log, whose timestamps come from the operator's systems."

---

## 2. Survives a merge, and worth naming because it does

| Property | Why it survives | Artefacts |
|---|---|---|
| **Reference truth was constructed without CPG output** | **Ordering guarantees it, not personnel.** The seal is published before execution (§9.6 L628), and `evaluation.mjs:112` refuses any reference file that is not the sealed one. No merge lets a reference observer see CPG output *before* writing their record, because no CPG output for held-out companies exists then. | published seal hash; `reference_file_sha256`; §13.2A sampling archive |
| **§9.8 SOURCE-COINCIDENT cap (> 60% → INCONCLUSIVE, §15.5(5) L865)** | Computed by comparing the sealed reference `source_url` against CPG's cited URLs — both fixed artefacts. Independent of who held which role. | reconciled reference file; `cpg_source_urls` in the evaluation artefact |
| **Reference truth cannot be edited after the run** | §9.6 L630: "Any post-execution change to reference truth yields a different seal hash, which does not match the published one." | published seal hash |
| **Packet contents contain no forbidden field** | `packets.mjs:51,95` and `raterPackets.mjs:55` enforce exact key sets; rebuild requires byte identity. A merge cannot smuggle class, split or identity *into an artefact*. | both adjudication packets; rater packets |
| **The §12.3 cited-URL set was not curated** | `extractCitedUrls` (`raterPackets.mjs:31-49`) reads only each evidence record's `sourceUrl`; §12.3 L788 forbids post-hoc favourable selection, and `verify-rater-packet` rebuilds. No rater result reaches the extractor. | archived CPG responses; `cited_url_rule` recorded in every packet |
| **Rater order was not chosen** | §12.1 L753: any outsider recomputes every order from the seal, the held-out manifest and the rule. `ho_record_sha256` cannot exist before the held-out drand round (L752). | `cpg-u1-rater-order/v1` artefacts; held-out sampling record |

**This is the honest good news: the entire sampling-integrity claim, the anti-circularity of reference
truth, and every artefact-shape claim are untouched by head-count.** What a merge destroys is confined
to claims about *people*.

---

## 3. What becomes attestation-only

### 3.1 Checks that keep passing while their meaning drains away — the dangerous class

These are the ones §21 cannot catch, because the artefacts remain valid and the commands still exit 0.

| Property | Check today | Under a merge | Named artefact |
|---|---|---|---|
| **Seven distinct humans hold the seven roles** | `personnel.mjs:34` refuses a repeated `person_id`; `role_conflict_check.mjs` re-derives §4A.3 independently | The register must be written so the checks pass, so `person_id` values no longer denote distinct humans. **Both checks still exit 0 and now prove only that seven strings differ.** | `cpg-u1-personnel/v1` register (restricted); its structure only |
| **Author ≠ Confirmer** | `reconcile.mjs:52` refuses equal `recorded_by` | Same: distinctness of a free-text field. The reconciled file is byte-valid and `seal` accepts it. | three blind-record files; reconciled reference file |
| **Adjudicator ≠ both recorders** | `reconcile.mjs:59-60` | Same | adjudication rows (`adjudicated_by`) |
| **Rater 1 ≠ Rater 2; adjudicator ≠ either** | `ratings.mjs:97-98`; `assignment.mjs:33` | Same. `assignedPerson` still verifies the sheets against the **published fingerprint** — but the fingerprint commits to *pseudonyms*, not to humans. | `cpg-u1-rater-assignment/v1`; published assignment fingerprint; per-rater sheets |
| **Krippendorff's α ≥ 0.667 measures inter-coder reliability** (§12 L732; §15.5(3) L863) | `analyze` computes it from the two sheets | **The number is still correct and still ≥ 0.667 more easily.** Once both raters share a reference prior it is a consistency statistic for one jointly-primed pair, not a reliability coefficient. `analyze` cannot know. **A guard that stops guarding, silently.** | per-rater sheets; results artefact |
| **The adjudications were blind** | `verify-adjudication-packet` rebuilds both packets byte-identically | **Still byte-identical.** §9.2.1 L592 already scopes the claim: "What the adjudicator learns outside the packet is controlled procedurally (§4A)." A participant who authored Record 1 recognises it; the artefact cannot tell. | both adjudication packets |
| **Two independent reference constructions** | `constructed_without_cpg = "yes"` (`schema.mjs:257`); the `AGREED` rate | `AGREED` is inflated by a shared prior (edge B3) and §9.5 L620 makes `AGREED` unoverridable. A *high* agreement rate is indistinguishable from a *good* one. | reconciled reference file; `resolution` column |

**The `AGREED`-rate observation deserves emphasis.** In the seven-person design a high agreement rate is
weak evidence that reference truth is solid. Under any merge — or under joint enumeration (B3) — the
same number is equally consistent with a collapsed control. **An outsider cannot distinguish the two
from any published artefact**, because the only difference is whether the two recorders shared a prior,
and no artefact records that.

### 3.2 Already attestation today (baseline, not a merge effect)

Recorded so the delta is not overstated. All from §20 and the instrument's own comments:

- Truth of the §4A.1 declarations — §4A.1 L147 "These are **procedural evidence, not proof**";
  §20.23 L987; `personnel.mjs:3` "It cannot verify that declarations are true."
- That pseudonyms denote distinct real people — `HUMAN_DEPENDENCY_MAP.md` P-15.
- Author/Confirmer non-communication before submission (§9.1 L563) — unenforceable by tooling.
- No unlogged private CPG query — §20.20 L984; attack #32 L1044 "DETECTABLE (procedural/audit only)".
- Frame is unbiased — §20.18 L982; attack #31 L1041 **UNRESOLVED**.
- Development-only registry completeness — §20.12 L976, attestation H2.
- **When** the person-to-label fingerprint was published (§4A.3 L189 requires it before the held-out
  commitment) — `assignment.mjs:6-7`: "The tooling cannot check WHEN the fingerprint was published."

### 3.3 New gaps a merge creates that §21 has no step for

1. **§21 has no role-exclusivity step at all.** Steps 1–10 never run `check-personnel`. Role exclusivity
   is verified only by whoever runs the register check — and the register is **restricted** (§4A.1 L140,
   "a pseudonymous ID is used in study artifacts"). So an outsider verifies role exclusivity from
   **nothing**: the artefact they would need is not published. §13.2 L811 publishes only the
   *fingerprint* of the person-to-label assignment. **This is a gap in the seven-person design already,
   and a merge makes it load-bearing.** A reduced-headcount design should publish a
   `check-personnel` / `role_conflict_check` transcript, or the exclusivity claim has no outsider
   evidence whatsoever.
2. **No artefact records an overlap.** There is no field anywhere for "this person also held role X". A
   merged design is indistinguishable from a compliant one in every published artefact. The only fix is
   a registration-level disclosure, which is an attestation.
3. **The register has no as-of time, so it cannot be truthful across the CPG-output boundary.**
   `personnel.mjs:11` requires `ran_or_saw_cpg_output = "no"` for every role (line 7: "for enumerators
   and all roles alike"), while §4A.2(b) L158 scopes it to "before completing the frame". A rater
   necessarily sees CPG output. An outsider re-running `check-personnel` on the archived register gets a
   result whose meaning depends on *when* the declarations were true, and **no artefact carries that
   time**. In the seven-person design the register is fixed once and early; under a merge that spans the
   boundary it is unrepresentable.
4. **§9.8's `independence_class` is not a personnel check and should not be read as one.**
   `reconcile.mjs:71` writes `PENDING_RUN` into every sealed row, per §9.8 L639, and post-run
   classification compares *documents*, not people. An outsider must not take a low SOURCE-COINCIDENT
   rate as evidence of *personnel* independence.

---

## 4. Net delta

| Claim class | Seven-person design | Reduced-headcount design |
|---|---|---|
| Sampling integrity — the sample was not chosen | **Mechanical** (§21 steps 3–9; §13.3 L825) | **Mechanical, unchanged** |
| Single frozen frame; registry freeze; no post-hoc rows | **Mechanical** (attacks #26, #26a, #27a) | **Mechanical, unchanged** |
| Execution window; one run; no repeat | **Mechanical for logged runs** (attack #33) | **Mechanical, unchanged** |
| Reference truth sealed before execution and not edited after | **Mechanical** (§9.6 L628–630) | **Mechanical, unchanged** |
| Packet shape and blinding *of the artefact* | **Mechanical** (attacks #35, #36) | **Mechanical, unchanged — and increasingly misleading**, since the artefact is blind while the human is not |
| Rater order not chosen | **Mechanical** (attack #37) | **Mechanical, unchanged** |
| Labels and endpoints re-derivable offline | **Mechanical** (§13.3 L821) | **Mechanical, unchanged** |
| Role exclusivity | **Structural in the register** (attack #34 "PREVENTED structurally in the register; truthfulness PROCEDURAL") — but **not in §21**, and the register is restricted | **Attestation only.** The structural check now compares strings that no longer denote distinct humans |
| Two independent reference constructions | Attestation + a corroborating `AGREED` rate | **Attestation only**; the `AGREED` rate becomes uninformative or actively misleading |
| ≥ 2 **independent** ratings; α as reliability | **Mechanical-looking, genuinely inter-rater** | **Attestation only**; α still computes and passes more easily |
| Adjudications were blind *to the human* | Attestation, artefact-corroborated | **Attestation only**, and the corroboration is now spurious |
| No preview | Attestation + audit (§20.20) | **Unchanged**, unless a merged person gains CPG access |
| Frame unbiased | Attestation (§20.18, **UNRESOLVED**) | **Worse** — backward edge B1 gives the enumerator a concrete anticipatory incentive |

**Summary.** A head-count reduction costs an outsider **nothing** in the cryptographic and artefact
layers, and **everything in the personnel layer** — which is precisely the layer §21 never reaches and
§20.23 already flags as resting on declarations. The characteristic harm is not refusal but **silent
semantic drift**: `check-personnel`, `verify-adjudication-packet`, `verify-rater-packet` and `analyze`
all continue to exit 0 on a design whose human controls have collapsed, and **no published artefact
differs.**

**The two artefacts that would most reduce that harm** (offered as options; not produced here):

1. a published `check-personnel` **and** `role_conflict_check` transcript, so role exclusivity has any
   outsider evidence at all — today it has none, because the register is restricted and §21 has no step
   for it;
2. a registration-level disclosure of every role overlap **with its assessed direction**, so a reader can
   discount the endpoints correctly — noting that a SUCCESS under a reference→rating overlap is
   conservative, while a FAILURE or FALSIFIED under it is confounded
   (`INDEPENDENCE_ANALYSIS.md` §2.3).

---

*AGENT E, DEEPTECH-HUMAN-MIN-001. Methodology review. `research/cpg-u1/**` and `C:/tmp/dt002`
unmodified.*
