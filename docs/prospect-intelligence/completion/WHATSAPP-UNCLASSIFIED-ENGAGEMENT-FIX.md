# WhatsApp unclassified engagement fix (X-3)

Workstream: Prospect Intelligence feedback, fixed on the Orchestration side under the PI ruling (virality-b6, 2026-11-06). No PI-owned file was edited.

## Defect
An unevaluated WhatsApp inbound reached PI as the business outcome `replied`:
1. `journeyResponses.ts` labelled every non-STOP inbound `replied`.
2. The sweeper called `feedWhatsAppReplyToLifecycle`, and `interpretOutcome` turned `replied` into `engaged`.
3. `journeyEvents` emitted `response.replied` with `positiveEngagement:true`.

As a result, a plain "who is this?", an empty message or a media-only message promoted the prospect to `engaged`, including a prospect already marked `not_interested`, who could then be re-enrolled.

There were also two side defects in `journeyFeedback.ts`:
- the provenance `source:'provider'` is not a `FeedbackSource`; it compiled only through `FeedbackSource | string | null`;
- the key used the `derivation:` prefix for what is evidence.

## Fix (Orchestration files only)
| File | Change |
|---|---|
| `journeyResponses.ts` | Non-STOP inbound → `inbound_unclassified`. The suspend verdict's `outcome` names the pending reply (`wa:` → `inbound_unclassified`, `ws3:` → `replied`). The persisted decision is byte-identical. |
| `workflowProgressionSweeper.ts` | Feeds PI only when `outcome === 'unsubscribed'`, in both branches. |
| `journeyFeedback.ts` | Outcome narrowed to `unsubscribed`, with a runtime refusal `not_an_opt_out`. Source `provider_webhook`, key `sourceEventKey('evidence', fp)`. No outcome row is invented. |
| `journeyEvents.ts`, `executionContract.ts` | `response.received` / `unclassified` / not positive. Contract 0.4.0, event version 1. |

## What PI now receives from WhatsApp
- **STOP:** `unsubscribed` → `closed_disqualified`, evidence `engagement_thread`, key `evidence:<fp>`, source `provider_webhook`.
- **Anything else:** nothing.

## Tests
**Real schema (`orch_journey_lifecycle`, "WhatsApp responses"):** plain, empty, media-only, ambiguous and unsupported-language messages each:
- suspend the run;
- leave the ledger unchanged;
- produce exactly one `response.received`/`unclassified` and no positive event.

Further real-schema cases:
- A STOP exits the run as `unsubscribed`, giving one `closed_disqualified` under `evidence:<fp>`.
- A duplicate read writes nothing.
- A `not_interested` prospect stays `not_interested`, and re-enrolment is refused.
- **P-2 (required):** a STOP recorded under the old `derivation:<fp>` key and then re-delivered gives `{wrote:false, refusal:'no-transition'}` and an identical ledger.
- **D-1 sequence:**
  1. a plain inbound suspends the run;
  2. a later STOP leaves the paused run paused, and the view swaps to `response.unsubscribed`;
  3. after a resume, the next sweep exits the run with exactly one `closed_disqualified`;
  4. no positive event appears at any point.

**Re-pinned** (each old assertion replaced by its corrected one): `orch_journey_lifecycle` ~:472, `orch_engines_real` ~:216, `sharedMessageOutcomeMapping` ~:321-326, `orch_contract_journey` ~:627, `orchestrationExecutionContract` (version), `orchestrationJourneyCompletion:213`.

**Unit:** `x3WhatsAppInboundUnclassified.test.ts` (registered safety suite). `orch_c5_producer_compat.test.ts`: real producers into the real readers. Its X-3 block failed on the base and passes now.

## PI items (not ours to change)
- PI owns the stale "DELIBERATELY UNWIRED" header in `outcomeInterpreter.ts` and fixes it after the freeze.
- No PI-owned test pinned WhatsApp → engaged (P-3).
- `PROSPECT_API_VERSION` stays `ws10.1`.
