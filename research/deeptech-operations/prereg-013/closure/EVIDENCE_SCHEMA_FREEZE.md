# §7 — EVIDENCE_SCHEMA: FREEZE `/v1`

DEEPTECH-PARALLEL-013, closure stream. Read-only verification against
`C:/tmp/dt013-candidate/tooling` (108 non-`node_modules` files, 594 total) and the frozen protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. **No instrument byte changed.**

> **SNAPSHOT NOTE.** `C:/tmp/dt013-candidate/tooling` was being edited live by another
> DEEPTECH-PARALLEL-013 stream during this session (`lib/identity.mjs` created 04:50, then
> `lib/registration.mjs`, `lib/harness.mjs`, `cpg_u1_data.mjs`, `test/mutate.mjs`, `test/selftest.mjs` up to
> 05:06). Re-checked at 05:11: **every `lib/` file cited below was untouched, so all `lib/` line numbers are
> stable**; only `cpg_u1_data.mjs` moved, and its citations are therefore given as
> **line-at-04:47 -> line-at-05:11**. The tree's file count moved from 108 non-`node_modules` / 594 total
> (04:47) to 109 / 595 (05:11), the difference being the new `lib/identity.mjs`; where a count appears below
> it is the 04:47 measurement and no conclusion depends on it. **No substantive finding changed under the
> drift.** Full drift record: `TOOL_VERSION_IDENTITY_MAP.md`.


---

## 1. THE §7 TEST: DOES THE LATEST AUTHORITATIVE DECISION RECORD REQUIRE A BUMP?

§7 permits a schema change **only** if the latest authoritative decision record requires one.

**Ruling-bearing records located.** The `OWNER DECISION:` / `DECIDED:` convention occurs in exactly
**six** places, in two files, naming **DR-1, DR-2 and DR-10 only**:

```
dt009-closure/orchestrator/DECISION_RECORD.md:19    DR-1  · OWNER DECISION: ADOPT OPTION (B)
dt009-closure/orchestrator/DECISION_RECORD.md:40    DR-2  · OWNER DECISION: ADOPT OPTION (A)
dt009-closure/orchestrator/DECISION_RECORD.md:53    DR-10 · OWNER DECISION: FIX BEFORE REGISTRATION
dt009-closure/G-registration/DECISION_DISCLOSURES.md:31    DR-1  · DECIDED: ADOPT OPTION (B)
dt009-closure/G-registration/DECISION_DISCLOSURES.md:137   DR-2  · DECIDED: ADOPT OPTION (A)
dt009-closure/G-registration/DECISION_DISCLOSURES.md:243   DR-10 · DECIDED: FIX BEFORE REGISTRATION
```

The later `dt012-decisions/DEEPTECH_PARALLEL_012_DECISION_RECORD.md` is **not** a ruling record: its own
opening states "No decision below is approved. Each is a *recommendation* with owner approval required."
It is later in time but not authoritative for §7's purposes.

**DR-1 is the only ruling that touches the evidence bundle at all.** Its text adopts ten requirements
"verbatim and no additional requirement is inferred": >= 2 distinct relays per bundle · relay identity
survives into the evidence representation · duplicate relay use does not satisfy the floor · the
verification result distinguishes the relays · one-relay fails closed · two-relay passes · malformed or
missing relay identity fails closed · relay identity enters the deterministic evidence path so one-relay
and two-relay bundles cannot hash alike · the suite proves the distinction · no authenticity weakening.
**No requirement mentions a schema identifier, a version suffix, or a bump.** DR-1 also carries a scope
limit: "Protocol semantics must not change."

DR-2 is "a documentation and disclosure act only". DR-10 concerns `cmdScan` duplicate collapse — the
scan, which carries no schema string at all.

> **CONFIRMED (wave 012's finding stands): no owner ruling requires an EVIDENCE_SCHEMA change.**
> §7's licence to change is therefore not open, and inventing a `/v2` would itself be a §7 violation.

## 2. THE FREEZE, RE-VERIFIED SITE BY SITE

`EVIDENCE_SCHEMA` has exactly four occurrences in the whole tree:

| Role | Site | Text |
|---|---|---|
| declared once | `lib/sampling.mjs:16` | `export const EVIDENCE_SCHEMA = 'cpg-u1-sampling-evidence/v1';` |
| imported once | `lib/evidenceBundle.mjs:9` | `import { EVIDENCE_SCHEMA, MIN_DRAND_RELAYS } from './sampling.mjs';` |
| stamped once | `lib/evidenceBundle.mjs:74` | `schema: EVIDENCE_SCHEMA, network: parts.network, headers, ...` |
| gated once | `lib/sampling.mjs:95` | `if (!ev || ev.schema !== EVIDENCE_SCHEMA) throw new EvidenceError(...)` |

- **Not a `PROTOCOL_MARKER`.** `PROTOCOL_MARKERS` (`cpg_u1_data.mjs:321-323 -> :352-354`) holds 20 entries —
  `SEED_DOMAIN`, `cpg-u1-commitment-digest/v1`, `PAYLOAD_SCHEMA`, `CITED_URL_RULE`,
  `EVALUATION_TREE_DOMAIN` and others. `EVIDENCE_SCHEMA` is **absent**. The protocol is therefore not
  required to state it, and `verify-protocol` does not check it.
- **`sampling-evidence` occurs 0 times in `CPG_U1_PROTOCOL_004.md`** (`grep -c` returns `0`). The string
  is tooling-internal; freezing it needs no protocol act.

## 3. THE COUNT, CORRECTED

`grep -hoE "[a-z0-9][a-z0-9-]*/v[0-9]+"` over the 108 non-`node_modules` files yields **28** distinct raw
strings. Two are negative-control fixtures, not identities of any artefact:

- `other-rule/v1` — `test/selftest.mjs:1112`, substituted into a rater packet to prove it is refused.
- `some-other-domain/v9` — `test/selftest.mjs:1285`, substituted for `EVALUATION_TREE_DOMAIN` for the
  same reason. This is the **only** non-`/v1` suffix anywhere in the tree, and it exists to be rejected.

Removing the two fixtures leaves **26 distinct versioned identifiers, every one `/v1`**, plus one
**unversioned** `TOOL_VERSION = 'cpg-u1-data-tooling-6'` (`cpg_u1_data.mjs:49 -> :50`).

> "27 schemas" was imprecise: it conflated `TOOL_VERSION` — which carries no `/vN` suffix and is not a
> schema — with the versioned set, and it counted fixtures as identities.

`grep -rn "/v2"` over the same 108 files returns **zero lines**. There is no second version of anything.

## 4. THE ONE IDENTITY STATEMENT

§7 asks for one canonical evidence-schema identity covering six things. A single *string* cannot do it,
and pretending otherwise would be the dishonest answer: two of the six carry no schema string, and two
others carry several. The identity that actually exists and actually covers all six is the **registered
tooling aggregate**, because every schema string and every hash construction in the list is a literal
inside the hashed tree.

> **IDENTITY STATEMENT — quote this verbatim wherever the question "which evidence schema generated the
> registered artifacts?" is asked:**
>
> **The artifacts registered for CPG-U1-2026-01 were generated by CPG-U1 dataset tooling
> `cpg-u1-data-tooling-6` at tooling aggregate `<FINAL_AGG>` over `<FINAL_N>` files, under protocol
> `CPG_U1_PROTOCOL_004` / `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719`. Within
> that instrument every evidence-bearing artifact carries `.../v1` and there is no `/v2` of anything;
> four artifact classes are identified by an in-band schema string, and two are identified by a content
> hash and carry no schema string at all. The aggregate, not any one string, is the identity: it is what
> the registration record binds (`tooling_aggregate_sha256`) and what an outside verifier compares.**

### What identifies each of the six

| # | Thing | What actually identifies it | Where |
|---|---|---|---|
| 1 | **relay attribution** | **No identifier of its own.** It is the `relays: [...]` array *inside* an evidence bundle, so it inherits `cpg-u1-sampling-evidence/v1`. Its only independent identity is the floor constant `MIN_DRAND_RELAYS = 2` and the two refusals that read it. It is precisely the field whose *presence* distinguishes the pre- from the post-DR-1 contract behind the one unchanged string. | `lib/sampling.mjs:18` (floor) · `lib/evidenceBundle.mjs:41-50` (build-time) · `lib/sampling.mjs:193-194` (verify-time) · re-emitted as `drand_relays` at `cpg_u1_data.mjs:408 -> :461` |
| 2 | **evidence bundles** | `cpg-u1-sampling-evidence/v1` — a real in-band schema string, stamped into the artifact and gated on read. | `lib/sampling.mjs:16` · `lib/evidenceBundle.mjs:74` · `lib/sampling.mjs:95` |
| 3 | **frame attribution** | **No schema string exists.** The frame is identified by `frame_hash = hashRecords(frame, 'candidate_id')` over the `FRAME_COLUMNS` set (`lib/schema.mjs:12`), and enumerator attribution is identified **only** by `enumerated_by` being one of those hashed columns — stated in the tooling's own comment at `cpg_u1_data.mjs:218-219 -> :249-250` and printed at `:223 -> :254`. `frame_hash` is inside the on-chain commitment payload. | `cpg_u1_data.mjs:290 -> :321`, `:460 -> :513` · `lib/commitment.mjs:12, 14, 31` |
| 4 | **reference packets** | `cpg-u1-reference-adjudication-packet/v1` — in-band, stamped and gated. | `lib/packets.mjs:42` (stamp) · `:47` (gate) |
| 5 | **rating packets** | **Four strings, not one**, for four distinct artifacts: `cpg-u1-rating-adjudication-packet/v1` (`lib/packets.mjs:86, 91`), `cpg-u1-rater-packet/v1` (`lib/raterPackets.mjs:16`), `cpg-u1-rater-sheet/v1` and `cpg-u1-rating-resolution/v1` (`lib/ratings.mjs:18-19`). A rater packet additionally carries the §12.3 rule id `cpg-u1-cited-urls/field-evidence-union/v1` (`lib/raterPackets.mjs:19`), which **is** a `PROTOCOL_MARKER`. | as cited |
| 6 | **analysis outputs** | **Three strings, not one**: `cpg-u1-analysis-decisions/v1`, `cpg-u1-analysis-declarations/v1`, `cpg-u1-results/v1`. | `lib/analysis.mjs:16-18` |

**Adjacent, for completeness:** contamination likewise has **no schema of its own** — the scan is
identified by `scan_sha256`, a plain file hash, committed in both payloads (`lib/commitment.mjs:12`) and
compared at `cpg_u1_data.mjs:442 -> :495`, `:503 -> :556`, `:530 -> :583` and `lib/harness.mjs:51, 157`.

So the six decompose as: **1 string covering two items (2, and 1 inside it) · 1 string (4) · 4 strings
(5) · 3 strings (6) · 1 content hash and no string (3)**. Nine strings and one hash construction — held
together by exactly one thing, the aggregate.

## 5. THE AGGREGATE DEPENDENCY, STATED EXPLICITLY

The same literal `cpg-u1-sampling-evidence/v1` is stamped by **two mutually incompatible contracts**:

- **pre-DR-1**: beacons are `{round, randomness, signature}`; relay identity is discarded; one beacon
  suffices. (Verified in the af2fb6e9 in-repo tree: its `lib/sampling.mjs` declares `EVIDENCE_SCHEMA`,
  `SEED_DOMAIN` and `FINGERPRINT_DOMAIN` and **no** `MIN_DRAND_RELAYS`; there is no
  `lib/evidenceBundle.mjs` at all.)
- **post-DR-1**: every beacon must name its relay, >= 2 differently named relays per round, and the relay
  set is carried in the bundle.

> **The string does not disambiguate them. `tooling_aggregate_sha256` does — and only it.** Which
> contract produced a given `/v1` bundle is recoverable *only* from the aggregate registered beside it,
> because the aggregate is the hash of the code that wrote and verified it. `checkAuthority` makes at
> most one aggregate authoritative on pain of VOID, so within a registered study the mapping is
> one-to-one.

**Why the ambiguity is nevertheless harmless for integrity:**

1. A pre-DR-1 bundle is **refused outright** by the current instrument. `lib/sampling.mjs:193-194` builds
   `relays` from `beacon.relays`; absent, it is the empty set; `0 < MIN_DRAND_RELAYS` throws
   `EvidenceError`. Verification aborts and nothing is decided.
2. In the only silently-tolerant direction the **sampling record is byte-identical**: `drandRelays` is
   returned *beside* the record at `lib/sampling.mjs:204`, never inside it, so no published record can be
   ambiguous about its own content.
3. `tooling_aggregate_sha256` is registered and compared, and pins which code verified it.

**One finding recorded against the freeze.** `lib/sampling.mjs:183-189` returns `WAITING_DRAND` when the
required round is absent, *before* the relay floor at `:193-194`. A bundle that both omits the round and
is wrongly shaped is therefore reported as "round not in evidence" rather than as a shape error. A `/v2`
would refuse it up front. Weight: **small** — the outcome is a waiting state, never a wrong result, and
the code comments the ordering deliberately so that absence still yields `WAITING_DRAND_ROUND` and, at
expiry, `STUDY_VOID_RANDOMNESS_UNAVAILABLE`. This does not outweigh §7.

## 6. THE DETACHED-BUNDLE RESIDUAL

Because identity rests on the aggregate rather than on the string, **a bundle that circulates detached
from its registration package is not self-identifying.** An auditor holding only `ev_bundle.json` reads
`"schema": "cpg-u1-sampling-evidence/v1"` and cannot tell which of the two contracts wrote it.

**This is an auditability gap, not an integrity gap.** It cannot cause a wrong result — a mismatched
bundle is refused at `lib/sampling.mjs:194`, and a tolerated one yields a byte-identical record — but a third party
cannot self-serve the provenance question from the artifact alone.

> **Mitigation (recommended; zero aggregate cost, zero protocol cost): never publish a bundle alone.**
> Publish every evidence bundle **beside** a one-line provenance header naming the three values an
> outsider can already recompute:
>
> ```
> tooling_aggregate_sha256 = <FINAL_AGG>
> tooling_file_count       = <FINAL_N>
> protocol_sha256          = c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719
> ```
>
> Nothing in the instrument changes; the bundle bytes do not change; the §13.2A archive already contains
> all three, so this is a **publication-packaging rule**, not a schema act. If a stronger guarantee is
> wanted — the bundle asserting its own provenance in-band — that costs a schema field and therefore the
> aggregate, and is **pre-registration only**.

## 7. RECOMMENDATION AND AGGREGATE EFFECT

> **FREEZE `EVIDENCE_SCHEMA = 'cpg-u1-sampling-evidence/v1'`. Do not bump. Do not invent `/v2`.** Adopt
> the detached-bundle publication rule as the mitigation for the residual.

**Does this move the aggregate? NO — mechanically, not by assertion.** `toolingManifest(root)`
(`lib/aggregate.mjs:8-23`) walks `root` and hashes every file beneath it; `root` is
`dirname(cpg_u1_data.mjs)`, i.e. the tooling tree alone. This document lives at
`research/deeptech-operations/prereg-013/closure/`, outside that tree, and no file inside the tree was
opened for writing or modified. Mutation-count effect: **none** — no mutant's anchor text changes. The
live 404-mutant run is unaffected by this decision.
