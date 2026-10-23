# CPG-U1 REGISTRATION READINESS TABLE

**Agent:** DEEPTECH-PARALLEL-008 / AGENT 6. **Date:** 2026-09-24. **Worktree:** `C:/tmp/dt4-uncert` (detached at
`af2fb6e99ce461894bf16f18c2251f75088eba18`).

**CLASSIFICATION: PREPARATION ONLY.** Nothing was registered. No OSF submission was made. No external value was
invented, fetched, generated or guessed. No Bitcoin activity. No network access. No frozen byte changed.

This table supersedes the field tables in `C:/tmp/dt004-operations/registration/REMAINING_FIELDS.md` §1 and
`REGISTRATION_PACKAGE.md` §1 on the two points already corrected by that directory's `ERRATA.md` (E-1: AD-1..AD-9
are RECORDED, not UNDECIDED; E-2: `provider_configuration_sha256` is machine-computable and is filled).

---

## 0. Baseline, re-verified by this agent

Every hash below was recomputed here, read-only, in this session. Nothing was taken on trust from prose.

| Item | Value | How verified | Result |
|---|---|---|---|
| Protocol document | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md` in the worktree | **MATCHES** |
| `research/cpg-u1` tree | `2d66f68088e6f230d8ae92b180b6db53c49502b4` | `git rev-parse HEAD:research/cpg-u1` | **MATCHES** |
| Instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, **593 files** | `toolingManifest()` from `lib/aggregate.mjs` against `C:/tmp/dt002/research/cpg-u1/tooling` | **MATCHES** |
| Stale worktree tooling (do not use) | `640510782a08a1ef2c1defd998f33b0ab0f14307557f7e70534bb3d8e45b613f`, **587 files** | same function against `C:/tmp/dt4-uncert/research/cpg-u1/tooling` | **CONFIRMED STALE** — the brief's warning is correct |
| Treatment commit | `f01a7eb4199be4e04d4fee7fc0116303949dc553` | `git rev-parse HEAD` in `C:/tmp/cpg049_integration/treatment` | **MATCHES** |
| Treatment tree | `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af` | `git rev-parse HEAD^{tree}` | **MATCHES** |
| Treatment content aggregate | `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5`, **11552 files** | `verifyEvaluationTree()` against the clone and the protocol text: `ok=true`, zero notes, zero refusals | **MATCHES** |
| Treatment clone cleanliness | `git status --porcelain` empty | direct | **CLEAN** |
| Development-only registry | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | `sha256sum rules/development_only_registry.json` | **MATCHES** |
| Provider configuration | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | `providerConfigurationSha('C:/tmp/cpg049_integration/treatment')` from the frozen `lib/harness.mjs` | **STILL MATCHES** |

### 0.1 Baseline discrepancy the brief did not state

The brief names main as `33bceb1f919113c622587fa7c6403a0d4596bbad`. Verified facts:

- `33bceb1f...` **exists** as a commit object, and its `research/cpg-u1` tree **is** `2d66f680...`.
- `33bceb1f...` is **NOT** an ancestor of this worktree's HEAD (`af2fb6e9...`, "Merge pull request #270 from
  kulrashm-jpg/integrate/pi-t2-001").
- `main` in `C:/virality` is now `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2`, not `33bceb1f...`.

**Consequence for registration: none.** The only registration-relevant object in the repository is
`research/cpg-u1`, whose tree is identical at `33bceb1f...`, at `af2fb6e9...` and therefore in this worktree
(`2d66f680...`), and the protocol document hashes to the registered `c50fc680...`. Mainline has moved; the
protocol has not. Recorded so that no later reader mistakes the drift for a protocol change.

---

## 1. Field list, derived mechanically

Derived by importing `registrationTemplate()` from
`C:/tmp/dt002/research/cpg-u1/tooling/lib/registration.mjs` and enumerating its keys — **not** from prose.

| Count | Meaning |
|---|---|
| **20** | top-level keys in the registration record |
| **39** | leaf paths (scalar values) in total |
| **12** | of those leaves are `parameters.*`, pinned verbatim by U2/U3 |
| **27** | leaf paths excluding `parameters.*` |

The five sections below carry one row per non-`parameters` leaf, plus one aggregate row for the pinned
`parameters` block — covering all **39 leaves**. `checkRegistration(reg, {phase:'registered'})` is the authority
for STATUS; `registrationTemplate()` is the authority for the field list.

Two leaves are never blockers but are worth naming: `accountable_identity.status`
(`REQUIRED_AT_REGISTRATION`) and `bitcoin_key_custodian.status` (`REQUIRED_BEFORE_FUNDING`) are template
annotations the verifier does not inspect at all, plus `bitcoin_key_custodian.role`, which it *does* pin.

---

## 2. SECTION 1 — ALREADY COMPUTED (26 leaves; nothing left to do)

All filled in `C:/tmp/dt004-operations/registration/registration_record.DRAFT.json` and verified in §0.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `schema` | FILLED `cpg-u1-registration/v1` | `REGISTRATION_SCHEMA`, `lib/registration.mjs:8` | Yes (constant) | No | No | Nothing. Do not edit — `checkRegistration` refuses any other value as an ERROR. |
| `study_id` | FILLED `CPG-U1-2026-01` | `STUDY_ID`, `lib/commitment.mjs` | Yes (constant) | No | No | Nothing. |
| `protocol_version` | FILLED `CPG_U1_PROTOCOL_004` | `PROTOCOL_VERSION`, `lib/registration.mjs:9` | Yes (constant) | No | No | Nothing. |
| `protocol_sha256` | FILLED `c50fc680...` | `sha256` of `research/cpg-u1/CPG_U1_PROTOCOL_004.md` | Yes | No | No | Nothing — but do not touch the protocol file from here on. Run `verify-protocol --protocol <file>` once more and confirm it prints `c50fc680...` before you submit. |
| `tooling_aggregate_sha256` | FILLED `f7699f05...` (593 files) | `toolingManifest(ROOT).aggregate` over `C:/tmp/dt002/research/cpg-u1/tooling` | Yes | No | No | Nothing **if DR-1 and DR-2 are settled as no-change** (§7). If either is settled as a patch, this value moves — settle them first, so it moves at most once. |
| `registry_sha256` | FILLED `a1392952...` | `sha256` of `rules/development_only_registry.json` | Yes | No | No | Nothing. The registry is append-only and frozen (§5.3): do not add a 14th entry after this hash is registered. |
| `registry.name` | FILLED `OSF Registries` | `REGISTRY`, `lib/registration.mjs:11` | Yes (constant) | No | No | Nothing. U1 pins OSF; another registry is an ERROR. |
| `registry.public` | FILLED `true` | `REGISTRY` | Yes (constant) | No | No | On the OSF form, choose **public registration**. |
| `registry.embargo` | FILLED `false` | `REGISTRY` | Yes (constant) | No | No | On the OSF form, leave the embargo date **empty** — select no embargo period. |
| `network` | FILLED `bitcoin-mainnet` | `MAINNET.name`, `lib/bitcoin.mjs` | Yes (constant) | No | No | Nothing. Mainnet only; anything else is refused outside `--allow-synthetic`. |
| `provider_configuration_sha256` | FILLED `c9a7e9aa...` | `providerConfigurationSha()` over `backend/services/companyProfile/grounding/registry/builtins.ts` + `coverageInventory.ts` in the frozen treatment clone (§13.1) | **Yes — recomputed and re-confirmed by this agent** | No | No | Nothing. Do not edit either provider file in the clone; `lib/harness.mjs:54` refuses execution with `PROVIDER_CONFIG_MISMATCH` if it changes. |
| `parameters.*` (12 leaves) | FILLED, all 12 | `PARAMETERS`, `lib/registration.mjs:14-27`; pinned by U2/U3 | Yes (constants) | No | No | Transcribe verbatim into the OSF narrative. `checkRegistration` requires the key **count** and every value to match exactly, so do not add, drop or reorder a parameter. |
| `accountable_identity.status` | FILLED `REQUIRED_AT_REGISTRATION` | `registrationTemplate()` | Yes (constant) | No | No | Nothing. This is a template annotation; the verifier does not inspect it. |
| `bitcoin_key_custodian.status` | FILLED `REQUIRED_BEFORE_FUNDING` | `registrationTemplate()` | Yes (constant) | No | No | Nothing. Annotation only. |
| `bitcoin_key_custodian.role` | FILLED `STUDY_OPERATOR` | pinned by CPG-040 §3.2 | Yes (constant) | No | No | Leave it. Any other role is an ERROR, not a blocker. |
| `authority_rule` | FILLED (verbatim string) | `registrationTemplate()` | Yes (constant) | No | No | Paste verbatim into the OSF narrative. This is the sentence that makes a second registration VOID. |
| `verification_procedure` | FILLED `CPG_U1_PROTOCOL_004 §21 (cpg_u1_data.mjs verify-sampling)` | `registrationTemplate()` | Yes (constant) | No | No | Paste verbatim into the OSF narrative. |

---

## 3. SECTION 2 — REQUIRES OWNER INPUT (5 blocking leaves)

An agent is prohibited from supplying any of these. Each is a named blocker in the verifier output (§8).

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `accountable_identity.value` | **BLOCKED** — `UNASSIGNED` | The accountable person or organisation itself (U1; §4A.1) | **No** | **Yes — H3** (the independence is itself the evidence) | **YES** | Decide *who* is accountable. Then: (1) open <https://osf.io> and create or sign in to that identity's account, using that person's or organisation's own email address, not the developing organisation's; (2) fill the OSF profile with the legal or published name; (3) type that exact name string into `accountable_identity.value`. It must be the same identity that files the registration, because `checkAuthority` compares identities across the registration list and refuses a mismatch. |
| `persistent_identifier.type` | **BLOCKED** — `UNASSIGNED` | Owner, choosing the scheme | Preparable, not decidable | **Yes — H2** | **YES** | Choose one scheme and type its name as a string (for example the scheme label for an ORCID iD for a person, or for a ROR ID or DOI for an organisation). The verifier accepts **any** non-blank string here, so the choice carries no machine-checkable meaning — also state the scheme in the OSF narrative so a reader can resolve the identifier. |
| `persistent_identifier.value` | **BLOCKED** — `UNASSIGNED` | The external issuing authority of the chosen scheme | **No** | **Yes — H2** | **YES** | Register with that scheme's issuer and copy back the identifier the issuer returns. For an ORCID iD: go to <https://orcid.org/register>, complete registration, copy the 16-digit iD from the account page. For a ROR ID: look the organisation up at <https://ror.org> and copy its ID, or file a new-record request if no record exists. Paste the issued string verbatim; do not reformat it. Lead time is scheme-dependent and is days, not minutes, for a newly requested identifier. |
| `bitcoin_key_custodian.value` | **BLOCKED** — `UNASSIGNED` | Owner, naming the study operator | **No** | **Yes — H3** | **YES** — blocks funding *and* registration (it is checked in `phase: 'funding'` too) | Name one person as study operator and type their name or pseudonymous ID into the field. Do this **before** recruiting the seven independent people: `lib/personnel.mjs` refuses an operator who also holds any §4A.3 role, so naming the custodian late can force re-recruitment. |
| `as_of` | **BLOCKED** — `UNASSIGNED` | Owner, as a methodological choice (§7, §19.1) | Format-checkable only | **Yes — H1** | **YES** | Pick one instant and type it as `YYYY-MM-DDTHH:MM:SSZ`. This is **not** a clock reading: it is the single "as of" date the whole held-out run observes, it is frozen for the entire study, it cannot be changed afterwards, and `lookupInput` uses this exact string for every candidate. Choose it before registration and write down the reason. |

---

## 4. SECTION 3 — GENERATED BY OSF (2 blocking leaves; unobtainable before submission)

Neither can be filled in advance by anyone. These two are the reason the record is completed in two passes.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `registration_id` | **BLOCKED** — `UNASSIGNED` | OSF Registries, at submission | No | Yes — H2 (submission is a human act) | **YES** | Once the OSF registration is live, copy its identifier from the registration's URL or its Registration metadata panel and paste it in. It must not contain `|` — the verifier refuses that character, because it is the field separator inside the commitment payload. |
| `registration_timestamp` | **BLOCKED** — `UNASSIGNED` | OSF Registries, at submission | No | Yes — H2 | **YES** | Copy the registration date-time OSF records and convert it to UTC in exactly `YYYY-MM-DDTHH:MM:SSZ` form. Do not substitute your own clock: this is the value `registrationEpoch()` turns into the study epoch, and the tie-breaker `checkAuthority()` uses to decide which registration is authoritative. |

---

## 5. SECTION 4 — REQUIRES BITCOIN ACTIVITY (4 leaves, 2 blockers)

No agent may perform any of this. `outpoints` is one blocker covering two leaves; `checkpoint` is one blocker
covering two leaves — which is why 11 blocking leaves produce only 9 blocker lines.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `outpoints.development` (`O_dev`) | **BLOCKED** — `UNASSIGNED` | The key custodian, creating and funding a single-use output | **No** | **Yes — H2** | **YES** (one blocker with the row below) | The custodian generates a fresh single-use P2WPKH address, sends the funding amount to it in one transaction, waits for **at least 6 confirmations** (D = 6), then types the outpoint as `<txid>:<vout>` — 64 lowercase hex, a colon, then the decimal output index. `parseOutpoint()` validates the syntax. Expect roughly an hour at typical block intervals; the tail is unbounded. |
| `outpoints['held-out']` (`O_ho`) | **BLOCKED** — `UNASSIGNED` | same | **No** | **Yes — H2** | **YES** | The same act, a **different** output — `checkRegistration` refuses two identical outpoints. It may be a second output of the same funding transaction, which halves the waiting. Type it as `<txid>:<vout>`. |
| `checkpoint.height` | **BLOCKED** — `UNASSIGNED` | Read from the chain at or after both funding confirmations | Partly (format-checked) | **Yes — H1** | **YES** (one blocker with the row below) | Once both outputs have at least 6 confirmations, choose one block at or after both of them and type its height as a plain JSON **number** — not a quoted string. The `UNASSIGNED` string is exactly what makes this a blocker. |
| `checkpoint.hash` | **BLOCKED** — `UNASSIGNED` | the same block's header | Partly (format-checked) | **Yes — H1** | **YES** | Type that block's hash as 64 lowercase hex. **Cross-check the height-to-hash pair against two independent header sources** (see `HEADER_AND_RELAY_SOURCES.md`) before writing it: the verifier checks only that it is 64 hex characters. It has no network and cannot tell a real block hash from a plausible one. |

---

## 6. SECTION 5 — REQUIRES INDEPENDENT PERSONNEL (0 registration fields; a §19.3 prerequisite, and the real critical path)

**No row here is a registration-record field.** `verify-registration` will exit 0 with none of this in place. It
is listed because §19.3 makes it a prerequisite and because it is the longest lead time in the study.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| Seven mutually exclusive independent persons (§4A, §19.3 item 3) | **NOT STARTED** | Owner, recruiting people independent of the developing organisation | **No** | **Yes — H3** | Not for `verify-registration`; **YES** for every study stage | Recruit: enumerator(s), reference Author, Confirmer, reference adjudicator, at least 2 raters, and a rating adjudicator. Per person collect three artifacts: (a) a signed declaration answering §4A.3 items 1-4 and 6 and §4A.2(a)-(b) with **"no"** — "unknown" is not "no"; (b) the fee agreement's SHA-256, agreed in writing **before** any role material is released and not contingent on any result, or `null` for no fee; (c) the developing organisation's written confirmation that its records show no item 1-4 relationship, and that document's SHA-256. Then run `check-personnel`. |
| Eight-person model (operator + 7) | **AUTHORISED — no protocol amendment needed** | §4A.3 / §4A.1 | n/a | n/a | No | Nothing. **Verified by this agent, three independent ways:** protocol line 186 states "Several enumerators are permitted; each holds no other role."; `lib/personnel.mjs:26` reads `else if (role !== 'enumerator' && n > 1) errors.push(...)`, i.e. the "exactly one" rule is applied to every role **except** `enumerator`; and `test/selftest.mjs:829` is a **passing** assertion named `'multiple distinct enumerators permitted'` which appends a second enumerator and requires `errors.length === 0`. Do **not** raise an amendment for this. |
| `rater-1` / `rater-2` / `rating-adjudicator` assignment fingerprint | **NOT STARTED** | Owner, via `rater-assignment-fingerprint` | Computing the fingerprint: yes. Deciding the assignment: no | **Yes** | Not for registration; **YES before the held-out commitment is broadcast** | Once the raters and the rating adjudicator are named, record which individual holds which label in the personnel register, run `rater-assignment-fingerprint`, and **publish the resulting SHA-256 before the held-out commitment transaction is broadcast** (protocol line 189; §4A.3, §12.1). Publishing it afterwards destroys the guarantee and there is no way to repair it. |
| Two independent Bitcoin header sources (or an own full node) | **NOT SELECTED** | Owner | Naming sources: yes | H1, or H2 for an own node | Not for registration; YES for verification | Name two sources in writing, or run your own node. An own node's initial block download takes **days** — start it now if you intend to use one. See `HEADER_AND_RELAY_SOURCES.md`. |
| At least 2 drand relays | **OPEN — DR-1** | Owner | Naming relays: yes | Yes | Not for registration; YES for verification | Settle **DR-1** (§7), then name the relays. |
| Recording fetcher / recording Wikidata lookup / replay harness (§13); certenv with a fixture tenant | **ENGINEERING; certenv wording OPEN — DR-2** | Engineering | Yes | No (engineering time) | Not for registration; YES before held-out execution | Settle **DR-2** (§7), then build. Not an external wait. |
| Funding satoshis for `O_dev`, `O_ho` and both commitment fees | **NOT ACQUIRED** | Key custodian | No | **Yes — H2** | Blocks §5 | Acquire and transfer the coin to the custodian's wallet **before** the outpoint step, so both funding outputs and both commitment transactions can be paid without a second acquisition round. |

---

## 7. The two decisions that must be settled BEFORE registration

DR-1 and DR-2 remain **open owner decisions**. Verified from the memos in
`C:/tmp/dt004-operations/registration/`:

| Decision | Route with no aggregate impact | Route that moves the aggregate |
|---|---|---|
| **DR-1** (drand relay floor) | Route A: register at `f7699f05...` unchanged and state the relay floor in the registration narrative. `DR1_DRAND_RELAY_FLOOR_MEMO.md:215`: "**Aggregate impact: None.**" | Route B: patch `lib/evidenceBundle.mjs`, `lib/sampling.mjs`, `test/selftest.mjs`, `test/mutate.mjs`, `README.md`. `:229`: the aggregate "**moves off `f7699f05...`**". Forces full re-verification: self-test, anchor count **389 to 391**, a full 391-mutant run with every mutant KILLED, adapter conformance, and rebuilding the identity table in five documents. |
| **DR-2** (§19.3 certenv wording) | Routes 1-3: `DR2_CERTENV_WORDING_MEMO.md:194`: "**Tooling aggregate impact: None.** `f7699f05...` unchanged." | Route 4 (modify the harness to permit an env file): `:257` — "that is a tooling edit: aggregate moves, full re-verification". `:226`: a new file also moves the aggregate if the version constant is renamed. |

**Why this is an ordering constraint, not a preference.** `registration-fields` does not accept an aggregate as
input — it calls `toolingManifest(ROOT).aggregate` at run time (`cpg_u1_data.mjs:269`) and registers whatever the
tree happens to hash to. Therefore:

- **Settle DR-1 and DR-2 before registration** and the aggregate moves **at most once**, before anything is
  registered, invalidating nothing. This is the only window in which the instrument may change at all.
- **Settle them after registration** and `registered()` — which recomputes the aggregate on **every** sampling
  command — aborts with `VERIFY_ABORT_HASH_MISMATCH` (`cpg_u1_data.mjs:178-179`), while `lib/harness.mjs:44`
  refuses identically with `TOOLING_MISMATCH`. Re-registering to fix it **voids the study**:
  `tooling_aggregate_sha256` is in `SAMPLING_FIELDS` (`lib/registration.mjs:119`), and `checkAuthority` makes a
  duplicate registration naming different sampling fields a VOID, with the earliest registration winning.
- **Settle them after the development commitment** and the aggregate is inside the commitment payload
  (`lib/commitment.mjs` `PAYLOAD_KEYS`), whose digest has been broadcast in the OP_RETURN. It is then on the
  Bitcoin blockchain and no lawful edit exists.

---

## 8. Verifier state, measured

Run from `C:/tmp/dt002/research/cpg-u1/tooling`, with stdout and stderr redirected to **files** so the exit code
was read from `$?` and **not** masked by a pipe:

```
node cpg_u1_data.mjs verify-registration \
  --registration C:/tmp/dt004-operations/registration/registration_record.DRAFT.json \
  --registry rules/development_only_registry.json \
  --protocol C:/tmp/dt4-uncert/research/cpg-u1/CPG_U1_PROTOCOL_004.md \
  --identity-registrations /dev/null
```

**REAL EXIT CODE: 4** (`EXIT.BLOCKED`, `cpg_u1_data.mjs:52`). stdout was empty. stderr, verbatim:

```
  BLOCKED Bitcoin wallet-key custodian is UNASSIGNED (bitcoin_key_custodian.value)
  BLOCKED Accountable OSF identity is UNASSIGNED (accountable_identity.value)
  BLOCKED Persistent identifier type is UNASSIGNED (persistent_identifier.type)
  BLOCKED Persistent identifier is UNASSIGNED (persistent_identifier.value)
  BLOCKED registration_id is UNASSIGNED (issued by the registry at registration)
  BLOCKED registration_timestamp is UNASSIGNED (issued by the registry at registration)
  BLOCKED outpoints are UNASSIGNED (created by the key custodian before registration)
  BLOCKED checkpoint is UNASSIGNED (a block at or after both funding confirmations)
  BLOCKED as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
ERROR: BLOCKED — 9 named prerequisite(s) missing; the tooling will not invent them
```

**Nine blockers. Zero ERRORs.** The zero is the significant number: every field an agent is permitted to fill is
filled and valid, so nothing remains that is not genuinely external. The run stops inside
`reportRegistrationCheck` (`cpg_u1_data.mjs:162-167`) before the registry, protocol and authority comparisons are
reached, so those three remain unexercised until the blockers clear.

**E-2 confirmed by counterfactual.** The same command against `registration_fields.TEMPLATE.json` — identical
except that `provider_configuration_sha256` is `UNASSIGNED` — reports **10** prerequisites, the extra line being
exactly `BLOCKED provider_configuration_sha256 is UNASSIGNED (§13.1/§19.1: computed from the resolver before
registration)`. The reduction from 10 to 9 is attributable to the provider hash and to nothing else.

---

## 9. Footnote — what no command validates

`verify-registration` exiting 0 would **not** mean the study is sound. The following registration-relevant
properties are checked by no command in the instrument. Each is a place where a false or careless value passes
silently.

1. **Whether any declaration is true.** `check-personnel` verifies structure only — roles filled, mutual
   exclusion, operator in no independent role, declarations literally `"no"`, confirmation hash present. The
   protocol states it outright at line 189: "**It cannot verify that declarations are true.**" §4A.3 calls the
   whole apparatus "**procedural evidence, not proof**".
2. **Whether `enumerated_by` corresponds to a registered person.** `lib/schema.mjs:124` is
   `if (!r.enumerated_by.trim()) errors.push('enumerated_by is required')` — a non-blank string and nothing
   more. There is **no** cross-reference from a frame row to the personnel register. An operator could enumerate
   the frame themselves and write any name; no command objects. The self-test's own fixture at
   `test/selftest.mjs:2260` uses `enumerated_by: 'cpg-implementer-NOT-INDEPENDENT'` precisely to exercise this.
3. **Whether the development-only registry is complete.** §5.3: "**The seed's completeness is not attested**
   (§19.2, H2)." §19.2 records H2 as "Confirmed" — a human confirmation to the best of knowledge, not a verified
   property. `registry_sha256` proves the 13 entries did not change; it proves nothing about a 14th company that
   should have been among them.
4. **Whether the accountable identity, the persistent identifier or the custodian denote anything real.** The
   verifier's `human()` helper accepts **any** non-blank string that does not contain `SYNTHETIC`.
   `persistent_identifier.type` and `.value` get no format check at all — no ORCID checksum, no ROR pattern, no
   DOI resolution. A plausible invention is indistinguishable from an issued identifier.
5. **Whether the registration exists on OSF.** `lib/registration.mjs` says so in its own header comment: "It
   cannot see the registry; outsiders confirm the record there." `checkAuthority` does not enumerate OSF — it
   compares against an `--identity-registrations` list **supplied by whoever runs the command**. An incomplete
   list hides an earlier registration, which is exactly the condition that would make this record
   non-authoritative.
6. **Whether the checkpoint is a real block, and whether the outpoints exist or are unspent.** The record check
   validates only that the height is a safe non-negative integer, that the hash is 64 hex, and that the outpoints
   parse as `txid:vout` and differ from each other. Existence, confirmation depth and non-spend are checked only
   when an `--evidence` bundle is supplied, and §20.17 states the tooling "**cannot prove non-spend**, most-work
   status, source independence or drand unavailability from a bundle; outsiders confirm with a full node and at
   least 2 relays".
7. **Whether `as_of` was chosen before registration, or chosen honestly.** Only the ISO-8601 UTC format is
   checked. Nothing detects an `as_of` picked after seeing a result.
8. **Whether any unlogged CPG query happened.** §20.20: "The protocol **cannot prove that no unlogged private
   CPG query occurred** in any environment. The execution-log audit examines only the supplied log, whose
   timestamps come from the operator's systems (§6.5)." `lib/harness.mjs`'s own header comment repeats it.
9. **Whether the assignment fingerprint was published before the commitment broadcast.** The fingerprint's
   *value* is verifiable; the *timing* of its publication — the entire point of §4A.3 — is not. Nothing in the
   instrument observes when a fingerprint became public relative to a broadcast.
10. **Whether the instrument being run is the one described.** The aggregate is self-consistent by construction:
    `toolingManifest(ROOT)` hashes whatever tree the command runs in. The stale 587-file tree in this worktree
    hashes perfectly well — to `640510...`. Only comparison against the *registered* value catches a swap, and
    before registration there is no registered value to compare against. This is why §0 of this document
    recomputes the aggregate rather than quoting it.

---

## 10. Exact next owner action

**Settle DR-1 and DR-2 in writing.** Not because they are the largest items, but because they are the only
remaining items that can still move `tooling_aggregate_sha256`, and the window in which it may move closes
permanently at registration.

Recruitment (§6) is the longest lead time in the whole study and blocks no registration field — start it in
parallel today.

Then follow `OPERATOR_REGISTRATION_SEQUENCE.md` in this directory from step S1.

---

## 11. Filename clash with `.gitignore`

Checked with `git check-ignore -v` in this worktree. **This file is git-ignored**, by `.gitignore:51`
`*_READINESS*.md` — a third pattern beyond the two named in the task brief. The full result and the verified
trackable alternatives are in `OSF_METADATA_PREPARED.md` §9. To commit this file as named:

```
git add -f research/deeptech-operations/prereg-008/F-registration/REGISTRATION_READINESS_TABLE.md
```
