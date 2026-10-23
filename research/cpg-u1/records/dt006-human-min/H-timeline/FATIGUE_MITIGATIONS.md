# FATIGUE_MITIGATIONS — quality risk from concentrated load, and what can be pre-registered

**AGENT H of DEEPTECH-HUMAN-MIN-001. ENGINEERING ARTIFACT.** Proposals only. Nothing here edits
`CPG_U1_PROTOCOL_004`, and per §6.2 any of it would have to arrive as a **new protocol version as a
new file**, never as an edit. Observation counts are FIXED INPUTS and are never reduced.

---

## 1. The exposure, quantified

Worst permitted configuration (60/25/15 = 100 companies, 330 reference observations per recorder,
300 rating observations per rater):

| Design | Heaviest person | Roles held by that person | vs 7-human |
|---|---|---|---|
| 7-human | 137.5 h / 34.4 working days | 1 | 1.00× |
| 8-human (2 enumerators) | 137.5 h / 34.4 days | 1 | 1.00× |
| 3-human | **218.0 h / 54.5 days** | 3 | **1.59×** |
| 2-human | **234.6 h / 58.6 days** | **4** | **1.71×** |

Total human hours barely move between designs — the work does not shrink. What changes is
**concentration** (one person carrying 1.7× the peak load) and **role collapse** (one person
occupying up to 4 of the 7 mutually exclusive roles). Both are quality risks, and they are different
risks: the first is rushing and drift, the second is recognition across roles.

## 2. Where protocol-004 already has a mechanical safeguard

| Risk | Safeguard | Strength |
|---|---|---|
| Reference recorder invents or mis-reads a value | Blind double entry; `agreementKey` comparison in `reconcile()`; disagreement **must** be adjudicated by a third person | **Strong** against independent error. **Blind to shared error** — if both recorders make the same mistake, it reconciles as AGREED and "an adjudication may not override it" (§9.5) |
| Reference values chosen after seeing CPG output | `seal_hash` binds both manifests, screening logs, sizing, the three blind-record files and the reconciled file; published and timestamped before execution (§9.6) | **Strong.** Any post-execution change yields a different hash |
| Rater inconsistency / drift | Krippendorff's nominal α ≥ 0.667, plus per-label agreement published; §15.5(3) INCONCLUSIVE below it | **Strong when the raters are genuinely independent.** See §3 for why that qualifier matters |
| Incomplete rating | ≥ 90% of held-out observations completely rated, else INCONCLUSIVE (§15.5(3)); `pending` never imputed, never scored | **Strong** |
| Order or position gaming | `order_key(label, candidate_id, field) = SHA-256("cpg-u1-rater-order/v1\|" + ho_record_sha256 + "\|" + label + "\|" + candidate_id + "\|" + field)`; one-way, unknowable before the held-out drand round, published as `cpg-u1-rater-order/v1` with `order_sha256`, recomputable by any outsider (`verify-rater-order`); separate labels for order and blind position (`ORDER_LABELS` vs `ASSIGNMENT_LABELS`) | **Strong — and already done.** Every mitigation below builds on it and invents no new ordering scheme |
| Packet tampering / selective URL sets | Deterministic build + rebuild verification (`verify-rater-packet`, `verify-adjudication-packet`); §12.3 Rule A URL union derived mechanically, byte identity required | **Strong** |
| Person-to-label gaming | The `rater-1` / `rater-2` / `rating-adjudicator` assignment is fingerprinted and published **before the held-out commitment** (§4A.3, §12.1) | **Strong** |
| Non-independent person in a role | Signed §4A.1 declarations, fee-agreement hash, organisation confirmation; `checkPersonnelRegister` verifies structure | **Procedural only.** §4A.1 says so itself: "procedural evidence, not proof"; the tooling "cannot verify that declarations are true" |

## 3. Where protocol-004 has **no** mechanical safeguard

These are the gaps that concentrated load actually exploits.

1. **Timestamps are day-granular.** `checkBlindRecord` requires `recorded_at` to satisfy
   `isCalendarDate` (`YYYY-MM-DD`), and `rated_at` likewise. **A recorder who does 330 reference rows
   in two evenings and a rater who does 300 ratings in one afternoon produce artefacts
   indistinguishable from careful work spread over weeks.** There is no per-row time, no session
   boundary, no pacing evidence anywhere in the archive. This is the single largest fatigue blind
   spot.
2. **No batch-size, rest or pacing requirement** of any kind. Nothing limits rows per day or per
   session.
3. **No detector for correlated agreement.** α measures whether two labels match, not whether the two
   labellers were independent. Two people who previously constructed the reference truth for the same
   rows share priors, search paths and mistakes; their α is **inflated**, so the safeguard weakens
   exactly in the design that needs it most. Nothing in the tooling can see this.
4. **No detector for cross-role recognition.** Nothing checks whether a rater is looking at a
   `reference_record` they wrote themselves. §4A.3's mutual exclusion is the only defence, and the
   small-team design is precisely the removal of that defence.
5. **No order-effect or drift diagnostic.** `order_key` fixes the order but nothing examines the
   *published sheets* for label-distribution or pace change across order position.
6. **No artefact proves the §9.1 no-communication rule.** Author and Confirmer "must not communicate
   before both have submitted"; nothing in the archive can evidence that.
7. **Adjudication is single-point.** One adjudicator's tired decision on a disagreeing row has no
   second check, at any headcount.

## 4. Pre-registrable mitigations requiring no third human

All are **disclosure and validity instruments**, never exclusion criteria. §15.2 is explicit: "No
observation may be excluded because its result is unfavourable", and "exclusion rules may not change
after any held-out result is seen". Each mitigation must be frozen **in the registration**, before
the development commitment, or it is worthless.

### M1 — Sub-day timestamps (enables everything else)

**Rule.** `recorded_at`, `rated_at` and `adjudicated_at` become RFC 3339 instants with seconds and a
UTC offset, one per row, recorded at submission of that row. The calendar-date form is retained as a
derived field so §15.3 and the seal are unaffected in content.

**Verified from artefacts.** A schema check (`isCalendarDate` → `isInstant`) plus a published
per-person interval series recomputable from the sheets. Nothing to trust: the timestamps are inside
the sealed blind-record files and the per-rater sheets, which are already published (§13.2).

**Limit, stated honestly.** A self-reported instant can be back-dated. M1 makes rushing *visible when
honestly recorded*; it does not make it *impossible*. That limitation belongs in §20.

### M2 — Mandated batches defined by `order_key` position, with a minimum elapsed time per batch

**Rule.** Partition each person's list into consecutive batches of exactly **B** items **by
`order_key` position** — the order already published in `cpg-u1-rater-order/v1`, so no new ordering
scheme and no discretion. Pre-register `B` per role (proposal: B = 25 for reference construction,
B = 50 for rating), a **minimum elapsed time per batch** `E_min` (proposal: `B × 0.6 ×` the
pre-registered per-row assumption, so 25 reference rows ≥ 250 min), and a **minimum inter-batch gap**
`G_min` (proposal: 8 h, i.e. batches cannot be chained through a night).

**Verified from artefacts.** Rebuild the order from the seal + manifest + §12.1 rule; partition by
position; for each batch compute `max(ts) − min(ts) ≥ E_min` and `min(ts of batch k+1) − max(ts of
batch k) ≥ G_min` from M1 timestamps. Entirely offline, entirely recomputable by an outsider, no new
trusted input.

**Reference construction needs one addition to work:** the reference phase has no published order at
all. Extend §12.1's existing hash to two new labels, `reference-author` and `reference-confirmer`,
using the same `ho_record_sha256` (which exists by then — reference construction follows both draws).
Because the labels differ, the two recorders traverse the rows in **unrelated orders**, which
decorrelates their fatigue trajectories — a real strengthening of the blind double entry, and it
costs nothing and needs nobody.

### M3 — Maximum rows per person per calendar day

**Rule.** Pre-register a cap (proposal: 12 reference records or 40 ratings per person per day).
Exceeding it does not invalidate anything; it is **published as a declared validity threat** beside
the endpoints.

**Verified from artefacts.** Group rows by date from M1 and count. One line of arithmetic over
published sheets.

### M4 — Published pacing and drift diagnostic, pre-registered as reported-not-decisive

**Rule.** Pre-register that the results artefact will publish, per person: (a) the label distribution
in the first vs last quartile of `order_key` position; (b) the median per-row interval by quartile;
(c) the count of rows recorded within `< 0.25 ×` the assumed per-row time. Pre-register the
interpretation **in advance** — these are validity threats to be disclosed, never grounds to drop an
observation.

**Verified from artefacts.** Recomputable offline from the published per-rater sheets, the published
order artefacts and M1 timestamps. The quartile boundaries come from `order_key` position, so they
cannot be chosen after the fact.

### M5 — Mechanical cross-role recognition counter

**Rule.** A new check compares each rater sheet against the reconciled reference file and counts the
items whose `reference_record` carries that rater's own person id as `author` or `confirmer`. In a
seven-person roster the count is **0 by construction**. In any small-team design it is **100% of
rows**, and the tool must **report the number and refuse to describe the ratings as independent**
rather than pass silently.

**Verified from artefacts.** The reconciled reference file already carries `author` and `confirmer`
(`REFERENCE_COLUMNS`); rater sheets already carry `rated_by`. The check needs no new data — only the
restricted register's pseudonym mapping, which already exists.

### M6 — Pre-registered α ceiling statement

**Rule.** Pre-register that **if any rater held any reference role**, the published α is an **upper
bound on independent agreement, not a measure of it**, that the §12 unavailable-raters consequences
apply (every primary endpoint **UNADJUDICATED**, evidence rung ≤ **Rung 2**, **no claim of independent
validation**), and that this is stated in the abstract, not a footnote.

**Verified from artefacts.** The personnel register plus the published person-to-label assignment
fingerprint (§4A.3) determine it mechanically, before any result exists.

### M7 — Per-row no-preview and no-communication attestation at batch boundaries

**Rule.** At each M2 batch boundary the person signs a one-line attestation (batch id, position
range, "no communication with the other recorder about these rows", "no CPG output seen") whose
SHA-256 enters the archive. It converts one study-long declaration into `N/B` dated ones.

**Verified from artefacts.** Hashes in the §13.2A archive; batch ids recomputable from `order_key`.
**It remains procedural evidence, not proof** — §4A.1's own language — and must be labelled as such.

## 5. What none of this fixes

- **Shared reference error still reconciles as AGREED.** Two tired recorders reaching the same wrong
  value is invisible to every mechanism above, and §9.5 forbids overriding agreement. The only real
  defence is R4 replication (reference truth from source families disjoint from CPG's), which needs
  more people, not fewer.
- **Adjudication remains single-point** at every headcount.
- **The fundamental trade stands.** M1–M7 make a concentrated-load design *auditable*. They do not
  make it *independent*. Independence is the thing the study exists to demonstrate, and it is the
  thing headcount reduction spends. §12 already prices that honestly: without independent raters, the
  ceiling is Rung 2 and no claim of independent validation may be made — and per
  `BOTTLENECK_ANALYSIS.md`, the speed being bought is **0.36–4.29 weeks of recruitment search**,
  obtainable more cheaply by **adding** an eighth person to enumerate.
