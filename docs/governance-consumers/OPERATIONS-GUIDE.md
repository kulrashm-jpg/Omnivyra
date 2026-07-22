# Operations Guide

Operating the optional Governance Admission Adapter: rollout, rollback, troubleshooting, diagnostics, and monitoring. The adapter is **off by default**; nothing below changes until an operator deliberately promotes it.

## Rollout (staged)

The adapter uses the reusable Rollout Kit flag `governance-admission`. Promote in stages:

1. **Confirm baseline** — `npm run governance:verify-baseline` → `VERIFIED` (runtime unchanged) and `npm run governance:consumer-validate` → `CONSUMER-VALIDATED`.
2. **Shadow** — set `ROLLOUT_GOVERNANCE_ADMISSION_MODE=shadow`. Admission runs for designated workflows and is recorded, but **never blocks**. Watch the diagnostics for decisions and latency.
3. **Canary** — keep global `shadow`, promote a tenant: `ROLLOUT_GOVERNANCE_ADMISSION_TENANTS=<tenantId>` (that tenant enforces; others stay shadow).
4. **Enforce** — set `ROLLOUT_GOVERNANCE_ADMISSION_MODE=enforce`. Designated workflows are now fail-closed unless the runtime returns `Admitted`.

Env changes are re-resolved per call — no redeploy needed to advance or pause a stage.

## Rollback

- **Instant disable:** `ROLLOUT_GOVERNANCE_ADMISSION_KILL=1` (or the global `ROLLOUT_KILL_SWITCH=1`) → resolves to **off**; the adapter bypasses and the runtime is not invoked.
- **Step down:** set the mode back to `shadow` or `off`.
- **Full removal:** delete `backend/services/governance/` + `scripts/governance-consumers/` + the two npm scripts + the `.gitignore` line + the unit test. Nothing in the frozen runtime, constitution, or any digest is affected — the layer is additive and removable.

Because `off` is the default and the fail-closed behavior is scoped to designated + enforced workflows only, rollback never affects standard AI requests.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Designated workflow blocked with `GovernanceAdmissionDenied` (reason `inactive-constitution` / runtime `Rejected`) | wrong `generation` requested (active is 3) or a genuine rejection | pass the active generation; inspect the runtime's admission ledger |
| Denied with `GOV_CONSUMER_TIMEOUT` | standalone runtime spawn is slow (~40s) under load | raise `timeoutMs`, ensure the orchestrator cache is warm, or run shadow |
| Denied with `GOV_CONSUMER_INCOMPATIBLE` | published VERSION/MANIFEST changed or digest ≠ `4903e8fb` | re-verify baseline; align `SUPPORTED_RUNTIME` only when re-certifying |
| Denied with `GOV_CONSUMER_BAD_OUTPUT` | entrypoint output not the documented JSON | run `gateway.mjs --json` manually; check for stdout contamination |
| Standard AI request affected | operation wrongly added to the designation set | remove it from `GOVERNANCE_DESIGNATED_OPERATIONS` |

## Diagnostics

Every decision produces a machine-readable `GovernanceDiagnostic` (`operation, mode, outcome, decision, durationMs, runtimeVersion, compatible, errorCode, attempts`). Outcomes: `bypassed | admitted | rejected | shadowed | error`.

Operational validation evidence:

```bash
npm run governance:consumer-validate:live   # writes docs/governance-consumers/consumer-validation.json
```

The report records `runtimeUnchanged`, `compatibility`, live `Admitted`/`Rejected` demonstrations, and a `CONSUMER-VALIDATED` verdict. The file is gitignored (regenerable).

## Monitoring

`getAdmissionHealth(tenantId?)` returns:

- **flag state** — mode, source, enabled/enforcing, designated operations.
- **observability snapshot** — `invocationCount`, `bypassCount`, `admittedCount`, `rejectedCount`, `shadowedCount`, `errorCount`, `successRatio`, `averageLatencyMs`, `lastRuntimeVersion`, `lastCompatible`, and coarse `health` (`healthy | degraded | unavailable | idle`).

Metrics also flow to the platform HARDEN-001 registry (fail-safe): `governance.consumer.invocation{outcome,mode}`, `governance.consumer.latency_ms{mode}`, `governance.consumer.error{code}`. Alert when `successRatio` drops in `enforce` mode or `errorCount` climbs — those are the signals that admission is blocking designated workflows.
