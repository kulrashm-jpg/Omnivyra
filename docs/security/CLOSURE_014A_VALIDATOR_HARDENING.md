# Closure-014A — grant-impact validator hardening and passkey/trusted-device readiness

Local and offline only. No production access; the grant-impact query was **not** run against production.

## 1. Validator (`scripts/cert/validate-grant-impact-query.cjs`) — now fails closed

| Check | Before | After |
|---|---|---|
| Target | loopback guard at module load | the same loopback guard, now run inside `main()` **before a client is constructed**; the URL is never echoed |
| READ ONLY proof | any error was printed as "enforced"; a successful UPDATE printed "NOT ENFORCED" and **exited 0** | only SQLSTATE `25006` passes. An UPDATE that succeeds, any other SQLSTATE, or an error with no SQLSTATE throws, exit 1. ROLLBACK is attempted on every path, and a failing ROLLBACK also fails. |
| Fixture matrix | a mismatch printed `FAIL` and **exited 0** | a mismatch throws, exit 1. The transaction is rolled back on every path. If the rollback itself fails, a concise diagnostic is logged (step plus SQLSTATE, never connection details). The original error stays the one thrown, with the rollback error attached as `rollbackError`. A rollback failure after passing assertions still fails, exit 1. The READ ONLY check behaves the same way. |
| Synthetic rows after rollback | printed only | any surviving synthetic user or company fails, exit 1 |
| Result sets | not asserted | exactly 4 SELECT result sets are required |
| Client lifecycle | `end()` skipped on failure | `end()` runs in `finally` on every path; a close failure is reported but never replaces the original error |

**Unchanged:** the SQL file, both extracted queries, the fixtures, the six-row expected classification and its exclusions (exact SUPER_ADMIN, expired grant, revoked grant, read-only capabilities).

## 2. Can Query 3 prove an operator can complete step-up? — **No (schema limitation)**

What the code and the local schema establish:
- **Trusted device is NOT a stored prerequisite.**
  - `/api/auth/devices/trust` needs only an active step-up session from a non-bridge principal.
  - `TrustedDeviceService.register` has no device-count limit; it revives a dormant row or answers `ALREADY_TRUSTED`.
  - The established UI flow (`runStepUpFlowIfNeeded`) runs the passkey ceremony, then trusts the current browser, then retries.
  - `stepup_sessions.trusted_device_id` is nullable.
- **Trusted-device validity is a request-time property.**
  - `IdentityResolver.fetchDeviceState` treats a device as trusted only if a row matches the request's fingerprint, `djb2(UA | Accept-Language | sorted cookie names)`, with `revoked_at IS NULL` and `expires_at > now()`.
  - The row is unique on `(user_id, fingerprint)`.
  - No database query can know which browser the operator will use, so stored rows neither prove nor disprove readiness.
- **A non-revoked passkey is necessary, not sufficient.**
  - `webauthn_credentials` has no `rp_id` or origin column; those exist only on short-lived `webauthn_challenges`. A query therefore cannot show a credential was registered against the production RP ID / origin.
  - A query also cannot show the operator still holds the authenticator, or that the browser supports it.

**Conclusion:**
- Query 3 (`with_active_passkey`) stays a **necessary-condition** indicator. It is not modified, and it does not establish readiness.
- Production readiness stays **UNRESOLVED** until each active, exact-spelling SUPER_ADMIN completes a real passkey step-up on the production origin, the established procedure in the Closure-012 Section A pattern.
- A zero count is a release blocker. A non-zero count is not proof of readiness.

## 3. Evidence

The evidence manifest is `closure014a_validator_evidence.sha256`. It holds SHA-256 hashes of the validator, its test suite, this
document, the local validator run logs, the live negative-rollback proof script and the certification log.

That evidence is **local only**. It shows the validator and the SQL behave correctly against a local
certification database with synthetic fixtures. It does **not** establish production grant-impact clearance. That
still requires an authorized operator to run `docs/security/CLOSURE_014_GRANT_IMPACT_QUERY.sql` read-only against
the production project (ref `klkiseupptzbecbxwrky`), and an independent reviewer to check the results.
