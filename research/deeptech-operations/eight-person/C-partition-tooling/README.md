# C-partition-tooling — DEEPTECH-PARALLEL-007 Agent C

**Everything here is a PROPOSAL or an AUDIT. Nothing is registered, decided or committed.
No frozen byte was changed.** The frozen instrument lives at `C:/tmp/dt002/research/cpg-u1/tooling`
(aggregate `f7699f05495f72379903b00195bf44271bbdc75c66cac3185ed0dbb04e5cc5dd`, 593 files) and was read only;
every experiment ran against a byte-identical scratch copy.

## Read this first

| File | What it is |
|---|---|
| **`TOOLING_GAP_AUDIT.md`** | The central deliverable: the capability table for two enumerators, and the answer to the owner's key question — **two enumerators can work today with zero tooling change**, with real command output and exit codes. |
| **`AUDIT_LOG_DESIGN.md`** | Append-only, hash-chained enumeration submission log. Reuses the frozen `lib/eventlog.mjs` chaining primitive; says exactly what it could and could not reuse, and what it does *not* prove. |
| `partition/` | The partition-assignment tool (PROPOSAL), its tests and its mutation harness. |
| `zero-change-evidence/` | The synthetic generator, the verbatim command transcript, and the audit-log demo — so every number in the audit can be reproduced. |

## Scope boundary

I own: **partition assignment, admissibility recording, the contamination-scan invocation path, the audit
log.** Agent D owns duplicate detection, row reconciliation, the final frame merge and the frame hash. I built
no merger and no duplicate detector. Where a test needed one, it is a stub and says so
(`zero-change-evidence/demo_auditlog.mjs` writes a `manifest_stub.json` carrying only `frame_row_hashes`).

One finding crosses the boundary and D should have it: the frozen instrument **already has** an entity-level
duplicate detector — `assertUnique` at `lib/select.mjs:44`, reached from `frameSufficiency` and from both draw
commands. See `TOOLING_GAP_AUDIT.md` §3.3.

## Prior art in this repo, and a conflict

`research/deeptech-operations/dataset/JURISDICTION_PARTITIONS.md` (pre-existing, read-only for me) already
partitions the **same** grid — four jurisdiction families × three outcome classes — and plans per-cell target
**counts** (136/60/40, i.e. 34/15/10 per family). That work and this are complementary: it says *how many per
cell*, this says *which enumerator owns which cell*. They collide on one question — may an enumerator be told
a count at all, given the §4A.2 barrier? My tool takes the strict side and refuses counts in its inputs. The
owner must decide, and it is on the critical path for registration: see `TOOLING_GAP_AUDIT.md` §8.

## Running it

```sh
# the partition tool
node partition/partition.mjs --rule partition/example/partition_rule.json \
     --roster partition/example/enumerator_roster.json \
     --out /tmp/allocation.json --transcript /tmp/transcript.txt

# tests and mutation score (CPG_U1_TOOLING enables the conformance checks against the frozen tree)
CPG_U1_TOOLING=<copy of frozen tooling> node partition/test_partition.mjs   # 76 assertions
CPG_U1_TOOLING=<copy of frozen tooling> node partition/test_auditlog.mjs    # 36 assertions
CPG_U1_TOOLING=<copy of frozen tooling> node partition/mutate.mjs           # 56 mutations

# offline audit-log verification
node partition/auditlog.mjs verify <log.jsonl> [<development_manifest.json>]
```

`CPG_U1_TOOLING` must point at a **copy**. Nothing here writes to `C:/tmp/dt002` or `research/cpg-u1/**`.

## Test and mutation score

`test_partition.mjs` 76 assertions · `test_auditlog.mjs` 36 assertions · `mutate.mjs` **56/56 mutations
killed, 0 survivors**, stable across five consecutive runs.

Two honest notes:

- **First pass killed only 41 of 56.** The 14 survivors and how each was closed are listed in the final
  report; four were genuine *equivalent mutants* (unreachable defensive branches and a clamp that could never
  fire), and the fix was to make the guard reachable or to delete the dead code rather than to weaken the
  mutation.
- **The harness itself was flaky before it was fixed.** On Windows, `cpSync`/`rmSync` over the temp copies
  intermittently threw while a just-exited child still held a directory handle, aborting the sweep with an
  empty report and exit 1 (2 of 3 runs at one point). `mutate.mjs` now retries both operations and prints each
  verdict as it goes, so a crash can no longer be mistaken for a score.

## No real data

No real company, no network (the only `git` invocations were against a throwaway synthetic local repo built
for the scan test), no real frame, no real enumeration, no credentials. `ENUM-ALPHA`, `ENUM-BRAVO`,
`enumerator-a` and `enumerator-b` are role labels, not people.
