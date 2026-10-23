# CPG-U1 — REGISTRATION FIELD STATUS (post-DR-1 / DR-2 / DR-10)

**CLASSIFICATION: PREPARATION.** Nothing registered, submitted, published, broadcast, committed or pushed.
No external value or identity is invented in this document. Every external leaf is left visibly unresolved.

**Supersedes for STATUS purposes** the field table in
`C:/tmp/dt008-prereg/F-registration/REGISTRATION_READINESS_TABLE.md` sections 2-6, in exactly one respect:
`tooling_aggregate_sha256` is **no longer FILLED**, because DR-1 and DR-10 are now DECIDED and both move it.
Everything else in that table stands; the per-field "EXACT OWNER ACTION" text there remains the operative
instruction and is carried forward rather than rewritten. The decision authority is
`C:/tmp/dt009-closure/orchestrator/DECISION_RECORD.md`.

---

## 1. The field list, derived mechanically

Derived by importing `registrationTemplate()` from the **frozen** instrument at
`C:/tmp/dt002/research/cpg-u1/tooling/lib/registration.mjs` and enumerating the returned object — not from
prose, and not from the draft JSON. `registrationTemplate({ protocolSha, toolingAggregate, registrySha })`
takes exactly those three arguments; everything else it returns is a constant or the literal `UNASSIGNED`.

Recomputed by this agent in this session:

| Count | Meaning |
|---|---|
| **20** | top-level keys in a `cpg-u1-registration/v1` record |
| **39** | leaf paths (scalar values) in total |
| **12** | of those leaves are `parameters.*`, pinned verbatim by U2/U3 |
| **27** | leaf paths excluding `parameters.*` |
| **12** | leaves that a **fresh template** emits as the literal string `UNASSIGNED` |

The 20 top-level keys, in template order:

```
schema · study_id · protocol_version · protocol_sha256 · tooling_aggregate_sha256 · registry_sha256 ·
registry · registration_id · registration_timestamp · accountable_identity · persistent_identifier ·
bitcoin_key_custodian · network · outpoints · checkpoint · parameters · as_of ·
provider_configuration_sha256 · authority_rule · verification_procedure
```

The **12 UNASSIGNED leaves of a fresh template**, enumerated mechanically:

```
registration_id · registration_timestamp · accountable_identity.value · persistent_identifier.type ·
persistent_identifier.value · bitcoin_key_custodian.value · outpoints.development · outpoints.held-out ·
checkpoint.height · checkpoint.hash · as_of · provider_configuration_sha256
```

**Eleven, not twelve, are still unresolved in the draft record.** `provider_configuration_sha256` was
machine-computed and filled — see `ERRATA.md` E-2 — which is why the verifier reports **9** blockers rather
than 10 (`outpoints` is one blocker covering two leaves; `checkpoint` is one blocker covering two leaves).

**`checkRegistration(reg, {phase:'registered'})` is the authority for STATUS; `registrationTemplate()` is the
authority for the field list.** Only `parameters` is an exact-key set (`lib/registration.mjs:81`); the
top-level key set is not exhaustively constrained, so a key *could* be added — and **must not be**, because
`REGISTRATION_PACKAGE.md` section 6(1) requires the OSF submission to carry the record as
`registration-fields` produced it.

Three leaves are worth naming because they are never blockers: `accountable_identity.status`
(`REQUIRED_AT_REGISTRATION`) and `bitcoin_key_custodian.status` (`REQUIRED_BEFORE_FUNDING`) are template
annotations the verifier does not inspect at all, while `bitcoin_key_custodian.role` **is** pinned to
`STUDY_OPERATOR` and any other value is an ERROR, not a blocker.

The five groups below carry one row per non-`parameters` leaf plus one aggregate row for the pinned
`parameters` block, covering all **39 leaves**, followed by a group that contains **no registration field at
all**.

---

## 2. GROUP 1 — ALREADY COMPUTED (25 leaves + the 12 pinned parameters; nothing left to do)

`tooling_aggregate_sha256` has **left this group** as a result of DR-1 and DR-10; it is now in group 1a.
Every row here is filled and valid in `C:/tmp/dt004-operations/registration/registration_record.DRAFT.json`.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `schema` | FILLED `cpg-u1-registration/v1` | `REGISTRATION_SCHEMA`, `lib/registration.mjs:8` | Yes (constant) | No | No | Nothing. Do not edit — any other value is an ERROR. |
| `study_id` | FILLED `CPG-U1-2026-01` | `STUDY_ID`, `lib/commitment.mjs` | Yes (constant) | No | No | Nothing. |
| `protocol_version` | FILLED `CPG_U1_PROTOCOL_004` | `PROTOCOL_VERSION`, `lib/registration.mjs:9` | Yes (constant) | No | No | Nothing. **DR-2 confirms no new protocol version exists**, so this string is final. |
| `protocol_sha256` | FILLED `c50fc680...00b719` | `sha256` of `research/cpg-u1/CPG_U1_PROTOCOL_004.md` | Yes | No | No | Nothing. **DR-2 = option (A) means this value is now final**: the certenv wording is kept, so the protocol file is not edited and no `CPG_U1_PROTOCOL_005` is written. Run `verify-protocol` once more before submitting and confirm it prints `c50fc680...`. |
| `registry_sha256` | FILLED `a1392952...a70814` | `sha256` of `rules/development_only_registry.json` | Yes | No | No | Nothing. The registry is append-only and frozen (section 5.3); do not add a 14th entry after this hash is registered. |
| `registry.name` | FILLED `OSF Registries` | `REGISTRY`, `lib/registration.mjs:11` | Yes (constant) | No | No | Nothing. U1 pins OSF; another registry is an ERROR. |
| `registry.public` | FILLED `true` | `REGISTRY` | Yes (constant) | No | No | On the OSF form, choose **public registration**. |
| `registry.embargo` | FILLED `false` | `REGISTRY` | Yes (constant) | No | No | On the OSF form, leave the embargo date **empty** — select no embargo period. |
| `network` | FILLED `bitcoin-mainnet` | `MAINNET.name`, `lib/bitcoin.mjs` | Yes (constant) | No | No | Nothing. Mainnet only; anything else is refused outside `--allow-synthetic`. |
| `provider_configuration_sha256` | FILLED `c9a7e9aa...627561` | `providerConfigurationSha()` over the two provider files in the frozen treatment clone (section 13.1) | **Yes** (`ERRATA.md` E-2 reclassified it H1 to H0) | No | No | Nothing. Do not edit either provider file in the clone; the harness refuses execution with `PROVIDER_CONFIG_MISMATCH` if it changes. **Unaffected by DR-1, DR-2 and DR-10** — the wave's integrity gate requires it to be byte-identical before and after. |
| `parameters.*` (**12 leaves**) | FILLED, all 12 | `PARAMETERS`, `lib/registration.mjs:14-27`; pinned by U2/U3 | Yes (constants) | No | No | Transcribe verbatim into the OSF narrative. `checkRegistration` requires the key **count** and every value to match exactly, so do not add, drop or reorder a parameter. **DR-1 adds no parameter**: the relay floor is enforced in code, not registered as a parameter, so `parameters` still has exactly 12 keys. |
| `accountable_identity.status` | FILLED `REQUIRED_AT_REGISTRATION` | `registrationTemplate()` | Yes (constant) | No | No | Nothing. Annotation only; the verifier does not inspect it. |
| `bitcoin_key_custodian.status` | FILLED `REQUIRED_BEFORE_FUNDING` | `registrationTemplate()` | Yes (constant) | No | No | Nothing. Annotation only. |
| `bitcoin_key_custodian.role` | FILLED `STUDY_OPERATOR` | pinned by CPG-040 section 3.2 | Yes (constant) | No | No | Leave it. Any other role is an ERROR, not a blocker. |
| `authority_rule` | FILLED (verbatim string) | `registrationTemplate()` | Yes (constant) | No | No | Paste verbatim into the OSF narrative. This is the sentence that makes a second registration VOID — and therefore the reason the aggregate window is one-way. |
| `verification_procedure` | FILLED `CPG_U1_PROTOCOL_004 §21 (cpg_u1_data.mjs verify-sampling)` | `registrationTemplate()` | Yes (constant) | No | No | Paste verbatim into the OSF narrative. |

### 2a. GROUP 1a — **MOVED BY A DECIDED DECISION** (1 leaf; machine-computable, but not yet stable)

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `tooling_aggregate_sha256` | **PROVISIONAL — NOT REGISTRABLE YET.** The draft still holds the pre-wave value `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (593 files), which this agent recomputed read-only and confirmed; **that value is no longer the value to register**, because DR-1 (option B) and DR-10 both change instrument files. The value to register is `<<PROVISIONAL: to be supplied by the orchestrator after clean-rebuild verification>>`. | `toolingManifest(ROOT).aggregate`, `lib/aggregate.mjs:8-22`, over the **post-DR-1/DR-10** instrument tree | **Yes** — it is a pure function of the tree. But automation does not make it *settled*: `toolingManifest` hashes whatever tree it is run in, so a wrong tree yields a confidently wrong value (the stale 587-file tree in this worktree hashes cleanly to `640510...`). | **Yes, for authorisation only** — the owner authorises which computed value is registered; no human types a digest. | **No** — it is not a `checkRegistration` blocker (it is ERROR-checked for 64-hex form only), but it **is the single hardest gate on the whole registration**, because it cannot be corrected afterwards. | **Do not write any value into this field yet.** Wait for the orchestrator to publish the post-merge aggregate after **two independent clean rebuilds agree**; then paste that value, run the full re-verification (self-test, anchor count, full mutation run with every mutant KILLED, adapter conformance), and only then proceed. Do **not** copy the value from any document, including this one. Recompute it yourself in the tree you are about to freeze. See `PROVISIONAL_AGGREGATE_HANDLING.md`. |

---

## 3. GROUP 2 — REQUIRES OWNER INPUT (5 blocking leaves; **all still unresolved**)

An agent is prohibited from supplying any of these, and none is supplied anywhere in this wave. Each is a
named blocker in the verifier output (see `VERIFIER_STATE.md`). The EXACT OWNER ACTION column is carried
forward from `REGISTRATION_READINESS_TABLE.md` section 3 in condensed form; that document remains the full
instruction.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `accountable_identity.value` | **BLOCKED** — `UNASSIGNED` | The accountable person or organisation itself (U1; section 4A.1) | **No** | **Yes — H3** (the independence is itself the evidence) | **YES** | Decide who is accountable; create or sign in to that identity's own OSF account using that identity's own email address, not the developing organisation's; fill the OSF profile with the legal or published name; type that exact name string in. It must be the same identity that files the registration, because `checkAuthority` compares identities across the registration list and refuses a mismatch. |
| `persistent_identifier.type` | **BLOCKED** — `UNASSIGNED` | Owner, choosing the scheme | Preparable, not decidable | **Yes — H2** | **YES** | Choose one scheme and type its name. The verifier accepts **any** non-blank string here, so the choice carries no machine-checkable meaning — also state the scheme in the OSF narrative so a reader can resolve the identifier. |
| `persistent_identifier.value` | **BLOCKED** — `UNASSIGNED` | The external issuing authority of the chosen scheme | **No** | **Yes — H2** | **YES** | Register with that scheme's issuer and paste back, verbatim and unreformatted, the identifier the issuer returns. Lead time for a newly requested identifier is days, not minutes. |
| `bitcoin_key_custodian.value` | **BLOCKED** — `UNASSIGNED` | Owner, naming the study operator | **No** | **Yes — H3** | **YES** — blocks funding *and* registration (checked in `phase: 'funding'` too) | Name one person as study operator. Do this **before** recruiting the independent people: the operator may hold no independent role, so naming the custodian late can force re-recruitment. **Interacts with the eighth person** — see `ENUMERATOR_B_IN_REGISTRATION.md`. |
| `as_of` | **BLOCKED** — `UNASSIGNED` | Owner, as a methodological choice (sections 7, 19.1) | Format-checkable only | **Yes — H1** | **YES** | Pick one instant and type it as `YYYY-MM-DDTHH:MM:SSZ`. This is **not** a clock reading: it is the single "as of" date the whole held-out run observes, it is frozen for the study, and it cannot be changed afterwards. Choose it before registration and write down the reason. |

---

## 4. GROUP 3 — GENERATED BY OSF (2 blocking leaves; unobtainable before submission)

Neither can be filled in advance by anyone, which is why the record is completed in two passes.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `registration_id` | **BLOCKED** — `UNASSIGNED` | OSF Registries, at submission | No | Yes — H2 (submission is a human act) | **YES** | Once the registration is live, copy its identifier from OSF and paste it in. It must not contain `\|` — the verifier refuses that character, because it is the field separator inside the commitment payload. |
| `registration_timestamp` | **BLOCKED** — `UNASSIGNED` | OSF Registries, at submission | No | Yes — H2 | **YES** | Copy the date-time OSF records and convert it to UTC in exactly `YYYY-MM-DDTHH:MM:SSZ` form. Do not substitute your own clock: this is the value `registrationEpoch()` turns into the study epoch and the tie-breaker `checkAuthority()` uses to decide authority. |

---

## 5. GROUP 4 — REQUIRES BITCOIN ACTIVITY (4 leaves, 2 blockers)

**No agent may perform any of this, and none was performed.** `outpoints` is one blocker covering two leaves;
`checkpoint` is one blocker covering two leaves — which is why 11 unresolved leaves produce only 9 blocker
lines.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| `outpoints.development` (`O_dev`) | **BLOCKED** — `UNASSIGNED` | The key custodian, creating and funding a single-use output | **No** | **Yes — H2** | **YES** (one blocker with the row below) | Generate a fresh single-use P2WPKH address, fund it in one transaction, wait for **at least 6 confirmations** (D = 6), then type the outpoint as `<txid>:<vout>`. **Do this only after `tooling_aggregate_sha256` is final** — the aggregate sits inside the on-chain commitment digest, so a funded output committed against a superseded aggregate is wasted. |
| `outpoints['held-out']` (`O_ho`) | **BLOCKED** — `UNASSIGNED` | same | **No** | **Yes — H2** | **YES** | The same act, a **different** output — two identical outpoints are an ERROR. It may be a second output of the same funding transaction, which halves the waiting. |
| `checkpoint.height` | **BLOCKED** — `UNASSIGNED` | Read from the chain at or after both funding confirmations | Partly (format-checked) | **Yes — H1** | **YES** (one blocker with the row below) | Choose one block at or after both confirmations and type its height as a plain JSON **number**, not a quoted string. The `UNASSIGNED` string is exactly what makes this a blocker. |
| `checkpoint.hash` | **BLOCKED** — `UNASSIGNED` | the same block's header | Partly (format-checked) | **Yes — H1** | **YES** | Type that block's hash as 64 lowercase hex, **cross-checked against two independent header sources first**. The verifier checks only that it is 64 hex characters; it has no network and cannot tell a real block hash from a plausible one. |

---

## 6. GROUP 5 — REQUIRES INDEPENDENT PERSONNEL (**0 registration fields**; a section 19.3 prerequisite)

**No row here is a field of the registration record.** Verified for this wave by reading
`lib/registration.mjs` end to end: `registrationTemplate()` emits no personnel key and `checkRegistration()`
never mentions personnel in any form. `verify-registration` would exit 0 with none of this in place. The rows
are listed because section 19.3 makes them prerequisites and because recruitment is the study's longest lead
time. Full detail: `ENUMERATOR_B_IN_REGISTRATION.md` in this directory.

| FIELD | STATUS | SOURCE | AUTOMATABLE? | HUMAN REQUIRED? | BLOCKING? | EXACT OWNER ACTION |
|---|---|---|---|---|---|---|
| At least seven mutually exclusive independent persons (sections 4A, 19.3 item 3) | **NOT STARTED** | Owner, recruiting people independent of the developing organisation | **No** | **Yes — H3** | Not for `verify-registration`; **YES** for every study stage | Recruit enumerator(s), reference Author, Confirmer, reference adjudicator, at least 2 raters and a rating adjudicator. Per person collect a signed declaration answering every item "no" ("unknown" is **not** "no"), the fee agreement's SHA-256 agreed in writing before any role material is released (or `null` for no fee), and the developing organisation's written no-relationship confirmation with its SHA-256. Then run `check-personnel`. |
| **Enumerator B (the eighth person)** | **AUTHORISED; NOT RECRUITED** | Owner (roster decision already taken) | n/a | **Yes** | **No registration field**; yes for enumeration | **Recruit B into the original roster, not as a later addition** — item 6 cannot be answered retrospectively, so a late addition forces a second declaration round for everyone. Represent B per `ENUMERATOR_B_IN_REGISTRATION.md`: a second `role: 'enumerator'` assignment in the personnel register, a mention in the section 19.3 prerequisite list, and one sentence of OSF narrative. **No registration-record key is added.** |
| Eight-person model (operator + 7 independent, of whom 2 enumerators) | **AUTHORISED — no protocol amendment needed** | sections 4A.3 / 4A.1; DR-7 | n/a | n/a | No | Nothing. Do **not** raise an amendment. Publish the DR-7 disposal text (`DECISION_DISCLOSURES.md` section 4.1). |
| Rater / rating-adjudicator assignment fingerprint | **NOT STARTED** | Owner, via `rater-assignment-fingerprint` | Computing it: yes. Deciding the assignment: no | **Yes** | Not for registration; **YES before the held-out commitment is broadcast** | Once the raters are named, record the assignment, run the fingerprint command, and **publish the SHA-256 before the held-out commitment transaction is broadcast**. Publishing it afterwards destroys the guarantee and there is no repair. |
| Two independent Bitcoin header sources (or an own full node) | **NOT SELECTED** | Owner | Naming sources: yes | H1, or H2 for an own node | Not for registration; YES for verification | Name two sources in writing, or start a full node's initial block download now — it takes days. |
| At least 2 drand relays, with per-relay attribution | **DR-1 DECIDED (option B); relays NOT NAMED** | Owner names the relays; the instrument now enforces the floor | Enforcement: yes, post-DR-1. Naming: no | **Yes** | Not for registration; YES for verification | Name at least **two distinct** relays in writing. Since DR-1, this is no longer procedural: a bundle attributed to one relay, or with duplicate relay identity, or with missing/malformed identity, is **refused**. Naming the same relay twice will not satisfy it. |
| Recording fetcher / recording Wikidata lookup / replay harness (section 13); "certenv with a fixture tenant" | **DR-2 DECIDED (option A) — wording kept; no certenv and no fixture tenant to build** | Engineering, for section 13; **nothing to provision for certenv** | Yes | No (engineering time) | Not for registration; YES before held-out execution | Build the section 13 recording and replay items. **Provision no certification environment and no fixture tenant** — DR-2 records that the phrase is procedural and that the frozen resolver clone with no `.env*` file satisfies it more strictly. Publish the supporting note in `DECISION_DISCLOSURES.md` section 2.4(b). |
| Funding satoshis for `O_dev`, `O_ho` and both commitment fees | **NOT ACQUIRED** | Key custodian | No | **Yes — H2** | Blocks section 5 | Acquire and transfer the coin **before** the outpoint step, so both funding outputs and both commitment transactions can be paid without a second acquisition round — and only after the aggregate is final. |

---

## 7. Arithmetic check

| Group | Leaves |
|---|---|
| Group 1 — already computed | 15 non-`parameters` leaves + **12** `parameters.*` = **27** |
| Group 1a — moved by DR-1/DR-10 | **1** (`tooling_aggregate_sha256`) |
| Group 2 — owner input | **5** |
| Group 3 — OSF-generated | **2** |
| Group 4 — Bitcoin activity | **4** |
| Group 5 — independent personnel | **0** |
| **Total** | **39** — matches `registrationTemplate()` exactly |

Non-`parameters` total: 15 + 1 + 5 + 2 + 4 = **27**. Matches.

**Blocker arithmetic:** 5 (group 2) + 2 (group 3) + 4 (group 4) = **11 unresolved leaves**, reported as
**9 blocker lines**, because `outpoints` and `checkpoint` are each one blocker covering two leaves.
`tooling_aggregate_sha256` is **not** a blocker line — it is ERROR-checked for form only — which is exactly
why it needs a separate discipline rather than the verifier's protection.

---

## 8. What changed in this table because of the three decisions

1. **`tooling_aggregate_sha256` left "already computed" for "provisional".** This is the only row DR-1 and
   DR-10 move, and it is the whole substance of the change. The verifier will not catch a wrong value here.
2. **`protocol_sha256` and `protocol_version` became final.** DR-2 = option (A) closes the only route by
   which either could have moved. Previously both were conditionally open.
3. **`parameters` is confirmed to stay at exactly 12 keys.** DR-1 is enforced in code, not registered as a
   parameter, so the exact-key-set check is unaffected.
4. **The certenv row in group 5 changed from "ENGINEERING; OPEN" to "nothing to provision".** It is now a
   disclosure obligation, not a build obligation.
5. **The drand-relay row changed from "OPEN — DR-1" to "DECIDED; relays not named".** The naming obligation
   became sharper: two *distinct* relays, because duplicate relay identity is now refused.
6. **Enumerator B gained an explicit row in group 5** — and still adds **no** registration field.

## 9. Prohibitions honoured

No registration, no OSF submission, no Bitcoin activity, no fabricated external value or identity, no
protocol or instrument edit (the instrument was read read-only from `C:/tmp/dt002`), no commit, push or pull
request, no network, no credentials, no real frame, no U1 execution.
