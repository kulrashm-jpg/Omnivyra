# Jira ↔ BJC orchestrator — phase 2 (T1 / Acceptance Criterion)

The explicit layer between Jira and JEV. **Jira never calls JEV; JEV never calls Jira.**
One invocation judges one OMNI Acceptance Criterion. Nothing runs on its own: no hooks,
webhooks, schedules or background work. Nothing in the product imports it.

```sh
node node_modules/tsx/dist/cli.mjs scripts/jev-jira/cli.ts judge-ac \
  --issue OMNI-123 --invoked-by human:<id> [--model <model>] [--write-back]
```

`--invoked-by` is required. `--model` defaults to the pinned `jev-1.13.0`; an explicit value is
sent unchanged (a floating alias such as `jev-latest` is allowed but never reproducible).
Without `--write-back`, Jira is only read.
Credentials come from the environment only. The Jira identity is explicit per run
(`identity.ts`): `JEV_JIRA_IDENTITY=reader` + `JEV_READER_TOKEN` for read-only runs,
`JEV_JIRA_IDENTITY=advisory` + `JEV_ADVISORY_TOKEN` for `--write-back`; both are sent as
`Bearer <token>`. Any other identity (including the provisioning/admin one), a mode mismatch or a
missing token exits 64 before a request. Before any issue is read, the token's live OMNI
permissions (`/mypermissions`) must match the identity — reader: Browse only; advisory: Browse +
Edit; neither may Transition, Create, Delete, Administer Projects or Administer — else exit 6.
`TYPESAFE_API_KEY` (JEV). `JIRA_PROVISION_TOKEN` is never read by the CLI. Exit codes: `0` ok · `2` JUDGMENT_UNAVAILABLE ·
`3` REJECTED · `4` audit not written · `5` Jira error or write-back not WRITTEN · `64` usage.

## Flow

AC + parent Story (explicit field lists, nothing else) → bounded `bjc/1` request (`context.ts`)
→ BJC `judge()` (JEV advisory + deterministic combiner, unchanged) → optional write-back
(`writeback.ts`) → metadata-only integration audit (`bjc-jira-audit-YYYY-MM-DD.jsonl`,
next to the BJC audit, never inside a git work tree).

## Authority

- Writes only JEV Verdict, JEV Confidence, JEV Model and JEV Input Hash
  (`ADVISORY_WRITE_FIELDS`; the client refuses anything else).
- Never sets or clears JEV Advisory Disposition: it is human-only, recorded on the
  "Record Verification" workflow transition, and checked unchanged around a write-back.
- No write path to Verification, Deterministic Result, Kind, Gate Result, Deployment
  Authorized By/At, or status: the client has no transition operation.
- Jira "JEV Verdict" is projected through the combiner: `PASS` only for deterministic PASS +
  SUPPORTS (or SUPPORTS on a judgment AC); any combiner conflict is `CONFLICT`.
- A JEV failure writes nothing to Jira.

## Limitations

- Deterministic evidence is the result **recorded on the Jira AC**; the evidence sha256 is a
  digest of the recorded reference text, not of the artifact.
- Evidence Kinds Lint, Security, Deployment, Manual and Other have no BJC v1 deterministic
  kind; a Deterministic AC using them is rejected.
- AC ID must match `AC-<1-4 digits>`; Story Invariants are one per line (max 20).
