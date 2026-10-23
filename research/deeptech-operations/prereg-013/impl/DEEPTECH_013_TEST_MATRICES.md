# DEEPTECH-PARALLEL-013 — §14 targeted test matrices

**PROVISIONAL — PENDING DR-11.**

All matrices live in `test/selftest.mjs`, so the mutation harness (which runs `test/selftest.mjs`
against each mutant) can actually kill the new mutants.

Two new blocks:

- **section 12k** — self-contained library-level matrices for DR-12, R28 and R15.
- **section 14 additions** — CLI-level assertions on `verify-registration`, placed where the existing
  registration CLI assertions live.

## Constructed values only

Every value is constructed in the test. **No external identity, PID, custodian or `as_of` is
fabricated.** The "plausible" cases are obviously non-real strings (`SYN-CONSTRUCTED-…`) whose only
role is to be *not locally refusable* — which is the point under test: surviving a local screen is not
evidence of identity. The attestation fixtures name a constructed `SYN-CONSTRUCTED-REGISTER-OF-RECORD`
and `SYN-CONSTRUCTED-VERIFIER-1`, never a real register or person. The R15 fixtures use throwaway git
repositories created in `mkdtemp`, never the real resolver clone.

### Why R15 uses a synthetic pinned tree

A mutation workspace is `cpSync(ROOT, work)` where `ROOT` is the **tooling** directory. The real
protocol lives one level *up* and is therefore **absent** in every mutant workspace. Any R15
assertion guarded on `existsSync(realProtocol)` would be skipped under every mutant, and M460–M467
would all survive. The matrix instead builds a throwaway git repository containing the two §13.1
provider-configuration paths and a protocol stub that pins it exactly as §7.1 does, so it runs
identically inside a mutation workspace.

## Matrix R28 (§3) — all eleven required cases

| # | case | value | expected class | expected code |
| --- | --- | --- | --- | --- |
| 1 | blank | `''` | EMPTY | `EMPTY` |
| 2 | whitespace-only | `'   '`, `'\t\n '` | EMPTY | `EMPTY` |
| 3 | `UNASSIGNED` | `'UNASSIGNED'` | RESERVED_UNASSIGNED | `RESERVED_UNASSIGNED` |
| 4 | case variants | `'unassigned'`, `'UnAssIgNeD'` | RESERVED_UNASSIGNED | `RESERVED_UNASSIGNED` |
| 5 | surrounding-whitespace variants | `'  UNASSIGNED\t'`, `' unassigned '` | RESERVED_UNASSIGNED | `RESERVED_UNASSIGNED` |
| 6 | `TBD` | `'TBD'`, `'tbd'`, `'T.B.D.'` | SYNTHETIC_PLACEHOLDER | `PLACEHOLDER_TOKEN` |
| 7 | `PLACEHOLDER` | `'PLACEHOLDER'`, `'placeholder'`, `'your-id-here'` | SYNTHETIC_PLACEHOLDER | `PLACEHOLDER_TOKEN` |
| 8 | zero-pattern | `'0000-0000-0000-0000'`, `'0000000000'`, `'0000-0000-0000-000X'` | SYNTHETIC_PLACEHOLDER | `ZERO_PATTERN` |
| 9 | known synthetic markers | `'SYNTHETIC-CONSTRUCTED-1'` / `'MOCK-CONSTRUCTED-ID-1'` / `'a-fake-value-1'` | SYNTHETIC_PLACEHOLDER | `SYNTHETIC_MARKER` / `SYNTHETIC_FOREIGN_MARKER` |
| 10 | plausible value | `'SYN-CONSTRUCTED-0009-1111-2222-3333'` | PLAUSIBLE_BUT_UNVERIFIED | `NO_AUTHORITY_ATTESTATION`, and `isAuthoritative() === false` |
| 11 | "valid type-specific value" | `'SYN-CONSTRUCTED-PID-0009-1111'` **with a complete separately supplied attestation** | VALID_AUTHORITATIVE | `ATTESTED` |

Case 11 is the mechanical answer to §3: because the protocol defines **no** type-specific syntax for
**any** PID type, the only thing that can make a value VALID/AUTHORITATIVE is an explicit external
attestation. Sub-cases, all of which must stay PLAUSIBLE_BUT_UNVERIFIED:

| 11a | the attestation moved onto a different value | binding is on the exact value |
| 11b | no authority / blank authority / placeholder authority / unassigned resolver / no method / non-UTC instant / wrong schema | each confers no authority, each pinned to its own message fragment |
| 11c | a non-object attestation (`'yes'`, `[]`) | confers no authority |

Additional MALFORMED cases the six-class distinction requires:

| 12 | non-string (`42`, `null`, `undefined`) | MALFORMED | `MALFORMED_NOT_A_STRING` |
| 13 | zero-width `U+200B`, bidi override `U+202E`, soft hyphen `U+00AD` | MALFORMED | `MALFORMED_INVISIBLE_CHARACTER` |
| 14 | surrounding whitespace on a legitimate value | MALFORMED | `MALFORMED_SURROUNDING_WHITESPACE` (a **tab** is refused one screen earlier, as a control character → `MALFORMED_INVISIBLE_CHARACTER`) |
| 15 | contains `|` | MALFORMED | `MALFORMED_DELIMITER` |

**The invariant, asserted directly:** none of the fifteen values
`'' · '   ' · 'UNASSIGNED' · 'unassigned' · ' UNASSIGNED ' · 'TBD' · 'PLACEHOLDER' ·
'0000-0000-0000-0000' · 'SYNTHETIC-CONSTRUCTED-1' · 'MOCK-CONSTRUCTED-1' ·
'SYN-CONSTRUCTED-PLAUSIBLE-1' · ' SYN-PADDED ' · zero-width · 42 · null`
reaches VALID_AUTHORITATIVE.

R28 at the registration-check level (four assertions): a MALFORMED identity is a record error; a
reserved placeholder is a record error **even in test mode**; `registration_id` is identity-screened
rather than merely non-empty; a class is returned for every screened leaf.

## Matrix R15 (§4) — all five required outcomes

Fixtures: three **distinct**, syntactically valid sha256 values — `derived` (the current value of the
pinned synthetic tree), `stale` (the real provider-configuration hash of a real earlier state of the
same two files) and `wrong` (a constructed valid-shaped hash). Distinctness is asserted first.

| # | case | recorded value | expected verdict | expected code |
| --- | --- | --- | --- | --- |
| 1 | missing | `'UNASSIGNED'` | **BLOCKED** | `PROVIDER_CONFIG_MISSING` |
| 1a | empty / `'  unassigned  '` / `null` | | **BLOCKED** | `PROVIDER_CONFIG_MISSING` (DR-12 normalisation applies here too) |
| 2 | malformed | `'not-a-sha256'` | **BLOCKED** | `PROVIDER_CONFIG_MALFORMED` |
| 2a | uppercase hex, over-long hex | | **BLOCKED** | `PROVIDER_CONFIG_MALFORMED` (never silently normalised) |
| 3 | wrong valid sha256 | `wrong` | **BLOCKED** | `PROVIDER_CONFIG_MISMATCH`, `derived` reported |
| 4 | **stale** valid sha256 | `stale` | **BLOCKED** | `PROVIDER_CONFIG_MISMATCH`, `derived` reported |
| 5 | exact current | `derived` | **ACCEPTABLE** | `PROVIDER_CONFIG_VERIFIED` |
| 6 | clone is not the §7.1-declared tree | `derived` | **BLOCKED** | `PROVIDER_CONFIG_TREE_MISMATCH` |
| 6a | recorded hash matches the *supplied* clone, but that clone is not the pinned tree | `stale` + wrong clone | **BLOCKED** | `PROVIDER_CONFIG_TREE_MISMATCH` |
| 7 | no clone | `derived` | **NOT_COMPARED** (asserted `!== ACCEPTABLE`) | `PROVIDER_CONFIG_NOT_COMPARED`, message contains `WRONG or STALE` |
| 8 | protocol pins no tree | `derived` | **NOT_COMPARED** (asserted `!== ACCEPTABLE`) | `PROVIDER_CONFIG_NO_PINNED_TREE` |
| 9 | independence | any | the compared value equals `providerConfigurationSha(pinnedTree)` whatever the record says | |

Case 6a is the one that proves the hash is derived independently of the **record**: a record whose
hash is internally consistent with the clone it was handed is still refused when that clone is not
the protocol-pinned tree.

## CLI assertions (section 14)

| assertion | kills | pins |
| --- | --- | --- |
| R28 CLI-1 | M456 | output states exactly what was established, including `EARLIEST entry for CPG-U1-2026-01 in the supplied --identity-registrations list` |
| R28 CLI-2 | M456 | output does **not** match `/complete, public, unembargoed, authoritative/` |
| R28 CLI-3 | — | each unestablished claim is named with its reason |
| R28 CLI-4 | M457 and the classifier wiring | `identity persistent_identifier.value: SYNTHETIC_PLACEHOLDER (SYNTHETIC_MARKER)` and the same for `registration_id` |
| R28 CLI-5 | M455 | exit **1** and `SELF_ATTESTATION_REFUSED` |
| R15 CLI-1 | M465 / wording | `provider_configuration_sha256: NOT_COMPARED (PROVIDER_CONFIG_NO_PINNED_TREE)` |
| R15 CLI-2 | M460, M462 | `provider_configuration_sha256: ACCEPTABLE (PROVIDER_CONFIG_VERIFIED)` |
| R15 CLI-3 | M466 | exit **1** and `PROVIDER_CONFIG_REFUSED: registered provider_configuration_sha256` |
| R15 CLI-4 | M467 | exit **4** and `no resolver clone was supplied` |
| R15 CLI-5 | M465 | `provider_configuration_sha256: NOT_COMPARED (PROVIDER_CONFIG_NOT_COMPARED)` |

The replaced assertion was `…includes('authoritative')`, which accepted the very claim R28 required
to be corrected. It is now three precise assertions, one of which is a **negative** assertion on the
old wording.

## Every negative case fails closed

No negative case in either matrix is satisfied by "something went wrong". Each pins the exact class
and code (library) or the exact exit code and a refusal-specific message fragment (CLI). The
`expectCode`-only pattern the directive warns about is not used.
