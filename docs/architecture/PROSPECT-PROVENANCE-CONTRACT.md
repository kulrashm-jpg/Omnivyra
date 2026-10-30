# Prospect provenance contract

Status: owner-approved direction (2026-10-30); implementation in progress on
`feat/prospect-provenance-integration`. Code contract: `lib/prospectProvenance/contract.ts`.
Writer: `backend/services/prospectProvenance/contributionWriter.ts` (the only write path).

## Questions this must answer for every canonical prospect
Where it was first discovered; which platform / campaign / community / signal originated it;
what evidence supports it; which sources contributed later and when each was observed;
which tenant owns it; which opportunities are associated with it and their lifecycle.

## Separate concepts (never conflated)
| Concept | Column | Notes |
|---|---|---|
| Discovery classification | `source_category` | 12-value controlled vocabulary (below). Set explicitly by the ingestion path. |
| Originating platform/provider | `platform` | e.g. `linkedin`, `reddit`, `apollo`, `hubspot`. Free text, lowercase. |
| Original source record | `source_record_id` → `source_records.id` | Per-provider record (existing PI table). |
| Namespaced external id | `external_ref` | `<provider>:<id>`; idempotency key per lead. |
| Original evidence location | `source_url` | Where the evidence lives, when one exists. |
| When the source observed it | `observed_at` | Source time (`posted_at`, `detected_at`, form submit time) — not ingestion time. |
| Tenant | `organization_id` | = `companies.id` (same identity as `canonical_leads.company_id`). |

`source_category` vocabulary: `marketpulse`, `social_listening`, `community`, `engagement`,
`inbound_form`, `inbound_webhook`, `manual`, `crm`, `csv`, `pi_discovery`, `pi_enrichment`,
`website` (historical compatibility).

`source_category` is distinct from the display source `CanonicalLeadSource` in
`lib/leadIntelligence/types.ts`, which is persisted in `lead_intelligence.source`, dedupe keys and
audience memberships and must not be renamed.

## Contribution roles
`originating` (the source whose ingestion CREATED the canonical lead) and `contributing` (any later
source). Exactly one originating per lead (partial unique index). Append-only. A lead created before
provenance existed is not re-originated by its first later contribution.

## Table `public.prospect_source_contributions` (names are contract)
| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | uuid | no | PK, `gen_random_uuid()` |
| `organization_id` | uuid | no | FK `companies(id)` |
| `canonical_lead_id` | uuid | no | composite FK `(canonical_lead_id, organization_id)` → `canonical_leads(id, company_id)` |
| `contribution_role` | text | no | CHECK in (`originating`,`contributing`) |
| `source_category` | text | no | CHECK in the 12-value vocabulary |
| `external_ref` | text | no | CHECK `^[a-z][a-z0-9_]{0,39}:.+` |
| `source_record_id` | uuid | yes | composite FK → `source_records(id, organization_id)` |
| `platform` | text | yes | |
| `source_url` | text | yes | |
| `contact_id` | uuid | yes | composite FK → `contacts(id, organization_id)` |
| `lead_signal_id` | uuid | yes | composite FK → `lead_signals(id, organization_id)` |
| `opportunity_feed_item_id` | uuid | yes | composite FK → `opportunity_feed_items(id, organization_id)`; feed items are retention-deleted, so the reference must survive deletion of the item without losing the contribution |
| `engagement_message_id` | uuid | yes | composite FK → `engagement_messages(id, organization_id)` |
| `ingestion_run_id` | text | yes | matches `source_records.ingestion_run_id` (text in production) |
| `observed_at` | timestamptz | no | |
| `evidence` | jsonb | no | default `{}`, CHECK object |
| `source_metadata` | jsonb | no | default `{}`, CHECK object |
| `created_at` | timestamptz | no | default `now()` |

Constraints/indexes (names are contract): `uq_psc_org_lead_external_ref` UNIQUE
(`organization_id`, `canonical_lead_id`, `external_ref`); `uq_psc_one_originating_per_lead` UNIQUE
(`canonical_lead_id`) WHERE `contribution_role = 'originating'`; plus lookup indexes by tenant+lead+time,
tenant+source record, tenant+category+time.

Composite FKs require `(id, organization_id)` unique keys. Present in production (verified read-only
2026-10-30): `canonical_leads (id, company_id)`, `source_records (id, organization_id)`,
`engagement_messages (id, organization_id)`. ABSENT: `contacts`, `lead_signals`, `opportunity_feed_items`
— the migration adds them (`CREATE UNIQUE INDEX IF NOT EXISTS … (id, organization_id)`; `id` is already
unique, so this cannot fail on existing rows).

Privileges: RLS enabled; REVOKE ALL from PUBLIC, anon, authenticated; GRANT SELECT, INSERT to
service_role only (no UPDATE/DELETE ⇒ append-only at the privilege level).

`source_records` gains nullable `source_category` (same CHECK), `platform`, `source_url`.

## Namespacing and legacy keys
New external ids are `<provider>:<id>`. Existing `canonical_leads.external_lead_key` values are raw
(19 rows in production on 2026-10-30). Lookups for an existing prospect must try the namespaced key
and then the legacy raw key, so a resync never creates a duplicate prospect.

## Scores
Every score carries its scale (`unit` 0..1 or `percent` 0..100). Conversion is explicit
(`toUnitScore`); different scales are never compared implicitly.
