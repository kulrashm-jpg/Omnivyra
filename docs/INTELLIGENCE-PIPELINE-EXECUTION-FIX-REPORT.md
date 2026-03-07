# Intelligence Pipeline Execution Fix — Implementation Report

**Date:** 2026-03-07  
**Scope:** Worker + Queue activation (no architecture changes)

---

## 1 — Scheduler Update

| File | Cron Expression | Job |
|------|-----------------|-----|
| `backend/scheduler/cron.ts` | Every 2 hours (`INTELLIGENCE_POLLING_INTERVAL_MS = 7200000`) | `enqueueIntelligencePolling()` |
| — | *Equivalent cron:* `0 */2 * * *` | Enqueue polling jobs |

**Note:** Cron uses a 60-second cycle that checks `Date.now() - lastIntelligencePollingEnqueue >= 2h`. On first run, `lastIntelligencePollingEnqueue = 0`, so it runs immediately.

---

## 2 — Worker Configuration

| Worker | Job Name | Handler |
|--------|----------|---------|
| `getIntelligencePollingWorker()` | `poll` | `processIntelligencePollingJob()` → `ingestSignals(apiSourceId, companyId, purpose)` |

**Location:**  
- Worker: `backend/workers/intelligencePollingWorker.ts`  
- Queue: `intelligence-polling`  
- Job payload: `{ apiSourceId, companyId?, purpose? }`  
- Enqueue: `backend/scheduler/schedulerService.ts` → `addIntelligencePollingJob()` in `backend/queue/intelligencePollingQueue.ts`

**Note:** The user spec referenced `"poll-intelligence"`; the implementation uses `"poll"`. BullMQ workers process all jobs in the queue regardless of job name.

---

## 3 — Queue Status

| Queue | Pending | Completed |
|-------|---------|-----------|
| intelligence-polling | *Run `npm run intelligence:enqueue` then `npx ts-node backend/scripts/postActivationVerification.ts` to verify* | |

**Manual enqueue:** `npm run intelligence:enqueue`

---

## 4 — Signal Ingestion

| Table | Row Count |
|-------|-----------|
| intelligence_signals | *Verify via post-activation script or `SELECT COUNT(*) FROM intelligence_signals`* |

---

## 5 — Downstream Pipeline

| Table | Row Count |
|-------|-----------|
| signal_clusters | *Verify after clustering runs* |
| signal_intelligence | *Verify after signal intelligence runs* |
| strategic_themes | *Verify after theme engine runs* |
| company_intelligence_signals | *Verify after company distribution runs* |

---

## 6 — Pipeline Execution Status

| Stage | Status |
|-------|--------|
| **Polling** | ✓ `enqueueIntelligencePolling()` enqueues jobs |
| **Ingestion** | ✓ `intelligencePollingWorker` → `ingestSignals()` |
| **Storage** | ✓ Inserts into `intelligence_signals` |
| **Clustering** | ✓ `runSignalClustering()` every 30 min |
| **Signal intelligence** | ✓ `runSignalIntelligenceEngine()` every 1 hr |
| **Theme generation** | ✓ `runStrategicThemeEngine()` every 1 hr |
| **Company distribution** | ✓ Downstream flow to `company_intelligence_signals` |

---

## Changes Implemented

### 1. Enqueue trigger script
- **File:** `backend/scripts/triggerIntelligenceEnqueue.ts`  
- **Purpose:** Manually enqueue intelligence polling jobs  
- **Run:** `npm run intelligence:enqueue`

### 2. npm scripts (package.json)
- `intelligence:enqueue` — triggers `enqueueIntelligencePolling()`
- `start:workers` — alias for `worker:bolt` (starts publish, engagement, bolt, intelligence workers)

### 3. Verified (unchanged)
- `enqueueIntelligencePolling()` in `backend/scheduler/schedulerService.ts` (not `intelligencePollingService.ts`)
- Cron schedules enqueue every 2 hours; runs on first cycle
- Worker in `backend/workers/intelligencePollingWorker.ts` processes `poll` jobs
- `backend/queue/startWorkers.ts` starts `getIntelligencePollingWorker()`

---

## Activation Steps

1. **Start workers (includes intelligence):**  
   `npm run start:workers` or `npm run worker:bolt`

2. **Start cron:**  
   `npm run start:cron`

3. **Optional manual enqueue:**  
   `npm run intelligence:enqueue`

4. **Verify:**  
   `npx ts-node backend/scripts/postActivationVerification.ts`
