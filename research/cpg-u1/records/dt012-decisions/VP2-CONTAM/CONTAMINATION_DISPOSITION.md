# CONTAMINATION-CARRIER DISPOSITION (DEEPTECH-PARALLEL-012 §8)

**Stream:** VP-2 / contamination (analysis only). **Nothing was implemented, patched or modified. The gap was
not silently patched.**
**Candidate:** `C:/tmp/dt009-merge/tooling`, aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` — read-only.
**Protocol:** `C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md`, SHA `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **not modified.**

---

## 1. DECISION — C for the carrier, D for the semantics

**The two questions §8 bundles together have different answers, and separating them is the whole finding.**

- **The carrier question is answerable from the text: C.** An *existing* procedural declaration — a public
  record linked to the registration on OSF Registries, with a registry-issued timestamp — **can lawfully carry
  the §5.3 disclosure.** §5.3 mandates only that the disclosure be "recorded (company, basis, date,
  discoverer) and published"; it names no artefact, and the protocol uses unbound "published" for other
  late-discovered findings in at least two other places. C moves neither the aggregate nor the protocol SHA.
- **The semantics question is not answerable from the text: D.** What the disclosure *means* — given that
  §15.1 names a flag `CONTAMINATION-DISCLOSED` that the instrument does not implement, that the field
  resembling it is provably always false and never read, and that a disclosure duty with no negative
  attestation is unfalsifiable — is a methodological choice the owner must make and own.

**Required record, verbatim:**

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION
```

**A is rejected** (implementation): it moves the aggregate for a duty the protocol does not ask the tooling to
discharge, and it is pre-registration-only. **B is rejected** (protocol decision): it moves
`protocol_sha256`, requires a new protocol file (§6 `:446`) against a clause §19.1 (`:936`) lists as closed,
and forces a re-registration — an extreme price for naming a carrier the protocol deliberately left open.

**Registered instrument: C affects it in no way.** No `SAMPLING_FIELDS` member moves
(`lib/registration.mjs:119`); no file under `C:/tmp/dt009-merge/tooling` changes; `protocol_sha256` and
`tooling_aggregate_sha256` are both untouched. A and B each move one or both.

---

## 2. Why C is lawful under §5.3 — tested, not assumed

§5.3 (`CPG_U1_PROTOCOL_004.md:248`), verbatim on the point:

> **Late-discovered contamination:** a contamination discovered after registration is recorded (company,
> basis, date, discoverer) and published.

Four data elements, the verb "recorded … and published", **no object, no schema, no command, and no
`[enforced]` tag** — unlike the attestation rule two lines up at `:239` ("[enforced]") or §5.1 `:200`
("[enforced: `checkFrameRow`; …]"). Four independent textual grounds make an existing published declaration a
lawful carrier:

**(i) The protocol uses unbound "published" for late-discovered findings elsewhere, and nobody reads those as
gaps.** `:147` — if a personnel independence declaration "is later found false, that person's work is
non-independent, **and the finding is published**", with no artefact named. `:498` — on a detected preview or
unauthorised execution, "**the finding is published**", again with no artefact named. §5.3's phrasing is the
document's *house style* for a post-registration factual finding, not an oversight unique to contamination.

**(ii) §13.2 and §13.2A are mandatory-minimum lists, not exhaustive permissions.** Wave 011 read the absence
of a contamination record from those lists as a prohibition. **That over-reads.** Absence from a list of what
*must* be hashed (§13.2, `:811`) or *must* be archived (§13.2A, `:815`) means the item is **not mandated**
there; it does not forbid publishing an additional document. The prohibition-by-absence inference is sound
only for vocabularies the protocol declares exhaustive and selective — §5.10's state table (`:420-441`),
§15.1's dispositions (`:836`), §10.5's "exactly one" (`:706`), §15.5's conditions, §18's halts — where a value
outside the set would have to be *chosen* in place of one inside it. A published addendum displaces nothing.

**(iii) The protocol already publishes records linked to the registration, outside the frozen artefacts, and
already makes one of them load-bearing.** `:456` — the **published seal record** is "a public record linked to
the registration on OSF Registries, naming the seal hash, with a **registry-issued timestamp**". `:461` and
the §21 mapping at `:1089` make that registry timestamp define when the execution window opens, with "OSF is
the approved registry". §20 declares this trust basis openly: `:978` "Registry trust is institutional:
immutability, timestamps, public listing and tombstones rest on OSF, not cryptography", and `:1030`
"Registration edited or embargoed | PREVENTED (OSF immutability) / DETECTABLE (withdrawal)". **A contamination
disclosure published the same way inherits exactly the trust basis the protocol already grants to a gate it
depends on.** It is not a novel channel; it is the channel already in use.

**(iv) C touches nothing the protocol freezes.** The disclosure must **not** edit the frame (§5.5 step 3,
`:266`, "NO LATER ADDITIONS"), the scan or the registry (§5.3 `:246`, "No changes apply after registration";
`STAGE_VOID_BINDING_MISMATCH`, `:433`, `lib/sampling.mjs:151`), or the screening log (write-once,
`cpg_u1_data.mjs:81, 466, 561`; and it has no `date` or `discoverer` column, `:857` — two of the four mandated
fields do not fit). A free-standing published record edits none of them. Critically: **learning the fact is
not a protocol event; substituting a frozen input to record it is.** C stays on the lawful side of that line.

**Strengthening C at zero cost — make it *ex ante*.** The registration record is operator-authored prose whose
narrative is **not** part of `samplingView` (`lib/registration.mjs:119-120`), so text added to it cannot
trigger the `checkAuthority` divergence or duplicate-registration VOID paths (`:136-141`). The channel can
therefore be **pre-specified at registration**: state in the registration narrative that any late-discovered
contamination will be published as a record linked to this registration, naming company, basis, date and
discoverer, and that the company is never excluded and the §10.5 outcome never changes. This converts C from
an ad-hoc afterthought into a pre-registered, timestamped, immutably-hosted commitment — and it costs nothing
and moves nothing. §19.1 lists what *must* be in the registration; it does not cap what may be.

**What C does not fix, and must be declared:** an outsider still cannot distinguish "no contamination was ever
discovered" from "contamination was discovered and never disclosed". C makes a *made* disclosure verifiable in
time (OSF timestamp); it does not make the *absence* of one falsifiable. That residual must be published as a
limitation in the §20 family, exactly as §6.5's unloggable-private-query residual is (`:496`, "declared in
§20.20"). This is not a defect peculiar to C: **only a mandatory negative attestation would fix it**, and the
sole vehicle for that — a fifth declarations key — is option A.

---

## 3. Why A and B are rejected

**A (implementation — a fifth `contamination_disclosed` declarations key).**
The declarations schema is closed to exactly four keys by a two-sided test (`lib/analysis.mjs:59-60`: exact
length **and** universal presence), and `cmdAnalyze` fails closed (`cpg_u1_data.mjs:1063`,
`DECLARATIONS_REFUSED`), so an extra key is a hard refusal, not an ignored field. Adding one edits
`lib/analysis.mjs`, which moves `tooling_aggregate_sha256` — a `SAMPLING_FIELDS` member
(`lib/registration.mjs:119`) — because `toolingManifest` walks every regular file (`lib/aggregate.mjs:8-23`).
Consequences: the 404-mutant certification of `638d68e6…` becomes certification of a superseded artefact;
post-registration, a second registration naming different sampling fields is *"duplicate registration … names
different sampling fields — study VOID"* (`lib/registration.mjs:141`) while the earliest remains
authoritative (`:136`). **Pre-registration only, and gone the moment registration proceeds.**
Two further objections beyond cost: (a) it would have the tooling enforce a carrier the protocol does not name
— the exact inverse of the present gap; (b) it is **incomplete anyway** — the declarations artefact is
consumed at `analyze`, so a contamination discovered *after* analysis still has no carrier and falls back to
C. A buys one genuine thing C cannot: a mandatory sealed **negative** attestation (an explicit empty array
inside `results_sha256`), which is what would make the duty falsifiable. That, and only that, is the case for
A, and it is a case the owner must weigh against a restart.

**B (protocol decision — amend §5.3 to name a carrier and list it in §13.2/§13.2A).**
§6 (`:446`) permits change only "by a new protocol version as a new file", and §19.1 (`:936`) lists §5.3 among
the clauses **closed** at registration (CPG-043 approvals). So B means a new protocol SHA, a new registration,
and the loss of everything bound to `c50fc680…`, including the 180-day clocks of §5.10 (`:425`). It buys only
a *name* for a carrier that C shows is already available, and it does not by itself make the duty falsifiable
— naming the artefact does not compel a negative attestation. **Worst cost-to-benefit of the four.**

**Non-options, recorded so they are not mistaken for available.** The two existing post-seal channels each
produce a protocol-**prohibited** result and must not be used: `identity_inadmissible` →
`disposition = 'INVALID'`, `IDENTITY_INADMISSIBLE_AFTER_DRAW` (`lib/analysis.mjs:146`), forbidden by §5.3's
"never excluded, removed or replaced" and by §15.1 `:836` which keeps the observation VALID — and a category
error besides, since §5.9 `:418` is about an identifier belonging to a different entity; and
`protocol_violations` → `'7_protocol_violation'` (`lib/analysis.mjs:205`) → `outcome = 'INCONCLUSIVE'`
(`:211`), forbidden by §5.3's "never changes the §10.5 outcome", and a category error since a late
contamination is *lawful* under §5.3, not a violation of it. Both are available today; **neither is
compliant.**

---

## 4. The dead flag — confirmed independently, and what it does and does not imply

Verified by reading the named lines, not inherited:

1. **Structurally always false.** `lib/select.mjs:93` —
   `const pool = admissible.filter((c) => !ineligible.has(c.candidate_id) && !developmentIds.has(c.candidate_id));`
   and the held-out set is drawn only from that `pool` (`:98`). `ineligible` is exactly the key set of the
   basis map (`cpg_u1_data.mjs:126`), so every drawn held-out entry has `basis[id] === undefined → []`. The
   flag at `lib/analysis.mjs:159` is `(… held_out_ineligible_basis ?? []).length > 0`, hence **false for every
   row of every well-formed run**. Consistent with §5.8 `:414` (ineligible admissible companies not drawn are
   `DEVELOPMENT_SURPLUS` and never enter held-out). It cannot be true, not merely unlikely.
2. **Never read.** One tree-wide occurrence of `contamination_disclosed`: the write at `lib/analysis.mjs:159`.
   No count, no disposition, no assertion consumes it.
3. **The protocol's literal flag name does not exist in the instrument.** `CONTAMINATION-DISCLOSED` (§15.1
   `:836`) appears in none of the 594 files.

**Implication, stated carefully:** this is **not automatically a defect**, because §5.3's verb is unbound and
the protocol may well intend disclosure to be a published human act outside the tooling — on that reading the
instrument is silent exactly where the protocol is silent, and C is the correct conclusion rather than a
workaround. What the dead flag *does* establish is that **no option may claim the instrument "already
handles" late contamination**, and that the §15.1 flag is, as implemented, unreachable — which is part of what
the owner's semantics decision must settle. It also sharpens the choice between C and A: C accepts an
unfalsifiable duty and declares it; A is the only option that makes it falsifiable, at the price of a new
aggregate.

---

## 5. NINE-FIELD RETURN — §8 contamination carrier

**DECISION.** **C** for the carrier — an existing procedural declaration (a public record linked to the
registration on OSF Registries, with a registry-issued timestamp, pre-specified in the registration
narrative) lawfully carries the §5.3 disclosure. **D** for the semantics — the meaning of the disclosure,
the unreachable §15.1 flag, and the acceptance of an unfalsifiable duty require an owner/methodological
decision, recorded verbatim below. **A and B are rejected on cost and on fit.** The gap was **not** patched.

**RECOMMENDED RULE.**
1. A late-discovered contamination is recorded and published as a **public record linked to the registration
   on OSF Registries**, naming `company`, `basis`, `date`, `discoverer`, plus the `registration_id` and the
   `seal_hash` if the disclosure post-dates the seal, and carrying a registry-issued timestamp.
2. The channel is **pre-specified in the registration narrative** at registration, together with the §5.3
   consequences restated verbatim: the company is never excluded, removed or replaced; observations remain
   VALID; the §10.5 outcome never changes; any secondary analysis excluding flagged observations is
   pre-specified and non-decisive.
3. **No frozen input may be edited to record it** — not the frame (§5.5 step 3), not the scan or registry
   (§5.3 `:246`), not the screening log (write-once, and lacking `date`/`discoverer` columns, `:857`).
4. The two available-but-non-compliant channels are **prohibited by name**: `identity_inadmissible`
   (`lib/analysis.mjs:146` → `INVALID`) and `protocol_violations` (`:205`, `:211` → `INCONCLUSIVE`).
5. The residual is **published as a limitation**: the timing of a *made* disclosure is attestable only
   institutionally (OSF timestamp, per §20's declared institutional trust), and the *absence* of a disclosure
   is not attestable at all; the §15.1 `CONTAMINATION-DISCLOSED` flag is unreachable in the instrument as
   frozen, because the drawn held-out pool structurally excludes every company with a non-empty basis.
6. If the owner judges the unfalsifiable duty unacceptable, the **only** remedy is option A (a fifth
   declarations key carrying a mandatory negative attestation), and it must be decided **before**
   registration; afterwards it is unavailable.

**ALTERNATIVES CONSIDERED.** A — a fifth `contamination_disclosed` declarations key: rejected on cost
(moves `tooling_aggregate_sha256`, voids the 404-mutant certification of `638d68e6…`, and post-registration is
a non-authoritative re-registration, `lib/registration.mjs:136-141`) and on fit (tooling would enforce a
carrier the protocol does not name; and it still leaves post-`analyze` discoveries uncarried) — but it is the
only option that makes the duty falsifiable, and is recorded as the owner's upgrade path. B — amend §5.3 and
§13.2/§13.2A to name a `cpg-u1-contamination-disclosure/v1` artefact: rejected — a new protocol file (§6
`:446`) against a clause closed at registration (§19.1 `:936`), a new `protocol_sha256`, a new registration,
and it buys only a name. Routing through `identity_inadmissible` or `protocol_violations`: rejected as
protocol-prohibited. Declaring the silence harmless with no channel at all: rejected — §5.3 imposes a real
duty and a duty with no named channel and no pre-specification is indistinguishable from none.

**SCIENTIFIC / INTEGRITY EFFECT.** Net positive, with one honestly-bounded residual. C discharges a
`[NORMATIVE]` duty that today has no channel, gives a *made* disclosure a timestamp from the same registry
whose timestamps already gate the execution window, and — by pre-specifying the channel at registration —
removes the worst failure mode, an operator inventing a disclosure format after the fact. It preserves every
§5.3 prohibition: no exclusion, no outcome change, no VOID (correctly, since §5.10 `:420-441`, §18 `:910-917`
and §15.5 `:859-869` contain no contamination state, by closed enumeration). Residual, to be declared: the
duty remains unfalsifiable, and the §15.1 flag remains unreachable. A would close the first; nothing short of
an instrument change closes either.

**REGISTRATION EFFECT.** **None.** No `SAMPLING_FIELDS` member moves (`lib/registration.mjs:119`); the
registration *narrative* is not part of `samplingView` (`:120`), so the pre-specification cannot trigger the
`checkAuthority` divergence or duplicate-registration VOID paths (`:136-141`). C is the **only** option that
moves neither the aggregate nor the protocol SHA. (A moves `tooling_aggregate_sha256`; B moves
`protocol_sha256`, and in practice both.)

**MUTATION EFFECT.** **None.** No file under `C:/tmp/dt009-merge/tooling` changes, so the 404-mutant
population and the candidate aggregate are untouched and the suite now running remains a certification of the
artefact it is running against. Recorded for completeness: no existing mutant covers contamination disclosure,
and none could — there is nothing to mutate; the only contamination-adjacent code is the always-false, unread
write at `lib/analysis.mjs:159`. Under A, full re-certification is mandatory (`lib/aggregate.mjs:8-23` walks
every regular file; there is no test-only, aggregate-free option).

**PROTOCOL EFFECT.** **None. No protocol modification of any kind is proposed, and none was made.** C
operates inside §5.3 as frozen: the clause mandates recording and publication and names no artefact, and the
protocol's own precedents (`:147`, `:456`, `:498`, `:978`, `:1089`) supply the channel. The protocol file was
read with `sed`/`grep` only; its registered SHA `c50fc680…` is unchanged.

**OWNER APPROVAL REQUIRED?** **YES — and it cannot be inferred, delegated or read off the text.** Three
things need the owner: (1) adopting C as the carrier and the registration-narrative pre-specification;
(2) accepting, and publishing as a limitation, that the disclosure duty is unfalsifiable and the §15.1 flag
unreachable — or else electing A before registration; (3) the semantics question proper. No owner approval is
inferred anywhere in this document.

**EXACT WORDING TO RECORD.**

```
CONTAMINATION-DISCLOSURE SEMANTICS REQUIRE OWNER/METHODOLOGICAL DECISION

CARRIER (§8): C — an EXISTING procedural declaration lawfully carries the §5.3 disclosure. §5.3 (:248)
mandates that a late-discovered contamination be "recorded (company, basis, date, discoverer) and published"
and names no artefact, no schema and no command, and carries no [enforced] tag. The protocol uses the same
unbound "published" for other late-discovered findings (:147 false independence declaration; :498 detected
preview), and it already publishes records linked to the registration on OSF Registries outside the frozen
artefacts and relies on their registry-issued timestamps (:456 published seal record; :461 and :1089 the
execution window; :978 and :1059 registry trust is institutional). §13.2 (:811) and §13.2A (:815) are
mandatory-minimum lists: absence from them is non-mandate, not prohibition. A late contamination disclosure is
therefore published as a public record LINKED TO THE REGISTRATION on OSF, naming company, basis, date,
discoverer, registration_id and, if post-seal, seal_hash, with a registry-issued timestamp; and the channel is
PRE-SPECIFIED IN THE REGISTRATION NARRATIVE, which is not part of SAMPLING_FIELDS (lib/registration.mjs:119-120)
and therefore moves nothing.

PROHIBITED, BY NAME: recording the disclosure by editing the frame (§5.5 step 3 "NO LATER ADDITIONS"), the
scan or the registry (§5.3 :246; STAGE_VOID_BINDING_MISMATCH :433), or the screening log (write-once; no date
or discoverer column, :857). PROHIBITED, BY NAME: routing it through identity_inadmissible
(lib/analysis.mjs:146 -> INVALID, forbidden by §5.3 and §15.1 :836) or through protocol_violations
(lib/analysis.mjs:205, :211 -> INCONCLUSIVE, forbidden by §5.3's "never changes the §10.5 outcome"). Both are
available in the instrument today; neither is compliant.

DECLARED RESIDUAL: the timing of a MADE disclosure is attestable only institutionally (OSF timestamp); the
ABSENCE of a disclosure is not attestable at all; and the §15.1 flag CONTAMINATION-DISCLOSED is UNREACHABLE as
implemented — lib/select.mjs:93 removes every company with a non-empty basis from the held-out pool, so
lib/analysis.mjs:159's contamination_disclosed is structurally always false, it is never read (one tree-wide
occurrence, the write), and the literal string CONTAMINATION-DISCLOSED appears in none of the 594 files. The
only remedy that makes the duty falsifiable is a fifth declarations key carrying a mandatory negative
attestation (lib/analysis.mjs:59-60), which moves the tooling aggregate 638d68e6... and is therefore
PRE-REGISTRATION ONLY.

REGISTERED INSTRUMENT: unaffected by C. Aggregate 638d68e6... untouched; protocol SHA c50fc680... untouched;
no SAMPLING_FIELDS member moves. The gap was NOT patched; no code, schema or protocol text was changed.
```

---

## 6. Not executed (firewall)

Nothing was written, moved or executed under `C:/tmp/dt009-merge`. The protocol and the tooling were read with
`sed`/`grep` only. No selftest, no mutation suite, no CLI command, no aggregate recomputation. The running
404-mutant suite's output and partial verdicts were not inspected. The aggregate is reported as supplied, not
re-verified by this stream.
