# LI-3 Contact Governance ADR

## 1. Status

**ACCEPTED — decisions only. Nothing is implemented.**

| | |
|---|---|
| Phase | LI-3A (architectural decision record) |
| Supersedes | nothing |
| Blocks | LI-3B implementation until D-1 and D-2 are read and agreed |
| Evidence base | LI-3 Contact Governance Foundation Audit (verdict: CONDITIONAL GO) |
| Released state at time of writing | commit `211354a5`, deployment `c723112b` |

Two of the four decisions (D-1, D-2) are made here on architectural grounds. One (D-3) is made architecturally with a **legal question explicitly escalated**. One (D-4) is resolved by re-ordering rather than by billing, with implementation deferred.

## 2. Context

The LI-3 audit established, by direct probing of production rather than by reading code:

- **Every governance table is empty.** `suppression_entries` 0, `outreach_suppressions` 0, `outreach_governance_config` 0, `outreach_decisions` 0, `outreach_delivery_evidence` 0, `lead_outreach_plans` 0.
- **`consent_records` (0 rows, no RLS, no policies) is OAuth/integration consent, not prospect consent.** The name collides; it must not be reused.
- **Two complete, independent governance stacks exist**, each documented as the sole authority, neither authoritative in practice.
- **A `__global__` suppression row was proven to suppress both Tenant A and Tenant B.**
- **Neither existing table links to `unified_persons`**; both key on a raw target string, and both use a `text` tenant column with **no foreign key** — a suppression naming a nonexistent tenant was accepted.
- **`unsubscribed` arrives as a feedback signal and never becomes a suppression.** `feedbackIngestion` is architecturally a one-way terminus.
- **No WhatsApp path consults suppression**, and inbound WhatsApp records no opt-out signal.
- **Deferment, quiet hours, contact fatigue and frequency caps do not exist** — zero files, zero tables.

The LI-2 cheap-rollback window remains open (`source_records` 0, `source_assertions` 0). LI-3 does not consume it.

Everything below is written on the assumption that these tables stay empty until LI-3B lands. If any becomes populated first, the legacy disposition in §17 must be re-decided.

## 3. Decision Summary

| ID | Decision | Type |
|---|---|---|
| **D-1** | **Option A — tenant-only.** No platform-global DNC in the canonical model. A compliance register is specified as a *contingency shape* but is **not** authorised or built. | Architectural |
| **D-2** | **Path B is the canonical evaluator. LI-3 supplies its data source. Path A is deprecated-in-place, frozen, and removed only when three conditions are met.** No adapter, no data migration — both tables are empty. | Architectural |
| **D-3** | **A tenant DNC survives deletion of the person**, via the proven `ON DELETE SET NULL (person_id)` pattern. **The retention/erasure interaction is escalated as a LEGAL DECISION.** | Architectural + Legal |
| **D-4** | **Option C in principle — generation and transmission are separately represented — but the correct fix is ordering, not billing:** evaluate governance *before* generation so neither cost is incurred. Billing implementation deferred. | Architectural; implementation deferred |

## 4. D-1 — Platform-Global Suppression

### Decision

**OPTION A. Tenant-only governance. The canonical LI-3 model has no global scope, no `__global__` sentinel, and no cross-tenant reach of any kind.**

### Rationale

The audit did not find a latent risk; it found a working cross-tenant channel. A `__global__` row was accepted by the schema and suppressed both tenants, because `isSuppressed` queries `company_id IN ('__global__', companyId)` by design. That is currently harmless only because the table is empty — which is precisely the moment to remove it rather than inherit it.

Three further reasons:

1. **No documented requirement exists.** I looked for one. `legal_hold` exists only as a value in a CHECK constraint with zero rows; there is no compliance workflow, no register, no approver role, and no legal-hold service anywhere in the repository. Carrying a global scope "in case" is carrying an unowned cross-tenant capability.
2. **It contradicts the programme's foundation.** W1 through W5 spent five phases establishing that the same human in two tenants is two independent records, precisely so one tenant cannot mutate another's view. A global DNC re-introduces exactly the shared mutable object those phases removed.
3. **The failure is silent and inverted.** A wrongly-global DNC does not error; it quietly stops a tenant contacting someone they are entitled to contact, and the affected tenant has no visibility into why.

### Alternatives rejected

**Option B (tenant-only + platform compliance register) — rejected now, retained as a contingency.** Not because it is wrong, but because it is unowned. A platform-wide block is an instrument with real power and it needs a named owner, an approval path and an audit trail before it exists. Building the table first would create the capability and defer the governance of it — the wrong order.

**Keeping `__global__` behind a feature flag — rejected.** A flag does not remove the column default, the CHECK value, or the `IN ('__global__', …)` predicate. The capability would still exist and could still be written by any code path holding the service role.

### Contingency shape, if Option B is ever authorised

Recorded so a future decision does not have to start from nothing. **This is not authorisation to build it.**

| Aspect | Requirement |
|---|---|
| Purpose | Only regulator-mandated or platform-safety blocks (e.g. a domain the platform is legally barred from contacting). **Never** a tenant's business preference. |
| Table | A **separate** table. Never shares the tenant DNC table — see below. |
| Ownership | A named platform compliance owner, not a tenant and not an engineer. |
| Who may create | Platform super-admin under an explicit approval record. Never an ingestion path, never a webhook, never an AI. |
| Who may revoke | Same authority, with a recorded reason. |
| Evidence required | Mandatory — a reference to the instruction that compelled it. No evidence, no record. |
| Tenant visibility | Tenants **see that a block exists and why in general terms**, never another tenant's data. A silent block is undebuggable. |
| Tenant override | **Never.** That is the point of it. |
| Difference from tenant DNC | Tenant DNC expresses *a tenant's relationship*; this expresses *a platform obligation*. Different owner, different lifecycle, different authority. |
| Entry into the decision | A distinct, earlier gate than tenant DNC, with its own gate name in the decision log so the two are never confused after the fact. |
| **Why a separate table** | Sharing one table means one bug, one bad migration or one over-broad `UPDATE` converts a tenant preference into a platform-wide block. The blast radius must be structurally different, not merely different by a column value — which is exactly the mistake `__global__` makes today. |

## 5. D-2 — Canonical Governance Stack

### Decision

1. **Canonical evaluator: Path B** — `leadOutreachExecution` (WS-3 Milestone-4).
2. **LI-3 supersedes both existing suppression tables** as the source of governance truth.
3. **Path B survives** and is not rewritten. LI-3 gives its already-positioned `suppression` gate a real table to read.
4. **Path A is DEPRECATED IN PLACE — retained temporarily, frozen, removed under conditions.**

| | Canonical |
|---|---|
| Service | `leadOutreachExecution/governanceService.ts` |
| Evaluator | `leadOutreachExecution/governance.ts` (pure) |
| Data source | the new LI-3 governance table (§8) |
| Integration boundary | Path B's existing `suppression` gate |
| Decision log | `outreach_decisions` (existing, append-only) |

### Rationale

Path B is the stronger foundation on every axis that matters for a compliance surface: the evaluator is a **pure function** (identical input yields an identical verdict months later — the property that makes an audit defensible), it **short-circuits in a frozen order**, its **defaults are restrictive** (a tenant with no config is not enabled), it writes an **append-only decision log** recording every gate's verdict with structured evidence and no personal data, and it has **real transports**.

Path A never performs a live send, is typed `channel: 'email'` as a literal so phone and WhatsApp are not expressible, and its suppression check is inline and impure.

**LI-3 must not build a third evaluator.** The audit's finding was two competing stacks; resolving it by adding a third would be the worst available outcome.

### Path A disposition — deprecate in place, then remove

Explicitly chosen over the alternatives: not `delete now`, not `adapter`.

- **Not `adapter`** — an adapter exists to preserve data or callers. There is no data (0 rows) and one caller (`pages/api/lead-intelligence/execution.ts`). There is nothing to adapt.
- **Not `delete now`** — `executionBridge` is today the only code path that actually calls a suppression check before a (dry-run) dispatch. Removing it before Path B's gate reads the canonical table would leave a window with *less* checking than exists now. Sequence matters more than tidiness.

**Freeze immediately (LI-3B):** no new callers, no new channels, no new features in Path A. Its API route stays functional.

**Conditions for removal — all three required:**
1. Path B's `suppression` gate reads the canonical LI-3 table in production.
2. `suppression_entries` still has **0 rows** (verify, do not assume).
3. `executionBridge` has **no remaining caller**, verified by repository scan.

**No data migration.** Both tables are empty. Migrating zero rows is not a migration; it is a ceremony that invents risk.

## 6. D-3 — DNC Survival After Person Deletion

### Decision

**A tenant DNC SURVIVES deletion of the corresponding `unified_persons` record.**

Mechanism — already proven in production, not invented here: a tenant-safe composite foreign key with **`ON DELETE SET NULL (person_id)`**. On person deletion the governance record persists, `person_id` becomes NULL, and `organization_id` and `target_normalized` are preserved.

Both patterns already exist in production and the platform has chosen deliberately between them before:

| Existing constraint | Behaviour |
|---|---|
| `source_records_person_tenant_fk` | `SET NULL (person_id)` — **evidence outlives the entity** |
| `contacts_person_tenant_fk` | `SET NULL (unified_person_id)` |
| `identity_claims_person_tenant_fk` | `CASCADE` — a claim *about* a person is meaningless without them |

Governance belongs with the first group: a DNC is not a statement about a person's identity, it is a **standing instruction from that person to this tenant**, and the instruction does not expire because our record of them did.

### Rationale

The failure mode this prevents is concrete and severe. Person deleted → DNC deleted → the same lead re-imported next week from Apollo or a CSV → contact resumes. The person experiences a company that ignored their unsubscribe. That is the single outcome DNC exists to prevent, and cascading deletion causes it by construction.

`target_normalized` surviving is what makes re-import re-match, since the incoming record will carry an address, not our internal person id.

### Alternatives rejected

- **CASCADE** — creates the re-import hole above.
- **Blocking person deletion while a DNC exists (RESTRICT)** — inverts the priority: it would make honouring an erasure request harder because the person asked not to be contacted. Perverse.
- **Deleting the person but hashing the target** — a one-way hash still permits match-on-re-import while reducing readability, and is worth considering, **but it is a legal/product choice about identifiability, not an architectural one.** Escalated below.

### LEGAL DECISION — escalated, not decided

**I am not making a legal determination.** The architecture above retains a normalised email address or phone number after the person record is deleted. That is a deliberate retention of personal data for a suppression purpose. Whether that is correct under the applicable regime, for how long, and in what form (plaintext vs hashed) requires legal confirmation.

Specifically escalated:
1. May a suppression record retain a contact identifier after an erasure request?
2. If the erasure request *is* the DNC (a DSAR), does the suppression itself survive?
3. Is a hashed target acceptable, and does hashing defeat the purpose for phone-number variants?
4. What is the retention period for a revoked suppression?

**LI-3B should implement the SET NULL architecture, which is reversible in policy** — a later decision to hash or purge is a data operation on a table that already models revocation, not a schema redesign.

### Implementation consequence

The composite FK uses `ON DELETE SET NULL (person_id)`; `target_normalized` is retained; the evaluator must therefore match on **`person_id` OR `target_normalized`**, not on `person_id` alone — otherwise a DNC would stop being enforced the moment its person row was deleted, silently reintroducing the very hole this decision closes.

## 7. D-4 — Generation vs Transmission Cost

### Decision

**Option C in principle — generation and transmission are separately represented — but the operative decision is ORDERING, not billing: governance must be evaluated BEFORE generation, so a blocked recipient costs nothing at all.**

Billing implementation is **deferred**. No credit configuration is changed.

### Rationale

The framing in the question ("AI generates, governance then blocks") accepts an ordering that is itself the defect. If a person is under a permanent DNC, generating a personalised message for them is wasted compute *and* an unnecessary processing of their data. The cheapest and most defensible fix is not to decide who pays — it is not to generate.

**The existing architecture already distinguishes the two events**, so Option C requires no new billing primitive:

| Surface | Rows | Distinguishes |
|---|---:|---|
| `usage_events` | 2,373 | `source_type`, `provider_name`, `model_name` — **AI generation** |
| `credit_usage_log` | 402 | `action`, `reference_type`, `reference_id` |
| `credit_transactions` | 937 | `transaction_type`, `credits_delta`, `reference_type` |
| `cost_events` | 57 | `category`, `attribution_kind='provider'` |

Generation is a **computation event** (a model was invoked; the cost is real and already incurred). Transmission is a **communication event** (a message reached a person). They are already separable by `action` / `category`. Conflating them would be a regression, not a simplification.

### The resulting rules

1. **Governance is evaluated before generation.** A blocked recipient incurs neither cost.
2. **If generation has already occurred and transmission is then blocked**, the generation cost stands (compute was consumed) and **no transmission cost is charged**. Generation is not refunded — refunding consumed compute would make governance blocks a way to obtain free generation.
3. **A governance block never consumes send quota.** This already holds in both stacks: Path A checks quota at stage 5 *after* suppression at stage 3; Path B places `rate_limit` last for the documented reason that quota must not be spent evaluating a task another gate would block. **No change required — this is a decision to preserve existing behaviour, not to introduce it.**

### What is deferred

Whether a pre-generation governance check should itself be metered (it is a database read, so almost certainly not), and the exact `action` vocabulary distinguishing `outreach_generation` from `outreach_transmission` in `credit_usage_log`. Both belong with the phase that first performs a live send, not with LI-3.

## 8. Canonical Governance Model

**Specification only. No SQL, no migration, no code.**

| Element | Specification |
|---|---|
| **Table name** | `contact_governance_records` |
| **Tenant key** | `organization_id uuid NOT NULL`, **real FK to `companies(id)`**. No text tenant identifiers, no sentinels. |
| **Person key** | `person_id uuid NULL`, tenant-safe **composite** FK `(person_id, organization_id) → unified_persons(id, company_id)`, `ON DELETE SET NULL (person_id)` per D-3. Nullable because a webhook carries an address, not a person id — parking unresolved governance is a supported state, exactly as LI-2 parks unresolved evidence. |
| **Channel** | `channel text NOT NULL` — `email` \| `phone` \| `whatsapp` \| `*`. Free text, provider-neutral: adding a channel must never require a migration. |
| **Target normalization** | `target_normalized text NULL` — produced by the **existing** normalisers (`normalizeEmail`, `normalizePhone` from `identityResolutionService`). No new normaliser. `target_raw text NULL` retained alongside, following the LI-2 precedent that discarding the raw form makes a normalisation bug unauditable. |
| **Governance type** | `governance_type text NOT NULL`, closed vocabulary (§9). **Never a boolean.** |
| **Source** | `source text NOT NULL` — provider-neutral (`manual`, `email_provider`, `whatsapp_inbound`, `phone_transcript`, `crm`, `import`, …). Free text. |
| **Source record** | `source_record_id uuid NULL` → LI-2 `source_records`, tenant-safe composite. The evidence lives there; this table points at it. |
| **Evidence** | `evidence jsonb NOT NULL DEFAULT '{}'` — a *summary* (matched phrase, confidence, detector version). **Never a full transcript or email body**; those belong in `source_records`. |
| **Effective from** | `effective_from timestamptz NOT NULL` — when the instruction takes effect, which is not necessarily when we recorded it. |
| **Effective until** | `effective_until timestamptz NULL` — NULL means permanent. Populated only for `deferred`. |
| **Revocation** | `revoked_at timestamptz NULL`, `revoked_reason text NULL`. Append-only; never deleted. |
| **Audit relationship** | Verdicts go to the existing `outreach_decisions` log. This table holds *state*, not decisions. |
| **Idempotency** | §13. |
| **Timestamps** | `created_at`, `updated_at`. |

**Constraints (specified, not written):** `governance_type` CHECK against the vocabulary · `channel` non-blank · at least one of `person_id` / `target_normalized` present (a record anchored to nothing is unusable) · `effective_until > effective_from` when present · `effective_until` NULL unless `governance_type = 'deferred'` · revocation pair coherent · `evidence` is an object.

**Deliberately absent:** any global scope, any `is_suppressed` boolean, any provider-specific column, any campaign-specific column beyond `campaign_exclusion`'s scope reference.

## 9. Governance Type Vocabulary

| Type | Meaning | Channel-scoped | Expires |
|---|---|---|---|
| `dnc_permanent` | Never contact, **any channel** | No — applies to all | No |
| `dnc_channel` | Never contact on this channel | Yes | No |
| `unsubscribe` | Opted out of marketing contact | Yes (usually `email`) | No |
| `consent_withdrawn` | Consent revoked | Yes or `*` | No |
| `complaint` | Spam/abuse report | Yes | No |
| `bounce_hard` | Address/number permanently undeliverable | Yes | No |
| `invalid_contact` | Wrong person, or malformed identifier | Yes | No |
| `deferred` | Contact later — **not suppression** | Yes or `*` | **Yes** |
| `campaign_exclusion` | Excluded from one campaign only | Yes | Optional |

### Distinctions preserved, and why each matters

- **BOUNCE ≠ UNSUBSCRIBE.** A bounce is a broken address that a corrected address resolves. An unsubscribe is a person's stated wish that survives any address change. Collapsing them either resurrects unsubscribed people on address correction, or permanently suppresses someone over a typo.
- **INVALID CONTACT ≠ DNC.** "Wrong person" says our data is wrong, not that this human refuses contact. Treating it as DNC suppresses an innocent third party and hides a data-quality defect.
- **DEFERRED ≠ DNC.** "Call me next month" is an invitation. Recording it as DNC destroys a warm lead and is the single most damaging conflation available here.
- **NOT INTERESTED ≠ DNC.** A sales outcome, belonging to lead scoring. It must **not** enter this table at all.
- **REFERRAL ≠ DNC.** "Talk to my colleague" is a routing instruction, not a restriction.
- **QUIET HOURS ≠ DNC** and **CONTACT FATIGUE ≠ DNC.** Both mean *may be contacted, but not now* — a timing constraint on an eligible person, not a restriction on an ineligible one. Neither belongs in this table (§12 of the audit; see §21).

**No `is_suppressed` boolean is defined at any layer.** The evaluator returns a decision plus the type and reason that produced it, because "why" is the question an operator and an auditor both ask first.

## 10. Channel Model

Supported: `email`, `phone`, `whatsapp`, `*`.

**`*` means "every channel, including channels that do not exist yet."** It is retained deliberately: when a person says "never contact me again", they are not enumerating transports, and a future channel must inherit that instruction rather than start clean. A `*` record is the only correct representation of an unqualified refusal.

**Channel semantics by type:**

- **`dnc_permanent` is channel-independent.** It is recorded with `channel='*'` and blocks every channel. It is not permitted with a specific channel — that combination is what `dnc_channel` means, and allowing both spellings would create two ways to express one state.
- **`dnc_channel` is channel-specific** and blocks only its channel.
- All other types are channel-specific, except `consent_withdrawn`, which may legitimately be either.

Evaluation matches `channel IN (requested_channel, '*')` — the same shape the existing `isSuppressed` uses, which is the one part of Path A worth carrying forward.

## 11. Temporary Deferment

| Field | Specification |
|---|---|
| `effective_from` | When the deferment begins. Normally the observation instant. |
| `effective_until` | When it lapses. **NULL is meaningful** — see below. |
| Timezone | Stored as `timestamptz` (absolute). The person's local zone is resolved from `unified_persons.timezone`, which **LI-1 already added for exactly this purpose**. No timezone column is duplicated here. |
| Evidence | `evidence` summary + `source_record_id` to the transcript or message. |
| Tenant | `organization_id`, always. |
| Channel | `channel`, may be `*`. |

**Expiry is by time, never by deletion or mutation.** A deferment blocks while `now() < effective_until`; afterwards it simply stops matching. The row remains, so "we deferred this person twice and they never engaged" stays answerable.

**A dated and an undated deferment are different records and must remain distinguishable.** "Contact me later" (no date) and "reach me on 15 October" (dated) are different instructions:

- **Dated** — `effective_until` set. Blocks until that instant.
- **Undated** — `effective_until` NULL, `governance_type='deferred'`. This is the one case where NULL does *not* mean permanent, which is why the CHECK ties `effective_until` semantics to `governance_type` rather than leaving NULL globally ambiguous. **How long an undated deferment blocks is a product decision** (§22) — the architecture stores the fact; it does not invent a default.

## 12. Provenance & Evidence

Reuses the LI-2 pattern without extending it:

```
inbound signal  →  source_records        (LI-2: the raw payload, credential-stripped)
                →  source_assertions     (LI-2: field-level claims, append-only)
                →  contact_governance_records  (LI-3: the standing instruction)
                        └── source_record_id → the evidence
```

**Full transcripts, email bodies and message payloads belong in `source_records`, never in the governance record.** The governance record carries a summary in `evidence` — matched phrase, detector confidence, detector version — enough to explain the decision without duplicating the payload or spreading PII across another table.

Supported sources, none of them special-cased in schema: `manual`, `email_provider`, `email_message`, `whatsapp_inbound`, `phone_transcript`, `crm`, `import`, `enrichment_provider`. `source` is free text for the same reason `source_records.provider` is: **adding a source must never require a migration.**

When a governance record originates from a source with no LI-2 record — a user clicking "do not contact" in the UI — `source_record_id` is NULL and `source='manual'` with an actor in `evidence`. Manual action is legitimate provenance.

## 13. Idempotency

**Canonical key:** `(organization_id, channel, governance_type, coalesce(person_id::text, target_normalized))` where `revoked_at IS NULL`.

Including `governance_type` is the load-bearing choice:

- A second identical unsubscribe collides and is a no-op. ✔ prevents uncontrolled duplicates
- `deferred` → `dnc_permanent` are **different types**, so both rows exist. ✔ the transition is representable and the history survives
- Re-deferring to a **new date** with the same type collides — so a deferment update must be modelled as **revoke-then-insert**, not an in-place date change, keeping the record append-only

**Stated limitations, not hidden:**

1. A person with both `person_id` and `target_normalized` could produce two rows for one instruction if one arrives resolved and one unresolved. Mitigation is a later backfill that attaches `person_id` once identity resolves — **the same shape as LI-2's unresolved-evidence problem, and it is deferred to the same solution, not solved here.**
2. Partial-index uniqueness on `revoked_at IS NULL` means a revoked record does not block a new one. That is intended: re-subscribing and then unsubscribing again must be expressible.
3. Because the index is **partial**, `ON CONFLICT` cannot infer it — the `42P10` trap this programme has hit four times (W0.1, W0.2, W3, and avoided in LI-2). **LI-3B must use insert-and-catch-`23505`, exactly as W3 and LI-2 do.** This is called out here so it is not rediscovered.

## 14. Governance Evaluation Order

Final recommended order, resolving both conflicts the audit found:

| # | Gate | Class |
|---:|---|---|
| 1 | Tenant active / kill switch | **Operational eligibility** |
| 2 | Person identity valid | **Operational eligibility** |
| 3 | `dnc_permanent` | **Governance blocker** |
| 4 | `dnc_channel` / `unsubscribe` / `consent_withdrawn` / `complaint` | **Governance blocker** |
| 5 | `invalid_contact` / `bounce_hard` | **Governance blocker** |
| 6 | `deferred` | **Governance blocker (temporal)** |
| 7 | Quiet hours | **Timing constraint** |
| 8 | Contact fatigue | **Timing constraint** |
| 9 | `campaign_exclusion` / campaign eligibility | **Campaign rules** |
| 10 | Rate limit / quota | **Rate & quota control** |

**Conflict 1 resolved — invalid contact moved to 5, before deferment.** Deferring a send to an address that cannot receive it schedules an impossible action and consumes a future slot. Undeliverability is a fact about the channel, not a preference, and facts settle before preferences.

**Conflict 2 resolved — rate/quota stays last.** This preserves Path B's frozen rationale verbatim: *rate limit is last so quota is never spent evaluating a task another gate would have blocked.* Nothing in LI-3 may reorder it.

**Short-circuit at the first non-allowed gate**, and record every gate evaluated up to that point in the decision log — Path B's existing behaviour, unchanged.

**Class boundaries matter for the verdict vocabulary:** gates 3–6 return `blocked` (a standing instruction), 7–8 return `deferred` (backpressure — try later), 9 returns `blocked` (scope), 10 returns `deferred`. Path B already distinguishes `blocked` from `deferred`; LI-3 must map to that vocabulary rather than inventing one.

## 15. Auditability

**No new audit system.** Three existing surfaces, with a clear split:

| Belongs on the **governance record** | Belongs in the **decision log** (`outreach_decisions`) | Belongs in **LI-2 evidence** |
|---|---|---|
| The standing instruction | A single evaluation's verdict | The raw payload |
| `governance_type`, `channel`, tenant, person/target | Which gate blocked, and why | The transcript / email body |
| `effective_from` / `effective_until` | Every gate evaluated, in order | Field-level assertions |
| `source`, `source_record_id`, `evidence` summary | Timestamp of the evaluation | Provider identifiers |
| `revoked_at` / `revoked_reason` | Task/campaign context | |
| **Duration** | **An instant** | **What was said** |

The distinction that drove this: an audit event is instantaneous; a suppression has duration. `outreach_decisions` cannot model `effective_until`, which is why the state lives on the governance record and only the verdict goes to the log.

`decision_events` (18 rows) and `audit_logs` (2,464) remain for their existing purposes and are not extended.

**`outreach_decisions` already records structured evidence and is documented as never containing personal data.** LI-3 must preserve that: the decision log records *that* a `dnc_permanent` matched, not the address it matched.

## 16. Append-Only & Revocation

| Question | Decision |
|---|---|
| Append-only? | **Yes.** |
| May a DNC be deleted? | **No** — by architecture. Deletion is expressed as `revoked_at` + `revoked_reason`. |
| Revocation: mutation or new record? | **Mutation of the revocation fields only.** `revoked_at`/`revoked_reason` are set on the existing row; no other field is ever updated. This keeps one row per instruction while preserving the original. |
| Deferment expiry? | **By time.** `effective_until` passes; the row is untouched. |
| Re-subscribe? | **New evidence, new record.** The prior unsubscribe is revoked (not deleted) and a fresh record is written if the new consent needs representing. The history reads as a sequence, which is what a regulator or an operator actually needs. |
| Correcting a mistake? | Revoke with a reason, then insert the correct record. Never edit in place. |

**Requires legal confirmation (§22), not asserted here:** retention duration for revoked records, whether a DSAR erasure may remove a suppression created *by* that DSAR, and whether governance history must outlive the person record (D-3 says architecturally yes; legally unconfirmed).

## 17. Legacy Stack Deprecation

**No rows are migrated. Both tables are empty — verify at implementation time rather than trusting this document.**

| Table | Disposition |
|---|---|
| `suppression_entries` | **Deprecated.** Retained, frozen. Reads via `isSuppressed` continue until Path A is removed. No new writers. |
| `outreach_suppressions` | **Superseded.** Path B's gate is repointed to the canonical table. The old table is retained but unread. |
| `outreach_governance_config` | **Retained and still used** — it holds kill switch, enabled channels, restricted regions and daily limits. Not a suppression table; not deprecated. |
| `consent_records` | **Untouched.** OAuth consent, unrelated. Its misleading name is recorded as a follow-up, not fixed here. |

**Sequence:** freeze writes → LI-3B lands the canonical table → Path B's gate reads it → verify → remove Path A's caller → remove Path A → drop the two legacy tables in a **separate, later, dedicated change**.

**Evidence required before dropping either table:** still 0 rows; no code reference outside tests; Path B reading the canonical table in production for a full release cycle; and the drop shipped as its own commit with its own rollback, never bundled.

**Writes should eventually be blocked, not silently ignored.** A frozen table that accepts writes is worse than one that errors, because the writer believes it succeeded. How that block is expressed is an LI-3B implementation choice.

## 18. Email / Phone / WhatsApp Boundaries

**LI-3 establishes the data model and the evaluation contract. It establishes no channel integration.**

| Phase | Establishes |
|---|---|
| **LI-3** | The governance table · the type vocabulary · the evaluation order · the pure evaluation function (called by nothing) · the provenance link to LI-2 |
| **Email (later)** | Unsubscribe detection · reply parsing · provider feedback → governance bridge (closes audit finding G-5, where `unsubscribed` is observed but never enforced) |
| **Phone (later)** | Transcription interpretation · DNC and deferment extraction · the transcript → `source_records` → governance path |
| **WhatsApp (later)** | STOP/opt-out detection on inbound · **an outbound suppression gate**, which does not exist today (audit finding G-6) · `channel='whatsapp'` reaching a real send path |

**No channel may be activated until its governance path exists.** WhatsApp is the sharpest case: it has never been activated, no send path consults suppression, and platform opt-out handling is a requirement rather than a feature.

## 19. Billing Boundary

**Decision (D-4) restated:** generation and transmission are separate events and already separately representable. Governance is evaluated **before** generation so a blocked recipient costs nothing. If generation has already occurred, its cost stands and no transmission cost is charged. **A governance block never consumes send quota** — preserving behaviour both stacks already have.

**Deferred, and not implemented here:** the `action` vocabulary distinguishing `outreach_generation` from `outreach_transmission`; whether a pre-generation governance read is metered (almost certainly not — it is a database read); and any change to credit configuration, which this ADR does not touch.

## 20. LI-3B Implementation Scope

**LI-3B WILL implement:**

1. `contact_governance_records` — one migration, additive, with rollback and ops applier, following the W5/LI-1/LI-2 pattern.
2. `organization_id uuid NOT NULL` with a **real FK to `companies(id)`** — closing audit finding G-4.
3. Tenant-safe composite FK to `unified_persons` with `ON DELETE SET NULL (person_id)` — closing G-3 and implementing D-3.
4. The `governance_type` vocabulary as a CHECK constraint — closing G-7's collapse into a boolean.
5. `effective_from` / `effective_until` — closing G-8 (deferment absent).
6. Provenance fields pointing at LI-2 `source_records`.
7. The partial unique index for idempotency, **with insert-and-catch-`23505` persistence** (never `ON CONFLICT`, per §13).
8. A **pure, read-only evaluation function** answering "may this tenant contact this person on this channel now?", wired to nothing.
9. Real-schema tests: tenant isolation, **no cross-tenant reach**, no `__global__` equivalent, idempotency, deferment expiry, person-deletion survival, type distinctions.
10. Migration quality, tenant-authz, typecheck, real-schema gates; regenerated schema baseline.

**LI-3B WILL NOT implement:** any parser (email, transcript, WhatsApp) · opt-out detection · quiet hours · contact fatigue · frequency caps · any change to Path A or Path B's evaluators · repointing Path B's gate (a separate, later step) · dropping the legacy tables · any provider · any send path · any credit change · the compliance register from §4.

## 21. Deferred Items

| Item | Phase | Audit ref |
|---|---|---|
| Quiet hours model | after LI-3 | G-9 |
| Contact fatigue / frequency caps / channel spacing | after LI-3 | G-9 |
| Repointing Path B's suppression gate to the canonical table | LI-3C | D-2 |
| Removing Path A and dropping legacy tables | after LI-3C | §17 |
| Email unsubscribe → governance bridge | email phase | G-5 |
| WhatsApp opt-out detection + outbound gate | WhatsApp phase | G-6 |
| Phone transcript → governance extraction | phone phase | §9 audit |
| `executionBridge.channel` email-only literal | resolved by Path A removal | G-7 |
| `consent_records` naming collision | follow-up | G-10 |
| Attaching `person_id` to governance records resolved later | with LI-4 | §13 |
| Billing `action` vocabulary | first live send | D-4 |

## 22. Legal / Product Decisions Still Required

**LEGAL — I make no determination on any of these:**

| # | Question |
|---|---|
| L-1 | May a suppression record retain a normalised contact identifier after the person record is erased? (D-3 architecture assumes yes.) |
| L-2 | If the erasure request *is* the suppression (a DSAR), does the suppression survive its own subject's erasure? |
| L-3 | Is a hashed `target_normalized` acceptable, and does hashing defeat matching for phone-number variants? |
| L-4 | Retention period for revoked governance records. |
| L-5 | Is a platform-wide compliance register required by any regime we operate under? If yes, §4 Option B activates. |

**PRODUCT:**

| # | Question |
|---|---|
| P-1 | How long does an **undated** deferment block? (§11 — architecture stores the fact; the default is a product choice.) |
| P-2 | Should tenants be able to see *that* a platform block exists, if §4 Option B is ever activated? |
| P-3 | Does `campaign_exclusion` belong in this table, or in campaign configuration? (Included here provisionally; it is the weakest fit.) |
| P-4 | Confirmation that "not interested" must never enter this table (§9 assumes yes). |

## 23. Acceptance Criteria for LI-3A

| Criterion | Result |
|---|---|
| D-1 explicitly resolved | **PASS** — Option A, tenant-only |
| D-2 explicitly resolved | **PASS** — Path B canonical, Path A deprecated in place |
| D-3 explicitly resolved or escalated | **PASS** — architecture decided, legal escalated (L-1…L-4) |
| D-4 explicitly resolved or escalated | **PASS** — resolved by ordering; billing deferred |
| Canonical tenant key defined | **PASS** — `organization_id uuid` + FK to `companies` |
| Canonical person relationship defined | **PASS** — composite FK, `SET NULL (person_id)`, nullable |
| Governance vocabulary defined | **PASS** — 9 types, distinctions preserved |
| Channel semantics defined | **PASS** — incl. `*` and the permanent/channel split |
| Deferment semantics defined | **PASS** — incl. dated vs undated |
| Provenance defined | **PASS** — LI-2 reuse, no payload duplication |
| Idempotency defined | **PASS** — key + 3 stated limitations |
| Evaluation order resolved | **PASS** — both conflicts resolved |
| Audit relationship defined | **PASS** — 3-way split, no new audit system |
| Legacy stack disposition defined | **PASS** — deprecate in place, 3 removal conditions |
| LI-3B scope explicitly bounded | **PASS** — 10 in, 12 out |
| Legal/product decisions separated | **PASS** — 5 legal, 4 product |
| No implementation performed | **PASS** — one markdown file |

## 24. Next Prompt

The exact LI-3B implementation prompt is recorded in the phase handoff accompanying this ADR.

---

**Document status:** decisions only. No code, migration, schema, test, production write, or channel activation accompanies this ADR.
