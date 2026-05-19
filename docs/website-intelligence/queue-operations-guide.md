# Queue Operations Guide

Queues:
- `publishing_jobs`
- `reconciliation_jobs`

Operational thresholds:
- Queue lag warning: `> 300s`
- Queue lag critical: `> 900s`
- Dead-letter count critical: `> 0`
- Worker stale critical: no heartbeat for `> 10 minutes`

Commands:

```bash
npm run wi:deploy:ready
npm run wi:load:dry
tsx scripts/run-publishing-worker.ts --limit=5 --worker-id=manual-publisher
```

Admin endpoints:
- `GET /api/admin/website-intelligence/queue-metrics?company_id=<id>`
- `POST /api/admin/website-intelligence/alerts`

Do not requeue dead-letter jobs until the root cause is fixed.
