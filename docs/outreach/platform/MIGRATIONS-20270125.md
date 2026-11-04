# Outreach foundation migrations 20270125000000–04

Authorized by the owner ruling of 2026-11-04 (Checkpoint 1, item 4): written locally on `outreach/foundation-base-20261104`, tested only on a disposable database, each with a rollback.

**Not applied to any real environment.** Applying any of them needs a separate owner decision. Release stays NO-GO.

## Mapping from schema change to file

| # | Schema change | Table | Migration | Rollback | Closure / request | Code wiring |
|---|---|---|---|---|---|---|
| 0 | Add `canonical_code` (CHECK: the 16 `sc7-draft-1` codes), `governance_codes text[] NOT NULL DEFAULT '{}'` (CHECK: subset of stop, unsubscribe, complaint), `classification_vocabulary_version` (required whenever a code is present) | `engagement_thread_classification`, `engagement_message_intelligence` | `supabase/migrations/20270125000000_engagement_canonical_classification.sql` | `supabase/migrations/rollbacks/engagement_canonical_classification_rollback.sql` | B-1, CR-SC7 | None yet. Waits for SC-7 agreement (PI + Orchestration). If the agreed code list differs from the draft, amend the CHECK before applying |
| 1 | `outcome_type` CHECK gains `complained` | `outreach_outcomes` | `supabase/migrations/20270125000001_outreach_outcome_complained.sql` | `supabase/migrations/rollbacks/outreach_outcome_complained_rollback.sql` | D-1, CR-4 / S-1 | None yet. `BUSINESS_OUTCOME_TYPES` gains it, `FEEDBACK_SIGNALS` must not, the SES path is the only writer; reader corrections under CR-4 with Orchestration |
| 2 | `source` CHECK gains `recipient_link` | `outreach_outcomes` | `supabase/migrations/20270125000002_outreach_outcome_recipient_link_source.sql` | `supabase/migrations/rollbacks/outreach_outcome_recipient_link_source_rollback.sql` | D-1, CR-SC4 | None yet. The unsubscribe outcome writer waits for the SC-4 contract with Orchestration |
| 3 | `auto_reply_enabled` default `true` → `false`. Default only; existing rows are not rewritten | `engagement_system_controls` | `supabase/migrations/20270125000003_engagement_auto_reply_default_off.sql` | `supabase/migrations/rollbacks/engagement_auto_reply_default_off_rollback.sql` | C-3 | Application already fails closed (C, `1b4d4ce57`). Turning off existing tenants is an operator decision at apply time |
| 4 | Add `auth_client_id_ref`, `auth_client_secret_ref`, each CHECKed to NULL, the code's own fixed Meta env names, or an AES-GCM credential envelope | `social_accounts` | `supabase/migrations/20270125000004_social_accounts_meta_client_refs.sql` | `supabase/migrations/rollbacks/social_accounts_meta_client_refs_rollback.sql` | D-3, WA-2 | Removes the WA-2 select failure only. WhatsApp stays blocked (WA-1, WA-3, L-4, CR-X-01) |

No table, function, trigger, policy or grant is created or changed. Every change is additive (columns, one default, two widened CHECKs) and leaves existing rows unchanged.

## Finding behind the constraints on migration 4

`resolveClientRef` (`backend/auth/metaAuthService.ts:52-59`) treats any upper-case value in these columns as an environment-variable name and returns that variable, and `getSocialAccountAuthContext` passes the result on as the Meta OAuth client id or secret. Unconstrained columns would let a stored value such as `SUPABASE_SERVICE_ROLE_KEY` or `ENCRYPTION_KEY` send that secret to a third party, and any other value would be stored as a plaintext secret. An encrypted envelope is also never decrypted there.

The migration's CHECKs refuse all of these at the database. **Code follow-up (recorded, not done; WhatsApp stays blocked):** allow-list the names in `resolveClientRef` and decrypt an envelope instead of sending it as-is.

## Disposable-database test (2026-11-04)

The run used a pg-sandbox PG17 cluster on loopback, stopped afterwards. The test SQL is in `docs/outreach/platform/migration-tests-20270125/` (`helpers.sql`, `assert.sql`).

| Step | Result |
|---|---|
| Pre-state | bootstrap + baseline + the 105 earlier migrations above ledgerMax `20260916000000` |
| Forward | 5/5 applied |
| Re-apply | 5/5 idempotent |
| Privileges | grants, RLS, policies and column ACLs on the five tables identical before and after (snapshot checked non-empty, 5 rows) |
| Behaviour (`assert.sql`, real inserts) | every CHECK accepts its valid values and refuses each invalid one by name (invalid code, non-governance code, code without version, blank version, unknown outcome type, unknown source, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `OPENAI_API_KEY`, a plaintext secret, a secret name in the id column); the legacy row shape still inserts; new controls rows default to `false`; no constraint left NOT VALID |
| Rollback | 5/5 in reverse order; columns, defaults and constraints identical to the pre-state |
| Re-forward | identical to the first forward |
| Refusals | rollback 1 refuses while a `complained` row exists; rollback 2 refuses while a `recipient_link` row exists (append-only history kept); migration 4 refuses a database that already holds an unsafe value |
| Gate | `check-migration-quality`: 0 violations |
