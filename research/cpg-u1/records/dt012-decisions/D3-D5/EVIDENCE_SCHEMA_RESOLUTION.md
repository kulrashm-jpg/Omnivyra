# `EVIDENCE_SCHEMA` — resolution prepared for owner ruling

DEEPTECH-PARALLEL-012, stream D-5. **Analysis only. Nothing applied, no code written, no schema changed,
no file under `C:/tmp/dt009-merge` created or modified.** Every measurement below is a read-only grep or
`awk` print against the candidate `C:/tmp/dt009-merge/tooling`, aggregate
`638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2`, 594 files (verified). The protocol
`c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` was read only.

The governing instruction was followed: `EVIDENCE_SCHEMA`'s meaning was **not** inferred from its label.
Its declaration, its one stamping site, its one gate, the record it does *not* enter, and the enforcement
that replaces the version bump were each read in the candidate.

---

## 1. THE EXACT TEXT OF THE DECISION, AND WHERE IT IS

There is no standalone decision document for this item; it exists as a **second-order decision attached to
DR-1**, stated four times. All four are quoted verbatim.

### 1a. `C:/tmp/dt004-operations/registration/DR1_DRAND_RELAY_FLOOR_MEMO.md:232` — where it originates

> | **Second-order decision the owner must also make** | The patch is a **breaking change to the operator's
> beacon input shape**: each beacon object must now carry a `relay` string, and each round must be supplied
> by ≥ 2 differently named relays. `EVIDENCE_SCHEMA` is `cpg-u1-sampling-evidence/v1`; the owner must decide
> whether to bump it to `/v2`. Bumping it is itself another aggregate-moving edit and changes every
> fixture-built bundle in the self-test. **This memo does not choose.** |

Same memo, `:329`: "`EVIDENCE_SCHEMA` — see the second-order decision in option (b)'s table. **Undecided
here.**"

### 1b. `C:/tmp/dt008-prereg/G-randomness/DR1_RELAY_FLOOR_DECISION.md:175-177` — the sharpest statement

> 7. **A second-order decision follows and is UNDECIDED:** whether `EVIDENCE_SCHEMA`
>    (`cpg-u1-sampling-evidence/v1`) becomes `/v2`. Adding `relays` changes the bundle document's shape, so an
>    outsider validating against `/v1` sees an unexpected key.

### 1c. `C:/tmp/dt006-human-min/G-amendment/AMENDMENT_ORDERING.md:70-73` — the ordering constraint

> - **DR-1:** (a) accept as procedural and disclose — aggregate unchanged; or (b) add the relay-count floor —
>   aggregate moves, and a **second-order decision** comes with it: whether to bump `EVIDENCE_SCHEMA` from
>   `cpg-u1-sampling-evidence/v1` to `/v2`, which is itself another aggregate-moving edit and changes every
>   fixture-built bundle in the selftest (DR-1 §232). **Decide the schema bump in the same sitting or the
>   aggregate moves twice inside DR-1 alone.**

### 1d. `C:/tmp/dt009-closure/DEEPTECH_PARALLEL_009_REPORT.md:206-207` and `dt010-rehearsal/…_010_REPORT.md:255-257` — carried forward as open

> **`EVIDENCE_SCHEMA` /v1 → /v2** — the beacon input shape is now a breaking change.

> **Five aggregate-moving decisions, all DECISION REQUIRED, all expiring at registration:** … ·
> `EVIDENCE_SCHEMA` `/v1` → `/v2` · …

Also `dt008-prereg/F-registration/OPERATOR_REGISTRATION_SEQUENCE.md:60-62`: "Route B also forces a second
decision the memo declines to make: whether to bump `EVIDENCE_SCHEMA` … **Owner decision. Record the chosen
route and the reason.**"

### 1e. No owner ruling exists — verified independently

The same exhaustive `OWNER DECISION:` / `DECIDED:` grep across all ten search roots (listed in
`DR11_RESOLUTION.md` §1d) returns six ruling lines, naming **DR-1, DR-2 and DR-10 only**.
`EVIDENCE_SCHEMA` appears in **none** of them; its only appearance near a ruling verb is
`dt008-prereg/G-randomness/DR1_RELAY_FLOOR_DECISION.md:175`, which says **"UNDECIDED"**. DR-1 was ruled
`ADOPT OPTION (B)` — the route that *creates* this second-order decision — and the second-order decision
itself was never taken. **Confirmed: `EVIDENCE_SCHEMA` carries no owner ruling.**

---

## 2. THE EXACT SCHEMA IDENTITY

```
C:/tmp/dt009-merge/tooling/lib/sampling.mjs:16
16: export const EVIDENCE_SCHEMA = 'cpg-u1-sampling-evidence/v1';
```

**Declared value: `cpg-u1-sampling-evidence/v1`. Declared at `lib/sampling.mjs:16`.**

Its complete surface in the instrument — four references, all read:

| Site | Role |
|---|---|
| `lib/sampling.mjs:16` | the declaration |
| `lib/evidenceBundle.mjs:9` | `import { EVIDENCE_SCHEMA, MIN_DRAND_RELAYS } from './sampling.mjs';` |
| `lib/evidenceBundle.mjs:74` | the **only** place it is stamped: `schema: EVIDENCE_SCHEMA, network: …` |
| `lib/sampling.mjs:95` | the **only** gate: `if (!ev \|\| ev.schema !== EVIDENCE_SCHEMA) throw new EvidenceError(...)` |

It is **not** a `PROTOCOL_MARKER` — the list at `cpg_u1_data.mjs:321-323` is `PROTOCOL_VERSION`,
`STUDY_ID`, `D = 6`, `K = 12`, `180 days`, `Δ = 3 h`, `30 days`, `QUICKNET.hash`,
`bls-unchained-g1-rfc9380`, `SEED_DOMAIN`, `cpg-u1-commitment-digest/v1`, `PAYLOAD_SCHEMA`,
`OSF Registries`, `STUDY_OPERATOR`, `UNASSIGNED`, `cpg-u1-rater-order/v1`,
`cpg-u1-execution-authorization/v1`, `E ≥ 126 / 52 / 32`, `CITED_URL_RULE`, `EVALUATION_TREE_DOMAIN` —
and the string `sampling-evidence` occurs **0 times** in `CPG_U1_PROTOCOL_004.md` (verified against both
the `dt009-merge` and the `dt002` copies). So neither a freeze nor a bump can create a protocol conflict,
and `verify-protocol` is unaffected either way.

---

## 3. THE 27 STRINGS — CONFIRMED, WITH ONE PRECISION CORRECTION

Independent enumeration, `grep -rhoE "cpg-u1-[A-Za-z0-9/_.-]+" cpg_u1_data.mjs lib/ | sort -u`:

```
 1 cpg-u1-analysis-decisions/v1              15 cpg-u1-provider-config/v1
 2 cpg-u1-analysis-declarations/v1           16 cpg-u1-rater-assignment/v1
 3 cpg-u1-append-only/v1                     17 cpg-u1-rater-order/v1
 4 cpg-u1-chain-drand-seed/v1                18 cpg-u1-rater-packet/v1
 5 cpg-u1-cited-urls/field-evidence-union/v1 19 cpg-u1-rater-sheet/v1
 6 cpg-u1-commitment-digest/v1               20 cpg-u1-rating-adjudication-packet/v1
 7 cpg-u1-commitment/v1                      21 cpg-u1-rating-resolution/v1
 8 cpg-u1-data-tooling-6                     22 cpg-u1-reference-adjudication-packet/v1
 9 cpg-u1-evaluation-tree/v1                 23 cpg-u1-registration/v1
10 cpg-u1-evaluation/v1                      24 cpg-u1-response-archive/v1
11 cpg-u1-execution-authorization/v1         25 cpg-u1-results/v1
12 cpg-u1-execution-log/v1                   26 cpg-u1-sampling-evidence/v1
13 cpg-u1-harness-event/v1                   27 cpg-u1-seed-fingerprint/v1
14 cpg-u1-personnel/v1
```

**Total: exactly 27 distinct `cpg-u1-…` strings — CONFIRMED.**
**No `/v2` anywhere in the tree — CONFIRMED**, by `grep -rn "/v2" .` over all 108 files outside
`node_modules` (including `README.md`, `test/`, `rules/`, `templates/`, `harness/`): **zero hits**.

**Two precisions the record should carry** (the prior stream's count is right, its phrasing is not):

1. Entry **8, `cpg-u1-data-tooling-6`, is not a schema string** — it is `TOOL_VERSION`, declared at
   `cpg_u1_data.mjs:49`, and it carries no `/vN` at all. So the accurate statement is: **26 distinct
   versioned schema/domain identifiers, every one of them `/v1`, plus one unversioned tool-version string
   — 27 `cpg-u1-*` strings in total.** "All 27 are at `/v1`" is not literally true.
2. `cpg-u1-rater-order/v1` is **one** string serving **two** roles — a `schema` field
   (`lib/raterOrder.mjs:56`) and the `RATER_ORDER_DOMAIN` constant (`lib/raterOrder.mjs:7`). The prior
   stream's tables list it in both §1a and §1b, so those tables have 27 *rows* but describe 26 *distinct*
   strings. Same arithmetic, different reason; worth recording so a later wave does not "find" a
   discrepancy.

Neither correction changes the decision. Both are stated because the directive asks for the strings to be
confirmed **or corrected**.

---

## 4. IS THE SCHEMA IDENTITY PART OF THE REGISTERED AGGREGATE? — **YES (as a byte), NO (as a registered field)**

Two different questions, and conflating them is the trap here.

- **As bytes:** `lib/sampling.mjs` is inside the tree that `toolingManifest()` walks
  (`lib/aggregate.mjs:8-22` — every regular file, sorted by path, `sha256  path` lines concatenated and
  hashed; 594 files verified). So the literal `'cpg-u1-sampling-evidence/v1'` **is** covered by
  `638d68e6…`. Changing it changes the aggregate.
- **As a registered field:** `cpg-u1-sampling-evidence/v1` is **not** a field of any registered record. The
  registration record's schema is `cpg-u1-registration/v1` (`lib/registration.mjs:8`); its sampling fields
  are `['protocol_sha256', 'tooling_aggregate_sha256', 'registry_sha256', 'network', 'outpoints',
  'checkpoint', 'parameters']` (`lib/registration.mjs:119`). `EVIDENCE_SCHEMA` is not among them.

### 4a. No registered study artefact carries `EVIDENCE_SCHEMA` at all — CONFIRMED by reading the record

The prior stream's decisive claim was verified line by line at `lib/sampling.mjs:162-204`:

```
162:   const record = {
163:     stage, commitment_txid: t.tx.txid, payload_digest: decoded.digest, commitment_height: t.height, commitment_block_hash: t.blockHash,
164:     randomness_height: randHeight, randomness_block_hash: chain.at(randHeight).hash,
165:   };
...
174:   Object.assign(record, { mtp_after_randomness_depth: mtp, drand_chain_hash: QUICKNET.hash, drand_round: round, drand_round_time: roundTime(round) });
...
197:   record.drand_randomness = randomness;
...
202:   record.seed_fingerprint = seedFingerprint(seed);
203:   record.record_sha256 = sha256(canonicalJson(record));
204:   return { ...outcome(stage, STATE.FINAL, 'sampling event final'), record, payload: p, seed, developmentRecord: dev ? dev.record : record, drandRelays: [...relays].sort() };
```

**No `schema` field. No relay data.** `drandRelays` is returned **beside** the record at `:204`, never
inside it. `record_sha256` (`:203`) is `sha256(canonicalJson(record))` over exactly the fields at `:163-164`,
`:174`, `:197`, `:202`. **So `record_sha256` is byte-identical before and after DR-1 — CONFIRMED.** The
sampling record is the object the seal binds (`sealedHeldOut`, `cpg_u1_data.mjs:672-673`,
`recomputeRecordSha`), so nothing downstream of the bundle changed shape: no manifest, seal, evaluation,
packet, sheet, resolution or results artefact is affected.

### 4b. The breaking direction is enforced, not labelled — CONFIRMED

```
lib/sampling.mjs
193:   const relays = new Set(Array.isArray(beacon.relays) ? beacon.relays.filter((r) => typeof r === 'string' && r !== '' && r.trim() === r) : []);
194:   if (relays.size < MIN_DRAND_RELAYS) throw new EvidenceError(`drand round ${round} is attested by ${relays.size} named relay(s); the protocol requires at least ${MIN_DRAND_RELAYS} differently named relays (§19.3)`);
```

`MIN_DRAND_RELAYS = 2` (`:18`). And on the producer side `lib/evidenceBundle.mjs:41` throws when a beacon
does not name its relay, `:44` refuses relays that disagree for one round, and `:50` refuses a round
attested by fewer than 2 differently named relays. **A pre-DR-1 bundle is refused loudly, by name, citing
§19.3 — CONFIRMED.**

---

## 5. THE AMBIGUITY SCENARIO, CONSTRUCTED CONCRETELY — THE CRUX

**Can two artefacts carrying the same schema string have been produced by materially different code, such
that a later reader cannot tell which?**

### 5a. The scenario, made concrete

- **Bundle P.** Produced by `sampling-evidence-bundle` (`cpg_u1_data.mjs:1092`) from the **pre-DR-1**
  instrument, aggregate `f7699f05…`, 593 files. Each beacon entry is
  `{round, randomness, signature}` — `relays` does not exist, because nothing built it.
- **Bundle Q.** Produced by the same command from the **post-DR-1** candidate, aggregate `638d68e6…`,
  594 files. Each beacon entry is `{round, randomness, signature, relays: ["drand-relay-a","drand-relay-b"]}`,
  sorted (`lib/evidenceBundle.mjs:42`, `:45`, `:49`), at least two distinct names (`:50`).

Both stamp `schema: "cpg-u1-sampling-evidence/v1"` at `lib/evidenceBundle.mjs:74`. **From the string alone
a reader cannot tell P from Q.** The ambiguity is therefore real, and it is worse than "additive": `/v1`
now denotes **two mutually incompatible contracts** — under the pre-DR-1 reading `relays` is an unexpected
key, and under the post-DR-1 reading its absence is a fatal omission. Only one written spec can be "the"
`/v1` spec. That is the honest statement of the problem, and it is exactly what
`dt008-prereg/G-randomness/DR1_RELAY_FLOOR_DECISION.md:175-177` warned of.

### 5b. But no *evidence-bearing artifact* can be generated ambiguously — three independent reasons

1. **P cannot produce a registered artefact at all.** Fed to the registered tooling, P is refused at
   `lib/sampling.mjs:194` with a message naming the relay count and §19.3. It cannot reach a seed, a
   manifest, a seal or an evaluation. The ambiguous document is confined to the *input* side of a boundary
   the registered tooling closes.
2. **Q and P, where both are accepted, yield byte-identical outputs.** In the only silently-tolerant
   direction — Q fed to *pre*-DR-1 tooling, which ignores the extra key — the sampling record is the same
   object (§4a: `relays` never enters it), so `record_sha256`, the manifests, the seal, the evaluation and
   the results are **byte-identical**. There is no divergent artefact to be ambiguous *about*. The
   ambiguity is purely about which code path did the verifying, never about what was produced.
3. **Which code did the verifying is exactly what the aggregate records, and it is the protocol's
   designated answer.** `tooling_aggregate_sha256` is a registered **sampling field**
   (`lib/registration.mjs:119`); it is one of the `PAYLOAD_KEYS` (`lib/commitment.mjs:11-12`) and therefore
   inside the OP_RETURN commitment digest; and it is re-checked at run time — `cpg_u1_data.mjs:179-180`
   recomputes `toolingManifest(ROOT).aggregate` and fails `VERIFY_ABORT_HASH_MISMATCH` if it is not the
   registered value, `lib/sampling.mjs:145` voids on a payload whose `tooling_aggregate_sha256` differs,
   and the harness raises `TOOLING_MISMATCH` (`lib/harness.mjs:44`).

### 5c. Does the registered aggregate resolve it, and is one aggregate enough?

**It resolves it, and one is enough — for the registered study.** `checkAuthority`
(`lib/registration.mjs:127-143`) makes this structural, not conventional: `samplingView` (`:120`) covers
`tooling_aggregate_sha256`; `:138` voids if the registry copy differs in sampling fields; `:140-141` voids
the study outright if a second registration for `CPG-U1-2026-01` names different sampling fields; `:136`
makes only the earliest registration authoritative. So **at most one `tooling_aggregate_sha256` can ever
be authoritative for this study, on pain of VOID.** "Which `/v1` produced this?" therefore has exactly one
possible answer per registered study, and that answer is recorded in the registry and on the blockchain —
a stronger witness than a string inside the document.

**The residual, stated honestly.** The aggregate answers the question only for a reader who has the
registration record beside the bundle. A bundle **circulating on its own**, detached from the registration
package, is not self-identifying. That is an *auditability* gap, not an integrity gap — it cannot cause a
wrong result, only an unanswerable question — and it is closable by documentation: require that any bundle
published outside the registration package be published **with** the registered aggregate beside it.

### 5d. The one case `/v2` would catch that `/v1` + runtime enforcement does not — found in this stream, recorded against my own recommendation

`lib/sampling.mjs:183-189` returns early when the required round is **absent** from the evidence:
`WAITING_DRAND`, or `VOID_RANDOMNESS` after the 30-day expiry. The relay floor at `:193-194` is only
reached once a beacon **is** present. So a pre-DR-1 bundle that happens not to carry the required round is
**not** identified as wrongly shaped — it is reported as "round not in evidence", and the operator learns
nothing about the bundle's shape. With `/v2`, the gate at `lib/sampling.mjs:95` would refuse the whole
document up front on the string, whatever rounds it holds.

**Weight:** small, and not an integrity gap. The outcome in that case is a *waiting* state, never a wrong
answer, and re-supplying a correctly shaped bundle resolves it. It is a diagnostic-quality difference, and
it is the only concrete assurance gain for `/v2` this stream could construct. It is recorded so the owner
rules on a complete picture rather than on a one-sided case.

---

## 6. IS `/v1` SUFFICIENT? — **YES**

`/v1` is sufficient because the three things a version string exists to provide are already provided by
something stronger:

| What a version bump would provide | Already provided by | Verified at |
|---|---|---|
| refuse the wrong input shape | a fail-closed runtime refusal naming §19.3 | `lib/sampling.mjs:193-194`; `lib/evidenceBundle.mjs:41`, `:50` |
| tell a reader which code produced the artefact | `tooling_aggregate_sha256`: registered, in the OP_RETURN digest, re-checked every run, and unique on pain of VOID | `lib/registration.mjs:119`, `:127-143`; `lib/commitment.mjs:11-12`; `cpg_u1_data.mjs:179-180`; `lib/sampling.mjs:145`; `lib/harness.mjs:44` |
| protect downstream artefacts from shape drift | nothing downstream changed: `record_sha256` is byte-identical before and after DR-1 | `lib/sampling.mjs:162-204` |

The directive's own test settles it: *"Do not invent a new schema version merely for cosmetic reasons. If
the current schema is already sufficient, freeze/document it."* The remaining benefit of `/v2` is
self-description of an **input** document whose wrong shape is already rejected at runtime, plus the narrow
diagnostic case at §5d. **Recommendation: freeze `/v1` and document the freeze. Do not invent `/v2`.**

---

## 7. NINE-FIELD RETURN — `EVIDENCE_SCHEMA`

### DECISION
Whether `EVIDENCE_SCHEMA` — `cpg-u1-sampling-evidence/v1`, declared at `lib/sampling.mjs:16` — must be
advanced to `cpg-u1-sampling-evidence/v2` before registration, given that DR-1 (ruled `ADOPT OPTION (B)`)
made the `--drand-beacons` **input** shape breaking (every beacon must name its relay; every carried round
must be attested by ≥ 2 differently named relays) while leaving the schema string unchanged.

### RECOMMENDED RULE
**ADOPT OPTION (A) — FREEZE `cpg-u1-sampling-evidence/v1`. Do not bump. Record the freeze in the
registration package**, with the freeze statement in the EXACT WORDING section below, and add the
disclosure obligation from §5c: any sampling-evidence bundle published outside the registration package is
published **together with** the registered `tooling_aggregate_sha256`. Record the §5d diagnostic limitation
in the same place. If the owner also wants the freeze stated inside `tooling/README.md`, that edit **moves
the aggregate** and must go in the single final edit session with DR-11, DR-12, `TOOL_VERSION` and the
README enforcement row.

### ALTERNATIVES CONSIDERED
- **(A) Freeze `/v1`, document — recommended.** Aggregate unchanged if the freeze lives only in the
  registration package (`C:/tmp/dt004-operations/**`, `REGISTRATION_PACKAGE.md`,
  `DR1_DRAND_RELAY_FLOOR_MEMO.md`). Answers the identity question single-valuedly via the aggregate.
- **(B) Bump to `/v2`.** Legitimate, cheap to write, creates no protocol conflict (§2), and closes §5d's
  narrow diagnostic case. Rejected as the recommendation: it moves the aggregate, forces a fourth
  certification run's worth of re-verification, must be propagated to `lib/sampling.mjs:16`, the
  `lib/evidenceBundle.mjs` comment, `README.md` (three sites) and the hardcoded literals in
  `test/selftest.mjs` or the self-test fails, and it trades one *documented* naming divergence for a second
  *undocumented* one against the `/v1` bundles and memos already written under `C:/tmp/dt004-operations`.
  Choose it only if bundles will circulate outside the registration package and must be self-identifying
  without the aggregate.
- **(C) Partial bump** — constant without the self-test literals, or README without the constant.
  **Rejected absolutely:** the first breaks the self-test, the second puts a false claim *inside* the
  aggregate.
- **(D) Add a `schema` field to the sampling record** so the record self-identifies. Rejected: it would
  change `record_sha256` (`lib/sampling.mjs:203`), which is the one quantity DR-1 was careful to leave
  byte-identical, and it would ripple into the seal and every artefact bound to it.
- **(E) Rename the string without a version** (e.g. `…-sampling-evidence-relays/v1`). Rejected: strictly
  worse than (B) — same aggregate cost, and it breaks the naming convention shared by the other 25
  identifiers.

### SCIENTIFIC / INTEGRITY EFFECT
**None either way, and that is the substantive finding.** No registered study artefact carries this schema
string (§4a); `record_sha256` is byte-identical before and after DR-1; the two possible producers of a
`/v1` bundle yield byte-identical registered outputs (§5b.2); and the breaking direction is refused at
runtime by name (§4b). Freezing preserves a fail-closed refusal; bumping would add a string comparison in
front of it. The only measurable difference is §5d's diagnostic case, whose worst outcome is a *waiting*
state rather than a wrong answer. What the freeze **does** require is honesty in the registration package:
the schema string alone does not separate the post-DR-1 shape from the pre-DR-1 shape, and the registered
aggregate is what does.

### REGISTRATION EFFECT
**Option (A), freeze recorded only in the registration package: aggregate UNCHANGED — this decision need
not move `638d68e6…` at all.** Option (A) plus a README sentence, or option (B): **aggregate MOVES**
(`lib/sampling.mjs`, the `lib/evidenceBundle.mjs` comment, `README.md`, `test/selftest.mjs`, and
`test/mutate.mjs` if any anchor quotes the literal). Nothing is registered yet, so no registration is
invalidated: `registration-fields` computes the aggregate at run time. After registration the aggregate is
a registered sampling field (`lib/registration.mjs:119`) and is inside the OP_RETURN digest
(`lib/commitment.mjs:11-12`), and a second registration naming different sampling fields voids the study
(`:140-141`) — so this is the last window in which `/v2` is even possible.

### MUTATION EFFECT
**Option (A) with the freeze outside the tooling tree: none — the live 404-mutant run stays valid for this
decision.** It is the **only one** of the open aggregate-moving items with that property, so it should be
ruled on but need not wait for the final edit session. Option (A)-with-README or option (B) invalidates
that run and requires the full re-certification (self-test, `--anchors`, every mutant KILLED, adapter
conformance, two agreeing rebuilds). Note that DR-11, DR-12, `TOOL_VERSION` and the README row move the
aggregate regardless, so in practice one re-run will happen anyway — which makes the marginal mutation
cost of the optional README sentence effectively zero **if and only if** it is applied in that same
session.

### PROTOCOL EFFECT
**None, under either option.** `EVIDENCE_SCHEMA` is not a `PROTOCOL_MARKER` (`cpg_u1_data.mjs:321-323`) and
the string `sampling-evidence` occurs **0 times** in `CPG_U1_PROTOCOL_004.md`. `verify-protocol` passes
either way. No protocol byte changes, no new protocol version. The §19.3 relay floor that DR-1 implements
is already the protocol's own requirement (`CPG_U1_PROTOCOL_004.md:955`, §19.3; cited in the refusal text
at `lib/sampling.mjs:194`).

### OWNER APPROVAL REQUIRED?
**YES.** No `OWNER DECISION:` or `DECIDED:` line naming `EVIDENCE_SCHEMA` exists anywhere in the corpus
(§1e); the only near-ruling text says **"UNDECIDED"**
(`dt008-prereg/G-randomness/DR1_RELAY_FLOOR_DECISION.md:175`), the memo that raised it says **"This memo
does not choose"** (`dt004-operations/registration/DR1_DRAND_RELAY_FLOOR_MEMO.md:232`), and wave 010 lists
it among five items **"all DECISION REQUIRED"**. This document recommends; it does not decide. **Nothing
has been applied and no schema has been changed.**

### EXACT WORDING TO RECORD
> ## `EVIDENCE_SCHEMA` — sampling-evidence bundle schema identity · OWNER DECISION: ADOPT OPTION (A) — FREEZE `cpg-u1-sampling-evidence/v1`
>
> `cpg-u1-sampling-evidence/v1` (`lib/sampling.mjs:16`) is **frozen**. DR-1, adopted as option (B), made the
> *input* beacon shape breaking — every `--drand-beacons` file must name its relay
> (`lib/evidenceBundle.mjs:41`) and every carried round must be attested by at least two differently named
> relays, §19.3 (`lib/evidenceBundle.mjs:50`; consumer gate `lib/sampling.mjs:193-194`) — and the schema
> version is **deliberately not** advanced to `/v2`.
>
> **Why `/v1` is sufficient.** (1) No registered study artefact carries this schema string; the bundle is a
> verification *input*. The sampling record built at `lib/sampling.mjs:162-204` has no `schema` field and no
> relay data — `drandRelays` is returned *beside* the record at `:204`, never inside it — so `record_sha256`
> (`:203`) is byte-identical before and after DR-1, and no manifest, seal, evaluation, packet, sheet,
> resolution or results artefact changed shape. (2) The breaking direction is enforced, not labelled: a
> pre-DR-1 bundle is refused loudly, naming the relay count and §19.3, at `lib/sampling.mjs:194`. (3) The
> only silently-tolerant direction — a post-DR-1 bundle read by pre-DR-1 tooling — produces a
> byte-identical sampling record, so there is no divergent artefact to disambiguate; and which code did the
> verifying is recorded by `tooling_aggregate_sha256`, a registered sampling field
> (`lib/registration.mjs:119`) inside the OP_RETURN digest (`lib/commitment.mjs:11-12`), re-checked at run
> time (`cpg_u1_data.mjs:179-180`, `lib/sampling.mjs:145`, `lib/harness.mjs:44`), and unique on pain of
> study VOID (`lib/registration.mjs:140-141`). (4) The instrument contains 26 distinct versioned
> `cpg-u1-…` identifiers, every one at `/v1`, plus the unversioned `TOOL_VERSION`
> `cpg-u1-data-tooling-6` (`cpg_u1_data.mjs:49`) — 27 `cpg-u1-*` strings in total; there is no `/v2`
> anywhere in the tree.
>
> **Disclosed with the freeze, so the package does not overclaim.** The schema string alone does **not**
> separate the post-DR-1 shape from the pre-DR-1 shape; the registered tooling aggregate
> `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files) does, and exactly one
> aggregate is registered for `CPG-U1-2026-01`. Therefore any sampling-evidence bundle published outside
> the registration package **must be published together with that registered aggregate**. Recorded
> limitation: because `lib/sampling.mjs:183-189` returns `WAITING_DRAND` before the relay floor at `:193`
> is reached, a pre-DR-1 bundle that does not carry the required round is reported as "round not in
> evidence" rather than as wrongly shaped. The outcome is a waiting state, never a wrong result.
>
> **Answer to "which evidence schema produced the registered study artifacts?"** —
> `cpg-u1-sampling-evidence/v1`, as implemented by the registered tooling aggregate
> `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` (594 files): the post-DR-1 shape, in
> which every beacon entry carries a sorted `relays` array of at least two distinct names. Strictly, no
> registered study artefact carries this string at all; the registered artefacts are governed by
> `cpg-u1-commitment/v1`, `manifest_version: 3`, `seal_version: 4`, `cpg-u1-evaluation/v1`,
> `cpg-u1-rater-packet/v1`, `cpg-u1-rater-sheet/v1`, `cpg-u1-rating-resolution/v1` and `cpg-u1-results/v1`.
>
> **Aggregate:** UNCHANGED, provided the freeze is recorded in the registration package only. Stating the
> freeze inside `tooling/README.md` moves the aggregate and belongs in the single final edit session with
> DR-11, DR-12, `TOOL_VERSION` and the README enforcement row. A partial bump is forbidden: changing the
> constant without the `test/selftest.mjs` literals breaks the self-test; changing the README without the
> constant puts a false claim inside the aggregate. **Protocol: no byte changed, no new version;
> `sampling-evidence` does not occur in `CPG_U1_PROTOCOL_004.md` and `EVIDENCE_SCHEMA` is not a
> `PROTOCOL_MARKER`.**
