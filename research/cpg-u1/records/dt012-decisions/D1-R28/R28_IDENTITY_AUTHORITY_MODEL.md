# R28 — Identity / accountability validation: authority model and false-positive matrix

DEEPTECH-PARALLEL-012, stream **D-1**. **Analysis and recommendation only. No code written, no patch, nothing applied.**

| | |
|---|---|
| Candidate | `C:/tmp/dt009-merge/tooling`, 594 files |
| Tooling aggregate | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| Frozen protocol | `CPG_U1_PROTOCOL_004.md`, SHA `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` (verified; unmodified) |
| Scratch copy used for runs | session scratchpad `…/scratchpad/d1scratch/tooling` — its `registration-fields` reproduces aggregate `638d68e6…` exactly, so the scratch copy is a faithful clone |
| Writes under `C:/tmp/dt009-merge` | **none** |
| Network, credentials, real personal identifiers | **none used.** Every string in this document is constructed and non-real (see §4.0) |

---

## 1. The defect, confirmed

`lib/registration.mjs:69-73` is the whole of identity validation:

```js
const assigned  = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;
const synthetic = (v) => typeof v === 'string' && v.toUpperCase().includes(SYNTHETIC_PREFIX);
const human = (v, name, label) => {
  if (!assigned(v)) blockers.push(`${label} is UNASSIGNED (${name})`);
  else if (synthetic(v) && !allowSynthetic) errors.push(`${name} is a SYNTHETIC test value — refused outside test mode`);
};
```

Two rejection classes only: the exact literal `UNASSIGNED`, and any string containing `SYNTHETIC`. `grep -rniE 'orcid|\bror\b|isni|doi\.org'` over the whole 594-file candidate returns **one** hit, a selftest fixture (`test/selftest.mjs:443`). There is no identifier-shape validation anywhere in the tooling.

### 1.1 Two further defects this stream found, not previously reported

`assigned()` trims **only** for the emptiness test; the sentinel comparison `v !== UNASSIGNED` is against the **raw, case-sensitive** string. Therefore the tooling's own sentinel is defeated by trivial mutilation:

* `"unassigned"` (lowercase) → **exit 0, "authoritative"** (row R4, run for real)
* `"UNASSIGNED "` (one trailing space) → **exit 0, "authoritative"** (row R5, run for real)

This is worse than the placeholder problem. `UNASSIGNED` is a token the tooling itself emits into the template; a copy-paste through any editor that lower-cases, or a whitespace artefact, converts the protocol's designed exit-4 refusal into a silent pass. §5.5.1 asserts "the tooling refuses to proceed while either is UNASSIGNED (exit 4)"; that assertion is **false as written** for any case or whitespace variant.

### 1.2 `as_of` is not vulnerable

`as_of` already carries a structural check (`ISO_UTC` regex + `Date.parse`). All twelve row values placed in `as_of` alone produce exit 1 or exit 4 — **never exit 0** (§4.3). `as_of` is therefore already at PLAUSIBLE and is *not* part of the remediation. **The vulnerable surface is four leaves, not five.** `as_of` is also the existence proof that the fix proposed here is the same move the tooling already makes elsewhere: a type constraining a value.

---

## 2. What the frozen protocol actually mandates for these fields

**On identifier shape, syntax, scheme, or issuing authority: nothing.** No national or institutional identity system is required, and none is proposed here. Verbatim, the only mandates:

§5.5.1, Identity row:

> An **accountable identity** bound to the OSF account, with a **persistent identifier** (type and value recorded). **Both are UNASSIGNED in this document and in the tooling template; the tooling refuses to proceed while either is UNASSIGNED (exit 4)**

§5.5.1, Evidence rule:

> Only a study registered under the accountable identity may be reported as CPG U1 evidence

§19.1: `Accountable identity; persistent identifier (type, value)` → `UNASSIGNED — required at registration`.
§19.3(1): `Accountable OSF identity + persistent identifier — before registration.`
§19.3(2): `Bitcoin wallet-key custodian (the study operator) — before funding.`

§21(1), the outsider procedure — this is where resolution is assigned:

> Resolve the registration's persistent identifier on OSF; confirm public, unembargoed, registry timestamp; list the accountable identity's registrations for `CPG-U1-2026-01` and export them as the identity-registration list.

§20(14): `**Registry trust is institutional**: immutability, timestamps, public listing and tombstones rest on OSF, not cryptography.`

**Reading.** The protocol requires that a type and a value be *recorded*, and that they not be `UNASSIGNED`. It does not say what a valid value is. It deliberately assigns *resolution* to an outsider with a live registry (§21 step 1) and concedes that registry trust is institutional (§20.14). So the protocol's own division of labour already implies that the local verifier cannot establish identity — which makes the verifier's unconditional `authoritative` claim a divergence from the protocol's intent even though it violates no explicit clause.

One binding constraint on any fix: `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:321`) requires the literal string `UNASSIGNED` to appear in the protocol text. **The sentinel token must be kept.** Clause C1 below normalises the *comparison*, not the token.

---

## 3. The four-level authority model

### 3.0 Definitions

| Level | Claim | Evidence that justifies it | Reachable by the frozen, offline verifier? |
|---|---|---|---|
| **NONEMPTY** | A string is present that is not the sentinel. | `typeof v === 'string'`, non-blank after trim, and not a case/whitespace variant of `UNASSIGNED`. | **Yes.** This is the current ceiling for all four identity leaves. |
| **PLAUSIBLE** | The value lies inside the issuable space of a **declared** identifier scheme. | A declared `type` naming a scheme with published syntax, plus the value satisfying that syntax **and its check character**. | **Yes**, for leaves that have a type. **Structurally impossible** for leaves with no scheme. |
| **VALIDATED** | The identifier resolves, in its issuing registry, to a record that exists. | A dated, archived resolution response from the scheme's authority (ORCID public record, ROR entry, the OSF record page). | **No.** Requires network and an archived response. The tooling has neither by construction. §20.17 already places this class of check on outsiders. |
| **AUTHORITATIVE** | The identifier belongs to the accountable party, that party **consents** to accountability for this study, and the registry has **published** the record under that account. | An external *act*: the OSF registration existing publicly under that account (§21 step 1), a signed human attestation of accountability (§19.3(1)), and for the custodian the §4A personnel-register declaration. | **No — and not by any verifier, local or networked.** Authority is *constituted*, not observed. |

### 3.1 Where machine checking stops

Two distinct boundaries, and conflating them is the root of the defect:

* **PLAUSIBLE → VALIDATED** is the limit of the *frozen offline* verifier. Crossing it needs a network lookup. This is a capability boundary; a different tool could cross it.
* **VALIDATED → AUTHORITATIVE** is the limit of *every* verifier. A resolvable ORCID proves a record exists in a registry; it cannot prove the record's subject is a real, living, consenting person who accepts accountability for CPG-U1-2026-01, nor that the operator is that person. Crossing it needs a human act by a third party. **Attestation begins exactly here.**

Consequence: **for no identity leaf can any verifier legitimately return AUTHORITATIVE.** The answer to the owner's framing — "can the registration verifier legitimately classify the field as authoritative rather than merely non-empty?" — is **no, and it never can.** The verifier's maximum honest claim is PLAUSIBLE, per leaf, plus a statement of what it did not check.

### 3.2 Minimum evidence per leaf per level

| Leaf | NONEMPTY | PLAUSIBLE | VALIDATED | AUTHORITATIVE |
|---|---|---|---|---|
| `persistent_identifier.type` | any non-sentinel string (**current**) | the string names a scheme in a pinned scheme table (ORCID / ROR / ISNI / DOI — operator-supplied, hash-pinned, no national ID system) | the named scheme's resolver is reachable and the scheme is current | n/a — a type is never authoritative alone; only the pair can be |
| `persistent_identifier.value` | any non-sentinel string (**current**) | satisfies the declared scheme's published syntax **and check character** (ORCID/ISNI: ISO 7064 MOD 11-2; ROR: base32 + checksum; DOI: `10.` prefix) | an archived, dated resolution from the scheme authority returns an existing record | that record is the accountable party **and** that party has attested accountability for this study — external, human |
| `accountable_identity.value` | any non-sentinel string (**current**) | **unreachable** — an OSF account handle has no published check-bearing shape, and the protocol names no scheme. Best available substitute: require it be expressed as `<scheme>:<value>` and inherit the `persistent_identifier` check when the scheme matches | the OSF account exists and is public | the OSF registration for `CPG-U1-2026-01` is **published** under that account (§21 step 1) **and** the holder has signed the §19.3(1) attestation |
| `bitcoin_key_custodian.value` | any non-sentinel string (**current**) | **unreachable** — a named natural person in the `STUDY_OPERATOR` role has no identifier scheme at all | n/a — nothing to resolve | the §4A personnel-register declaration names this person as study operator, organisationally confirmed (§20.23 already concedes this rests on declarations) |
| `as_of` | — | **already reached**: ISO-8601 UTC regex + `Date.parse` (§1.2) | equals the `asOf` actually used by the resolver run, cross-checked against the evidence bundle | was chosen *before* registration — an ordering fact only partly provable, cf. the §20.19 concession about off-chain timestamps |

Two of four identity leaves can never exceed NONEMPTY by machine. That is not a gap to be closed; it is a fact to be **recorded in the record and stated in the output**.

---

## 4. The false-positive matrix

### 4.0 Provenance of the test strings — read this first

Every value below is **constructed and non-real**. No credential, no secret, no real person's identifier appears. Specifically:

* `NONREAL-REG-ID-0001`, `q7f3`, `NONREAL-*` — invented for this run.
* `0000-0002-1825-0097` is the ORCID project's own **published documentation example**, assigned to a deliberately **fictitious** persona; it is not a real person's identifier. It is used because it is the one checksum-valid, shape-correct ORCID that can be quoted without naming anybody.
* Hashes are `'a'.repeat(64)` and similar. Outpoints and checkpoint are constructed. The registry file is a one-line text fixture labelled non-real.
* No network call, no Bitcoin, no registration, no real frame.

### 4.1 Method — the current column was run, not predicted

Against the scratch clone (aggregate verified `638d68e6…`), `node cpg_u1_data.mjs verify-registration` was invoked once per row with `--registration`, `--protocol` (the frozen protocol), `--registry` (the fixture), `--identity-registrations` (a one-element list containing the record itself). **`--allow-synthetic` was NOT passed. `network` was `bitcoin-mainnet`.** The row value was substituted simultaneously into all four identity leaves; `as_of` was held well-formed so each row isolates the identity leaves. Exit codes and `ERROR`/`BLOCKED` line counts below are **observed**.

Exit-code semantics (`cpg_u1_data.mjs:53` and `reportRegistrationCheck`): any `errors` → **1 (REFUSED)**; else any `blockers` → **4 (BLOCKED)**; else **0**.

### 4.2 The twelve rows

| # | Value | Current verifier (observed) | Proposed verifier | Should register? | Reason |
|---|---|---|---|---|---|
| R1 | `""` (blank) | **exit 4** · 0 errors · 4 blocked | exit 4 BLOCKED | **No** | UNASSIGNED class. Correct today. |
| R2 | `"   "` (whitespace) | **exit 4** · 0 errors · 4 blocked | exit 4 BLOCKED | **No** | UNASSIGNED class. Correct today — `trim()` catches it. |
| R3 | `"UNASSIGNED"` | **exit 4** · 0 errors · 4 blocked | exit 4 BLOCKED | **No** | UNASSIGNED class. Correct today. |
| R4 | `"unassigned"` | **exit 0** — *"complete, public, unembargoed, authoritative"* | exit 4 BLOCKED | **No** | **DEFECT (new).** Case-sensitive sentinel comparison. The tooling's own token, lower-cased, passes. |
| R5 | `"UNASSIGNED "` | **exit 0** — *"complete, public, unembargoed, authoritative"* | exit 4 BLOCKED | **No** | **DEFECT (new).** `trim()` is applied to the emptiness test but not to the sentinel comparison. |
| R6 | `"TBD"` | **exit 0** — *"…authoritative"* | exit 1 REFUSED (malformed for declared type) | **No** | **DEFECT.** SYNTHETIC/PLACEHOLDER class. No accountable party exists. |
| R7 | `"PLACEHOLDER"` | **exit 0** — *"…authoritative"* | exit 1 REFUSED | **No** | **DEFECT.** Same class. |
| R8 | `"0000-0000-0000-0000"` | **exit 0** — *"…authoritative"* | exit 1 REFUSED (fails ISO 7064 MOD 11-2) | **No** | **DEFECT.** All-zeros is *shaped like* an ORCID and fails its check character — the strongest case for a structural rule (§5.2). |
| R9 | `"SYNTHETIC-ACCOUNTABLE-IDENTITY"` | **exit 1** · 4 errors · 0 blocked | exit 1 REFUSED | **No** | SYNTHETIC class. Correct today — the one thing the current rule does well. |
| R10 | `"q7f3"` (plausible random) | **exit 0** — *"…authoritative"* | exit 1 REFUSED (syntax) | **No** | **DEFECT.** MALFORMED class. Defeats any denylist; refused on syntax by the structural rule. |
| R11 | `"0000-0002-1825-0097"` (checksum-valid, fictitious) | **exit 0** — *"…authoritative"* | **exit 0, but claiming only `PLAUSIBLE`, with `NOT VERIFIED` stated** | **Yes, with the level stated** | REAL-BUT-NOT-YET-VERIFIED class. The verifier must register it *and must not call it authoritative*. This row is the whole point: the fix is not "reject more", it is "claim less". |
| R12 | `"ORCID"` (a type name used as a value) | **exit 0** — *"…authoritative"* | exit 1 REFUSED (syntax) | **No** | **DEFECT.** A valid *current value* of `type` pasted into `value`. Refused because the type constrains the value. |

**Result: 9 of 12 rows exit 0 under the current verifier, 8 of them wrongly.** Only R11 should reach exit 0, and even R11 must not be described as authoritative.

### 4.3 `as_of` control (same twelve values placed in `as_of` alone)

R1–R3 → exit 4 (`as_of is UNASSIGNED`). R4–R12 → exit 1 (`as_of must be ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ`). **No row reaches exit 0.** This confirms §1.2 and demonstrates that a type-constrains-value rule already exists in this file and already produces exactly the behaviour wanted.

### 4.4 Check-character arithmetic, verified

Computed directly (ISO 7064 MOD 11-2), not asserted:

```
0000-0000-0000-0000 : base 000000000000000 expected check 1, actual 0  => INVALID
0000-0000-0000-0001 : base 000000000000000 expected check 1, actual 1  => VALID
0000-0002-1825-0097 : base 000000021825009 expected check 7, actual 7  => VALID
0000-0002-1825-0098 : base 000000021825009 expected check 7, actual 8  => INVALID
"TBD" "PLACEHOLDER" "N/A" "XXX" "q7f3" "foo" "." "ORCID" "unassigned" "UNASSIGNED "
  => all REFUSED on syntax (length) before the checksum is even reached
```

Two things follow. The all-zeros placeholder is caught **by arithmetic, not by being listed**. And every placeholder a denylist would have to enumerate is refused on *syntax alone*.

---

## 5. Denylist versus structural — decided

### 5.1 Why a denylist is rejected as the load-bearing mechanism

A denylist (`TBD`, `PLACEHOLDER`, `N/A`, `XXX`, `NONE`, `TODO`, all-zeros…) is:

1. **Unboundedly incomplete with no declared boundary.** R10 `q7f3` and `"."` pass. So would `foo`, `aaa`, `x`. There is no principled stopping point and no way to state what the rule does and does not cover.
2. **Actively harmful to honesty.** "We reject placeholders" reads to a downstream reader as "the values are real". It manufactures precisely the false authority R28 exists to eliminate. An incomplete check that *advertises* completeness is worse than no check.
3. **Adversarially useless and non-adversarially weak.** It catches only the specific words someone happened to think of.

### 5.2 Why a structural rule does better

The record already carries `persistent_identifier.type`. That field is the lever, and it is already there — no protocol change invents it. A typed identifier is self-describing: the type names a scheme, and the scheme's published syntax **and check character** constrain the value. This is categorically different from a denylist:

* It is **generative, not enumerative** — it defines the accepted set, so everything outside it is refused without having been listed. `foo`, `.`, `q7f3` and every unimagined placeholder fail on syntax (§4.4).
* Its **incompleteness is statable**: a check character admits roughly 1 in 11 (MOD 11-2) or 1 in 32 (ROR) of syntactically-correct strings. That is a number, publishable as a limitation.
* It catches the hardest row, R8, **arithmetically** — all-zeros is the placeholder most likely to be chosen precisely *because* it looks like a real ORCID, and the checksum rejects it without anyone having anticipated it.
* It is **already the pattern in this file** — `as_of`, `registration_timestamp`, the SHA-256 fields and the outpoints are all validated exactly this way (§4.3).

### 5.3 Where structure runs out, and what replaces it

Structure covers `persistent_identifier.{type,value}`. It **cannot** cover `accountable_identity.value` (an OSF account handle, no published check-bearing shape, no scheme named by the protocol) or `bitcoin_key_custodian.value` (a named natural person, no scheme at all). Inventing a shape for these would mean mandating an identity system the frozen protocol does not mandate — explicitly out of bounds.

For those two leaves the replacement is not a weaker check but an **explicit attestation marker**: the value must declare its own kind, so that "this leaf is not machine-checkable" becomes a recorded fact in the registration rather than an invisible property of a free string. This converts an undetectable lie into an **attributable claim** — which is the most a local verifier can achieve, and is consistent with §20.23 ("Personnel independence rests on declarations… The tooling checks the register's structure only").

---

## 6. The single recommended rule

> **A typed identity leaf must be machine-checkable against its declared type; an untypeable leaf must be explicitly attested rather than merely non-empty; and the verifier must claim only what it checked.**

One mechanism — *the value declares its kind and is held to it* — applied consistently, plus the output honesty that makes the incompleteness safe. Four clauses:

**C1 — Normalise the sentinel comparison.** Compare `v.trim().toUpperCase() !== 'UNASSIGNED'` instead of `v !== UNASSIGNED`. The token `UNASSIGNED` is kept (required by `PROTOCOL_MARKERS`). Closes R4, R5. This is a *sentinel normalisation*, not a denylist: `UNASSIGNED` is the tooling's own emitted token, so refusing its case and whitespace variants closes a hole in an existing rule rather than guessing at human placeholder vocabulary.

**C2 — Type constrains value, for the persistent identifier.** `persistent_identifier.type` must name a scheme in a new operator-supplied, **hash-pinned** `rules/identifier_schemes.json` (proposed default set: ORCID, ROR, ISNI, DOI — **no national or institutional identity system**). `persistent_identifier.value` must satisfy that scheme's published syntax **and** check character. Closes R6, R7, R8, R10, R12 structurally. Admits R11.

**C3 — Untypeable leaves must declare themselves.** `accountable_identity.value` and `bitcoin_key_custodian.value` must take the form `<scheme>:<value>`, where either the scheme is in the pinned table (then checked as in C2), or the scheme is the literal `attested`, in which case the value must be a reference that resolves into the §4A personnel register / an attestation file supplied to the verifier — and the verifier then emits `IDENTITY_ATTESTED_NOT_VERIFIED` for that leaf. These two leaves can never report better than ATTESTED, and the record says so on its face.

**C4 — The verifier claims only what it checked.** Replace the exit-0 message (§7).

`as_of` is untouched — already compliant (§1.2).

### 6.1 Admitted limits — stated, not buried

* **This rule is inherently incomplete, and I am recommending it anyway.** A checksum-valid ORCID belonging to nobody, or to a real but non-consenting person, passes C2. `attested:somebody` passes C3. No local rule can do better; §3.1 explains why this is a boundary, not an oversight.
* **Incompleteness is acceptable here only because C4 makes it declared.** The rule's value is not that it catches more strings; it is that the verifier's output no longer overstates what catching them means. An incomplete check plus an unconditional `authoritative` is indefensible. An incomplete check plus a per-leaf statement of the level reached is honest. **C4 is not optional garnish — it is the clause that makes C1–C3 defensible.**
* **C2 introduces a false-negative risk.** The scheme table is an allowlist: a legitimate identifier in an unlisted scheme is refused. Mitigated by making the table an operator-supplied, hash-pinned input rather than hardcoded — but it remains a real cost, and the default set must be approved by the owner, not chosen by the tooling.
* **C3 is a recording mechanism, not a verification mechanism.** It does not make these leaves trustworthy. It makes their untrustworthiness visible and attributable.
* **C2's strength is quantifiable and modest**: a MOD 11-2 check character admits ~1/11 of syntactically well-formed candidates. It is a placeholder filter and a typo filter, not an authenticity proof.

---

## 7. The exit-0 wording — it must change, and wording alone is not enough

Current (`cpg_u1_data.mjs:342`):

```
registration ${reg.registration_id} complete, public, unembargoed, authoritative; protocol, tooling and registry hashes match
```

**Three of those four words are not established by the verifier at all**, independently of the identity defect:

* **"public" / "unembargoed"** — read off `registry.public === true` and `registry.embargo === false`, which are **fields inside the record being checked**. They are the operator's own self-assertion. §21 step 1 assigns the actual confirmation to an outsider on OSF.
* **"authoritative"** — means only "earliest in the `--identity-registrations` file supplied on the command line". That file is an operator/verifier input. `checkAuthority` cannot enumerate the registry.
* **"complete"** — means "no required field is blank and the shaped ones parse". Under the current code it is satisfied by `TBD` (rows R6–R8, observed).

Only the three hash matches are unconditionally machine-established.

### 7.1 Proposed message

```
registration ${id}: protocol, tooling and registry hashes match; all required fields present and well-formed.
  registry settings: public=true, embargo=false — AS RECORDED IN THIS RECORD, self-asserted, not verified here.
  authority: earliest of ${n} registration(s) in the SUPPLIED identity list — the registry was not enumerated.
  identity: persistent_identifier (${type}) PLAUSIBLE — syntax and check character only;
            accountable_identity ATTESTED, NOT VERIFIED; bitcoin_key_custodian ATTESTED, NOT VERIFIED.
  This tool cannot establish that any identifier resolves to a consenting accountable person, nor that this
  record is public and unembargoed on OSF. Confirm both per CPG_U1_PROTOCOL_004 §21 step 1.
```

### 7.2 Would a wording change alone be sufficient?

**No — insufficient, and on its own misleading in a new way.**

*Insufficient*: §5.5.1 exists to guarantee that a published CPG U1 registration carries a real accountable party, because §5.5.1's evidence rule makes the entire study's admissibility depend on it. A registration published with `accountable_identity.value: "TBD"` has a permanently broken accountability chain. Honest narration of that outcome does not repair it.

*Misleading in a new way*: with C4 alone, the tool would truthfully and carefully describe a state that §5.5.1's exit-4 exists to prevent. A reader would see a well-hedged, professional-looking report and reasonably infer the tool had been designed to permit this — that `TBD` in an accountability field is an accepted, considered configuration. It is not; it is an unnoticed hole. Careful language around a defect can legitimise the defect.

Equally, **C1–C3 without C4 are also insufficient**: a checksum-valid identifier is still not authoritative, so the message would still lie, just about a narrower set of inputs.

**Both are required. Neither substitutes for the other.**

---

## 8. The nine-field D-1 return

### DECISION
**R28 RESOLVED — remediation required before registration, and it is a two-part fix: validation *and* wording.** The verifier currently reaches exit 0 and prints `complete, public, unembargoed, authoritative` on **9 of 12** false-positive rows (**8 wrongly**), including two newly-found rows (R4, R5) in which the tooling's own `UNASSIGNED` sentinel is defeated by case or trailing whitespace. Separately and independently of identity, three of the four adjectives in the exit-0 message are not established by the verifier. **The answer to the owner's framing is that the verifier can never legitimately classify any identity leaf as authoritative; its maximum honest claim is PLAUSIBLE for the typed identifier and ATTESTED-NOT-VERIFIED for the other two.** *This is a recommendation. It is not approved and must not be applied on the strength of this document.*

### RECOMMENDED RULE
> A typed identity leaf must be machine-checkable against its declared type; an untypeable leaf must be explicitly attested rather than merely non-empty; and the verifier must claim only what it checked.

Clauses C1 (case/whitespace-normalised sentinel), C2 (pinned scheme table; type constrains value including check character), C3 (`<scheme>:<value>` with an `attested:` form for the two untypeable leaves), C4 (honest exit-0 message). `as_of` untouched. Limits at §6.1: the rule is inherently incomplete; it is acceptable **only** because C4 declares the incompleteness.

### ALTERNATIVES CONSIDERED
1. **Placeholder denylist** — rejected as load-bearing. Unboundedly incomplete (`q7f3`, `.`, `foo` pass; observed at R10), and it advertises a completeness it does not have, manufacturing the exact false authority R28 targets (§5.1).
2. **Wording change alone** — rejected as sufficient. Insufficient *and* newly misleading: it would carefully legitimise a state §5.5.1's exit-4 exists to prevent (§7.2).
3. **Validation alone, message unchanged** — rejected. A checksum-valid identifier is still not authoritative; the message would still overclaim.
4. **Require a specific national or institutional identity system** — **rejected and out of bounds.** The frozen protocol mandates no identity system (§2), and D-1 was instructed not to introduce one.
5. **Network resolution inside the verifier (reach VALIDATED locally)** — rejected. Contradicts the tooling's offline-by-construction design, breaks byte-replicability, and duplicates work the protocol already assigns to outsiders (§21 step 1, §20.17).
6. **Do nothing; rely on the §21 outsider** — rejected. The outsider check happens *after* publication. By then a registration naming `TBD` as the accountable party is immutable on OSF and, per §5.5.1's evidence rule, the study is unreportable.

### SCIENTIFIC / INTEGRITY EFFECT
**No effect on any measured quantity** — not on sampling, ranking, seeds, frame, quotas, agreement, or any outcome. Every affected field is metadata. The effect is entirely on **accountability**: §5.5.1's evidence rule makes the study reportable *only* under the accountable identity, so a registration whose accountable identity is `TBD` yields a study that passes every tooling gate and is substantively unreportable. The current verifier would have certified its own irrelevance. Ceilings (Rung ≤ 2, α) are unaffected. The fix also makes §5.5.1's own claim ("the tooling refuses to proceed while either is UNASSIGNED") true, which it currently is not.

### REGISTRATION EFFECT
**Gating, and pre-registration-only.** Any clause touches `lib/registration.mjs` and/or `cpg_u1_data.mjs`, so it changes `tooling_aggregate_sha256` away from `638d68e6…`. The aggregate is a registered sampling field; after registration, changing it makes the tooling "not the registered tooling" (`VERIFY_ABORT_HASH_MISMATCH`). **Therefore: apply before registration, or never.** R28 must close before registration is filed. C2/C3 also add a new named prerequisite — the scheme table and the attestation reference must exist before registration, alongside §19.3(1).

### MUTATION EFFECT
**A concrete, verified blocker that must be handled with C1, and it is not obvious.** `test/mutate.mjs:120` defines the only mutant on the affected line:

```
['M77 UNASSIGNED treated as assigned', REG,
  "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;",
  "const assigned = (v) => typeof v === 'string' && v.trim() !== '';"]
```

Mutants are applied by `writeFileSync(target, readFileSync(target,'utf8').replace(from, to))` (`test/mutate.mjs:510`). With a **string** `from`, a non-match is a **silent no-op** — not an error. So if C1 edits line 69, M77's anchor stops matching, the mutant becomes an unmodified clone, the selftest passes, and `classify` returns `SURVIVED` (`!err` ⇒ `SURVIVED`). **Result: 389/389 silently becomes 388/389 with M77 as a phantom survivor** — a finding that looks like a genuine coverage regression while pointing at the wrong thing. Consequences:

* C1 **must** be applied together with an updated `from` string for M77 in `test/mutate.mjs`.
* C2, C3, C4 add logic in `human()` / `checkRegistration` / `cmdVerifyRegistration`, none of which carry mutant anchors, so they are anchor-safe — **but** they would be **unmutated**, so the suite's 100% figure would cover strictly less than it appears to. New mutants are needed per clause (minimum: check character bypassed; scheme table bypassed; `attested:` accepted without a reference; honest message replaced by the old one).
* New selftest assertions are required. `test/selftest.mjs:443` (`SYNTHETIC-ORCID` / `SYNTHETIC-0000-0000-0000-0000`) and `filledRegistration` would fail C2/C3 as written and must be updated; the fixture's identity values are also asserted at `selftest.mjs:449-452`.
* **No mutation suite was run by this stream.** A 404-mutant run is live against the candidate and was not touched, inspected, or started.

### PROTOCOL EFFECT
**No §5.5.1 amendment is strictly required; consequential wording is advisable, and all of it is owner territory.** §5.5.1 requires a type and value to be *recorded* and not `UNASSIGNED`; it never states what the tooling must *accept*. C1–C3 tighten the tooling within that silence and do not contradict any clause. Constraint: `PROTOCOL_MARKERS` requires the literal `UNASSIGNED` in the protocol text — C1 keeps the token and changes only the comparison. Advisable additions, all requiring approval: **§19.3** to name the scheme table and the identity-attestation artefact as prerequisites; **§20** to add a limitation stating that identifier validation is syntactic and a check character admits ~1/11 of well-formed strings, so identity rests on attestation plus the §21 outsider; and, if the owner prefers the protocol to describe the verifier's claim, **§21** to reflect the C4 message. C4 does not weaken §21 — it aligns the tooling with the division of labour §21 already sets out. **The protocol file was not modified and must not be.**

### OWNER APPROVAL REQUIRED?
**Yes — four separable approvals. None is implied by this document's existence.** See §9 for exact wording.

### EXACT WORDING TO RECORD
> **R28 — identity / accountability validation.** The registration verifier performs no identifier-shape validation. Verified by direct execution against a faithful scratch clone of candidate aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (no `--allow-synthetic`, `network: bitcoin-mainnet`): of twelve constructed non-real placeholder values substituted into the four identity leaves, **nine produce exit 0 and the message "complete, public, unembargoed, authoritative"**, including `TBD`, `PLACEHOLDER`, `0000-0000-0000-0000`, a plausible random string, and — newly found by this stream — `unassigned` and `UNASSIGNED` with a trailing space, which defeat the tooling's own sentinel because `lib/registration.mjs:69` compares the raw, case-sensitive string. Eight of the nine are wrong. `as_of` is not affected; it already carries a structural check. It is further recorded that **three of the four adjectives in the exit-0 message are not established by the verifier at all**, independently of identity: "public" and "unembargoed" are read from the record's own self-asserted `registry` booleans, and "authoritative" means only "earliest in the identity list supplied on the command line". **No verifier, local or networked, can establish that an identifier belongs to a consenting accountable person; authority is constituted by an external act (`CPG_U1_PROTOCOL_004` §21 step 1, §19.3(1)), not observed.** The recommended remediation is a single rule — *a typed identity leaf must be machine-checkable against its declared type; an untypeable leaf must be explicitly attested rather than merely non-empty; and the verifier must claim only what it checked* — structural rather than denylist-based, and inherently incomplete, which is acceptable **only** because the verifier's output states the level reached per leaf. It touches the frozen tooling and so must be applied **before registration or not at all**, and clause C1 cannot be applied without simultaneously updating mutant M77's anchor text in `test/mutate.mjs:120`, which would otherwise be silently classified SURVIVED. **R28 is RESOLVED as an analysis and remains UNAPPROVED and UNAPPLIED. No code, protocol, or registration artefact was changed.**

---

## 9. Owner approval required — exact wording

Four decisions. Each needs the owner's explicit yes; **a recommendation is not an approval, and nothing in this document authorises application.**

**A-1 — Authorise remediation of R28 at all, before registration.**
> "I authorise a pre-registration change to `lib/registration.mjs` and `cpg_u1_data.mjs` to remediate R28, accepting that `tooling_aggregate_sha256` changes from `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` to a new value that must be re-verified and re-frozen before registration is filed."

**A-2 — Approve the rule, including its admitted incompleteness.**
> "I approve the rule: a typed identity leaf must be machine-checkable against its declared type; an untypeable leaf must be explicitly attested rather than merely non-empty; and the verifier must claim only what it checked. I accept that it is inherently incomplete — a checksum-valid identifier belonging to nobody, and an `attested:` reference naming anybody, both still pass — and that this is acceptable only because the verifier's output states the authority level reached for each leaf."

**A-3 — Approve the identifier scheme table and its default contents.**
> "I approve a hash-pinned, operator-supplied `rules/identifier_schemes.json` as the sole source of accepted persistent-identifier schemes, with default contents [ORCID, ROR, ISNI, DOI] and **no national or institutional identity system**. I accept the false-negative cost: a legitimate identifier in an unlisted scheme is refused."

**A-4 — Approve the exit-0 wording change and any consequential protocol wording.**
> "I approve replacing the `verify-registration` exit-0 message so that it no longer asserts 'complete, public, unembargoed, authoritative', and instead states per axis what was and was not established — including that `registry.public` and `registry.embargo` are self-asserted and that authority is relative to the supplied identity list. I separately decide whether `CPG_U1_PROTOCOL_004` §19.3, §20 and §21 are amended to match, noting that the protocol file is frozen and that any amendment re-hashes `protocol_sha256`."

---

## 10. Risks

1. **The mutation-anchor trap (highest).** Editing line 69 without updating M77 silently yields a phantom SURVIVED and a 388/389 result. Verified from source, not assumed. Any implementer who does not read this will hit it.
2. **Aggregate churn.** Any clause re-hashes the tooling. If registration is filed first, R28 becomes permanently unfixable for this study. **R28 gates registration.**
3. **Scope creep into an identity mandate.** C2/C3 sit one step away from requiring a national or institutional identity system, which the protocol does not mandate and D-1 was told not to introduce. A-3's "no national ID system" clause must be preserved verbatim through implementation.
4. **C4 without C1–C3** would produce a carefully-worded tool that legitimises the defect (§7.2).
5. **C1–C3 without C4** would produce a narrower but still false `authoritative` claim.
6. **Selftest fixture breakage.** `selftest.mjs:443` and `:449-452` assert the current SYNTHETIC identity fixtures and would fail C2/C3. Expect a fixture update in the same change, which is itself a tooling change and therefore inside A-1.
7. **False negatives at registration time.** If the operator's real persistent identifier is in an unlisted scheme, C2 blocks a legitimate registration. Time-critical if discovered late; the scheme table should be settled alongside §19.3(1).
8. **New checks arriving unmutated.** Without new mutants per clause, the suite's 100% headline would overstate coverage — the same species of overclaim R28 is about.
9. **Residual, unfixable.** Even fully applied, the rule cannot detect a determined operator supplying a checksum-valid identifier they do not own. §20.13 already concedes the analogous limit for parallel identities. This must be stated as a limitation, not presented as closed.

---

## 11. Provenance of this analysis

* Frozen protocol re-hashed and confirmed `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`; **not modified**.
* Scratch clone's `registration-fields` reproduced aggregate `638d68e6…`, establishing fidelity before any conclusion was drawn from it.
* All twelve rows run end-to-end through the real `verify-registration` CLI; exit codes and `ERROR`/`BLOCKED` counts observed, never predicted. A second direct-library harness cross-checked every row and produced identical exit mappings.
* Check-character arithmetic computed, not asserted (§4.4).
* Mutation-suite behaviour established by **reading** `test/mutate.mjs`. **No mutation suite, selftest, or CPU-heavy job was started.** The live 404-mutant run against the candidate was not touched and its output was not inspected.
* **Nothing was written under `C:/tmp/dt009-merge`.** No code, patch, protocol, commit, push, PR, or merge. No registration, Bitcoin, network, credential, real frame, or U1 execution.
