# Deployment Runbook

## Predeploy

```bash
npm run wi:migrations:validate
npm run wi:security
npm run wi:load:dry
npm run wi:deploy:ready
npm run check
```

Required secrets:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CREDENTIAL_ENCRYPTION_KEY`
- `PUBLISHING_WORKER_SECRET`

## Deploy

1. Apply migrations in order.
2. Deploy web/API application.
3. Start publishing worker.
4. Start reconciliation worker.
5. Package and publish WordPress plugin.
6. Run staging smoke test.

## Smoke Test

1. Create setup token.
2. Connect plugin.
3. Verify heartbeat.
4. Visit public WordPress page.
5. Submit form.
6. Run aggregation.
7. Run reconciliation.
8. Open dashboard.

## Rollback

1. Pause setup-token issuance.
2. Pause workers.
3. Revoke plugin tokens if needed.
4. Revert application deployment.
5. Leave additive tables intact.
