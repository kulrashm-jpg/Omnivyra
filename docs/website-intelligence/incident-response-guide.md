# Incident Response Guide

Severity:
- Critical: token compromise, queue dead letters, stale workers, widespread ingestion failure.
- Warning: plugin heartbeat stale, drift detected, attribution delay.
- Info: setup incomplete or no recent data on a new website.

Response:
1. Identify affected company and website.
2. Open admin diagnostics and alerts.
3. Inspect audit events.
4. Check worker health and queue metrics.
5. Contain by pausing workers or revoking plugin tokens.
6. Recover with low-limit worker runs.
7. Document validation artifacts in `website_intelligence_validation_runs`.
