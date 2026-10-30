# Prospect provenance — erasure policy

Status: closure A (privacy), 2026-10-30. Implementation:
`supabase/migrations/20270109000000_pi_provenance_erasure_completeness.sql`
(`public.pi_erase_prospect_provenance`), caller
`backend/services/prospectIdentity/personErasure.ts` via
`backend/services/prospectProvenance/redaction.ts#eraseProspectProvenance`.
Contract this builds on: `PROSPECT-PROVENANCE-CONTRACT.md` (taxonomy, roles, tenant model
unchanged).

## Obligations found in the repository (respected, not redefined)

| Source | Obligation | Effect here |
|---|---|---|
| ADR §16 / `personErasure.ts` header | Governance records are revoked, never deleted; re-anchored records carry the originating record id, never the erased person id. | `contact_governance_records` untouched by this function (see "keep"). The audit event stores no person id. |
| PG-001 DR-7 / R-4 | Erasure carries `purpose_scope` forward. | Unchanged (governance step runs before this one). |
| `PROSPECT-PROVENANCE-CONTRACT.md` | Contributions are append-only; service_role SELECT+INSERT only. | Still true. The SECURITY DEFINER function is the only mutator, as in 20270108000001. |
| Owner decision 8 (20270108000001) | Redact personal URLs/evidence, keep an auditable tombstone, delete nothing. | Rows are redacted in place; tombstones kept; no value hash. |
| `PL-DEC-003` (MA-13), OPEN | Whether a `canonical_leads` row survives erasure is the owner's decision. | Rows survive (option A, current behaviour); only their personal fields are redacted. Row deletion is not decided here. |
| `personErasure.ts` note 4, `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-002` §6 | No retention period is decided. | None is introduced. |
| `canonical_decisions_append_only`, `prospect_score_evaluations_immutable` triggers | Those ledgers are immutable by design (other tracks). | Not modified; recorded as open gaps below. |

## Decision vocabulary

- **null** — the column is set to NULL.
- **marker** — a JSON object column is replaced by `{"redacted": true, "erasure_id": <event id>}`
  (contributions additionally carry `redaction_id`, the per-contribution tombstone). Whole objects are
  replaced, never key-filtered: an allow-list of "non-personal" keys would have to be proven per
  ingestion path.
- **id-marker** — a NOT NULL / unique identifier column is replaced by `redacted:<row id>`. The row id
  is a random uuid, so the marker carries no information about the subject and stays unique.
- **delete** — the row is removed.
- **cascade** — removed by an existing `ON DELETE CASCADE` when `personErasure.ts` deletes the person
  (unchanged; happens only after the function succeeds).
- **keep** — retained, with the justification given.

## Scope of one call

`pi_erase_prospect_provenance(org, person, leads[], reason, requested_by)` — tenant-first throughout:

- leads `L` = the tenant's `canonical_leads` named in `leads[]` ∪ those with `unified_person_id = person`;
- contacts = the tenant's contacts with `unified_person_id = person` ∪ contacts cited by contributions of `L`;
- threads = the tenant's `engagement_threads` of the person or of those contacts; messages = the
  tenant's messages of those threads ∪ messages cited by contributions of `L`;
- lead signals = the tenant's signals of those contacts/threads ∪ cited by contributions of `L`;
  feed items = items of those signals ∪ cited by contributions of `L`;
- source records = the tenant's **person-level** records of the person ∪ person-level records cited by
  contributions of `L`;
- lead intelligence = the tenant's `lead_intelligence` with `unified_person_id = person`.

A person or lead of another tenant ⇒ 42501 before anything is written.

## Field map

### Provenance ledger

| Table.field | Personal / linkable? | Decision |
|---|---|---|
| `prospect_source_contributions.source_url` | personal URL | null |
| `.evidence`, `.source_metadata` | excerpts, handles, contact keys | marker |
| `.external_ref` | `<provider>:<id>` — provider person id / handle / CRM id, resolvable at the provider | id-marker (`redacted:<contribution id>`, passes the contract CHECK) — see trade-off |
| `.platform`, `.source_category`, `.contribution_role`, `.observed_at`, `.created_at`, `.ingestion_run_id`, typed pointers | not personal (classification, time, internal uuids) | keep — the provenance chain stays readable |
| `prospect_source_contribution_redactions.*` | reason, requester, field names, internal ids | keep (audit) |
| `prospect_source_contribution_redactions.values_sha256` | unsalted hash of values — confirms guessable values | **retired**: existing values nulled; CHECK `values_sha256 IS NULL` |
| `prospect_provenance_erasures.*` (new) | tenant, kind, reason, requester, time, surviving lead ids, counts, field names | keep (audit); no person id, no value, no hash |

### Source evidence

| Table.field | Personal / linkable? | Decision |
|---|---|---|
| `source_records.source_url` (person record) | personal URL | null |
| `.raw_payload` (person record) | provider payload | marker |
| `.payload_hash` (person record) | hash of the payload — a re-delivery would match it | recomputed over the marker |
| `.source_record_id` (person record) | provider person id | id-marker |
| `.person_id`, `.account_id`, `.provider`, `.platform`, `.source_category`, times | internal ids / classification | keep; `person_id` SET NULL by cascade on person delete; `account_id` is lineage owned by the identity track (`personErasure.ts` D1 note) |
| `source_records` with `source_entity_type = 'account'` | company data, may back other prospects | keep (not the subject's data); only the citing contribution is redacted |
| `source_assertions.raw_value` | value | null |
| `.normalized_value` | value (CHECK requires one of the two) | `[redacted]` |
| `.value_hash` | unsalted hash of a value (e.g. an email) — confirms guesses | `sha256('redacted:' || id)` (keeps the hex64 CHECK and the dedupe index, carries nothing) |
| `.account_id` (person assertions) | employer leg | null (as `personErasure` step 5) |
| `.attribute`, `.provider`, times | field name / classification | keep |
| `canonical_attribute_decisions.value` | decided value | **OPEN GAP** — append-only trigger forbids any change; owned by the identity track. Needs an owner decision (sanctioned redaction exception in the trigger, or accept). |
| `identity_claims.*` | emails, phones, handles | cascade (person FK is CASCADE); read first by `personErasure` step 1 for re-anchoring |
| `prospect_problem_observations` (person subject) | statements | cascade |
| `person_account_relationships`, `person_duplicate_candidates(person_id)`, `prospect_archive_recommendations`, `prospect_enrichment_attempts` | person-keyed | cascade |
| `prospect_score_evaluations.evidence` / `.reasoning` | may quote evidence (CODE-INFERRED) | **OPEN GAP** — immutable by trigger; cascades only when the lead is deleted (PL-DEC-003). |

### Contacts, signals, opportunities

| Table.field | Decision |
|---|---|
| `contacts.display_name`, `.profile_url` | null |
| `contacts.platform_user_id`, `.contact_key` | id-marker (unique keys) |
| `lead_signals.content_text`, `.platform_user_id`, `.contact_key`, `.crm_lead_id` | null |
| `lead_signals.metadata` | marker |
| `lead_signals.source_id` | id-marker (platform post/message id) |
| `lead_signals` scores, `platform`, `source_type`, times | keep |
| `opportunity_feed_items.author_metadata`, `.source_context`, `.explanation`, `.recommendation_context` | marker (excerpt-bearing; CODE-INFERRED for the last two) |
| `opportunity_feed_items.source_identifier` | null |
| `opportunity_feed_items.detected_reason` | `[redacted]` (NOT NULL; may quote the post) |
| `opportunity_feed_items` scores, type, `matched_keywords` (tenant configuration) | keep |

### Engagement

| Table.field | Decision |
|---|---|
| `engagement_threads.raw_payload` | null |
| `engagement_threads.platform_thread_id` | id-marker |
| `engagement_messages.content`, `.raw_payload`, `.actor_external_id`, `.platform_parent_id`, `.sync_thread_id` | null — all messages of the person's threads, both directions (the conversation is with the subject) |
| `engagement_messages.author_id` | null (severs the link to the global author profile) |
| `engagement_messages.platform_message_id` | id-marker |
| `engagement_message_sources.platform_message_id` | id-marker |
| `engagement_insight_evidence.author_name`, `.text_snippet` | null |
| `engagement_opportunities.opportunity_text`, `.author_id` | null |
| `engagement_thread_memory.conversation_summary` | null |
| `engagement_thread_intelligence.priority_reason` | null |
| `engagement_lead_signals.author_id` | null |
| `engagement_identity_candidates` (person's rows) | delete — the row is only a handle ↔ person link; the table has no tenant column, the person id is tenant-checked first |
| `engagement_authors` | keep — GLOBAL (no tenant column), shared across tenants; one tenant's request cannot erase it. Every link from this tenant's rows is nulled. **Residual**: the profile row survives (platform-level decision needed). |
| `engagement_thread_events.detail`, `engagement_telemetry_events` | keep — tenant-user action / telemetry records; not verified free of message text (**ASSUMPTION**, listed under gaps) |
| `engagement_message_intelligence`, `engagement_thread_classification` | keep — categorical only |

### Lead intelligence and the prospect rows

| Table.field | Decision |
|---|---|
| `lead_intelligence.identity`, `.attribution`, `.content`, `.metadata` | marker |
| `lead_intelligence.dedupe_key` | id-marker (often `email:<address>`) |
| `lead_intelligence.source_id` | null (may be an external id) |
| `lead_intelligence.unified_person_id` | null — the FK is ON DELETE RESTRICT, so a linked row made the person undeletable (`deletePersonRow` reported it as `merge_survivor`) |
| `lead_intelligence.campaign`, `.scores`, `.source`, `.status`, times | keep (tenant campaign data / classification) |
| `lead_intelligence_events.metadata` | marker; `.entity_id` null |
| `lead_intelligence_profiles.intelligence`, `.diagnostics` (`lead_id` = the lead_intelligence id) | marker |
| `canonical_leads.lead_metadata` | marker |
| `canonical_leads.external_lead_key` | null (provider/CRM key; unique per tenant when present) |
| `canonical_leads` row, `source`, `qualification_score`, `lead_status` | keep — row existence is PL-DEC-003 |
| `canonical_users.email`, `.full_name`, `.phone`, `.geo`, `.external_user_key` | null |
| `canonical_users.user_metadata` | marker |
| `unified_persons` | delete — by `personErasure.ts` after the function succeeds |

### Kept by design, outside this function

| Table | Justification |
|---|---|
| `contact_governance_records` (incl. re-anchored `target_normalized`) | Suppression must stay enforceable after erasure (ADR §16, PG-001). Holding the address is the legal basis for not contacting it again. |
| outreach history (`outreach_tasks`, `outreach_decisions`, delivery evidence), `canonical_revenue_events`, `unified_touchpoints`, `visitor_sessions`, `expected_event_instances`, legacy `leads` | Owned by other tracks; SET NULL edges by design (`personErasure.ts` header). Not provenance. Residual personal data there is out of scope and recorded as a gap. |
| `marketpulse_signal_observations` | Tenant market signals, not keyed to a person. |
| `prospect_aliases` (20270109000001) | Holds no personal data by construction: `evidence` records only the rule versions, the verification result and the platform — never the handle or the person id (enforced in `identityReconciliation.ts` and asserted by `piProvIdentityReconciliation` and `pi_prov_identity_ordering`). The rows are append-only (UPDATE refused), so this is the only way they can never retain erasable data. Lead ids are random and survive as audit of the merge; they cascade away if a lead is deleted. |

## Hashing decision

Value hashes are removed, not re-keyed. Auditability requires proof that an erasure happened —
tenant, time, reason, requester, field names, row counts — and not proof of which values were
removed. A value hash exists only to confirm a candidate value later; unsalted, it confirms guessable
values (a LinkedIn URL, an email) by recomputation. A keyed HMAC would need a key the database never
holds, and losing or rotating it would silently void the evidence. Therefore:

- `values_sha256` is nulled on every existing tombstone and a CHECK forbids writing it again. The
  column is kept (nullable) so the validated 20270108000001 stays re-runnable and its schema-parity
  entry stays pinned.
- `source_assertions.value_hash` and `source_records.payload_hash` of erased rows are recomputed
  over the marker, never over a value.
- No secret or environment variable is needed.

## external_ref trade-off

`external_ref` is the per-lead idempotency key (`uq_psc_org_lead_external_ref`). Replacing it with
`redacted:<contribution id>` means a provider that re-delivers the erased subject's event would
append a new contribution instead of being deduplicated against the erased one. Keeping it would
leave a key that resolves the person at the provider. Erasure wins: every non-erased row keeps its
key and its idempotency unchanged, and keeping an erased subject from being re-ingested is a
suppression question (`contact_governance`), not something a retained identifier should answer. The
same trade-off applies to `source_records.source_record_id`, `contacts.platform_user_id`/`contact_key`,
`lead_signals.source_id`, `engagement_threads.platform_thread_id` and
`engagement_messages.platform_message_id`.

## Failure semantics

- One call is one statement, so it is one transaction: any failure rolls back every change and every
  tombstone. No erasure event is ever written for an erasure that did not complete.
- `personErasure.erasePerson` calls the function for every person, before the delete, and throws
  `PersonErasureError('provenance_<code>')` on any failure — including an undeployed function
  (`provenance_erasure_unavailable`) and a success without an event id — so the person is not
  deleted. There is no fallback to the contribution-only function.
- Repeated calls change nothing and report zero counts. Each completed call writes one audit event.
- Ordering trade-off, unchanged from 20270108000001: redaction is irreversible. If the later person
  delete fails (for example a merge survivor), the person row survives with its own fields while the
  graph is already redacted. A retry is idempotent.

## Open gaps (owner decisions)

1. `canonical_attribute_decisions.value` — append-only trigger; personal values survive with
   `person_id` NULL.
2. `prospect_score_evaluations.evidence`/`.reasoning` — immutable trigger; possible excerpts survive
   while the lead row survives.
3. `engagement_authors` — global profile rows survive (links nulled).
4. Outreach history, revenue events, touchpoints, visitor sessions, legacy `leads` — not covered.
5. `engagement_thread_events.detail` — not verified free of message text.
6. `lead_intelligence` rows tied to the subject only by `dedupe_key`/`source_id` (no person link) are
   not found.
7. Re-ingestion: a provider or sync that re-sends the subject recreates data; prevention belongs to
   suppression at ingestion.
