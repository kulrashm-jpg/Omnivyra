# OmniVyra Social Connection — Post-Production Stabilization

**Document:** Non-blocking enhancements and operational safeguards (G5.4, G2.4)  
**Role:** Platform Reliability Engineer  
**Authority:** `OMNIVYRA-SOCIAL-CONNECTION-PRODUCTION-VERIFICATION.md`  
**Date:** March 2025

---

## Objective

After production approval, implement remaining governance gaps to ensure long-term stability:

1. **G5.4** — Token refresh automation for `community_ai_platform_tokens`
2. **G2.4** — Owner-based connector management (disconnect own connection)

---

## PHASE 1 — Token Refresh Automation (G5.4)

### Problem

`community_ai_platform_tokens` tokens expire without automatic refresh. Users had to reconnect when tokens expired.

### Implementation

| Component | Path | Purpose |
|-----------|------|---------|
| **Service** | `backend/services/connectorTokenRefreshService.ts` | Fetches tokens expiring within 24h, calls platform OAuth refresh endpoints, saves updated tokens via `platformTokenService.saveToken` |
| **Job** | `backend/jobs/connectorTokenRefreshJob.ts` | Wraps service; called by cron every 6 hours |
| **Scheduler** | `backend/scheduler/cron.ts` | `runConnectorTokenRefreshJob()` every `CONNECTOR_TOKEN_REFRESH_INTERVAL_MS` (6h) |

### Supported Platforms

| Platform | Refresh Endpoint | Env Vars |
|----------|------------------|----------|
| LinkedIn | `https://www.linkedin.com/oauth/v2/accessToken` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| Twitter | `https://api.twitter.com/2/oauth2/token` | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` |
| Facebook | `https://graph.facebook.com/v19.0/oauth/access_token` | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` (or `*_APP_*`) |
| Instagram | Same as Facebook (Facebook Graph) | Uses Facebook credentials |
| Reddit | `https://www.reddit.com/api/v1/access_token` | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` |

### Behaviour

- Tokens with `expires_at` within 24 hours are refreshed.
- Tokens without `expires_at` are skipped (e.g. long-lived Facebook tokens).
- Tokens without `refresh_token` are skipped (reconnect required).
- On failure, logs error; does not clear token (user can reconnect manually).

### Verification

```bash
# Manual run (for testing)
node -r ts-node/register -e "
  const { runConnectorTokenRefreshJob } = require('./backend/jobs/connectorTokenRefreshJob');
  runConnectorTokenRefreshJob().then(r => console.log(r));
"
```

---

## PHASE 2 — Owner-Based Connector Management (G2.4)

### Problem

Previously only Company Admin could disconnect. Governance requires: **If user connected the account, they can disconnect; if another user connected it, only Company Admin can disconnect.**

### Implementation

| Change | Path | Purpose |
|--------|------|---------|
| **DB migration** | `database/patch-community-ai-platform-tokens-connected-by-user.sql` | Adds `connected_by_user_id UUID` to `community_ai_platform_tokens` |
| **platformTokenService** | `saveToken(..., { ..., connected_by_user_id? })` | Persists who connected the token |
| **Callbacks** | All 5: `linkedin`, `facebook`, `twitter`, `instagram`, `reddit` | Pass `connected_by_user_id: access.userId` to `saveToken` |
| **Disconnect API** | `pages/api/community-ai/connectors/[platform].ts` | Allow if `COMPANY_ADMIN` / `SUPER_ADMIN` OR `connected_by_user_id === access.userId` |

### Logic

```
if (isAdmin) → allow
else if (connected_by_user_id === access.userId) → allow
else → 403 FORBIDDEN_ROLE
```

For legacy tokens (no `connected_by_user_id`), only admins can disconnect.

### Run Migration

```bash
psql $SUPABASE_DB_URL -f database/patch-community-ai-platform-tokens-connected-by-user.sql
```

---

## Deployment Checklist

- [ ] Run `database/patch-community-ai-platform-tokens-connected-by-user.sql`
- [ ] Ensure cron process runs (`npm run start:cron`) so token refresh job executes
- [ ] Verify env vars for each platform (LINKEDIN_*, FACEBOOK_*, TWITTER_*, REDDIT_*)
- [ ] Confirm `ENCRYPTION_KEY` is set for token encryption

---

## Governance Compliance After Stabilization

| Rule | Before | After |
|------|--------|-------|
| G5.4 Token refresh before expiry | Pending | ✅ Implemented (6h cron) |
| G2.4 Admin sees all; owner can disconnect own | Partial | ✅ Full (owner tracked, owner or admin can disconnect) |

---

**End of Post-Production Stabilization**
