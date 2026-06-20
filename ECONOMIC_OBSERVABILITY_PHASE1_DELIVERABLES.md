# OMNIVYRA — PHASE 1: ECONOMIC OBSERVABILITY FOUNDATION — DELIVERABLES

**Observability only. 100% READ-ONLY.** No change to pricing, credit catalog, deductions, settlement, reservations, billing, or subscriptions. No migration. Existing behavior is byte-identical. Validated live against production data.

> ## OUTCOME
> Cost observability went from **0% → 99.5%** on the existing telemetry — **without touching the write path** — by re-deriving actual provider cost from already-captured tokens × the existing `llm_model_pricing` table, and computing shadow-settlement diagnostics. The investigation also corrected the root-cause picture (the cost-write is already wired + hard-enforced; pricing config is populated; the real issues are a *stale pipeline* and *historical null cost* — operational, not missing code).

---

## SECTION A — FILES CHANGED
**Created (3) — all additive, read-only:**
| File | Role |
|---|---|
| `backend/services/economicObservability/economicObservabilityTypes.ts` | Shadow types (record / aggregate / coverage / report) |
| `backend/services/economicObservability/shadowEconomicService.ts` | `getShadowEconomicReport()` — re-derives actual cost + shadow settlement (SELECT-only) |
| `pages/api/credits/shadow-economics.ts` | Read-only API (`withOrgAccess`) |

**Modified: 0.** No existing file touched. No migration. Read-only invariant: grep for write primitives (`insert/update/upsert/delete/.rpc/executeWithCredits/apply_credit/createCredit`) across the new folder → **zero matches**.

---

## SECTION B — COST POPULATION COVERAGE (live, 585 prod events)
| Metric | Before | After (shadow, read-only) |
|---|---|---|
| Events with token data | 99.5% (582/585) | 99.5% |
| Events with **usable cost** | **0%** (`total_cost_usd` null on all) | **99.5%** (582/585 re-derived) |
| Derivation method | — | `derived_io_pricing` (input/output tokens × `llm_model_pricing`) |
| Total actual provider COGS (all history) | unknown | **$0.380477** (1.1M tokens) |

The 3 uncovered events are `external_api_request` rows with 0 tokens (no token basis). **No duplicate pricing logic** — the service reads the same `llm_model_pricing` table `pricingService` uses.

---

## SECTION C — PROVIDER COVERAGE MATRIX (current reality)
| Provider | Usage captured | Cost (now observable) | Notes |
|---|---|---|---|
| OpenAI LLM (gpt-4o-mini) | ✅ tokens (582 rows) | ✅ **derived** $0.38 total | only model seen live |
| OpenAI gpt-4o / Anthropic | ✅ (pricing present) | ✅ derivable | not in live sample |
| Embeddings | ✅ (self-logs) | ✅ pricing present | 0 rows in sample |
| GPT Image | ⚠ org-gated capture | ❌ **0 rows in prod** | not firing (no org id) |
| Whisper / AssemblyAI (voice) | ⚠ org-gated capture | ❌ **0 rows in prod** | not firing |
| Perplexity/probes | ⚠ in-memory | ❌ ephemeral | not persisted |
| SERP (DataForSEO/Serp/Scale) | ✅ per-query | ✅ `costPerQueryUsd` | cron-only |
| Social | request | $0 quota | — |

**Pricing config is populated** (live): `llm_model_pricing` 6 active rows (gpt-4o-mini 0.0003/0.0006/1K, gpt-4o, claude, embeddings), `action_pricing_config` 31, `credit_cost_config` 45. Cost *can* resolve — the gap was never empty pricing.

---

## SECTION D — USAGE ATTRIBUTION COVERAGE (live)
| Dimension | Coverage | Evidence |
|---|---|---|
| Organization | **100%** | `usage_events.organization_id` on every row |
| Activity (process_type/action_key) | **100%** | `process_type` populated on every row |
| Campaign | 8.2% | `campaign_id` (only campaign-originated calls) |
| User | **0%** | `user_id` null on these (system/gateway) rows |
| Module (derived) | 100% | via `featureRegistry` + taxonomy |

Activities seen, with re-derived cost: `generateCampaignPlan` ($0.198, 97×), `runDiagnosticPrompt` ($0.088, 240×), `parsePlanToWeeks` ($0.061), `chatModeration` ($0.024), `profileExtraction/Enrichment`, `generateAdditionalStrategicThemes`.

---

## SECTION E — HOLD LINKAGE COVERAGE
| Item | Status | Evidence |
|---|---|---|
| `ledger_hold_transaction_id` (column + metadata key) | present in schema; **0% populated** on live rows | linkage is **pre-apply-safe via metadata** (`usageLedgerService.ts:255-263`) and flag-gated as an indexed column (mig 20260667) |
| `parent_transaction_id` (ledger) | ✅ live (confirm/release → hold) | `credit_transactions` |
The shadow service reads both the column and `metadata.ledger_hold_transaction_id`; historical rows carry neither (predate the link). **Informational only — no settlement performed.**

---

## SECTION F — SHADOW SETTLEMENT EXAMPLES (real, from prod)
`shadow_settlement_credits = actual_cost_usd ÷ org credit_rate_usd` · `difference = reserved − shadow` (diagnostic only):
| # | Activity | Module | Tokens | Actual cost | Reserved | Shadow settle | Diff |
|---|---|---|---|---|---|---|---|
| 1 | generateCampaignPlan | Campaigns | 4,710 | $0.001433 | 50cr | 0.15cr | **+49.85** |
| 2 | parsePlanToWeeks | Campaigns | 2,193 | $0.000921 | 50cr | 0.10cr | **+49.90** |
| 3 | generateAdditionalStrategicThemes | Intelligence | 612 | $0.000198 | 15cr | 0.02cr | +14.98 |
| 4 | runDiagnosticPrompt | Engagement | 958 | $0.000325 | 1cr | 0.04cr | +0.96 |

**Reserve-to-cost ratios (by module):** Intelligence **450×**, Campaigns **292×**, Creator **65×**, Engagement **31×**. Fixed reserved credits vastly exceed actual provider COGS — confirming (with live data) that credits monetize *value*, not token cost, and margins are enormous. **Highest actual-cost activities:** campaign planning + lead diagnostics.

---

## SECTION G — PIPELINE HEALTH RESULTS
| Signal | Result |
|---|---|
| `usage_events` newest event | **2026-03-14** |
| Events last 30 days | **0** → `stale = true` |
| `usage_events` total | 585 (all pre-enforcement, null `total_cost_usd`) |
| `unified_transactions` | 67,485 rows; **26,616 with `api_cost_usd`** (cost data lives here) |
| Pricing config | populated (6 active model rows) |
| Hard-mode enforcement | ON — `logUsageEvent` **refuses** rows with null cost/unknown action_key (`usageLedgerService.ts:278-345`) |

**Diagnosis (evidence-based):** the cost-write is *already wired and hard-enforced*; the 585 null-cost rows are *pre-enforcement* (≤2026-03-14). Since then `usage_events` shows **0 new rows** while `unified_transactions` grew to 67k — i.e. the `usage_events` LLM-telemetry write specifically stopped (a deploy/flag/traffic-routing change), OR new rows are being refused by hard-mode. **This is an operational pipeline issue, not a missing-code issue** — it must be diagnosed in the running app (logs for `usage_ledger_rejected_*`), which is out of scope for a read-only observability change and cannot be safely repaired by editing the bank-grade write path from here.

---

## SECTION H — VALIDATION RESULTS
- **TypeScript:** `tsc --noEmit -p tsconfig.json` (exit 0) → **0 errors** in the new files.
- **Read-only invariant:** grep for write primitives across `economicObservability/` → **zero matches** (SELECT-only).
- **Existing billing flows / reservations / confirmations / releases / reconciliation:** **untouched** — 0 files modified; no RPC called; no migration.
- **Live shadow run (prod, read-only):** executed against 585 real events → coverage 99.5% cost, real per-activity totals and shadow examples (Sections B/D/F). Service ran clean, no writes.

---

## SECTION I — RISKS
| Risk | Severity | Mitigation |
|---|---|---|
| Shadow cost is *derived*, not provider-invoiced | Low | clearly labeled `cost_derivation`; reconciliation subsystem remains the invoice-truth source |
| `usage_events` stale → shadow reflects only historical data | Medium | flagged `pipeline.stale=true`; the report surfaces it explicitly |
| Connecting to prod for validation | Low | read-only SELECTs only; temp script removed |
| Misread as billing-affecting | Low | docstrings + report state read-only repeatedly; 0 writes proven |

**No risk to balances, reservations, settlement, credits, pricing, or subscriptions** — none are touched.

---

## SECTION J — REMAINING WORK FOR PHASE 2
| Item | Why it's Phase 2 (not done here) |
|---|---|
| **Repair the `usage_events` pipeline** (0 rows in 30d) | Operational diagnosis in the running app (logs/flags/deploy) — cannot be safely fixed by a read-only change |
| **Activate image/voice cost capture** (0 `system` rows) | The org-gating skip lives in the live write path (`creatorAssetRenderer`/`voice/transcribe`) — a write-path change, deferred per the no-billing-change mandate |
| **Persist probe cost** (`costGovernance` in-memory) | Write-path change |
| **Activate `ledger_hold_transaction_id` linkage** | Flag-gated (mig 20260667); enable in shadow + backfill — Phase 2 metering |
| **Backfill `total_cost_usd` on historical rows** | A prod data mutation — out of scope for observability-only; the shadow layer already provides read-time cost |
| Persist shadow report (optional) | Currently computed on-read (no table/migration); persist only if a dashboard needs history |

---

## VERDICT

### ✅ READY FOR PHASE 2

**Justification (evidence-based):**
- The **economic-observability foundation is in place and validated on live data**: actual provider cost is now derivable for **99.5%** of telemetry, attributed to **org (100%) + activity (100%)**, with shadow-settlement diagnostics (reserved vs actual-cost) and real examples — all **read-only**, reusing existing pricing, **zero billing/ledger/pricing/write-path changes, zero migration**.
- The investigation **de-risked Phase 2**: the reservation+settlement ledger, reconciliation subsystem, and pricing config already exist and are populated; the only true blockers are **operational** (stale `usage_events` pipeline) and **write-path activations** (image/voice capture, hold-linkage flag) — both correctly scoped to Phase 2.
- Phase 2 (reservation wiring → consumption metering → settlement) can proceed on a **proven cost-observability layer**: it can already answer *what consumed money* ($0.38 total, campaign-planning + lead-diagnostics dominant), *which activities are overestimated* (reserve-to-cost 30×–450×), and *highest cost* (`generateCampaignPlan`) — **read-only, today.**

> **One caveat carried forward:** the live `usage_events` pipeline is stale (last write 2026-03-14). Phase 2's first operational step must be confirming new telemetry is flowing (diagnose `usage_ledger_rejected_*` logs / the hard-mode refusal path) so settlement operates on current data, not only the historical sample.

*(All work read-only. No code outside the new additive folder was modified; no schema, migration, credit, reservation, or price changed. Temp validation scripts removed after the run.)*
