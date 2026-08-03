# INT-002 — Lead Intelligence Activation Runbook

Operational documentation for the activated Lead Intelligence generation
pipeline. Covers the activation flow, generation lifecycle, failure modes,
operations, rollback and deployment.

Scope note: this document describes **generation activation only**. The read
APIs (INT-003 Wave 1), Lead Detail UI (Wave 2), Lead List (Wave 3) and
dashboard (Wave 4/INT-003A) are separate surfaces and are unaffected by
anything here.

---

## 1. Activation Flow

Generation is triggered by exactly one module — `backend/services/leadIntelligenceActivation.ts`.
Nothing else may call the orchestrator directly.

| # | Activation path | Call site | Trigger | Fires |
|---|---|---|---|---|
| 1 | Website lead capture (4 sales intents + free audit) | `leadCaptureService.captureWebsiteLead` | `triggerLeadIntelligence(…, 'lead_captured')` | once per created lead, after the full attribution chain |
| 2 | Webhook ingestion | `pages/api/leads` mode 1 | `triggerLeadIntelligence(…, 'lead_captured')` | once per created lead |
| 3 | Embedded form | `pages/api/leads` mode 2 | `triggerLeadIntelligence(…, 'lead_captured')` | once per created lead |
| 4 | Manual (authenticated) creation | `pages/api/leads` mode 3 | `triggerLeadIntelligence(…, 'lead_captured')` | once per created lead |
| 5 | CRM ingestion / enrichment | `crmIngestionService.upsertLegacyLead` | `onLeadEnrichmentChanged(…)` → `'enrichment_updated'` | once per newly inserted CRM lead |
| 6 | Tracking events | `pages/api/website-events/track` | `triggerVisitorSessionIntelligence(…, 'tracking_events')` | once per distinct touched visitor session |

**Coverage proof.** Every lead-creating path is covered: the four `createLead()`
call sites (1–4) and the single direct `leads` INSERT (5). Visitor-session
stitching (`stitchSessionToLead`) occurs only inside paths 1–4, each of which
already triggers after the chain completes, so stitching needs no separate
trigger. Attribution/session updates that happen without a capture arrive
through path 6.

```
capture / ingestion ──► lead row + attribution chain ──► trigger (fire-and-forget)
tracking events ──────► visitor_sessions updated ──────► trigger (per session)
                                                            │
                                                            ▼
                                          leadIntelligenceActivation (gate, cooldown)
                                                            │
                                                            ▼
                                          createLeadIntelligenceOrchestrator.generate()
                                                            │
                                     load rows → snapshot → fingerprint → skip? → engines
                                                            │
                                                            ▼
                                             lead_intelligence_profiles (upsert)
```

---

## 2. Generation Lifecycle

`generate()` regenerates on **exactly four triggers**, plus an explicit force:

1. **Input fingerprint change** — sha256 over the canonicalized snapshot
   (lead row + events + sessions + touchpoints; `now` deliberately excluded,
   row order canonicalized). Any captured-input change regenerates.
2. **Engine version change** — `ENGINE_VERSION` (currently `lie-2.0.0`).
3. **Envelope schema change** — a record whose `schema_version` is not
   supported by the running build (`SUPPORTED_SCHEMA_VERSIONS`, currently
   `[1, 2]`).
4. **Rebuild requested** — `rebuild_requested_at` set via `requestRebuild()`;
   cleared on the next successful generation.
5. `rebuild()` / `generate(ref, { force: true })` — explicit operator force.

Anything else returns `skipped_unchanged` with `persisted: false` — the record
is not rewritten and `generation_version` is not bumped. The skip decision is
the *same predicate* as `resolveIntelligenceFreshness()`, so the two can never
disagree.

`generation_version` increments only on a real generation, giving a per-lead
monotonic count of how many times intelligence was actually computed.

---

## 3. Failure Modes

All fail **open** — capture, tracking and CRM ingestion never break, and API
responses never change.

| Failure | Behaviour | Operator signal |
|---|---|---|
| `lead_intelligence_profiles` missing (migration not applied) | `upsert` returns `{ ok: false }`; generation still computes and returns; `persisted: false`; warning carries the DB message | Nothing persisted — read APIs report `never_generated` |
| Persistence read error | Treated as "no record" → regeneration attempted | Extra generations, no data loss |
| Snapshot load error / lead not found | `status: 'failed'`, nothing persisted, no throw | Warning in result; caller unaffected |
| Engine throws | `status: 'failed'`, previous record left intact | Result error string |
| Planning layer throws (Phase 3/5) | Planning layers degrade to `null`; the Phase 2 layer still persists | `planning generation degraded` warning |
| Activation itself throws | Swallowed by `runLeadIntelligenceGeneration` → `'failed_open'` | None (by design — never blocks capture) |
| Trigger during a test run | Disabled unless a suite injects an orchestrator (see §6) | N/A |

---

## 4. Operational Runbook

**Kill switch.** `LEAD_INTELLIGENCE_GENERATION_DISABLED=true` disables every
trigger process-wide (checked per call, so it takes effect on the next request
after a restart/redeploy of the env var). Generation is **ON by default**.

**Cooldown.** `ACTIVATION_COOLDOWN_MS` = 60 s, applied per
`lead:<company>:<lead>` for tracking triggers and per
`session:<company>:<session>` for session regeneration. Capture and enrichment
triggers are never cooled down (a new lead must always generate). The cooldown
map self-clears above 5 000 entries; the worst case of a clear is a few extra
`skipped_unchanged` runs.

**Forcing regeneration.** Use the orchestrator's `rebuild(ref)` (immediate) or
`requestRebuild(ref)` (marks `rebuild_requested_at`; the next trigger picks it
up). There is no queue and no scheduler — INT-002 deliberately ships no
background worker.

**Verifying a lead generated.** Query
`lead_intelligence_profiles` by `(company_id, lead_id)`; check
`generation_version`, `engine_version`, `input_fingerprint`, `generated_at`.

**Expected steady state.** One generation per new lead; near-zero generations
for unchanged leads (fingerprint skip); one generation per lead per meaningful
tracking burst (cooldown-bounded).

---

## 5. Rollback Procedure

Three independent levers, cheapest first:

1. **Runtime disable (no deploy):** set
   `LEAD_INTELLIGENCE_GENERATION_DISABLED=true`. Generation stops immediately;
   capture, tracking, CRM and all read surfaces are unaffected. Existing rows
   remain readable.
2. **Code revert:** revert the activation commit pair. This removes the six
   trigger call sites and `leadIntelligenceActivation.ts`; the intelligence
   modules return to dormant. No schema change is required.
3. **Data:** `lead_intelligence_profiles` is an additive standalone table.
   Dropping it is safe for capture (nothing reads it except the INT-003 read
   surfaces, which fail open to `never_generated`). No capture table is ever
   written by generation.

Nothing in generation mutates `leads`, `visitor_sessions`, `lead_attributions`,
`campaign_touchpoints`, `tracking_events` or `lead_intelligence`.

---

## 6. Deployment Checklist

- [ ] **Order:** apply migration `20260907000000_lead_intelligence_profiles.sql`
      **before** deploying the activation code. If code ships first, generation
      fails open (nothing persists) until the table exists — degraded, not
      broken.
- [ ] Confirm the migration is additive-only (`CREATE TABLE IF NOT EXISTS`,
      two indexes, RLS enable + service-role policy). It alters no existing table.
- [ ] Confirm RLS: the table is service-role-only; all application access goes
      through `ownedDbTable` with the service client and explicit
      `company_id` filters.
- [ ] Decide the initial switch position:
      `LEAD_INTELLIGENCE_GENERATION_DISABLED` unset/`false` = ON (intended),
      `true` = ship dark and enable later.
- [ ] Post-deploy smoke: submit one test lead → confirm a
      `lead_intelligence_profiles` row appears with `generation_version = 1`.
- [ ] Post-deploy smoke: resubmit/re-trigger the same lead unchanged → confirm
      **no** new row version (fingerprint skip working).
- [ ] Watch: capture endpoint latency and error rate must be unchanged
      (triggers are fire-and-forget and never awaited).
- [ ] Backfill (optional, deliberate): there is **no** bulk backfill job.
      Existing leads generate on their next qualifying trigger, or via an
      operator-driven `rebuild()`.

---

## 7. Known Bounds (by design)

- Session regeneration processes at most **5** stitched leads per session
  (`SESSION_LEAD_CAP`).
- A single tracking request regenerates at most **3** distinct visitor sessions
  (`MAX_TRIGGERED_SESSIONS_PER_REQUEST`). Events in one batch may each carry
  their own `anonymous_id`, so without this bound one unauthenticated request
  could fan out to 25 sessions × 5 leads = 125 background generations.
  Combined worst case per request is now **15** generations; skipped sessions
  regenerate on their own next tracking request.
- Snapshot reads are capped at 1 000 events, 1 000 touchpoints, 200 sessions.
- Generation is never recursive: writes go only to
  `lead_intelligence_profiles`, which no trigger observes.
- No retries anywhere: a failed generation is simply retried by the *next*
  natural trigger for that lead.
