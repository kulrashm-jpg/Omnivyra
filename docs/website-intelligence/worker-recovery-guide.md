# Worker Recovery Guide

## Publishing Worker

1. Check `worker_health` for stale heartbeat.
2. Check `queue_metrics` for lag and dead letters.
3. Run one manual worker pass with low limit.
4. Inspect failed job categories.
5. Restart scheduled worker.

## Reconciliation Worker

1. Check `reconciliation_jobs` for `retrying` or `dead_letter`.
2. Verify WordPress credentials and plugin heartbeat.
3. Run one reconciliation pass.
4. Review `publish_integrity_status`.

Stale processing jobs are recovered by lock expiry. Default recovery returns jobs to `retrying`.
