# Portability note (orchestrator)

`preflight.mjs` resolves the protocol file relative to its own location
(`../../../cpg-u1/CPG_U1_PROTOCOL_004.md`). Run from the worktree it was written in
(`C:/tmp/dt4-exec/research/deeptech-operations/execution/tools`) it exits 0:
"OFFLINE PRECONDITIONS SATISFIED (0 failed, 0 not run, 10 checks)" — verified by the orchestrator.

Run from this relocated copy the protocol check FAILs with "file not found" and the verdict becomes
NOT READY (exit 2). That is the copy's path, not a study defect. Pass the protocol explicitly:

    node preflight.mjs --protocol C:/tmp/dt002/research/cpg-u1/CPG_U1_PROTOCOL_004.md

Everything else in the table passed from the relocated copy, including the instrument aggregate,
the resolver clone state, the provider configuration SHA and adapter conformance 18/18.
