# Shared-foundation contracts

Version 1 · 2026-11-02 · baseline main `5025f51d`, release candidate `7bdd76ae`, integration branch `d682ab13`.

Each shared capability has one owner and one source of truth. A track may read another track's data only through the contract named here; a second table, scorer, store, approval system, event bus or identity model for the same concept is a contract breach. Where today's code disagrees with a contract, the "Retire or adapt" line names the change and the milestone that carries it.

Version policy (all contracts): additive changes (new optional field, new enum value consumers ignore) bump the minor version; any removal, rename, type change or changed meaning bumps the major version and needs both producer and consumer changes in the same release. The contract version lives in this file's section heading and, for code contracts, in the exported constant named under each contract.

---

## 1. Canonical prospect and person identity — v1.0

- **Owner:** Prospect Intelligence track.
- **Source of truth:** `unified_persons` (person), `identity_claims` (endpoints and external keys), `canonical_leads` (the prospect, keyed by `id`, carrying `unified_person_id` and `external_lead_key`). Evidence in `source_records` / `source_assertions`.
- **Required identifiers:** `canonical_leads.id` is the prospect id used by every downstream contract; `unified_persons.id` is the person id; tenant key `company_id` / `organization_id` (see §2).
- **Producers:** `leadIngestion` boundary (`ingestionBoundary.ts`), identity resolution (`identityResolutionService.ts`), enrichment.
- **Consumers:** scoring, lists, orchestration enrollment (local), outreach recipient resolution, lifecycle.
- **State rules:** a person is resolved on `primary_email` today; external keys are recorded as claims. Duplicates are parked, never silently merged.
- **Idempotency:** re-ingesting the same batch (same `externalId`) adds no rows (AS-1 pass condition).
- **Security:** every read and write is tenant-scoped; the backend uses the service role, so the scoping is in code and must be asserted by tests.
- **Migration implications:** none new for the slice; `person_account_relationships` replaces the write-once `unified_persons.account_id` scalar later (PI-03 / Stage 8).
- **Contract tests:** AS-1 and AS-2 real-schema tests; a test that no new module reads legacy `leads` as a prospect source.
- **Retire or adapt:** legacy `leads` stays a *website capture* entity, not a prospect. `leadIntelligenceOrchestration` reads `leads`, so it is **not** a canonical-prospect consumer until re-keyed (AIO-07, deferred). `active_leads` (no writers) is retired later. `identity_claims` is written but not yet read for decisions — reading it is a minor-version addition.

## 2. Company and tenant identity — v1.0

- **Owner:** Platform.
- **Source of truth:** `companies.id` (uuid), written through `companyIdentityWriter`.
- **Required identifiers:** every tenant-owned row carries the tenant key as a uuid. New tables use `company_id uuid` with a foreign key to `companies`; existing tables keep their column name (`organization_id` on PI tables means the same company) until the tenant-key ADR (ENG-TENANTKEY-ADR).
- **Consumers:** every module.
- **Security:** isolation is enforced in application code (`enforceCompanyAccess` and peers) and by the CI route-auth gate (`scripts/check-route-auth.js`); RLS is a backstop against the publishable key only. A database-level backstop is a later ADR.
- **Migration implications:** no new text `company_id` columns; new tables must name their tenant column and FK.
- **Contract tests:** migration-quality rule (proposed) refusing a new text tenant column; route-auth gate in predeploy (SEC-ROUTEAUTH-PREDEPLOY).
- **Retire or adapt:** 65 text `company_id` columns converge under the ADR, not ad hoc.

## 3. Consent, lawful basis and jurisdiction — v0.1 (draft; policy values wait for counsel K-1)

- **Owner:** Prospect Intelligence track (governance), with counsel for policy.
- **Source of truth:** none exists. `consent_records` is OAuth capability consent and must **not** be reused for contact consent.
- **Required fields (draft):** person id, endpoint (normalised), channel, purpose, lawful basis, jurisdiction, source, evidence reference, captured_at, withdrawn_at.
- **State rules:** a withdrawal is recorded both here and as a `consent_withdrawn` governance record (§4), so eligibility has one evaluation path.
- **Security:** recipient-owned; tenant operators cannot delete or overwrite.
- **Migration implications:** one new table in the post-renumber block.
- **Contract tests:** `mayContact` refuses a channel that requires opt-in when no basis is recorded; unknown jurisdiction is denied by default (pending counsel).
- **Retire or adapt:** WS-3's caller-supplied region with allow-on-unknown (`governance.ts:285`) becomes a person-level jurisdiction read.

## 4. Suppression, unsubscribe, DNC and contact eligibility — v1.1

- **Owner:** Prospect Intelligence track.
- **Source of truth:** `contact_governance_records` (append-only by revocation), evaluated by `mayContact` (`prospectIdentity/contactGovernance.ts`). Code contract: `GOVERNANCE_TYPES`.
- **Recipient-owned types:** `unsubscribe`, `consent_withdrawn`, `complaint` (`RECIPIENT_OWNED_GOVERNANCE_TYPES`, commit `ce1d6e15`). A tenant release never lifts them; the release refuses the whole operation and writes nothing. Who else may ever lift them is open (TR K-5, counsel).
- **Producers:** suppression service, unsubscribe route, SES bounce/complaint ingestion, feedback ingestion, WhatsApp STOP (integration branch).
- **Consumers:** every send path, at **decision time and at egress** (GD-3).
- **State rules:** records are revoked, never deleted; a revoked or expired record does not apply.
- **Idempotency:** writing the same instruction twice is a no-op (unique identity index).
- **Security:** fail closed — an unreadable store means "do not contact".
- **Migration implications:** an append-only trigger allowing only revocation fields (SEC-GOVTRIGGER).
- **Contract tests:** w2b/w2c suites; new GD-3 interim suite; egress tests (OUT-03).
- **Retire or adapt:** `outreach_suppressions` (no writer, still read by the WS-3 gate) — stop reading (PI-08). `suppression_entries` (legacy, still dual-written) — keep read for safety until convergence, then retire. Community, DM, extension, RPA and social-publish paths must call the egress gate (OUT-03, OUT-09).

## 5. Per-send approval and content hash — v1.0 (GD-1, pending decision)

- **Owner:** Orchestration track.
- **Source of truth:** `outreach_approvals` (WS-3), one approval per send task.
- **Required fields:** task id, approver id, decision, decided_at, `content_sha256` over rendered subject, body and recipient set.
- **State rules:** dispatch re-computes the hash and refuses on mismatch (`approval_stale`); approval and its audit row are written in one transaction; approver and override are different permissions; agent runtimes cannot approve a send.
- **Consumers:** EngineAdapter dispatch.
- **Retire or adapt:** `execution_approvals` stays campaign-level and never substitutes for a per-send approval; its `'default'` version key is removed. The local journey-hash approval in the integration branch becomes a projection of this record, not a second authority.
- **Contract tests:** AS-4.

## 6. Workflow, task, execution and correlation identifiers — v1.0

- **Owner:** Orchestration track.
- **Source of truth (integration branch, contract 0.2.0):** `workflow_versions`, `execution_instances` (enrollment), `execution_plans` / steps, `execution_engine_requests`, `outreach_bridge_handoffs` (binds `subject_id` = `canonical_leads.id`, `person_id`, `outreach_task_id`, `execution_plan_step_id`).
- **Required correlation chain:** `canonical_leads.id` → score evaluation id → execution instance id → plan step id → handoff id → `outreach_tasks.id` → approval id → attempt id (+ credit hold id) → provider message id → reply / outcome id → lifecycle transition id → next evaluation id.
- **Idempotency key:** `task:<task id>`; correlation string `journey:<instance>/step:<step>` must be **persisted**, not only derived.
- **Retire or adapt:** the correlation id is currently derived and not stored on `outreach_tasks`; `execution_engine_requests` has no plan/correlation columns. AIO-04 persists them (new migration in the post-renumber block).
- **Contract tests:** one query returns the whole chain for an AS run.

## 7. Outreach outcome and lifecycle transition — v1.0 (GD-2, pending decision)

- **Owner:** Feedback track (outcome), Prospect Intelligence (lifecycle).
- **Source of truth:** `outreach_outcomes` (outcome), `prospect_lifecycle_transitions` (lifecycle).
- **Required identifiers:** outcome keyed by engine request / handoff (channel-agnostic) and carrying the prospect id; transition `source_event_key` = outcome id.
- **State rules:** the lifecycle producer resolves the prospect through `outreach_bridge_handoffs.subject_id`, not through a non-unique person lookup. Scoring reads lifecycle state and transitions only; the WS-3 feedback envelope stays report-only (its guard tests stay).
- **Idempotency:** a replayed outcome creates no new transition.
- **Retire or adapt:** `outreach_outcomes.task_id NOT NULL` (WS-3-only) gains a channel-agnostic key (OUT-08); `rejected` needs an actor column.
- **Contract tests:** AS-9.

## 8. Credit reservation, confirmation, release and reconciliation — v1.0

- **Owner:** Billing track.
- **Source of truth:** `credit_transactions` (append-only, trigger-protected) and the RPCs `apply_credit_reservation` / `apply_credit_transaction_v2`; wallet `organization_credits` is a projection written only by RPCs.
- **State rules:** HOLD → CONFIRM (full or partial) or RELEASE; a HOLD with neither, older than the reaper threshold, is an orphan; every remainder returned to a wallet carries a ledger row.
- **Consumers:** AI billed completion, creator rendering, outreach send (EngineAdapter, K-8 pending).
- **Idempotency:** idempotency key per hold; confirm/release are idempotent.
- **Retire or adapt:** 3 writers of `organization_credits` outside the RPCs; remainders without ledger rows; reaper and reconciliation unscheduled (REL-05, after P11 and a controlled test).
- **Contract tests:** ledger rebuild equals wallet; reaper idempotency.

## 9. Domain events and integration handoffs — v1.0

- **Owner:** Orchestration track.
- **Mechanism today:** durable handoff rows (`outreach_bridge_handoffs`, `execution_engine_requests`) plus table-cursor sweepers; BullMQ for job execution. No outbox.
- **Rule:** cross-module handoffs are persisted rows with the §6 identifiers; in-process EventEmitters are not integration contracts. A `domain_outbox` is deferred (Stage 8) and, when built, publishes from these rows without a schema change.
- **Retire or adapt:** queues with no producer (`automation-tasks`, `posting`, `lead-jobs`) are documented as unused or removed.
- **Contract tests:** each handoff row is created once per idempotency key.

## 10. Migration ownership, ordering and compatibility — v1.0 (GD-4, pending decision)

- **Owner:** Release controls.
- **Source of truth:** `scripts/migrations/version-reservations.json` + `check-migration-quality.js` rules 5–8 (commit `51d43e98`, not merged).
- **Rules:** every new migration takes a version above all used or reserved versions (production tip `20270111000003`, release candidate up to `20270115000000`, governance drafts up to `20270118000000`, integration block `20270121000000`–`21`); applied migrations are never edited; no out-of-order applies; each migration names its rollback.
- **Ordering:** release candidate → governance remediations → integration (renumbered) → `6a6c3d9b`.
- **Retire or adapt:** `refs/preserve/wt/pi-consol` lists/workflow migrations are never applied; stale H-3 copies at `20270116000000` are deleted with their worktrees.
- **Contract tests:** migration-quality gate in CI; P1 ledger classification.

## 11. Security, audit and tenant isolation — v1.0

- **Owner:** Platform.
- **Rules:** no credential, token or secret value in code, logs, tests, docs or tickets; central log redaction (SEC-04); secret scanning on pull requests (SEC-04); encryption keys versioned with a previous-key fallback (SEC-03); every route passes the CI route-auth gate; every write that changes contact eligibility, approval or credits writes an append-only audit record.
- **Retire or adapt:** three parallel generic audit tables converge on `audit_events` later; `contact_governance_records` gains a trigger; `suppression_entries` and `execution_approvals` remain mutable until retired.
- **Contract tests:** redaction tests; secret-scan tests; route-auth gate; governance-record trigger test.

---

## Conflicts resolved by these contracts

| Conflict | Adopted | Retire or adapt |
| --- | --- | --- |
| Per-send approval: `execution_approvals` vs `outreach_approvals` | `outreach_approvals` (§5, GD-1) | `execution_approvals` campaign-level only |
| Suppression: three stores | `contact_governance_records` (§4) | stop reading `outreach_suppressions`; retire `suppression_entries` after convergence |
| Prospect source for decisions: `leads` vs `canonical_leads` | `canonical_leads` (§1) | planner re-key deferred; slice uses authored workflow step |
| Outcome → scoring: feedback envelope vs lifecycle | lifecycle transitions (§7, GD-2) | envelope stays report-only |
| Lists schema: `20261127000000` vs `pi-consol 20261104` | `20261127000000` (live in production) | pi-consol never applied |
| Migration numbering | reservation registry (§10, GD-4) | stale H-3 numbers removed |
