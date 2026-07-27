# LEAD-INTELLIGENCE-001 — Wave W1.1
## LC-101 — Production Activation & End-to-End Runtime Certification

**Program:** LEAD-INTELLIGENCE-001 · **Wave:** W1.1 (Platform Activation) · **Type:** Implementation + Certification.
**Predecessors:** [W0/LC-000](LEAD-INTELLIGENCE-001-LC-000-certification.md) (Certified w/ Adjustments), [LC-001 audit](LEAD-INTELLIGENCE-001-LC-001-audit.md), [LC-002 roadmap](LEAD-INTELLIGENCE-001-LC-002-roadmap.md).
**Purpose:** Close the W0 gap — the capture pipeline was *cold/unexercised* in prod — by activating and **proving** it end-to-end, so every downstream wave builds on a proven runtime. Implements **only** the four W0 adjustments (WP-101–110). No G1/G3/G4/G8, no workspace/audience/campaign work.
**Method:** Read-only prod introspection + a single controlled synthetic lead driven through the **real API** (against the certified prod DB, test tenant `0eda0896`), fully verified then **completely cleaned up**. Production restored to its exact pre-wave baseline (18 seed leads).

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

**The production Lead Capture pipeline is now PROVEN OPERATIONAL end-to-end.** A synthetic lead traversed every stage — tracker → visitor session → tenant resolution → capture → identity → lead creation → attribution → touchpoints → canonical adoption → lead-intelligence + events — with **all 7 persistence layers populated and correctly linked, zero duplication, zero orphaning**. The W0 "cold pipeline" gap is closed. Canonical adoption (`adoptLead`), which had **never** produced a row in prod, produced exactly one correct row.

**Three residual adjustments remain (none block W1.2 engineering; A–B are go-live prerequisites):**
- **A — Deployed runtime identity (WP-101 partial):** validation ran via a local server bound to the **prod DB** (data verifiably landed in project `klkiseupptzbecbxwrky`), proving the pipeline *code + prod schema*. Independent confirmation that the **deployed Vercel/Railway compute** targets the same project was not obtained (needs platform-console access) — carried from W0 Adjustment D.
- **B — Deployed activation config:** Option B (`LEAD_CAPTURE_DEFAULT_*`) was applied **locally against the test tenant** for validation. The **deployed** endpoint is still untenanted; real-traffic go-live requires setting the config in Vercel for the intended production tenant/domain — a deliberate go-live step, out of W1.1's validation scope.
- **C — Failure telemetry gap (LC-001 G9):** latency observability is excellent; failure telemetry on the fire-and-forget side-effects remains absent → W1.2 (G9).

**W1.2 (G1, G3, G4, G8) is authorized to begin** — it is engineering on the now-proven pipeline and does not depend on go-live (A/B).

---

## 1. Entry Gate — PASS

| Check | Result |
|---|---|
| W0 certification exists | ✅ `LEAD-INTELLIGENCE-001-LC-000-certification.md` |
| LC-001 audit exists | ✅ |
| LC-002 roadmap exists | ✅ |
| Repository matches audited implementation | ✅ capture-pipeline files unchanged since audit baseline (`git log` shows only historical commits; working tree clean of pipeline code) |
| No conflicting pipeline modification | ✅ no lead/capture/attribution/tracking/tenant `.ts` modified in working tree |

---

## 2. Runtime Identity Verification Report (WP-101)

| Runtime | Expected project | Observation | Status |
|---|---|---|---|
| Local validation server | `klkiseupptzbecbxwrky` | Booted with `ENV_FILE=.env.local`; log shows `Environments: .env.local, .env`; **synthetic writes landed in `klkiseupptzbecbxwrky`** (verified by direct DB query) | ✅ **Verified (code+DB path)** |
| `.env.local` / pooler | `klkiseupptzbecbxwrky` | `SUPABASE_POOLER_DB_URL` → `aws-1-ap-southeast-1.pooler…klkiseupptzbecbxwrky` | ✅ |
| Vercel (deployed) | `klkiseupptzbecbxwrky` | **Not independently verified** (sensitive env; needs console) | ◐ **Residual A** |
| Railway worker (deployed) | `klkiseupptzbecbxwrky` | **Not independently verified** (per memory: worker = authentic-nature/Omnivyra, deploys from main) | ◐ **Residual A** |

**Assessment:** The pipeline code demonstrably reads/writes the **certified prod database**. Deployed-compute env identity is a residual (Adjustment A). No runtime was observed pointing at a *different* project, so no hard-stop condition was triggered.

---

## 3. Migration Ledger Reconciliation Report (WP-102)

| | Value |
|---|---|
| Statement | `INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('20260629000000','lead_intelligence_store') ON CONFLICT DO NOTHING` |
| Before | version **absent**; ledger **20** rows |
| After | version **present** `('20260629000000','lead_intelligence_store')`; ledger **21** rows; `rowsAffected=1` |
| Schema probe | `lead_intelligence` **18 cols / 0 rows** before *and* after → **no schema/data change** |

**Material finding (context, not a defect introduced here):** the ledger's version `20260677` is named **`durable_media_refs`**, not `website_intelligence_foundation_phase1` — a **duplicate version-prefix collision** (the reconciliation-plan §1 blocker). The schema objects are all correct (W0-verified), but this confirms the ledger is ambiguous and **`supabase db push` remains structurally unsafe** on this repo. **Requirement carried forward:** W1.x migrations must continue via the manual idempotent-SQL process — never `db push`. Registering this one version is cosmetic bookkeeping and does not (and cannot) fix the repo-wide desync.

---

## 4. Activation Configuration Report (WP-103)

**Chosen path: Option B — Default Site Configuration** (per operator decision). Single canonical path; Option A not implemented (no ambiguity).

**Reasoning:** For a controlled activation *validation*, Option B (`LEAD_CAPTURE_DEFAULT_COMPANY_ID`) is the minimal, reversible, single-tenant route — it needs no verified domain (Omnivyra's website has `domain_id = null`, so Option A's verified-domain resolution isn't ready) and isolates the test to the purpose-built **"Ingestion Activation Test"** tenant (`0eda0896`).

| Resolution stage | Result during validation |
|---|---|
| Tenant resolution | `resolveBySiteConfig` → company `0eda0896` (via `LEAD_CAPTURE_DEFAULT_COMPANY_ID`) ✅ |
| Website resolution | test website `719cec9c` (`canonical_url=http://localhost:3000`) attached to lead + session ✅ |
| Company resolution | `0eda0896` "Ingestion Activation Test" ✅ |
| Cross-domain attribution | **Deferred (WP-104)** — not required for same-site validation |
| Configuration health | endpoint resolved tenant + captured on first attempt (HTTP 201) ✅ |

**Go-live note (Adjustment B):** this config existed only in the local validation process. Activating the **deployed** endpoint for a **real** tenant (e.g. Omnivyra `4bdbec26` + `omnivyra.com`, which would prefer Option A once its domain is verified) is a separate, deliberate go-live action.

---

## 5. Cross-Domain Attribution Verification (WP-104)

| Item | Observation | Decision |
|---|---|---|
| `CROSS_DOMAIN_ATTR_SECRET` | **Absent** in `.env.local` | **Defer** |
| Handoff / continuity / session continuity | `/api/internal/lead-webhook-handoff` inactive; same-site session continuity **works** (tracker session `83a3c929` reused by capture — see §8) | Same-site continuity ✅; cross-domain not required |

**Assessment:** Cross-domain handoff is only needed for external landing pages / cross-domain journeys — **not** for the same-site synthetic validation, and configuring it now would exceed W1.1's scope. Same-domain attribution continuity was proven end-to-end (single shared session across tracker → lead → touchpoints). Deferred by design.

---

## 6. Synthetic Lead Execution Report (WP-105)

**Synthetic identity (all deleted post-verification):** `email=lc101-synthetic-<ts>@omnivyra-activation.test`, `anonymous_id=lc101-anon-<ts>`, `session_id=lc101-sess-<ts>`, tenant `0eda0896`, website `719cec9c`.

| Step | Endpoint | Result |
|---|---|---|
| 1 | `POST /api/website-events/track` (page_view + cta_click) | **HTTP 202**, `{accepted:2}` |
| 2 | `POST /api/website/lead-capture` (intent=request_demo, consent=true, utm=google/cpc/lc101-activation) | **HTTP 201**, `leadId=948e7be2-f4e4-4214-8744-c7243b93c8d1` |

Every stage executed against the real API + real prod DB. No stage assumed.

---

## 7. Runtime Trace Diagram (observed)

```
Browser (curl, Origin: localhost:3000)
  │  omnivera-tracker-shaped payload
  ▼
POST /api/website-events/track ──202──► resolveVisitorSession ─► visitor_sessions #83a3c929 (created)
  │                                                            └► tracking_events × 2 (page_view→navigation, cta_click→conversion)
  │                                                               ip_hash✓  user_agent✓  bot_flag=false  consent=granted
  ▼
POST /api/website/lead-capture ──201──►
  ├─ resolveTenantForWebsite → site_config → company 0eda0896            [WP-103 Option B]
  ├─ validateWebsiteLead (name+email+consent) → pass
  ├─ findRecentLead (10-min dedupe) → none
  ├─ resolveVisitorSession → REUSED session #83a3c929 (same anon+session_key)   ◄─ session continuity
  ├─ createLead
  │    ├─ ensureUnifiedPerson → unified_persons #411d348f (single identity)
  │    ├─ INSERT leads #948e7be2 (source=website, website_id, session, consent=granted)
  │    ├─ trackEvent('lead.captured')                                     [telemetry]
  │    └─ adoptLead('website') ─► lead_intelligence #7a16fc00 (dedupe_key src:website|tbl:leads|id:948e7be2)
  │                              └► lead_intelligence_events: 'lead.website.ingested'
  ├─ recordLeadAttribution ─► lead_attributions (capture_snapshot) + form_conversions (lead_form_submit)
  ├─ stitchSessionToLead ─► visitor_sessions.stitched_at set, unified_person_id linked
  └─ persistCampaignTouchpoint ─► campaign_touchpoints × 2 (first_touch + conversion)
  ▼
Lead Workspace (read service) would surface lead #948e7be2 (scores null → 0% badge — G3)
```

---

## 8. Canonical Data Verification Report (WP-106)

All 7 target layers populated and correctly related (verified by direct prod query before cleanup):

| Layer | Rows | Linkage evidence |
|---|---|---|
| `leads` | 1 | `#948e7be2` · company `0eda0896` · source=`website` · website `719cec9c` · session `83a3c929` · identity `411d348f` · consent=`granted` |
| `visitor_sessions` | 1 | `#83a3c929` · anon+session_key match · `unified_person_id`=`411d348f` · `stitched_at` set · website linked |
| `tracking_events` | 2 | both → session `83a3c929` · `ip_hash`✓ `user_agent`✓ `bot_flag`=false · categories navigation/conversion |
| `lead_attributions` | 1 | → lead `948e7be2` · `capture_snapshot` · utm_source=google · campaign=lc101-activation |
| `form_conversions` | 1 | → lead `948e7be2` · `lead_form_submit` · source=website |
| `campaign_touchpoints` | 2 | → lead + session · `first_touch` + `conversion` · campaign=lc101-activation |
| `lead_intelligence` | 1 | `#7a16fc00` · dedupe_key `src:website\|tbl:leads\|id:948e7be2` · source_table=leads · source_id=leadId · identity email matches |
| `lead_intelligence_events` | 1 | `lead.website.ingested` · origin=leads · source=website |
| `unified_persons` | 1 | `#411d348f` · primary_email = synthetic email |

**Identity:** single unified person, referenced by lead + session + canonical row (one identity, no fork).
**Foreign keys / relationships:** `session_link` probe → `lead.visitor_session_id == visitor_sessions.id == tracking_events.visitor_session_id` (all `83a3c929`); `tracking_sessions=1`. **No orphan records.**
**Scores:** `lead_intelligence.scores = {icp,total,intent,urgency,confidence : all null}` — **first real production instance of LC-002 G3** (website leads carry no stored score). Confirms the roadmap's G3 as a code-path certainty, now observed.

---

## 9. Pipeline Integrity Report (WP-107)

| Invariant | Result |
|---|---|
| Single lead write | ✅ `leads` count = 1 |
| Single identity | ✅ 1 `unified_persons` row, reused everywhere |
| Single canonical adoption | ✅ `lead_intelligence` count = 1 |
| Single attribution | ✅ 1 `lead_attributions` row |
| Single timeline | ✅ 1 `lead_intelligence_events` + 1 canonical row |
| No duplicate writers | ✅ 1 session, 1 lead, no parallel inserts |
| No duplicate identities | ✅ |
| No parallel pipelines | ✅ single canonical path end-to-end |

---

## 10. Runtime Performance Report (WP-108)

| Stage | Cold (first hit, incl. webpack compile) | Warm (steady) | Server `duration_ms` |
|---|---|---|---|
| `/api/website-events/track` | 18.9 s | **1.88 s** | 1804 ms |
| `/api/website/lead-capture` | 3.97 s | **2.19 s** | 2156 ms |
| Capture→adoption→attribution span (DB timestamps) | — | — | **~0.5 s** |

**Bottleneck analysis:** warm latency is dominated by **remote DB round-trips** — this validation ran from a developer machine to the prod pooler in **`ap-southeast-1`**. The observability log shows per-query costs (`websites` select 636 ms, `visitor_sessions` select 603 ms, `form_conversions` insert 401–540 ms) that are network-RTT-bound. The capture path makes ~6–8 sequential round-trips; co-located deployed compute (Vercel/Railway near the DB) would reduce each to ~10–20 ms → **sub-200 ms end-to-end expected in the deployed runtime**. No algorithmic hotspot; the pipeline is serial-but-lean. (A future optimization could parallelize the independent post-write side-effects — deferred, not W1.1.)

---

## 11. Operational Readiness Report (WP-109)

| Concern | Observation |
|---|---|
| Logging | ✅ structured JSON; every line carries `request_id` + `correlation_id` |
| Telemetry | ✅ `trackEvent('lead.captured')` fired; `observability_slow_db` per table/op |
| Metrics | ✅ `observability_slow_api` per route (method, status, duration_ms) — HARDEN-001 seam |
| Error handling | ✅ typed `LeadCaptureError`; capture returns correct HTTP codes |
| Retries | ◐ capture is synchronous (no retry); System-B queues have retry (out of scope) |
| Dead-letter | ❌ none for capture side-effects |
| Observability of **failures** | ❌ **gap** — the fire-and-forget side-effects (attribution/touchpoint/adopt) are try/catch-swallowed with **no failure metric** (LC-001 **G9**). Latency is observable; a *failed* side-effect would be silent. |

**Justification for the gap:** by design (LC-001) the side-effects are best-effort so they never block capture; adding failure telemetry + DLQ is exactly **W1.2 / G9** and is intentionally not implemented here.

---

## 12. Drift Assessment

| Drift class | Result |
|---|---|
| Duplicate services / APIs / trackers / scoring / identity / storage / queues / observability | **None** — `git status`: **zero** `.ts/.tsx/.js/.sql` changes; only PMO docs added |
| New architecture introduced | **None** — extended existing pipeline only |
| Production mutations | Ledger +1 cosmetic row (kept); 1 test website + synthetic rows (all **deleted**); local-only env vars (not committed) |
| Post-wave prod state | **Baseline restored** — 18 seed leads, 0 synthetic residue, 0 test website |

**Zero architectural drift.** Reuse-first honored: the synthetic lead exercised the *existing* `leadCaptureService`/`leadService`/`attributionResolverService`/`leadIntelligenceRuntime` unchanged.

---

## 13. W1.2 Readiness Assessment (WP-110)

| Gap | Ready? | Basis | Prerequisite |
|---|---|---|---|
| **G3 — score materialization** | ✅ **Ready** | Confirmed live: canonical row exists with `scores=null` for a website lead — the exact condition G3 addresses. Materialization can call `buildBuyingIntentProfile` and write to `lead_intelligence.scores`. | None (proven data path) |
| **G4 — tracking unification** | ✅ **Ready** | `tracking_events` proven to populate correctly (2 events, session-linked, ip_hash/ua/bot_flag). Cold pipeline → clean consolidation (no dual-silo data). | None (R1 already Low) |
| **G1 — capture abuse controls** | ✅ **Ready** | Endpoint proven reachable + tenant-resolving; honeypot path intact. Add distributed rate-limit + bot heuristic (reuse `checkInMemoryRateLimit`/`isLikelyBot`). | Sequence with go-live activation |
| **G8 — canonical backfill** | ✅ **Ready** | `adoptLead` proven functional; backfill scope = 18 seed leads (decide seed inclusion). | None |

All four W1.2 gaps are **unblocked** by this wave. Residual A/B (deployed identity + go-live activation) are **not** W1.2 prerequisites.

---

## 14. Production Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| PR1 | Deployed Vercel/Railway compute points at a non-prod / different project | Low | High | Confirm `SUPABASE_URL` in both consoles == `klkiseupptzbecbxwrky` (Adjustment A) | **Open (residual)** |
| PR2 | `db push` used for a future migration → duplicate-version corruption | Med | High | Policy: manual idempotent SQL only; never `db push` (WP-102 finding) | **Open (policy)** |
| PR3 | Deployed capture activated for a real tenant without abuse controls | Med | Med | Sequence G1 with go-live activation (Adjustment B + W1.2 G1) | **Open (go-live)** |
| PR4 | Silent side-effect failure loses attribution in prod | Med | Med | W1.2 G9: failure telemetry + DLQ | **Open (W1.2)** |
| PR5 | Synthetic test data left in prod | — | — | Full cleanup verified: 18 leads baseline restored, 0 residue | **Closed** |
| PR6 | Local-vs-deployed latency misread as pipeline slowness | Low | Low | §10 documents remote-RTT domination; deployed expected sub-200 ms | **Closed (documented)** |

---

## 15. W1.1 Exit Criteria — status

| Criterion | Status |
|---|---|
| Runtime identity verified | ◐ code+DB path ✅; deployed compute residual (A) |
| Migration ledger reconciled | ✅ (version registered; broader desync noted) |
| Activation configuration finalized | ✅ Option B chosen + validated (deployed go-live = B) |
| Cross-domain attribution operational | ✅ same-site continuity proven; cross-domain deferred (not required) |
| Synthetic lead traverses full pipeline | ✅ **all 7 layers + identity + events** |
| Every persistence layer verified | ✅ |
| Canonical adoption verified | ✅ (first-ever prod canonical row) |
| Timeline verified | ✅ `lead.website.ingested` |
| No duplicate architecture introduced | ✅ zero code drift |
| Production telemetry validated | ✅ latency telemetry; failure-telemetry gap = W1.2/G9 |
| W1.2 readiness certified | ✅ G1/G3/G4/G8 all ready |
| Formal certification decision issued | ✅ §0 |

---

## 16. Certification Statement

A controlled synthetic lead was driven through the **real** production Lead Capture pipeline against the **certified** production database and verified, stage by stage, to populate all seven canonical persistence layers — `leads`, `visitor_sessions`, `tracking_events`, `lead_attributions`, `campaign_touchpoints`, `lead_intelligence`, `lead_intelligence_events` — plus a single `unified_persons` identity and a provenance timeline event, with **no duplication, no orphaning, and no architectural drift**. The W0 "cold pipeline" gap is closed: **canonical adoption now demonstrably works in production.** All synthetic data was removed; production is at its exact pre-wave baseline. The migration ledger was reconciled for `20260629000000` (cosmetic; the repo-wide desync and `db push` unsafety persist by design).

**Decision: CERTIFIED WITH ADJUSTMENTS.** The pipeline is operational and proven; residual adjustments A (deployed runtime-identity confirmation) and B (deployed activation for real-traffic go-live) are go-live prerequisites, and C (G9 failure telemetry) is W1.2 scope. **Wave W1.2 (G1, G3, G4, G8) is authorized to begin.**

*All destructive/mutating actions were scoped to the test tenant + `lc101-` synthetic markers, executed with the operator's explicit authorization, and fully reversed except the single cosmetic ledger row. Production was otherwise untouched.*
