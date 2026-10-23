# PG-001 D1 — Historical Governance-Type Classification Audit

**Scope:** read-only classification and evidence gathering. No implementation.
**Repository:** `C:/tmp/r1-ctx` · branch `fix/r1-profile-context` · HEAD `29fea38a2d1642c1c2fd957e5151f6be81415774`
**Product:** Omnivyra (Prospect Intelligence / Unified Outreach). Not Drishiq.
**Date:** 2026-10-15

---

## 1. Baseline and boundary verification

| Check | Result |
|---|---|
| Repository path | `C:/tmp/r1-ctx` — matches |
| Branch | `fix/r1-profile-context` — matches |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` — matches |
| Working tree | 86 entries (51 modified / 35 untracked) |
| Unrelated changes | None. 84 at the 4C-6B baseline, +2 untracked = `contactPurpose.ts` and `pg001ContactPurposeContract.test.ts`, both created by the authorized 4C-6B gate |
| `C:/virality` | Not inspected, not modified |
| Database / Supabase / provider | Not contacted. No query, no probe, no message |

No test run, no typecheck, no build. Source inspection only, as directed.

---

## 2. Executive summary

**The decisive structural finding: purpose cannot be reconstructed from most historical rows, because the column that would carry provenance does not carry the caller.**

Every canonical row is written by exactly one of **three** code paths, and the DDL's `source` column is `text NOT NULL` with **no CHECK** (`20261003000000_li3_contact_governance.sql:97`). Of the three writers, only two record anything about *why* the restriction exists:

1. **`suppression_service`** — `suppressionService.addSuppression` (`:591`), reached by exactly one route: `POST /api/lead-intelligence/execution` action `suppress` (`pages/api/lead-intelligence/execution.ts:112`). It writes `source: 'suppression_service'` — a **constant naming the module, not the caller or the cause**. Evidence holds only `{ legacyReason, actor }`. **Target-anchored.** This single path is the *only* producer of `dnc_permanent`, `dnc_channel`, `consent_withdrawn`, `complaint` and `bounce_hard`.
2. **`manual`** — `feedbackIngestion` (`:386`), reached by exactly one route: `POST /api/outreach/outcomes`. Always type `unsubscribe`, **person-anchored**, evidence carries `taskId`, `unsubscribeScope`, `occurredAt`. This is the **only** writer whose provenance proves the outreach context of the objection.
3. **`person_erasure`** — `personErasure.erasePerson` (`:185`). Mints **no new semantics**: it re-anchors an existing person-anchored record onto its target, **inheriting `governanceType` and `effectiveFrom`**, with `reanchored_from_record_id` in evidence.

**Five findings that bear directly on D1:**

- **No migration ever inserted or updated a governance row.** Verified across all of `supabase/migrations/*.sql`. There is no backfilled provenance class to classify.
- **Three types have zero production writers:** `invalid_contact`, `deferred`, `campaign_exclusion`. No `toGovernanceType` branch reaches them and no literal write exists outside tests. They remain reachable only transitively, through erasure re-anchoring of a row that already exists.
- **`outreach_suppressions` has zero writers** — one `.select()` and nothing else (`governanceService.ts:197`) — yet it is read by **Path B, the live send gate**. It has **no governance-type column at all**, and `reason` is nullable free text with no CHECK (`20260912000000_ws3_governance_state.sql:53-66`). Any historical rows there are **unclassifiable in principle**.
- **The operator route does not validate `reason`.** `reason: b.reason ?? 'manual'` is taken from the request body with no runtime guard. `toGovernanceType`'s `default:` branch maps **any unrecognised string** to `dnc_permanent`/`dnc_channel`. The canonical write happens *first*, so an invalid reason produces a **canonical DNC whose legacy mirror was rejected** by `suppression_reason_check`, returning `complete: false`.
- **Today's runtime already behaves as though every restriction were outreach-scoped for email** — not because anything is classified, but because the account/transactional email paths never call `mayContact` at all (4C-5A/5B category 2). D1 therefore changes **no behaviour on its own**; it only matters once enforcement is wired. This is the single most important thing to keep separate when reading the proposals below.

**Recommendation in one line:** classify the two deliverability types (`bounce_hard`, `invalid_contact`) as `all` and the legal instruments (`dsar`/`legal_hold`-derived DNC) as `all`; leave `unsubscribe`, `consent_withdrawn` and `complaint` **`unresolved`**; treat `campaign_exclusion` as **`unresolved` and specifically NOT `all`**; derive erasure rows from their parent.

---

## 3. Full type-by-source classification matrix

Each row gives the eleven required fields. **Proposed purpose is a STORED-CLASSIFICATION proposal only** — it is not a runtime change, and under PG-001 nothing is enforced.

### Row 1 — `dnc_permanent` from the operator suppress route

| Field | Content |
|---|---|
| **Governance type** | `dnc_permanent` (band 3) |
| **Creation source** | `source='suppression_service'`; `POST /api/lead-intelligence/execution` action `suppress`, via `addSuppression` → `toGovernanceType(reason, '*')`, reached when `reason` ∈ {`manual`, `dsar`, `legal_hold`} **or any unrecognised string**, and `channel='*'` |
| **Event meaning** | An authenticated operator asserted a do-not-contact. For `dsar`/`legal_hold` it is a legal instrument; for `manual` it is an operator acting with no stated cause; for an unrecognised string the cause is **unknown** |
| **Affected subject/scope** | Tenant + **target endpoint** (target-anchored; `personId` is not passed), all channels (`'*'` enforced by `contact_governance_permanent_is_all_channels`) |
| **Current enforcement** | `mayContact` band 3, blocks first; read by Path A, Path B (live send gate), Path C readiness, Path D export/WhatsApp |
| **Proposed purpose** | **`all`** |
| **Evidence strength** | **Direct source evidence** for the mapping; the ADR records `'*'` as "never contact me again is not an enumeration of transports" (`20261003000000:86-88`). The *cause* is only as good as `evidence.legacyReason` |
| **Historical backfillability** | **Yes, safely** — `all` is both the conservative default and the type's own semantics, so no row is reinterpreted |
| **Risk if misclassified** | As `outreach`: a DSAR or legal-hold subject would receive account mail once enforcement is wired — **fail open, with legal exposure** |
| **Required decision** | None for the `all` mapping. **Separate owner decision** on the unvalidated-`reason` rows (see DR-3) |
| **Evidence refs** | `suppressionService.ts:183-193,583-604`; `pages/api/lead-intelligence/execution.ts:112`; `contactGovernance.ts:75,183-228`; `20261003000000_li3_contact_governance.sql:97,131-134` |

### Row 2 — `dnc_channel` from the operator suppress route

| Field | Content |
|---|---|
| **Governance type** | `dnc_channel` (band 4) |
| **Creation source** | Same route and writer as Row 1, with a **specific** channel (`contact_governance_channel_dnc_is_specific` forbids `'*'`) |
| **Event meaning** | A do-not-contact limited to one transport. Says nothing about *purpose* — channel and purpose are orthogonal dimensions |
| **Affected subject/scope** | Tenant + target endpoint, one named channel |
| **Current enforcement** | `mayContact` band 4; `channelApplies` matches the named channel only |
| **Proposed purpose** | **`all`** (conservative; it is the default, so it reinterprets nothing) |
| **Evidence strength** | **Inference.** The type constrains the *channel* axis; no stored field speaks to purpose |
| **Historical backfillability** | Yes under the default, but the classification is **not evidence-based** — it is the absence of a narrowing |
| **Risk if misclassified** | As `outreach`: "stop phoning me" would stop blocking account calls/SMS — **fail open**. As `all`: correct-by-default, no overblock beyond today |
| **Required decision** | **Owner decision** — is a channel-scoped DNC purpose-blind? (DR-2) |
| **Evidence refs** | `suppressionService.ts:192`; `contactGovernance.ts:76,152-154`; `20261003000000:136-138` |

### Row 3 — `unsubscribe` from the OPERATOR OUTCOMES route (`source='manual'`)

| Field | Content |
|---|---|
| **Governance type** | `unsubscribe` (band 4) |
| **Creation source** | `source='manual'` (pinned, never client-supplied — `pages/api/outreach/outcomes.ts:184`), `provider: null`; `feedbackIngestion.ts:386` on `outcomeType === 'unsubscribed'` |
| **Event meaning** | An authenticated operator recorded that the recipient **of a specific outreach task** unsubscribed. `evidence.taskId` ties it to that task; `channel` is the task's own channel, or `'*'` when `unsubscribeScope === 'all'` |
| **Affected subject/scope** | Tenant (**from the task, never the event**) + **canonical person** (person-anchored; fails `governance_unanchorable` without a person) |
| **Current enforcement** | `mayContact` band 4; blocks on all four paths. Person-anchored, so it survives endpoint changes |
| **Proposed purpose** | **`unresolved`** (leaning `outreach`) |
| **Evidence strength** | **Direct source evidence of the outreach CONTEXT** (`taskId` present, task-derived channel); **no evidence of the objection's legal BREADTH** |
| **Historical backfillability** | **Mechanically yes** — these rows are identifiable by `source='manual'` + `evidence.taskId`. **Semantically no** — the context is provable, the scope of the person's wish is not |
| **Risk if misclassified** | As `outreach`: a person who meant "stop emailing me entirely" would receive account mail — **fail open**, and this is the classic unsubscribe-honouring complaint. As `all`: a prospect who is also a platform admin stops receiving credentials and billing notices — **overblock** |
| **Required decision** | **LEGAL REVIEW** (LQ-1). `unsubscribeScope === 'all'` is a candidate discriminator: the operator explicitly recorded a cross-channel objection |
| **Evidence refs** | `feedbackIngestion.ts:365-400`; `pages/api/outreach/outcomes.ts:72-84,182-198`; `contactGovernance.ts:77` |

### Row 4 — `unsubscribe` from the OPERATOR SUPPRESS route (`source='suppression_service'`)

| Field | Content |
|---|---|
| **Governance type** | `unsubscribe` (band 4) |
| **Creation source** | `source='suppression_service'`, `reason='unsubscribe'` via `toGovernanceType` (`suppressionService.ts:185`) |
| **Event meaning** | An operator asserted an unsubscribe **with no message, task or campaign context**. Evidence holds `{ legacyReason: 'unsubscribe', actor }` and nothing else |
| **Affected subject/scope** | Tenant + **target endpoint** (target-anchored, not person) |
| **Current enforcement** | Identical to Row 3 — `mayContact` band 4. The two are **indistinguishable at evaluation time** and differ only in `source` and anchor |
| **Proposed purpose** | **`unresolved`** |
| **Evidence strength** | **Unknown.** No stored field establishes what was unsubscribed from |
| **Historical backfillability** | **No.** These rows cannot be classified from provenance at all |
| **Risk if misclassified** | Same exposure as Row 3, with **no evidence to defend either choice** |
| **Required decision** | **Owner + LEGAL** (DR-1, LQ-1). This row is the strongest argument for source-specific mapping: same type, same enforcement, **materially different provenance quality** |
| **Evidence refs** | `suppressionService.ts:185,591-604`; `pages/api/lead-intelligence/execution.ts:112` |

### Row 5 — `unsubscribe` from a PROVIDER WEBHOOK (`source='webhook:<provider>'`)

| Field | Content |
|---|---|
| **Governance type** | `unsubscribe` (band 4) |
| **Creation source** | `feedbackIngestion.ts:390` — `event.provider ? 'webhook:' + provider : event.source`. **No production caller sets `provider`** |
| **Event meaning** | Would be a provider-reported opt-out: the strongest possible evidence, since it is the recipient's own action on the message |
| **Affected subject/scope** | Would be tenant + person, task channel or `'*'` |
| **Current enforcement** | N/A — unreachable |
| **Proposed purpose** | **`unresolved`** (no rows expected; see backfillability) |
| **Evidence strength** | **Direct source evidence of unreachability.** `ingestFeedback` has exactly ONE production caller (the operator route); `ingestFeedbackBatch` has **none**; no SNS/SES feedback handler exists anywhere; `supabase/functions/` contains only `send-transactional-email` |
| **Historical backfillability** | No rows should exist. **This is not proof that none do** — row counts are unverified and an operator with database access is outside this inspection's reach |
| **Risk if misclassified** | Low by volume, but if such rows exist they carry the *best* evidence and should not inherit a weaker default |
| **Required decision** | None now. **Re-examine before enforcement** if a feedback webhook is ever built |
| **Evidence refs** | `feedbackIngestion.ts:390,486-489`; `pages/api/outreach/outcomes.ts:7-10`; `supabase/functions/` listing |

### Row 6 — `consent_withdrawn` from the operator suppress route

| Field | Content |
|---|---|
| **Governance type** | `consent_withdrawn` (band 4) |
| **Creation source** | `source='suppression_service'`, `reason='consent_withdrawn'` (`suppressionService.ts:184`) |
| **Event meaning** | Consent was withdrawn. **Which consent is not recorded** — no basis, no scope, no originating permission is stored |
| **Affected subject/scope** | Tenant + target endpoint |
| **Current enforcement** | `mayContact` band 4 |
| **Proposed purpose** | **`unresolved`** |
| **Evidence strength** | **Inference only.** Withdrawal of a marketing consent and withdrawal of an all-purpose consent are the same row here |
| **Historical backfillability** | **No** |
| **Risk if misclassified** | As `outreach`: if consent was the sole lawful basis for *all* contact, account mail continues unlawfully — **fail open**. As `all`: contractual/legitimate-interest account mail is blocked even though consent was never its basis — **overblock** |
| **Required decision** | **LEGAL REVIEW** (LQ-2) — this is a lawful-basis question, not a product one |
| **Evidence refs** | `suppressionService.ts:184`; `contactGovernance.ts:78` |

### Row 7 — `complaint` from the operator suppress route

| Field | Content |
|---|---|
| **Governance type** | `complaint` (band 4) |
| **Creation source** | `source='suppression_service'`, `reason='complaint'` (`suppressionService.ts:186`). **No feedback-loop writer exists** — the usual producer of complaints is a provider FBL, and none is wired |
| **Event meaning** | A complaint was registered. The **complained-of message is not recorded** (no `taskId` on this path) |
| **Affected subject/scope** | Tenant + target endpoint |
| **Current enforcement** | `mayContact` band 4 |
| **Proposed purpose** | **`unresolved`** |
| **Evidence strength** | **Inference.** A complaint strongly implies objection to the message that triggered it, but that message is unidentifiable from the row |
| **Historical backfillability** | **No** |
| **Risk if misclassified** | As `outreach`: continued account mail to a complainant risks escalation and sender-reputation damage — **fail open**. As `all`: a complaint about one outreach email blocks the recipient's own security notices — **overblock** |
| **Required decision** | **LEGAL REVIEW** (LQ-3) — complaints carry regulatory weight under CAN-SPAM/CASL/GDPR |
| **Evidence refs** | `suppressionService.ts:186`; `contactGovernance.ts:81` |

### Row 8 — `bounce_hard` from the operator suppress route

| Field | Content |
|---|---|
| **Governance type** | `bounce_hard` (band 5) |
| **Creation source** | `source='suppression_service'`, `reason='bounce'` (`suppressionService.ts:187`). **No transport or webhook writes this** — the delivery axis (`deliveryStatus: 'bounced'`) never reaches `recordContactGovernance` |
| **Event meaning** | The endpoint is **not deliverable**. A fact about the address, not a wish of the person |
| **Affected subject/scope** | Tenant + target endpoint. Endpoint-intrinsic by nature |
| **Current enforcement** | `mayContact` band 5 — blocks after the band-3/4 refusals |
| **Proposed purpose** | **`all`** |
| **Evidence strength** | **Direct source evidence.** The ADR distinguishes it explicitly: "`bounce_hard` is a broken address a correction fixes, `unsubscribe` is a wish that survives any correction" (`contactGovernance.ts:44-48`; `20261003000000:92-95`) |
| **Historical backfillability** | **Yes, safely.** This is the one family where purpose is genuinely irrelevant: a dead mailbox cannot receive account mail either |
| **Risk if misclassified** | As `outreach`: the platform keeps sending credentials and billing notices into a dead mailbox — **sender-reputation damage and silent non-delivery of account-critical mail**, though no legal objection is violated |
| **Required decision** | **No further decision** for the mapping. (Whether a corrected address should clear it is a separate, pre-existing question) |
| **Evidence refs** | `suppressionService.ts:187`; `contactGovernance.ts:44-48,79`; `dispatch.ts:89`; `transport.ts:61` |

### Row 9 — `invalid_contact` — NO PRODUCTION WRITER

| Field | Content |
|---|---|
| **Governance type** | `invalid_contact` (band 5) |
| **Creation source** | **None.** No `toGovernanceType` branch returns it; no literal write exists outside tests; the repository layer performs no inserts. Reachable only transitively via erasure re-anchoring (Row 12) |
| **Event meaning** | "Our data is wrong, not their refusal" — a data-quality assertion about the endpoint |
| **Affected subject/scope** | Whatever an existing row names |
| **Current enforcement** | `mayContact` band 5 — **fully enforced if a row exists**. Absence of a writer does not mean absence of enforcement |
| **Proposed purpose** | **`all`** |
| **Evidence strength** | **Direct source evidence** for the type semantics (`contactGovernance.ts:46`); **unknown** for any actual row |
| **Historical backfillability** | Yes under the `all` default. **Do not treat the missing writer as proof no rows exist** — the type has been CHECK-valid since `20261003000000`, and database-level inserts are outside this inspection |
| **Risk if misclassified** | Same shape as `bounce_hard`: as `outreach`, account mail is sent to an address already known to be wrong |
| **Required decision** | **No further decision** for the mapping. Owner should confirm whether rows exist before enforcement (DR-4) |
| **Evidence refs** | `contactGovernance.ts:46,79`; `suppressionService.ts:183-193` (no branch); absence verified across `backend`, `lib`, `pages` |

### Row 10 — `deferred` — NO PRODUCTION WRITER

| Field | Content |
|---|---|
| **Governance type** | `deferred` (band 6) |
| **Creation source** | **None.** No reason maps to it. Every `'deferred'` literal in the tree belongs to an unrelated decision vocabulary (dispatch outcome, gate decision, propagation rule), not to `governance_type` |
| **Event meaning** | "Contact me later" — **an invitation, not a refusal** (`contactGovernance.ts:47`). Temporal, and the only type permitted an `effective_until` (`contact_governance_until_only_deferred`) |
| **Affected subject/scope** | Whatever an existing row names, for the window `effective_from … effective_until` |
| **Current enforcement** | `mayContact` band 6, returning **`deferred`** (backpressure), not `blocked`. **An UNDATED deferment has no computable lapse and therefore defers indefinitely** — `isInForce` returns true and `deferredUntil` is null. That is a pre-existing open product decision (ADR §22, P-1), recorded here because it interacts with any purpose rule |
| **Proposed purpose** | **`unresolved`** |
| **Evidence strength** | **Inference.** "Later" is a timing request; whether it was about outreach or all contact is unrecorded. By nature it arises in an outreach conversation |
| **Historical backfillability** | No rows expected; not provable. Classification would be semantic, not evidential |
| **Risk if misclassified** | As `all`: an undated "contact me later" **indefinitely defers account mail**, including credentials and security notices — a severe **overblock** created by combining two unresolved questions |
| **Required decision** | **Owner decision** (DR-5), and it should be taken together with ADR §22 P-1, not separately |
| **Evidence refs** | `contactGovernance.ts:47,82,175-182,214-228`; `20261003000000:139-142` |

### Row 11 — `campaign_exclusion` — NO WRITER, AND INERT

| Field | Content |
|---|---|
| **Governance type** | `campaign_exclusion` (band **9**) |
| **Creation source** | **None** |
| **Event meaning** | Exclusion from **one campaign**, explicitly "not the relationship" (`contactGovernance.ts:49`). It is a campaign rule (ADR gate 9), not a contact restriction |
| **Affected subject/scope** | Whatever an existing row names — but **narrower than any purpose in the PG-001 vocabulary** |
| **Current enforcement** | **NONE. Structurally inert.** `mayContact` filters `GATE_BAND >= 3 && <= 6`, so band 9 is excluded before the sort. Storable, never evaluated |
| **Proposed purpose** | **`unresolved` — and explicitly NOT `all`** |
| **Evidence strength** | **Direct source evidence** of both the semantics and the inertness (`contactGovernance.ts:82-84,206-208`) |
| **Historical backfillability** | Moot while inert. **The `all` default is actively WRONG here**: it is the one type whose own semantics are narrower than `outreach`, so defaulting it to `all` and later making band 9 evaluable would convert a single-campaign exclusion into a **total contact block** |
| **Risk if misclassified** | As `all`: a one-campaign exclusion silently becomes a permanent, all-purpose block the moment anyone widens the band filter — **the most severe overblock in this matrix, and the least visible** |
| **Required decision** | **Owner decision** (DR-6): either leave it inert and unclassified, or give it a campaign-scoped value **outside** the three-value vocabulary. It must not be folded into `all` by the default |
| **Evidence refs** | `contactGovernance.ts:49,82-84,206-208` |

### Row 12 — ANY type, re-anchored by `person_erasure`

| Field | Content |
|---|---|
| **Governance type** | **Any** of the nine. `erasurePlan` applies **no type filter** |
| **Creation source** | `source='person_erasure'` (`personErasure.ts:111,192`), during `erasePerson` |
| **Event meaning** | **No new instruction.** An existing person-anchored record is carried onto the person's contact endpoints before the person is deleted, so the instruction survives erasure (closing DEFECT-010's shape). `effective_from` is deliberately preserved — "a new `effective_from` would claim the person consented in between" |
| **Affected subject/scope** | Tenant + **target endpoint** (`personId: null`, explicitly) |
| **Current enforcement** | Inherits its parent's band exactly |
| **Proposed purpose** | **Derive from the parent record. Never classify independently** |
| **Evidence strength** | **Direct source evidence**, and the strongest in this matrix: `evidence.reanchored_from_record_id` names the parent, `reanchored_from_anchor: 'person'` marks the transition, and ADR §16 keeps parents **revoked but never deleted**, so the parent is still present to be read |
| **Historical backfillability** | **Yes — transitively, and reliably.** This is the one source whose classification can be computed rather than decided. It inherits the parent's resolution, *including* `unresolved` |
| **Risk if misclassified** | Classifying these independently would **split one instruction into two different purposes** across the erasure boundary — the person's wish would change meaning at the moment they exercised their erasure right |
| **Required decision** | **No independent decision.** Confirm the inheritance rule (DR-7) |
| **Evidence refs** | `personErasure.ts:111,168-216,224-231`; `erasurePlan.ts:144-186`; `20261027000000_pi_wsf_governance_anchor_after_erasure.sql` |

### Row 13 — legacy `suppression_entries` rows (Path A's legacy store)

| Field | Content |
|---|---|
| **Governance type** | **None.** The table has `reason`, constrained by `suppression_reason_check` to `unsubscribe, consent_withdrawn, dsar, legal_hold, bounce, manual, complaint` |
| **Creation source** | `addSuppression`'s mirror write (`suppressionService.ts:605-614`), same single operator route. Plus **`__global__` rows**, which the canonical model cannot express at all (ADR D-1: governance is never tenant-less) |
| **Event meaning** | As Rows 1–8, minus the canonical type mapping. A `__global__` row means "suppressed for **every tenant**" |
| **Affected subject/scope** | `(company_id, channel, target)`; `company_id='__global__'` crosses **all** tenants |
| **Current enforcement** | **Path A only** (`suppressionService.isSuppressed`), after the canonical branch returns — it may only ADD a block, never release one. Any `active` row blocks **regardless of reason** |
| **Proposed purpose** | **`all`** for tenant rows (conservative). **`unresolved`** for `__global__` rows |
| **Evidence strength** | **Direct source evidence** for the reason vocabulary and the global-scope hazard |
| **Historical backfillability** | Partially — `reason` is CHECK-constrained, so it is at least a known vocabulary. But it carries the **same ambiguity** as its canonical counterparts, plus rows that have **no tenant to classify within** |
| **Risk if misclassified** | A `__global__` row given any narrow purpose would release a cross-tenant block. Treating these as `all` preserves today's behaviour exactly |
| **Required decision** | **Owner decision** (DR-8) — `__global__` rows need a disposition before this store is retired, independent of D1 |
| **Evidence refs** | `20260727030000_guarded_execution.sql:10-24`; `suppressionService.ts:124,605-614`; `20261011000000_a3_outreach_person_anchor.sql:427-428` |

### Row 14 — legacy `outreach_suppressions` rows (Path B's legacy store)

| Field | Content |
|---|---|
| **Governance type** | **None, and none derivable.** No type column; `reason` is **nullable** free text with **no CHECK** |
| **Creation source** | **No writer exists in the repository.** One usage: a `.select('scope,value,revoked_at')` (`governanceService.ts:197-198`). Any rows predate this code, or were written outside it |
| **Event meaning** | **Unknown.** Four scopes — `recipient`, `channel`, `task`, `lead` — and a `task`- or `lead`-scoped row is semantically **campaign-shaped**, closer to `campaign_exclusion` than to a contact restriction |
| **Affected subject/scope** | `(company_id, scope, value)`, append-only; DELETE is refused by `ws3_suppression_guard` |
| **Current enforcement** | **Path B — the live send gate.** Four booleans; any non-revoked match **blocks the send**, with no type and no reason consulted |
| **Proposed purpose** | **`unresolved`** — and **unclassifiable in principle** |
| **Evidence strength** | **Unknown**, established as unknowable: there is no field to classify from |
| **Historical backfillability** | **No.** Not "hard" — impossible from the data. `20261011000000` migrated its `company_id` to uuid, so rows survived a type change; **no inference about count is available and none is made** |
| **Risk if misclassified** | Any narrowing of a store that **actively gates live sends** and whose rows cannot be read for meaning is a **fail-open with no audit trail**. It is also the store that "merge-then-retire" depends on |
| **Required decision** | **Owner decision** (DR-9): this store must be **excluded from purpose-awareness entirely** and continue to block unconditionally until retired |
| **Evidence refs** | `20260912000000_ws3_governance_state.sql:53-82`; `governanceService.ts:110,197-198,501-504`; `governance.ts:190-241`; `20261011000000:267-279,427-428` |

---

## 4. Established facts vs inferences

### ESTABLISHED by code, DDL or tests

1. The canonical table has **exactly three** production writers: `suppressionService.ts:591`, `feedbackIngestion.ts:386`, `personErasure.ts:185`.
2. `source` is `text NOT NULL` with **no CHECK**; the only values written in production are `'suppression_service'`, `'manual'`, `'person_erasure'` (and `'webhook:<provider>'`, unreachable).
3. `'suppression_service'` names the **module**, not the cause or the caller. The upstream route is not recorded in any column.
4. **No migration has ever inserted or updated a governance row.** Verified across all of `supabase/migrations/*.sql`.
5. `invalid_contact`, `deferred` and `campaign_exclusion` have **no production writer**.
6. `campaign_exclusion` is **structurally inert** — `mayContact` filters bands 3–6, excluding band 9.
7. `outreach_suppressions` has **no writer**, **no type column**, a **nullable unconstrained** `reason`, and is read by **Path B, the live send gate**.
8. `ingestFeedback` has **one** production caller; `ingestFeedbackBatch` has **none**; **no SES/SNS feedback handler exists**; `supabase/functions/` holds only `send-transactional-email`.
9. The operator suppress route performs **no runtime validation** of `reason`, and `toGovernanceType`'s `default:` maps any unrecognised string to a **DNC**.
10. Because the canonical write precedes the legacy mirror, an unrecognised reason yields a **canonical DNC with a rejected legacy mirror** (`suppression_reason_check`) and `complete: false`.
11. `person_erasure` rows **inherit** type and `effective_from` and cite `reanchored_from_record_id`; parents are revoked, never deleted (ADR §16).
12. `erasurePlan` applies **no type filter** — erasure can carry forward any of the nine types.
13. Path C (`readiness`) and Path D are **canonical-only**; the legacy stores "are never" read there (`readiness.ts:31`).
14. `mayContact` is **purpose-unaware**; no column, type or input expresses purpose. `contactPurpose.ts` is **not imported by any production module** (asserted by `pg001ContactPurposeContract` tests 13–16).
15. Account/transactional email paths **never call** `mayContact`, so canonical restrictions do not gate them today (4C-5A/5B category 2; E4 exempt by owner decision; E2/E5 undecided).
16. An **undated `deferred`** defers indefinitely: `isInForce` returns true and `deferredUntil` is null.

### INFERRED — requires owner confirmation

1. That a `dnc_channel` is purpose-blind rather than outreach-limited (the type constrains channel, not purpose).
2. That operator-route `unsubscribe` rows arose from outreach contact — **probable** from the route's purpose, but the row carries no task.
3. That `complaint` rows concern the outreach message that triggered them — unidentifiable from the row.
4. That no `invalid_contact`/`deferred`/`campaign_exclusion` rows exist. **The missing writer is not proof**, and no row count has been obtained.
5. That `task`/`lead`-scoped `outreach_suppressions` rows are campaign-shaped rather than person-level objections.

### UNVERIFIED — cannot be established by inspection

- Production row counts, per-type and per-source distributions, and the existence of `__global__` rows. **No count is claimed.** The LI-3B migration's "ships EMPTY" is a fact about the migration, not about today's database.
- Whether any row was created by direct database access, outside these three code paths.
- RLS behaviour and effective grants on all three stores.

---

## 5. Owner / product decision register (prioritized)

| # | Priority | Question (answerable as asked) | Blocks |
|---|---|---|---|
| **DR-1** | **P0** | Do `unsubscribe` rows get a **source-specific** classification — `source='manual'` (task-anchored) treated differently from `source='suppression_service'` (no context) — or one classification for the type? | All of stage 3 |
| **DR-2** | **P0** | Is a `dnc_channel` restriction purpose-blind (`all`), or limited to outreach on that channel? | Stage 3 |
| **DR-3** | **P1** | Operator-route rows written from an **unrecognised** `reason` string became DNCs. Are they (a) valid DNCs, (b) to be reviewed individually, or (c) to be identified via `evidence.legacyReason` and re-decided? Should the route now validate `reason`? | Stage 3 + a route fix |
| **DR-4** | **P1** | Confirm whether any `invalid_contact`, `deferred` or `campaign_exclusion` rows exist. This needs **authorized** read access; it cannot be answered from source. | Rows 9–11 |
| **DR-5** | **P1** | How is `deferred` classified, given that an **undated** deferment currently defers forever? Take with ADR §22 P-1. | Row 10 |
| **DR-6** | **P1** | `campaign_exclusion` is narrower than `outreach`. Leave it inert and **unclassified**, or add a campaign-scoped value outside the three-value vocabulary? It must **not** default to `all`. | Vocabulary stability |
| **DR-7** | **P2** | Confirm that `person_erasure` rows **inherit** their parent's purpose via `reanchored_from_record_id` and are never classified independently. | Row 12 |
| **DR-8** | **P2** | Disposition of `suppression_entries.__global__` rows, which no tenant-scoped classification can describe. | Legacy retirement |
| **DR-9** | **P2** | Confirm `outreach_suppressions` is **excluded from purpose-awareness entirely** and keeps blocking unconditionally until retired. | Path B safety |

---

## 6. Legal-review questions (not answerable by code inspection)

- **LQ-1 — `unsubscribe` breadth.** When a person unsubscribes in response to a prospecting message, does that objection extend to account/transactional mail if they later hold a platform account? Does `unsubscribeScope === 'all'` carry a different obligation from the task-channel default? *(Governs Rows 3 and 4.)*
- **LQ-2 — `consent_withdrawn` and lawful basis.** If consent was the basis for prospect outreach only, does withdrawal restrict contact resting on contract or legitimate interest? The row records no basis. *(Row 6.)*
- **LQ-3 — `complaint` obligations.** Does a registered complaint oblige suppression of all contact, or only of the complained-of category, under CAN-SPAM / CASL / GDPR? *(Row 7.)*
- **LQ-4 — minimum account mail.** Is there a category of communication that must reach a person **regardless** of any restriction — security alerts, breach notice, billing/legal notices? This determines whether `account` means "may be narrowed" or "may never be blocked", and it is the precondition for answering E2 and E5.
- **LQ-5 — retroactive reinterpretation.** May a historical record be assigned a purpose **retroactively** at all, or must a classification apply only to records created after the decision? If the latter, D1 resolves to "classify nothing historical" and the `all` default becomes permanent for existing rows.

---

## 7. Recommended conservative treatment of unresolved records

1. **Leave them unlabelled.** Under the approved contract an unlabelled restriction defaults to `all` and keeps covering everything (`contactPurpose.ts:99-100`, `purposeApplies`). Writing `all` explicitly into rows and leaving them unlabelled are **behaviourally identical today** — and the unlabelled form is strictly better, because it stays visibly undecided instead of looking like a decision that was taken.
2. **Never infer purpose from the current runtime.** Account paths bypass `mayContact` entirely, so today's behaviour is an artefact of missing enforcement, not evidence of intent. Reading it as evidence would convert an implementation gap into a legal position.
3. **Classify only where the stored evidence decides it** — `bounce_hard` and `invalid_contact` (endpoint-intrinsic), `dnc_permanent` (its own semantics are `all`), and `person_erasure` rows (inherited). Everything else stays `unresolved`.
4. **Exclude `campaign_exclusion` from the default.** It is the one type for which `all` is a *widening*. Leave it inert.
5. **Exclude `outreach_suppressions` from purpose-awareness entirely.** It gates live sends and carries nothing to classify.
6. **If LQ-5 answers "no retroactive reinterpretation",** D1 closes immediately: classify nothing historical, apply purpose only to records created after enforcement ships. That is the cheapest safe outcome and is worth asking first.

---

## 8. Implementation gates that remain BLOCKED until D1 resolves

| Gate | Status |
|---|---|
| PG-001 stage 3 — schema (`purpose_scope` column) | **BLOCKED** on DR-1, DR-2, DR-6 — the column's permitted values depend on whether `campaign_exclusion` needs a fourth value |
| PG-001 stage 4 — backfill / classification of existing rows | **BLOCKED** on DR-1…DR-5 and LQ-1…LQ-3, LQ-5. This is D1 itself |
| PG-001 stage 5 — shadow evaluation | **BLOCKED** — nothing to shadow until rows carry a scope |
| PG-001 stage 6 — enforcement | **BLOCKED** on LQ-4; wiring `mayContact` into account paths without it risks blocking security and billing mail |
| PG-001 stage 7 — legacy-store retirement | **BLOCKED** on DR-8 (`__global__`) and DR-9 (`outreach_suppressions`) |
| E2 — email-job queue drain governance | **BLOCKED** on LQ-4. Still UNDECIDED |
| E5 — activation outreach governance | **BLOCKED** on LQ-4. Still UNDECIDED, and still has no production caller |
| E4 — domain-verification reminder | **DECIDED — exempt, E4 ONLY.** Not generalizable. Unchanged by this audit |
| Path B `lead_outreach` allow-list gap | **UNCHANGED** — governed and non-deliverable |
| R1 / R2 / R3-A′ | **UNCHANGED.** R3-B remains **DEFERRED** |
| Operator-route `reason` validation | **NOT AUTHORIZED** here. Recorded as a defect candidate under DR-3 |

---

## 9. Final attestation

**Report path:** `C:/tmp/pg001-d1-classification-audit.md` — outside the repository, as authorized.

**No-mutation attestation.** This audit performed read-only inspection only. No application source, test, migration, schema, documentation or ADR was created or modified inside `C:/tmp/r1-ctx`. No purpose field was added to `mayContact`, to evaluator inputs, to any database record or to any API contract. No purpose-aware read, write, shadow evaluation, enforcement or backfill was implemented. No database query, Supabase operation or migration was run. No provider was contacted and no message was sent. No commit, push, deploy, branch switch, reset, clean, stash or restore occurred. `C:/virality` was not inspected or modified.

**Implementation is not begun and is not authorized.** Awaiting a separate authorization.
