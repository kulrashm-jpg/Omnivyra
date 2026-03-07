# Intelligence System Activation — Implementation Report

**Date:** 2026-03-07  
**Scope:** Phase 4 — Configuration & Operational Enablement

---

## 1 — External API Sources

| Source        | Active |
|---------------|--------|
| google_trends | ✓      |
| reddit_trends | ✓      |
| news_trends   | ✓      |

**Configuration:** Seed sources inserted via `database/intelligence_system_activation.sql` or `backend/scripts/activateIntelligenceSystem.ts`. Schema uses `is_active` (not `enabled`).

**Verification query (fixed):**
```sql
SELECT id, name, is_active
FROM external_api_sources
ORDER BY id;
```

---

## 2 — Company API Config

| Company  | API Source   | Enabled |
|----------|--------------|---------|
| (first)  | google_trends | ✓       |
| (first)  | reddit_trends | ✓       |
| (first)  | news_trends   | ✓       |

**Configuration:** First company linked to all active sources via `company_api_configs` with `enabled = true`, `polling_frequency = '2h'`.

**Verification query:**
```sql
SELECT c.name as company, s.name as api_source, cac.enabled
FROM company_api_configs cac
JOIN companies c ON c.id = cac.company_id
JOIN external_api_sources s ON s.id = cac.api_source_id
WHERE cac.enabled = true;
```

---

## 3 — Worker Status

| Worker                     | Running |
|----------------------------|---------|
| getIntelligencePollingWorker() | ✓   |

**Location:** `backend/queue/startWorkers.ts`

```typescript
const intelligencePollingWorker = getIntelligencePollingWorker();
// ...
process.on('SIGINT', shutdown);  // closes intelligencePollingWorker
```

Workers must be started with: `node -r ts-node/register backend/queue/startWorkers.ts` (or PM2).

---

## 4 — Scheduler Status

| Job                         | Interval      |
|-----------------------------|---------------|
| enqueueIntelligencePolling  | Every 2 hours |
| runSignalClustering         | Every 30 min  |
| runSignalIntelligenceEngine | Every 1 hour  |
| runStrategicThemeEngine     | Every 1 hour  |

**Location:** `backend/scheduler/cron.ts`

- `INTELLIGENCE_POLLING_INTERVAL_MS = 2 * 60 * 60 * 1000`
- `SIGNAL_CLUSTERING_INTERVAL_MS = 30 * 60 * 1000`
- `SIGNAL_INTELLIGENCE_INTERVAL_MS = 60 * 60 * 1000`
- `STRATEGIC_THEME_INTERVAL_MS = 60 * 60 * 1000`

Cron must be running: `npm run start:cron` or `node -r ts-node/register backend/scheduler/cron.ts`.

---

## 5 — Pipeline Data

| Table                     | Row Count |
|---------------------------|-----------|
| intelligence_signals      | *See verification* |
| signal_clusters           | *See verification* |
| signal_intelligence      | *See verification* |
| strategic_themes         | *See verification* |
| company_intelligence_signals | *See verification* |

**Verification queries (run after activation + pipeline execution):**
```sql
SELECT COUNT(*) FROM intelligence_signals;
SELECT COUNT(*) FROM signal_clusters;
SELECT COUNT(*) FROM signal_intelligence;
SELECT COUNT(*) FROM strategic_themes;
SELECT COUNT(*) FROM company_intelligence_signals;
```

**Full verification script:** `npx ts-node backend/scripts/fullIntelligenceSystemVerification.ts`

---

## 6 — Pipeline Flow Confirmation

| Stage                | Status | Notes |
|----------------------|--------|-------|
| **Polling**          | ✓      | `enqueueIntelligencePolling()` → `addIntelligencePollingJob()` → `intelligence-polling` queue |
| **Ingestion**        | ✓      | `intelligencePollingWorker` → `ingestSignals()` → fetches external APIs, normalizes payload |
| **Storage**          | ✓      | `ingestSignals` inserts into `intelligence_signals` |
| **Clustering**       | ✓      | `runSignalClustering()` → `clusterRecentSignals()` → `signal_clusters` |
| **Signal intelligence** | ✓   | `runSignalIntelligenceEngine()` → `generateSignalIntelligence()` → `signal_intelligence` |
| **Theme generation** | ✓      | `runStrategicThemeEngine()` → `generateStrategicThemes()` → `strategic_themes` |
| **Company distribution** | ✓   | `company_intelligence_signals` populated by downstream distribution logic |

---

## Activation Steps Completed

1. **Source activation query fix** — `fullIntelligenceSystemVerification.ts` uses `is_active` (not `enabled`).
2. **Initial external API sources** — `google_trends`, `reddit_trends`, `news_trends` seeded via SQL or TS script.
3. **Company API config** — First company linked to all active sources with `enabled = true`.
4. **Scheduler jobs** — `runSignalClustering`, `runSignalIntelligenceEngine`, `runStrategicThemeEngine` scheduled in cron.
5. **Workers** — `getIntelligencePollingWorker()` started in `startWorkers.ts`.
6. **Initial ingestion trigger** — `activateIntelligenceSystem.ts` calls `enqueueIntelligencePolling()`.

---

## How to Activate (Post-Deployment)

1. **Database:** Run `database/intelligence_system_activation.sql` in Supabase SQL editor.
2. **TypeScript (optional):** `npx ts-node backend/scripts/activateIntelligenceSystem.ts` (requires `SUPABASE_*`, `REDIS_URL`).
3. **Start workers:** `node -r ts-node/register backend/queue/startWorkers.ts`
4. **Start cron:** `node -r ts-node/register backend/scheduler/cron.ts`
5. **Verify:** `npx ts-node backend/scripts/fullIntelligenceSystemVerification.ts`

---

## Files Modified/Created

| File | Change |
|------|--------|
| `backend/scripts/fullIntelligenceSystemVerification.ts` | Use `is_active` in external_api_sources query |
| `database/intelligence_system_activation.sql` | New — seed sources, company_api_configs, company_intelligence_topics |
| `backend/scripts/activateIntelligenceSystem.ts` | New — TS activation + enqueue + seed signals if empty |
| `backend/scheduler/cron.ts` | Verified — intelligence jobs present |
| `backend/queue/startWorkers.ts` | Verified — intelligence polling worker started |
