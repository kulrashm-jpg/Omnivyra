# EVIDENCE_SCHEMA closure — DEEPTECH-PARALLEL-011 identity stream (directive §8)

**Status: PREPARED — NOTHING APPLIED.** No file under `C:/tmp/dt009-merge` was written.
Candidate: `C:/tmp/dt009-merge/tooling`, 594 files, aggregate `638d68e6…78fd2`.

---

## 1. Every schema / domain constant in the final candidate

Enumerated by grep over `cpg_u1_data.mjs` and `lib/**` (test fixtures excluded; `node_modules` excluded).
**27 distinct `cpg-u1-…` strings. Every single one is at `/v1`. There is no `/v2` anywhere in the tree.**

### 1a. Document schemas — stamped as the `schema` field of an artefact

| Schema string | Constant | Declared at | Artefact it governs |
|---|---|---|---|
| `cpg-u1-registration/v1` | `REGISTRATION_SCHEMA` | `lib/registration.mjs:8` | the preregistration record |
| `cpg-u1-commitment/v1` | `PAYLOAD_SCHEMA` | `lib/commitment.mjs:7` | commitment payloads (both stages) |
| `cpg-u1-sampling-evidence/v1` | `EVIDENCE_SCHEMA` | `lib/sampling.mjs:16` | **the sampling-evidence bundle** |
| `cpg-u1-personnel/v1` | `PERSONNEL_SCHEMA` | `lib/personnel.mjs:5` | the personnel register |
| `cpg-u1-rater-assignment/v1` | `ASSIGNMENT_SCHEMA` | `lib/assignment.mjs:12` | person→label assignment |
| `cpg-u1-execution-authorization/v1` | `AUTHORIZATION_SCHEMA` | `lib/execution.mjs:8` | the held-out execution authorization |
| `cpg-u1-execution-log/v1` | `LOG_SCHEMA` | `lib/execution.mjs:9` | the derived execution log |
| `cpg-u1-harness-event/v1` | `EVENT_LOG_SCHEMA` | `lib/eventlog.mjs:8` | each hash-chained harness event |
| `cpg-u1-response-archive/v1` | `ARCHIVE_SCHEMA` | `lib/archive.mjs:10` | one archived CPG response |
| `cpg-u1-reference-adjudication-packet/v1` | *(inline literal)* | `lib/packets.mjs:42`, checked `:47` | **reference packets** |
| `cpg-u1-rating-adjudication-packet/v1` | *(inline literal)* | `lib/packets.mjs:86`, checked `:91` | **rating adjudication packets** |
| `cpg-u1-rater-packet/v1` | `RATER_PACKET_SCHEMA` | `lib/raterPackets.mjs:16` | **rater packets** |
| `cpg-u1-rater-order/v1` | *(inline, with `RATER_ORDER_DOMAIN`)* | `lib/raterOrder.mjs:56` | the presentation-order record |
| `cpg-u1-rater-sheet/v1` | `RATER_SHEET_SCHEMA` | `lib/ratings.mjs:18` | one rater's ingested labels |
| `cpg-u1-rating-resolution/v1` | `RATING_RESOLUTION_SCHEMA` | `lib/ratings.mjs:19` | the rating-adjudication resolution |
| `cpg-u1-evaluation/v1` | `EVALUATION_SCHEMA` | `lib/evaluation.mjs:23` | the sealed evaluation artifact |
| `cpg-u1-analysis-decisions/v1` | `DECISIONS_SCHEMA` | `lib/analysis.mjs:16` | `rules/analysis_decisions.json` |
| `cpg-u1-analysis-declarations/v1` | `DECLARATIONS_SCHEMA` | `lib/analysis.mjs:17` | the human declarations file |
| `cpg-u1-results/v1` | `RESULTS_SCHEMA` | `lib/analysis.mjs:18` | **analysis outputs** |

### 1b. Domain-separation tags — hashed into a value, never a `schema` field

| String | Constant | Declared at | Role |
|---|---|---|---|
| `cpg-u1-commitment-digest/v1` | `DIGEST_DOMAIN` | `lib/commitment.mjs:8` | the OP_RETURN digest domain (**a `PROTOCOL_MARKER`**) |
| `cpg-u1-append-only/v1` | `APPEND_ONLY_DOMAIN` | `lib/commitment.mjs:9` | append-only frame proof |
| `cpg-u1-chain-drand-seed/v1` | `SEED_DOMAIN` | `lib/sampling.mjs:19` | §5.7 seed derivation (**a `PROTOCOL_MARKER`**) |
| `cpg-u1-seed-fingerprint/v1` | `FINGERPRINT_DOMAIN` | `lib/sampling.mjs:20` | the recorded seed fingerprint |
| `cpg-u1-rater-order/v1` | `RATER_ORDER_DOMAIN` | `lib/raterOrder.mjs:7` | order-key derivation (**a `PROTOCOL_MARKER`**) |
| `cpg-u1-evaluation-tree/v1` | `EVALUATION_TREE_DOMAIN` | `lib/evaluationTree.mjs:16` | §7.1 resolver identity (**a `PROTOCOL_MARKER`**) |
| `cpg-u1-provider-config/v1` | *(inline)* | `lib/harness.mjs:22` | `provider_configuration_sha256` |
| `cpg-u1-cited-urls/field-evidence-union/v1` | `CITED_URL_RULE` | `lib/raterPackets.mjs:19` | §12.3 Rule A (**a `PROTOCOL_MARKER`**) |

### 1c. Versioned artefacts that carry **no** schema string

| Artefact | Version marker | Where | Note |
|---|---|---|---|
| the contamination scan report | *none* — `tool: TOOL_VERSION` + `rules: [...]` only | `cpg_u1_data.mjs:283–292` | **no `schema`, no version integer** |
| drawn manifests (dev / held-out) | `manifest_version: 3` | `cpg_u1_data.mjs:457`, `:552` | integer, not a schema string |
| the sizing record | `sizing_version: 1` | `cpg_u1_data.mjs:484` | integer |
| the seal record | `seal_version: 4` | `cpg_u1_data.mjs:629` | integer |
| the **sampling record** (`record_sha256`) | *none* | `lib/sampling.mjs:162–204` | see §3 — decisive for this decision |
| **frame attribution** (`enumerated_by`) | *none* | `lib/enumeration.mjs` | a validator; emits no artefact |

---

## 2. Which schema governs each item the directive names

| Item | Governing schema, for the final candidate | Recorded at |
|---|---|---|
| **relay attribution** | `cpg-u1-sampling-evidence/v1` | values live in `evidence.drand.beacons[].relays` (built `lib/evidenceBundle.mjs:41–50`, stamped `:74`); floor `MIN_DRAND_RELAYS = 2` at `lib/sampling.mjs:18`, enforced `lib/sampling.mjs:193–194` |
| **evidence bundles** | `cpg-u1-sampling-evidence/v1` | `lib/sampling.mjs:16`; stamped `lib/evidenceBundle.mjs:74`; gate `lib/sampling.mjs:95` |
| **contamination** | **no schema of its own.** Governed by `manifest_version: 3` (drawn manifests) and by the unversioned scan report, and bound by hash into `cpg-u1-commitment/v1` via `scan_sha256` | computed `lib/schema.mjs:160–171`; merged `cpg_u1_data.mjs:107–122`; report `:283–292`; `PAYLOAD_KEYS` at `lib/commitment.mjs:11` |
| **frame attribution** | **no schema of its own.** `enumerated_by` is a §5 frame column, so it is bound by `frame_hash`, which is inside `cpg-u1-commitment/v1` and the manifests | validator `lib/enumeration.mjs:26–49`; `frame_hash` in `PAYLOAD_KEYS` `lib/commitment.mjs:11` and `cpg_u1_data.mjs:372`, `:379` |
| **reference packets** | `cpg-u1-reference-adjudication-packet/v1` | `lib/packets.mjs:42`, checked `:47` |
| **rating packets** | two distinct artefacts: `cpg-u1-rater-packet/v1` (`lib/raterPackets.mjs:16`) for rater packets; `cpg-u1-rating-adjudication-packet/v1` (`lib/packets.mjs:86`) for adjudication packets. Downstream: `cpg-u1-rater-sheet/v1` (`lib/ratings.mjs:18`), `cpg-u1-rating-resolution/v1` (`:19`) | as listed |
| **analysis outputs** | `cpg-u1-results/v1` (`lib/analysis.mjs:18`), from `cpg-u1-analysis-decisions/v1` (`:16`) + `cpg-u1-analysis-declarations/v1` (`:17`) | as listed |

Two of these — contamination and frame attribution — **have no schema version to freeze or bump**. If
the registration package is asked "which schema governs contamination?", the only honest answer is
"none; it is bound by `scan_sha256` and `manifest_version: 3` inside the committed payload". That should
be stated explicitly rather than left for a reader to discover.

---

## 3. Does DR-1 *require* a bump? The case both ways

### The change DR-1 actually made

1. **Bundle input shape (breaking).** Every `--drand-beacons` file must now carry a non-empty,
   untrimmed-whitespace-free `relay` string — `lib/evidenceBundle.mjs:41` throws otherwise. Previously
   beacon files carried `{round, signature, randomness}` with no attribution.
2. **Bundle output shape (additive).** Each beacon entry gained `relays: [name, …]`, sorted, ≥ 2
   distinct (`lib/evidenceBundle.mjs:42–50`).
3. **Consumer gate (breaking for old bundles).** `lib/sampling.mjs:193–194` throws
   `EvidenceError` naming §19.3 when a carried beacon has fewer than 2 named relays.
4. **The schema string was left at `/v1`.**

### Case FOR a bump to `/v2`

- A pre-DR-1 bundle and a post-DR-1 bundle both present `schema: "cpg-u1-sampling-evidence/v1"`. From
  the string alone a reader cannot tell them apart. That is exactly what a version field exists to
  prevent, and change (1) is unambiguously breaking on the producer side.
- `EVIDENCE_SCHEMA` is **not** a `PROTOCOL_MARKER` (absent from `cpg_u1_data.mjs:321–323`) and the
  phrase "sampling-evidence" appears **nowhere** in `CPG_U1_PROTOCOL_004.md`. So a bump would create
  **no protocol conflict** and `verify-protocol` would still pass. The usual blocker is absent.
- Blast radius is small and mechanical: `lib/sampling.mjs:16`; comment `lib/evidenceBundle.mjs:1`;
  `README.md:92`, `:176`, `:187`; hardcoded literals `test/selftest.mjs:522`, `:1393`, `:1427`.

### Case AGAINST a bump — the stronger case

1. **No registered study artefact carries `EVIDENCE_SCHEMA` at all.** The bundle is a *verification
   input*, not an output of the registered pipeline. Decisively: the sampling record built at
   `lib/sampling.mjs:162–204` has **no `schema` field and no relay data** — `drandRelays` is returned
   *beside* the record (`:204`), never inside it, so `record_sha256` is byte-identical before and after
   DR-1. `README.md:190–191` says so in terms: "The attribution does not enter the seed or the sampling
   record — the §5.7 derivation and `record_sha256` are unchanged." **Nothing downstream of the bundle
   changed shape**, so no manifest, seal, evaluation, packet, sheet or results artefact is ambiguous.
2. **The breaking direction is already enforced, not merely labelled.** Feed a pre-DR-1 bundle to the
   registered tooling and it refuses loudly at `lib/sampling.mjs:194` with a message naming the relay
   count and §19.3. A reader cannot silently accept the wrong shape. A version bump would replace a
   fail-closed runtime refusal with a string comparison — no gain in assurance.
   The only silently-tolerant direction is *new bundle → old tooling*, and old tooling is by
   construction not the registered tooling (`cpg_u1_data.mjs:180`, `lib/harness.mjs:44`).
3. **The aggregate already answers the question, and is the protocol's designated answer.** Exactly one
   `tooling_aggregate_sha256` is registered; it is a sampling field
   (`lib/registration.mjs:119`), so a second registration with a different one voids the study
   (`checkAuthority`). "Which schema produced this?" therefore has exactly one possible producer per
   registered study, and the protocol's governed-tooling row makes the aggregate — not a version
   string — the identity.
4. **A bump costs a new aggregate.** 5 files → new aggregate → the 404-mutant certification currently
   running against this tree is invalidated, and the 35 registration documents (already stale at
   `f7699f05…`/593) must be renumbered again.
5. **The directive forbids exactly this.** §8: "Do not invent a new schema version merely for cosmetic
   reasons. If the current schema is already sufficient, freeze/document it." Given (1)–(3), the
   remaining benefit of `/v2` is self-description of an input document whose wrong shape is already
   rejected at runtime. That is cosmetic.
6. **A bump would create a *new* divergence.** The rehearsal bundles, `HEADER_AND_RELAY_SOURCES.md` and
   `DR1_DRAND_RELAY_FLOOR_MEMO.md` under `C:/tmp/dt004-operations` all say `/v1`. Bumping trades one
   documented naming divergence (tooling v4/v6, §7) for a second undocumented one.

---

## 4. RECOMMENDATION — **OWNER DECISION REQUIRED**

> ### Recommended: **Option A — FREEZE `cpg-u1-sampling-evidence/v1`. Do not bump. Document the freeze.**
>
> **OWNER DECISION REQUIRED.** The record shows this was explicitly deferred at DEEPTECH-PARALLEL-005
> (DR-1 open), not resolved. This wave prepares both options and recommends A; it does not decide.

**Option A — freeze at `/v1` (recommended).**
- Aggregate impact: **NONE**, if the freeze is recorded in the registration package
  (`REGISTRATION_PACKAGE.md`, `DR1_DRAND_RELAY_FLOOR_MEMO.md`) — outside the tooling tree.
- If you *also* want the freeze stated in the README (recommended for a standalone package — see
  `README_CORRECTIONS.md` **R8**), that edit **does move the aggregate** and belongs in the final edit
  session.
- Freeze statement to record verbatim:
  > `cpg-u1-sampling-evidence/v1` is frozen. DR-1 made the *input* beacon shape breaking — every
  > `--drand-beacons` file must name its relay, and every carried round must be attested by ≥ 2
  > differently named relays (§19.3) — and the schema version was **deliberately not** advanced to
  > `/v2`. The change is enforced at runtime (`lib/sampling.mjs:193–194`, `lib/evidenceBundle.mjs:41`),
  > it does not alter the sampling record or `record_sha256`, and no registered study artefact carries
  > this schema string. Which `/v1` is meant is settled by the registered tooling aggregate.

**Option B — bump to `/v2`.** Legitimate and cheap to implement, but **moves the aggregate**, must be
done in the same edit session as the README, requires re-running certification, and must be propagated
to `test/selftest.mjs:522`, `:1393`, `:1427` or the self-test fails. Choose it only if the owner wants
the evidence bundle to be self-identifying **without** reference to the aggregate — e.g. if bundles will
circulate outside the registration package.

**Do NOT do a partial bump.** Changing the constant without the three `selftest.mjs` literals breaks
the self-test; changing the README without the constant creates a false claim inside the aggregate.

### 4a. "Which evidence schema produced the registered study artifacts?" — the one answer under each option

**Under Option A (freeze):**
> `cpg-u1-sampling-evidence/v1`, as implemented by the registered tooling aggregate
> `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files) — the post-DR-1 shape,
> in which every beacon entry carries a sorted `relays` array of at least two distinct names. The
> schema string alone does not separate this from the pre-DR-1 `/v1` shape; the registered aggregate
> does, and exactly one aggregate is registered for `CPG-U1-2026-01`.
> *(And, strictly: no registered study artefact carries this string. The registered artefacts are
> governed by `cpg-u1-commitment/v1`, `manifest_version: 3`, `seal_version: 4`, `cpg-u1-evaluation/v1`,
> `cpg-u1-rater-packet/v1`, `cpg-u1-rater-sheet/v1`, `cpg-u1-rating-resolution/v1` and
> `cpg-u1-results/v1`.)*

**Under Option B (bump):**
> `cpg-u1-sampling-evidence/v2` — self-identifying from the string alone: a `/v2` bundle is by
> definition one in which every beacon names ≥ 2 distinct relays. The aggregate is then a redundant
> second witness rather than the sole disambiguator.

Both answers are single-valued. A is achievable without moving the aggregate; B is not.

---

## 5. Does closing this move the aggregate?

| Closure path | Moves aggregate? |
|---|---|
| Option A, freeze recorded only in the registration package (`C:/tmp/dt004-operations/**`) | **NO** |
| Option A, freeze also stated in `tooling/README.md` (R8) | **YES** |
| Option B, bump to `/v2` (5 files in-tree) | **YES** |

**Answer for the directive: closing EVIDENCE_SCHEMA does NOT have to move the aggregate.** The
recommended option can be executed before the final edit session. Only the optional README sentence, or
Option B, forces it into that session.
