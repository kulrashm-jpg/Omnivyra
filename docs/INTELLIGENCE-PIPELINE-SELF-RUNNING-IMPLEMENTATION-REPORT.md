# Intelligence Pipeline Self-Running — Implementation Report

## Objective

Make the intelligence pipeline run automatically when the server starts, without requiring separate manual `npm run start:workers` or `npm run start:cron` commands.

---

## 1 — Files Modified

| File | Changes |
|------|---------|
| `backend/queue/startWorkers.ts` | Refactored to export async `startWorkers()`; workers initialized inside function; added `[startup] workers initialized` log |
| `backend/scheduler/cron.ts` | First-run `enqueueIntelligencePolling` on startup; added `[startup] cron scheduler started`; added `[intelligence] polling jobs enqueued` with count |
| `backend/workers/intelligencePollingWorker.ts` | Added `[intelligence] processing polling job` log with `job.data` |
| `instrumentation.ts` | **New** — Next.js instrumentation hook that auto-starts workers and cron on server bootstrap |

---

## 2 — Worker Auto-Start Integration

- **Location:** `instrumentation.ts` (project root)
- **Mechanism:** Next.js `register()` instrumentation hook runs when the Node.js server starts
- **Flow:** `register()` → `await startWorkers()` → initializes publish, bolt-execution, engagement-polling, intelligence-polling workers
- **Conditional:** Runs only when `NEXT_RUNTIME === 'nodejs'` and `DISABLE_AUTO_WORKERS` is not set
- **Standalone:** `npm run start:workers` still works; calls `startWorkers()` when file is executed directly

---

## 3 — Scheduler Auto-Start Integration

- **Location:** `instrumentation.ts`
- **Mechanism:** `startCron()` invoked after `startWorkers()` (non-blocking so server can become ready quickly)
- **Flow:** `startCron()` runs first-run intelligence polling, then full scheduler cycle, then 60-second interval
- **Standalone:** `npm run start:cron` still works via `require.main === module` check

---

## 4 — Startup Logs

| Component | Log Message |
|-----------|-------------|
| Workers | `[startup] workers initialized` |
| Scheduler | `[startup] cron scheduler started` |
| Polling job | `[intelligence] polling jobs enqueued` `{ count: N }` |
| Worker job | `[intelligence] processing polling job` `job.data` |

---

## 5 — First Polling Execution

- **Logic:** In `startCron()`, before first `runSchedulerCycle()`:
  ```ts
  if (!lastIntelligencePollingEnqueue) {
    lastIntelligencePollingEnqueue = Date.now();
    const result = await enqueueIntelligencePolling();
    console.log(`[intelligence] polling jobs enqueued`, { count: result.enqueued });
  }
  ```
- **Effect:** Intelligence polling enqueues jobs immediately on startup instead of waiting 2 hours

---

## 6 — Database Results (Verification)

To verify the pipeline after a server restart, run:

```sql
SELECT COUNT(*) FROM intelligence_signals;
SELECT COUNT(*) FROM signal_clusters;
SELECT COUNT(*) FROM signal_intelligence;
SELECT COUNT(*) FROM strategic_themes;
SELECT COUNT(*) FROM company_intelligence_signals;
```

**Expected:** Counts increase over time after the pipeline runs (polling → ingestion → clustering → intelligence → themes → company signals).

---

## Execution Flow

```
Server start (npm run dev | npm run start)
    → instrumentation register()
    → startWorkers() — workers initialized
    → startCron() (background)
        → enqueueIntelligencePolling() (first run)
        → runSchedulerCycle()
    → Polling jobs enqueued
    → Workers process jobs
    → Signals ingested → clusters → intelligence → themes
```

---

## Disabling Auto-Start

Set `DISABLE_AUTO_WORKERS=1` to skip auto-start (e.g. when using separate worker/cron processes or Vercel):

```bash
DISABLE_AUTO_WORKERS=1 npm run start
```

---

## Tables Verified

| Table | Purpose |
|-------|---------|
| `intelligence_signals` | Raw signals from external API ingestion |
| `signal_clusters` | Grouped similar signals |
| `signal_intelligence` | Actionable intelligence from clusters |
| `strategic_themes` | Theme cards for campaigns |
| `company_intelligence_signals` | Company-scoped signals |
