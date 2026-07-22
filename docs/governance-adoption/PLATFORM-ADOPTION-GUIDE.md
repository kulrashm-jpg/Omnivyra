# Platform Adoption Guide (OMNI-GOV-002)

How Omnivyra adopts the certified Governance Runtime v1.0.0 as its authoritative constitutional engine — and how that adoption is kept correct, consistent, and exclusive.

## Adoption model

Omnivyra consumes the runtime as an **independent, invoke-only subsystem**:

```
Request → Omnivyra workflow → R3D consumer (spawn published gateway.mjs)
        → Governance Runtime → published admission JSON → application response
```

- **Single engine.** Constitutional decisions come from one place: the frozen runtime. No application code duplicates them.
- **Single seam.** All consumption flows through `backend/services/governance/` (the R3D adapter). No other module imports or spawns the runtime.
- **Feature-flagged, OFF by default.** `ROLLOUT_GOVERNANCE_ADMISSION_MODE = off|shadow|enforce` (default `off`). With the flag off, workflows behave exactly as before.
- **Off the request path.** The runtime is only consulted by designated, latency-tolerant workflows — never a general request dependency.

## What is committed (the authoritative layer)

| Layer | Path |
|---|---|
| Constitutional Runtime + constitution | `docs/company-intelligence/**` |
| Published contracts / release baseline (R1/R2/R3A) | `docs/governance-runtime-v1.0.0/**` |
| Verification + delivery + ops-center tooling (R3A/R3B/R3C) | `scripts/governance-baseline/**` |
| Consumer + validation (R3D) | `backend/services/governance/**`, `scripts/governance-consumers/**` |
| CI workflows | `.github/workflows/governance-{verification,nightly}.yml` |
| Wiring | `package.json` (7 governance scripts), `scripts/predeploy-check.js` (baseline gate), `.gitignore` |
| Docs | `docs/governance-{cicd,ops-center,consumers,adoption}/**` |
| Ownership | `.github/CODEOWNERS` |

Generated artifacts (dashboard, ops-center model, verification reports, consumer-validation) stay gitignored/regenerable.

## Enforcement

- **CI (durable):** `governance-verification.yml` runs baseline + doc verification on push/PR; `governance-nightly.yml` re-verifies nightly with a drift alarm.
- **Predeploy (defense-in-depth):** `predeploy-check.js` blocks `vercel --prod` on baseline drift.
- **Ownership:** CODEOWNERS requires review on every governance integration asset.

## Staged rollout

`off` (default, no-op) → `shadow` (invoke + observe, never blocks) → `enforce` (authoritative, fail-closed for designated workflows). Per-tenant canary via `ROLLOUT_GOVERNANCE_ADMISSION_TENANTS`; instant disable via `ROLLOUT_GOVERNANCE_ADMISSION_KILL` / `ROLLOUT_KILL_SWITCH`.

## Extending adoption

To bring another governance-sensitive workflow under constitutional admission, follow the [Consumer Activation Guide](CONSUMER-ACTIVATION-GUIDE.md): designate the operation, add a flag-gated `evaluateAdmission`/`enforceAdmission` call, and cover it with a test. Do **not** migrate application-domain logic into the runtime (see the [Taxonomy Guide](GOVERNANCE-TAXONOMY-GUIDE.md)).
