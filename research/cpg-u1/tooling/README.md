# CPG U1 dataset tooling — v5 (CPG-044 execution harness)

Governed by **`CPG_U1_PROTOCOL_004.md`** (supersedes protocol-003). Where the tooling and the protocol disagree, the protocol
wins and the tooling is defective. Every constant in `lib/` and `rules/development_only_registry.json`
is protocol. (`rules/` and `templates/` carry a historical `governed_by: candidate-002` label; their
content is unchanged by protocol-003.)

**No company and no fact about any company appears here**, except the development-only registry,
which exists to keep the implementers' own CPG history **out** of held-out.

Status: **IMPLEMENTED · NOT REGISTERED · NOT FUNDED · NOT EXECUTED · NOT EVIDENCE.**

The tooling **creates no key, no transaction, no registration and no seed input.** It verifies public
evidence and derives each stage's seed internally from a Bitcoin single-use commitment, a block hash
and a drand round that no caller can choose.

---

## Who does what

| Role | Does | Must never |
|---|---|---|
| **Accountable identity** (OSF) | Owns the one public, unembargoed OSF registration | Register a second, different record for `CPG-U1-2026-01` |
| **Study operator** (= Bitcoin wallet-key custodian) | Creates the two P2WPKH funding outputs; spends each exactly once with the commitment `OP_RETURN`; runs the commands | Choose or influence randomness; see reference truth before execution completes; rate |
| **Enumerator** | Builds the frame from public registry-anchored sources; answers every attestation `yes`/`no`/`unknown` | Have built CPG; run CPG; see CPG output |
| **Author** / **Confirmer** | Each writes a **blind** record for every drawn company × field | See CPG output; see each other's record before submitting |
| **Reference adjudicator** | Resolves Author/Confirmer disagreements only | Be Author, Confirmer or operator; introduce a value |
| **Raters** (≥ 2) + **rater adjudicator** | Label held-out observations (protocol §12) | Hold any role above |

The seed custodian role no longer exists.

## Pipeline

```
 0  registration-fields            template; identities / outpoints / checkpoint UNASSIGNED
 1  check-funding-prerequisites    BLOCKED (exit 4) until the key custodian is named
    [external] fund O_dev, O_ho (P2WPKH, ≥ 6 confirmations); choose checkpoint
    [external] public OSF registration → registration_id, registration_timestamp
 2  verify-registration            complete, public, unembargoed, authoritative, hashes match
 3  frame / scan                   F₁                                          (§5.1–5.4)
 4  commitment-payload --stage development      → digest + exact OP_RETURN script
    [external] spend O_dev once with that OP_RETURN
 5  verify-sampling --stage development          FINAL at H_commit+12, depth 6, drand R
 6  draw-development               seed recomputed internally                    (§5.8)
 7  [operator] pilot + instrument check;  size;  pool-check            (NO frame extension: the frame is frozen)
 8  commitment-payload --stage held-out          SAME frame, scan and registered registry; binds dev commitment, manifest, pilot, sizing
    [external] spend O_ho once
 9  verify-sampling --stage held-out;  draw-held-out
10  reconcile;  seal
```

### Protocol-004 additions

```
 3a check-frame-sufficiency   BEFORE the development commitment: eligible admissible rows ≥ 126 / 52 / 32
                              (derived from the sizing rule over all 4096 pilot outcomes; commitment-payload refuses otherwise)
 9a [after seal] reference-adjudication-packet → (blind RECORD_1/RECORD_2 decisions) → resolve-reference-adjudication
 9b check-personnel           seven independent roles, mutually exclusive, operator in none, §4A declarations
10a authorize-execution       bound to the sealed manifests, frame and the published seal record (window opens at its registry timestamp)
10b rater-order / verify-rater-order   presentation order derived from the sealed held-out sampling record (no seed)
10c audit-execution-log       VOID on preview, unauthorized, repeated or post-window execution IN THE SUPPLIED LOG
```

### CPG-044 execution harness (no methodology change)

```
 7' harness-pilot             CPG over development companies only, through the frozen resolver (harness/cpgAdapter.ts);
                              every response archived (lib/archive.mjs); pilot-result derives the pilot file from the archive
10d harness-held-out          the single authorized run; refuses unless registration, authority, protocol, tooling, registry,
                              frame, scan, resolver commit + clean tree, provider configuration, both commitments FINAL,
                              sampling records, seal, publication and authorization all verify; then window, no restart,
                              no repeat, exact authorized set
10e harness-close-interrupted closes a started run without executing; unexecuted companies are INVALID (no resumption)
10f verify-event-log          hash-chained event log (lib/eventlog.mjs); optional derived audit against the authorization
10g verify-archive-record / replay-archive / archive-merkle-root   archive integrity; deterministic replay; RFC 6962 root over document hashes
11a evaluation-items          evaluation items from the held-out archive; cited URLs by §12.3 Rule A (field evidence URL union)
11b rater-packet / verify-rater-packet       deterministic, byte-identical rater packets (§12, §12.1)
```

Every harness attempt appends one event: `AUTHORIZED_EXECUTION` / `PILOT_EXECUTION` for executions, and one of
`EXECUTION_REFUSED`, `PREVIEW_ATTEMPT`, `REPEATED_EXECUTION`, `POST_WINDOW_EXECUTION`, `MALFORMED_EXECUTION`,
`VERIFICATION_FAILURE` for refusals (with a code). The registration now carries `as_of` and
`provider_configuration_sha256` (§7, §13.1, §19.1), and the authorization binds both. `CPG_U1_HARNESS_NOW` and
`--synthetic-executor` are test switches refused outside a `synthetic-test` registration.

## Commands

```bash
REG="--registration reg.json --identity-registrations identity_regs.json --protocol CPG_U1_PROTOCOL_003.md"
node cpg_u1_data.mjs registration-fields --protocol CPG_U1_PROTOCOL_003.md --registry rules/development_only_registry.json --out reg.json
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
node cpg_u1_data.mjs verify-protocol --protocol CPG_U1_PROTOCOL_003.md [--registration reg.json]
node cpg_u1_data.mjs verify-registration $REG --registry rules/development_only_registry.json [--evidence ev.json]
node cpg_u1_data.mjs verify-archive --network bitcoin-mainnet --checkpoint-height N --checkpoint-hash H --archive a.json --crosscheck b.json
node cpg_u1_data.mjs frame --frame F.csv
node cpg_u1_data.mjs scan  --frame F.csv --repo <clean clone> --expect-sha <resolver SHA> --registry rules/development_only_registry.json --out scan.json
node cpg_u1_data.mjs commitment-payload --stage development $REG --frame F1.csv --scan scan1.json --registry … --out payload_dev.json
node cpg_u1_data.mjs verify-commitment | verify-sampling | derive-seed $REG --evidence ev.json --stage development|held-out [--prior-final prior.json]
node cpg_u1_data.mjs draw-development $REG --frame F1.csv --scan scan1.json --registry … --evidence ev.json --screened-by <pseudonym> --out dev/
node cpg_u1_data.mjs size --dev-manifest dev/manifest.json --pilot pilot.json --out sizing.json
node cpg_u1_data.mjs pool-check --frame F2.csv --scan scan2.json --registry … --dev-manifest dev/manifest.json --sizing sizing.json
node cpg_u1_data.mjs commitment-payload --stage held-out $REG --frame F2.csv --scan scan2.json --registry … --dev-manifest dev/manifest.json --sizing sizing.json --evidence ev.json --out payload_ho.json
node cpg_u1_data.mjs draw-held-out $REG --frame F2.csv --scan scan2.json --registry … --dev-manifest dev/manifest.json --sizing sizing.json --evidence ev.json --screened-by <pseudonym> --out ho/
node cpg_u1_data.mjs reconcile --dev-manifest dev/manifest.json --held-out-manifest ho/manifest.json --author a.csv --confirmer c.csv [--adjudication j.csv] --out reference.csv
node cpg_u1_data.mjs seal --dev-dir dev --held-out-dir ho --sizing sizing.json --author a.csv --confirmer c.csv [--adjudication j.csv] --reference reference.csv --out SEAL.json
```

**Exit codes:** `0` ok · `1` refused / abort (rule violated, hash mismatch, bad evidence) · `2` pool below minimum · `3` HALT (zero pilot yield) · `4` BLOCKED (named human prerequisite missing) · `5` WAITING / NOT_STARTED · `6` VOID / ABANDONED.

All outputs are write-once. A refused command writes nothing. There is **no `--seed` argument**.

### Evidence bundle (`cpg-u1-sampling-evidence/v1`)

```
{ schema, network,
  headers:            { source, start_height (retarget boundary ≤ checkpoint), headers_hex[] },
  headers_crosscheck: { source (different), start_height, headers_hex[] },
  funding:     { development: {tx_hex, height, merkle_branch, merkle_pos}, "held-out": {…} },
  commitments: { development: {payload, tx_hex, height, merkle_branch, merkle_pos} | null, "held-out": … | null },
  drand:       { chain_info, beacons: [{round, signature, randomness}] } }
```

Only blocks both sources agree on count. The drand round is computed, never read from the bundle.

## What the tooling enforces (additions in v4)

| Rule | Protocol-004 § | Where |
|---|---|---|
| Frame sufficiency before the development commitment; committed insufficient frame → VOID | 5.7.2 | `lib/frame.mjs`, `commitment-payload`, `draw-development` |
| Held-out frame, scan and registry equal the development / registered ones (CLI refusal and chain-level VOID) | 5.5, 5.3 | `heldOutInputs`, `evaluateStage` |
| Rater order and blind-position assignment derived from the sealed held-out record | 12.1 | `lib/raterOrder.mjs`, `rater-order`, `verify-rater-order` |
| Adjudication packets built deterministically; forbidden information refused | 9.2.1, 12.2 | `lib/packets.mjs` |
| Seven-role mutual exclusion; §4A declarations | 4A | `lib/personnel.mjs`, `check-personnel` |
| Execution authorization and log audit | 6.5 | `lib/execution.mjs`, `authorize-execution`, `audit-execution-log` |
| (v5) Authorization binds study, registration, protocol, tooling, registry, scan, frame, asOf, provider configuration, both commitments and randomness | 6.5, 19.1 | `buildAuthorization` |
| (v5) Fail-closed execution harness with auditable event per attempt | 6.3, 6.5, 7, 11 | `lib/harness.mjs`, `lib/eventlog.mjs`, `harness-*` |
| (v5) Response archive with replay | 13.1 | `lib/archive.mjs`, `harness/cpgAdapter.ts`, `lib/cpgExecutor.mjs` |
| (v5) Deterministic rater packets | 12, 12.1 | `lib/raterPackets.mjs`, `rater-packet`, `verify-rater-packet` |
| (v5.1) Cited source URLs = ordered, deduplicated field evidence `sourceUrl` set, all records, no post-hoc selection | 12.3 | `extractCitedUrls`, `evaluation-items` |

## What the tooling enforces (additions in v3)

| Rule | Protocol § | Where |
|---|---|---|
| Registration complete, OSF, public, no embargo; identities never invented (UNASSIGNED → exit 4) | 5.2 | `lib/registration.mjs`, `registered()` |
| Earliest registration authoritative; differing duplicate or withdrawal → VOID | 5.2 | `checkAuthority` |
| Protocol and tooling aggregate equal the registered hashes | 5.2, 4 | `registered()`, `lib/aggregate.mjs` |
| Headers: PoW, powLimit, linkage, MTP rule, nBits continuity, recomputed retargets, boundary start, checkpoint, two agreeing sources | 5.5 | `lib/bitcoin.mjs`, `loadChains` |
| Funding: registered outpoints are P2WPKH outputs with ≥ 6 confirmations at the checkpoint | 5.3 | `evaluateStage` |
| Commitment: spends the slot, after the checkpoint, not the other slot, ≥ 6 confirmations, exactly one exact `OP_RETURN`, stage byte, digest, payload bindings | 5.3–5.4 | `evaluateStage`, `decodeCommitment`, `checkPayload` |
| Held-out: after development finality; bound to development txid/digest/manifest/pilot/sizing/append-only proof | 5.4 | `evaluateStage`, `draw-held-out` |
| `H_rand = H_commit + 12`; final at `H_rand + 6`; `R` = first drand round ≥ `MTP(H_rand + 6) + 3 h` | 5.5–5.6 | `lib/sampling.mjs`, `lib/drand.mjs` |
| drand BLS (`bls-unchained-g1-rfc9380`) against the pinned quicknet chain; randomness = sha256(signature) | 5.6 | `lib/drand.mjs` |
| 180-day abandonment; 30-day missing-round VOID; post-finality reorganisation VOID | 5.8 | `evaluateStage` |
| Seed derived internally; only its fingerprint is recorded or printed; rank key unchanged | 5.7 | `deriveSeed`, `draw-*`, `lib/select.mjs` |

Unchanged from v2: tri-state attestations, identifiers, contamination scan and registry, append-only
frames, exact development quota, sizing and HALT, pool rule, round-robin rank order, blind double entry,
seal.

## What the tooling cannot verify

- **That no private CPG query happened.** `audit-execution-log` audits the log it is given; queries never logged, or logs altered, are invisible. The protocol treats preview prevention as procedural with audit evidence, not as a guarantee.
- **That personnel declarations are true**, or that pseudonymous IDs denote distinct real people.
- **That people received only the verified packets.** Packets are checked; other communication is procedural.
- **CPG queries outside the harness.** The harness refuses and logs what passes through it; it cannot see or prove the absence of queries made any other way.
- **A truncated or wholly substituted event log.** Interior edits, deletions and reordering break the hash chain; removing the tail or replacing the whole file does not. The head hash must be published (procedural).
- **Bytes below undici.** Response bodies are recorded as undici delivers them to its consumer (before fetch's content decoding), with headers and timestamps, from undici's diagnostics channels; TLS records and socket bytes are not recorded. Replay uses the fetcher-level exchanges.
- **Resolver behaviour under the pinned environment.** The adapter runs with operating-system variables only plus `CACHE_KILL_ALL=1`; every other resolver setting is its code default at the frozen SHA. The environment is recorded in each archive record.
- **The execute mode of the adapter against the live network** is not exercised by any test (no network use is authorized); recording, replay and header capture are tested offline against the frozen resolver (`test/adapter_conformance.mjs`).


- That an entity is real (A1), controls its domain (A2), or that the identifier belongs to it (A4).
- That an attestation is truthful, the development-only registry complete, or people in different roles independent.
- **The OSF record itself.** The tooling checks the supplied registration JSON and identity-registration list; an outsider must confirm both on OSF (persistent identifier, registry timestamp, public, unembargoed, full identity listing).
- **That an outpoint is unspent.** Non-spend is not provable from headers; `NOT_STARTED` / `STUDY_ABANDONED` hold "per supplied evidence" and must be confirmed with a full node.
- **That the chain is the most-work chain.** Two agreeing sources and proof of work are checked; source independence is not.
- **That a missing drand round is truly unavailable.** Absence from a bundle is not proof; fetch from ≥ 2 relays before accepting `STUDY_VOID_RANDOMNESS_UNAVAILABLE`.
- Study-level grinding under **other** identities (protocol limitation).

---

## Reproducibility

| Requirement | Value |
|---|---|
| Runtime | Node **v22.17.0** |
| External binary | **git** (`scan` and the self-test detector) |
| Line endings | **LF**; preserve bytes exactly |
| Resolver clone | **`CPG_U1_RESOLVER_CLONE`** = clean clone at `f01a7eb4199be4e04d4fee7fc0116303949dc553` (required by self-test and mutation run) |
| Vendored dependency | `node_modules/@noble/curves` **1.9.7** and `node_modules/@noble/hashes` **1.8.0**, byte-identical to the npm tarballs (integrity recorded in CPG041_VERIFICATION_REPORT.md). No install step; nothing is fetched |
| Fixtures | `test/fixtures/bitcoin` (mainnet blocks 836640, 838655–838656, 839989–840012; block 840000 txids, transactions, Merkle proof) and `test/fixtures/drand` (quicknet chain info, rounds 1, 1000000, 12345678); provenance in `test/fixtures/PROVENANCE.json` |
| Aggregate | sha256 of `"<sha256>  <path>\n"` lines over every file of this tree, sorted by path |
| Dates | `screened_at` and `sealed_on` are execution metadata (UTC date) |
| Randomness | None supplied by any person: chain + drand only |
| Adapter clone (v5) | `CPG_U1_ADAPTER_CLONE` / `CPG_U1_RESOLVER_CLONE` for `adapter_conformance.mjs` and the harness: a clone at the frozen SHA with its lockfile dependencies installed (`npm ci --ignore-scripts`), no `.env*` files |

## Verification

```bash
export CPG_U1_RESOLVER_CLONE=<clean clone at f01a7eb4>   # required
node test/selftest.mjs            # synthetic data + historical mainnet/drand fixtures + detector check
CPG_U1_ADAPTER_CLONE=<clone at f01a7eb4 with installed dependencies> node test/mutate.mjs --jobs 4   # each mutation disables one guard in a throwaway copy; adapter mutants also run adapter conformance — all must be killed
CPG_U1_RESOLVER_CLONE=<clone at f01a7eb4 with its dependencies installed> node test/adapter_conformance.mjs   # real resolver, offline
```
