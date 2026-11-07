# Inbound reply integration (Orchestration Prompt 5)

Status: LOCAL, integrated on `orch/c5-int` over the frozen base `d11f08888` (`refs/preserve/c5-base-d11f0888`). Nothing is pushed, merged, applied or deployed. Release stays NO-GO.

Decisions in force (user, 2026-11-06):
- **SC7-R stays unratified.** Classification and the consequence matrix exist but are switched off. Every inbound reply still pauses the run for a person.
- **`complained` rows are held.** Migration `20270125000001` is not applied, and nothing writes `complained`.
- **EV-1:** `JOURNEY_EVENT_VERSION` stays 1.

## 1. What arrives, per channel (verified at d11f08888)

| Channel | Inbound reply path | Reaches Orchestration as |
|---|---|---|
| Email (SES) | None. SES delivers only Delivery, Bounce, Reject and Complaint (`sesEventNormalizer.ts:46`, `:131-133`). A `Received` notification is dropped with a 200 (`sesProviderEventIngestion.ts:90-92`). | delivery/bounce/complaint evidence only |
| Email, operator | POST `/api/outreach/outcomes` records `source:'manual'`, `derived:false`, with the actor in `metadata.recordedByUserId` (`outcomes.ts:182-199`). | `response.replied`, positive (unchanged) |
| WhatsApp | Meta webhook (HMAC, constant-time compare, fails closed: `pages/api/whatsapp/webhook/index.ts:49-60`), then BullMQ, then `whatsappWebhookProcessor`, then `engagement_messages`. STOP detection is `whatsappOptOut.ts:37-59`; the opt-out restriction is written before the message (`:146`). | STOP: `response.unsubscribed`, exit. Anything else: **`response.received` (new), suspend** |
| SMS | None (`channelCapabilityModel.ts:222`, not operational). | – |
| Browser / LinkedIn / community | Browser ingestion is suspended; polled social replies are never read as journey responses. | – |

Orchestration reads only `thread_id`, `platform_message_id`, `content` and `created_at` from `engagement_messages` (`journeyResponses.ts:231-242`). `content` is used in memory for STOP detection and is never persisted or logged by Orchestration (this is tested). Every key and fingerprint derives from `platform_message_id`.

## 2. The X-3 defect and its fix

**Before.** Every non-STOP WhatsApp inbound was labelled `replied`. The sweeper then fed it to PI (`replied` → `engaged`), and the event view emitted a positive `response.replied`. A `not_interested` prospect could become `engaged` again and be re-enrolled.

**After (contract 0.4.0).**
1. `journeyResponses` labels an unevaluated WhatsApp inbound `inbound_unclassified`, an internal label, never a business outcome. Suspension is byte-identical: the persisted decision is still `reply_awaiting_evaluation:<key>`.
2. The sweeper feeds PI **only** for a STOP (`unsubscribed`), in both branches.
3. `journeyFeedback` takes `unsubscribed` only, and refuses anything else at runtime (`not_an_opt_out`) before PI is read.
   - Provenance source is now `provider_webhook`, a real `FeedbackSource`. `'provider'` used to compile through the `| string` escape hatch.
   - The key is now `evidence:<fingerprint>`; past `derivation:` rows stay.
4. `journeyEvents` maps an unclassified WhatsApp inbound to the additive type `response.received`, code `unclassified`, `positiveEngagement:false`. `POSITIVE_ENGAGEMENT_EVENTS` stays `['response.replied']`.

PI made no change: no ninth outcome, no store for unclassified inbounds, and `PROSPECT_API_VERSION` stays `ws10.1`.

## 3. Idempotency and replay

| Producer | Dedupe | Orchestration key | Duplicate PI transition possible? |
|---|---|---|---|
| SES | SNS MessageId plus a logical unique index (`20260915000000_ws3_feedback_ingestion.sql:81-88`); a 23505 is treated as a duplicate | event id = hash(table, row id, type) | No: SES is never fed to PI |
| WhatsApp | BullMQ jobId = sha256(body), plus UNIQUE (thread_id, platform_message_id) | `evidence:<fp(platform_message_id)>` | No. `uq_prospect_lifecycle_source_event`, plus the interpreter's same-state skip. A STOP already recorded under the old `derivation:` key and then re-delivered writes nothing (tested on real schema). |
| Operator | none beyond occurredAt (Outreach follow-up N-3) | `outcome:<id>` | No second transition while the prospect is still `engaged` |

## 4. Known limitations (stated in contract 0.4.0)
- **D-1:** the event view shows at most one WhatsApp response per run. A later STOP replaces an earlier `response.received` under a new `eventId`, so re-reading is stable only while the store is unchanged.
- A STOP arriving while a run is paused does **not** end the paused run. Only a complaint ends a paused run (Q-C1). The STOP is enforced in two ways:
  - at dispatch, by the governance restriction (`p4_governance_whatsapp` G-1);
  - at the next sweep after any resume, which exits the run as `unsubscribed` (pinned by the D-1 sequence test).
- Past 50 inbound messages, a STOP's identity is not fed to PI. The exit is still enforced through the restriction.

## 5. Gaps (not built; owners as ruled by Outreach, 2026-11-06)
| ID | Gap | Owner |
|---|---|---|
| G-1 | Inbound email reply ingestion | Outreach |
| G-2 | SMS | Owner, new-channel scope |
| G-3 | A persisted message → person/journey link | Engagement-inbox owner (TBC), Outreach consulted |
| G-4 | Choosing one journey when a person has several runs (today all suspend) | Orchestration |
| G-5 | AI reply classifier | Owner / SC7-R (Q-3) |
| G-6 | Canonical codes `20270125000000`: applied to disposable databases only, like every branch migration | Owner apply decision |
| G-7 | `complained` rows `20270125000001`: held | Owner |
| G-8 | Soft-bounce bounded retry | Outreach (the bounds are a product parameter) |
| G-9 | WhatsApp provider-event ledger, and callbacks on the outreach-task path | Outreach |
| G-10 | sent → completed settlement ignores a later WhatsApp `failed` | Orchestration, Prompt 6 |
| G-11 | A free-text opt-out the STOP detector misses (PI review F-3), and every other opt-out. **Owner decision 2026-11-07:** EVERY opt-out (WhatsApp STOP, email unsubscribe link, operator `opt_out`) holds ALL channels for that contact in that tenant at once; the tenant's OWN admin (COMPANY_ADMIN of that company, no super-admin bypass) decides whether, and on which channels, contact is allowed again, within 3 working days (Mon–Fri, company timezone); with no decision everything stays closed; an admin may still reopen later. Amendment (confirmed by the owner 2026-11-07: "after a STOP or unsubscribe, that channel stays closed for good; for given contact............yes, a new email unsubscribe closes email permanently and holds the other channels for admin review."): a STOP or unsubscribe keeps THAT channel closed for good. **Built (Orchestration, local):** store `contact_opt_out_reviews` (`20270127000001`), `optOutReview.ts` (open/join/decide/list), admin routes `/api/contact-optout-reviews[/:id]`, the operator `opt_out` (canonical `*` holds on person, address and number, then the review, then the run ends; 503 keeps the run paused). See JOURNEY-REPLY-CONSEQUENCE-MATRIX §3a. **Outreach:** the STOP and unsubscribe producers call `openOptOutReview` (hold source `optout_review:<trigger>`, ref in `evidence.source_ref`). **Ruled 2026-11-07:** the window counts only weekdays on which a company admin opened the reviews ("5 days a week and in that can't we check through session login if they logged in during those 5 days to meet our condition" → "Admin opened reviews", "No, activity is enough"; recorded per company and local day in `contact_opt_out_review_activity_days`, `20270127000002`; login itself is not read: no per-day login history, and login is another track's); no timezone means UTC ("time zone should be UTC if not set"). **Open:** two reviews for one person until identity links them; wa_id `+` difference; PI closure (P-1); PI wiring its erasure to call the re-anchor (built on our side: `g11_reanchor_pending_opt_out_reviews`, `20270127000003`, with the terminal `merged` state; until PI calls it, a pending person review is tombstoned at erasure, a target anchor kept) | Orchestration (built); Outreach (producers); PI (closure); owner (open items) |

Follow-ups N-1..N-5 and M-1..M-5 from Agent C's producer verification are being fixed by Outreach under an owner GO, in migration block `20270128*`. The consumer conditions for N-4 redaction:
- a redacted STOP still satisfies `detectWhatsAppOptOut`;
- `'[redacted]'` is never treated as an opt-out.
