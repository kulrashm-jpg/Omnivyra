# The M77 anchor failure is LOUD, not a phantom survivor — D-1's top risk is refuted

The D-1 stream listed as its **highest** risk a "mutation-anchor trap": that editing
`lib/registration.mjs:69` without updating M77 would make `String.replace(from, to)` a silent no-op
(`test/mutate.mjs:510`), so M77 would run as an unmodified clone, the selftest would pass, and `classify`
would return **SURVIVED** — *"389/389 silently becomes 388/389 with a phantom survivor, looking like a
real coverage regression while pointing at the wrong thing."*

**That is wrong, and the opposite is true.** Verified read-only against the candidate.

## The decisive lines

`test/mutate.mjs:484-490`:

```js
let failedAnchors = 0;
for (const [name, file, from] of MUTATIONS) {
  const count = readFileSync(join(ROOT, file), 'utf8').split(from).length - 1;
  if (count !== 1) { failedAnchors++; console.log(`  ANCHOR?  ${name} (${count}x in ${file})`); }
}
console.log(`anchors: ${MUTATIONS.length - failedAnchors}/${MUTATIONS.length} occur exactly once`);
if (anchorsOnly || failedAnchors) process.exit(failedAnchors ? 1 : 0);
```

Two facts settle it:

1. **The anchor loop is unconditional.** It is a plain `for` over `MUTATIONS`, not gated by `--anchors`.
   `anchorsOnly` (`:13`) only affects whether the process *stops after* the check.
2. **`failedAnchors > 0` ⇒ `process.exit(1)`** at `:490`, which is **before** `runMutant` is ever
   called, and therefore before `:510` is reachable.

So editing line 69 without updating M77 produces:

```
  ANCHOR?  M77 UNASSIGNED treated as assigned (0x in lib/registration.mjs)
anchors: 403/404 occur exactly once
<exit 1>
```

**No mutant runs. No phantom survivor. No misleading coverage number.** The failure is immediate,
named, and points at exactly the right line.

## Why the stream got it wrong, and why that matters

Its reasoning about `:510` is correct *in isolation* — a non-matching string `from` passed to
`String.replace` is indeed a silent no-op. The error was reasoning about one line without checking the
guard upstream of it. `:510` is unreachable in the scenario described.

(A secondary tell: the stream quoted **389/389**, the wave-002 mutation count, rather than the current
**404**. The authoritative count is the one the harness prints, not a figure carried from an earlier wave.)

This correction matters because the two accounts give **opposite operational guidance**:

| | if the stream were right | what is actually true |
|---|---|---|
| failure mode | silent phantom survivor | loud abort, exit 1 |
| what the implementer sees | a coverage regression pointing at the wrong thing | `ANCHOR? M77 … (0x in lib/registration.mjs)` |
| risk of shipping unnoticed | real | **none** |
| where it belongs | top of the risk register | a routine, self-announcing precondition |

## What still stands

The **requirement** is unchanged and was never in doubt: **a DR-12 patch must update `test/mutate.mjs`
along with `lib/registration.mjs`**, because M77's `from` string at `:120` is the verbatim defective
line. That is exactly why this wave records DR-12 as a **three-file** change — `registration.mjs`,
`mutate.mjs`, and `selftest.mjs` (the last because all six `UNASSIGNED` occurrences use the exact
sentinel, so new normalisation mutants would otherwise genuinely survive).

What changes is the **character of the hazard**: it is a precondition the harness enforces for you, not
a trap that can bite silently. The instrument is better here than the risk register claimed.

And the genuinely silent hazard remains the one already recorded, which is different in kind: the
**anchor pre-flight ran at start against the pre-edit tree and does not run again**, so an edit landing
*mid-run* would not be re-detected. That is the reason for the firewall, and it is unaffected by this
correction.

## Second correction carried from the same stream — this one accepted

**The R28 surface is four leaves, not five.** `as_of` is **not** vulnerable: it carries an anchored
`ISO_UTC` validator, so every placeholder tested yields exit 4 or exit 1 and **never exit 0**. Two
independent streams reached this, and it is the same *type-constrains-value* pattern being recommended as
the fix — an existence proof inside the same file. The four exposed leaves are
`accountable_identity.value`, `persistent_identifier.type`, `persistent_identifier.value` and
`bitcoin_key_custodian.value`.
