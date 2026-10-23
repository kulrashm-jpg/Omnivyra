# DURABLE-HISTORY READINESS DIAGNOSTIC — **PROPOSAL ONLY, NOT IMPLEMENTED**

No endpoint was created. No route, provider registry, configuration, schema or migration was
changed. No production probe was run, no production data inspected, and no secret value read,
printed, copied or logged.

**All four durable-history states remain `NOT VERIFIED`.** Nothing in this note changes that, and
the Report 1 acceptance criterion is not weakened.

---

## 1. The gap this would close, and the gap it would NOT

`historical_store` is already a declared provider slot and `describeProviderReadiness()` already
computes its state and failure reason. **Nothing exposes it**, so the state cannot be read from
production. Verified read-only: `pages/api/analytics/system-state.ts` and
`pages/api/super-admin/ga-analytics-summary.ts` match only the unrelated string
`google_provider_readiness`; neither references `historical_store` nor imports `providerRegistry`.
The function's sole consumer is `backlinkAuthorityProviderBridge.ts`, for a different slot, and it
is not served over HTTP.

**What it would answer:** whether the durable store **registered** in the running process, and if
not, why.

**What it could never answer:** whether a write actually persists — §5.

---

## 2. Audience and enforcement

| | |
|---|---|
| Audience | Platform super-admin / release engineering only. Not tenant users, not tenant admins |
| Surface | One **GET**, read-only, no parameters. Proposed `GET /api/super-admin/provider-readiness` |
| Factory | `createApiRoute(handler, { route: '/api/super-admin/provider-readiness' })` — the convention 1,252 routes already follow |
| Authorization | An in-handler platform guard before any work, matching the existing super-admin pattern (e.g. `pages/api/super-admin/analytics-health.ts` uses `requireSuperAdminGaAccess` inside the handler). The exact primitive should be the one release policy already mandates for platform-tier reads, **not a new one** |
| Method discipline | Anything other than GET → 405 before authorization work |

**Tenant and privilege boundaries.** The payload is **process-level, not tenant-scoped** — provider
registration is a property of the deployment, not of a company. So it must be reachable **only**
through platform authority, never through tenant membership, and it must take **no** company or
tenant parameter. There is nothing to scope, which is exactly why it must not be exposed at tenant
tier: a tenant-visible answer would leak deployment configuration posture to customers.

---

## 3. Minimum fields — and which of the four states each can address

`ProviderSlotReadiness` already exists with the right shape and, importantly, the right discipline:

```ts
export type ProviderSlotReadiness = {
  readonly slot: ProviderSlotKey;
  readonly module: string;
  readonly capability: string;
  readonly availability: ProviderSlotAvailability;   // … | 'CONFIGURED' | 'ADAPTER_LOAD_FAILED' | 'DISABLED'
  /** What an operator must do, as environment-variable NAMES only. Never a value,
   *  never a fragment of one. */
  readonly prerequisite: readonly string[];
  readonly detail: string;
  readonly loadFailure: AdapterLoadFailure | null;   // { slot, module, message, at }
};
```

| State | Field(s) | Can this endpoint establish it? |
|---|---|---|
| **1. Provider registered** | `availability`, `loadFailure` | **YES.** `DISABLED` ⇒ the gate flag was not satisfied; `ADAPTER_LOAD_FAILED` + `loadFailure.message` ⇒ the flag was satisfied but the admin client did not resolve — the case that currently retains the volatile store silently; `CONFIGURED` ⇒ registered |
| **2. Store selected and operational** | would need a new field | **NO, not as it stands.** `availability` reflects registration, not the `isOperational()` probe. A separate, explicitly-labelled field (e.g. `probe: 'ok' \| 'failed' \| 'not_attempted'`) would be required, and running the probe on request is a **database read** — a separate authorization |
| **3. Migration / table confirmed** | — | **NO.** Confirming `report_score_history` exists is a production catalog read. Out of scope for a readiness endpoint |
| **4. End-to-end durable write/read** | — | **NO, and must not be attempted.** It requires a production write |

**Scope recommendation: states 1 only.** Bundling 2-4 turns a read-only registry inspection into a
database-touching probe, which is a materially larger authorization. They should be separate
decisions.

---

## 4. Leak prevention

Most of this is already designed into the existing type, which is the main argument for exposing it
rather than building something new:

1. **`prerequisite` is environment-variable NAMES only** — the type's own contract says "Never a
   value, never a fragment of one". The endpoint must pass it through unchanged and never resolve a
   name to its value.
2. **`describeProviderReadiness()` is read-only** — its own comment records that it "performs NO
   provider call and NO network access", and inspects recorded state after triggering the bootstrap.
3. **`loadFailure.message` is the one real risk.** It originates from a thrown adapter-load error
   and could embed a connection string, host or key fragment. It must be **classified, not
   echoed** — mapped to a bounded label set (e.g. `module_not_found`, `client_unavailable`,
   `config_missing`, `other`) with `at` retained, exactly as `classifyError` already does for the
   route-factory error counter. **Do not return the raw message.**
4. **No secret, no flag value, no connection detail, no tenant data** in the response. The flag's
   *presence* is already known from `vercel env ls`; its value must stay unreadable.
5. **No caching of the payload anywhere a lower-privileged reader could reach it**, and no logging
   of the raw `loadFailure`.

---

## 5. Why a readiness response cannot prove durable persistence

This is the point that must survive into any later decision.

`availability: 'CONFIGURED'` means the module loaded and registered in **this process**. It does
**not** mean:

- the `report_score_history` table exists in the target database — the migration may not be applied,
  and in this programme no deploy mechanism applies migrations;
- the `isOperational()` probe would succeed;
- a write would land and be readable afterwards;
- a *different* serverless instance registered successfully — readiness is per-process, and a
  cold-started instance could differ.

So a `CONFIGURED` answer raises confidence about state 1 and says nothing about states 2-4. The
candidate's honesty fix is what makes that safe: when the volatile store is in use for **any**
reason, `scan_metadata.persisted` is already `false`. The diagnostic would explain *why*; the fix is
what prevents the report from lying in the meantime.

---

## 6. Tests the endpoint would require

| Area | Test |
|---|---|
| Authorization | unauthenticated → 401; authenticated tenant user → 403; tenant admin → 403; platform super-admin → 200 |
| Method | POST/PUT/PATCH/DELETE → 405, before any authorization work or registry read |
| Payload shape | every declared slot present; `historical_store` present with `capability: 'Durable score history (trajectory / forecast persistence)'` |
| State mapping | flag unsatisfied → `DISABLED`; adapter throws → `ADAPTER_LOAD_FAILED` with a **classified** reason; healthy → `CONFIGURED` |
| **Leak prevention** | `prerequisite` contains only variable NAMES; the response contains no value of any declared env var; a `loadFailure.message` seeded with a connection-string-like string is **not** present in the response — the single most important test |
| Non-vacuity | a seeded failure really does change the output, so the healthy assertion is not passing for the wrong reason |
| Read-only | no provider call and no network access during the request |
| Honesty boundary | a test asserting `CONFIGURED` is **not** asserted to imply durable persistence |

---

## 7. Could existing approved evidence answer any of this without a new endpoint?

Assessed honestly; mostly **no**.

| Question | Existing evidence? |
|---|---|
| Is `SUPABASE_HISTORY_ENABLED` set? | **Partly.** `vercel env ls` proves a Production entry exists (Hidden Secret, 41 days). It cannot prove the value is the literal `'true'` the code requires |
| Did the durable store register? | **No.** Per-process runtime state; nothing exposes it |
| Is `report_score_history` applied in production? | **No.** Repo evidence shows it defined in `supabase/migrations/20260601000000_canonical_intelligence_platform.sql`; application would need a ledger read |
| Does a write persist? | **No.** Requires a production write |
| **Does the report currently over-claim?** | **Yes — answered, and that is the one that mattered.** `report1DurableHistoryHonesty` proves `persisted` is `false` whenever the store is volatile, including the registry's retain-volatile-on-failure path |

**Cheaper alternatives worth weighing before building anything:**

1. **A non-production end-to-end test** against a disposable database with the flag on — proves
   states 2-4 for the *code path* without touching production. Strongest value per unit of risk.
2. **An owner-run read of the production migration ledger**, under existing migration-discipline
   procedure, answering state 3 alone.
3. **Nothing at all for now.** The fix already prevents the false claim. The diagnostic improves
   *operability*, not correctness — it tells an operator why durability is off. That is worth
   having, but it is not required for Report 1 to be truthful.

---

## 8. Decision requested

1. Build the states-1-only endpoint as specified, or take alternative 1 or 3 in §7?
2. If built: confirm the platform-authority primitive to use, and confirm `loadFailure.message` is
   **classified, never echoed**.
3. Keep states 2-4 as separate authorizations — probing and migration reads should not ride along
   on a readiness endpoint.

**PROPOSAL ONLY — NOT IMPLEMENTED.**
