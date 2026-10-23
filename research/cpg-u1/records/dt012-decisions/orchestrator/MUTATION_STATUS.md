# DEEPTECH-PARALLEL-012 §11 — status of the running 404-mutant certification

```
CURRENT RUN = PRE-DECISION CANDIDATE / NOT FINAL EVIDENCE
```

Recorded verbatim as §11 requires. No partial verdict was inspected, the run was not killed, and
nothing under `C:/tmp/dt009-merge` was written.

## Measured state — process metadata only

| | |
|---|---|
| parent | PID 4092, `node test/mutate.mjs --jobs 4` |
| started | 2026-09-24 20:10:18 IST |
| elapsed | **6.94 h** |
| alive | yes |
| candidate aggregate, recomputed | `638d68e6085d6894355a6d14ff2628a2e94c657c795a3d795500dbb3fa278fd2` |
| files | 594 |
| candidate files modified today | **0** |

Aggregate recomputed with the instrument's own `lib/aggregate.mjs` `toolingManifest()`, never with
`xargs sha256sum | sha256sum`, which yields a different and wrong value.

## The precise conditional, stated rather than assumed

§11 makes invalidation **conditional**: the run is invalidated as a final certification candidate *"if
any of D-1 through D-7 changes instrument-bearing behaviour or its verification machinery."*

That condition is **not yet formally met, because no decision has been approved.** If the owner
declined all seven, this run would stand as the certification of `638d68e6…`. So the honest status is
the one §11 dictates — **pre-decision candidate** — not "invalidated".

But the condition is **near-certain to be met**, for a reason that is already established rather than
predicted: **D-4 (DR-12) cannot be implemented without touching three files**, two of which are the
verification machinery itself —

1. `lib/registration.mjs` — the normalisation fix;
2. `test/mutate.mjs` — because **M77's anchor at `:120` is the verbatim defective line**, so patching
   `registration.mjs` alone makes the anchor occur zero times and the harness exits 1 at the pre-flight
   (`:486`) before any mutant runs;
3. `test/selftest.mjs` — because all six `UNASSIGNED` occurrences (`:420`, `:455`, `:1368`, `:1516`,
   `:1800`) use the **exact** sentinel, so new normalisation mutants would otherwise **survive**.

Anchor count moves **404 → 410**. Any of D-1, D-2, D-3 or D-5 that lands in code moves it further.

## Consequence for interpretation — including if the run finishes during this wave

The run may complete while wave 012 is in progress. **If it does, its result must still not be
interpreted, reported as a certification, or used to justify registration.** Two independent reasons:

1. §11 and §13 both forbid it, and the final-report constraint is explicit: *no interpretation of the
   running 404-mutant result.*
2. Independently of instruction, a 404/404 result **would not mean what it appears to mean**. Three
   limits are established:
   - **M77 is killed on every run while the line it anchors carries a live bypass.** M77 proves the
     sentinel clause is *load-bearing*; mutation testing detects the removal of asserted behaviour and
     can never detect behaviour that was never asserted. So the suite **cannot find DR-12**.
   - **Zero of the 404 mutants mention `jurisdiction`, `FAMILY` or `orderedClass`** — so neither VP-2
     nor even the protocol-required round-robin is in the mutant population at all.
   - **The README is inside the aggregate and makes a false claim about another file inside the same
     aggregate** (`:116` says the analysis decisions are "all set `UNDECIDED`"; they are `DECIDED`), and
     documentation is not executable, so no mutant can catch it.

The defensible reading of a 404/404 result is therefore: **the executable behaviour that is asserted is
asserted correctly.** It is not: the instrument is correct, complete, or registration-ready.

## The ordering cost, for the owner's timing decision

At 6.94 h elapsed against a ~18 h expectation, roughly **11 h remain**. Letting this run finish and then
applying the approved decisions costs **~11 h + a fresh ~18 h ≈ 29 h** and certifies a tree the
decisions immediately supersede. Deciding first and running once costs **~18 h** and discards the ~7 h
already spent.

A partial application — some decisions now, others later — costs a **third** run and must be avoided.
Since the decisions are being taken together in this wave, that hazard is closed by the wave's design
rather than by a further instruction.
