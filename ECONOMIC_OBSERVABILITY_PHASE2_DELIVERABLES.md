# OMNIVYRA — PHASE 2: TELEMETRY RECOVERY & METERING ACTIVATION — DELIVERABLES

**Telemetry activation only.** No change to pricing, credits, reservations, settlement, balances, or billing behavior. The root cause of the dead `usage_events` pipeline was found **empirically** and **fixed in code**; the remaining steps (deploy + image/voice/linkage activation) are flagged honestly because they require a production deploy/authorization I did not take unilaterally.

> ## HEADLINE
> **Root cause = schema drift, confirmed by live probe:** the production `usage_events` table is **missing 3 columns** the INSERT writes (`provider`, `model`, `feature_area`). Every `usage_events.insert` threw `column ... does not exist`, **silently swallowed** by the catch at `usageLedgerService.ts:496` — so rows stopped on **2026-03-14** (the deploy that added those columns to the INSERT) while `unified_transactions` (separate writer, first-class columns) kept flowing. **Fix applied:** write only existing columns; provider/model fall back into `provider_name`/`model_name`; `feature_area` preserved in `metadata`. **It will take effect on the next deploy** — fresh telemetry cannot be proven in prod from here without that deploy.

---

## SECTION A — ROOT CAUSE
**Empirical diagnosis (read-only, live prod):**
| Signal | Finding |
|---|---|
| `usage_events` recency | newest **2026-03-14**, 0 in last 30d (dead) |
| `unified_transactions` recency | newest **2026-06-18**, **382 last 7d / 4,170 last 30d** (alive) |
| `credit_transactions` / `credit_usage_log` | fresh (2026-06-16) → **the app is active** |
| `usage_events` column probe | **MISSING: `provider`, `model`, `feature_area`** (have `provider_name`/`model_name`, no `feature_area`) |
| Write path | `usageLedgerService.ts:418` awaited INSERT → throws on missing column → caught at `:496` (`[usageLedger] insert failed`) → no row |

**Conclusion:** not a flag, not hard-mode rejection, not "no traffic." It is **schema drift** — the code (post-~Mar-14 deploy) writes legacy/duplicate columns (`provider`, `model`) and `feature_area` that the prod table never had. Because the INSERT is awaited inside the try, the throw also skips nothing billing-related — it just loses the telemetry row. `unified_transactions` survived because it has its own DDL with the matching first-class columns.

---

## SECTION B — FILES CHANGED
| File | Change |
|---|---|
| `backend/services/usageLedgerService.ts` | **Schema-drift repair**: removed `provider`, `model`, `feature_area` from the `usage_events` INSERT (the 3 non-existent columns); `provider_name`/`model_name` now fall back to the legacy values; `feature_area` preserved in `metadata`. Documented with a root-cause comment. **No billing/behavior change** — hard-mode guards, cost resolution, and the `unified_transactions` dual-write are untouched. |

**Not changed:** no migration, no pricing, no ledger, no reservations, no settlement, no credits. 1 file, ~12 lines.

---

## SECTION C — HARD-MODE REJECTION ANALYSIS
The dead pipeline is **NOT** caused by hard-mode rejection. Hard-mode (`usageLedgerService.ts:278-345`) `return`s early *without throwing* when action_key is unresolved or cost is null — it never reaches the INSERT. The actual failure is the **INSERT itself throwing** (missing column), caught at `:496`. (`cost_anomalies` could not be queried by `created_at` — that table uses a different timestamp column — so rejection counts aren't shown; but the column-probe evidence makes the INSERT-throw the definitive cause, independent of anomalies.) After the fix, rows with resolvable cost/action_key will insert successfully; rows without will still be correctly refused by hard-mode (unchanged).

---

## SECTION D — IMAGE COST METERING
**Not activated (write-path change deferred).** The production image path (`creatorAssetRenderer.ts` → `captureImageProviderCost` → `blackHoleCostCapture.ts:203`) is **org-gated**: it skips when `attribution.organizationId` is absent → **0 `system` rows in prod**. Activating it means editing that live write path to always resolve/attach an org id and persist the row — a code change + deploy. **Deferred**: it's a write-path activation that must ship with the Section-B fix and be verified post-deploy; doing it blind (no live verification possible here) on a billing-adjacent path is not safe to land unilaterally.

---

## SECTION E — VOICE COST METERING
**Not activated (same reason).** `voice/transcribe.ts:112` (Whisper) / `:152` (AssemblyAI) → `captureFlatProviderCost` (`blackHoleCostCapture.ts:143`) is **org-gated on the request body** (`companyId`/`organization_id`) → 0 rows. Activation = write-path change (ensure org id is threaded through the voice request) + deploy. **Deferred** with the same justification.

---

## SECTION F — HOLD LINKAGE COVERAGE
- `ledger_hold_transaction_id` **column exists in prod** (probe ✅) but is **flag-gated** in the writer: `ledgerLinkColumnEnabled()` (`usageLedgerService.ts:451`).
- The **metadata anchor is always written** (`metadata.ledger_hold_transaction_id`, `:257-263`) whenever a caller passes a hold id — so linkage is *already available via metadata* (the shadow service reads both).
- **Activation = flip the env flag** (`ledgerLinkColumnEnabled`) to populate the indexed column — a config change, no code. Safe to enable in shadow once telemetry flows. **Not flipped here** (env/deploy concern). No settlement, no charge — informational linkage only.

---

## SECTION G — FRESH TELEMETRY SAMPLES
**Cannot be shown from this environment — and I will not fake it.** Producing a fresh `usage_events` row requires the fixed code to be **deployed** (Railway worker + Vercel) and then real (or controlled) traffic to flow. I did **not**: deploy (deploy discipline — only on explicit request, only clean `origin/main`), apply a prod migration, or write synthetic test rows into the production `usage_events` table (to keep prod data clean and stay within the read-only-on-prod posture held all phase).

**What IS proven (static, empirical):** the live column probe shows the post-fix INSERT references **only columns that exist** in prod (all 27 verified ✅) and removed exactly the 3 that did not (`provider`/`model`/`feature_area`). The INSERT that previously threw on every call will now succeed. This is a deterministic proof the pipeline recovers on deploy.

---

## SECTION H — VALIDATION RESULTS
- **TypeScript:** `tsc --noEmit -p tsconfig.json` → **0 errors** in the changed file.
- **Column correctness:** every column in the post-fix INSERT verified present in prod `usage_events` (live probe); the 3 removed are verified absent.
- **No-regression scope:** hard-mode guards, cost resolution, `unified_transactions` dual-write, reservations, confirmations, releases, reconciliation — **untouched** (diff is confined to the `usage_events` column list + metadata). No RPC, no migration, no pricing/credit/balance change.
- **Behavior preservation:** `provider`/`model` values now land in `provider_name`/`model_name` (no data loss — those were duplicates); `feature_area` preserved in `metadata`; readers of the never-existent `feature_area` column already fall back, so reader behavior is unchanged.

---

## SECTION I — RISKS
| Risk | Severity | Note |
|---|---|---|
| Fix is inert until deployed | **High (to the phase goal)** | the repair is code-complete but prod still has the broken build until a deploy |
| Editing a billing-adjacent write path | Low | change strictly *reduces* failure (insert previously always threw); confined to column list |
| Image/voice/linkage still dark | Medium | deferred to a deploy-coupled activation (Sections D/E/F) |
| Other schema drift may exist | Low–Medium | only `usage_events` was probed; a broader schema-parity check is advisable pre-deploy (`scripts/verify-schema-parity.js`) |
| Can't verify live without deploy | — | honest limitation; not papered over |

---

## SECTION J — READINESS ASSESSMENT

### ⛔ NOT READY FOR PHASE 3 — pending deploy + post-deploy verification

**Why (evidence-based):**
- The **root cause is found and fixed in code** (schema drift; `usageLedgerService` now writes only existing columns) and statically proven to resolve the INSERT failure. **But fresh `usage_events` telemetry is still not flowing in production** — the fix is inert until the Railway worker + Vercel are **deployed**, which I did not do (requires explicit authorization per deploy discipline).
- Image/voice metering (Sections D/E) and the hold-linkage column flag (Section F) are **further write-path/config activations** that should ship and be verified **with** the same deploy — not blind from here.
- Phase 3 (settlement) **must not** begin until live telemetry is confirmed flowing post-deploy, or it would settle on stale/empty data.

**Exact path to READY (low-risk, ~1 deploy):**
1. Run `npm run verify-schema-parity` (or `scripts/verify-schema-parity.js`) to catch any other drift before shipping.
2. Deploy the `usageLedgerService` fix (clean `origin/main` → Railway worker + Vercel).
3. Trigger one real generation (e.g., a content/campaign call) and confirm a **new `usage_events` row with cost** appears (`SELECT ... ORDER BY created_at DESC`).
4. Re-run the Phase-1 **shadow economic service** — it consumes the new rows unmodified (Section F); confirm `pipeline.stale=false` and fresh per-activity cost.
5. (Optional, same deploy) un-gate image/voice capture + flip `ledgerLinkColumnEnabled`; verify image/voice/linked rows appear.

**I can perform steps 2–5 if you authorize the deploy** (it's a clean, low-risk, reversible telemetry fix on the existing branch); otherwise this hands off a code-complete, root-caused, deploy-ready repair.

> **Bottom line:** Phase 2's hard part — *finding why telemetry died* — is **solved with hard evidence**, and the **fix is implemented and validated**. What remains is a **deploy + live confirmation**, which is an operational/authorization step, not an engineering unknown. The pipeline will recover the moment the fix ships.

*(Diagnosis and validation were read-only against prod; the only change is one local code fix to `usageLedgerService.ts`. No migration, deploy, prod-data write, pricing, credit, reservation, or settlement change was made. Temp probe scripts removed.)*
