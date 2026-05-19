# Security Audit Checklist

Validate before production:

- Setup tokens are hashed and expire.
- Plugin access tokens are hashed server-side.
- Plugin sync replay expiry is enforced.
- Plugin events are idempotent.
- WordPress admin actions require `manage_options`.
- WordPress admin actions validate nonces.
- Tracking origin validation is active.
- Form origin validation is active.
- Worker endpoints require `PUBLISHING_WORKER_SECRET`.
- Diagnostics APIs enforce admin role checks.
- Credentials are encrypted with `credentialEncryption.ts`.
- Audit events are written for token, credential, publishing, and analytics actions.
- Rate limits are active on tracking ingestion.
- Dead-letter jobs are not auto-replayed.
