# Variable-Cost Tracking Roadmap

**Status:** LOCKED (Phase 7-final complete).
**Owner:** platform-cost
**Last updated:** 2026-04-21

---

## FINAL STATE — DO NOT MODIFY WITHOUT SYSTEM REVIEW

The cost-tracking system is locked in its production-hardened shape.
Any change to the five frozen tables, their writers, or the unified-ledger
read path requires explicit system review per the [Change Protocol](#change-protocol)
below. CI gates enforce this via `npm run guard:cost-tracking`.

### Frozen surfaces

| Surface | Why frozen |
|---|---|
| `unified_transactions` | Single source of truth for cost + credits + margin. Any shape change invalidates analytics. |
| `llm_model_pricing` | Versioned pricing; write only via `POST /api/admin/pricing/update`. |
| `action_pricing_config` | Versioned per-action multiplier; write only via admin pricing APIs. |
| `pricing_intelligence` | Weekly snapshot consumed by recommendations endpoint. |
| `cost_anomalies` | Raw anomaly log feeding alerts; CHECK constraint enum must not shrink. |
| `unifiedTransactionService.recordUnifiedTransaction` | Single write path. |
| `usageLedgerService.logUsageEvent` | Dual-write orchestrator. |
| `orgCostSummaryService` | Only analytics reader. |
| `weeklyPricingAnalysisJob` | Only ledger-aggregation producer. |

### CI gates

Run in every PR before merge:

```bash
npm run guard:cost-tracking
# which executes:
npm run audit:legacy-ledger-reads   # scripts/audit-legacy-ledger-reads.ts
npm run check:frozen-schemas        # scripts/check-frozen-schemas.ts
```

- **`audit-legacy-ledger-reads`** — greps for `.from('usage_events')` / `.from('credit_usage_log')` outside the allow-list (writer + reservation machine + backfill script).
- **`check-frozen-schemas`** — greps migrations newer than `20260520_lock_core_schemas.sql` for `ALTER/DROP` on frozen tables. Bypass marker: `-- APPROVED_SCHEMA_CHANGE: <reason>` in the migration header.

### Environment flags (captured at boot, frozen in-process)

Read via [`backend/services/config/productionFlags.ts`](../backend/services/config/productionFlags.ts) — never read `process.env.*` for these directly.

| Flag | Production value | Locked in-process |
|---|---|---|
| `USE_UNIFIED_LEDGER_ONLY` | `true` | yes |
| `NODE_ENV` | `production` | yes |

### Monitoring baseline — first 14 days after lock

Daily query:

```sql
SELECT day, anomaly_type, severity, anomaly_count
  FROM cost_monitoring_daily_view
 WHERE day >= CURRENT_DATE - INTERVAL '14 days'
 ORDER BY day DESC, anomaly_count DESC;

SELECT day, total_api_cost_usd, total_credits_value_usd,
       margin_usd, negative_margin_total_usd, negative_margin_event_count
  FROM cost_margin_daily_view
 WHERE day >= CURRENT_DATE - INTERVAL '14 days'
 ORDER BY day DESC;
```

### Alert escalation rules

| Anomaly type | If count > 0 per day | Action |
|---|---|---|
| `pricing_missing` | Any | **Immediate fix** — add model row via `/api/admin/pricing/update`. New model in code without a corresponding price row is always a bug. |
| `unknown_action_key` | Any | **Mapping update required** — add the new `process_type` to `PROCESS_TYPE_TO_ACTION_KEY` in `usageLedgerService`. |
| `cost_credit_mismatch` | Any | **Investigate upstream logic** — a costed action didn't charge credits, or negative margin accumulated. Review `cost_anomalies.metadata` for the specific row. |
| `structural_leak` | Any | **Investigate caller** — an LLM/embedding/external_api call produced cost without credits_charged. Either add charging or mark source_type=system intentionally. |
| `cost_exceeds_request_threshold` | > 3/day | **Investigate prompt/context growth** — auto-flagged orgs block further high-cost actions. |

### Unsafe-fallback policy

The following are **explicitly disallowed** and will fail CI / production guards:

- **Silent fallback pricing** — no hardcoded `PROVIDER_PRICING` / `EMBEDDING_PRICING` maps. All rates come from `llm_model_pricing` via `pricingService`.
- **Estimated cost usage** — `api_cost_usd` is always computed from actual provider-returned token counts.
- **Legacy ledger reads for analytics** — `usage_events` and `credit_usage_log` are writer-only tables post-lock. All reads go through `unified_transactions` or `org_economics_view`.
- **`process.env` direct reads for production flags** — use `backend/services/config/productionFlags.ts`.

### Change Protocol

Any PR touching cost-tracking code MUST include in its description:

> #### Cost-tracking impact
> - **Unified ledger impact:** [e.g. "New `source_type='x'` requires migration + CHECK update"] OR "none"
> - **Pricing accuracy impact:** [e.g. "New model — needs `llm_model_pricing` row"] OR "none"
> - **Margin tracking impact:** [e.g. "Adds new action — weekly job will pick it up next run"] OR "none"

If any of the three answers is unclear or blank, the PR is **rejected** at review.

For schema changes to frozen tables: include `-- APPROVED_SCHEMA_CHANGE: <reason>` at the top of the migration file AND get explicit sign-off from the cost-tracking owner before merge.

---


## Pricing principle

Charge proportional to activity. Fixed infrastructure bills (Supabase,
Railway, Upstash) must NOT be split flat across active users — usage is
uneven and flat allocation under- or over-charges customers. Every variable
cost — LLM tokens, embedding tokens, external API calls, Redis operations,
DB queries, compute seconds — lands in a single append-only ledger keyed
by `(organization_id, user_id, action, units)`. Pricing maps units to
dollars / credits at allocation time, so pricing can change without code.

## Current state (post-Phase-1)

All LLM and embedding calls in the codebase are instrumented via
`usage_events`. Source types:

| source_type            | Meaning                                        | Credit-deducted |
|------------------------|------------------------------------------------|-----------------|
| `llm`                  | User-action LLM call (chat completion)         | Yes             |
| `embedding`            | User-attributed embedding call                 | Yes             |
| `system`               | Background LLM/embedding (ingest, clustering)  | No (visibility only) |
| `external_api`         | Metered 3rd-party API (GA4, platform adapters) | Varies          |
| `automation_execution` | Platform-internal automation                   | Varies          |

Call sites closed in Phase 1:
- [signalEmbeddingService.generateTopicEmbedding](../backend/services/signalEmbeddingService.ts) — required `companyId` param, logs per-call cost.
- [replyGenerationService](../backend/services/replyGenerationService.ts) — logs token counts + USD cost next to the existing credit deduction.
- [engagementIngestService.classifySentiment](../backend/services/engagementIngestService.ts) — required `companyId`, logged as `source_type='system'` (background work, not user-billed).
- Cluster-engine + backfill-script call sites attribute embedding cost to the originating signal's org.

## Phases

### Phase 1 — LLM + embeddings (this work)

**Goal:** every LLM / embedding call has a `usage_events` row with
`organization_id`, `model`, `input_tokens`, `output_tokens`, `total_cost`.

**Done when:** `grep -r '\.chat\.completions\|embeddings\.create' backend/` returns
zero call sites that don't have a matching `logUsageEvent`.

### Phase 2 — Infrastructure counters (next)

**Goal:** DB and Redis ops attributable to an org, so the fixed monthly
Supabase / Upstash bills can be allocated by share-of-activity.

Scope:
- Supabase query counter per org (likely a small middleware around the
  supabase client that reads a `current_org_id` from request context and
  increments a per-org counter in Redis or a dedicated `infra_events`
  table). Needs a denominator: total platform query count for the period.
- Redis operation counter per org (BullMQ enqueues, rate-limit zset writes,
  cache reads). Can hook into the existing `createInstrumentedClient`
  wrapper in [lib/redis/instrumentation](../lib/redis/instrumentation.ts).
- Monthly rollup job: for each org, compute
  `org_share_of_supabase = org_db_ops / total_db_ops × $supabase_bill`
  and write to a `usage_events` row with `source_type='infra'` +
  `unit_type='supabase_query_share'`.

Open question: granularity. Per-request (fine-grained but expensive) or
daily rollup (cheap but misses per-feature attribution)? Start daily.

### Phase 3 — Compute seconds

**Goal:** wall-clock time of jobs / workers attributable to an org.

Scope:
- Wrap each BullMQ job with timing; write `usage_events` row with
  `source_type='compute'`, `unit_type='cpu_seconds'`, duration_ms.
- Cron jobs that span multiple orgs: attribute proportionally by work done
  (e.g. per-org signal count processed).

### Phase 4 — Pricing layer

**Goal:** a config table that maps `(unit_type, tier) → (usd_per_unit, credits_per_unit)`,
allowing product to change pricing without code deploys.

Proposed shape:

```sql
CREATE TABLE unit_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type text NOT NULL,  -- 'llm_input_token_openai_gpt4o', 'embedding_token_openai_3small', 'supabase_query_share', 'cpu_second', …
  effective_from timestamptz NOT NULL,
  usd_per_unit numeric(20, 10) NOT NULL,
  credits_per_unit numeric(20, 10),
  tier text,               -- optional: volume tier / plan
  notes text,
  UNIQUE (unit_type, effective_from, tier)
);
```

Pricing resolution at allocation time: `SELECT … WHERE unit_type = ?
AND effective_from <= <usage.occurred_at> ORDER BY effective_from DESC LIMIT 1`.
Hardcoded `PROVIDER_PRICING` in [usageLedgerService](../backend/services/usageLedgerService.ts)
migrates to this table; `resolveLlmCost` / `resolveEmbeddingCost` become
DB-backed.

### Phase 5 — Table consolidation

**Goal:** collapse the three historical ledgers — `credit_transactions`,
`usage_events`, `credit_usage_log` — into a single `variable_consumption_events`
table that serves as the source of truth for both cost and credit
sides. Run the two side-by-side during a transition window; cut over
when analytics on the new table match the old.

## Verification gates

After each phase, the following SQL should return complete rows for every
org with activity:

```sql
-- Phase 1: no untracked LLM calls (audit check, approximate)
SELECT organization_id, count(*) FROM usage_events
  WHERE source_type IN ('llm','embedding','system')
    AND total_cost IS NOT NULL
    AND created_at > now() - interval '7 days'
  GROUP BY organization_id;

-- Phase 2: infra share populated monthly
SELECT organization_id, sum(total_cost) FROM usage_events
  WHERE source_type = 'infra'
    AND created_at > date_trunc('month', now()) - interval '1 month'
  GROUP BY organization_id;
```

## Related

- [Cost tracking audit findings (original)](AI-COST-VISIBILITY-STAGE-1-2-REPORT.md) — the pre-Phase-1 audit that surfaced the embedding + reply + ingest gaps.
- `credit_cost_config` table — current action-level pricing (Phase 4 replaces or extends this).
