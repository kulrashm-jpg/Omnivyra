# CPG-U1 — REGISTRATION DEPENDENCY MAP

**DEEPTECH-PARALLEL-010, STREAM F. CLASSIFICATION: PREPARATION.** Nothing registered, submitted, published,
broadcast, committed or pushed. No value invented; every unresolved leaf is left visibly unresolved.

Three relationships, and the whole point of separating them is that they fail in different ways:

| Relationship | Meaning | Failure mode if got wrong |
|---|---|---|
| **BEFORE** | Must be final at the moment of registration. Registration binds it by reference or by digest | **Unrepairable.** A wrong value is inside the registration and the on-chain commitment; correcting it means a second registration, which `authority_rule` makes a **VOID** |
| **BOUND BY** | Its value is created *by* the act of registration, or is completed only once registration returns | Cannot be prepared. Attempting to pre-fill means inventing an external value |
| **AFTER** | Produced downstream of registration, gated on it | Sequencing error. Doing it early is a preview, a contamination, or a wasted custodian act |

---

## 1. MUST BE FINAL **BEFORE** REGISTRATION

### 1.1 Hashed identities bound into the registration record (and, for three of them, into the on-chain commitment digest)

| Object | Value | State |
|---|---|---|
| `protocol_sha256` | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | **FINAL.** DR-2 = option (A) keeps the certenv wording, which closed the only route by which it could move. `protocol_version` `CPG_U1_PROTOCOL_004` is final with it |
| `registry_sha256` (development-only registry) | `a1392952627145d049edf82912f410355bc25ce5b087bfdddc30cc91e2a70814` | **FINAL.** Append-only and frozen. Do not add a 14th entry after this hash is registered |
| `tooling_aggregate_sha256` | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files) — **PROVISIONAL** | **NOT FINAL.** The single hardest gate in the whole registration |
| `provider_configuration_sha256` | `c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561` | **FINAL and filled.** Machine-computed (`ERRATA.md` E-2 reclassified it H1 -> H0). Do not edit either provider file in the clone |
| Evaluated software identity (three values, published but not registration keys): commit `f01a7eb4199be4e04d4fee7fc0116303949dc553`, tree `3b4811fc88e9fbb64ee42c37c4aacca2e76c67af`, content aggregate `ffe4f6035333e2ec963d02ccfc0cff39bb28b27ebb3600d56b42bb94c601d1c5` (11552 files) | as listed | **FINAL.** Chosen before frame construction, frozen at registration, never advanced to track mainline |

**`protocol_sha256`, `tooling_aggregate_sha256` and `registry_sha256` are in `SAMPLING_FIELDS`**
(`lib/registration.mjs:119`) — the only fields `checkAuthority()` compares across registrations. A second
registration differing in any of them yields
`duplicate registration <id> names different sampling fields — study VOID`.

### 1.2 The five conditions that make the tooling aggregate final — in order, none skippable

```
1  merge the three isolated implementation trees        DONE (C:/tmp/dt009-merge/tooling, 7 paths changed, 594 files)
2  full re-verification of the merged tree              PARTIAL
      selftest green                                      running / expected 1082
      anchors 404/404 each exactly once                   VERIFIED
      FULL MUTATION RUN, every mutant KILLED              NOT COMPLETE  <-- the 404-mutant suite now running
      adapter conformance                                 pending
      protocol verify / eval-tree verify / replay         pending
3  integrity gate — byte-identical before and after     protocol c50fc680… · treatment f01a7eb4… ·
                                                        eval tree 3b4811fc… · registry a1392952… ·
                                                        provider config c9a7e9aa…   (anything else = STOP)
4  two INDEPENDENT clean rebuilds agree                 2 rebuilds + the instrument's own toolingManifest()
                                                        all gave 638d68e6… — but condition 2 is not met,
                                                        so the value stays provisional
5  owner authorises THAT specific value                 NOT GIVEN
                                                        (no agent may promote a provisional value)
then  FREEZE — the instrument tree is never touched again, not for a typo or a lint fix
```

**Why the ordering is one-way and not merely tidy:** `lib/sampling.mjs:142` requires the committed payload's
`registration_id`, `protocol_sha256` and `tooling_aggregate_sha256` to equal the registration's, and the
payload's digest is what the OP_RETURN carries. `registered()` in `cpg_u1_data.mjs` recomputes
`toolingManifest(ROOT).aggregate` and aborts with `VERIFY_ABORT_HASH_MISMATCH` on any mismatch;
`lib/harness.mjs:44` refuses independently with `TOOLING_MISMATCH`. So after registration **no instrument
both differs from the registered aggregate and can run anything** — a post-registration patch produces an
instrument that refuses every command, and the only alternative is a re-registration, which is a VOID.

### 1.3 Owner decisions — five blocking leaves, all still unresolved

No agent may supply any of these and none is supplied anywhere.

| Leaf | Human dependency | Note |
|---|---|---|
| `accountable_identity.value` | **H3** — the independence is itself the evidence | Must be the same identity that files the registration; `checkAuthority` compares identities across the registration list |
| `persistent_identifier.type` | H2 | Verifier accepts any non-blank string, so the choice carries no machine-checkable meaning — state the scheme in the narrative too |
| `persistent_identifier.value` | H2 | Issued externally; lead time is days |
| `bitcoin_key_custodian.value` | **H3** | Name the operator **before** recruiting the independent people: the operator may hold no independent role, so naming late can force re-recruitment |
| `as_of` | H1 | One instant for the whole held-out run, frozen for the study. Not a clock reading — a methodological choice, with the reason written down |

### 1.4 Decided but still requiring an act before registration

| Item | State |
|---|---|
| DR-1 relay floor — **which** relays | **DECIDED (option B); relays NOT NAMED.** Post-DR-1 this is no longer procedural: one relay, duplicate relay identity, or missing/malformed identity is refused. Naming the same relay twice will not satisfy it |
| Two independent Bitcoin header sources (or an own node) | **NOT SELECTED.** A full node's initial block download takes days |
| DR-1 / DR-2 / DR-10 / DR-7 / DR-8 disclosure text | Drafted verbatim in `DECISION_DISCLOSURES.md`; **DR-7's clause needs the superseded aggregate omitted** before publication |
| Personnel roster closed | **NOT STARTED.** §4A.1 item 6 cannot be answered retrospectively, so Enumerator B must join the *original* roster — a late addition forces a second declaration round for everyone. 0 registration fields depend on personnel, but recruitment is the longest lead time in the study |

### 1.5 Bitcoin custodian acts — before registration, but strictly after the aggregate

Two blocker lines covering four leaves: `outpoints.development`, `outpoints['held-out']`,
`checkpoint.height`, `checkpoint.hash` — all `UNASSIGNED`. **No agent may perform any of this and none was
performed.**

```
tooling aggregate FINAL
  -> acquire coin
  -> fund O_dev and O_ho (may be two outputs of one transaction; two identical outpoints are an ERROR)
  -> wait >= 6 confirmations (D = 6)
  -> choose the checkpoint block at or after both confirmations
  -> cross-check its hash against two independent header sources
  -> only then submit
```

The aggregate sits inside the commitment digest, so **coin committed against a superseded aggregate is
wasted and both outputs must be recreated.** This is why funding is sequenced after the freeze, not beside
it.

---

## 2. BOUND **BY** REGISTRATION

| Object | Why it cannot exist earlier |
|---|---|
| `registration_id` | Issued by OSF Registries at submission. Must not contain `\|` — that character is the field separator inside the commitment payload, and the verifier refuses it |
| `registration_timestamp` | Issued by OSF. Do **not** substitute an own clock: `registrationEpoch()` turns this value into the study epoch, and `checkAuthority()` uses it as the authority tie-breaker |
| `dt004-operations/registration/registration_record.DRAFT.json` | Becomes the registered record only once the aggregate is substituted, the eleven `UNASSIGNED` leaves are filled and OSF returns the two values above. The record therefore completes in **two passes**. It currently fails `verify-registration` with exit **4** (`BLOCKED`) and 9 blocker lines |
| `dt004-operations/registration/registration_fields.TEMPLATE.json` | Same, as the shape `registrationTemplate()` emits. `REGISTRATION_PACKAGE.md` §6(1) requires the OSF submission to carry the record exactly as `registration-fields` produced it, so **no key may be added** |
| The OSF narrative (from `DECISION_DISCLOSURES.md`) | Free text submitted with the registration; fixed at the moment of submission |
| The identity's public registration listing | Created by the act; §13.2A archives it |

**The two-pass shape, stated once:** prepare the record with all computable fields -> submit -> paste back
`registration_id` and `registration_timestamp` -> only then can any commitment payload be constructed, because
`registration_id` is one of the three fields `lib/sampling.mjs:142` cross-checks.

---

## 3. PRODUCED **AFTER** REGISTRATION

Strictly serial. `dt005-orchestration/DAG.md` names this the evidence-bearing chain that is never
parallelised:

```
OSF registration
  -> registered frame (the single frozen frame F; development frame hash = held-out frame hash)
  -> contamination scan  -> frame sufficiency
  -> development commitment -> development randomness (R_dev) -> development draw
  -> pilot  (and the §8.5 instrument check: sources [], establishIdentity false, pass = ZERO fills;
             any fill HALTS the programme)
  -> held-out sizing
  -> held-out commitment -> held-out randomness (R_ho) -> held-out draw
  -> reference truth -> reference adjudication -> reference seal
  -> published seal record on OSF (registry-issued timestamp)
  -> EXECUTION AUTHORISATION  (cpg-u1-execution-authorization/v1, via authorize-execution)
  -> the SINGLE authorised held-out run        <-- the window opens here and closes when it completes
  -> blind rating -> rating adjudication
  -> analysis
```

| Object | Gate |
|---|---|
| The single frozen frame F, the scan, both manifests, both screening logs, sizing | Built on the **registered** frame; the frame is constructed after registration, by independent enumerators, per the slot partition |
| Both commitment payloads and raw transactions with Merkle proofs | Need `registration_id`, so strictly after registration |
| Both sampling records, drand rounds `R_dev` and `R_ho`, header ranges from a retarget boundary ≤ checkpoint to `H_rand_ho + 6` from two sources | After the respective commitment; Δ = 3 h, K = 12, 30-day expiry |
| The three blind-record files and the reconciled reference file; the dataset seal binding them | After the held-out draw |
| **Execution authorisation** | Binds the recomputed seal hash, both manifest hashes, the single frame hash and the **published seal record**. The window **opens** at that record's registry-issued timestamp, which must be later than the held-out drand round's scheduled time, and **closes** when the one run completes. **This artefact does not exist and no value for it exists** |
| Execution log (`cpg-u1-execution-log/v1`), recording-fetcher archive, `audit-execution-log` output, the operator's signed no-preview declaration, stored-lookup exports | Produced by and around the single authorised run. Mechanical audit flags `STUDY_VOID_PREVIEW`, `STUDY_VOID_UNAUTHORIZED_EXECUTION`, `STUDY_VOID_REPEATED_EXECUTION`, `STUDY_VOID_POST_WINDOW_EXECUTION` |
| Per-rater sheets, rater order artifacts, adjudication artifacts, exclusion table, results artifact | After the run; raters are blind |

**One ordering constraint that is easy to get backwards:** the **rater/adjudicator assignment fingerprint**
(§4A.3) must be published **before the held-out commitment transaction is broadcast** — that is *after*
registration but *before* the held-out commitment. Publishing it afterwards destroys the guarantee and there
is no repair.

**Engineering that must exist before held-out execution but depends on no registration field:** the recording
fetcher, the recording Wikidata lookup and the **replay harness** (§13.3 — "requires the replay harness to
exist before execution"). Per DR-2 = option (A) there is **no certenv and no fixture tenant to provision**;
the phrase is procedural and the frozen resolver clone with no `.env*` file satisfies it more strictly. This
is a disclosure obligation, not a build obligation.

---

## 4. NO REGISTRATION DEPENDENCY AT ALL

Inventoried for completeness; none of it gates or is gated by registration:

| Set | Files | Why |
|---|---|---|
| `dt004-operations/uncertainties/` (U4 / U8 / U9) | 60 | §16 freezes U4, U8 and U9 as **out of U1 scope**. A study of any of them is a different protocol and a different registration |
| `dt004-operations/security/` | 3 | Platform security follow-up. §7 puts the HTTP route's authentication, tenant authorisation and persisted-profile read out of U1 scope (established separately in CPG-025) |
| `dt004-operations/corporate/` | 4 | Corporate / DeepTech claim support and evidence-request matrices — not study artefacts |

---

## 5. THE CRITICAL PATH, AS ONE SENTENCE EACH

| Rank | What | Why it is the constraint |
|---|---|---|
| 1 | **The 404-mutant run on the merged candidate** | Nothing downstream of the aggregate can start until it finishes with zero survivors, timeouts and errors. It is the reason this stream ran no expensive compute |
| 2 | **Owner authorisation of the aggregate, then FREEZE** | No agent may promote a provisional value; after the freeze the tree is never touched again |
| 3 | **Recruitment of ≥ 7 mutually exclusive independent persons (8 with Enumerator B)** | Longest calendar lead time, gates **zero** registration fields, and gates **every** study stage. The roster must be closed before the declaration round |
| 4 | **The five owner decisions and the persistent-identifier issuance** | External issuance takes days |
| 5 | **Funding, confirmations (D = 6) and checkpoint selection** | Strictly after the aggregate is final, because coin committed against a superseded aggregate is wasted |
| 6 | **Two independent Bitcoin header sources / own node, and ≥ 2 named drand relays** | A node's initial block download takes days; DR-1 now refuses a single-relay bundle mechanically |
| 7 | **The correction pass over the superseded aggregate** | 158 files, of which 17 are executable pins that will refuse to run against the registered instrument. See `SUPERSEDED_VALUES.md` |

Items 3, 4 and 6 touch no hash and **should run in parallel with 1 and 2**, per
`PROVISIONAL_AGGREGATE_HANDLING.md` §6 and `OPERATOR_REGISTRATION_SEQUENCE.md` Stage 2.

---

## 6. WHAT THIS DOCUMENT DID NOT DO

No registration, no OSF submission, no publication. No OP_RETURN, no transaction, no Bitcoin activity of any
kind. No network, no credentials. No file modified anywhere outside this directory. No commit, push, pull
request or merge. No selftest, mutation run, clean rebuild or tree-aggregate recomputation. No worktree's own
`research/cpg-u1/tooling` read. No fabricated hash, identity or external value — the provisional aggregate is
named as provisional, and every value that does not yet exist is stated to not exist rather than given a
placeholder that looks like data. No real frame, no U1 execution.
