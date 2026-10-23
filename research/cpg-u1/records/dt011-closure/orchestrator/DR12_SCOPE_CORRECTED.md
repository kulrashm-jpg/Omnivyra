# DR-12 is a three-file change, not "one line" — and the running certification cannot detect the defect

Wave 010's `DR12_FINDING.md` characterised the fix as *"One line — … It is small, it is local to
`lib/registration.mjs`."* That is **refuted**. Verified by me, read-only against the candidate
`638d68e6…`; nothing written to it.

## Finding 1 — patching `lib/registration.mjs` alone breaks the mutation harness before it starts

`test/mutate.mjs:120`:

```js
['M77 UNASSIGNED treated as assigned', REG,
 "const assigned = (v) => typeof v === 'string' && v.trim() !== '' && v !== UNASSIGNED;",
 "const assigned = (v) => typeof v === 'string' && v.trim() !== '';"],
```

M77's **anchor is the verbatim defective line**. The anchor pre-flight at `test/mutate.mjs:486`
requires each `from` string to occur **exactly once**; after a DR-12 patch to `registration.mjs` it
occurs **zero** times, so `mutate.mjs` prints `ANCHOR?` and exits 1 **before a single mutant runs**.

So the patch must touch `test/mutate.mjs` as well. That is not optional and not cosmetic.

## Finding 2 — the irony that explains why the defect survived certification

**M77 is the mutant that tests this very line.** Its name is "UNASSIGNED treated as assigned" and its
mutation *removes* the `v !== UNASSIGNED` clause. M77 is killed, and has been killed in every run.

What M77 proves is that the clause is **load-bearing** — delete it and the selftest fails. What M77
says nothing about is whether the clause is **correctly normalised**. The defect is not a missing
check; it is a present check that is too weak. Mutation testing measures whether existing assertions
detect the *removal* of behaviour. It cannot detect behaviour that was never asserted.

**Therefore: a 404/404 green certification is fully compatible with the whitespace-and-case bypass.**
The run now in flight will not find DR-12, and its passing must not be read as evidence that the
sentinel guard is sound.

## Finding 3 — the six new mutants would all survive unless `test/selftest.mjs` changes too

`mutate.mjs` kills a mutant by making `test/selftest.mjs` fail. Every `UNASSIGNED` occurrence in the
selftest uses the **exact** sentinel:

| line | usage |
|---|---|
| 420 | `registration_id: 'UNASSIGNED'` |
| 455 | template placeholders, exact |
| 1368 | `reg_noid.json`, exact |
| 1516 | the `PROTOCOL_MARKERS` string list |
| 1800 | `as_of: 'UNASSIGNED'`, exact |

Six occurrences, **not one** of them a whitespace or case variant. No test anywhere uses
`"UNASSIGNED "` or `"unassigned"`. So the stream's caveat is correct: inserted as-is the six new
mutants would **SURVIVE**, reporting 404/410 — the worst possible outcome, since survivors are
exactly what the certification treats as failure.

## Consequence for the single final edit session

DR-12 requires **three files**, in this order of dependency:

1. `lib/registration.mjs` — the normalisation fix itself.
2. `test/mutate.mjs` — M77's anchor updated to the new line (its *to*-string unchanged, so it stays
   the same mutant), plus the six new mutants **M431–M436** (M430 is the highest in use; the retired
   gaps M23–M26, M225, M244, M280–M299 must not be reused).
3. `test/selftest.mjs` — **new assertions**, without which step 2 produces six survivors.

And the anchor count moves **404 → 410**. Every rehearsal artefact and checklist quoting 404 as the
expected anchor count becomes stale at that moment — which is one more reason the five decisions must
land in one sitting rather than piecemeal.

## The pattern this makes twice today

Two independent "green that lies" findings in one wave:

- the README is **inside** the aggregate and makes a **false claim** about another file inside the
  same aggregate (`:116` says the analysis decisions are "all set `UNDECIDED`"; they are `DECIDED`) —
  and the mutation suite cannot catch it, because documentation is not executable;
- M77 is killed on every run while the line it anchors carries a live bypass — because mutation
  testing cannot catch an assertion that was never written.

Both pass certification. Neither is a defect *in* the certification; both are limits of what a
certification means. The honest reading of a forthcoming 404/404 result is therefore: **the executable
behaviour that is asserted is asserted correctly.** It is not: the instrument is correct.
