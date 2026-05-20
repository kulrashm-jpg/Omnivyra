# Localhost reconciliation fixtures

Synthetic, deterministic payloads used by `scripts/run-reconciliation.ts`
against a local Supabase. **Never** point this at a non-local DB.

One manifest per file. Each manifest is a single JSON document containing:

```jsonc
{
  "provider":           "openai|anthropic|gemini|audio|image|stripe",
  "providerInvoiceId":  "deterministic id used for idempotency",
  "periodStart":        "2026-05-01T00:00:00Z",
  "periodEnd":          "2026-06-01T00:00:00Z",
  "kind":               "adapter-specific",      // omit for openai
  "providerTag":        "openai_audio|assemblyai|openai_image|image:<name>",
  "usageEventsProviderName": "for image:* tag",  // optional
  "rates":              { ... },                  // when required
  "payload":            { ... }                   // raw provider export
}
```

## File layout

```
scripts/reconciliation-fixtures/
  openai/        happy.json     duplicate.json     malformed.json     orphan.json
  anthropic/     happy.json     duplicate.json     malformed.json     orphan.json
  gemini/        happy.json     duplicate.json     malformed.json     orphan.json
  audio/         happy.json     duplicate.json     malformed.json     orphan.json
  image/         happy.json     duplicate.json     malformed.json     orphan.json
  stripe/        happy.json     duplicate.json     malformed.json     orphan.json
```

- `happy.json`     — well-formed payload, expected ingest path.
- `duplicate.json` — same `providerInvoiceId` as `happy.json`; second apply
                     must return `{status: 'duplicate'}`.
- `malformed.json` — payload that the adapter must tolerate (skip rows + warnings).
- `orphan.json`    — invoice spend with no internal usage_events → matcher emits
                     `missing_attribution` rows.

## How to run

```bash
# Localhost-only env (set by the operator before running)
export SUPABASE_URL=http://127.0.0.1:54321
export RECONCILE_LOCAL_RUNNER=1

# Single provider
npx ts-node scripts/run-reconciliation.ts \
  --manifest=scripts/reconciliation-fixtures/openai/happy.json

# Or via npm script
npm run reconcile:openai
```

The runner refuses to execute when `SUPABASE_URL` does not include a localhost
host pattern (`127.0.0.1`, `localhost`, `0.0.0.0`, `host.docker.internal`,
`kong:8000`) OR when `RECONCILE_LOCAL_RUNNER=1` is not set.
