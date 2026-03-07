# Phase-2 Governance Enhancement — updated_at Columns

---

## 1. Migration File Created

| File | Purpose |
|------|---------|
| `database/governance_add_updated_at.sql` | Adds `updated_at` to `intelligence_categories`; also `plan_features` if table exists (removed by plan_limits_feature_unification.sql) |

**Run order:** After `intelligence_categories.sql`. If `plan_features` exists, the migration handles it; otherwise it is skipped.

---

## 2. Tables Updated

| Table | Change |
|-------|--------|
| `intelligence_categories` | Added `updated_at TIMESTAMPTZ DEFAULT now()` |
| `plan_features` | Added only if table exists (table removed by plan_limits_feature_unification.sql) |

Both columns use `ADD COLUMN IF NOT EXISTS` for idempotent execution.

---

## 3. Trigger Function Added

| Function | Behavior |
|----------|----------|
| `set_updated_at_timestamp()` | Sets `NEW.updated_at = now()` on row update |

**Triggers:**

| Trigger | Table | Event |
|---------|-------|-------|
| `intelligence_categories_updated_at` | intelligence_categories | BEFORE UPDATE |
| `plan_features_updated_at` | plan_features (if exists) | BEFORE UPDATE |

Triggers use `DROP TRIGGER IF EXISTS` before `CREATE` for idempotency.

---

## 4. Verification: Governance Service Compatibility

**File:** `backend/services/intelligenceGovernanceService.ts`

| Check | Result |
|-------|--------|
| Column lists | All queries use explicit `select('id, name, description, enabled, created_at')` etc. — no `select('*')` |
| Compatibility | Adding `updated_at` to the table does not affect existing selects. Explicit column lists continue to work. |
| Code changes required | **None.** Service requires no modification. |

---

## 5. Verification: Admin API Compatibility

| Endpoint | Result |
|----------|--------|
| `/api/admin/intelligence/categories` | Continues to work. Returns same response structure. `updated_at` is not in the response until explicitly added to the service (optional future enhancement). |
| `/api/admin/intelligence/plans` | Continues to work. Returns same response structure. |

**No API logic changed.** The new column is additive; existing responses remain unchanged.

---

## 6. Confirmation: Ingestion Pipeline Unchanged

| Component | Status |
|-----------|--------|
| intelligencePollingWorker.ts | Not modified |
| intelligenceIngestionModule.ts | Not modified |
| intelligenceQueryBuilder.ts | Not modified |
| externalApiService.ts | Not modified |
| signalRelevanceEngine.ts | Not modified |
| intelligenceSignalStore.ts | Not modified |
| schedulerService.ts | Not modified |
| intelligence_signals | Not modified |
| external_api_sources | Not modified |
| intelligence_query_templates | Not modified |
| company_api_configs | Not modified |

**Schema change scope:** Only `intelligence_categories` (and `plan_features` if it exists before unification). No intelligence signal tables or ingestion components touched.

---

## Backward Compatibility

- **Additive only:** New column with default; existing rows get `now()` or keep existing value.
- **No breaking changes:** Governance service and admin APIs work as before.
- **Optional exposure:** To include `updated_at` in API responses, add it to the governance service `select()` calls in a future change.
