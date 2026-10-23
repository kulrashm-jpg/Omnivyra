# ENG-003 — EMAIL PROVIDER-EVENT OBSERVABILITY + G-16 — IMPLEMENTATION REPORT

**Gate status:** PASS WITH LIVE VERIFICATION BLOCKED (see §32 at the end).
**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`.

---

## 1. Scope authorized, and what was built

| Authorized | Built |
|---|---|
| Email provider-event observability | **IMPLEMENTED** — `pages/api/webhooks/ses.ts` + normalizer + producer |
| `provider_message_id → task_id` resolver | **IMPLEMENTED** — `providerMessageResolver.ts` |
| G-16 complaint representation | **IMPLEMENTED** — migration `20261116000000` + vocabulary |
| Route-auth registration | **IMPLEMENTED** — `webhook-signature`, gate PASS 1350/1350 |
| Directly affected tests | **IMPLEMENTED** — 55 new, 5 existing pins deliberately updated |

Nothing outside that list was implemented. No inbound email, no engagement threads,
no unsubscribe→suppression, no lifecycle producer, no reply sentiment, no WhatsApp
convergence, no intelligence layer, no sender/domain work, no UI.

---

## 2. Files changed

### New (6)

| File | Hash | Purpose |
|---|---|---|
| `backend/services/providerEvents/snsSignature.ts` | `13468df15e4e2a2d` | SNS RSA signature verification, certificate-URL allow-list, topic allow-list |
| `backend/services/providerEvents/sesEventNormalizer.ts` | `56328cc8c8396d1d` | SES payload → normalized provider event |
| `backend/services/providerEvents/providerMessageResolver.ts` | `d72150b87c0dbc72` | tenant-scoped correlation + explicit tenant discovery |
| `backend/services/providerEvents/sesProviderEventIngestion.ts` | `b6cf884c455ecf13` | the producer: normalize → resolve → `ingestFeedback` |
| `pages/api/webhooks/ses.ts` | `ca5d7e4ea9defa14` | the authenticated route |
| `backend/tests/unit/eng003SesProviderEvents.test.ts` | `025ba8d5b6efd810` | 55 tests |

### Modified (3 source + 1 config + 5 test pins)

| File | Hash | Change |
|---|---|---|
| `backend/services/leadOutreachExecution/types.ts` | `00c2039fc211cd3a` | `'complaint'` added to `BusinessOutcomeType` |
| `backend/services/leadOutreachExecution/feedbackIngestion.ts` | `c46ed8f4a7a83a70` | `'complaint'` added to `FEEDBACK_SIGNALS` and `BUSINESS_SIGNALS` |
| `backend/services/prospectLifecycle/outcomeInterpreter.ts` | `fc80e03e3b1a975c` | `complaint: { kind: 'not-lifecycle-bearing' }` — **forced by the compiler**, see §8 |
| `scripts/route-auth-allowlist.json` | — | one entry, 174 → 175 routes |
| 5 test files | — | pins updated, §13 |

`feedbackIngestion.ts` was changed **additively only**: no axis reassigned, no
rejection relaxed, no idempotency key altered, and `rejected` remains deliberately
non-ingestible.

---

## 3. Migration

**One**, additive, `supabase/migrations/20261116000000_eng003_complaint_outcome.sql`
(`073d73ab9138d4c3`). Migration count 434 → **435**.

It drops and re-adds exactly one constraint, `outreach_outcomes_type_valid`, listing
the eight pre-existing values verbatim plus `'complaint'`. It creates no table, no
index and no column; it does not touch `outreach_delivery_evidence`,
`outreach_suppressions` or `prospect_lifecycle_transitions`. Widening a CHECK cannot
invalidate a row that satisfied the narrower one, so there is no backfill. Re-runnable:
`DROP CONSTRAINT IF EXISTS` then `ADD`, inside a `DO` block that first asserts the
table exists.

**NOT APPLIED.** Not to production, not to any non-production database.

Ordering verified: `20261116000000` is the highest-numbered migration in the repo and
sits immediately above `20261115000000_pi_email_content_evidence.sql`.

---

## 4. Route added

`POST /api/webhooks/ses`, following the repository's `pages/api/webhooks/` convention
and wrapped in `__createApiRoute` like every other route.

Order of operations, and it matters:

1. raw body read (`bodyParser: false` — the signature covers the bytes)
2. JSON parsed only far enough to see the SNS envelope
3. **`verifySnsSignature`** — nothing in the payload is trusted before this
4. **TopicArn checked against `SES_SNS_TOPIC_ARNS`**
5. only then is `Message` interpreted as an SES event

Step 4 is the one that is easy to omit. A valid AWS signature proves a message came
from AWS; it does **not** prove it came from *our* topic, and any AWS account can have
AWS sign its own notifications with a genuine AWS certificate. Without the topic check
this endpoint would accept authentic notifications from anybody's topic.

Status codes are treated as a protocol, because SNS retries on non-2xx:

| Code | When |
|---|---|
| **200** | ingested, duplicate, or an understood event deliberately dropped |
| **401** | signature rejected, topic not allow-listed, or `SES_SNS_TOPIC_ARNS` unset |
| **422** | authentic but uncorrelatable or not understood — retrying cannot help |
| **503** | transient read failure — this one *should* be retried |
| 405/400 | wrong method, unreadable body, malformed JSON |

A duplicate returns **200**, as `feedbackIngestion`'s own comment demands: "an
ingestion endpoint that 500s on a duplicate teaches the provider to retry harder."

**Subscription confirmation is not automatic.** A verified, topic-checked
`SubscriptionConfirmation` is logged at WARN for an operator to confirm by visiting
the `SubscribeURL`; the route does not fetch it. An outbound request to a URL taken
from an inbound payload is the shape of an SSRF, and a one-time human step costs less
than owning that capability. This is a deliberate decision, and it means **a
subscription will not activate until an operator completes it** — recorded here so it
is not discovered as a surprise during live verification.

---

## 5. Route-auth entry

```json
"pages/api/webhooks/ses.ts": {
  "kind": "webhook-signature",
  "reason": "ENG-003 SES/SNS provider-event webhook: verifySnsSignature rebuilds the
             canonical SNS string and verifies the RSA signature against an https .pem
             certificate on an sns.<region>.amazonaws.com host before any payload field
             is read; the TopicArn is then checked against SES_SNS_TOPIC_ARNS. Both fail
             closed in every environment, and the route performs no write of its own
             (all writes go through ingestFeedback).",
  "verifier": "verifySnsSignature"
}
```

**One deviation from the brief, stated plainly.** §7 asked for the `machine-secret`
convention. That is not usable here: **an SNS HTTPS subscription sends no custom
headers and shares no secret**, so there is nothing to put a machine secret in. The
repository's established convention for signature-verified provider webhooks is
`kind: "webhook-signature"` with a named `verifier` the gate re-verifies is actually
invoked — the same kind used by `stripe/webhook.ts`, `webhooks/payments/[provider].ts`,
`billing/settlement-webhook/[provider].ts` and `whatsapp/webhook/index.ts`. I used that,
per §6's instruction to follow repository convention and document the path.

**Gate result: PASS**, 1350/1350 routes (was 1349). The 2 KNOWN OPEN findings
(`auth/resend-invitation.ts`, `leads/index.ts`) are pre-existing and untouched.

Fail-closed behaviour: `SES_SNS_TOPIC_ARNS` unset → empty allow-list → **every request
401**, in every environment, with no development bypass. That mirrors the WhatsApp
route's recorded reasoning (SEC91-W2F-3a), and applies with more force here because
this endpoint's payloads become durable tenant-scoped evidence.

---

## 6. Event normalization contract

```
normalizeSesEvent(payload, snsMessageId) → {
  provider: 'ses', providerMessageId, providerEventId, eventType,
  signal, occurredAt, recipients, source: 'provider_webhook', evidence
}
```

| SES type | Signal | Axis |
|---|---|---|
| `Delivery` | `delivered` | delivery |
| `Bounce` (Permanent **and** Transient) | `bounced` | delivery |
| `Reject` | `bounced` | delivery |
| `Complaint` | `complaint` | **business** |
| `DeliveryDelay` | — **dropped** | — |
| `Open`, `Click`, anything else | — **dropped** | — |

`providerEventId` is taken from the **verified SNS envelope**, not the payload body, so
a publisher cannot mint a fresh deduplication identity for an event already recorded.

**One honest imprecision.** ENG-002 said `Reject → failed`, and that is the right
concept — SES never attempted delivery. But `failed` is unreachable from here:
`ingestFeedback`'s ingestible delivery signals are `delivered` and `bounced` only, and
widening that set is a change to a frozen contract this gate is not authorized to make.
So `Reject` maps to `bounced` — the nearest true statement, the message did not reach
the recipient — and the raw `sesEventType: 'Reject'` is preserved in the evidence so the
distinction is never lost. **This is a known imprecision, recorded rather than hidden.**
Closing it properly means either adding `failed` to the ingestible set or accepting the
evidence-level distinction; that is an owner decision, not a bug to fix silently.

Hard and soft bounce share `bounced` for the same reason, with `bounce.bounceType`
preserved verbatim in `sesEventDetail`.

`DeliveryDelay` is **not** mapped. A delayed message has neither failed nor been
delivered; mapping it either way would make a deliverability rate lie. `Open` and
`Click` are not mapped either, even though SES can emit them and the outcome vocabulary
has the values — they are declared UNOBSERVABLE, which is a statement about
instrumentation not built and consent not obtained, and quietly recording them from a
provider feed would settle that question by accident.

`occurredAt` comes from the provider's own event timestamp (`delivery.timestamp`,
`bounce.timestamp`, `complaint.timestamp`; `mail.timestamp` for `Reject`, which is the
only one SES sends) — never receipt time.

---

## 7. Correlation resolver contract

```
resolveProviderMessage({ companyId, provider, providerMessageId })
  → { ok, companyId, taskId, attemptId, matchedRows, failure, error }

discoverTenantForProviderMessage({ provider, providerMessageId })
  → { ok, companyId, matchedRows, failure, error }
```

Failure classifications, all distinct: `missing_identity`,
`invalid_provider_message_id`, `task_not_found`, `ambiguous_task`,
`cross_tenant_mismatch`, `read_failed`. Collapsing them would make an ambiguity —
worth alerting on — indistinguishable from an event for a message we never sent, which
is routine.

It lives in its own module, outside `feedbackIngestion`, preserving that module's
guard-tested one-way rule: it is "the terminus of the pipeline, not a return path" and
cannot look a provider message up for itself.

**Shape note.** The result types are single interfaces with nullable fields rather than
discriminated unions, matching `FeedbackResult`. This is not stylistic: the project
compiles with **`strict: false`**, and without `strictNullChecks` TypeScript does not
narrow a union by a boolean discriminant — `if (!r.ok)` leaves `r.failure` invisible to
the compiler. I discovered this when typecheck rejected the union version; see §13.

---

## 8. G-16 implementation

`complaint` is now a first-class business-axis outcome:

- `BusinessOutcomeType` gains `'complaint'`
- `FEEDBACK_SIGNALS` and `BUSINESS_SIGNALS` gain `'complaint'`
- `outreach_outcomes_type_valid` gains `'complaint'::text`
- `OUTCOME_TRANSITION_MAP` gains `complaint: { kind: 'not-lifecycle-bearing' }`

**Why the business axis, not delivery.** A complaint is not the message's fate — the
message was *delivered*, which is precisely why the recipient could report it. It is
recipient behaviour, which is what the business axis records. Putting it on the delivery
axis would also make it a candidate for a task state transition, and a complaint must
not move delivery state: the delivery succeeded. It sits beside `unsubscribed` and stays
distinct from it because a complaint carries a provider-reputation consequence an
unsubscribe does not.

**The compiler forced a decision I would otherwise have missed.**
`OUTCOME_TRANSITION_MAP` is `Readonly<Record<BusinessOutcomeType, OutcomeDisposition>>`
— its own comment says "the exhaustiveness is a compile error, not a test convention."
Adding a ninth outcome therefore *required* a disposition. I mapped it
`not-lifecycle-bearing`, with the reasoning written into the source: a spam report is a
provider-reputation and governance fact, not a prospect position. The tempting mapping
is `closed_disqualified`, since `unsubscribed` goes there — but a recipient may be
annoyed, mis-targeted, or simply using the report button as an unsubscribe, and
inferring intent into an append-only ledger that cannot take it back is exactly the
invention that lane refuses. It would also have turned an observational gate into a
lifecycle gate, which §24 forbids.

`complaint` was deliberately **not** added to `UNOBSERVABLE_BUSINESS_OUTCOMES` — SES
reports it, so it is observable. A test asserts that.

Recorded per complaint: `company_id`, `provider`, `provider_event_id`, `task_id`,
`occurred_at`, `evidence` (verbatim SES detail), `source='provider_webhook'`, plus
`attempt_id` and `provider_message_id` where unambiguous — the latter in metadata, since
`outreach_outcomes` has no such column.

---

## 9. Idempotency behaviour

Unchanged and DB-enforced. ENG-003 adds no uniqueness and removes none.

| Key | Where |
|---|---|
| `(company_id, provider, provider_event_id)` partial unique | `outreach_delivery_evidence`, `outreach_outcomes` |
| `(company_id, task_id, delivery_status, observed_at)` unique | `outreach_delivery_evidence` |
| `outreach_attempts.idempotency_key` unique per tenant | outbound |

| Scenario | Behaviour | Tested |
|---|---|---|
| exact duplicate | `duplicate: true`, **200**, no second row | yes |
| replay | same keys, same result | yes |
| two different events, one provider message | **both ingested** — different `provider_event_id` | yes |
| out-of-order (delivery after bounce) | evidence kept; `stateRefusal` reported | yes |
| provider retry | expected steady state, not an error | yes |

**No uniqueness constraint was added to `provider_message_id`.**

---

## 10. Multi-row behaviour

The resolver reads **every** matching row and resolves only on unanimity:

```
rows = SELECT company_id, task_id, attempt_id
       FROM outreach_delivery_evidence
       WHERE provider = ? AND provider_message_id = ? AND company_id = ?

0 rows                       → task_not_found
tenants ≠ {requested}        → cross_tenant_mismatch   (defence in depth)
distinct task_ids == 1       → resolve
distinct task_ids  > 1       → ambiguous_task          FAIL CLOSED
attempt_ids distinct == 1    → carry it; otherwise null
```

No `LIMIT 1`, no `.single()`, no `.maybeSingle()`, no reliance on row order — asserted
by a guard test and proved by mutation probe P2. `attemptId` is dropped rather than
guessed when rows disagree, because `provider_message_id` does not identify an attempt;
`companyId + taskId` is the minimum authoritative identity.

Multiple rows per message is the **normal** case (send-time row, then delivery, then
perhaps bounce), which is exactly why `idx_outreach_delivery_provider_message` must stay
non-unique.

---

## 11. Security behaviour

| Condition | Behaviour |
|---|---|
| invalid SNS signature | 401, no write, no enqueue |
| `SES_SNS_TOPIC_ARNS` unset | 401 — fail closed, every environment |
| topic not allow-listed | 401 |
| non-AWS `SigningCertURL` | refused **without fetching** (SSRF guard, checked before the fetch and again in the fetcher) |
| unsupported `SignatureVersion` | refused, no algorithm guessed |
| tampered `Message` | signature mismatch → 401 |
| unknown tenant | `missing_identity` / `task_not_found` — never created |
| unknown provider message | `task_not_found` — no task, attempt or person created |
| cross-tenant collision | `cross_tenant_mismatch`, fail closed |
| ambiguous task | `ambiguous_task`, fail closed |
| malformed / unsupported event | classified; nothing partially written |
| invalid timestamp | rejected by the normalizer, and again by `ingestFeedback` |

The producer **writes nothing itself** — no `.insert(`, `.upsert(`, `.delete(`, `.rpc(`
anywhere in the five files, and the only table it reaches is
`outreach_delivery_evidence`, only via `.select(...)`, exactly once. Guard-tested with a
non-empty match set so it cannot pass vacuously.

Certificate caching is per-process and keyed by URL, size-capped at 64 KiB, with a
5-second timeout.

---

## 12. Tests added

**55 tests**, `backend/tests/unit/eng003SesProviderEvents.test.ts`, all passing.

| Category | Count | Covers |
|---|---|---|
| Authentication | 11 | v1 and v2 signatures accepted; tampered Message rejected; unknown version; unknown Type; missing signature; non-object envelope; **non-AWS cert URL refused without fetching**; cert URL classification (6 negatives); certificate unavailable; canonical-string Subject handling; SubscriptionConfirmation field set |
| Topic allow-list | 2 | empty when unconfigured ⇒ refuses; exact match only, prefix rejected |
| Normalization | 10 | Delivery; provider-timestamp not receipt time; hard+soft Bounce with type preserved; Complaint on the business axis; Reject keeps `sesEventType`; **DeliveryDelay not mapped**; Open/Click not mapped; unknown type; missing id / type / bad timestamp; `eventType` spelling; every mapped type yields an ingestible signal |
| Correlation | 9 | one row; many rows agreeing; **rows disagreeing → fail closed**; zero rows; other tenant invisible; other provider invisible; missing identity; 5 unusable message ids; attemptId dropped on disagreement; read failure distinct |
| Tenant discovery | 3 | unique tenant; **two tenants → fail closed**; no match |
| Producer end-to-end | 11 | ingest with resolved identity; **complaint end-to-end**; duplicate as success; two events one message; out-of-order; drop unsupported; refuse uncorrelatable / cross-tenant / ambiguous; retryable classification; ingestion refusal propagated |
| G-16 vocabulary | 3 | complaint ingestible on business axis; **pre-existing vocabulary unchanged, `rejected` still non-ingestible**; migration widens exactly one CHECK, adds no table/index, touches no suppression or lifecycle |
| Scope guards | 5 | no DB write; only delivery evidence, only select; no suppression/lifecycle/engagement/workflow tokens; company_id always present, no LIMIT 1; **signature → topic → Message ordering** |

Guards strip comments before matching, after two of them initially matched their own
prose (§13).

---

## 13. Existing tests run, and five pins deliberately updated

**Affected set: 20 suites, 728/728 passing.**

`eng003SesProviderEvents`, `ws3Milestone7Feedback`, `piWseOutcomeInterpreter`,
`piWs9OutcomeCorpus`, `piL003bOutcomeProvenance`, `piP1W09DManualOutcomeRoute`,
`piWscProspectLifecycleModel`, `piWscProspectLifecycleWriter`,
`customerOutcomeIntelligence`, `piDispatchability041ah`, `piEmailSendPath041a`,
`piStepSettlement041ak`, `piProgressionSweeper041ai`, `piAutomaticBridge041am`,
`piEmailActivation041ae`, `piEmailSendBoundary041a`, `piEmailResolution041a`,
`sendTransactionalEmailLeadOutreach`, `sendTransactionalEmailAuth`,
`sendTransactionalEmailEscape`.

**Typecheck: 3/3 projects clean. Route-auth: PASS 1350/1350.**

### The five pins, each updated rather than relaxed

Every one of these caught the change exactly as designed. None was weakened.

1. **`ws3Milestone7Feedback`** — "exactly the nine defined signals" → ten, with
   `complaint` enumerated. Still an exact set, so the next addition fails. The axis
   loop also gained `complaint`.
2. **`piEmailSendPath041a`** — frozen-hash pin on `feedbackIngestion.ts`,
   `432397a242bd1eb1` → `c46ed8f4a7a83a70`, with the reason recorded in the test.
3. **`piWseOutcomeInterpreter`** — `THE_EIGHT` → `THE_VOCABULARY` (nine), plus an
   explicit `toHaveLength(9)`; sweep counts and titles updated. Still enumerated rather
   than derived from the type.
4. **`piL003bOutcomeProvenance`** — "eight, in order" → "nine, exhaustively".
5. **`piStepSettlement041ak`, `piEmailActivation041ae`, `piAutomaticBridge041am`** —
   three migration-census pins asserting "added no migration". **Scoped to ownership
   rather than widened**: each now names `20261116000000_eng003_complaint_outcome.sql`
   explicitly, so any *other* later migration still fails, and each then *reads* that
   file to assert it creates no table and touches nothing the workstream owns
   (`execution_plan_steps`, `settled_at`, `outreach_bridge_handoffs`,
   `email_outreach_content_evidence`, …). The `041-A-M` count pin moved 434 → 435.

### Pre-existing failures, not mine

`ws3Milestone5aInternalDispatch` and `ws3Milestone5bExternalDispatch` fail (38 tests).
These are the M5A/M5B failures already recorded in the worktree before ENG-003. Their
failures reference approval and dispatch flow and contain **zero** mention of
`complaint`, ENG-003 or `providerEvents`. I did not re-verify against a clean baseline —
I am relying on the prior record plus that absence, and state it as such rather than
claiming a baseline diff.

---

## 14. Mutation probes

Eight probes. Each was injected, the suite run, the file restored from backup, and the
restored file's hash compared to its pre-probe value. **All eight restored byte-identically.**

| # | Injection | Result | Restored |
|---|---|---|---|
| P1 | remove `company_id` from the resolver predicate | **2 failed** | `d72150b87c0dbc72` ✓ |
| P2 | `if (taskIds.length > 1)` → `if (false)` (first-row selection) | **2 failed** | `d72150b87c0dbc72` ✓ |
| P3 | remove the cross-tenant check from tenant discovery | **2 failed** | `d72150b87c0dbc72` ✓ |
| P4 | map `DeliveryDelay` → `bounced` | **2 failed** | `56328cc8c8396d1d` ✓ |
| P5 | remove the `ingestFeedback` call, fabricate success | **6 failed** | `b6cf884c455ecf13` ✓ |
| P6 | revert the G-16 CHECK to the old eight values | **1 failed** | `073d73ab9138d4c3` ✓ |
| P7 | remove `complaint` from `FEEDBACK_SIGNALS` | **3 failed** | `c46ed8f4a7a83a70` ✓ |
| P8 | read `Message` before verifying the signature | **1 failed** | `ca5d7e4ea9defa14` ✓ |

Two honest notes on process. An earlier P5 variant produced only one failure, so I
replaced it with the stronger version above. And an earlier P7 attempt **silently
no-opped** — the string anchor did not match, the suite showed 55/55, and that 55/55 was
a non-result, not a pass. I caught it because the injection script asserts its match
count before writing, and re-ran it correctly. All eight probes above were also re-run
after the §13 type reshape, because the earlier run described source that no longer
existed.

---

## 15. Non-production verification

**NOT RUN — BLOCKED.**

No SES event was received, no SNS subscription created, no route invoked over HTTP, no
provider contacted. The blocker is the one PI-041-W1 reported and PI-041-W2 characterized:
there is no isolated non-production SES environment. Specifically still missing —
a non-production AWS account, an SNS topic, `SES_SNS_TOPIC_ARNS`, an SES event
destination, and a deployed `send-transactional-email` able to produce a real
`provider_message_id` to correlate against.

Per §28 I implemented source and tests only and marked live verification BLOCKED rather
than substituting production. **T1 is proof of source behaviour, not of operational
behaviour**, and this report does not call the feature verified.

---

## 16. Production status

**PRODUCTION UNTOUCHED.** No deployment, no SES or SNS configuration, no DNS, no
production webhook, no email, no feature-flag change, no migration applied anywhere, no
production read. No AWS API was called in any environment.

---

## 17. IMPLEMENTED

Provider-event route with SNS signature + topic verification · SES event normalization
for Delivery/Bounce/Reject/Complaint · DeliveryDelay and Open/Click deliberately
unmapped · tenant-scoped multi-row correlation resolver with five distinct failure
classes · explicit tenant discovery · the producer wiring to `ingestFeedback` ·
**G-16 complaint as a first-class business outcome** across type, signal vocabulary, DB
CHECK and the lifecycle disposition map · route-auth registration.

## 18. VERIFIED

At **source/T1 level only**: 55 new tests; 728/728 across 20 affected suites; typecheck
3/3; route-auth PASS 1350/1350; 8 mutation probes with byte-identical restores.

## 19. BLOCKED

Live non-production verification (§15) — no isolated SES/SNS environment exists.
Migration application — not authorized, and PI migrations remain unapplied everywhere.

## 20. DEFERRED

Inbound email · engagement email threads · G-04 engagement tenant hardening ·
unsubscribe → suppression · complaint → suppression · outcome → lifecycle producers ·
reply sentiment (G-17) · WhatsApp convergence (G-18) · `autoReplyService` assessment
(G-19) · Deliverability/Content/Engagement Intelligence · sender and domain
configuration · `meeting_booked`/`converted` evidence source (G-20) · suppression
live-row uniqueness (G-21).

## 21. NOT RUN

Whole-repo jest · T2 real-schema · T3 · any provider call · any deployment.
The `check:route-auth` and `typecheck` gates **were** run and passed.

## 22. UNVERIFIED

Live SNS signature acceptance against a real AWS certificate · real SES payload shapes
(fixtures follow the documented format, not a captured live event) · the
subscription-confirmation operator flow · end-to-end correlation against a real
`provider_message_id` · whether `SES_SNS_TOPIC_ARNS` as a comma list fits the eventual
deployment convention.

---

## 23. Remaining gaps

Unchanged from ENG-002 except where closed: **G-16 CLOSED** (pending migration
application). **G-05a/G-05b closed at source**, blocked on live verification.
Still open: G-04, G-06, G-09, G-17, G-18, G-19, G-20, G-21, G-02, G-07, G-10, G-11,
G-12, G-13, G-14.

**One new item, and it is a decision rather than a defect.**

**G-22 — tenant discovery is the one place a tenant is derived from a provider message
id, and its authority is not ratified.** ENG-002 §13 said never to infer a tenant from a
message id. There is no alternative today: a single platform SES identity means an SES
notification carries nothing that names a tenant, so without discovery an authenticated
provider event cannot be recorded at all. I implemented it as a separately named
function — `discoverTenantForProviderMessage` — so no caller can obtain a tenant from a
message id without it being obvious at the call site, and it refuses on anything other
than a unique tenant.

It is safe only under three conditions, all of which hold in this design: the event's
authenticity is already established (verified signature, allow-listed topic), so the
message id is AWS's and not a caller's; the id was **minted by us** — `dispatch.ts` wrote
the row being read, so this is a reverse lookup of our own send rather than a search of
foreign data; and it resolves only on unanimity.

**It should be replaced by an authoritative tenant mapping once per-tenant sender
identities exist** (W2-P §8). Until then this is the gate's one deviation from a literal
reading of ENG-002 §13, and it needs ratification rather than silent acceptance.

---

## 24. Next authorized gate

**ENG-004 — Engagement message tenant hardening**: `engagement_messages.organization_id`,
composite tenant FKs, tenant predicates at the five unscoped lookups, and the G-19
`autoReplyService` assessment. It should precede ENG-005 (inbound email), because
inbound multiplies both message volume and message provenance and would feed
attacker-supplied `In-Reply-To` headers into a `parent_message_id` lookup that currently
carries no tenant predicate.

Also worth folding into whichever gate touches it: **G-22 ratification**, and the
`Reject → bounced` imprecision in §6.

---

## 32. FINAL GATE STATUS

**PASS WITH LIVE VERIFICATION BLOCKED.**

The chain is implemented and proven at source level:

```
authenticated SES event → normalized event → tenant-scoped resolver
  → authoritative task_id → FeedbackEvent → ingestFeedback()
  → canonical evidence/outcome
```

with no guessing, no cross-tenant leakage, no duplicate writes, no
provider-message-uniqueness assumption, and no Workflow, lifecycle, Engagement or
suppression mutation. `complaint` is a first-class representable provider outcome.

It is **not** called VERIFIED: no SES event has traversed this path, because no isolated
non-production SES environment exists. Source/test implementation, non-production
runtime verification and production verification are three separate things, and only the
first is done.

**No deployment or migration application is authorized by this gate.**
