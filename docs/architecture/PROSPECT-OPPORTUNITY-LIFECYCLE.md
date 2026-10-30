# Prospect opportunity lifecycle and identity model

Status: design record for the owner-approved direction of 2026-10-30. It sits beside
`PROSPECT-PROVENANCE-CONTRACT.md` (Agent 1 owns provenance). Code contract:
`lib/prospectOpportunity/contract.ts` (pure). Tests: `backend/tests/unit/piProvOpportunityLifecycle.test.ts`.
This record adds **no migration**. Section 9 is a DDL **proposal** only.

Labels used below:
- **[V]** VERIFIED: read from the repo at `8b4b52b4`, from `supabase/_schema/baseline.sql`, or confirmed by the orchestrator's read-only production check of 2026-10-30.
- **[C]** CODE-INFERRED: follows from reading the code.
- **[A]** ASSUMPTION or NEEDS PRODUCTION CHECK.

`baseline.sql` is a schema-only `pg_dump` of production (`baseline.json`: `ledgerMax 20260916000000`).
A table that is in it, and that no later migration drops, existed in production when the dump was
taken [V]. Whether it still exists today, and how many rows it holds, needs a read-only check [A].

## 1. Approved direction (restated)

There are four separate entities, which are never collapsed:

1. The canonical prospect: a person, an account, or both.
2. Source contributions and evidence (`prospect_source_contributions`, Agent 1).
3. Business opportunities.
4. Opportunity lifecycle and workflow.

A prospect can have many opportunities. Each opportunity has its own type, owner, status and lifecycle.
There is no single "lead status", and no new status vocabulary is introduced here.

## 2. Inventory

| Table | Definition | Production | Writers / readers on main |
|---|---|---|---|
| `canonical_leads` (THE prospect; "C-2 froze `canonical_leads` as the canonical Prospect", `prospectResolution.ts`) | baseline.sql:9084 | exists, 19 rows [V] | `resolveOrCreateProspect` (`backend/services/prospectIdentity/prospectResolution.ts:193-229`) writes `lead_status = NULL` |
| `unified_persons` (person) | baseline.sql:15801 | 24 rows [V] | W1 resolver `resolveUnifiedPerson` |
| `prospect_accounts` (account) | baseline.sql:21128 | 1 row [V] | `resolveAccount` in `leadIngestion/orchestrator.ts` |
| `person_account_relationships` (person ↔ account edge) | `20261122000000_pi_person_account_relationships.sql:121-264` | 16 columns, 1 row [V] (it matches the migration's 16 columns) | `prospectIdentity/relationshipRepository.ts`, `relationshipAttributeIngestion.ts` |
| `contacts` (per-platform handle) | baseline.sql:11496 | in baseline [V]; row count [A] | community/engagement paths |
| `lead_signals` | baseline.sql:17204 | in baseline [V]; rows [A] | listening/engagement pipelines |
| `opportunity_feed_items` (classified signal) | baseline.sql:19399, plus `signal_excerpt` (20260818) | 0 rows [V] | `opportunityFeedService.ts` |
| `opportunity_lifecycle_states` | baseline.sql:19505 (`20260520_phase6…:13`) | in baseline [V]; rows [A] | `opportunityLifecycleService.ts` (`readCurrentLifecycleState`, `transitionLifecycle`) |
| `opportunity_assignments` | baseline.sql:19351 (20260520) | in baseline [V]; rows [A] | `opportunityWorkflowService.ts:24-97` |
| `opportunity_dispositions` | baseline.sql:19369 (20260520) | in baseline [V]; rows [A] | `opportunityWorkflowService.ts:212-246` |
| `opportunity_notes` | baseline.sql:19525 | in baseline [V] | `opportunityWorkflowService.ts` |
| `prospect_lifecycle_transitions` | `20261028000000_pi_prospect_lifecycle_state.sql:97-234` | 18 columns, 0 rows [V] (the 18 columns match the migration) | `prospectLifecycle/lifecycleWriter.ts`, `lifecycleReader.ts`, `outcomeLifecycleProducer.ts` |
| `prospect_score_evaluations` | `20261031000000_pi_score_evaluations.sql:39` | 24 columns, 0 rows [V] | `leadUnderstanding/scoreEvaluationStore.ts` |
| `operational_states` / `operational_assignments` / `operational_notes` / `operational_tasks` | baseline.sql:19170-19340 (`20260727000000_operational_core.sql`) | in baseline [V]; rows [A] | `operations/operationalCoreService.ts` through `/api/lead-intelligence/operations` |
| `active_leads` (new shape) | `20260817_active_leads_object_model.sql:41-123` | **never applied**. Production `active_leads` is the legacy run-snapshot table (baseline.sql:5483) [V] | none |

No later migration drops any of the baseline tables above [V: no `DROP TABLE` matches in `supabase/migrations`].

**Needs a read-only production check [A]:**
- existence and row counts of `opportunity_assignments`, `opportunity_dispositions`, `opportunity_lifecycle_states`, `operational_states` and `operational_assignments`;
- whether CHECK `prospect_lifecycle_initial_state_valid` (20261029) is present on `prospect_lifecycle_transitions`.

## 3. ERD (text)

```
companies (tenant; id = organization_id = company_id everywhere)
 │
 ├─< prospect_accounts (id, organization_id)                       ACCOUNT
 │      ▲ (account_id, company_id) RESTRICT
 │      │
 ├─< unified_persons (id, company_id) ── account_id ──┘             PERSON (write-once primary employer)
 │      ▲            ▲
 │      │            └─< person_account_relationships (person_id, account_id, organization_id)
 │      │                    composite FKs both legs; many-to-many; is_primary; ended_at
 │      │ (unified_person_id, organization_id) SET NULL
 ├─< contacts (id, organization_id; platform, platform_user_id)     PLATFORM HANDLE (N → 1 person)
 │      ▲ contact_id (single-column FK, SET NULL)
 ├─< lead_signals (id, organization_id)                             RAW SIGNAL
 │      ▲ signal_id (single-column FK, CASCADE)
 ├─< opportunity_feed_items (id, organization_id; opportunity_type) CLASSIFIED SIGNAL = opportunity (today's grain)
 │      ├─< opportunity_lifecycle_states   (append-only; state)       ─┐
 │      ├─< opportunity_assignments        (role 'owner' = owner)      │ ENTITY 4: workflow
 │      ├─< opportunity_dispositions       (append-style)              │ (per feed item; single-column FKs)
 │      └─< opportunity_notes                                          ─┘
 │
 ├─< canonical_leads (id, company_id)                               ENTITY 1: CANONICAL PROSPECT
 │      │ (unified_person_id, company_id) → unified_persons  SET NULL; NO account column
 │      ├─< prospect_source_contributions (canonical_lead_id, organization_id)   ENTITY 2 (Agent 1)
 │      │      ├─ source_record_id        → source_records (id, organization_id)
 │      │      ├─ contact_id              → contacts (id, organization_id)            [unique key added by Agent 1]
 │      │      ├─ lead_signal_id          → lead_signals (id, organization_id)        [unique key added by Agent 1]
 │      │      └─ opportunity_feed_item_id→ opportunity_feed_items (id, organization_id) [unique key added by Agent 1]
 │      ├─< prospect_lifecycle_transitions (prospect_id, organization_id)  PROSPECT-level qualification ledger
 │      └─< prospect_score_evaluations     (prospect_id, organization_id)  PROSPECT-level scores
 │
 └─ operational_* (company_id TEXT, entity_type, entity_id TEXT; no FK)  entity-agnostic status/owner/notes/tasks
```

Relationships, by concept:

- **Prospect ↔ person.** `canonical_leads.unified_person_id` (nullable; composite tenant FK) [V].
  One person can have N prospects: one per `(company_id, external_lead_key)`, so one per source key [V: `idx_canonical_leads_company_external`].
- **Person ↔ contact.** `contacts.unified_person_id` (nullable; composite tenant FK). N contacts map to 1 person [V].
- **Person ↔ account.** `unified_persons.account_id` (write-once primary) and `person_account_relationships` (many-to-many, temporal) [V].
- **Prospect ↔ account.** There is **no direct column** [V]. Today the only routes are through the person (`unified_persons.account_id` or PAR), or through provenance (`prospect_source_contributions.source_record_id → source_records.account_id`) [C].
- **Prospect ↔ opportunity.** There is **no column on either side** [V]. Once Agent 1's table lands, the only typed link is `prospect_source_contributions.opportunity_feed_item_id`: a contribution of prospect P cites the feed item it came from [C]. `lib/prospectOpportunity/contract.ts` uses exactly this, and nothing else, to attach opportunities to a prospect.
- **Opportunity ↔ source contribution.** These are distinct concepts.
  - A contribution answers "where did we learn about this prospect" (prospect grain, append-only, never partitioned per opportunity).
  - An opportunity answers "what are we pursuing with them, who owns it, where is it".
  - A contribution may cite the signal that also created an opportunity. Attribution stays prospect-level and is shared by all of the prospect's opportunities. The unit test asserts this.

## 4. What already implements the design, and where it would be duplicated

| Concern | Existing implementation | Grain | Verdict |
|---|---|---|---|
| Opportunity type | `opportunity_feed_items.opportunity_type` (8-value CHECK) | signal | **Reuse.** It is the only typed opportunity vocabulary in the database. |
| Per-opportunity status + history | `opportunity_lifecycle_states` (append-only, `previous_state`, `actor_user_id`, `transitioned_at`, one initial row) | signal | **Reuse at signal grain.** `prospect_lifecycle_transitions` copied this shape (its header says so). |
| Per-opportunity owner | `opportunity_assignments` (`role='owner'`, `unassigned_at`) | signal | **Reuse**, but one active owner is NOT enforced: `opp_assignment_unique_active UNIQUE (opportunity_feed_item_id, role, unassigned_at)` treats NULLs as distinct, and `assignOpportunity` closes then inserts non-atomically [V, C]. |
| Per-opportunity disposition | `opportunity_dispositions` | signal | Reuse |
| Prospect-level qualification | `prospect_lifecycle_transitions` | prospect (`canonical_leads.id`) | **Not** an opportunity lifecycle. One chain per prospect (the advisory lock and chain trigger are keyed on `prospect_id`), so it cannot carry two opportunity statuses without breaking its invariant [V: migration :293-318]. Keep it as entity-1 qualification. |
| Entity-agnostic status/owner | `operational_states` / `operational_assignments` (`OperationalEntityType = 'canonical_lead' \| 'opportunity' \| …`) | any entity, keyed by text | Exists and its owner index is correct (`uq_operational_assignment_active` partial on `active`). But `company_id` and `entity_id` are text with no FK; state is current-only (history is written to `lead_intelligence_events` only for `canonical_lead`); and the UI keys `canonical_lead` by `leadKeyFor(view)`, which PI-ADR-004 rejected as unstable [V: 20261028 header :23-33]. **Not tenant-safe by constraint.** |
| Per-(contact, type) roll-up | `active_leads` (20260817) | (org, contact, type) | **Never applied.** Do not apply it as written: it duplicates the lifecycle tables above with a third status vocabulary and keys on `contacts`, not the canonical person. |

Conclusion:
- The design is implemented today **at signal grain, for community signals only**, by the
  `opportunity_*` family. Agent 1's contribution table attaches it to a prospect.
- There is **no durable business-opportunity entity** keyed to a prospect.
  - `opportunity_feed_items` needs a `lead_signal` (community/engagement only), so CRM, CSV, manual and PI-discovery prospects cannot have opportunities.
  - It is retention-deleted (`backend/types/retention.ts:57`, with a lifecycle child at :106-108).
  - It is one row per signal, not one per pursuit.

  That is the gap (section 9).

## 5. Lifecycle contract

Current, existing schema only (implemented by `buildProspectOpportunities`):
1. An opportunity belongs to prospect P **only if** a P contribution cites it (`opportunity_feed_item_id`).
   - A feed item that no contribution cites is not attached: it is reported as anomaly `feed_item_not_cited`.
   - A cited item that is absent (for example, retention-deleted) is reported as `cited_feed_item_absent`. The contribution remains in the attribution.
2. Status: the existing `readCurrentLifecycleState` result.
   - `missing` stays `missing` and is never defaulted to `detected` (FR-A39).
   - Unknown vocabulary is reported as `unreadable`.
   - A row from another tenant or another item is reported as `unreadable` (`cross_tenant` / `subject_mismatch`).
3. Status-change audit: `changedAt = transitioned_at` and `changedBy = actor_user_id` of the latest row.
4. Owner: active (`unassigned_at IS NULL`) `role='owner'` assignments.
   - Zero active owners gives `unassigned`.
   - One distinct user gives `assigned`.
   - Two or more distinct users give `contradictory`. The view never picks one.
5. Snooze: always `null`. No carrier exists. `revisit_later` is surfaced only as `latestDisposition`.
6. Tenant: every row whose org is not the prospect's org is dropped and reported. This is needed because the `opportunity_*` workflow FKs are single-column.
7. Several opportunities of one type stay separate. `byType` groups ids and computes **no** roll-up status (decision D-3).
8. Source attribution: exactly one `originating` (or `null` plus anomaly `multiple_originating`) and all others `contributing`. It is shared by every opportunity. Each opportunity lists only `citingContributionIds`.

Target, after the owner's decisions: the same contract, with the opportunity subject replaced by a durable `prospect_opportunities` row (section 9). The status, owner and audit rules stay unchanged.

## 6. Field mapping: the 20260817 roll-up versus existing carriers

These mappings are also held as data in `ROLLUP_FIELD_MAP`.

| 20260817 `active_leads` field | Existing carrier | Status |
|---|---|---|
| `organization_id` | `canonical_leads.company_id` / `opportunity_feed_items.organization_id` (both `companies.id`) | mapped |
| `contact_id` (NOT NULL → contacts) | `canonical_leads.unified_person_id`; `contacts.unified_person_id`; `lead_signals.contact_id` | different grain: N contacts → 1 person |
| `opportunity_type` (8-value CHECK) | `opportunity_feed_items.opportunity_type` (same 8 values) | mapped (signal grain) |
| `status` (`new, reviewing, contacted, qualified, won, lost, dismissed, snoozed`) | `opportunity_lifecycle_states.state` (latest) | mapped, **different vocabulary** (D-1) |
| `owner_user_id` | `opportunity_assignments.assigned_to_user_id` WHERE `role='owner' AND unassigned_at IS NULL` | mapped (uniqueness not enforced) |
| `snoozed_until` | none (`revisit_later` has no time; `operational_tasks.due_at` is a task, not a snooze) | **GAP** (D-4) |
| `status_changed_at` | `opportunity_lifecycle_states.transitioned_at` (latest) | mapped |
| `status_changed_by` | `opportunity_lifecycle_states.actor_user_id` (latest) | mapped |
| `intent/icp/confidence/total_score` | `prospect_score_evaluations.score_*`, 0..1 (prospect grain); `opportunity_feed_items.*_score`, 0..1 (signal grain) | mapped (Agent 1 / P3-4 row 6-9) |
| `source_platforms`, `signal_count`, `first/last_seen_at` | derivable from `prospect_source_contributions` (`platform`, `observed_at`, count) | derived, never stored |
| `company_name` | `prospect_accounts.name` via the person | mapped (join) |

## 7. Account-only leads

Today's behaviour [V: `backend/services/leadIngestion/orchestrator.ts:303-358`]:
- When `record.entityType === 'account'`, `personId` stays `null`.
- `resolveAccount` returns an `accountId`. `attachPersonToAccount` is skipped, because there is no person.
- `resolveOrCreateProspect` then inserts `canonical_leads` with `unified_person_id = NULL`.
- `canonical_leads` has **no account column**, so the prospect links to **neither** a person nor an account.
- The only trace is `source_records.account_id` (`source_records_entity_coherent` forces `person_id IS NULL` for account records). `source_records` has no link to the prospect.

Once Agent 1's contributions land, the account can be reached indirectly through
`prospect_source_contributions.source_record_id → source_records.account_id` [C].

Options (decision D-5):
- **(a) Indirect only.** Resolve the account through the originating contribution's source record. No DDL. The account is not a constraint-backed attribute of the prospect, and it is ambiguous if contributions cite different accounts.
- **(b) Add `canonical_leads.prospect_account_id uuid NULL`** with composite FK `(prospect_account_id, company_id) → prospect_accounts(id, organization_id)` ON DELETE RESTRICT. A CHECK requiring at least one of person or account would fail on existing rows unless it is added `NOT VALID`. This is the smallest honest model of "a prospect is a person, an account, or both".
- **(c) Put the account on the opportunity** (`prospect_opportunities.account_id`). Account-based pursuits are then expressible even when the prospect is person-anchored. This is orthogonal to (b).

Recommendation: (b) plus (c), if the owner wants account-based selling. Otherwise (a) as the interim.

## 8. Tenant-safe identity resolution: per relation

| Relation | Tenant enforcement | Safe? |
|---|---|---|
| canonical_leads → unified_persons | composite `(unified_person_id, company_id)` | yes [V] |
| canonical_leads → canonical_users | composite `(user_id, company_id)` | yes [V] |
| unified_persons → prospect_accounts | composite `(account_id, company_id)` | yes [V] |
| person_account_relationships → person / account | composite on both legs | yes [V] |
| contacts → unified_persons | composite `(unified_person_id, organization_id)` | yes [V] |
| lead_signals → contacts | `contact_id` single-column | **no** [V] |
| opportunity_feed_items → lead_signals | `signal_id` single-column | **no** [V] |
| opportunity_lifecycle_states / assignments / dispositions / notes → feed item | `opportunity_feed_item_id` single-column, plus a separate `organization_id → companies` | **no**: the row's org can differ from the item's org [V] |
| prospect_lifecycle_transitions / prospect_score_evaluations → canonical_leads | composite | yes [V] |
| prospect_source_contributions → all refs | composite (Agent 1 contract) | yes (by contract) |
| operational_* | `company_id text`, no FK; `entity_id text` | **no** [V] |

Until composite FKs exist on the `opportunity_*` workflow tables, tenant safety comes from two places:
- the explicit `.eq('organization_id', …)` filters in `opportunityWorkflowService` and `opportunityLifecycleService` [V];
- the re-check in `buildProspectOpportunities`, which drops and reports any foreign row.

Proposal P2 below makes it constraint-backed.

## 9. Gaps and DDL proposal (TEXT ONLY. Not a migration file. Agent 1 owns the only migration.)

Gaps:
- G1: there is no durable business-opportunity entity per prospect.
- G2: there is no snooze carrier.
- G3: one active owner is not enforced on `opportunity_assignments`.
- G4: the `opportunity_*` workflow FKs are not tenant-composite.
- G5: there is no prospect ↔ account link for account-only prospects.

P1 (G1) adds only the opportunity identity. Its lifecycle reuses an existing ledger shape:
```sql
CREATE TABLE IF NOT EXISTS public.prospect_opportunities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  canonical_lead_id  uuid NOT NULL,
  opportunity_type   text NOT NULL,          -- vocabulary = owner decision D-2 (default: reuse the 8-value OFI CHECK verbatim)
  account_id         uuid,                   -- optional, see section 7 (c)
  origin_contribution_id uuid,               -- the contribution that justified opening it
  opened_by_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_prospect_fk FOREIGN KEY (canonical_lead_id, organization_id)
    REFERENCES public.canonical_leads(id, company_id) ON DELETE CASCADE,
  CONSTRAINT po_account_fk FOREIGN KEY (account_id, organization_id)
    REFERENCES public.prospect_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT po_origin_fk FOREIGN KEY (origin_contribution_id, organization_id)
    REFERENCES public.prospect_source_contributions(id, organization_id) ON DELETE RESTRICT
    -- needs UNIQUE (id, organization_id) on prospect_source_contributions (Agent 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_opportunities_id_org ON public.prospect_opportunities (id, organization_id);
-- Only if D-3 = "at most one OPEN opportunity per (prospect, type)": a partial unique index needs a
-- current-state column, which the ledger deliberately does not store, so enforce it in the writer instead.
CREATE INDEX IF NOT EXISTS idx_prospect_opportunities_lead ON public.prospect_opportunities (organization_id, canonical_lead_id, opportunity_type);
ALTER TABLE public.prospect_opportunities ENABLE ROW LEVEL SECURITY;  -- service_role only, as every PI table
```

The lifecycle and owner for P1 have two alternatives (decision D-6). Neither adds a third status vocabulary.
- **P1-A (reuse the `opportunity_*` workflow tables).** Make the subject polymorphic.
  ```sql
  ALTER TABLE public.opportunity_lifecycle_states ALTER COLUMN opportunity_feed_item_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS prospect_opportunity_id uuid,
    ADD CONSTRAINT ols_subject_xor CHECK ((opportunity_feed_item_id IS NULL) <> (prospect_opportunity_id IS NULL)),
    ADD CONSTRAINT ols_prospect_opportunity_fk FOREIGN KEY (prospect_opportunity_id, organization_id)
      REFERENCES public.prospect_opportunities(id, organization_id) ON DELETE CASCADE;
  -- same three lines for opportunity_assignments and opportunity_dispositions;
  -- uq_opp_lifecycle_initial gets a sibling partial index on (prospect_opportunity_id) WHERE is_initial.
  ```
  - Cost: it widens tables the retention job and the lifecycle guard already touch. `retention.ts` child mapping keys on the feed item, so prospect-opportunity rows would be outside that mapping. The retention `lifecycle_history` target deletes by age, which must be scoped to `opportunity_feed_item_id IS NOT NULL`.
  - The status vocabulary is the existing 9 signal-triage states.
- **P1-B (sibling ledger).** `prospect_opportunity_transitions` copies the `prospect_lifecycle_transitions` shape column for column: `seq`, `previous_state`, `is_initial`, `origin`, `actor_user_id`, `source_event_key`, `transitioned_at`, the append-only and chain triggers keyed on `opportunity_id`, and a composite FK to `prospect_opportunities`.
  - Its state CHECK must be **one existing vocabulary verbatim** (D-1).
  - Owner goes to `operational_assignments` with `entity_type='prospect_opportunity'` (the partial-unique one-active-owner index already exists), or to a P1-A-widened `opportunity_assignments`.

P2 (G3/G4) hardens the existing tables without changing their shape:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_opportunity_feed_items_id_org ON public.opportunity_feed_items (id, organization_id); -- Agent 1 adds this
CREATE UNIQUE INDEX IF NOT EXISTS uq_opp_assignment_one_active
  ON public.opportunity_assignments (organization_id, opportunity_feed_item_id, role) WHERE unassigned_at IS NULL;  -- fails if duplicates exist: preflight count first
ALTER TABLE public.opportunity_assignments  ADD CONSTRAINT opp_assignments_item_tenant_fk  FOREIGN KEY (opportunity_feed_item_id, organization_id) REFERENCES public.opportunity_feed_items(id, organization_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.opportunity_dispositions ADD CONSTRAINT opp_dispositions_item_tenant_fk FOREIGN KEY (opportunity_feed_item_id, organization_id) REFERENCES public.opportunity_feed_items(id, organization_id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.opportunity_lifecycle_states ADD CONSTRAINT opp_lifecycle_item_tenant_fk FOREIGN KEY (opportunity_feed_item_id, organization_id) REFERENCES public.opportunity_feed_items(id, organization_id) ON DELETE CASCADE NOT VALID;
-- VALIDATE CONSTRAINT after a read-only count of mismatching rows is 0.
```

P3 (G2, only if D-4 chooses a stored snooze): `snoozed_until timestamptz` on the P1 ledger row
(or on the `revisit_later` disposition), with CHECK `snoozed_until IS NULL OR disposition = 'revisit_later'`.

P4 (G5): section 7 option (b).

## 10. Status vocabularies (verbatim). None is new.

| Where | Values | Enforced |
|---|---|---|
| `opportunity_lifecycle_states.state` / `LIFECYCLE_STATES` (`backend/types/opportunityLifecycle.ts`) | `detected, triaged, reviewing, qualified, monitoring, outreach_planned, converted, dismissed, archived` | DB CHECK plus `ALLOWED_LIFECYCLE_TRANSITIONS` |
| `prospect_lifecycle_transitions.state` / `PROSPECT_STATES` (`prospectLifecycle/stateModel.ts`) | `identified, qualified, engaged, nurture, meeting_scheduled, not_interested, closed_disqualified` (initial `identified`, 20261029) | DB CHECK plus `PROSPECT_STATE_MODEL` |
| `operational_states.status` for `canonical_lead`/`opportunity` / `DEFAULT_STATE_MODEL` (`lib/operations/operationalStateModel.ts:31`) | `new, qualified, working, meeting_scheduled, proposal, won, lost, archived` | code only (DB checks non-blank) |
| `active_leads.status` (20260817, never applied) | `new, reviewing, contacted, qualified, won, lost, dismissed, snoozed` | would-be CHECK |
| `opportunity_dispositions.disposition` / `DISPOSITIONS` | `qualified, disqualified, low_priority, revisit_later, not_relevant, converted, duplicate` | DB CHECK |
| `opportunity_assignments.role` / `ASSIGNMENT_ROLES` | `analyst, reviewer, owner, observer` | DB CHECK |
| `opportunity_feed_items.opportunity_type` / `OPPORTUNITY_TYPES` | `buying_intent, competitor_dissatisfaction, hiring_signal, migration_signal, product_research, integration_need, support_frustration, generic_interest` | DB CHECK |
| `canonical_leads.lead_status` | free text; the resolver writes NULL; "PI never reads it" | none |
| `prospect_accounts.status` | `active, merged, suppressed, archived` | DB CHECK |
| `person_account_relationships.relationship_type` | `employee, advisor, contractor, founder, former_employee, unknown` | DB CHECK |
| `operational_tasks.status` | `open, in_progress, done, cancelled` | DB CHECK |

## 11. Acceptance test plan (realschema)

The test is "one prospect, two opportunity types, different owners and statuses, shared source attribution intact".
Proposed file: `backend/tests/realschema/pi_prov_opportunity_lifecycle.test.ts`. It is **not written yet**, because it needs Agent 1's migration (`prospect_source_contributions`) in the replay.

1. Seed company A and company B, users U1 and U2, `canonical_leads` P (A), two `lead_signals` (A), and feed items F1 (`buying_intent`) and F2 (`hiring_signal`) (A).
2. Insert contributions through the Agent 1 writer:
   - `originating` citing F1 (`leadCreated: true`);
   - `contributing` citing F2;
   - `contributing` crm with no signal.
3. Initialise lifecycle for F1 and F2 with `initialiseLifecycleForOpportunity`.
   - Transition F1 detected→triaged→qualified (actor U1).
   - Transition F2 detected→triaged (actor U2).
4. Assign owners with `assignOpportunity`: F1 to U1, F2 to U2.
5. Read the rows back with org-filtered selects and run `buildProspectOpportunities`.
   - Expect two opportunities with distinct type, owner, state and `changedBy`.
   - Expect one originating and two contributing rows.
   - Expect `citingContributionIds` of `[orig]` and `[later]`.
   - Expect no anomalies.
6. Negative tests (DB):
   - a contribution citing F1 with `organization_id = B` gives 23503 (composite FK);
   - a second `originating` for P gives 23505 (`uq_psc_one_originating_per_lead`);
   - an UPDATE of an `opportunity_lifecycle_states` row raises the append-only error.
7. Document, as a characterization (not a fix), that a second active owner for F1 is ACCEPTED by the database today (G3), and that the view reports `contradictory`.
8. Retention: deleting F2 is blocked by the append-only lifecycle trigger (cascade). Assert the observed behaviour and record it. Do not change it.

Run: `CI=true node node_modules/jest/bin/jest.js -c jest.config.js --ci --no-coverage -w=1 --runTestsByPath backend/tests/realschema/pi_prov_opportunity_lifecycle.test.ts` against the Docker-free PG17 harness.

## 12. Unresolved owner / product decisions

- **D-1. Opportunity status vocabulary.** Choose one existing vocabulary (section 10). Candidates:
  - OLS 9 states: signal triage, already per-opportunity, DB-checked.
  - `DEFAULT_STATE_MODEL` 8 states: business pipeline, with `won/lost/proposal`, but code-only.
  - The 20260817 8 states (never applied).

  Mapping between them is not 1:1. For example, OLS has no won/lost, and `DEFAULT_STATE_MODEL` has no `dismissed/snoozed`.
- **D-2. Opportunity type vocabulary for non-community opportunities** (CRM deal, inbound demo request). The 8 OFI types are signal classifications, not pursuit types.
- **D-3. Roll-up rule.** Is a business opportunity "one per (prospect, type)" (the 20260817 rule), or "one per pursuit, many per type"? How do several signals of the same type merge?
- **D-4. Snooze.** Stored deadline (P3), a follow-up task (`operational_tasks.due_at`), or not a feature.
- **D-5. Account-only prospects:** section 7 (a), (b) or (c).
- **D-6. Lifecycle home for durable opportunities:** P1-A (widen `opportunity_*`) or P1-B (sibling ledger plus `operational_assignments`).
- **D-7. Prospect-level vs opportunity-level qualification.** `prospect_lifecycle_transitions` stays prospect-level (`closed_disqualified` is terminal for the prospect). Does a prospect-level close also close all its opportunities (a read-time projection), or are they independent?
- **D-8. Contacts ↔ person reconciliation (P3-4 D-C).** `contacts.unified_person_id` is nullable. A community opportunity whose contact has no person cannot reach a canonical prospect, except through a contribution written by the bridge.
