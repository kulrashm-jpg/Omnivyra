# DR-11 — delegated decision record

```
DR-11 DECISION AUTHORITY: DELEGATED TO CLAUDE
DR-11 = ADOPT
```

**This is not an owner ruling and must never be recorded as one.** The owner delegated this single
decision; the selection and its reasoning are mine.

## Authoritative sources inspected (directly, not via summary)

| source | what it gave |
|---|---|
| `CPG_U1_PROTOCOL_004.md:383,389` §5.7.2 `[NORMATIVE; DERIVED; APPROVED CPG-043]` | *"`E_c` **is determined by** §5.1–§5.4, using the scan committed in the development payload and the registered registry."* |
| `:390-391` | enforcement named at `check-frame-sufficiency`, `commitment-payload`, `draw-development` |
| `:212` §5.1 | *"**A blank cell is always malformed**, so an omission can never pass for a deliberate 'not established'."* |
| `:414` §5.8 | ineligible admissible companies *"**never enter held-out**"* |
| `:232`, `:237`, `:250` | C1(1)/C1(6) established by the Scanner (§5.4) from **that row's own** tokens |
| `dt009-closure/G-registration/DECISION_DISCLOSURES.md:277-290` | the owner's characterisation of the **same defect class** (DR-10) |
| `cpg_u1_data.mjs:94,101,115` | the frame refuses duplicates; `contamination()` does not |

## The decision, and why it is enforcement rather than methodology

**1. The requirement already exists and is tagged.** §5.7.2 asserts `E_c` **is determined** by the
committed scan. A `scan.results` carrying two entries for one `candidate_id` supplies **two answers**, so a
quantity the protocol declares determinate becomes indeterminate. The rule is in force; the instrument
merely fails to enforce it.

**2. The consequence is categorically forbidden.** §5.8 `:414` — ineligible companies *"never enter
held-out"*. The collapse drops the contaminated entry's basis, so the company clears `c.ineligible`,
survives `lib/select.mjs:93`'s pool filter, and is drawn into held-out. Not a degraded outcome: a
prohibited one.

**3. The protocol's posture on ambiguous input is already explicit.** §5.1 `:212` refuses to let an
omission *"pass for a deliberate 'not established'"*. A duplicate is the same failure wearing a different
shape — two answers passing as one. Refusing it applies the existing posture; it does not introduce a new
one.

**4. Decisive on the "is this a methodological change?" question — the owner has already answered it for
this exact defect class.** DR-10 is the same last-value-wins collapse in `cmdScan`. Its disclosure records:

> **None.** DR-10 touches no protocol clause. It is a defect in the instrument's implementation of
> CPG-C1(1)/CPG-C1(6) contamination scanning, **not a rule change**. Admissibility rules, the development
> registry, the protocol and frame-construction rules are all unchanged.

DR-11 is the same collapse, in the sibling function, over the same CPG-C1(1)/CPG-C1(6) scanning. I am not
extending that ruling to DR-11 — DR-10's ruling governs DR-10. I am using the owner's **recorded
characterisation of the class** to answer whether fixing it constitutes methodology. By that
characterisation it does not. **ADOPT is a tooling clarification.**

**5. The refusal is strictly conservative — it excludes nothing legitimate.** `cpg_u1_data.mjs:94`/`:101`
refuse a frame with a duplicate `candidate_id`, and the scan emits one result per validated frame row. **No
tooling version, current or historical, can emit the duplicate.** So the guard can only reject input no
legitimate producer creates. The asymmetry is total: refusing costs nothing recoverable, collapsing can
contaminate held-out.

**6. The window is closing and does not reopen.** The owner's own DR-10 note — *"No real frame has been
enumerated and no real scan has been produced. This is precisely why the fix is free now."* — holds
identically here. After registration, `tooling_aggregate_sha256` is a `SAMPLING_FIELDS` member and a second
registration with differing sampling fields is **study VOID**.

## Why DECLINE was rejected

It would leave the instrument structurally unable to enforce a prohibition the protocol states
categorically (`:414`), on a defect whose class the owner has already recorded as a fixable implementation
defect — and would foreclose correction permanently at registration. The only argument for DECLINE is that
the defect needs a hand-edited artefact, which lowers its likelihood but not its consequence, and says
nothing about whether the instrument should detect malformed input.

I did **not** weigh implementation convenience, mutation runtime, raising the mutation count, eliminating
every conceivable malformed-input case, or aesthetics.

## Uncertainty and material trade-offs — stated, not smoothed

1. **The protocol does not *state* "exactly one result per frame row"; it is entailed.** I am enforcing an
   entailment from §5.7.2's determinacy clause. Honest weight: high, but it is an interpretation, and a
   reviewer should read §5.7.2 against this record before the aggregate is sealed.
2. **DR-11 is NOT a security control and must never be recorded as one.** An actor who can edit
   `scan.json` can instead zero `repository_hits` on a single entry; no guard catches that. Its value is
   **input hygiene** — converting a silent wrong answer into a loud refusal.
3. **It does not close the replacing-edit hole.** `scan_sha256` is `fileSha(scanPath)`, the hash of the
   edited file.
4. **It moves the tooling aggregate**, so any mutation evidence against `b9250356…` is void. None valid
   exists — the only prior run was against the superseded `638d68e6…` and was terminated.
5. An open follow-on, recorded not resolved: whether §21 step 9 obliges an outsider to **re-run** the
   scanner or merely **re-use** the archived scan. If the latter, the residual hole is wider than §22
   implies.

## Consequences for registration

`protocol_sha256` unchanged · treatment unchanged · evaluation-tree identity unchanged · `registry_sha256`
unchanged · registration identity unchanged. **Only `tooling_aggregate_sha256` moves**, which is expected
and free pre-registration. Disclosure is owed in the decision log and OSF narrative in DR-10's form: **a
pre-registration instrument-defect disclosure, not a protocol amendment and not an owner decision.**

## Exact implementation scope — three tooling files

1. **`cpg_u1_data.mjs`** — inside `contamination()`, after the `frame_hash` and `registry_sha256` checks and
   immediately before `byId` (`:115`): tally occurrences over `scan.results`, and on any count > 1 print
   each occurrence's ordinal with its own `repository_hits`, `registry_matches` and
   `held_out_ineligible_by_scan` — so **the occurrence the old code dropped stays attributable** — then
   `fail(...)` with exit **1** (`EXIT.REFUSED`), naming `scanPath`, writing no artefact. One guard covers
   all four call sites.
2. **`test/selftest.mjs`** — fixtures and assertions pinning exact code **and** message.
3. **`test/mutate.mjs`** — **M468–M471** into the reserved empty block; **no renumbering**; population
   441 → 445.

**Deliberately excluded** (recorded as observation, not recommendation): a `results.length === frame.length`
cardinality check and refusal of unknown ids. Neither is eligibility-bearing once duplicates are refused,
and folding them in would broaden scan semantics beyond the defect.

**Not touched:** Protocol-004, the frozen treatment, the evaluation tree, `rules/development_only_registry.json`.
