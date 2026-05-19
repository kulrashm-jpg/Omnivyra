# Website Intelligence Troubleshooting Guide

## Plugin Will Not Connect

Check:
- Setup token has not expired.
- Setup token belongs to the expected domain.
- WordPress server can reach the Omnivera API base URL.
- Site admin has `manage_options`.

Action:
- Generate a new setup token and reconnect.

## Tracking Not Detected

Check:
- Tracking enabled in plugin settings.
- Manual tracker override is off.
- Current path is not excluded.
- Admin exclusion is not hiding tracking for logged-in admin visits.
- Domain enforcement allows the origin.

Action:
- Visit the public site in a private browser and run Refresh ops in Omnivera.

## Publishing Drift

Check:
- `publish_integrity_status`.
- Recent reconciliation attempts.
- External WordPress post status and permalink.

Action:
- Run reconciliation.
- Republish if Omnivera should overwrite the external state.

## Attribution Missing

Check:
- Tracking event has session/anonymous ID.
- Form submission includes hidden attribution metadata.
- Aggregation job has run.

Action:
- Submit a test form and run form aggregation.
