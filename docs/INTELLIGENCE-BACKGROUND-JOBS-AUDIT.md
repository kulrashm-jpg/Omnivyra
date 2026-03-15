# INTELLIGENCE BACKGROUND JOBS AUDIT

**Background Job Infrastructure Verification**

---

## 1 Ingestion Workers

| Check | Value |
|-------|-------|
| Worker name | `intelligencePollingWorker` |
| Queue name | `intelligence-polling` |
| Queue file | `backend/queue/intelligencePollingQueue.ts` |
| Worker entry file | `backend/workers/intelligencePollingWorker.ts` |
| Worker factory | `getIntelligencePollingWorker()` |
| Job processor | `ingestSignals()` via `intelligenceIngestionModule` |
| Trigger schedule | Cron calls `enqueueIntelligencePolling()` every 2 hours (`INTELLIGENCE_POLLING_INTERVAL_MS`) |
| Jobs enqueued by | `schedulerService.enqueueIntelligencePolling()` |
| Cron entry | `backend/scheduler/cron.ts` |

---

## 2 Clustering Workers

| Check | Value |
|-------|-------|
| Scheduled function | `runSignalClustering()` |
| Implementation | `clusterRecentSignals()` from `signalClusterEngine` |
| Entry point | `schedulerService.runSignalClustering()` |
| Schedule interval | Every 30 minutes (`SIGNAL_CLUSTERING_INTERVAL_MS = 30 * 60 * 1000`) |
| Mechanism | Cron (not BullMQ) |
| Cron entry | `backend/scheduler/cron.ts` |

---

## 3 Signal Intelligence Workers

| Check | Value |
|-------|-------|
| Scheduled function | `runSignalIntelligenceEngine()` |
| Implementation | `generateSignalIntelligence()` from `signalIntelligenceEngine` |
| Entry point | `schedulerService.runSignalIntelligenceEngine()` |
| Schedule interval | Every 1 hour (`SIGNAL_INTELLIGENCE_INTERVAL_MS = 60 * 60 * 1000`) |
| Mechanism | Cron (not BullMQ) |
| Cron entry | `backend/scheduler/cron.ts` |

---

## 4 Graph Build Workers

| Check | Value |
|-------|-------|
| Function | `buildGraphForCompanySignals(companyId, windowHours)` |
| Location | `backend/services/intelligenceGraphEngine.ts` |
| Cron job | **No** |
| Queue worker | **No** |
| Trigger | **Manual only** — via API when `?buildGraph=true` on opportunities or recommendations endpoints |

---

## 5 Orchestration Workers

| Component | Scheduled | API Request Only |
|-----------|-----------|------------------|
| `opportunityDetectionEngine.detectOpportunities` | No | Yes — called by `getOpportunitiesForCompany()` |
| `strategicRecommendationEngine.opportunitiesToRecommendations` | No | Yes — called by `getRecommendationsForCompany()` |

**Note:** `campaignOpportunityEngine` (scheduled hourly) is distinct from `opportunityDetectionEngine`. The former converts strategic themes → campaign opportunities; the latter is Phase 3 company insights → opportunities and runs only on API request.

---

## 6 Worker Bootstrap

| Check | Value |
|-------|-------|
| Worker startup | `backend/queue/startWorkers.ts` → `startWorkers()` |
| Cron startup | `backend/scheduler/cron.ts` → `startCron()` |
| Environment variable | `ENABLE_AUTO_WORKERS` — when `1` or `true`, `instrumentation.ts` imports and runs `startWorkers()` + `startCron()` on Next.js server start |
| Default | Workers disabled when `ENABLE_AUTO_WORKERS` not set |
| Standalone workers | `npm run start:workers` → `npx ts-node --transpile-only backend/queue/startWorkers.ts` |
| Standalone cron | `npm run start:cron` → `node -r ts-node/register backend/scheduler/cron.ts` |

| Workers started by startWorkers.ts | Queue |
|------------------------------------|-------|
| Publish | `jobQueue` (publish jobs) |
| Bolt execution | `boltQueue` |
| Engagement polling | `engagement-polling` |
| Intelligence polling | `intelligence-polling` |

---

## 7 Operational Gaps

1. **Graph build not scheduled** — No cron or queue job for `buildGraphForCompanySignals`. Runs only when API called with `?buildGraph=true`.

2. **Orchestration (Phase 3) on-demand only** — `opportunityDetectionEngine` and `strategicRecommendationEngine` execute solely in response to API calls (`/api/intelligence/opportunities`, `/api/intelligence/recommendations`). No background job.

3. **Correlation engine** — `detectCorrelations` runs only on API request (`/api/intelligence/correlations`). No scheduled execution.

4. **Worker/cron separation** — Workers and cron are separate processes. Both can auto-start via `ENABLE_AUTO_WORKERS`, but cron must be running for clustering and signal intelligence to execute on schedule.

---

**Audit complete.** Only existing infrastructure reported.
