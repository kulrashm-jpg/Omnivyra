# Intelligence Pipeline — Global Polling Fallback Implementation Report

**Date:** 2026-03-07  
**Scope:** Minimal fix to guarantee polling jobs when no company_api_configs exist

---

## 1 — Files Modified

| File | Change |
|------|--------|
| `backend/scheduler/schedulerService.ts` | Added global fallback logic to `enqueueIntelligencePolling()`; added mode logging |

---

## 2 — Polling Logic Change

**Before:** Returned `{ enqueued: 0 }` when `company_api_configs` had no rows with `enabled = true`.

**After:**
- **Company mode:** When `company_api_configs.enabled = true` exists → enqueue jobs for those sources (unchanged behavior).
- **Global fallback:** When no enabled configs → fetch all `external_api_sources WHERE is_active = true` and enqueue jobs with `companyId = null`, `purpose = 'global_intelligence_polling'`.

---

## 3 — Global Polling Behavior

- Sources: `SELECT id FROM external_api_sources WHERE is_active = true`
- Job payload: `{ apiSourceId, companyId: null, purpose: 'global_intelligence_polling' }`
- Same rate-limit, health, and reliability checks as company mode
- Log: `[intelligence] global polling enabled — no company configs found`

---

## 4 — Worker Compatibility

**Verified:** `intelligencePollingWorker` accepts `companyId = null` and passes it to `ingestSignals(apiSourceId, companyId ?? null, purpose)`. No code change required.

---

## 5 — Pipeline Database Counts

Run in Supabase SQL Editor after server restart:

```sql
SELECT COUNT(*) FROM intelligence_signals;
SELECT COUNT(*) FROM signal_clusters;
SELECT COUNT(*) FROM signal_intelligence;
SELECT COUNT(*) FROM strategic_themes;
SELECT COUNT(*) FROM company_intelligence_signals;
```

Counts will populate after workers process enqueued jobs and downstream engines run (clustering every 30 min, signal_intelligence/strategic_themes every hour).
