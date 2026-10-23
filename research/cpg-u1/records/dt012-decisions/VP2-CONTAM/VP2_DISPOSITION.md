# VP-2 DISPOSITION — jurisdiction coverage (DEEPTECH-PARALLEL-012 §7)

**Stream:** VP-2 / contamination (analysis only). **Nothing was implemented, patched or modified.**
**Candidate:** `C:/tmp/dt009-merge/tooling`, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files — read-only.
**Protocol:** `C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md`, SHA `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **not modified, not recomputed by CPU-heavy means, not touched.**
**Firewall honoured:** no write under `C:/tmp/dt009-merge`; no selftest, no mutation suite, no command executed against the tree; the running 404-mutant suite's output was not inspected.

---

## 1. The hard constraint, tested rather than assumed

§7 requires: *"The development commitment must be impossible to authorize while the gate is failing."*

**VERDICT: option A CANNOT satisfy this constraint. Not as specified, and not by any weakening that keeps
the word "impossible". The constraint is satisfiable only by an instrument change, so A and B are not a free
choice — the constraint, as written, selects B.**

### 1.1 What "impossible to authorize" actually looks like in this instrument

The outcome-class minimum is the working exemplar, and it is binding because of **three independent machine
barriers**, not one:

| # | Barrier | Site | Effect |
|---|---|---|---|
| 1 | `check-frame-sufficiency` refuses | `cpg_u1_data.mjs:660` | `FRAME_INSUFFICIENT`, exit 1 |
| 2 | `commitment-payload --stage development` refuses **before writing the payload** | `cpg_u1_data.mjs:369-370` | `FRAME_INSUFFICIENT: no development commitment may be made`; the payload file is never created — asserted as fail-closed at `test/selftest.mjs:1381` (`… && !existsSync(P('payload_small.json'))`) |
| 3 | `draw-development` re-derives sufficiency **from the committed frame** and voids | `cpg_u1_data.mjs:444-445` | `STAGE_VOID_FRAME_INSUFFICIENT`, exit 6, nothing drawn — asserted at `test/selftest.mjs:1429` |

Barrier 3 is the one that earns the word *impossible*. Even an operator who hand-wrote a payload JSON,
computed its digest and broadcast the OP_RETURN would get no sample: the draw itself refuses and the stage is
VOID. "Impossible to authorize" in this instrument means *the authorised act cannot be completed usefully*,
enforced at a chokepoint that consumes a hashed artefact.

### 1.2 Why an operator-side gate cannot reach any of those chokepoints

Four closed doors, each verified by reading the file:

1. **`cmdFrame` produces no artefact.** `cpg_u1_data.mjs:205-225` is `console.log` plus one refusal
   (`ENUMERATION_ATTRIBUTION_REFUSED`, `:222`). There is **no `writeOnce` in `cmdFrame`** — the 23
   `writeOnce` call sites in the file (`:293, :308, :389, :465, :466, :485, :560, :561, :612, :642, :683,
   :721, :745, :770, :897, :941, :970, :1007, :1034, :1047, :1085, :1110`) do not include it. So there is no
   frame-stage artefact into which a coverage verdict could be written, and nothing downstream could read one.
2. **The commitment payload key set is closed.** `PAYLOAD_KEYS` is exactly 11 keys
   (`lib/commitment.mjs:11-12`) and `checkPayload` enforces them two-sidedly via `sameKeys`
   (`lib/commitment.mjs:19, 24`: exact length **and** universal presence, returning immediately on failure).
   A `coverage_certificate_sha256` key cannot be added without editing `lib/commitment.mjs`.
3. **The declarations key set is closed.** `lib/analysis.mjs:59-60`, same two-sided test, and `cmdAnalyze`
   fails closed on it (`cpg_u1_data.mjs:1063`, `DECLARATIONS_REFUSED`). And it is post-seal anyway — far too
   late to gate a pre-commitment act.
4. **The registration's sampling view is fixed.** `SAMPLING_FIELDS` is exactly
   `['protocol_sha256','tooling_aggregate_sha256','registry_sha256','network','outpoints','checkpoint','parameters']`
   (`lib/registration.mjs:119`). No coverage field exists there, and adding one would move the very fields
   `checkAuthority` compares (`:136-141`).

Neither `check-frame-sufficiency` (`cpg_u1_data.mjs:657-661`) nor `commitment-payload`
(`cpg_u1_data.mjs:359-394`) reads `jurisdiction_family`; both reach the row data only through
`sufficiencyOf` → `frameSufficiency`, whose entire body (`lib/frame.mjs:41-50`) reads
`expected_outcome_class` and `candidate_id` and nothing else. `jurisdiction` does not occur in
`lib/frame.mjs`.

**Therefore: an operator-side gate has no artefact that any chokepoint consumes, and no chokepoint that could
consume one. It cannot refuse. It is advisory by construction.**

### 1.3 The admission, stated plainly

There is exactly one actor who can *authorize* the development commitment, and it is a human: the key
custodian spends `O_dev`. The tooling says so itself — `cpg_u1_data.mjs:393`:
*"Spend ONLY <outpoint>, with exactly this one OP_RETURN output. The tooling creates no transaction."*
A procedural instruction to that custodian is therefore a **real** control in the same sense that the whole
commitment act is human — but it is a control the custodian can disregard with no machine consequence and no
VOID. Calling that "impossible" would be false.

**Admission:** *"impossible to authorize" inherently requires a machine barrier. A machine barrier requires
editing `lib/frame.mjs` plus `cpg_u1_data.mjs:369-370` and `:444-445`, which moves the tooling aggregate;
and because the refusal contradicts §5.7.1 clause (c), it also requires a protocol amendment, which moves
`protocol_sha256`. Both are `SAMPLING_FIELDS` members. The constraint as written cannot be met by A, and can
be met by B only at the price of a new protocol file and a re-registration.*

### 1.4 The consequence for §7's framing

The §7 constraint was written as if the only open question were *where to put the gate*. The verified facts
show the prior question is unanswered: **the protocol does not ask for a gate at all.**
`CPG_U1_PROTOCOL_004.md:379` is `[NORMATIVE]` and requires (a) round-robin interleaving, (b) publication of
the realised composition, and (c) *"missing families are declared as a scope limitation"* — clause (c)
explicitly contemplates and **permits** a frame missing families. §20.1 (`:965`) disclaims jurisdiction
generalisation; §20.3 (`:967`) declares the four-family bound as a limitation. My own grep of the protocol
for `jurisdiction` returns 10 hits (`:167, :206, :212, :214, :379, :569, :574, :830, :857, :965, :967`) and
**none** states a family count minimum, a per-family row minimum, or any refusal condition.

So satisfying "impossible to authorize" would install a refusal where the protocol prescribes a declaration.
**The correct disposition is to withdraw the constraint, not to satisfy it.**

---

## 2. Six-axis comparison — A vs B (and the third option)

| Axis | **A** — operator-side pre-commit gate | **B** — `frameSufficiency` gains a jurisdiction floor | **Third** — clause (b) only: publish the tally, refuse nothing |
|---|---|---|---|
| **Evidentiary risk** | Moderate-but-honest if labelled advisory; **high if labelled a gate**, because the record would assert a control that cannot refuse. The underlying fact is already auditable: `jurisdiction_family` is FRAME_COLUMN 3 (`lib/schema.mjs:16`), inside `frame_hash` (whole-record `canonicalJson`, `lib/canonical.mjs:7-21`), hence on-chain via `PAYLOAD_KEYS` (`lib/commitment.mjs:11-12`; `cpg_u1_data.mjs:372`), and in the sealed screening log (`cpg_u1_data.mjs:139, 152`; sealed `:632-633`). | **Highest.** Creates a refusal the protocol does not authorise and clause (c) contradicts. A reviewer who reads §5.7.1 and then the code sees the tool enforcing a rule the registered protocol does not state — the inverse of the present gap, and worse, because it is undisclosed enforcement. | **Lowest.** Discharges a `[NORMATIVE]` duty that is currently unmet. Converts an undisclosed property into a published one. Nothing is refused, so nothing can be wrongly refused. |
| **Reproducibility** | Unaffected. No input to any hash changes; the draw is byte-identical. An outsider can recompute the tally from the archived frame (§13.2A `:815` lists "the single frame F") and the sealed screening log (`:857`). | Changes the *admissible-frame predicate*, so a frame that would have been committed may now be refused. Re-certification (selftest + 404 mutants) mandatory. Reproducibility of the *decision procedure* improves; reproducibility of *this candidate* is destroyed. | Adds a printed/serialised derived value. Draw unchanged. Requires re-certification only because the aggregate walks every file. |
| **Operator discretion** | **Maximal and unbounded** — this is the defect, not a feature. The operator decides the threshold, whether to apply it, and whether to proceed anyway, after seeing the frame. That is exactly the shape of discretion §5.5's "NO LATER ADDITIONS" and §15.2's "exclusion rules may not change after any held-out result is seen" exist to suppress — though note the frame is pre-outcome, so the discretion is not yet outcome-dependent. | **Zero**, which is the point — and zero is more than the protocol grants. §5.7.1 assigns the operator a *duty to declare*, i.e. deliberately leaves the proceed/decline judgment with the operator subject to disclosure. B removes a discretion the protocol conferred. | Zero discretion over *disclosure*; the proceed judgment stays where §5.7.1 put it. Best match to the registered text. |
| **Auditability** | **The gate is unauditable; the underlying fact is fully auditable.** There is no checklist item, runbook step or attestation field an auditor could tick: `README.md:50-66` and the coverage table at `README.md:195-220` have no jurisdiction row, and the protocol prescribes no operator check. Best achievable: an OSF-timestamped certificate (see §4) giving outsider-checkable *ordering*, never outsider-checkable *enforcement*. | Fully auditable once certified — a named constant, a refusal string, a test and a mutant. But auditable against **no registered requirement**, so an auditor cannot tell whether the threshold is correct or arbitrary. There is no author to attribute the number to. | Fully auditable: the published tally is either present and correct against `frame_hash` or it is not. Auditable **against registered NORMATIVE text**, which neither A nor B achieves. |
| **Aggregate impact** | **None.** `638d68e6…` is untouched — the honest reason being that no code is written, not that a cost-free control was found. | **Moves the aggregate, unavoidably.** `toolingManifest` walks every regular file of the tree (`lib/aggregate.mjs:8-23`), so even the test alone moves it. Consequences: the 404-mutant certification of `638d68e6…` becomes certification of a superseded artefact; and if the aggregate is already registered, `tooling_aggregate_sha256` is a `SAMPLING_FIELDS` member (`lib/registration.mjs:119`), so a second registration yields *"duplicate registration … names different sampling fields — study VOID"* (`:141`) while the earliest registration stays authoritative (`:136`). **Post-registration this is not a patch; it is a restart.** Post-commitment it is impossible (`frame_hash` committed; `cpg_u1_data.mjs:497`, `lib/sampling.mjs:151`). | Moves the aggregate for the same structural reason, with the same pre-registration-only window — **unless** derivability is accepted as publication (§3), in which case the cost is zero. |
| **Protocol impact** | **None**, provided the record stops calling it a gate. A cannot be described as protocol-required, because §5.7.1 prescribes publication and declaration, not a check. | **Amendment required, not merely permitted.** A refusal contradicts clause (c). §6 (`:446`) permits change only "by a new protocol version as a new file", and §19.1 (`:936`) lists §5.7.2 / the frame rules among the clauses **closed** at registration. So `protocol_sha256` moves — a second `SAMPLING_FIELDS` member — compounding the aggregate consequence. | **None.** It implements existing NORMATIVE text. This is the decisive asymmetry: B needs an amendment to become lawful; the third option needs none to become compliant. |

---

## 3. The third option (clause (b) only) — evaluated, and recommended

Clause (b) of §5.7.1 — *"The realised jurisdiction composition is published"* — is `[NORMATIVE]` and is a
**live, real gap**, distinct from the nonexistent minimum. No command computes or prints a family tally;
`FAMILY_ORDER` (`lib/schema.mjs:50`) has exactly two consumers tree-wide, its own declaration and the
round-robin at `lib/select.mjs:29`, so nothing anywhere aggregates by family.

**But it is closer to satisfied than wave 011 concluded, and the gap is narrower than "unimplemented".**
The realised composition is recomputable from artefacts the protocol *already mandates be published*:

- the single frame F and both screening logs are mandatory sampling-archive members (§13.2A, `:815`);
- the screening log carries `jurisdiction`, `split`, `stage` per candidate per stage (§15.3, `:857`), and is
  written write-once (`cpg_u1_data.mjs:466, :561`) and sealed (`:632-633`);
- the dataset seal binding both screening logs is in the hashed-and-published set (§13.2, `:811`).

So the realised composition is **published as sealed data, tamper-evidently, and is not published as a
derived statement.** Whether clause (b) is discharged by publishing the data from which the composition is
computed is a reading question, and it is the owner's, not a verifier's. Two honest gradations:

- **(b-0), zero cost, zero aggregate move, zero protocol move.** Accept derivability as publication, and
  discharge clause (b) explicitly in the published write-up: state the per-class per-family tally in prose,
  cite `frame_hash` and `screening_log_sha256` so the reader can recompute it, and discharge clause (c) by
  naming the zero-count families as a scope limitation. Note clause (c) *cannot* be pre-written into §20: the
  registration precedes frame enumeration (§5.5 steps 2 → 3, `:264, :266`), so the frame does not exist at
  registration time and the missing-family declaration is necessarily a post-frame publication act. §20.3
  (`:967`) declares the four-family *bound*; it does not and cannot declare which families were *realised*.
  **This is the minimum protocol-compliant option, and it is available today.**
- **(b-1), aggregate-moving, pre-registration only.** Print the tally in `cmdFrame` (`cpg_u1_data.mjs:213-216`)
  and carry a `jurisdiction_composition` field in the draw manifests so it enters `manifest_sha256` and hence
  the seal. Strictly better disclosure; costs a new aggregate and full re-certification; must be decided
  **before** registration or it is gone.

**Recommendation: (b-0) now, unconditionally, because it is required and free; (b-1) only if the owner is
already re-cutting the aggregate for another reason. Not B. Not A-labelled-as-a-gate.**

One further finding that belongs in the same decision, independently confirmed: **the protocol's only
NORMATIVE jurisdiction behaviour is itself uncertified.** `test/mutate.mjs` carries 404 mutants and none
mentions `jurisdiction`, `FAMILY` or `orderedClass`; the six `lib/select.mjs` mutants target held-out
eligibility, pool multiplier, development cap, domain uniqueness and the rank key. Decision D-A's round-robin
(`lib/select.mjs:28-35`) is exercised by one selftest assertion (`test/selftest.mjs:250`) and no mutant. A
passing 404/404 score is therefore **not** evidence about VP-2 or about D-A; the gate is not in the mutant
population and neither is the round-robin. (Not executed here — firewall.)

---

## 4. IF A — the fully specified procedural variant, honestly labelled

Recorded because the owner may choose it as the fallback when the aggregate is frozen. **It is not a gate.
Label: PROCEDURAL, ADVISORY-WITH-EVIDENCE. It cannot refuse.**

| Field | Specification |
|---|---|
| **WHEN** | After `frame`, `scan` and `check-frame-sufficiency` all succeed (§5.5 step 3, `:266`), strictly before `commitment-payload --stage development` is run and before `O_dev` is spent (step 4, `:267`). This is the only window: post-commitment the frame is frozen (`cpg_u1_data.mjs:497` `FRAME_CHANGED`; `lib/sampling.mjs:151` `STAGE_VOID_BINDING_MISMATCH`). |
| **WHO** | The enumerator(s) compute the tally; the **key custodian (`STUDY_OPERATOR`)** holds the barrier, because the custodian is the only actor who can authorize — the tooling creates no transaction (`cpg_u1_data.mjs:393`). §4A keeps the operator out of every other role, so the barrier sits with a person who has no stake in the outcome. |
| **INPUT** | Exactly the inputs `check-frame-sufficiency` consumed: the frame CSV (with its printed `frame_hash`, `cpg_u1_data.mjs:217`), `--scan`, `--registry`. No new input, so no new trust assumption. |
| **CHECK** | `GROUP BY jurisdiction_family` over rows that are admissible (`res.exclusion === null`) and held-out-eligible (not in `c.ineligible`), broken down by `expected_outcome_class`; report all four `FAMILY_ORDER` families including zeros. **No threshold is asserted**, because none is registered and inventing one is B. |
| **FAILURE** | **There is no mechanical failure mode.** The only failure is the custodian declining to spend `O_dev` and the enumerators re-enumerating a fresh frame — lawful only because no commitment has been made yet, and only before step 4. |
| **ARTIFACT** | A `VP2 coverage certificate`: an operator-authored document naming `frame_hash`, `scan_sha256`, `registry_sha256`, the per-class per-family tally, the list of zero-count families, the proceed/re-enumerate decision, the signatories and a UTC timestamp. **It is not a tooling artefact** — no command writes it and no schema defines it. |
| **HASH** | `sha256` of the certificate, published. **It has no consumer and binds nothing.** The payload key set (`lib/commitment.mjs:11-12, 19, 24`), the declarations key set (`lib/analysis.mjs:59-60`) and `SAMPLING_FIELDS` (`lib/registration.mjs:119`) are all closed, so the hash cannot enter any hashed structure. The load-bearing hash is `frame_hash` itself, which already commits the composition on-chain — so the certificate's *truth* is checkable without the certificate's hash. |
| **COMMIT BARRIER** | **Procedural only.** The strongest available reinforcement: publish the certificate as a public record **linked to the registration on OSF** before broadcasting the `O_dev` spend. The protocol already relies on exactly this instrument — the published seal record is "a public record linked to the registration on OSF Registries … with a registry-issued timestamp" (`:456`), and that registry timestamp is already load-bearing, defining when the execution window opens (`:461`, and the §21 mapping at `:1089`, "OSF is the approved registry"); §20 declares registry trust institutional (`:978`, `:1059`). An outsider can then compare the OSF timestamp with the commitment block's time. |

**What an outsider CAN verify:** that the tally in the certificate is true, by recomputing it from the
archived frame F (§13.2A `:815`) and checking it against the on-chain `frame_hash`; and that the certificate
predates the commitment, by comparing the OSF registry timestamp with the commitment block.

**What an outsider CANNOT verify:** that any threshold existed; that a failing frame would have been
refused; that the certificate was not written to match a frame already chosen; or that no other frame was
enumerated and discarded. Nothing mechanically refuses at any point.

---

## 5. NINE-FIELD RETURN — §7 VP-2

**DECISION.** VP-2 is **not added to the registered instrument** as a gate. Option **B is rejected**.
Option **A cannot satisfy the stated constraint** and is retained only as a fallback, re-labelled procedural.
The adopted disposition is the **third option in form (b-0)**: discharge §5.7.1 clauses (b) and (c) by
publication, refuse nothing.

**RECOMMENDED RULE.**
1. No jurisdiction-coverage refusal is introduced. No per-family floor is defined.
2. The realised per-class, per-family composition of the frame and of both draws is stated in the published
   write-up, with `frame_hash` and both `screening_log_sha256` values cited so a reader can recompute it.
3. Families with zero realised rows are declared as a scope limitation, alongside §20.1 and §20.3.
4. The wave record's VP-2 entry is re-labelled from *"operational, no aggregate cost"* to the wording in the
   last field below. The "no aggregate cost" half stands; the "operational" half does not.
5. If — and only if — the aggregate is being re-cut before registration for another reason, (b-1) may be
   added: a tally printed by `cmdFrame` and a `jurisdiction_composition` manifest field entering the seal.
6. A jurisdiction mutant and a one-family negative-control selftest are added **only** together with (b-1);
   they are worthless without something to certify.

**ALTERNATIVES CONSIDERED.** B (per-family floor in `frameSufficiency`, enforced at `cpg_u1_data.mjs:369-370`
and `:660`, and necessarily at `:444-445`) — rejected: contradicts §5.7.1 clause (c), requires a protocol
amendment as a new file (§6 `:446`) against clauses closed at registration (§19.1 `:936`), and moves both
`protocol_sha256` and `tooling_aggregate_sha256`, i.e. two `SAMPLING_FIELDS`. A-as-a-gate — rejected: cannot
refuse; no artefact, no chokepoint. A-as-procedure — retained as fallback, §4 above. (b-1) — retained as a
conditional upgrade. Doing nothing at all — rejected: clause (b) is `[NORMATIVE]` and its derived statement
is currently never made.

**SCIENTIFIC / INTEGRITY EFFECT.** Positive and modest. The real exposure was never code correctness: it was
**disclosure**. `orderedClass` (`lib/select.mjs:28-35`) is the mechanism §5.7.1 names as the balance
mechanism, and on a one-family frame it degenerates silently to plain rank order and emits nothing — a
load-bearing mechanism providing zero balance with no artefact saying so. (b-0) makes that visible in the
published record, which is precisely what §5.7.1 asks for. It adds no false assurance: no threshold is
claimed, so no reader can mistake publication for enforcement. Residual, declared: breadth remains an
operator-influenced property of the enumerated frame, bounded only by §20.1/§20.3 and by the fact that the
registration precedes enumeration.

**REGISTRATION EFFECT.** **(b-0): none.** No `SAMPLING_FIELDS` member moves — `protocol_sha256`,
`tooling_aggregate_sha256`, `registry_sha256`, `network`, `outpoints`, `checkpoint`, `parameters` are all
untouched (`lib/registration.mjs:119`), and narrative additions to the registration record are not part of
`samplingView`, so `checkAuthority` (`:136-141`) is unaffected. **(b-1): moves `tooling_aggregate_sha256` —
pre-registration only; after registration it is a re-registration that is not authoritative.** **B: moves
`protocol_sha256` and `tooling_aggregate_sha256` — a restart.**

**MUTATION EFFECT.** **(b-0): none** — no file changes, the 404-mutant population and the candidate aggregate
are untouched, and the suite currently running remains a certification of the artefact it is running against.
**(b-1)/B: full re-certification required** (`lib/aggregate.mjs:8-23` walks every regular file, so even a
test-only edit moves the aggregate; there is no test-only, aggregate-free option). Independent finding either
way: the current 404/404 result says **nothing** about VP-2 or about decision D-A — zero mutants mention
`jurisdiction`, `FAMILY` or `orderedClass`.

**PROTOCOL EFFECT.** **None. No protocol modification of any kind is proposed, and none was made.** (b-0)
implements existing `[NORMATIVE]` text at `:379`. This is the asymmetry that decides §7: B needs an amendment
to become lawful; (b-0) needs none to become compliant.

**OWNER APPROVAL REQUIRED?** **Yes, for one point only, and it is a reading question:** whether clause (b)'s
*"is published"* is discharged by publishing the sealed artefacts from which the composition is recomputable
plus a prose tally (b-0), or requires a tooling-emitted, seal-bound tally (b-1). Everything else in the
recommended rule is either forced by the text or is a record correction. No owner approval is inferred here.
The §7 constraint itself also requires an owner act: **withdraw it**, or accept B's re-registration.

**EXACT WORDING TO RECORD.**

```
VP-2 (jurisdiction coverage) — DISPOSITION: NOT A GATE; NOT ADDED TO THE REGISTERED INSTRUMENT.

Protocol-004 defines no jurisdiction-coverage minimum. §5.7.1 (:379) [NORMATIVE] requires round-robin
interleaving, publication of the realised composition, and the declaration of missing families as a scope
limitation; clause (c) therefore PERMITS missing families, and a refusal would contradict it and require a
protocol amendment as a new file (§6 :446) against clauses closed at registration (§19.1 :936).

The §7 constraint "the development commitment must be impossible to authorize while the gate is failing"
CANNOT be met by an operator-side gate. cmdFrame writes no artefact (cpg_u1_data.mjs:205-225, no writeOnce);
check-frame-sufficiency (:657-661) and commitment-payload (:359-394) never read jurisdiction_family; and the
commitment payload keys (lib/commitment.mjs:11-12, enforced two-sidedly at :19/:24), the declarations keys
(lib/analysis.mjs:59-60) and SAMPLING_FIELDS (lib/registration.mjs:119) are all closed sets. An operator-side
gate is therefore ADVISORY, not binding. "Impossible" requires a machine barrier at cpg_u1_data.mjs:369-370
and :444-445, i.e. an instrument change plus a protocol amendment. The constraint is withdrawn rather than
satisfied.

ADOPTED: discharge §5.7.1 clauses (b) and (c) by publication. The realised per-class, per-family composition
of the frame and of both draws is stated in the published write-up, citing frame_hash and both
screening_log_sha256 values so any reader can recompute it; families with zero realised rows are declared as
a scope limitation alongside §20.1 and §20.3. No refusal is introduced. No per-family floor is defined.
Aggregate 638d68e6... is untouched; protocol SHA c50fc680... is untouched.

RECORD CORRECTION: VP-2's prior label "operational, no aggregate cost" is replaced by "not implemented; no
protocol basis for a gate; jurisdiction breadth is a DISCLOSURE duty under §5.7.1(b)-(c), auditable post hoc
from frame_hash and the sealed screening log, and until published it is asserted nowhere". The aggregate
claim survives; the control claim does not.

NOT CERTIFIED, INDEPENDENTLY FOUND: zero of the 404 mutants mention jurisdiction, FAMILY or orderedClass, so
decision D-A's round-robin (lib/select.mjs:28-35) rests on one selftest assertion (test/selftest.mjs:250) and
no mutant. A passing 404/404 score is not evidence about this axis.
```

---

## 6. Not executed (firewall)

- No selftest, no mutation suite, no CLI command, no aggregate recomputation against
  `C:/tmp/dt009-merge/tooling`. Every finding above is an absence or a closed-set property established by
  reading named lines; an absence cannot be demonstrated by a passing suite, and §3 shows the suite is
  structurally incapable of covering this axis.
- The running 404-mutant suite's output and partial verdicts were not inspected.
- Not attempted: a live one-family-frame demonstration through `check-frame-sufficiency` and
  `commitment-payload`. The static argument is closed (`lib/frame.mjs:45` reads only
  `expected_outcome_class`), and a live run would load the firewalled tree.
