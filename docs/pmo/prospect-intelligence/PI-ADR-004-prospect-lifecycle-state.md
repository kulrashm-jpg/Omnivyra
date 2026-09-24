# PI-ADR-004 — the Prospect Lifecycle State

**Status:** ACCEPTED by the orchestrator, 2026-09-23 — **open to reversal**, see §5.
**Base SHA:** `a07477e4` · **Authorises:** contract #10 in `PI-CONTRACT-REGISTER.md`, and WS-E.
**Requires:** `PI-ADR-002` (outcomes may become evidence). **Does not change** `PI-ADR-001` or the Do-Not-Build register.

---

## 1. The decision

**A new append-only transition ledger keyed to the PI prospect.** Justified under `PI-ADR-001` §3.7 — no existing table can carry the concept without corrupting its meaning.

**And the register collapses from seventeen concepts to seven states.** That is the more valuable half of this ADR: most of the seventeen are not states at all.

## 2. Why `operational_states` cannot be it — the fact that decides it

`lib/operations/operationalStateModel.ts` is a real state machine with a transition table, terminal states, re-open edges and `validateTransition`. The prior expectation that PI should simply extend it was reasonable. It fails on a fact that has nothing to do with vocabulary:

**Its `entity_id` is not a prospect.** For `entity_type='canonical_lead'` the value passed is `leadKeyFor(view)` — a `::`-delimited composite string (`lib/leadIntelligence/leadKey.ts:17-23`), in one of two forms:

```
id::<source>::<source_table>::<source_id>
up::<source>::<email|personId>::<occurredAt>      ← identity embeds a TIMESTAMP
```

A prospect lifecycle must survive months of re-ingest. **That key does not.** It is also not `canonical_leads.id`, so it cannot be foreign-keyed to the spine `PI-ADR-001` §3.1 froze — and `operational_states.company_id` is `text` with **no FK to `companies`**, while every prospect table uses `uuid`.

Two further disqualifiers, each sufficient on its own:

- **It is a sales-ops deal record, not a prospect record.** Its vocabulary is `proposal / won / lost`; it ships alongside `operational_assignments`, `operational_notes` and `operational_tasks` against the same key; its only UI is a "Lead Operations" pipeline dropdown; and `audienceService` segments on its `status`. Machine re-derivation would silently move operators' board columns and audience segments. There is no state in it for a person being pursued who has not responded, and none for nurture or reactivation.
- **The loop is rejected.** `validateTransition` returns `same_state` when `from === to`, which `setStatus` turns into a **409**. A reassessment that concludes "still nurture" — the normal outcome of most re-derivations — would be an error. That semantic is test-locked and shared by four entity types, so it is a cross-entity contract, not a local fix.

Also noted, and **inferred rather than observed**: `recordTimeline` writes transition history to `lead_intelligence_events`, whose `lead_id` is `uuid NOT NULL`, while the value passed is the composite string. If that is right, every `canonical_lead` status change has its audit row silently dropped inside a `catch {}`. Worth a five-minute check before anyone relies on that history; it does not change this verdict.

## 3. Where the shape comes from — `opportunity_lifecycle_states`

The wrong subject (keyed per classified signal) but **the best shape in the repository**, and it should be copied closely:

- **Append-only enforced by DB trigger**, on UPDATE *and* DELETE — the property `operational_states` lacks
- `state` + `previous_state` + `reasoning` + `actor_user_id` + `transitioned_at`, with **both** state columns CHECK-constrained — vocabulary in the database, not only in TypeScript
- `is_initial` + a **partial unique index**, so concurrent pipelines cannot double-initialise
- Current state = latest row; history is free
- A machine-written transition is **already precedented** there (`actor_user_id: null`, `reasoning: 'auto_init_from_signal_pipeline'`, with a `23505` race handler)

Two gaps must be fixed rather than inherited: it also rejects `from === to`, and it has no typed evidence reference or origin flag.

## 4. What the new entity carries — and what it must not

**Carries:** the prospect as subject with a **composite tenant FK** (`uuid`, not `text`); append-only by trigger; vocabulary in a DB CHECK *and* a derived TypeScript const; **typed evidence citation** per `PI-ADR-002` §4; an explicit `origin` (`human | derived`) — because `operational_tasks` already has that discipline and `operational_states` does not, and because a model has no user id; **legal idempotent re-derivation** (either a "reassessed, unchanged" row with a debounce, or an explicit `unchanged` result that writes nothing — never a 409); `is_initial` + partial unique index.

**Must not carry — reuse instead, or it becomes the duplicate §3.7 forbids:**

| Concern | Reuse |
|---|---|
| Ownership / handoff | `operational_assignments` — append-only, one active owner by partial unique index |
| Notes, tasks, next-action records | `operational_notes` / `operational_tasks` |
| Transition validation engine | `validateTransition` with a new `PROSPECT_STATE_MODEL` config — the engine is genuinely reusable and config-driven |
| Outcome events | `outreach_outcomes` and the 8-value business vocabulary. **Never re-spell an outcome as a state** |
| Suppression, readiness | Call `mayContact` and `assessOutreachReadiness`. Store neither — see §4.1 |
| Identity | No new person or prospect model |

### 4.1 The separation that matters more than the vocabulary

**Seven states** — durable resting positions, mutually exclusive, written only by the lifecycle writer, each citing evidence:
`qualified` · `outreach-active` · `engaged` · `nurture` · `meeting-scheduled` · `not-interested` · `closed/disqualified` (plus an initial state).

**Computed verdicts — never stored as state:**

- **`suppressed`** → `mayContact`'s verdict. This is the dangerous one. `contact_governance_records` can change at any moment; a stored copy goes stale and the platform contacts someone who unsubscribed. **That is a compliance incident, not a data-quality issue.** A suppressed prospect is still *in* `nurture` — suppression says we may not act, not where they are. Render it as an overlay.
- **`outreach-ready`** → `assessOutreachReadiness`'s 4-value verdict, deliberately unpersisted and composed at read time from live governance. Storing it stores a stale suppression check by proxy.
- **`no-response`** → a per-*attempt* rule-derived outcome, not a prospect state. The prospect-level state it implies is `nurture`. Storing it puts two clocks on one fact.

**Events / interpretations — inputs to a transition, never resting states:** `meeting-proposed`, `meeting-completed`, `reactivation` (a transition `nurture → outreach-active`, recorded with its evidence), and **`handed-off`**, which is an ownership-change event already modelled by `operational_assignments` — the cleanest reuse in the register.

**Reasons/attributes, not states:** `wrong-person` is an identity correction plus a disqualification reason; `wrong-timing` is `nurture` with a `revisit_after` attribute — a separate state would split one behaviour across two labels and let them drift.

**`candidate` is a different ENTITY, not a prospect state** (`PI-ADR-003`). Putting it in the prospect enum would re-merge two entities that were just separated.

> **The rule:** states are durable resting positions, written only by the lifecycle writer, citing evidence. Verdicts are computed at read time from live inputs and are never stored. Events are append-only evidence that trigger transitions and are never re-spelled as states.

## 5. What is open, and how to reverse this

**The defensible alternative** is to extend the operational core with `entity_type='pi_prospect'` and a `PROSPECT_STATE_MODEL`. It reuses the engine, service, API dispatcher and bulk paths for a small diff. It is defensible only if all of these are accepted: adding an origin column and a typed evidence reference to `operational_states`; fixing or replacing the transition-history path; resolving `same_state` without breaking the shared engine's test-locked semantics for four other entity types; and accepting a `text`, FK-less `entity_id` — a composite key that can embed a timestamp — as the anchor of a long-lived governed prospect concept, in a column a CRM vocabulary shares and `audienceService` segments on.

By the time that table is fit for purpose it is a different table. **The named decision is: does the programme accept an FK-less, timestamp-bearing, CRM-shared key as the prospect lifecycle anchor in exchange for a smaller diff?** I judge no. It is reversible while no code exists.

**Deliberately left to WS-E:** whether `outreach-active` is a state or a projection over `outreach_tasks` (dropping it gives six states) — worth deciding explicitly rather than by default; the transition edges; and the debounce.

**Blocked, not decided here:** `meeting-scheduled`, `meeting-proposed` and `meeting-completed` all depend on `meeting_booked`, which is in `UNOBSERVABLE_BUSINESS_OUTCOMES` — there is no booking integration. That cluster is contract-only until one exists.

## 6. No-code confirmation

No application code, schema, migration, flag, provider or production data was changed. This ADR authorises a contract; it implements nothing.
