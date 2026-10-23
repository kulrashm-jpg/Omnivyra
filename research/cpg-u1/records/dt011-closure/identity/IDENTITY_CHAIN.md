# Identity chain — label → tree → aggregate → registration metadata

**DEEPTECH-PARALLEL-011 identity stream. Verified read-only. NOTHING APPLIED, nothing written under
`C:/tmp/dt009-merge`.**

Candidate: `C:/tmp/dt009-merge/tooling`
Protocol: `C:/tmp/dt009-merge/CPG_U1_PROTOCOL_004.md`, sha256 `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` — **verified unchanged**.

---

## Link 0 — the canonical label

> **CPG-U1 dataset tooling v6 (`cpg-u1-data-tooling-6`) — aggregate `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files**

| Where recorded | Exact location | Value | Mutable? |
|---|---|---|---|
| runtime constant | `tooling/cpg_u1_data.mjs:49` | `const TOOL_VERSION = 'cpg-u1-data-tooling-6';` | inside the aggregate |
| README title | `tooling/README.md:1` | "CPG U1 dataset tooling — v6 (`cpg-u1-data-tooling-6`: …)" | inside the aggregate |
| **protocol's generation label** | `CPG_U1_PROTOCOL_004.md:18`, `:25`, `:953`, `:1098` | "tooling **v4**" (CPG-043) | **FROZEN — never edit** |
| prepared disclosure | `C:/tmp/dt004-operations/registration/REGISTRATION_PACKAGE.md:175–188`; `OPERATOR_CHECKLIST.md:27–36` | "naming divergence only; identity is the aggregate" | outside the aggregate |

**Not pinned anywhere.** `TOOL_VERSION` is absent from `PROTOCOL_MARKERS`
(`cpg_u1_data.mjs:321–323`), absent from `registrationTemplate` (`lib/registration.mjs:34–57`), absent
from `SAMPLING_FIELDS` (`lib/registration.mjs:119`), never compared by any checker, and never asserted by
any test. Only `PROTOCOL_VERSION` is a pinned literal: `lib/registration.mjs:9`, stamped `:37`, enforced
`:77`, and required in the protocol text via `PROTOCOL_MARKERS[0]`.

---

## Link 1 — label → source tree

The `tool:` label is stamped into every artefact the instrument writes, so a reader holding any artefact
can read the producing label directly:

| Artefact | Field | Location |
|---|---|---|
| contamination scan report | `tool: TOOL_VERSION` | `cpg_u1_data.mjs:289` |
| development manifest | `manifest_version: 3, tool: TOOL_VERSION` | `cpg_u1_data.mjs:457` |
| sizing record | `sizing_version: 1, tool: TOOL_VERSION` | `cpg_u1_data.mjs:484` |
| held-out manifest | `manifest_version: 3, tool: TOOL_VERSION` | `cpg_u1_data.mjs:552` |
| seal record | `seal_version: 4, tool: TOOL_VERSION` | `cpg_u1_data.mjs:629` |

**Known weakness (documentation-closable, not a defect):** the `tool` field is never read back or
compared by `checkPayload`, `checkAuthorization`, `lib/harness.mjs`, `lib/evaluation.mjs` or
`lib/analysis.mjs`. It is a human label; assurance rests on Link 3.

---

## Link 2 — source tree → aggregate

| Item | Location / value |
|---|---|
| definition | `tooling/lib/aggregate.mjs` — `toolingManifest(root)`, the CPG-037A construction: one `"<sha256>  <path>\n"` line per file, sorted by path, `sha256` of the whole text; whole tree, vendored dependencies included; refuses symbolic links (`:14`) and non-regular entries (`:17`) |
| protocol basis | `CPG_U1_PROTOCOL_004` §19.1, §24 (`lib/aggregate.mjs:1`) |
| **verified value** | **`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`** |
| **verified file count** | **594 regular files, no symbolic links** |
| method of verification | independent replication of `toolingManifest` in a scratchpad script (read-only: `readdirSync` + `readFileSync` only); recomputed value matches the recorded candidate aggregate exactly |
| spot-check hashes | `README.md` `e70e57d5a211773d6952add18879adba44fae31e97c14c70deeb87eddd958691` · `cpg_u1_data.mjs` `ea4e3e4961755622e10c9e69e69df5a78fe05cf29058b80800932e989ef16017` · `rules/analysis_decisions.json` `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be` |

**`README.md` is inside the aggregate.** That is why every README correction moves it.

### Predecessor, verified for provenance

| Tree | Files | Aggregate |
|---|---|---|
| `C:/tmp/dt002/research/cpg-u1/tooling` | 593 | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` (recomputed — matches) |
| `C:/tmp/dt009-merge/tooling` (candidate) | 594 | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |

Manifest diff, 593 → 594:
- **added (1):** `lib/enumeration.mjs` — §4A.2 enumeration attribution
- **changed (6):** `README.md`, `cpg_u1_data.mjs`, `lib/evidenceBundle.mjs`, `lib/sampling.mjs` (DR-1 relay
  floor), `test/mutate.mjs`, `test/selftest.mjs`
- **unchanged:** `rules/analysis_decisions.json` (identical sha in both trees — the AD-1…AD-9 decisions are
  **not** what moved the aggregate)

---

## Link 3 — aggregate → registration metadata

| Step | Location |
|---|---|
| field declared in the template | `lib/registration.mjs:39` — `tooling_aggregate_sha256: toolingAggregate` |
| template produced | `cpg_u1_data.mjs:307` (`registration-fields`), printed `:310` |
| format-validated | `lib/registration.mjs:78` — must be 64 lowercase hex characters |
| **frozen as a sampling field** | `lib/registration.mjs:119` — `SAMPLING_FIELDS` includes it, so a second registration with a different value voids the study (`checkAuthority`, authority rule at `:54`) |
| enforced at verification | `cpg_u1_data.mjs:179–180` — `VERIFY_ABORT_HASH_MISMATCH: this tooling (aggregate …) is not the registered tooling` |
| enforced at execution | `lib/harness.mjs:44` — `TOOLING_MISMATCH`; `lib/harness.mjs:49`, `:155` — `MANIFEST_BINDING_MISMATCH` |
| carried into the authorization | `lib/execution.mjs:49`, `:65` |
| protocol's own statement | `CPG_U1_PROTOCOL_004.md:25` — the aggregate "is bound in the registration record (`tooling_aggregate_sha256`), **not in this file**" |
| draft record on disk | `C:/tmp/dt004-operations/registration/registration_record.DRAFT.json`, `registration_fields.TEMPLATE.json` |

### ⚠ This link is currently BROKEN

The draft record and 33 further documents carry `f7699f05…` / "593 files". **35 files under
`C:/tmp/dt004-operations` must be renumbered** to the final aggregate before registration — including four
`instrument.mjs` gateways that pin the hash in code and will refuse until updated. Full list and the exact
correction in `TOOL_VERSION_CLOSURE.md` §5.

**There is no tool-version field in the registration record.** `registrationTemplate` carries
`protocol_version`, `protocol_sha256`, `tooling_aggregate_sha256`, `registry_sha256` and the pinned
`parameters` — no tooling version string. Adding one would change `lib/registration.mjs` and **move the
aggregate**; it is not recommended, because the protocol explicitly designates the aggregate as the
identity. The canonical label belongs in the OSF registration narrative and the registration package, both
outside the tree.

---

## Link 4 — aggregate → study artefacts

| Artefact | Carries | Location |
|---|---|---|
| commitment payload (both stages) | `tooling_aggregate_sha256` inside the on-chain-committed digest | `lib/commitment.mjs:11` (`PAYLOAD_KEYS`), checked `:31`; built `cpg_u1_data.mjs:372`, `:379` |
| development / held-out manifest | `tooling_aggregate_sha256` | `cpg_u1_data.mjs:458`, `:553` |
| seal record | `tooling_aggregate_sha256` | `cpg_u1_data.mjs:630` |
| execution authorization | `tooling_aggregate_sha256` | `lib/execution.mjs:65`, cross-checked `:49` |
| evaluation-tree identity (separate axis) | commit + tree id + content-manifest aggregate over `git ls-files`; the instrument is refused inside the treatment (`INSTRUMENT_IN_TREATMENT`) | `lib/evaluationTree.mjs:16`, `:31`, `:74`, `:77`; resolver SHA `f01a7eb4199be4e04d4fee7fc0116303949dc553` (`test/selftest.mjs:50`, `test/adapter_conformance.mjs:22`) |

**The aggregate reaches the blockchain.** Because it is inside `PAYLOAD_KEYS`, the registered aggregate is
committed in the OP_RETURN digest before the randomness block exists. That is the strongest link in the
chain and the reason a version label is not needed for identity.

---

## Verdict: is the chain unambiguous?

**Yes, for the tooling. No, for the paperwork — and the paperwork is fixable without moving the aggregate.**

| Link | Unambiguous? | Residual work |
|---|---|---|
| 0 label | Yes, once the canonical label is adopted | adopt in registration package (outside tree) |
| 1 label → tree | Yes | optional: note that `tool:` is a label, not a check |
| 2 tree → aggregate | **Yes — verified by independent recomputation** | none |
| 3 aggregate → metadata | **NO — 35 documents cite the superseded `f7699f05…`/593** | renumber after the final edit session |
| 4 aggregate → artefacts | Yes — committed on-chain via `PAYLOAD_KEYS` | none |

---

## Does closing each item move the aggregate?

| Item | Closure | Moves the aggregate? | When it can be done |
|---|---|---|---|
| **`TOOL_VERSION` (§7)** | adopt the canonical label + reconciliation sentence in registration metadata and package documents; **do not touch `cpg_u1_data.mjs:49`** | **NO** | **before** the final edit session |
| **`EVIDENCE_SCHEMA` (§8)** | Option A (recommended): freeze `/v1`, document the freeze in the registration package | **NO** | **before** the final edit session |
| — same, if the freeze is also stated in the README (R8) | | **YES** | during the final edit session |
| — Option B: bump to `/v2` (`lib/sampling.mjs:16` + README ×3 + `test/selftest.mjs` ×3) | | **YES** | during the final edit session |
| **README (§9)** | all nine corrections R1–R9 | **YES — always.** `README.md` is one of the 594 manifest files | **only** during the final edit session |
| *(consequence)* renumber the 35 `C:/tmp/dt004-operations` documents | | NO (outside the tree) | **only after** the final aggregate is recomputed |

**Sequence that cannot desync:** finish the running certification → single in-tree edit session (README
R1–R9, plus the EVIDENCE_SCHEMA bump only if Option B) → recompute the aggregate → re-certify → renumber
the 35 documents to the final value and re-attest their "VERIFIED" claims → register.
