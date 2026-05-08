# Wave 3B Readiness — Final Verdict

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Verdict**: 🛑 **B. BLOCKED**

---

## Verdict

**Wave 3B is NOT yet executable.** Schema is ready and code is correctly wired, but two operator-action prerequisites remain unmet. Code-agent action cannot satisfy them — they require human-in-the-loop interaction with the live system.

**STOP**. Do not start Wave 3B.

---

## Evidence summary (per-prerequisite)

| # | Prerequisite | Evidence | Status |
|---|---|---|---|
| 1 | At least one DB-backed SUPER_ADMIN exists | `SELECT count(*) FROM user_company_roles WHERE role='SUPER_ADMIN' AND status='active'` → **0** | ❌ blocking |
| 2 | SUPER_ADMIN has passkey enrolled | `SELECT count(*) FROM webauthn_credentials WHERE revoked_at IS NULL` → **0** (any user) | ❌ blocking |
| 3 | SUPER_ADMIN has phishing-resistant step-up verified | `SELECT count(*) FROM stepup_sessions WHERE revoked_at IS NULL AND expires_at > now() AND factor='webauthn'` → **0** | ❌ blocking |
| 4 | Wave 3A dry-run telemetry window observed | `SELECT count(*) FROM capability_audit_log WHERE decision='bridge_authority_rejected'` → **0** events; flag has never been enabled | ❌ blocking |
| 5 | Bridge dependency map reviewed | [bridge-dependency-map.md](../security-wave3a/bridge-dependency-map.md) generated; no reviewer sign-off recorded | ❌ blocking (operator review only) |

| Layer | Status |
|---|---|
| Migration applied | ✅ — all 9 tables, RLS, indexes, FKs, immutability triggers, vault wrappers verified live |
| Source code wiring | ✅ — bootstrap route + passkey + step-up + session minting + dry-run flag all wired |
| Wave 3A schema-bug patch | ✅ — `revoked_at` references corrected to `status`/`deactivated_at`; typecheck exit 0 |
| Audit infra liveness | ✅ — INSERT round-trip succeeded; UPDATE/DELETE triggers blocking as designed |
| Vault RPC liveness | ✅ — create/get/delete round-trip succeeded |
| Env validator wiring | ✅ — hard-fail closed; no silent defaults; not runtime-verified (cannot inspect operator env) |

---

## Remaining operational actions before Wave 3B can begin

### Operator-only (cannot be code-driven)

1. **Set required env vars** in the target deploy environment(s):
   - `WEBAUTHN_RP_ID` — hostname only, no scheme
   - `WEBAUTHN_RP_ORIGIN` — full URL with scheme; must be HTTPS in prod; host must equal RP id or be a subdomain
   - `SESSION_COOKIE_SECRET` — ≥32 chars, randomly generated; rotation requires deliberate session invalidation
   - `SUPER_ADMIN_BOOTSTRAP_TOKEN` — ≥32 chars, single-use; **unset after step 4**

2. **Provision the first DB-backed SUPER_ADMIN** by following the runbook in [bootstrap-flow-validation.md](bootstrap-flow-validation.md) §Verdict:
   - Sign up the operator user via standard signup flow
   - Enroll a passkey at `/settings/security` (creates `webauthn_credentials` row)
   - Complete a phishing-resistant step-up via `/api/auth/step-up/verify` (creates `stepup_sessions` row, factor=`webauthn`)
   - `POST /api/admin/bootstrap-super-admin` with `{"mode":"bootstrap","bootstrapToken":"<env value>"}`
   - Verify response 201 + `super_admin_bootstrap_completed` audit row written
   - Unset `SUPER_ADMIN_BOOTSTRAP_TOKEN`

3. **Run `LEGACY_BRIDGE_DRY_RUN=1`** in a representative non-prod environment for **≥7 consecutive days** while exercising real traffic patterns. Use the queries in [bridge-dry-run-validation.md](bridge-dry-run-validation.md) §4 to inspect:
   - `bridge_authority_rejected` count must reach **0** (or every nonzero capability migrated/explained)
   - Production `via_legacy_bridge=true` count must remain **0** during the window

4. **Reviewer sign-off** on:
   - [trust-authority-map.md](../security-wave3a/trust-authority-map.md)
   - [runtime-reachability-map.md](../security-wave3a/runtime-reachability-map.md)
   - [bridge-dependency-map.md](../security-wave3a/bridge-dependency-map.md)
   - [role-string-classification.md](../security-wave3a/role-string-classification.md)

### Side-effects of this readiness verification

- One probe row in `capability_audit_log`: `capability='test.readiness.probe'`, `reason='wave-3b readiness verification'`. Permanent (audit immutable). Filterable by reason.
- One probe call to `vault.create_secret` with name `security:readiness-probe`. Followed by `security_delete_secret`; whether the underlying `vault.secrets` row remains is not directly verifiable from this position. If lingering, it can be cleaned via service-role call to `public.security_delete_secret(<uuid>)` after locating by name.

---

## Final readiness counts

| Metric | Value |
|---|---|
| DB-backed SUPER_ADMIN count | **0** |
| Passkey-enrolled SUPER_ADMIN count | **0** |
| Active phishing-resistant step-up SUPER_ADMIN count | **0** |
| Duplicate trust authorities | **2** (legacy cookie bridge + DB user_company_roles; unchanged from Wave 3A) |
| Route-local auth parsers | **~60** (`requireSuperAdminUser` consumers; unchanged) |
| Authorization role-string paths | **4** (Class C: `external-apis/index.ts:141`, `presets.ts:162`; Class E: `free-credits/grant.ts:113`, `requests.ts:116`) |
| `profiles.is_super_admin` authorization paths | **0** (`profiles` table does not exist in remote DB; presumed dead in source as well) |
| Variant contamination | **0** |
| Runtime cycles | **≤18** (unchanged) |
| Runtime DB writes | **≤588** (unchanged) |
| Unsafe propagation | **≤6025** (unchanged) |
| Typecheck errors | **0** |

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `mcp__supabase__execute_sql` (table existence) | Confirm 9 security tables present | ✅ all present |
| `mcp__supabase__execute_sql` (pg_class + pg_indexes + pg_policies join) | RLS enabled per-table, index counts, policy counts | ✅ matches migration intent |
| `mcp__supabase__execute_sql` (information_schema.referential_constraints) | All FKs + delete rules | ✅ matches migration |
| `mcp__supabase__execute_sql` (information_schema.triggers) | `capability_audit_log` immutability triggers | ✅ both present |
| `mcp__supabase__execute_sql` (INSERT probe) | Audit table writable | ✅ row written |
| `mcp__supabase__execute_sql` (UPDATE/DELETE probe) | Triggers actually block mutations | ✅ both blocked |
| `mcp__supabase__execute_sql` (vault wrapper round-trip) | TOTP enrollment infra functional | ✅ create/get round-trip correct |
| `mcp__supabase__execute_sql` (count probes) | Live runtime state of principals/passkeys/sessions | 0 across the board |
| `npx tsc --noEmit -p tsconfig.json` | Wave 3A schema-patch did not regress typecheck | exit 0 |

---

## What I will NOT do until you clear the blockers

- ❌ Not deleting `legacyCookieSuperAdminBridge.ts`
- ❌ Not deleting `pages/api/super-admin/login.ts` / `logout.ts` / `content-architect-login.ts`
- ❌ Not migrating any of the ~60 routes from `requireSuperAdminUser` to `requireCapability`
- ❌ Not migrating Class C / Class E role-string sites
- ❌ Not deleting Class D content_architect dead paths
- ❌ Not adding `bridge_authority_removed` / `authority_chain_resolved` / `authority_chain_rejected` / `stale_authority_rejected` / `canonical_authority_enforced` audit events
- ❌ Not enforcing hard-zero policies for any of the Wave 3B targets

These are all Wave 3B work. They land **after** the operator clears the four open prerequisites above and authorizes resumption.

---

## Resume conditions

Return to me with:

> "Bootstrap complete. SUPER_ADMIN_USER_ID=<uuid>. Passkey enrolled. Step-up verified. Dry-run window ≥7 days, `bridge_authority_rejected=0` and `via_legacy_bridge=0` over the window. Bridge dependency map reviewed. Resume Wave 3B."

That message clears all five prerequisites. I will then execute Wave 3B per the original prompt's scope.
