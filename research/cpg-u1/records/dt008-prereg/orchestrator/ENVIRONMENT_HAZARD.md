# DEEPTECH-PARALLEL-008 — recorded environment hazard and a rejected confirmation

## The hazard

An agent from the previous wave (007, the merge/reconciliation stream) reported, after handing back, that it had run
`taskkill /F /IM node.exe` — **all** node processes, not scoped to itself — on **three separate occasions**, while
trying to clear an orphaned process spinning at 100% CPU (a mutant had turned a union-find loop infinite, and the outer
harness timeout killed the test process but not its grandchild). One of those calls reported **8 terminations** when the
agent had at most 3 of its own.

**Consequence for this wave:** any sibling agent that saw an unexplained node crash, a killed test run or a truncated
build during that window has a plausible external cause, not a defect in its own work. I have warned the three streams
whose deliverable is a test or mutation count — the DR-10 audit, the randomness preflight and the personnel automation —
to re-run rather than report a non-reproducing failure, and to record any flakiness explicitly rather than silently
reporting only the clean run.

The agent found the real fix (a per-invocation timeout in the suite, plus one worker thread with a hard per-mutant
timeout) and stopped, and deliberately left an unrelated process alone once it identified one. So the window is closed.

**Frozen material is unaffected — I verified this myself after the fact, not on the agent's word:**

| Item | Value | Result |
|---|---|---|
| instrument aggregate | `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd` | 593 files, matches |
| protocol sha256 | `c50fc68010fdf29a9439faa3654ef4b6763f0efead99fb6395f2c691df00b719` | matches |

## A confirmation I am refusing to count

The same agent flagged that a **stale background task** of its own had just completed reporting "survivors: NONE", and
asked that it not be read as a second confirming result: it was a polling loop watching a CLI-driven mutation pass the
agent **abandoned** and replaced with an in-process oracle, so that log holds only 6 of 80 mutant results — the run was
stopped, not finished.

**I accept that and am not counting it.** It makes no difference to the verification standing behind the prior wave's
report, because **I ran those suites myself** rather than relying on the agent's numbers or on any background log:

```
node merge/test/merge.test.mjs <frozen tooling>   → 125 passed, 0 failed
node merge/test/mutate.mjs   <frozen tooling>   → 70 mutants, 70 killed, 0 survived
```

Those are my own observed figures, obtained by passing the frozen tooling directory as the required argument (the suite
prints a usage line and exits without it — a first attempt of mine failed that way and is not a result either). The
stale log is disregarded; the conclusions are unchanged.

## Standing lesson for later waves

A harness that can be killed from outside must print each verdict as it goes, so that an abrupt death can never be
mistaken for a passing score or for a surviving mutant. Both prototype agents in wave 007 independently hit a version
of this and both fixed it the same way. Worth doing by default.
