# ERRATA — registration documents

Recorded by the orchestrator, 2026-09-24. The documents named below are preserved unedited so their
recorded sha256 values stay valid; read this errata alongside them.

## E-1 — AD-1..AD-9 are RECORDED, not UNDECIDED

`REGISTRATION_PACKAGE.md` §1.1, `REMAINING_FIELDS.md` §2 and `OPERATOR_CHECKLIST.md` step A1 state that the
nine analysis decisions are "all UNDECIDED". **That is wrong.** The claim came from misreading the status
sentence of `rules/analysis_decisions.json`, which explains the refusal rule and therefore contains the word
UNDECIDED.

Verified directly in the frozen instrument (`C:/tmp/dt002/research/cpg-u1/tooling/rules/analysis_decisions.json`,
sha256 `a1a1a8c8d93c4eb0377ea7f01ec9f22842902831d39a21f86d42bbcee2b1c5be`, status `DECIDED`, **0 undecided**):

| Decision | Recorded value |
|---|---|
| AD-1 | `EXCLUDE_INVALID_CONFLICT_AND_STALE` |
| AD-2 | `INCONCLUSIVE` |
| AD-3 | `URL_WITHOUT_FRAGMENT` |
| AD-4 | `ENTRY_FOR_DECISIVE_IDENTIFIER` |
| AD-5 | `CALENDAR_MONTHS` |
| AD-6 | `STATED_REFERENCE_VALUES_ONLY` |
| AD-7 | `VOID` |
| AD-8 | `INCONCLUSIVE` |
| AD-9 | `ANY_UNAVAILABLE_ENTRY` |

Consequences: the operator checklist's step A1 is already complete; the frozen aggregate
`f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` **already contains** these values, so no
aggregate change is pending from this source; and `analyze` will not stop with `ANALYSIS_BLOCKED` for this reason.

## E-2 — `provider_configuration_sha256` is machine-computable (H0), not human-supplied

`REMAINING_FIELDS.md` classes it H1. It is a pure function of two files in the frozen clone and equals
`c9a7e9aa559d8fbd49f0ae0b1ea896af40637000329c35602f81abcd53627561`
(`providerConfigurationSha()` against `C:/tmp/cpg049_integration/treatment` at `f01a7eb4…`). It is filled in
`registration_record.DRAFT.json`.

Effect, verified by the orchestrator: `verify-registration` on the draft exits **4** with **9** remaining named
prerequisites instead of 10, and the removed line is exactly the provider-configuration one.

## E-3 — Two deliverable filenames are git-ignored

`.gitignore` lines 50 and 58 (`*_CHECKLIST.md`, `*_RUNBOOK*.md`) ignore `OPERATOR_CHECKLIST.md` and
`BITCOIN_RANDOMNESS_RUNBOOK.md`. They exist on disk but would need `git add -f`, or renaming, if these documents
are ever committed. No commit has been made.

## Remaining prerequisites after E-2 (verified, 9)

Bitcoin wallet-key custodian · accountable OSF identity · persistent identifier type · persistent identifier
value · `registration_id` · `registration_timestamp` · outpoints (`O_dev`, `O_ho`) · checkpoint (height, hash) ·
`as_of`.
