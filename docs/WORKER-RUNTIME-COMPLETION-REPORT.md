# WORKER RUNTIME COMPLETION REPORT (Phase 4.1)

## 1. Files Created

| File | Purpose |
|------|---------|
| `backend/queue/workers/publishWorker.ts` | Entrypoint that starts the publish queue worker via `getWorker('publish', processPublishJob)`. Logs `[publishWorker] started`. Graceful shutdown on SIGINT/SIGTERM. |
| `backend/queue/startWorkers.ts` | Unified bootstrap: starts publish worker and engagement-polling worker in one process. Logs `[workers] publish worker started` and `[workers] engagement polling worker started`. Graceful shutdown closes both workers then process.exit(0). |

## 2. Workers Started

| Worker | Queue | Processor | In publishWorker.ts | In startWorkers.ts |
|--------|-------|-----------|---------------------|--------------------|
| Publish | `publish` | `processPublishJob` | Yes (only) | Yes |
| Engagement polling | `engagement-polling` | `processEngagementPollingJob` (wrapped in `async () => { await processEngagementPollingJob(); }`) | No | Yes |

## 3. Graceful Shutdown Handling

| File | Behavior |
|------|----------|
| `publishWorker.ts` | `process.on('SIGINT', shutdown)` and `process.on('SIGTERM', shutdown)` where `shutdown` is `async () => { await worker.close(); process.exit(0); }`. |
| `startWorkers.ts` | `process.on('SIGINT', shutdown)` and `process.on('SIGTERM', shutdown)` where `shutdown` is `async () => { await publishWorker.close(); await engagementWorker.close(); process.exit(0); }`. |

## 4. How to Run with PM2 (Command Example)

**Option A — Single process (both workers):**
```bash
pm2 start backend/queue/startWorkers.ts --name workers --interpreter ts-node
```

**Option B — Separate processes:**
```bash
pm2 start backend/queue/workers/publishWorker.ts --name publish-worker --interpreter ts-node
pm2 start backend/queue/workers/engagementPollingWorker.ts --name engagement-worker --interpreter ts-node
```

**If using compiled JS (e.g. after `tsc`):**
```bash
pm2 start dist/queue/startWorkers.js --name workers
```

---

*No changes to publishProcessor, engagementPollingProcessor, cron, adapters, queue config, or DB schema.*
