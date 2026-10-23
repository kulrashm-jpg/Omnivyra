# FRAME_IDENTITY_CONTRACT — what the frozen frame hash actually binds

**Classification: PROPOSAL / METHODOLOGY ANALYSIS. NOT REGISTERED. NO PROTOCOL CHANGE. NO FROZEN BYTE ALTERED.**
DEEPTECH-PARALLEL-007 · AGENT D (duplicate detection, reconciliation, merge, frame hash) · 2026-09-24

## 0. Baseline, verified here

| Object | Value | How verified |
|---|---|---|
| Protocol | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | `sha256sum research/cpg-u1/CPG_U1_PROTOCOL_004.md` |
| Tooling aggregate | `<NEW_AGG>` | `toolingManifest()` from the frozen `lib/aggregate.mjs`, run on `research/cpg-u1/tooling` |
| Tooling file count | <NEW_N> | same call, `files.length` |
| `FRAME_COLUMNS` | 22 columns, last three `enumerated_by`, `enumerated_at`, `enumeration_source_url` | `lib/schema.mjs` |
| `FRAME_MINIMUM` | `{fill-expected: 126, abstention-expected: 52, identity-hazard: 32}` | `lib/frame.mjs`, derived not typed; 210 rows total (§5.7.2, protocol line 409) |
| `EXCLUSION_REASONS` | 16 entries, closed list | `lib/schema.mjs` |

Analysis was performed by **reading** `C:/tmp/dt002/research/cpg-u1` and by **running** a byte-identical
scratch copy whose aggregate recomputes to `<NEW_AGG>`. `C:/tmp/dt002` was never written to.

## 1. What `frame_hash` is

`cpg_u1_data.mjs:103`, inside `loadFrame` (there is a second, identical computation at `:252`, inside `scan`):

```js
return { frame, checked, frameHash: hashRecords(frame, 'candidate_id') };
```

`lib/canonical.mjs`:

```js
export function canonicalRecords(records, sortKey) {
  const sorted = [...records].sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0));
  return canonicalJson(sorted);
}
export const hashRecords = (records, sortKey) => sha256(canonicalRecords(records, sortKey));
```

So the hash is taken over:

1. the records **sorted by `candidate_id`**, using `<` / `>` on strings — i.e. **UTF-16 code-unit
   order, not collation**. `localeCompare` is not used anywhere in the hashing path. Code-unit order
   puts `'B'` before `'a'`; a locale-aware sort would not. Verified: sorting `['a','B']` through
   `canonicalRecords` yields `B, a`, whereas `localeCompare` yields `a, B`.
2. each record serialised by `canonicalJson`, which **sorts object keys**. So CSV **column order is
   irrelevant** to the hash. (`loadCsv` separately requires the header to be exactly the 22 columns,
   in any order — `missing`/`extra` are set comparisons.)

### 1.1 Order-sensitivity — the precise answer

**The frame hash is order-independent if and only if `candidate_id` is unique across the frame.**
The first half is the useful half; the second half is the hazard, and it is not hypothetical.

`Array.prototype.sort` has been required to be **stable** since ES2019. A stable sort preserves the
relative order of records whose sort key compares equal. Therefore two rows sharing a `candidate_id`
but differing in any other field are serialised **in input order**, and the hash depends on which
enumerator's file was concatenated first.

Measured against the frozen `hashRecords` (test `T14a`/`T14b`):

| Input | Reversing the input order |
|---|---|
| `[{candidate_id:'B',v:'1'}, {candidate_id:'A',v:'2'}]` (unique ids) | hash **unchanged** |
| `[{candidate_id:'X',v:'1'}, {candidate_id:'X',v:'2'}]` (duplicate id) | hash **changes** |

The canonical serialisations differ literally:
`[{"candidate_id":"X","v":"1"},{"candidate_id":"X","v":"2"}]` versus
`[{"candidate_id":"X","v":"2"},{"candidate_id":"X","v":"1"}]`.

**Consequence for a two-enumerator model.** "Just concatenate the two CSVs" is order-independent only
while the two enumerators' `candidate_id` namespaces are disjoint. Nothing in the frame template or
the enumerator instructions (§4A.2 lists what an enumerator receives: public sources, the frame
template, §4A, §5.1–§5.4, the jurisdiction-family list, the development-only registry) assigns id
namespaces. Namespace disjointness is therefore an **operational obligation on whoever allocates
work**, not a property the artefact carries. AGENT C owns the allocation; this analysis owns detecting
its violation.

### 1.2 Is the collision actually caught? Yes — quoted

`cpg_u1_data.mjs:96-102`, `loadFrame`:

```js
  const seen = new Set();
  const checked = frame.map((r) => {
    const res = checkFrameRow(r, { allowSynthetic });
    if (seen.has(r.candidate_id)) res.errors.push('duplicate candidate_id');
    seen.add(r.candidate_id);
    return { r, res };
  });
```

An entry in `res.errors` is a `MALFORMED_ROW`. `cmdFrame` ends with `if (malformed) process.exit(1);`
and `cmdCheckFrameSufficiency` calls `refuseMalformed(checked)`, which is
`fail('… malformed frame row(s) — run "frame" and fix before drawing')`. So a duplicate
`candidate_id` **cannot reach a commitment**: it is refused at `frame` and again at
`check-frame-sufficiency`.

Two residual observations, both honest:

- The duplicate check is **positional**: the *second* occurrence is flagged. Which row is flagged
  depends on file order, so the error message is order-dependent even though the refusal is not.
- `frameHash` is still **computed and printed** for a frame containing duplicates (the computation
  precedes the exit). The number printed in that case is order-dependent and meaningless. It is never
  bound to anything, because the run exits 1 — but an operator copying a hash out of a failed run
  would copy a number that is not reproducible.

### 1.3 Is `candidate_id` enumerator-assigned or derived?

**Enumerator-assigned, and free-form.** `checkFrameRow` constrains only its shape:

```js
if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.candidate_id)) errors.push('candidate_id must be 1-64 of [A-Za-z0-9_-]');
```

There is no derivation from the identifier, the domain or the name, and no namespace or prefix rule.
Two enumerators using the obvious scheme (`C001`, `C002`, …) collide on **every** row.

### 1.4 The compensating property: identity is not selection

`lib/select.mjs`:

```js
const idKey = (c) => `${c.identifier_scheme}:${c.identifier_value}`;
export const rankKey = (seed, c) => sha256(`${seed}|${idKey(c)}`);
```

with the comment *"Keyed on the identifier, so renaming a row cannot re-roll it."* Verified (test
`T13`): `rankKey` is byte-identical for two rows differing only in `candidate_id`.

This is the single most useful fact for a merge. When a duplicate pair collapses into one row, the
merger must choose **which `candidate_id` survives** — and that choice **cannot influence the draw**.
It changes `frame_hash` (a column value) but not the rank order of any row, so it cannot be used to
push a company into or out of a sample. The merge rule "the surviving row keeps the
code-unit-smallest `candidate_id` in the group" is therefore *selection-neutral by construction*, and
that is provable rather than asserted.

`candidate_id` does remain the join key for the contamination scan (`contamination()` fails with
`scan has no result for <id>`), so the scan must be run on the **merged** frame, after the merge, not
on the submissions.

### 1.5 Byte-determinism of the file, not just the hash

The hash tolerates row order; the **CSV artefact does not**, and it is itself sealed (§14's sealed
object list includes both screening logs; the frame is the input to both). Sources of byte
divergence between two submissions that the frame hash would *not* absorb, and what this proposal
does about each:

| Source | Frozen behaviour | Merger behaviour |
|---|---|---|
| Unicode normalisation form (NFC vs NFD) | **not normalised anywhere**; `'Société'` NFC ≠ NFD, different hash, and any exact field comparison sees a spurious conflict | every field is `normalize('NFC')`-ed on input; the count of changed fields is recorded in the transcript (test `T2c–T2g`) |
| Byte-order mark | `parseCsv` strips a BOM only at offset 0 | accepted and absorbed; output carries none (test `T2h`) |
| Line endings | `parseCsv` accepts CR, LF, CRLF; `toCsv` always writes LF | output always LF (frozen `toCsv`) |
| CR/LF **inside** a quoted field | round-trips verbatim, so two enumerators' quoting styles diverge | **refused** — normalising an in-field line ending would alter content |
| Other control characters | not checked | refused |
| Collation / locale | not used (`<`/`>`, `toLowerCase`, never `localeCompare`/`Intl`/`toLocaleLowerCase`) | same discipline, asserted statically (test `T12c`) |
| Clock / timezone | `today()` exists in the CLI but is not used for the frame | merger contains no `Date` at all, asserted statically |
| Input file order | n/a | submissions sorted by (`enumerated_by`, content sha256); argv order never observed |

Measured: identical output bytes under `LANG/LC_ALL` of `tr_TR.UTF-8`, `C`, `de_DE.UTF-8` and
`TZ` of `Pacific/Kiritimati`, `Etc/GMT+12`, `Europe/Berlin` (tests `T2a`/`T2b`). The Turkish locale
is included deliberately: it is the locale in which a locale-aware `toLowerCase` would map `I` to
`ı` and silently change a domain.

## 2. The contract, stated

> **C1.** `frame_hash = sha256(canonicalJson(rows sorted by candidate_id in UTF-16 code-unit order))`,
> with each row's keys sorted. Column order and file row order do not affect it.
>
> **C2.** It is order-independent **iff** `candidate_id` is unique. Duplicate ids make it
> order-dependent via ES2019 sort stability. The frozen `loadFrame` detects duplicate ids and both
> `frame` and `check-frame-sufficiency` refuse, so a duplicate-id frame cannot be committed — but the
> hash it prints before refusing is not reproducible.
>
> **C3.** `candidate_id` is enumerator-assigned and unconstrained beyond `^[A-Za-z0-9_-]{1,64}$`.
> Namespace disjointness is an operational obligation, not an enforced property.
>
> **C4.** The draw is keyed on `identifier_scheme:identifier_value`, never on `candidate_id`. Choosing
> which id survives a merge is selection-neutral.
>
> **C5.** The frame hash does **not** absorb Unicode normalisation form, BOM or in-field line
> endings. A merge must normalise (NFC) or refuse (CR/LF, control characters) to be byte-reproducible.
>
> **C6.** Uniqueness of *entity* (identifier, canonical domain) is enforced only over **admissible**
> rows, by `assertUnique` in `lib/select.mjs`, reached from `frameSufficiency` (`lib/frame.mjs:42`)
> and both draws. Verified messages: `duplicate identifier LEI:L1 — one row per legal entity` and
> `duplicate canonical_domain x.example — one row per legal entity`. In the CLI these surface
> legibly as `FRAME_INVALID: …` (`sufficiencyOf` wraps the call in try/catch), not as a stack trace.

## 3. Timing, corrected

§5.5's *"Rows may never be added, removed, edited, re-identified or reclassified"* binds **after the
development commitment**. §5.7.2 says that if sufficiency is unmet, *"no development commitment may be
made; enumeration continues first"*. So **before** the commitment a short or defective frame is
recoverable by continuing to enumerate, at the cost of calendar time only. The unrecoverable failure
is *committing* to an insufficient frame — `STAGE_VOID_FRAME_INSUFFICIENT`, slot consumed, no retry.

This is why a merge conflict does not need to be force-resolved: the lawful response to "the merge
excluded eight rows and we are now at 124 fill-expected" is **enumerate more**, not **adjudicate**.

It is also why the merger is nonetheless built to refuse rather than guess. The merge, the scan and
`check-frame-sufficiency` all sit on the pre-commitment side of the same one-shot gate, and a merge
defect that survives into the committed frame is not repairable. Refusing costs a day; guessing
costs the study.

> IDENTITY-SWEEP CORRECTION — DEEPTECH-PARALLEL-013 §9 (base af2fb6e9). NOT YET CONSISTENT.
> The superseded instrument identity in this file has been replaced by the PLACEHOLDERS
> `<NEW_AGG>` (tooling aggregate) and `<NEW_N>` (tooling file count). These are placeholders,
> not values. The final aggregate DOES NOT EXIST YET: DR-11 is unresolved and R28/R15/DR-12 are
> being implemented in a new tree. A later SUBSTITUTION PASS must replace both placeholders,
> after the single in-tree README edit session and the one recomputation that follows it.
> Any "verified" / "recomputed" wording on a corrected line attested the SUPERSEDED tree and is
> VOID PENDING RE-ATTESTATION by its original attester — it must not be relabelled.
> Nothing in this file may be relied on for registration until that pass has run.
> Deliberately preserved: references to the known-stale 587-file in-repo tree (aggregate 640510…)
> are TRAP WARNINGS and are correct as written.

