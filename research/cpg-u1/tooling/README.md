# CPG U1 dataset tooling — v6 (`cpg-u1-data-tooling-6`: executable end to end, DEEPTECH-PARALLEL-002)

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
| **Raters** (≥ 2) + **rating adjudicator** | Label held-out observations (protocol §12); the adjudicator decides disagreements blind (Label A/B) | Hold any role above |

The seed custodian role no longer exists.

## Pipeline

```
 0  registration-fields            template; identities / outpoints / checkpoint UNASSIGNED
 1  check-funding-prerequisites    BLOCKED (exit 4) until the key custodian is named
    [external] fund O_dev, O_ho (P2WPKH, ≥ 6 confirmations); choose checkpoint
    [external] public OSF registration → registration_id, registration_timestamp
 2  verify-registration            record complete and well-formed; --protocol, this tooling and --registry hash to
                                   the values the record registers; EARLIEST entry in the SUPPLIED
                                   --identity-registrations list. R28: it does NOT establish public, unembargoed,
                                   registry authority or any identity - it prints those under "NOT ESTABLISHED by
                                   this verifier:" (see "What the tooling cannot verify")
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
 9a [BEFORE seal] reference-adjudication-packet → (blind RECORD_1/RECORD_2 decisions) → resolve-reference-adjudication → reconcile → seal
                              (v6: built from the drawn manifests, not from a seal; `seal` rebuilds the packet and binds it — see v6 below)
 9b check-personnel           seven independent roles, mutually exclusive, operator in none, §4A declarations
 3b frame --personnel        every enumerated row names an eligible REGISTERED enumerator (§4A.2); enumerator slots are distinct people
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
                              (v6: a sealed, complete evaluation artifact with an explicit machine state per observation — see v6 below)
11b rater-packet / verify-rater-packet       deterministic, byte-identical rater packets (§12, §12.1)
```

Every harness attempt appends one event: `AUTHORIZED_EXECUTION` / `PILOT_EXECUTION` for executions, and one of
`EXECUTION_REFUSED`, `PREVIEW_ATTEMPT`, `REPEATED_EXECUTION`, `POST_WINDOW_EXECUTION`, `MALFORMED_EXECUTION`,
`VERIFICATION_FAILURE` for refusals (with a code). The registration now carries `as_of` and
`provider_configuration_sha256` (§7, §13.1, §19.1), and the authorization binds both. `CPG_U1_HARNESS_NOW` and
`--synthetic-executor` are test switches refused outside a `synthetic-test` registration.

### v6 (DEEPTECH-PARALLEL-002): blind adjudication before the seal, sealed evaluation, rating intake, analysis

```
 4a sampling-evidence-bundle  assemble cpg-u1-sampling-evidence/v1 from separately obtained local files (two header archives,
                              funding/commitment transactions + Merkle proofs, committed payloads, drand chain info + relay
                              beacons); fetches nothing; written only if it verifies (states printed, no seed). Each beacon file
                              must name its relay, and every round must come from ≥ 2 differently named relays (§19.3)
 8a rater-assignment-fingerprint   person→label assignment (rater-1, rater-2, rating-adjudicator) checked against the personnel
                              register; publish the fingerprint BEFORE the held-out commitment (§4A.3); verify-rater-assignment
 9a reference-adjudication-packet (held-out + development manifests; no seal) → [blind decisions] → resolve-reference-adjudication
    → reconcile → seal --reference-packet P --blind-decisions D     (seal refuses disagreements not decided blind on the packet)
11a evaluation-items          seal + authorization + event log + authorised run archive + reference → cpg-u1-evaluation/v1:
                              every held-out company × field exactly once, machine_state SCORABLE | INVALID (+ reason);
                              verify-evaluation rebuilds it byte-for-byte
11b rater-packet / verify-rater-packet   from the sealed evaluation only; the packet binds seal_hash and evaluation_sha256
12a ingest-ratings            one CSV per rater → cpg-u1-rater-sheet/v1 (label or "pending"; §10.2 sub-reasons; rated by the
                              assigned person)
12b rating-adjudication-packet / verify-adjudication-packet --type rating / resolve-rating-adjudication
                              disagreements only (pending never), Label A/B blind; LABEL_A | LABEL_B | REFERENCE-AMBIGUOUS
13  analyze                   dispositions, G1/P1/P2/P3/R1, α, SOURCE-COINCIDENT, REFERENCE-STALE, §15.5 conditions, one
                              §10.5 outcome, diagnostics, exclusion table → cpg-u1-results/v1.  BLOCKED (exit 4) while any
                              decision in rules/analysis_decisions.json is UNDECIDED
```

**Methodological decisions (`rules/analysis_decisions.json`).** Protocol-004 leaves nine values undefined (α population and
undefined α; "same document" for SOURCE-COINCIDENT; which registry unavailability counts; 24-month arithmetic and scope of
REFERENCE-STALE; INCONCLUSIVE-vs-VOID for a declared protocol violation; undefined AR; basis of the abstention split). They are
listed there with their permitted options and all set `UNDECIDED`. The file is part of the tooling aggregate, so the values
chosen are frozen by registration; `analyze` refuses to run until every value is decided. A different decisions file
(`--decisions`) is accepted only with `--allow-synthetic` and this study's `synthetic-test` registration.

## Commands

```bash
REG="--registration reg.json --identity-registrations identity_regs.json --protocol CPG_U1_PROTOCOL_004.md"
node cpg_u1_data.mjs registration-fields --protocol CPG_U1_PROTOCOL_004.md --registry rules/development_only_registry.json --out reg.json
node cpg_u1_data.mjs check-funding-prerequisites --registration reg.json
node cpg_u1_data.mjs verify-protocol --protocol CPG_U1_PROTOCOL_004.md [--registration reg.json]
node cpg_u1_data.mjs verify-registration $REG --registry rules/development_only_registry.json [--evidence ev.json]
node cpg_u1_data.mjs verify-archive --network bitcoin-mainnet --checkpoint-height N --checkpoint-hash H --archive a.json --crosscheck b.json
node cpg_u1_data.mjs frame --frame F.csv --personnel personnel.json   # every row's enumerated_by must be an eligible enumerator in the register
node cpg_u1_data.mjs scan  --frame F.csv --repo <clean clone> --expect-sha <resolver SHA> --registry rules/development_only_registry.json --out scan.json
node cpg_u1_data.mjs commitment-payload --stage development $REG --frame F1.csv --scan scan1.json --registry … --out payload_dev.json
node cpg_u1_data.mjs verify-commitment | verify-sampling | derive-seed $REG --evidence ev.json --stage development|held-out [--prior-final prior.json]
node cpg_u1_data.mjs draw-development $REG --frame F1.csv --scan scan1.json --registry … --evidence ev.json --screened-by <pseudonym> --out dev/
node cpg_u1_data.mjs size --dev-manifest dev/manifest.json --pilot pilot.json --out sizing.json
node cpg_u1_data.mjs pool-check --frame F2.csv --scan scan2.json --registry … --dev-manifest dev/manifest.json --sizing sizing.json
node cpg_u1_data.mjs commitment-payload --stage held-out $REG --frame F2.csv --scan scan2.json --registry … --dev-manifest dev/manifest.json --sizing sizing.json --evidence ev.json --out payload_ho.json
node cpg_u1_data.mjs draw-held-out $REG --frame F2.csv --scan scan2.json --registry … --dev-manifest dev/manifest.json --sizing sizing.json --evidence ev.json --screened-by <pseudonym> --out ho/
node cpg_u1_data.mjs sampling-evidence-bundle $REG --headers a.json --headers-crosscheck b.json --funding-development fd.json --funding-held-out fh.json \
     [--commitment-development cd.json --payload-development payload_dev.json] [--commitment-held-out ch.json --payload-held-out payload_ho.json] \
     --drand-chain-info info.json [--drand-beacons relayA_Rdev.json,relayB_Rdev.json,relayA_Rho.json,relayB_Rho.json] --out ev.json
     # one --drand-beacons file = one relay's response for one round, and each file must carry "relay": "<the relay it came from>".
     # §19.3 / §21 step 5: every round must be supplied by at least two DIFFERENTLY NAMED relays; the same relay twice is refused,
     # as is a missing, empty or whitespace-padded relay name. File count is not relay count.
node cpg_u1_data.mjs rater-assignment-fingerprint --assignment assignment.json --personnel personnel.json
node cpg_u1_data.mjs verify-rater-assignment --assignment assignment.json --fingerprint <published fingerprint>
DRAWN="--dev-manifest dev/manifest.json --held-out-manifest ho/manifest.json --author a.csv --confirmer c.csv"
node cpg_u1_data.mjs reference-adjudication-packet $DRAWN --out ref_packet.json
node cpg_u1_data.mjs verify-adjudication-packet --type reference $DRAWN --packet ref_packet.json [--seal SEAL.json]
node cpg_u1_data.mjs resolve-reference-adjudication --dev-manifest dev/manifest.json --held-out-manifest ho/manifest.json --decisions blind.csv --out j.csv
node cpg_u1_data.mjs reconcile $DRAWN [--adjudication j.csv] --out reference.csv
node cpg_u1_data.mjs seal --dev-dir dev --held-out-dir ho --sizing sizing.json --author a.csv --confirmer c.csv [--adjudication j.csv \
     --reference-packet ref_packet.json --blind-decisions blind.csv] --reference reference.csv --out SEAL.json
EV="--seal SEAL.json --held-out-manifest ho/manifest.json --authorization auth.json --log events.jsonl --reference reference.csv --archive-dir archive/<run_id>"
node cpg_u1_data.mjs evaluation-items $EV --out evaluation.json
node cpg_u1_data.mjs verify-evaluation $EV --evaluation evaluation.json
SEALED="--seal SEAL.json --held-out-manifest ho/manifest.json --evaluation evaluation.json"
node cpg_u1_data.mjs rater-packet $SEALED --label rater-1|rater-2 --out packet.json
node cpg_u1_data.mjs ingest-ratings $SEALED --label rater-1 --packet packet_r1.json --assignment assignment.json --assignment-fingerprint <fp> --labels r1.csv --out sheet_r1.json
RATED="$SEALED --assignment assignment.json --assignment-fingerprint <fp> --sheet-1 sheet_r1.json --sheet-2 sheet_r2.json"
node cpg_u1_data.mjs rating-adjudication-packet $RATED --out rating_packet.json
node cpg_u1_data.mjs resolve-rating-adjudication $RATED --packet rating_packet.json --decisions rating_decisions.csv --out rating_resolution.json
node cpg_u1_data.mjs analyze $RATED [--rating-resolution rating_resolution.json] --authorization auth.json --log events.jsonl \
     --seal-publication seal_publication.json --declarations declarations.json --out results.json
```

Rating CSV columns: `candidate_id, field, label, sub_reason, rated_by, rated_at` (label ∈ the seven §12 labels or `pending`;
sub_reason ∈ `` | `CURRENCY_NOT_STATED` (UNSUPPORTED-FILL, revenue_range) | `STALE_VALUE` (INCORRECT-FILL, employee_count /
revenue_range)). Decision CSVs use the adjudication template columns. Declarations: `{schema: cpg-u1-analysis-declarations/v1,
seal_hash, protocol_violations: [{description, discovered_at}], identity_inadmissible: [{candidate_id, basis}]}` — what the
tooling cannot discover itself, stated explicitly (empty arrays when none).

**Exit codes:** `0` ok · `1` refused / abort (rule violated, hash mismatch, bad evidence) · `2` pool below minimum · `3` HALT (zero pilot yield) · `4` BLOCKED (named human prerequisite missing) · `5` WAITING / NOT_STARTED · `6` VOID / ABANDONED.

All outputs are write-once. A refused command writes nothing. There is **no `--seed` argument**.

### Evidence bundle (`cpg-u1-sampling-evidence/v1`)

```
{ schema, network,
  headers:            { source, start_height (retarget boundary ≤ checkpoint), headers_hex[] },
  headers_crosscheck: { source (different), start_height, headers_hex[] },
  funding:     { development: {tx_hex, height, merkle_branch, merkle_pos}, "held-out": {…} },
  commitments: { development: {payload, tx_hex, height, merkle_branch, merkle_pos} | null, "held-out": … | null },
  drand:       { chain_info, beacons: [{round, signature, randomness, relays: [name, …] (≥ 2, distinct, sorted)}] } }
```

Only blocks both sources agree on count. The drand round is computed, never read from the bundle. `sampling-evidence-bundle`
assembles this document from its parts and writes it only if `evaluateStage` accepts it. Each beacon records the sorted set of
relays that attested that round (§19.3, §21 step 5): two relays reporting the same round collapse to one entry that names both,
a round attested by fewer than two differently named relays is refused, and `verify-sampling` names the relays in its result. The
attribution does not enter the seed or the sampling record — the §5.7 derivation and `record_sha256` are unchanged.

## What the tooling enforces (additions in v6)

| Rule | Protocol-004 § | Where |
|---|---|---|
| Reference adjudication before the seal; seal requires the deterministic blind packet and RECORD_1/2 decisions and binds both; an adjudication not derived from them is refused | 9.2.1, 9.6 | `reference-adjudication-packet`, `blindReferenceAdjudication`, `seal` |
| Evaluation bound to seal, authorisation, frame, treatment (resolver SHA, provider configuration, asOf), event-log head, archive Merkle root; every held-out company × field exactly once; dropped, duplicated, substituted, re-attributed or foreign records refused | 12, 13.1, 15.2 | `lib/evaluation.mjs`, `evaluation-items`, `verify-evaluation` |
| Explicit INVALID observations (no response / harness error / unexecuted after interruption); a response lacking the protocol shape is refused, never read as an abstention | 10.1, 12.3, 15.2 | `readResponse`, `buildEvaluation`, `analyze` |
| Rater packets only from the sealed evaluation, bound to seal and evaluation | 12, 12.1 | `buildRaterPacket`, `sealedEvaluation` |
| Person→label assignment fingerprint (distinct persons, matches the personnel register, 256-bit nonce) | 4A.3, 12.1 | `lib/assignment.mjs` |
| Enumeration attribution: every frame row names an enumerator the personnel register holds as eligible; unregistered, wrong-role or missing ids refused; enumerator slots are distinct people; `enumerated_by` is a frame column and therefore inside `frame_hash` | 4A.2, 4A.3, 20.18 | `lib/enumeration.mjs`, `frame` |
| Rating intake: exact coverage of the rater's packet, known labels, §10.2 sub-reasons, §10.1 first branch, assigned rater, pending explicit | 10.1, 10.2, 12 | `lib/ratings.mjs`, `ingest-ratings` |
| Rating adjudication: disagreements only (pending never), Label A/B blind, three decisions, assigned adjudicator ≠ raters | 12.2 | `rating-adjudication-packet`, `resolve-rating-adjudication` |
| Endpoints, α, dispositions, §15.5 conditions and outcome computed with exact integer thresholds; undefined values are recorded decisions, never tooling choices | 9.8, 10.2–10.5, 12, 15 | `lib/analysis.mjs`, `rules/analysis_decisions.json`, `analyze` |
| Sampling-evidence bundle assembled offline and verified before it is written | 13.2A, 21 | `lib/evidenceBundle.mjs`, `sampling-evidence-bundle` |

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
- **When the rater-assignment fingerprint was published.** The tooling checks that the assignment matches the fingerprint supplied; that it was published before the held-out commitment is the publication record's timestamp.
- **That the declarations are complete.** Identity inadmissibility found after the draw and mid-run protocol violations are human declarations; `analyze` requires the file and applies it, but cannot discover what was not declared.
- **Anything beyond Rule A for S1/S5.** Company-level identity correctness (S1) and evidence-support depth (S5) are reported as not computed.
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
- **That a missing drand round is truly unavailable.** Absence from a bundle is not proof; fetch from ≥ 2 relays before accepting `STUDY_VOID_RANDOMNESS_UNAVAILABLE`. The ≥ 2-relay floor applies to a round the bundle *carries*; it cannot compel an operator to supply a beacon they claim not to have (§20.17).
- **That the named relays are genuinely independent operators.** The bundle records the names the fetcher supplied and refuses fewer than two distinct ones; that two names are two organisations is the operator's attestation, as with the two header sources.
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
