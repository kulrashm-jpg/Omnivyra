# Outreach feedback into Prospect Intelligence (after Prompt 5)

What reaches the PI lifecycle from Outreach and Orchestration, and on what terms. Contract: PI #10 (`outcomeInterpreter`, `lifecycleWriter`), Orchestration contract 0.4.0.

## 1. Feed paths
| Source | Path into PI | Outcome → state | Origin / actor | Key |
|---|---|---|---|---|
| Operator outcome (any channel) | `feedRecentOutcomesToLifecycle` → `interpretOutcome` | `replied` → `engaged`, and so on (OUTCOME_TRANSITION_MAP) | derived | `outcome:<id>` |
| WhatsApp STOP | sweeper → `feedWhatsAppReplyToLifecycle` | `unsubscribed` → `closed_disqualified` | derived, source `provider_webhook` | `evidence:<fp>` (new). Old rows keep `derivation:<fp>`. |
| WhatsApp, any other inbound | **none** (X-3) | – | – | – |
| SES Delivery/Bounce/Reject/Complaint | **none**. Governance restrictions and run consequences only. | – | – | – |
| A person's reply evaluation (new) | **none** (P-1 = a) | – | – | – |

## 2. Rules applied (PI ruling, virality-b6, 2026-11-06)
- A classifier's negative is never `rejected`; that needs a human.
- A meeting request is `replied`, not `meeting_booked`.
- Out-of-office, bounce and complaint are not business outcomes.
- A later correction is a new outcome row, never an update.
- A derived transition carries no actor. The lifecycle writer refuses one with `actor_forbidden`, which is why a human-confirmed WhatsApp reply cannot be routed as a derived `replied`.

## 3. Idempotency
- `uq_prospect_lifecycle_source_event` (`20261028000000:247-253`); the writer treats a 23505 as a duplicate.
- The interpreter skips a prospect already in the target state (`stateModel.ts` ~:206, read only).
- Changing the key from `derivation:` to `evidence:` cannot double-write. A STOP recorded under the old key and then re-delivered produces no second transition (tested on real schema).
- **Invariants the key change rests on** (PI review, 2026-11-06). If either changes, the pre-Prompt-5 `derivation:<fp>` rows lose their 23505 protection, and a duplicate `closed_disqualified` under `evidence:<fp>` becomes writable:
  1. `closed_disqualified` is terminal, with no exits (`stateModel.ts:112`, `:120`). A re-delivered STOP therefore always reads as already-in-target-state.
  2. `readCurrentProspectState` throws on a read error (`lifecycleReader.ts:109-111`) and never returns null. Null means only a genuinely empty ledger, so a failed read cannot fail open.
- **Provenance:** `interpretOutcome` does not consult provenance; this is settled by PI-LIFECYCLE-003B / PI-ADR-006 (`outcomeInterpreter.ts:98-115`, `:390-400`). The change from `'provider'` to `'provider_webhook'` is therefore behaviour-neutral for the write. It is still a real fix: `classifyOutcomeProvenance` now answers `webhook / webhook_identified` instead of `unauthorized / source_unrecognised`.

## 4. Not reaching PI this round (documented gaps)
- **Human-confirmed WhatsApp engagement.** The future shape is a human-origin transition with `actorUserId` and a `human:<uuid>` key through the human decision path. Owner decision.
- **A free-text opt-out that the STOP detector does not match** (for example "take me off your list"). Raised by PI review F-3.
  - It reaches PI not at all. A person evaluates it and ends the run as `cancelled_by_person`.
  - `exitJourney` writes no governance restriction, so nothing blocks re-enrolling the prospect and contacting them again. PI keeps the prospect open.
  - This is not a regression: on the base the message was fed as `replied` → `engaged`, which also left the prospect contactable.
  - On the journey path, nothing writes `contact_governance_records` for EITHER kind of opt-out; `journeyResponses` only reads the canonical restrictions. A keyword STOP is restricted by the webhook processor and closed in PI. What keeps an opted-out prospect out of future journeys is PI closure (`isProspectClosedToJourneys`). A free-text opt-out gets neither closure nor a restriction. The only record that the person asked to be left alone is a `cancelled_by_person` decision row that nothing consults.
  - It is a compliance question, separate from the missing positive signal above. **OWNER ITEM**, raised to the programme owner in the Prompt 5 report. Closing it needs a human-origin PI transition (`actorUserId`, key `human:<uuid>`) when a person ends a run for an opt-out reason, or a governance write on that decision.
- **Inbound email replies.** No ingestion exists (G-1, Outreach).
- **Duplicate operator outcomes.** An operator entry has no idempotency key beyond occurredAt (N-3, Outreach follow-up). Impact is bounded: there is no second transition while the prospect is engaged.

## 5. Peer review
- PI (virality-b6): PASS against `e9231420…`, with non-blocking findings F-1..F-3, addressed in the post-review delta (PROMPT-5-INTEGRATION-VERIFICATION.md §7).
- Outreach: pending, same hash.
