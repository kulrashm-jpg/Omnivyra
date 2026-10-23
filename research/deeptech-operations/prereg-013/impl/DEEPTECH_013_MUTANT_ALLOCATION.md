# DEEPTECH-PARALLEL-013 — mutant-ID allocation

**PROVISIONAL — PENDING DR-11.**

One coordinated allocation for all three changes, because all three touch the same files.

## Starting state

| item | value |
| --- | --- |
| population before | **404** |
| highest ID in use before | **M430** |
| retired gaps that must never be reused | M23–M26, M225, M244, M280–M299 (**26** IDs) |

Arithmetic check on the starting state: `430 - 26 = 404`. Confirmed by enumeration — the 404 entries
carry 404 distinct IDs and the only gaps below M430 are exactly the retired ones.

## Allocation

| block | IDs | count | contents |
| --- | --- | --- | --- |
| DR-12 (§6) | **M431–M436** | 6 | sentinel normalisation, one mutant per rule clause |
| R28 (§3) | **M437–M459** | 23 | identity/authority classification and its wiring |
| R15 (§4) | **M460–M467** | 8 | provider-configuration authority |
| **DR-11 — RESERVED, NOT ALLOCATED** | **M468–M471** | 4 | **empty.** No entries. Held for the DR-11 one-line fix, which has no owner ruling and is not implemented. |

Contiguous, non-overlapping, no retired ID reused, **nothing renumbered** (all 404 pre-existing IDs
are present and unchanged; M430 is still the highest pre-existing ID).

## Final population and its arithmetic

```
404  existing
+  6  DR-12  (M431-M436)
+ 23  R28    (M437-M459)
+  8  R15    (M460-M467)
= 441  entries, 441 distinct IDs, highest allocated M467
+  4  RESERVED for DR-11 (M468-M471) — NOT counted, no entries emitted
```

`node test/mutate.mjs --anchors` printed:

```
anchors: 441/441 occur exactly once
```

exit **0**.

## DR-12 population increase

The directive's expected DR-12 increase is **404 → 410 (six cases)**, and exactly six DR-12 mutants
were added — M431–M436. 410 is the population after DR-12 alone; R28 and R15 then carry it to 441.

**No seventh DR-12 case was added.** A zero-width / `Cf` case was considered and is *already* covered
by R28's `MALFORMED_INVISIBLE_CHARACTER` screen and its mutant **M440** (which covers C0/C1 controls,
`U+00AD`, `U+061C`, `U+180E`, `U+200B–200F`, `U+202A–202E`, `U+2060–2064`, `U+206A–206F`, `U+FEFF`,
`U+FFF9–FFFB`). Adding a seventh DR-12 mutant for it would have duplicated M440. 410 is shipped as
the directive specifies; nothing was silently shipped as 411.

## DR-12 — M431–M436

| ID | rule clause | mutation |
| --- | --- | --- |
| M431 | trim before the sentinel comparison | `trimmedFor` stops trimming → `" UNASSIGNED "` read as assigned |
| M432 | compare the sentinel case-insensitively | `.toUpperCase()` dropped → `"unassigned"` read as assigned |
| M433 | **POSITIVE CONTROL** — internal `UN ASSIGNED` stays ASSIGNED | internal whitespace squashed → the mutant must break acceptance of `"UN ASSIGNED"` |
| M434 | empty / whitespace-only stays unassigned | `isEmptyValue` → `false` |
| M435 | **POSITIVE CONTROL** — legitimate values stay assigned | emptiness inverted in `assignedValue` |
| M436 | the DR-12 defect itself, restored | `registration.mjs` compares the sentinel untrimmed and case-sensitively again |

M436 is the mutant that pins the fix. It is subtle and needed care: restoring the defect does **not**
make these records pass outright — it routes them to a *different* refusal (an ISO/hex format error
instead of the named prerequisite). Only an assertion on the **exact blocker string** distinguishes
the two, so the DR-12 registration assertions pin exact messages, e.g.

```
as_of is UNASSIGNED (§7/§19.1: one frozen ISO timestamp, chosen before registration)
registration_id is UNASSIGNED (issued by the registry at registration)
```

together with `!errors.some(e => e.includes('as_of must be ISO-8601'))`.

## R28 — M437–M459

| ID | guard |
| --- | --- |
| M437 | non-string value not MALFORMED |
| M438 | EMPTY not distinguished as its own class |
| M439 | RESERVED/UNASSIGNED not distinguished as its own class |
| M440 | control / zero-width / bidi characters accepted |
| M441 | surrounding-whitespace identity silently canonicalised |
| M442 | value containing the `|` field separator accepted |
| M443 | the instrument's own SYNTHETIC fixture marker no longer detected |
| M444 | synthetic marker matched only as the whole value, not as a substring |
| M445 | reserved placeholder tokens accepted as identities |
| M446 | placeholder token matched case-sensitively |
| M447 | placeholder token evaded by punctuation |
| M448 | zero-pattern identifier accepted |
| M449 | zero-pattern evaded by group separators |
| M450 | **INVARIANT BREACH** — an unattested value promoted from PLAUSIBLE to AUTHORITATIVE |
| M451 | attestation not bound to the exact value it attests to |
| M452 | an insufficient attestation promoted to AUTHORITATIVE |
| M453 | attestation accepted without a UTC resolution instant |
| M454 | attestation's authority / resolver / method not themselves screened |
| M455 | self-attestation inside the registration record accepted |
| M456 | the exit-0 line claims public, unembargoed and authoritative again |
| M457 | `registration_id` not identity-screened |
| M458 | a MALFORMED identity value accepted by the registration check |
| M459 | a reserved-placeholder identity value accepted by the registration check |

## R15 — M460–M467

| ID | guard |
| --- | --- |
| M460 | **the R15 defect restored** — the registered provider hash is never compared with the derived one |
| M461 | a malformed provider hash accepted instead of blocked |
| M462 | the current hash taken from the submitted record instead of derived from the clone |
| M463 | provider hash derived from a clone that is not the pinned evaluation tree |
| M464 | a missing provider hash not blocked |
| M465 | an uncompared provider hash reported as ACCEPTABLE when no clone is supplied |
| M466 | a BLOCKED provider verdict does not stop the command |
| M467 | `--require-provider-config` does not block an uncompared provider hash |

M191 (pre-existing) already covers the *harness's* execution-time provider comparison. R15 fills the
distinct gap at *registration verification*, where the field previously had a presence blocker and a
64-hex shape check and **no comparison at all**.

## The kill trap, and how every assertion avoids it

Measured fact honoured throughout: under a mutant that drops `.trim()`, `"UNASSIGNED "` is *still*
refused — at exit 1, with a whitespace error. So `expectCode: 1`, or any bare "was refused"
assertion, **passes while the mutant survives**.

Every assertion added by this stream therefore pins:

- at library level — the **exact class AND the exact code**, and the message fragment carrying the
  finding;
- at CLI level — the **exact exit code AND a specific message fragment** unique to the intended
  refusal, never merely non-zero.

No assertion anywhere in the new matrices reads "refused" without also pinning which refusal.
