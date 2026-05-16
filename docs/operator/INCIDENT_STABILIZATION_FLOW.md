# Incident Stabilization Flow

Keep the first pass small. The aim is to stabilize, not to redesign under pressure.

## 1. Detect

- Identify the failing surface: login, auth sync, billing, queue, API, startup, env, or CI.
- Capture the visible symptom and when it started.
- Avoid running repair tools until the target environment and blast radius are clear.

## 2. Diagnose

- Run `npm run diagnose:platform-health`.
- Run the focused diagnostic if needed:
  - `npm run diagnose:startup`
  - `npm run diagnose:environment`
  - `npm run diagnose:operator-safety`
  - `npm run diagnose:runtime`
- Read warnings as investigation leads, not automatic fixes.

## 3. Isolate

- Stop overlapping operator actions.
- Keep startup, migrations, auth repair, and billing repair separate.
- Prefer readonly inspection before mutation.
- If production is involved, confirm the target env and credentials before any operator command.

## 4. Verify Contracts

- Use stability tests for the affected area where practical.
- For auth incidents, verify login, session shape, user sync, and company context assumptions.
- For billing incidents, verify ledger/idempotency assumptions before retries or backfills.

## 5. Contain Or Roll Back

- Use the smallest operator action that addresses the known issue.
- Do not combine cleanup, migration, and repair in one action unless the script explicitly owns that flow.
- If a recent change caused drift, prefer reverting that change over adding new behavior during the incident.

## 6. Confirm Recovery

- Re-run diagnostics.
- Verify the user-facing flow.
- Note any deferred cleanup separately from the immediate stabilization.
