# OMNIVYRA — PHASE 2A: LOCAL VERIFICATION OF THE usage_events SCHEMA-DRIFT FIX

**Localhost-only. No deploy, no push, no merge, no prod writes, no cost.** The fix was proven by replaying the prod `usage_events` schema in an in-memory Postgres and running the old-vs-fixed INSERT.

> ### Environment reality (determines what "localhost only" can mean)
> `.env.local` points at **production** Supabase (`klkiseupptzbecbxwrky`), and the local Supabase stack **cannot replay the full schema** (documented date-prefix migration collision). There is **no running local Postgres** (no supabase/docker/psql). So: running the real `logUsageEvent`/a real generation "locally" would **write to production** (and spend OpenAI money) — which "localhost only / no prod impact" forbids. The safe, faithful proof is an **in-memory replica** of the prod `usage_events` schema (`pg-mem`, installed `--no-save`, removed after) running the exact INSERT column sets.

---

## SECTION A — LOCAL DATABASE VALIDATION (prod schema, read-only)
Live column probe of `usage_events`:
| Column | Exists? |
|---|---|
| `provider_name` | ✅ |
| `model_name` | ✅ |
| `provider` | ❌ **absent** |
| `model` | ❌ **absent** |
| `feature_area` | ❌ **absent** |

(+ all 24 other INSERT columns verified present: organization_id, campaign_id, user_id, source_type, model_version, source_name, process_type, action_key, input/output/total_tokens, latency_ms, error_flag, error_type, unit_cost, total_cost, total_cost_usd, input/output_cost_usd, final_price_usd, pricing_snapshot, beta_cohort, monetization_beta_enabled, ledger_hold_transaction_id, metadata, created_at.) **Schema drift confirmed**: the table has `provider_name`/`model_name` but not the legacy `provider`/`model`/`feature_area`.

---

## SECTION B — INSERT VALIDATION (in-memory replica, zero prod impact) → ✅ PASS
Replicated the prod `usage_events` schema in `pg-mem` and ran both INSERT shapes:
```
[OLD  (provider/model/feature_area)]  ❌ INSERT THREW: column "provider" does not exist
[FIXED (provider_name/model_name; feature_area in metadata)] ✅ INSERT SUCCEEDED — row written
    { organization_id:'org-test', process_type:'blogGeneration', action_key:'content_generation',
      provider_name:'openai', model_name:'gpt-4o-mini', total_tokens:2000,
      total_cost_usd:0.00084, metadata:{ feature_area:'Blog' } }
RESULT: OLD FAILED (column drift) · FIXED wrote · rows in table: 1
```
- **Insert succeeds:** ✅ the fixed shape writes a row.
- **No exception:** ✅ fixed path throws nothing.
- **Row written:** ✅ exactly 1 row, with cost + provider + model + tokens + feature_area-in-metadata.
- **Old shape reproduced the prod failure:** ✅ `column "provider" does not exist` — the exact silent-catch cause.

*(This proves the INSERT column-set behavior — the actual root cause. It does not invoke the literal `logUsageEvent` function, because that uses the Supabase client bound to prod; running it would write to production. The column set is what the fix changes and what was failing, so the replica is a faithful proof.)*

---

## SECTION C — REAL GENERATION TEST → ⛔ NOT POSSIBLE LOCALHOST-ONLY (honest)
A real blog/article/BOLT generation cannot be run localhost-only here:
1. **No local full schema** — the local Supabase stack can't replay the colliding migrations (157/316 share date-only prefixes), so there is no local DB with the blogs/campaigns/credits/usage_events schema to write into.
2. **Running against `.env.local` = writing to PRODUCTION** + a real OpenAI call (cost) — forbidden by "localhost only / no prod impact."

This is exactly the agreed **post-deploy** step ("you trigger a generation in the live app, I verify read-only"). It is not a gap in the fix — it's an environment limit on end-to-end local execution.

---

## SECTION D — USAGE_EVENTS VERIFICATION
- **Shape (local proof):** newest in-memory row → `organization_id=org-test`, `process_type=blogGeneration`, `action_key=content_generation`, `created_at=now()`. ✅ correct shape under the fix.
- **Real prod row:** pending Section C (the live generation), which is the agreed post-deploy verification. The current prod `usage_events` newest is still 2026-03-14 until the fix deploys.

---

## SECTION E — COST POPULATION → ✅ (under the fix)
The fixed insert wrote: `total_cost_usd = 0.00084`, `provider_name = openai`, `model_name = gpt-4o-mini`, `input_tokens=1200 / output_tokens=800 / total_tokens=2000`. ✅ All cost + provider + model + token fields populate on the fixed path. (Real per-call values arrive with the real generation post-deploy; the shadow layer also re-derives cost independently.)

---

## SECTION F — SHADOW ECONOMICS
`shadowEconomicService` reads `usage_events` and was already validated (Phase 1) consuming the existing 585 rows at **99.5% cost coverage**. It consumes the **same columns** the fixed insert writes (`organization_id`, `process_type`/`action_key`, `model_name`, tokens, cost, metadata), so a fresh row is consumed **unmodified**. Demonstrating it consuming a *brand-new* row requires Section C (a real generation) → post-deploy. `pipeline.stale` will flip to `false` the moment a fresh row lands.

---

## SECTION G — REGRESSION CHECK → ✅ PASS
- **`unified_transactions` unaffected:** the fix is confined to the `usage_events` INSERT block + its `metadata` line; `recordUnifiedTransaction` (`:461`) is **untouched**. And `unified_transactions` is already fresh (382 rows/7d) — it never depended on the `usage_events` insert succeeding (separate writer). No regression.
- **No billing change:** diff touches only the `usage_events` column list (+13/−6). Hard-mode cost/action_key guards, `resolveLlmCost`, and `apply_credit_reservation` are untouched.
- **No credit / reservation change:** no ledger, RPC, or `credit_*` code in the diff.

---

## SECTION H — FINAL RESULT

### ✅ PASS — and production deployment is LOW-RISK

**Evidence:**
1. **Root cause reproduced** (Section B): the old INSERT throws `column "provider" does not exist` against the prod schema — the exact silent-catch cause of the dead pipeline.
2. **Fix validated** (Section B/E): the fixed INSERT **succeeds and writes a row** with cost/provider/model/token fields populated and `feature_area` preserved — proven on a faithful replica of the prod schema, **zero prod impact, no cost**.
3. **Schema confirmed** (Section A): the fixed insert references **only columns that exist** in prod; the 3 removed are verified absent.
4. **No regression** (Section G): diff confined to the `usage_events` column list; `unified_transactions`, billing, credits, reservations untouched.

**Why deployment is low-risk:** the change strictly *removes 3 non-existent columns* from an INSERT that currently **always throws**. Post-fix it can only go from always-failing to succeeding — there is no path by which it makes telemetry or billing worse. The only thing not provable localhost-only is the **end-to-end fresh prod row** (blocked by the prod-only env + collision-blocked local stack), which is the agreed **post-deploy "you trigger, I verify"** step.

**Recommendation:** safe to proceed to PR → deploy (both Railway worker + Vercel) when you're ready; I'll verify the first real fresh `usage_events` row read-only on your signal.

*(Localhost-only. No deploy, push, or merge. No production writes, no API cost. `pg-mem` was installed `--no-save` and removed; package.json/lock untouched; temp scripts deleted. The prepared `fix/usage-events-schema-drift` branch from Phase 2A remains ready and unpushed.)*
