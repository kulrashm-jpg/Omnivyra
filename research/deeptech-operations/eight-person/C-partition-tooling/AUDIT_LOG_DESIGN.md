# ENUMERATION AUDIT LOG — design (PROPOSAL)

**DEEPTECH-PARALLEL-007 · Agent C · PROPOSAL.** Not registered, not decided, not part of the frozen
instrument. **No frozen byte was changed.** Reference implementation: `partition/auditlog.mjs`; tests:
`partition/test_auditlog.mjs` (36 assertions, all passing).

## 1. What it is for, and what it is *not* for

An append-only, hash-chained record of **which enumerator submitted which frame rows, and when** —
verifiable offline, by a third party, from published artefacts alone.

It is **not** a merger, **not** a duplicate detector and **not** a source of the frame hash. Those belong to
Agent D. This log observes submissions; it never rewrites, reconciles or merges rows. Its reconciliation
function *reports* findings (including a row claimed twice) and refuses to decide anything.

It is also **not** required for two enumerators to work. The gap audit shows they can work with zero tooling
change. This log is the optional artefact that turns "the two enumerators' work was disjoint" from an
assertion into something a reader can check.

## 2. Did `lib/eventlog.mjs` already provide the chaining primitive? YES — and I reused it.

I checked first. `lib/eventlog.mjs` (frozen, 2 992 bytes) provides exactly the primitive needed:

| Element | Frozen `eventlog.mjs` | Reused verbatim here |
|---|---|---|
| `GENESIS` | `'0'.repeat(64)` | **yes** (asserted equal in test L29) |
| Sequence rule | `e.seq !== i + 1` → break | **yes** |
| Link rule | `e.prev_event_sha256 !== prev` → break | **yes** |
| Event hash | `const { event_sha256: _omit, ...body } = e; return sha256(canonicalJson(body))` | **yes, character-for-character** (asserted byte-identical in test L30) |
| Storage | one JSON object per line, LF-terminated, `appendFileSync`, never rewritten | **yes** |
| Append discipline | read-and-verify the whole chain *before* appending | **yes** (test L23b proves an append to a broken chain is refused and writes nothing) |
| Honest limit | *"A truncated TAIL or a substituted whole log is NOT detectable from the file alone: the head hash must be published (procedural)."* | **yes — carried over unchanged**, tests L12/L13 |

**What I could not reuse, and why.** The frozen module's two exported *functions* cannot be called for
enumeration events, because `readEventLog` enforces two frozen constants that do not admit them:

```js
export const EVENT_LOG_SCHEMA = 'cpg-u1-harness-event/v1';
export const EVENT_TYPES = Object.freeze(['LOG_OPENED', 'RUN_STARTED', /* … harness only … */]);
…
if (e.schema !== EVENT_LOG_SCHEMA) throw new Error(`event ${i + 1}: schema must be ${EVENT_LOG_SCHEMA}`);
if (!EVENT_TYPES.includes(e.type)) throw new Error(`event ${i + 1}: unknown type ${e.type}`);
```

Changing either is a frozen-byte change that moves the tooling aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, which is the value that goes into the
registration. So, pre-registration, `auditlog.mjs` is a **faithful re-instantiation of the same algorithm
over its own schema**, with a test that proves the hashes agree — rather than a fork of the algorithm.

**The exact diff if the owner ever adopts it into the frozen tree** (three lines, `lib/eventlog.mjs`):

```diff
-export const EVENT_LOG_SCHEMA = 'cpg-u1-harness-event/v1';
+export const EVENT_LOG_SCHEMA = 'cpg-u1-harness-event/v1';
+export const ENUMERATION_LOG_SCHEMA = 'cpg-u1-enumeration-event/v1';
 export const EVENT_TYPES = Object.freeze([
-  'LOG_OPENED',
+  'LOG_OPENED', 'PARTITION_ASSIGNED', 'ROWS_SUBMITTED', 'SUBMISSION_REJECTED', 'ENUMERATION_CLOSED',
```
…plus threading a `schema` argument through `readEventLog`/`appendEvent`. **Not recommended before
registration.** The out-of-tree log gives the same assurance at zero aggregate risk.

## 3. Record format

One JSON object per line. `schema: "cpg-u1-enumeration-event/v1"`. Every line carries
`schema, seq, prev_event_sha256, type, at, event_sha256` plus its type's fields.

| Type | Fields | Meaning |
|---|---|---|
| `LOG_OPENED` | `protocol_sha256`, `tooling_aggregate_sha256` | Binds the log to the exact protocol and instrument in force. Must be event 1 (enforced; test L15b). |
| `PARTITION_ASSIGNED` | `person_id`, `allocation_digest` | This enumerator was given this allocation. `allocation_digest` is the digest emitted by `partition/partition.mjs`, so the log binds to the pre-registered partition. |
| `ROWS_SUBMITTED` | `person_id`, `row_sha256[]` | This enumerator submitted these rows. Hashes sorted ascending, no duplicates (both enforced). |
| `SUBMISSION_REJECTED` | `person_id`, `row_sha256[]`, `reason` | A submission the operator refused (malformed, out of allocated scope, duplicate). Recorded, never deleted. |
| `ENUMERATION_CLOSED` | `frame_hash` | The frame is frozen at this hash. Ties the log to `frame_hash` from `cpg_u1_data.mjs frame`. |

`at` is a **date** (`YYYY-MM-DD`), never a timestamp — see §5.

### Why `row_sha256` and not candidate ids
`row_sha256` is `sha256(canonicalJson(row))` — **the same function the frozen tooling already applies**
(`rowHash` at `cpg_u1_data.mjs:100`, published per `candidate_id` as `frame_row_hashes` in the development
manifest, `:421`). Two consequences:

1. **Offline verifiability with no new published artefact.** A reader takes the published development
   manifest, reads `frame_row_hashes`, and checks the log against it. Nothing new has to be published by the
   frozen tooling.
2. **The log itself names no company.** A row hash is opaque. The log can be published in full while the
   frame is still restricted.

Because the hashed row *includes* `enumerated_by`, a submitted row hash is only reproducible by someone
holding the row exactly as that enumerator wrote it. An enumerator cannot later claim a row it did not write,
and the operator cannot silently reattribute one.

## 4. Verification, offline, in two steps

```sh
node partition/auditlog.mjs verify enumeration_audit.jsonl              # chain only
node partition/auditlog.mjs verify enumeration_audit.jsonl manifest.json  # chain + reconciliation
```

**Step 1 — the chain.** `readAuditLog` walks every line: schema, `seq === i+1`, `prev_event_sha256 ===`
predecessor's `event_sha256`, `event_sha256` recomputes, type is in the closed set, per-type fields valid,
event 1 is `LOG_OPENED`. Any break throws and names the line.

**Step 2 — reconciliation against the published frame.** `reconcileWithFrame(events, frame_row_hashes)`
reports, without deciding anything:
- a row hash claimed by two enumerators (`claimed by X and again by Y`);
- a submitted row absent from the published frame;
- a published row no enumerator submitted;
- `per_enumerator`: the count of published rows each enumerator actually contributed.

Real output on the 210-row synthetic two-enumerator frame from the gap audit:

```
$ node auditlog.mjs verify enumeration_audit.jsonl manifest_stub.json
audit log verified: 6 event(s); head 6deeba8ebb68cec469a929edaa3ab6a922bb18b1d42a56b7e96a1174e07d36d0
rows claimed 210 of 210 published; per enumerator {"ENUM-ALPHA":105,"ENUM-BRAVO":105}
exit=0

$ node auditlog.mjs verify tampered.jsonl manifest_stub.json     # one row hash altered
AUDIT LOG REFUSED: event 4: event_sha256 does not recompute (event altered)
exit=1
```

(`manifest_stub.json` is a **stub** carrying only `frame_row_hashes`, computed with the frozen
`rowHash`/`canonicalJson`. The real field is written by `draw-development`, which needs the full registration
and commitment chain and was correctly not run. **Stated as a stub, as required.**)

**The published head hash is load-bearing.** Exactly as the frozen `eventlog.mjs` warns, a truncated tail or
a wholesale substitution is not detectable from the file alone. Test L12 demonstrates that a 4-event
truncation verifies cleanly; test L13 demonstrates that the *published* head detects it. So the operator must
publish the head hash at `ENUMERATION_CLOSED` — ideally inside the §5.5.3 commitment payload's orbit, or at
minimum alongside the frame hash. This is **procedural**, not enforceable by the log.

## 5. Privacy — what the log may never contain

The log records, per person, **only the pseudonymous `person_id` the personnel register already uses**
(§4A.1: *"a pseudonymous ID is used in study artifacts"*), constrained to the register's own form
`[A-Za-z0-9_-]{1,64}`.

**Dates, never timestamps.** `at` must match `^\d{4}-\d{2}-\d{2}$`; a clock time is refused (test L16). A
wall-clock timestamp is deanonymising: a sequence of submission times reveals a person's working hours and so
their time zone, their weekend, their religious observance and their employment pattern. The frozen frame's
own `enumerated_at` is already date-only, so this loses nothing and matches the instrument.

**Refused or absent by construction:** company names, domains, identifiers, URLs, file paths, machine or
host names, IP addresses, e-mail addresses, user agents, tool versions beyond the two published hashes, and
any free-text field other than `reason` on a rejection (which describes the *defect*, never the person).
Test L05 asserts the produced log matches none of `@`, `.com`, `.example`, a drive letter or `http`.

**Net effect:** publishing the whole log in full discloses no company and no natural person beyond the
pseudonym the protocol already publishes.

## 6. What this log does NOT prove

Stated plainly, because an audit log invites over-reading:

1. **It does not prove an enumerator did the work.** It proves who *submitted* which rows. Independence of
   judgement is §4A declaration territory — *"procedural evidence, not proof"*, in the protocol's own words.
2. **It does not prove the frame is unbiased.** §19.3 risk 31 ("operator authors a globally biased frame")
   is *"UNRESOLVED by sampling integrity"* and rests on enumerator independence alone. Splitting the work
   between two enumerators narrows the aperture for a single biased author; it does not close it, and this
   log does not claim otherwise.
3. **It does not detect a substituted whole log or a truncated tail** without the published head (§4).
4. **It does not detect the same company enumerated twice under different identifiers.** It detects the same
   *row hash* claimed twice. Entity-level duplication is Agent D's.
5. **It is not the frame hash.** `frame_hash` comes from `cpg_u1_data.mjs frame` and from nowhere else.

## 7. Adoption path (owner's decision, not mine)

| Step | Frozen bytes touched |
|---|---|
| Publish nothing; two enumerators concatenate (gap audit §4) | **none** |
| Pre-register a partition rule, publish `allocation_digest` | **none** (tool lives outside the tree) |
| Keep and publish this audit log + its head hash | **none** |
| Fold the log into `lib/eventlog.mjs` | three lines + a schema parameter; **moves the tooling aggregate** — must precede registration or not happen at all |
