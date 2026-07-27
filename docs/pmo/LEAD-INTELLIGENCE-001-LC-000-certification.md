# LEAD-INTELLIGENCE-001 — Wave W0
## LC-000 — Production Environment Certification

**Gate type:** Mandatory pre-implementation certification. No W1+ wave may begin until this is signed off.
**Method:** Live **read-only** introspection of the production database (`klkiseupptzbecbxwrky`, via `SUPABASE_POOLER_DB_URL` from `.env.local`; session forced `default_transaction_read_only = on`; `information_schema` + `SELECT` counts only — **no writes, no DDL, no schema change**), cross-referenced against the [LC-001 audit](LEAD-INTELLIGENCE-001-LC-001-audit.md) and [LC-002 roadmap](LEAD-INTELLIGENCE-001-LC-002-roadmap.md).
**Verification artifact:** raw JSON in session scratchpad (`lc000.json`), reproducible via the read-only script.

> **Every finding is stated as:** Evidence → Repository expectation → Production observation → Drift assessment → Wave impact.

---

## 0. Certification Decision

# ✅ CERTIFIED WITH ADJUSTMENTS

**The load-bearing LC-001 assumption — that the production schema matches the repository migrations — is CONFIRMED exactly.** All three migrations' schema effects are live; every critical column, unique index, foreign key, and RLS policy the capture/intelligence pipeline depends on is present.

**Two material facts require W1 plan adjustments (neither invalidates the roadmap):**
1. **The lead-capture pipeline is COLD in production** — it has never executed end-to-end. 0 visitor_sessions, 0 tracking_events, 0 lead_attributions, 0 canonical `lead_intelligence` rows; the only `leads` (18) are seed fixtures with non-canonical sources. This **de-risks** W1 (no dirty-data migration) but means runtime flow is **unverified by evidence** and must be proven with a synthetic probe as a W1 entry gate.
2. **Migration-ledger desync** — the `lead_intelligence_store` migration's schema is live but its version is absent from the `supabase_migrations` ledger. Schema (what governs runtime) is correct; the ledger must be reconciled before any automated migration tooling is trusted in W1.

W1 may proceed **once the three adjustment pre-reqs in §10 are accepted.** The roadmap's foundations (the three architectural spines, the canonical schema) are intact — this is minor drift, not architectural drift.

---

## 1. Production Migration Report (V1)

| Migration | Repo expectation | Production observation | Drift | Wave impact |
|---|---|---|---|---|
| `20260677_website_intelligence_foundation_phase1` | ledger + schema | **Ledger: present** (`20260677`); schema live | **None** | — |
| `20260678_website_intelligence_operational_phase2` | ledger + schema | **Ledger: present** (`20260678`); schema live (session_key, dedupe_key, ip_hash, bot_flag, user_agent all present) | **None** | — |
| `20260629000000_lead_intelligence_store` | ledger + schema | **Ledger: ABSENT**; schema **fully live** (`lead_intelligence` + `lead_intelligence_events` present with all columns + `lead_intelligence_dedupe_unique`) | **Ledger desync** (schema applied out-of-band, per documented manual-apply process) | **Reconcile ledger before W1 migration tooling** (see G-W0-2) |

**Evidence:** `supabase_migrations.schema_migrations` returned exactly `[20260677, 20260678]` for the queried prefixes; `information_schema.tables` + `.columns` confirm `lead_intelligence` exists with `dedupe_key/scores/source/unified_person_id/source_table/source_id/occurred_at` and the unique constraint.

**Assessment:** This matches the LC-001 assumption caveat and the project's known `supabase-prod-ledger-desync` posture (migrations applied manually via SQL editor; the ledger is *not* authoritative — the schema is). The schema is what W1 builds on, and it is correct. The desync is an **operational hazard** for future `supabase db push` / diff tooling, not a schema gap.

---

## 2. Schema Verification Report (V2)

**Table presence — all 15 expected tables PRESENT:**
`leads, forms, visitor_sessions, tracking_events, lead_attributions, campaign_touchpoints, form_conversions, lead_intelligence, lead_intelligence_events, websites, lead_capture_topologies, blog_analytics, canonical_leads, active_leads, unified_persons`.

**Critical columns — all PRESENT (0 missing):**
| Table | Verified columns |
|---|---|
| `leads` | website_id, visitor_session_id, attribution, consent_state, unified_person_id, source, form_id, metadata ✅ (8/8) |
| `visitor_sessions` | session_key, stitched_at, anonymous_id, unified_person_id, first_touch, last_touch, last_seen_at ✅ (7/7) |
| `tracking_events` | dedupe_key, batch_id, user_agent, ip_hash, bot_flag, visitor_session_id, event_category, event_name ✅ (8/8) |
| `lead_intelligence` | dedupe_key, scores, source, unified_person_id, source_table, source_id, occurred_at ✅ (7/7) |
| `lead_intelligence_events` | lead_id, origin, source, event_type, occurred_at ✅ (5/5) |

**Key unique indexes — all PRESENT:**
- `uq_visitor_sessions_company_anon_session` (session upsert key: company_id + anonymous_id + session_key) ✅
- `uq_tracking_events_website_dedupe` (tracking dedupe) ✅
- `lead_intelligence_dedupe_unique` (canonical upsert key) ✅

**Foreign keys — intact and matching LC-001:**
- Lead spine FKs present: `campaign_touchpoints/form_conversions/lead_attributions → leads, visitor_sessions, websites, companies`; `tracking_events → visitor_sessions, websites, companies`; `leads → unified_persons, forms, websites, company_integrations`; `lead_intelligence_events → lead_intelligence`.
- **Confirmed LC-001 observation:** `leads.visitor_session_id` has **no formal FK** (plain uuid) — matches the audit; orphan protection is app-level only.

**RLS:**
| Table | RLS | Policies |
|---|---|---|
| leads, visitor_sessions, tracking_events, lead_attributions, campaign_touchpoints, form_conversions, lead_intelligence, lead_intelligence_events, forms, websites, unified_persons | ✅ enabled | 1 each |
| canonical_leads | ✅ | 5 |
| blog_analytics | ✅ | 2 |
| `lead_capture_topologies` | ✅ enabled | **0** (service-role-only access — app writes via service role; acceptable but no non-service policy) |
| `active_leads` | ❌ **RLS DISABLED** | 0 |

**Triggers:** only `trg_unified_persons_updated_at` (BEFORE UPDATE) on the spine — no unexpected triggers.

**Assessment:** **Schema CERTIFIED.** Zero column/index/FK drift on the capture + intelligence spine vs LC-001. Two minor RLS notes below (Drift Register D3/D4).

---

## 3. Tracker Deployment Report (V3)

| Signal | Repo expectation | Production observation | Drift |
|---|---|---|---|
| `tracking_events` rows (from `omnivera-tracker.js` → `/api/website-events/track`) | populated if tracker live | **0 rows** | Tracker producing no data |
| `blog_analytics` rows (from `tracker.js` v4 → `/api/track`) | populated if v4 tracker live | **0 rows** | Legacy tracker producing no data |
| `visitor_sessions` | populated on any tracked visit | **0 rows** | No tracked sessions ever |

**Assessment: INCONCLUSIVE from data — and materially significant.** *Neither* tracker has written a single row in production. The LC-001 question "which tracker is deployed?" cannot be answered from the database because **no tracker is producing production data at all.** This means the LC-002 **G4 tracking-unification risk collapses**: there is no dual-silo data conflict and no cutover/migration hazard (LC-002 risk **R1 drops High → Low**). Confirming *which* tracker script is embedded on any live site remains an out-of-band check (site HTML / deploy config), not a database check.

---

## 4. Runtime Verification Report (V6)

**Requested trace:** Website → Tracker → API → Lead Capture → Identity → Lead Creation → Canonical Adoption → Lead Intelligence → Workspace.

| Stage | Production evidence | Status |
|---|---|---|
| Website → Tracker | 0 tracking_events, 0 visitor_sessions | **Never executed** |
| API → Lead Capture | 0 leads with `visitor_session_id`; 0 leads with canonical sources (`website/form_embed/webhook`) | **Never executed via capture path** |
| Identity resolution | 18 leads all have `unified_person_id` (0 null) | Seeded, not capture-derived |
| Lead creation | 18 `leads`, sources = `webinar/ads/organic/cold-list/low-intent-form`, last write **2026-03-28** | **Seed fixtures only** |
| Canonical adoption | `lead_intelligence` = **0 rows** | **Never executed** — `adoptLead` has produced nothing in prod |
| Lead Intelligence store | 0 canonical rows, 0 events | **Empty** |
| Workspace | reads unified sources; would render only the 18 legacy leads | Renders seeds; scored 0% (empty `scores`) |

**Assessment: UNVERIFIED (no execution history).** The end-to-end capture→intelligence flow has **never run in production.** This is the single most consequential W0 finding. It is not "drift" against the repo (the code is as audited) — it is the discovery that the pipeline is **unexercised**. Because a mandatory W0 exit criterion ("production event flow is verified") cannot be satisfied by observation, it is **converted into a W1 entry gate**: a single synthetic lead must be driven through `/api/website/lead-capture` (staging or a controlled prod probe) and confirmed to land in `leads` + `visitor_sessions` + `lead_attributions` + `lead_intelligence` before W1 feature work proceeds (see §10, Adjustment A).

---

## 5. Configuration Drift Report (V5)

*(Env var **names** inspected, never values.)*

| Config | Repo expectation | Production observation | Drift | Impact |
|---|---|---|---|---|
| `SUPABASE_URL` / service role / pooler | present | present; project `klkiseupptzbecbxwrky` | None | — |
| `LEAD_CAPTURE_DEFAULT_COMPANY_ID` / `_ORIGINS` / `_WEBSITE_ID` | optional (site_config tenant fallback) | **ABSENT** | Fallback tenant unconfigured | `/api/website/lead-capture` cannot resolve a tenant via `site_config`; relies entirely on verified-domain / website_id / integration-key. Corroborates the cold pipeline. |
| `OMNIVYRA_LEAD_COMPANY_ID` / `OMNIVYRA_SITE_ORIGINS` (deprecated fallback) | optional | **ABSENT** | Same as above | — |
| `CROSS_DOMAIN_ATTR_SECRET` | required for cross-domain handoff | **ABSENT** | Handoff unconfigured | `/api/internal/lead-webhook-handoff` + attribution-continuity inactive (matches LC-001 UI "not configured") |
| `OMNIVYRA_ENV`, `APP_MODE`, `ENABLE_AUTO_WORKERS` | present | present | None | — |

**Assessment:** No *drift* against repo defaults (all the above are optional/opt-in), but the **absence of any default-tenant + cross-domain config is consistent with a pipeline that was never activated**. W1 must decide the intended activation path (verified domain vs default site config) — see Adjustment C.

---

## 6. Data Integrity Report (V7)

| Metric | Value | Interpretation |
|---|---|---|
| `leads` total | **18** | Seed fixtures |
| `leads` by source | webinar:4, ads:4, organic:4, cold-list:3, low-intent-form:3 | **None are canonical capture sources** → not one lead came through `captureWebsiteLead`/`/api/leads` |
| `leads` null `unified_person_id` | **0** | Identity NOT-NULL invariant holds (0% orphan identity) |
| Duplicate `(company_id, lower(email))` groups | **0** | 0% duplicate rate |
| `leads` with `visitor_session_id` | **0** | 0% — no lead ever session-stitched |
| Orphan `leads.visitor_session_id → visitor_sessions` | **0** | No dangling refs (trivially, since 0 set) |
| `lead_intelligence` total | **0** | Canonical store empty |
| `lead_intelligence` empty-scores (all / website) | 0 / 0 | N/A (no rows) — **G3 has no production instance to exhibit** |
| Adoption gap (leads vs canonical) | 18 vs **0** | **100% of legacy leads unmirrored** — G8 backfill scope = 18 seed rows |
| `visitor_sessions` | **0** | Tracking spine empty |
| `visitor_sessions` stitched | 0 | — |
| `tracking_events` | **0** | Clickstream empty |
| `blog_analytics` | **0** | Legacy tracker empty |
| `lead_attributions` / `campaign_touchpoints` / `form_conversions` | 0 / 0 / 0 | Entire attribution spine empty |
| Recency | last_lead **2026-03-28**; tracking / canonical / session = **null** | Pipeline dormant ~4 months |

**Measured rates:** orphan sessions **0%** · duplicate leads **0%** · adoption **0/0 real** (0 canonical, but 0 real captures to adopt) · tracking failures **N/A (0 volume)**.

**Assessment:** Data integrity is **clean but empty**. There is no corruption, no orphaning, no duplication — because there is essentially no production capture data. The 18 seed leads are internally consistent (identity populated, no dupes). **G3 (score divergence) and G4 (silo fragmentation) are therefore code-path certainties, not observed production defects** — a reclassification the roadmap must record.

---

## 7. Production Drift Register

| ID | Category | Finding | Evidence | Repo expectation | Prod observation | Severity | Wave impact |
|---|---|---|---|---|---|---|---|
| **D1** | Runtime | Capture pipeline never executed end-to-end | 0 sessions/tracking/canonical/attribution; 18 seed leads | Pipeline operational | Cold / unexercised | **Major (to certification), Low (to risk)** | W1 entry gate: synthetic probe (Adj. A) |
| **D2** | Migration | `20260629000000` schema live but absent from ledger | ledger = {20260677,20260678}; tables present | ledger ⊇ schema | ledger desync | **Medium** | W1 pre-req: reconcile ledger (Adj. B) |
| **D3** | Platform Integrity | `active_leads` RLS **disabled**, 0 policies | pg_class.relrowsecurity=false | RLS enabled | disabled | **Medium** (System B tenant isolation) | Not W1 (System B) — log for Workflow/Compliance wave |
| **D4** | Platform Integrity | `lead_capture_topologies` RLS on, **0 policies** | pg_policies=0 | service-role policy | none (service-role bypass only) | **Low** | Cosmetic; app writes via service role |
| **D5** | Config | No default-tenant / cross-domain capture config | `LEAD_CAPTURE_DEFAULT_*`, `CROSS_DOMAIN_ATTR_SECRET` absent | optional | absent | **Low** | W1 must choose activation path (Adj. C) |
| **D6** | Data | 18 `leads` are seeds with non-canonical sources | source ∈ {webinar,ads,…} | n/a | seed fixtures | **Low** | G8 backfill must decide seed handling |
| **D7** | Verification | Prod DB identity vs Vercel/worker runtime not cross-confirmed | `.env.local` = `klkiseupptzbecbxwrky` (per memory = prod) | same project | assumed same | **Low** | Confirm Vercel `SUPABASE_URL` == this project (Adj. D) |

---

## 8. W1 Readiness Assessment

| W1 assumption (from LC-002) | Status after LC-000 | Adjustment |
|---|---|---|
| **G3 — score materialization** | Schema supports it (`lead_intelligence.scores` jsonb + dedupe unique present). **No production data exhibits the list/detail divergence** (0 canonical rows). | Reframe from "fix observed drift" to "implement on cold path"; validate against the synthetic probe, not existing data. Risk **R2 unchanged** (still must call the same engine). |
| **G4 — tracking unification** | Both `tracking_events` and `blog_analytics` **empty**. No dual-silo data conflict. | **Risk R1 High → Low.** No dual-write reconciliation window needed; this becomes a clean consolidation. Still must pick the single canonical ingest before any tracker goes live. |
| **G1 — capture abuse controls** | Endpoint exists; **0 capture volume**; no default tenant configured. | Implement before activation, not before traffic exists. Sequence G1 **with** activation, since abuse only matters once capture is reachable/tenanted. |
| **G8 — canonical backfill** | `lead_intelligence` = 0 vs `leads` = 18. | Backfill scope tiny (18 seeds); decide seed inclusion (D6). Low effort. |
| **Schema foundation for all W1 work** | **CONFIRMED live.** | None — proceed. |

**Net effect on the roadmap:** W1's *risk profile drops* (cold pipeline removes migration/cutover hazards) while its *definition-of-done gains a prerequisite* (prove the pipeline runs at all). Wave ordering in LC-002 §3 is **unchanged**; W1 gains an **entry gate** and two **pre-req tasks**.

---

## 9. W0 Exit Criteria — status

| Exit criterion | Status |
|---|---|
| All LC-001 assumptions verified or disproven | ✅ Done (schema **verified true**; tracker-deployment assumption **disproven — inconclusive/cold**) |
| Production schema certified | ✅ **Certified** (all tables/columns/indexes/FK/RLS present) |
| Production tracker deployment verified | ◐ **Inconclusive from data** — no tracker producing rows; out-of-band site check required |
| Production event flow verified | ❌ **Not satisfiable by observation** (pipeline never ran) → converted to W1 entry gate (Adj. A) |
| W1 dependencies validated | ✅ Validated + adjusted (§8) |
| Engineering roadmap confirmed or updated | ✅ Confirmed with adjustments (§10) |
| Formal certification decision issued | ✅ **CERTIFIED WITH ADJUSTMENTS** (§0) |

---

## 10. Required Roadmap Adjustments

**These are the conditions of the "WITH ADJUSTMENTS" certification. W1 planning must absorb them; no new architecture is implied.**

- **Adjustment A — W1 entry gate: prove the pipeline runs.** Before any W1 feature work, drive one synthetic lead through `/api/website/lead-capture` (staging, or a controlled prod probe against a test tenant) and confirm it lands in `leads` + `visitor_sessions` + `lead_attributions` + `campaign_touchpoints` + `lead_intelligence` + `lead_intelligence_events`. This replaces the unmet "event flow verified" exit criterion. Rationale: we must not build G3/G4/G8 on a path with zero execution evidence.

- **Adjustment B — Reconcile the migration ledger (pre-req).** Register `20260629000000_lead_intelligence_store` in `supabase_migrations.schema_migrations` (schema already live) **before** W1 introduces any new migration through automated tooling, so `db push`/diff does not misfire on the desync. Read-only until then. (Category: Platform Integrity.)

- **Adjustment C — Define the activation path.** W1 must state the intended tenant-resolution route for real capture (verified website domain vs `LEAD_CAPTURE_DEFAULT_*` site config) and configure it. Today none is set (D5), which is why capture is unreachable/untenanted. This is a **configuration** decision, not code.

- **Adjustment D — Confirm runtime↔DB identity.** Verify the Vercel deployment and Railway worker use `SUPABASE_URL == klkiseupptzbecbxwrky` (the DB certified here). If production runtime points at a different project, this certification must be re-run against that project. (Low likelihood per project memory; must be closed before sign-off.)

- **Roadmap risk updates:** LC-002 **R1 (tracking cutover) → Low** (no data to migrate). LC-002 **G3/G4/G8 reclassified** from "remediate observed production drift" to "implement on a cold/clean pipeline." All other LC-002 waves, gates, and ordering stand.

- **Deferred (not W1):** D3 (`active_leads` RLS disabled) → route to the Workflow/Compliance wave as a System-B tenant-isolation item.

---

## 11. Certification statement

The production database `klkiseupptzbecbxwrky` **matches the LC-001 schema baseline** — every migration's schema effect, every capture/intelligence column, index, foreign key, and RLS policy is present and correct. The lead-capture pipeline is **structurally ready but operationally cold** (never exercised), and the migration ledger carries one **schema-present/ledger-absent** desync. These are **minor drifts that refine — and largely de-risk — Wave W1**, not architectural drift that invalidates it.

**Decision: CERTIFIED WITH ADJUSTMENTS.** Wave W1 is authorized to begin once Adjustments A–D (§10) are accepted into the W1 plan.

*Verification was strictly read-only: session set `default_transaction_read_only`, `information_schema`/`SELECT` only, zero writes, zero schema changes, production untouched.*
