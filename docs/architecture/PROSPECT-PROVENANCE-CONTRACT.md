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

## Enrichment contributions and score availability (closure C)
Code: `backend/services/prospectProvenance/ingestion/enrichmentContribution.ts`,
`lib/prospectProvenance/scoreSemantics.ts`; migration `20270109000002_pi_qualification_score_nullable.sql`.

**Enrichment is never an originator.** It records `contributing` rows only (`source_category =
'pi_enrichment'`, `platform = <provider>`), never writes `canonical_leads` and never touches the
originating contribution or the prospect's original `source`/`created_at`.

**Refresh (content-addressed `external_ref`).** `enrichment_<provider>:<subject>:<entityId>:<fp>`, where
`<fp>` = first 16 hex of sha256 over the normalised `(subject, attribute, value)` set the provider
returned (trimmed, whitespace-collapsed, case-folded; arrays de-duplicated and sorted; empty values
ignored). Provider time, payload hash, confidence and correlation id are not inputs. The idempotency key
stays `(organization_id, canonical_lead_id, external_ref)`:
- identical refresh ⇒ same ref ⇒ `duplicate` (nothing new);
- materially different observation ⇒ new ref ⇒ a new `contributing` row; earlier rows remain (history).

Values are hashed, never stored: `evidence` holds attribute names, `observationFingerprint`,
`payloadHash`, `evidenceLevel`, `accountLink`.

**Applicability.**
| Evidence | Attaches to | Never |
|---|---|---|
| Person (`subject = person`) | The caller's prospect only if `canonical_leads.unified_person_id` = that person; without a caller prospect, the tenant's single prospect anchored to the person | A prospect anchored to another person; any prospect when the person has several (`ambiguous_prospect`) |
| Account (`subject = account`) | Prospects whose account link is **evidenced**: (1) the prospect's originating contribution's `source_records.account_id` = the account, or (2) its person's `unified_persons.account_id` = the account, or (3) a current (`ended_at IS NULL`) `person_account_relationships` row for its person and the account. Caller prospect ⇒ that prospect if evidenced; no caller prospect ⇒ every evidenced prospect (cap 50) | Unevidenced prospects (`account_link_unevidenced`); a partial fan-out (over cap or incomplete read ⇒ nothing, `too_many_account_prospects`) |

Account evidence carries `evidence.evidenceLevel = 'account'`, `personId = null` and `accountLink` (which
of the three rules matched). Readers must present it as company-level evidence, never as a fact about the
person. All lookups are tenant-filtered.

**Score availability.** NULL = unscored/unavailable; 0 = genuinely scored zero; missing is never
converted to 0. `canonical_leads.qualification_score` is nullable with no default from `20270109000002`
(range CHECK 0..100 kept). Existing rows are not backfilled. Rule for rows that may hold the old default:
a stored 0 counts as a score only when `lead_metadata.qualificationScoring` is present (a scorer that can
emit 0 must stamp it); a bare 0 is reported as unscored (`legacy_default`). Writers omit or write NULL when
unscored (WS-1 resolver omits; CRM writes NULL when the row has no usable revenue). Readers exclude unscored
leads from averages and intent bands (`intentBands.unscored`), export "not scored", and never show 0%.
