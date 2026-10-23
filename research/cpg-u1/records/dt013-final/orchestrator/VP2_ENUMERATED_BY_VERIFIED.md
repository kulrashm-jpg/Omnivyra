# Orchestrator verification — VP-2 gate and `enumerated_by` (§11, §12)

Read-only. Old run alive, zero files modified under `C:/tmp/dt009-merge`.

## "Inactive" does not exist in the personnel model — CONFIRMED

`lib/personnel.mjs` is **42 lines**. A case-insensitive grep across all of `lib/` for
`inactive|active|revoked|withdrawn|status` returns **zero hits in `lib/personnel.mjs`**. Every hit
elsewhere is unrelated:

| hit | what it actually is |
|---|---|
| `lib/archive.mjs:3` | HTTP response status |
| `lib/evaluationTree.mjs:40` | `git status --porcelain` |
| `lib/harness.mjs:123,125,142,185` | execution status (`REFUSED` / `EXECUTED`) |
| `lib/registration.mjs:44,46` | `status: 'REQUIRED_AT_REGISTRATION'` — a **field-requirement marker**, not personnel state |
| `lib/registration.mjs:139` | `x.withdrawn` — withdrawal of the **registration**, not of a person |

So §12's *"inactive id fails"* **cannot be tested, because the concept is not representable.** There is no
validity interval on a personnel assignment; resolution is against whatever register the operator passes at
`frame --personnel` time. A standing revoked *after* enumeration has no expression.

**This is correctly OWNER DECISION REQUIRED, not a test failure.** The stream was right to refuse to invent
it. Adding it would be an instrument change (aggregate-moving); documenting the absence is free.

## §12 — the other seven checks

22 assertions, 22 passed, using the instrument's own functions imported read-only. Independently consistent
with what I verified in earlier waves: exact roster membership at `lib/enumeration.mjs:45` (not a shape
regex), `PERSON` constraining the **register** and never `enumerated_by`, per-row error accumulation rather
than first-only, and A≠B enforced from two directions.

The **fail-open is unchanged and unclosable operator-side**: `loadFrame` has 7 callers,
`checkEnumerationAttribution` has 1 (`cpg_u1_data.mjs:220`, in `cmdFrame`). Dynamically confirmed — with no
register supplied, resolution is **not attempted at all** while presence is still required. The gate can
bind the verdict in a published artefact, which improves **detectability**; it gives **zero** improvement in
**enforceability**. A second in-instrument call site is the only mechanical fix, and that is an instrument
change — not proposed.

## §11 — the gate is good, and it is honest about what it is not

Genuinely strong engineering: no clock anywhere (`--as-of` is a required *input*, so determinism survives a
required timestamp), recursive codepoint key sort, codepoint comparators rather than `localeCompare`,
files identified by sha256 with no paths recorded, union-find with deterministic cluster ordering — and
**every scenario run twice and compared byte-for-byte**.

The duplicate defence is the part that earns its keep. Coverage counts **clusters, never rows**, linked on
five keys including `wikidata_qid`, registrable-domain suffix and a normalised name — which is exactly the
gap wave work found, where the same entity under a *different identifier* **and** a *different domain*
passes `assertUnique` silently. The certificate proves its own superiority per run: in the duplicate
scenario it records `assert_unique_equivalent_would_pass: true` **while the gate fails**. Cross-family
clusters credit neither family. And the compensation test uses `min` over families, never a sum, recording
`aggregate_only_test_would_have_passed` so the ignored surplus is visible.

All five scenarios behaved as designed — full coverage PASS; absent family FAIL; absent-but-compensated
FAIL with the surplus explicitly uncounted; duplicate-faked coverage FAIL; unexpected family FAIL — plus a
forged-enumerator frame failing at exit 2.

**But §11's "the development commitment must be prohibited while this gate fails" is NOT mechanically
true, and the gate does not claim it is.** That confirms what wave 012 predicted and what I verified myself:
`cmdFrame` contains no `writeOnce`, so there is no frame-stage artefact to write a verdict into, and all
three sufficiency chokepoints (`:659-660`, `:369-370`, and decisively `:444-445` where `draw-development`
re-derives from the **committed** frame and exits `EXIT.VOID`) reach rows only through `frameSufficiency`,
which reads `expected_outcome_class` and `candidate_id` and nothing else.

So the barrier is **PROCEDURAL, with a published pre-commitment artefact whose absence and ordering are
externally detectable.** Publishing the certificate with a registry timestamp before the commitment
broadcast makes the *ordering* checkable — the protocol already relies on that for the seal record — but
ordering proves the certificate existed first, not that a failing one would have stopped anything. The
prohibition rests on one human act: the custodian declining to spend `O_dev` (`cpg_u1_data.mjs:393`, *"The
tooling creates no transaction"*).

Also confirmed: the protocol **permits** missing families. §5.7.1 clause (c) at `:379` requires publication
and says *"missing families are declared as a scope limitation"*, and clause (a) anticipates exhaustion. So
a refusal would contradict the protocol, and making VP-2 mechanical needs both `tooling_aggregate_sha256`
and `protocol_sha256` to move — a restart.

## The operational blocker this surfaced

**The real allocation does not exist.** `F-recruitment/ENUMERATOR_A_ALLOCATION.md` and `_B_` still read
`person_id: UNASSIGNED` and `<<UNFILLED>>`. The expected family set is read from a digest-verified
`cpg-u1-enumeration-allocation/v1` artefact — **not** from `FAMILY_ORDER`, which is only the within-class
round-robin order and could not detect an allocation that omitted or added a family. The gate **refuses
rather than guessing**, which is right.

So §11 is **PREPARED and rehearsed on synthetic data, but not usable for real** until a pre-registered
allocation artefact exists with two named enumerators. That is a personnel dependency, not an engineering
one.

## Minimum coverage threshold

Defaults to **1 distinct entity per allocated family** — the weakest non-vacuous value, chosen because **no
minimum is registered anywhere**. Any higher value is stamped `OPERATOR-CHOSEN, WITHOUT PROTOCOL BASIS`.
That is the correct default: the protocol supplies no number, so inventing one and presenting it as required
would be the same class of overclaim as calling VP-2 a gate.
