# JEV Bounded Judgment Contract (BJC) — phase 1

Explicit, bounded, advisory JEV judgments for engineering verification.
Governing design: *JEV + JIRA Remediation and Integration Specification v0.1*.

**Deterministic evidence is authoritative. A JEV judgment is advisory.**
BJC never runs on its own: there are no hooks, no prompt or subagent routing, no
model selection, no background work, and no Jira writes. Nothing in the product
(`backend/`, `pages/`, `lib/`, `components/`, `hooks/`) imports it.

## Use

```sh
# 1. Fill input_hash for a request file
node node_modules/tsx/dist/cli.mjs scripts/jev-bjc/cli.ts hash  --request req.json
# 2. Ask for a judgment (needs TYPESAFE_API_KEY in the environment)
node node_modules/tsx/dist/cli.mjs scripts/jev-bjc/cli.ts judge --request req.json
```

Exit codes: `0` COMPLETED · `2` JUDGMENT_UNAVAILABLE · `3` REQUEST_REJECTED · `4` audit not written · `64` usage.

## Contract

- One request judges one acceptance criterion against the invariants and evidence it carries (`contract.ts`).
- The deterministic result is derived from the evidence items (`combiner.ts`), never from a caller's claim.
- `verdict` is set only when the judgment COMPLETED; every failure gives `verdict: null`, `verification_eligible: false`.
- `verification_eligible` is necessary, never sufficient: BJC authorizes nothing.
- The model must be named explicitly. A floating alias (`*-latest`) is accepted but marked `pinned: false`, `reproducible: false`.
- Credential-shaped text blocks the request before anything is sent (`redaction.ts`).

## Audit

One metadata-only JSONL record per invocation, in `BJC_AUDIT_DIR` or `~/.omnivyra/bjc-audit/`.
The sink refuses any directory inside a git work tree. Records hold ids, hashes, outcome and
error codes. They never hold statements, excerpts, evidence refs, provider bodies or the key.
