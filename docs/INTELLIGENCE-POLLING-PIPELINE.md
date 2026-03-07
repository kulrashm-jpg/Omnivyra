# Intelligence Polling Pipeline

Background polling system that periodically fetches signals from external APIs and stores them in the **Unified Intelligence Signal Store**.

---

## Pipeline flow

```
External API
    ↓
Polling Worker (BullMQ)
    ↓
externalApiService.fetchSingleSourceForIntelligencePolling()
    ↓
Signal normalization (payload → trend items)
    ↓
intelligenceSignalStore.insertFromTrendApiResults()
```

---

## 1. Queue

**File:** `backend/queue/intelligencePollingQueue.ts`  
**Queue name:** `intelligence-polling`

- **Priority:** 1 = HIGH (reliability ≥ 0.8), 5 = MEDIUM (≥ 0.3), 10 = LOW
- **Retry:** 3 attempts, exponential backoff (1 min base)
- **Rate limiting:** Worker concurrency 2, limiter 10 jobs per 60s

**Job payload:**

```ts
{
  apiSourceId: string;
  companyId?: string | null;
  purpose?: string;
}
```

---

## 2. Worker

**File:** `backend/workers/intelligencePollingWorker.ts`

**Responsibilities:**

1. Load API source from `external_api_sources` (by `apiSourceId`)
2. Call `fetchSingleSourceForIntelligencePolling(apiSourceId, companyId)`
3. Send results to `insertFromTrendApiResults(...)` (intelligence signal store)
4. Usage/health are updated inside `fetchSingleSourceForIntelligencePolling` under `userId: 'intelligence-polling'`
5. Log `poll_started` / `poll_completed` / `poll_failed`

**Retry:** 3 attempts, exponential backoff. Transient failures are retried; permanent failures are logged and the job eventually fails.

**Start worker (e.g. in a separate process):**

```ts
import { getIntelligencePollingWorker } from './backend/workers/intelligencePollingWorker';
const worker = getIntelligencePollingWorker();
```

---

## 3. Scheduler

**File:** `backend/scheduler/schedulerService.ts`  
**Function:** `enqueueIntelligencePolling()`

**Behavior (every 2 hours, from cron):**

1. Query `external_api_sources` where `is_active = true`
2. Join `external_api_health` for `reliability_score`
3. Filter: skip if `reliability_score < 0.1` (treated as disabled)
4. Rate limit: skip if for today `external_api_usage.request_count` (user `intelligence-polling`) ≥ `rate_limit_per_min * 120`
5. Assign priority: HIGH (≥0.8) → 1, MEDIUM (≥0.3) → 5, LOW → 10
6. Enqueue one job per source via `addIntelligencePollingJob({ apiSourceId, companyId: null }, { priority })`

**Cron:** `backend/scheduler/cron.ts` calls `enqueueIntelligencePolling()` every 2 hours (`INTELLIGENCE_POLLING_INTERVAL_MS`).

---

## 4. Example job enqueue

**From scheduler (automatic every 2h):**

```ts
import { enqueueIntelligencePolling } from './scheduler/schedulerService';
const result = await enqueueIntelligencePolling();
// result.enqueued, result.skipped, result.reasons.skipped_rate_limit, result.reasons.skipped_disabled
```

**Manual single job:**

```ts
import { addIntelligencePollingJob } from './queue/intelligencePollingQueue';

await addIntelligencePollingJob(
  { apiSourceId: 'uuid-of-source', companyId: null, purpose: 'intelligence_polling' },
  { priority: 1 }
);
```

---

## 5. Example worker log output

**Structured logs (JSON):**

**poll_started**
```json
{"event":"poll_started","apiSourceId":"abc-123","companyId":null,"purpose":"intelligence_polling"}
```

**poll_completed**
```json
{"event":"poll_completed","apiSourceId":"abc-123","duration_ms":1250,"signals_inserted":12,"signals_skipped":0}
```

**poll_failed**
```json
{"event":"poll_failed","apiSourceId":"abc-123","duration_ms":8000,"error":"Request timeout"}
```

**Worker lifecycle:**
```
[intelligence-polling] job intel-poll-abc-123-1709123456789 completed
```
or
```
[intelligence-polling] job intel-poll-abc-123-1709123456789 failed Request timeout
```

---

## Error handling

- **Transient:** HTTP 5xx, 429, network errors → BullMQ retries (3 attempts, exponential backoff).
- **Permanent:** Source not found, missing env, invalid config → job fails after retries; worker does not crash, next job is processed.
- **Store errors:** If `insertFromTrendApiResults` throws, the job fails and is retried.

---

## Existing queues

No changes to existing queues or workers:

- `publish` — unchanged  
- `engagement-polling` — unchanged  
- `lead-jobs` — unchanged  

The intelligence-polling queue and worker are additive.
