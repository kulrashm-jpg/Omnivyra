# CPG-U1 — OWNER INPUT SHEET (final, DEEPTECH-PARALLEL-010 stream B)

**CLASSIFICATION: PREPARATION.** Nothing here is registered, submitted, published, broadcast, funded,
committed or pushed. **No external value is invented in this document.** Every value an outside party must
supply appears only as an unmistakable unfilled marker. No network call, no credential, no OSF interaction,
no Bitcoin activity, no real frame, no U1 execution.

**What this sheet is.** The single sheet a person works down. It is not a re-derivation of
`C:/tmp/dt009-closure/G-registration/REGISTRATION_FIELD_STATUS.md` — that document remains the authority for
*why* each field sits where it sits, and `C:/tmp/dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md`
remains the full per-field instruction. This sheet adds what neither has: a four-group owner-facing view
(**A owner-supplied · B OSF-generated · C Bitcoin-generated · D automatically derived**), exactly one status
token per field, and — for every owner-supplied field — **the concrete act a person performs** beside **the
format the code actually enforces**, read out of the validators rather than out of prose.

---

## 0. Where the field list came from

Derived mechanically by importing `registrationTemplate()` from the **candidate instrument**
`C:/tmp/dt009-merge/tooling/lib/registration.mjs` (read-only; nothing in that tree was written) and walking the
returned object to its leaves. Not from the draft JSON and not from prose.

`C:/tmp/dt009-merge/tooling/lib/registration.mjs` is **byte-identical** to the frozen
`C:/tmp/dt002/research/cpg-u1/tooling/lib/registration.mjs` (`diff` clean), so the field list is unchanged by
the DR-1 / DR-10 wave — as expected: those decisions touch `lib/evidenceBundle.mjs`, `lib/sampling.mjs`,
`cpg_u1_data.mjs`, `test/*` and `README.md`, not the record schema.

### Counts found (this session, mechanically)

| Count | Meaning |
|---|---|
| **20** | top-level keys of a `cpg-u1-registration/v1` record |
| **39** | leaf paths in total |
| **12** | of those leaves are `parameters.*` |
| **27** | leaf paths excluding `parameters.*` |
| **12** | leaves a **fresh** template emits as the literal `UNASSIGNED` |
| **11** | still unresolved in `registration_record.DRAFT.json` (the twelfth, `provider_configuration_sha256`, is filled) |
| **9** | `BLOCKED` lines `verify-registration` prints on the draft (`outpoints` and `checkpoint` are one blocker each, covering two leaves each) |

These reproduce the counts recorded in `REGISTRATION_FIELD_STATUS.md` section 1 exactly, now confirmed against
the candidate instrument rather than the pre-wave one.

The 20 top-level keys, in template order:

```
schema · study_id · protocol_version · protocol_sha256 · tooling_aggregate_sha256 · registry_sha256 ·
registry · registration_id · registration_timestamp · accountable_identity · persistent_identifier ·
bitcoin_key_custodian · network · outpoints · checkpoint · parameters · as_of ·
provider_configuration_sha256 · authority_rule · verification_procedure
```

The 12 `UNASSIGNED` leaves of a fresh template:

```
registration_id · registration_timestamp · accountable_identity.value · persistent_identifier.type ·
persistent_identifier.value · bitcoin_key_custodian.value · outpoints.development · outpoints.held-out ·
checkpoint.height · checkpoint.hash · as_of · provider_configuration_sha256
```

### Baseline confirmed in this session

Recomputed read-only from the candidate tree, all matching the values this stream was given:

```
candidate instrument   594 files, aggregate 638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2
protocol   C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md          c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
registry   tooling/rules/development_only_registry.json       a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814
provider configuration (carried, not recomputed here)         c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561
treatment f01a7eb4199be4e04d4fee7fc0116303949dc553 / tree 3b4811fc88e9fbb64ee42c37c4aacca2e76c67af / content ffe4f603...c601d1c5 (carried)
```

The aggregate was recomputed **before and after** every command of this rehearsal and was identical both
times, so nothing in it touched the instrument.

**The stale trap, restated:** this worktree carries its own `research/cpg-u1/tooling` (587 files,
`640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`). It was **not** read. It runs cleanly and
produces a self-consistent wrong aggregate.

---

## 1. Status tokens

Exactly one token per field. The tokens mean:

| Token | Meaning |
|---|---|
| **READY** | The value is already present and valid — a template constant, or filled and passing in `registration_record.DRAFT.json`. No owner act. |
| **DERIVABLE** | A machine computes it from files on disk with a named command. No human types a value. |
| **OWNER INPUT** | A person must decide or supply it. **No agent may.** |
| **OSF GENERATED** | Only OSF Registries can issue it, and only at submission. Unobtainable in advance by anyone. |
| **BITCOIN GENERATED** | Only an on-chain act produces it. |
| **BLOCKED** | A precondition outside this field is unmet, so the field must **not** be filled yet even though it is computable. |

---

## 2. GROUP A — OWNER-SUPPLIED (7 registration leaves)

Every row is a value **no agent may supply**, and none is supplied anywhere in this package.
"Enforced format" is read from `checkRegistration()` in `lib/registration.mjs`, not from documentation.

The shared validator for the four identity-shaped fields is `human(v, name, label)`, which calls

```js
const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;
```

and then refuses any value whose upper-cased form **contains** the substring `SYNTHETIC`. That is the whole
check. **There is no ORCID, ROR, DOI, ISNI or any other identifier-shape validation anywhere in the
instrument** — confirmed by grepping the entire candidate `lib/` and `cpg_u1_data.mjs` for those schemes: zero
occurrences. Read `VERIFIER_MESSAGING_NOTES.md` in this directory before typing any of these; two of the traps
recorded there (the whitespace-padded marker, and the `SYNTHETIC` substring) bite exactly these fields.

| # | FIELD | TOKEN | THE ACT A PERSON PERFORMS | ENFORCED FORMAT (code, not prose) |
|---|---|---|---|---|
| A1 | `accountable_identity.value` | **OWNER INPUT** | Decide who is accountable. Create or sign in to **that identity's own** OSF account, under that identity's own email address — not the developing organisation's. Put the legal or published name in the OSF profile. Type that exact name string into the record. It must be the identity that actually files the registration. | `human()` only: non-blank string, not the literal `UNASSIGNED`, must not contain `SYNTHETIC`. **No length, charset, name-shape or uniqueness check; never compared to OSF.** Later, `checkAuthority()` compares this string for **exact equality** across the identity's registration list, so the spelling you type is the spelling you are bound to. |
| A2 | `persistent_identifier.type` | **OWNER INPUT** | Choose one identifier scheme and type its name. | `human()` only. **Any** non-blank string is accepted; there is no enum and no scheme list. The choice therefore carries **no machine-checkable meaning** — state the scheme in the OSF narrative too, so a reader can resolve the identifier. |
| A3 | `persistent_identifier.value` | **OWNER INPUT** | Register with that scheme's issuing authority and paste back, verbatim and unreformatted, the identifier the issuer returns. External lead time for a newly requested identifier is **days**, not minutes. | `human()` only. No checksum, no prefix check, no resolvability check. The instrument has no network and cannot tell a real identifier from a well-typed one. |
| A4 | `bitcoin_key_custodian.value` | **OWNER INPUT** | Name **one** person as study operator. Do this **before** recruiting the independent people: the operator may hold no independent role, so naming the custodian late can force re-recruitment. | `human()` only. Sibling `bitcoin_key_custodian.role` is pinned: any value other than `STUDY_OPERATOR` is an **ERROR** (exit 1), not a blocker. This field is checked in `phase: 'funding'` as well, so it blocks funding *and* registration. |
| A5 | `as_of` | **OWNER INPUT** | Pick **one** instant that the whole held-out run observes, and write down the reason. This is a **methodological choice, not a clock reading**; it is frozen for the study and cannot be changed afterwards. | `assigned()`, then `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` **and** `Date.parse` must not be `NaN`. So: uppercase `T` and `Z`, **no milliseconds, no `+00:00` offset, no space separator**, and a calendar-valid date. Anything else is an **ERROR**, not a blocker. |
| A6 | `checkpoint.height` | **OWNER INPUT** | Choose **one** block at or after **both** funding confirmations — the choice is the owner's, the number is read off the chain — and type its height. | `Number.isSafeInteger(height) && height >= 0`. It must be a **bare JSON number**; the same digits in quotes are an ERROR. The blocker test is `cp.height === 'UNASSIGNED'`, a strict string comparison, which is exactly what makes the untouched template a blocker. |
| A7 | `checkpoint.hash` | **OWNER INPUT** | Read that same block's hash and **cross-check it against both named header sources before typing it**. | `/^[0-9a-f]{64}$/` — exactly 64 hex, **lowercase only**. The verifier checks the shape and nothing else: it has no network and **cannot tell a real block hash from a plausible one**. The cross-check is the only protection and it is entirely procedural. |

### Group A, continued — owner inputs that are **not** registration leaves

These do not appear among the 39, and `verify-registration` would exit 0 without any of them. They are named
§19.3 prerequisites and they are on the critical path.

| # | ITEM | TOKEN | THE ACT A PERSON PERFORMS | WHAT THE CODE ENFORCES |
|---|---|---|---|---|
| A8 | **Bitcoin header source #1** — `UNASSIGNED — the operator names it` | **OWNER INPUT** | Name the source in writing, so an outsider can tell **who** supplied the headers. Preferred shape: one own full node plus one external source. An own node's initial block download takes **days** — start it now if you want it. | `evidenceBundle.archive()` requires a non-empty `source` string. |
| A9 | **Bitcoin header source #2** — `UNASSIGNED — the operator names it` | **OWNER INPUT** | Name a **second** source that shares no operator, hosting provider or upstream feed with #1, and record the written basis for believing they are independent. | The two `source` strings must **differ** — checked in `buildEvidenceBundle` and again in `loadChains`. **That is all the code can check.** Two differing labels are not independence; the judgement is the owner's and is not machine-checkable. |
| A10 | **drand relay #1** — `UNASSIGNED — the operator names it` | **OWNER INPUT** | Name a relay of the pinned quicknet chain. | `checkChainInfo` compares **every** pinned field (`hash`, `public_key`, `period`, `genesis_time`, `schemeID`, `groupHash`, `beaconID`) and throws on the first mismatch. A relay on another chain is a refusal, not a second opinion. |
| A11 | **drand relay #2** — `UNASSIGNED — the operator names it` | **OWNER INPUT** | Name a **second, distinct** relay. Since **DR-1 = option (B)** this is no longer merely procedural: the instrument enforces a >= 2 independent-relay floor with per-relay attribution. | A bundle attributed to one relay, with duplicate relay identity, or with missing/malformed identity is **refused**. Naming the same relay twice will not satisfy it. |
| A12 | **Authorisation of the tooling aggregate value** | **OWNER INPUT** | After two independent clean rebuilds agree, authorise **that specific digest**. No agent may promote a provisional value, and no document may be treated as the source of it. | Nothing — the code cannot check this at all. See D5 and `PROVISIONAL_AGGREGATE_HANDLING.md`. |
| A13 | **Seven mutually exclusive independent persons** (§4A), plus the authorised **eighth** (enumerator B) | **OWNER INPUT** | Recruit enumerator(s), reference Author, Confirmer, reference adjudicator, >= 2 raters, rating adjudicator — recruiting B **into the original roster**, not as a later addition. Per person: signed declaration with every item answered "no" ("unknown" is not "no"), fee-agreement SHA-256 agreed in writing before any role material is released (or `null`), and the developing organisation's written no-relationship confirmation with its SHA-256. Then run `check-personnel`. | **Nothing in the registration record.** Confirmed again this session by reading `lib/registration.mjs` end to end: `registrationTemplate()` emits no personnel key, `checkRegistration()` never mentions personnel, and `SAMPLING_FIELDS` contains none. **Therefore no roster change can void a registration** — recruitment is the longest lead time but it blocks no registration field. |
| A14 | **Funding satoshis** for `O_dev`, `O_ho` and both commitment fees | **OWNER INPUT** | Acquire and transfer the coin in one round, **after** the aggregate is final and before the outpoint step. | Nothing pre-registration. Coin spent against a superseded aggregate is wasted. |

---

## 3. GROUP B — OSF GENERATED (2 registration leaves)

Neither can be filled in advance by anyone, which is why the record is completed in two passes: everything
else first, submit, then paste these two in.

| # | FIELD | TOKEN | THE ACT | ENFORCED FORMAT |
|---|---|---|---|---|
| B1 | `registration_id` | **OSF GENERATED** | Once the registration is live, copy its identifier from OSF and paste it in. | `assigned()`, then it **must not contain the `|` character** — that is the field separator inside the commitment payload, so a pipe in the id is an **ERROR**. |
| B2 | `registration_timestamp` | **OSF GENERATED** | Copy the date-time OSF records and convert it to UTC. **Do not substitute your own clock:** `registrationEpoch()` turns this into the study epoch and `checkAuthority()` uses it as the authority tie-breaker. | Same as `as_of`: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` **and** parseable. |

Two OSF **form** acts belong here although their record values are constants (group D): choose **public**
registration, and leave the **embargo date empty**. `registry.public !== true` and `registry.embargo !== false`
are ERRORs, so a private or embargoed registration cannot be repaired into a valid record.

---

## 4. GROUP C — BITCOIN GENERATED (2 registration leaves)

**No agent may perform any of this, and none was performed.** `outpoints` is **one** blocker line covering
both leaves.

| # | FIELD | TOKEN | THE ACT | ENFORCED FORMAT |
|---|---|---|---|---|
| C1 | `outpoints.development` (`O_dev`) | **BITCOIN GENERATED** | Generate a fresh single-use P2WPKH address, fund it in one transaction, wait for **>= 6 confirmations** (D = 6), then type the outpoint. **Only after `tooling_aggregate_sha256` is final** — the aggregate sits inside the on-chain commitment digest. | `parseOutpoint`: 64 **lowercase** hex txid, a colon, then an unpadded decimal vout (`0`, or no leading zero) with `vout <= 0xffffffff`. A malformed outpoint is an **ERROR**, not a blocker. |
| C2 | `outpoints['held-out']` (`O_ho`) | **BITCOIN GENERATED** | The same act, a **different** output. It may be a second output of the same funding transaction, which halves the waiting. | Same parse. `o.development === o['held-out']` is an **ERROR**: `development and held-out outpoints must be distinct`. |

`checkpoint.height` / `checkpoint.hash` are chain-*read* but appear once only, in **group A** (A6, A7),
because what the sheet needs a person to do there is **choose the block** and cross-check it — not perform an
on-chain act. No leaf appears in two groups.

---

## 5. GROUP D — AUTOMATICALLY DERIVED (28 registration leaves: 16 named + the 12 pinned `parameters`)

| # | FIELD | TOKEN | SOURCE / ACT |
|---|---|---|---|
| D1 | `schema` = `cpg-u1-registration/v1` | READY | `REGISTRATION_SCHEMA`. Any other value is an ERROR. Do not edit. |
| D2 | `study_id` = `CPG-U1-2026-01` | READY | `STUDY_ID` (`lib/commitment.mjs`). |
| D3 | `protocol_version` = `CPG_U1_PROTOCOL_004` | READY | `PROTOCOL_VERSION`. **DR-2 = option (A)** means no `..._005` exists, so this string is final. |
| D4 | `protocol_sha256` = `c50fc680...00b719` | READY | `sha256` of the protocol file; recomputed this session and matching. Run `verify-protocol` once more before submitting and confirm it prints this value. |
| D5 | `tooling_aggregate_sha256` | **BLOCKED** | `toolingManifest(ROOT).aggregate`. Computable — but **must not be written yet.** The draft still holds the **superseded** pre-wave `f7699f05...4e5cc5dd` (593 files); DR-1 (option B) and DR-10 both change instrument files. The candidate tree hashes to `638d68e6...3fa278fd2` (594 files), which is a **candidate value, not an authorised one**. Registrable only after: central merge · full re-verification (self-test, anchor count, full mutation run with every mutant KILLED, adapter conformance) · integrity gate byte-identical · **two independent clean rebuilds agreeing** · owner authorisation (A12). Then **recompute it yourself in the tree you are about to freeze** — never copy a digest out of a document, including this one. The window is one-way: the field is inside the on-chain commitment digest and in `SAMPLING_FIELDS`, so a wrong value cannot be repaired, and re-registration is a VOID. See `PROVISIONAL_AGGREGATE_HANDLING.md`. |
| D6 | `registry_sha256` = `a1392952...a70814` | READY | `sha256` of `rules/development_only_registry.json`; recomputed this session and matching. The registry is frozen at registration for **both** stages — do not append a 14th entry afterwards. |
| D7 | `registry.name` = `OSF Registries` | READY | `REGISTRY`. Another registry is an ERROR. |
| D8 | `registry.public` = `true` | READY | `REGISTRY`. Owner act on the OSF form: choose public. |
| D9 | `registry.embargo` = `false` | READY | `REGISTRY`. Owner act on the OSF form: leave the embargo date empty. |
| D10 | `network` = `bitcoin-mainnet` | READY | `MAINNET.name`. Anything else is refused outside `--allow-synthetic`. |
| D11 | `accountable_identity.status` = `REQUIRED_AT_REGISTRATION` | READY | Template annotation. **The verifier never inspects it** — it is a note to a human, not a check. |
| D12 | `bitcoin_key_custodian.status` = `REQUIRED_BEFORE_FUNDING` | READY | Template annotation; likewise never inspected. |
| D13 | `bitcoin_key_custodian.role` = `STUDY_OPERATOR` | READY | Pinned by CPG-040 §3.2. Any other value is an **ERROR**. Leave it. |
| D14 | `provider_configuration_sha256` = `c9a7e9aa...627561` | READY (**DERIVABLE** in a fresh template) | `providerConfigurationSha()` over the two provider files in the frozen treatment clone (§13.1). A fresh template emits `UNASSIGNED`, so it is the twelfth unassigned leaf and the tenth blocker; it is **filled in the draft**, which is why the draft shows **9** blockers and not 10 (`ERRATA.md` E-2, reproduced in `VERIFIER_REHEARSAL.md` variant A). Do not edit either provider file — the harness refuses with `PROVIDER_CONFIG_MISMATCH`. Unaffected by DR-1/DR-2/DR-10. |
| D15 | `authority_rule` (verbatim sentence) | READY | Template constant. Paste verbatim into the OSF narrative: this is the sentence that makes a second registration VOID, and therefore the reason D5's window is one-way. |
| D16 | `verification_procedure` = `CPG_U1_PROTOCOL_004 §21 (cpg_u1_data.mjs verify-sampling)` | READY | Template constant. Paste verbatim. |
| D17 | `parameters.*` — **all 12 leaves** | READY | `PARAMETERS`, pinned by U2/U3: `confirmations_D` 6 · `randomness_offset_K` 12 · `abandonment_days` 180 · `randomness_model` B · `drand_chain_hash` 52db9ba7...84e971 · `drand_delta_seconds` 10800 · `drand_missing_round_expiry_days` 30 · `commitment_opreturn` · `digest_domain` · `seed_derivation` · `rank_key` · `bls_implementation`. `checkRegistration` requires the **key count** to match exactly and every value to be identical, so **do not add, drop or reorder a parameter**. **DR-1 adds none** — the relay floor is enforced in code, not registered. Transcribe verbatim into the narrative. |

---

## 6. Arithmetic

| Group | Leaves |
|---|---|
| A — owner-supplied | **7** (A1–A7; A8–A14 are not registration leaves) |
| B — OSF generated | **2** |
| C — Bitcoin generated | **2** |
| D — automatically derived | **28** = 16 named + 12 `parameters.*` |
| **Total** | **39** — matches `registrationTemplate()` |

Non-`parameters`: 7 + 2 + 2 + 16 = **27**. Matches.

**Blocker arithmetic:** 7 (A1–A7) + 2 (B) + 2 (C) = **11 unresolved leaves in the draft → 9 `BLOCKED` lines**,
because `outpoints` and `checkpoint` are each one line covering two leaves. `tooling_aggregate_sha256` (D5) is
**not** a blocker line at all — it is ERROR-checked for 64-hex **form** only. The single hardest gate on the
registration is the one the verifier does not guard, which is why it carries its own discipline instead.

---

## 7. Order of work (what can run in parallel)

1. **Now, in parallel, blocking nothing:** A1–A5, A8–A11, A13. None of them touches a hash. Recruitment (A13)
   is the longest lead time and **cannot void a registration** — there is no personnel field.
2. **Instrument track, strictly serial:** central merge → full re-verification → integrity gate → clean
   rebuild ×2 agreeing → owner authorisation (A12) → write D5 → **freeze the tree permanently**.
3. **Only after D5 is final:** A14 (coin), then C1/C2 (fund, >= 6 confirmations), then A6/A7 (choose the
   checkpoint, cross-check against A8/A9).
4. **Then** submit to OSF → paste B1/B2 → `verify-registration` with `--registration
   --identity-registrations --protocol --registry` must exit **0**.

---

## 8. Prohibitions honoured

No registration. No OSF submission. No Bitcoin activity of any kind. No network, no credentials. No value
invented: A1–A14 stand as unfilled markers, and the only digests quoted are ones recomputed read-only from
files already on disk. The candidate instrument, the protocol, the treatment, the evaluation tree and the
registry were read-only; `registration_record.DRAFT.json` was **not modified** (sha256
`48f5621d305b0de2b766588b199e80e2263c22da75b36f36a103014abc8daba6`, identical before and after every command).
No selftest, no mutation run, no rebuild, nothing CPU-heavy. No commit, push or pull request. No real frame,
no U1 execution.
