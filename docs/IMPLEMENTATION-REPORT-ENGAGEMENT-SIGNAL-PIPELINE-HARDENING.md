# Implementation Report: Production Hardening — Engagement Signal Pipeline

**Date:** March 12, 2025  
**Objective:** Stabilize and operationalize the campaign engagement signal system for production.

---

## 1. FILES CREATED

| File | Purpose |
|------|---------|
| `backend/jobs/engagementSignalScheduler.ts` | Runs collectors every 15 min; prevents overlapping; queries activities with external_post_id |
| `backend/jobs/engagementSignalArchiveJob.ts` | Archives signals older than 180 days to _archive table |
| `backend/services/engagementScoreService.ts` | `calculateEngagementScore(signal)` — base scores by type + sentiment + author influence + thread depth |
| `backend/services/engagementSignalIntegrityService.ts` | `validateSignal(activityId)`, `verifyPostMapping(external_post_id)` |
| `backend/utils/rateLimiter.ts` | Per-platform rate limits: LinkedIn 60/min, Twitter 75/min, community 120/min |
| `backend/queue/engagementSignalQueue.ts` | BullMQ queue; batch size 50; scoring + insert |
| `pages/api/admin/engagement-signal-health.ts` | GET admin endpoint: signalsCollectedLast24h, signalsByPlatform, collectorErrors, lastRunTime, queueSize |
| `pages/api/engagement/signal/status.ts` | PATCH: update signal_status (new, reviewed, actioned, ignored) |
| `pages/admin/engagement-health.tsx` | Admin dashboard: collection status, platform breakdown, errors |
| `database/engagement_signal_deduplication.sql` | Unique index on (platform, source_id); optional RPC |
| `database/engagement_signal_lifecycle_and_archive.sql` | signal_status column; campaign_activity_engagement_signals_archive table |

---

## 2. FILES MODIFIED

| File | Changes |
|------|---------|
| `backend/services/engagementSignalCollector.ts` | Rate limiter; per-row insert with 23505 catch for dedup |
| `backend/scheduler/cron.ts` | Added engagement signal scheduler (15 min); archive job (nightly) |
| `pages/api/engagement/campaign-signals.ts` | Include signal_status in response |
| `pages/engagement-inbox.tsx` | Status dropdown; PATCH to update status |

---

## 3. DATABASE MIGRATIONS

| Migration | Purpose |
|-----------|---------|
| `engagement_signal_deduplication.sql` | Unique index on (platform, source_id) WHERE source_id IS NOT NULL |
| `engagement_signal_lifecycle_and_archive.sql` | signal_status column; campaign_activity_engagement_signals_archive table |

---

## 4. NEW JOBS

| Job | Interval | Purpose |
|-----|----------|---------|
| `runEngagementSignalScheduler` | 15 min | Run collectors for activities with external_post_id |
| `archiveOldSignals` | Nightly | Move signals &gt; 180 days to archive |

---

## 5. NEW QUEUES

| Queue | Purpose |
|-------|---------|
| `engagement-signals` (BullMQ) | Batch process signals (scoring + insert); batch size 50 |

---

## 6. NEW SERVICES

| Service | Functions |
|---------|-----------|
| `engagementScoreService` | `calculateEngagementScore(signal)` — base + sentiment + author influence + thread depth |
| `engagementSignalIntegrityService` | `validateSignal(activityId)`, `verifyPostMapping(external_post_id)` |
| `rateLimiter` | `checkRateLimit(platform)`, `withRateLimit(platform, fn)` |

---

## 7. NEW ADMIN APIs

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/engagement-signal-health` | Collection status, platform breakdown, errors, lastRunTime, queueSize |
| PATCH | `/api/engagement/signal/status` | Update signal_status |

---

## 8. NEW ADMIN UI

| Page | Purpose |
|------|---------|
| `pages/admin/engagement-health.tsx` | Dashboard: signals 24h, queue size, last run, platform breakdown, errors |

---

## 9. DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                    ENGAGEMENT SIGNAL PIPELINE (PRODUCTION HARDENING)                       │
└─────────────────────────────────────────────────────────────────────────────────────────┘

  CRON (15 min)                         COLLECTORS                          STORAGE
  ─────────────                         ──────────                          ───────

  engagementSignalScheduler
  (overlap prevention)
        │
        │ Query: daily_content_plans
        │   WHERE external_post_id IS NOT NULL
        ▼
  ┌─────────────────┐
  │ rateLimiter     │  LinkedIn: 60/min  Twitter: 75/min  Community: 120/min
  └────────┬────────┘
           │
           ▼
  collectLinkedInSignals ──┐
  collectTwitterSignals ───┼──▶ insertSignals (per-row, 23505 = skip dupe)
  collectCommunitySignals ─┘
           │
           ▼
  campaign_activity_engagement_signals
  (unique index: platform, source_id)
           │
           │ engagementScoreService.calculateEngagementScore
           │ (optional: via engagementSignalQueue)
           │
           ▼
  signal_status: new | reviewed | actioned | ignored
           │
           │ archiveOldSignals (nightly, 180 days)
           ▼
  campaign_activity_engagement_signals_archive
```

---

## 10. MIGRATION STEPS

1. Run [`database/engagement_signal_deduplication.sql`](../database/engagement_signal_deduplication.sql)
2. Run [`database/engagement_signal_lifecycle_and_archive.sql`](../database/engagement_signal_lifecycle_and_archive.sql)
3. Ensure cron is running (`npm run start:cron` or equivalent)
