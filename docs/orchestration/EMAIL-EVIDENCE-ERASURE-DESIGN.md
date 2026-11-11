# Email evidence erasure: design

**Status: design for approval. Not built.** Real email stays disabled until this policy is approved and tested: `LEAD_OUTREACH_EMAIL_ENABLED` remains off, and enabling it is on the blocker register as gated by this work.

**Basis:** a read-only survey of the RC's erasure programme and the recovery branch's email path. Nothing in this design has been executed. Items marked *unverified* need checking during the build.

## The problem

The email engine records exactly what was sent, immutably, before calling the provider. That text can include a person's name and job title, and the erasure flow does not know the table exists. So today, erasing a person would leave their personalized email text behind.

## Three classes of data

| Class | Meaning | Treatment on erasure |
|---|---|---|
| **Personal content** | Text or values about the person | **Redact in place** |
| **Execution metadata** | Facts about an attempt, some pseudonymous | **Keep what other systems depend on; scrub free text** |
| **Non-identifying audit** | That something happened, under what policy | **Keep** |

## Column by column

### Personal content: redact

| Column | Why | Proposed value |
|---|---|---|
| `email_outreach_content_evidence.rendered_subject` | Contains substituted values | Fixed marker, e.g. `[erased]` |
| `.rendered_body` | Same | Fixed marker |
| `.personalization_inputs` | The values themselves, plus `recipient_source_of_truth` | `{}` |

The CHECKs require non-blank text and a JSON object, so these values fit without a schema change. The 8-column postcondition means a "redacted" flag column would conflict with the ratified shape; the marker text is the state.

### Execution metadata

| Column | Risk | Proposal |
|---|---|---|
| `outreach_delivery_evidence.provider_message_id`, `provider_event_id` | Pseudonymous; resolvable at AWS | **Keep.** Late bounces and complaints resolve through it, and losing that would drop a suppression |
| `outreach_attempts` rows | `error` is null by code, key is a hash | **Keep.** A historic unsubscribe link needs the attempt, or it returns `invalid_link` |
| `outreach_delivery_evidence.transport_response` | Designed content-free, but `rejectionReason` and `raw.error` are provider free text | **Scrub** those fields |
| `outreach_outcomes.evidence`, `.metadata` | Webhook writes types only; other callers are free-form | **Scrub to type and code.** Keep `recordedByUserId`, which is the operator, not the subject |
| `outreach_decisions.reason` | Contents not audited | **Audit first** (*unverified*) |
| `outreach_tasks.action`, `.explanation` | `action` is the authored instruction with unrendered placeholders; an author could type a name | **Keep, and document**: this is the tenant's template, not rendered output. Decision E-3 |

### Non-identifying audit: keep

`execution_journey_decisions` (codes only, proven by a test), `outreach_bridge_handoffs` (person nulled, D-2), `outreach_approvals`, plan and step state.

### Must survive, deliberately

`contact_governance_records` keeps the address, because **"holding the address is the legal basis"** for continuing to honour an opt-out (`PROSPECT-PROVENANCE-ERASURE-POLICY.md`). This is existing policy. Two consequences:

- Surviving target rows hold the address and `attemptId`, which joins the address to the attempt. After redaction the attempt no longer reveals content. **Decision E-2** is whether that join may remain.
- **Risk found:** re-anchoring reads `identity_claims`, while the email recipient comes from `unified_persons.primary_email`. A person-only unsubscribe with no matching claim could become unenforceable after erasure (*unverified*; must be tested). Fix before enabling email, because this is a suppression failure.

## Mechanism

Reuse the RC's pattern for redacting an append-only row. Do not invent a second one.

1. **Signal:** a `pi_erasure_authorizations` row for a new scope `email_content_evidence`, keyed to the current transaction. No client role can hold it, and a GUC was already rejected as client-settable.
2. **Writer:** a `SECURITY DEFINER` function with `search_path = ''`, called only from `pi_person_erasure_finalize`, revoked from `service_role`.
3. **Guard:** the evidence guard admits only this exact shape: the three columns equal the fixed values, every other column unchanged by `to_jsonb` diff, authorization held. Anything else gets today's refusal.
4. **Finding the rows:** the table has no `person_id`, while authorization is per person. Derive through attempt → task → person. This **must run before finalize deletes the person**, because the FK nulls `outreach_tasks.person_id` in that delete.
5. **Close a gap found in the survey:** the guard blocks UPDATE only and `service_role` is not revoked, so DELETE is not refused despite the "immutable" header. Add a DELETE refusal.

## Verification

`pi_person_erasure_verify` has no registry, so this needs:

- `CREATE OR REPLACE` to append a check to `v_checks`.
- A new inventory column, captured before finalize, because the links are severed by then.
- `violation` if any inventoried evidence row is not redacted.
- Manifest updates in `scripts/verify-schema-parity.js`.

**Existing requests:** a completed residual request would have an empty inventory column and pass vacuously. Mark those as predating this check rather than reporting them clean.

## Retention (independent of erasure)

**No outreach retention policy exists.** `personErasure.ts` says it is undecided, and `RETENTION_TARGETS` has no outreach entry. Without one, content is kept forever for everyone who never asks for erasure.

**Recommendation, needing legal input:** purge rendered content after a fixed window using the same redaction path, while keeping attempts and evidence. A window of 90 days covers late bounces and complaints, which is what the content is for operationally. The number is your decision with counsel; I have no legal basis for choosing it.

## Sending stays off

The flag is the control. In addition, before enabling:

| Gate | How |
|---|---|
| Policy approved | E-1..E-4 signed |
| Redaction built and proven | Tests below |
| Real send on a test tenant | Separate authorization |

## Tests required

1. Erase a person with sent email: content redacted, attempt and evidence kept, verification clean.
2. A client or `service_role` cannot redact or delete: refused.
3. Redaction without authorization refused; wrong tenant refused.
4. Erasing person A leaves person B's rows byte-identical.
5. A late bounce and a historic unsubscribe link still work after erasure.
6. A person-only unsubscribe with no claim remains enforced after erasure (the risk above).
7. Merge does not redact.
8. Migration and rollback, with rollback refusing once any row is redacted.

## Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| E-1 | Approve redact-in-place for personal content | Approve |
| E-2 | May a governance record keep the address plus `attemptId` | Keep; after redaction it reveals only that an attempt happened |
| E-3 | Authored `instruction` text: retain, or scan for names | Retain and document; add authoring guidance |
| E-4 | Retention window for rendered content | Decide with counsel; 90 days as a starting point |
| E-5 | Build order: this needs the RC erasure programme on main | Build after D-2 is resolved |

## Ownership

Privacy owns the erasure functions and verification. Orchestration and Outreach own the guard change on the evidence table. Migrations are serialized: nobody else edits this table while it is in progress.
