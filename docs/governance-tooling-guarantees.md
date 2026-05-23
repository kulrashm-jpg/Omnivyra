# Governance Tooling Guarantees

This document defines the **safety contract** that every governance
tool in the planner / deployment surface must uphold. The contract
exists for one reason: governance tooling is itself a destabilization
vector if it ever mutates state, makes decisions without operator
consent, or behaves non-deterministically. The discipline below
exists so operators can run governance tools with confidence.

> **Pre-commit check.** Before adding a new governance tool to
> `scripts/`, verify it meets every guarantee in §1. If it can't,
> redesign the tool.

---

## §1. The five guarantees

Every governance tool MUST satisfy ALL of the following:

### 1.1 Read-only by default

The tool reads files, queries databases, parses logs. It NEVER:
- Writes to a database (other than its own dedicated diagnostic
  tables, if any — and even those are operator-opt-in).
- Modifies source files.
- Mutates git state (no `git commit`, `git push`, `git tag`).
- Changes environment variables.
- Sends external requests (no Slack pings, no webhook firing).

If the tool needs to do something mutative, it stays read-only and
emits a recommendation. The operator runs the mutation manually.

### 1.2 No auto-mutation

Even with explicit operator action, the tool does not auto-mutate
state that affects production. The line is: "this tool produces
evidence; operators produce outcomes."

A tool may write to its own log file (for diagnostic capture) — that
is data, not state. A tool may emit structured events to stdout —
that is observation, not action.

### 1.3 Explicit operator opt-in

Any behavior that could be construed as side-effectful (network call,
DB query against production, expensive computation) requires an
explicit flag or env variable to enable. Reasonable defaults:
- `--strict` to escalate warnings to failures
- `--write-report <path>` to persist diagnostics
- `--apply` if the tool ever gains a "fix this" mode (currently none do)

Tools do not silently elevate their own permissions.

### 1.4 Deterministic outputs

Same input → same output. Tools rely on stable inputs:
- File system (git ls-files content)
- Database schema introspection (information_schema)
- Standard input stream (JSONL log events)

No tool uses wall-clock time as a primary input (timestamps appear in
output for traceability; they do not drive logic). No tool uses random
sampling, network availability, or cache state to alter behavior.

### 1.5 Idempotent diagnostics

Running the tool twice in a row produces the same diagnostic. No
"first-run-only" side effects. No "this run consumed the input
queue so the next run sees nothing."

The exception: tools may emit structured events to stdout that, if
piped to a log collector, accumulate across runs. That's intended —
it's how operators build a time series. The collector dedups by
timestamp + event signature.

---

## §2. Compliance audit — current governance tools

Every governance tool in this codebase has been audited against §1.
Status table:

| Tool | File | Read-only | No auto-mutation | Opt-in opts | Deterministic | Idempotent |
|---|---|---|---|---|---|---|
| Schema parity verifier | [scripts/verify-schema-parity.js](scripts/verify-schema-parity.js) | ✓ (information_schema reads only) | ✓ | `PREDEPLOY_STRICT_SCHEMA=1` | ✓ | ✓ |
| Predeploy check | [scripts/predeploy-check.js](scripts/predeploy-check.js) | ✓ (git + env reads, calls verifier) | ✓ | `PREDEPLOY_STRICT_SCHEMA=1` | ✓ | ✓ |
| Enforcement readiness evaluator | [scripts/evaluate-enforcement-readiness.js](scripts/evaluate-enforcement-readiness.js) | ✓ (stdin / file reads only) | ✓ | `--input <file>`, `--window-days N` | ✓ | ✓ |
| Retirement readiness scanner | [scripts/scan-retirement-readiness.js](scripts/scan-retirement-readiness.js) | ✓ (git + fs reads only) | ✓ | None required (no destructive options exist) | ✓ | ✓ |
| Worker boot provenance | [backend/workers/main.ts](backend/workers/main.ts) `logBootProvenance` | ✓ (env reads only) | ✓ | N/A — boot diagnostic | ✓ | One emission per boot |

**No tool has been found in violation of §1.** If you add a new tool,
update this table.

---

## §3. Dry-run semantics

Tools that COULD eventually gain mutative capability must expose a
`--dry-run` flag BEFORE they gain that capability — i.e., the dry-run
flag is the default, and `--apply` is the future flag that opts into
mutation. This avoids the trap where someone adds mutation and the
operator habitually invokes the command without checking flags.

Today, no governance tool in this codebase has any mutation path. If
that changes:

1. Add `--dry-run` as a flag that the tool already understands (it's a no-op for read-only tools today).
2. When mutation is added, the new code path is gated on `--apply` (the *opposite* of `--dry-run`, deliberately so dry-run is the safe default).
3. Document the mutation in the tool's header doc.
4. Add the tool to §2 with a note about its mutation capability.

---

## §4. Telemetry emission discipline

Governance tools emit structured events under the canonical envelope
(see [docs/telemetry-taxonomy.md](telemetry-taxonomy.md)). Specifically:

- **One emission per logical operation** (per check, per scan, per
  evaluation). Not per file, not per row.
- **Severity reflects reality.** A schema-parity verifier finding a
  BLOCKING column emits at `critical`. A retirement scanner finding
  an orphan TODO emits at `warn`. Don't escalate to grab attention.
- **Payloads are aggregation-ready.** Avoid embedding human-readable
  prose in payload fields; use structured fields that dashboards can
  filter on.

---

## §5. What is NOT governance tooling

Some scripts in `scripts/` look governance-adjacent but are
operational tooling, not governance tooling. The distinction:

- **Governance tooling**: produces evidence/decisions about platform
  integrity. Read-only.
- **Operational tooling**: performs work (cleanup, recovery,
  one-shot fixes). MAY mutate state when operator-invoked.

Examples of operational tooling (NOT covered by §1):
- `scripts/operator/bolt/bolt-stuck-run-sweeper.js` — performs the
  abandonment sweep. Has the operator-action guarantee model from
  [docs/bolt-planner-stabilization-verification.md](bolt-planner-stabilization-verification.md), but is allowed to mutate `bolt_execution_runs` rows because that is its purpose.

This distinction matters because operational tooling has its own
safety model (overwrite-safe writes, conditional updates, etc.) but
does not need to follow the read-only contract.

---

## §6. Adding a new governance tool — checklist

1. Read §1. Confirm you can satisfy every guarantee. If not, redesign.
2. Add the tool to `scripts/`. Header comment lists which §1
   guarantees the tool upholds (verbatim — not paraphrased).
3. Add to the §2 compliance table.
4. Ensure structured events emitted by the tool appear in
   [docs/telemetry-taxonomy.md](telemetry-taxonomy.md).
5. If the tool has the *capability* (even latent) to mutate state in
   the future, expose `--dry-run` as default per §3.
6. Open a PR. The reviewer's job is to verify §1 compliance, not
   re-derive it.
