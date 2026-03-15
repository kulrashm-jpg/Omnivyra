# OmniVyra Social Connection — Final Operational Verification

**Document:** Post-stabilization operational verification  
**Role:** Production Operations Engineer  
**Input:** `OMNIVYRA-SOCIAL-CONNECTION-POST-PRODUCTION-STABILIZATION.md`  
**Date:** March 2025

---

## Objective

Confirm that the newly implemented stabilization features function correctly in the live system:

1. **Token refresh automation (G5.4)** — Connector tokens refresh before expiry without manual intervention
2. **Owner-based connector management (G2.4)** — User who connected can disconnect; admin can disconnect any

Verification ensures the system operates reliably without manual intervention.

---

## PHASE 1 — Token Refresh Service Validation

### 1.1 Locate Service

| Item | Path | Status |
|------|------|--------|
| Service | `backend/services/connectorTokenRefreshService.ts` | ✅ Located |
| Job | `backend/jobs/connectorTokenRefreshJob.ts` | ✅ Located |
| Cron wire | `backend/scheduler/cron.ts` (lines 863–879, runConnectorTokenRefreshJob every 6h) | ✅ Located |

### 1.2 Code Verification

| Check | Expected | Pass/Fail |
|-------|----------|-----------|
| Service exports `runConnectorTokenRefresh` | Yes | ✅ Pass |
| Job exports `runConnectorTokenRefreshJob` | Yes | ✅ Pass |
| Cron imports and calls `runConnectorTokenRefreshJob` | Yes | ✅ Pass |
| `CONNECTOR_TOKEN_REFRESH_INTERVAL_MS` = 6h | 21_600_000 ms | ✅ Pass |
| Buffer = 24h before expiry | `isExpiringSoon` checks `expires - now < 24h` | ✅ Pass |
| Platforms supported | linkedin, twitter, facebook, instagram, reddit, x | ✅ Pass |

### 1.3 Manual Run (Pre-Production)

```bash
# From project root
npx ts-node -e "
const { runConnectorTokenRefreshJob } = require('./backend/jobs/connectorTokenRefreshJob');
runConnectorTokenRefreshJob().then(r => {
  console.log('Result:', JSON.stringify(r, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

**Expected:** Returns `{ refreshed, skipped, errors, checked }`; no uncaught exceptions. If no tokens expiring soon, `refreshed=0`, `skipped=N` or `checked=0`.

### 1.4 Cron Execution Check

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start cron: `npm run start:cron` | Process starts; no immediate crash |
| 2 | Wait for scheduler cycle logs | `🔄 Running scheduler cycle at ...` |
| 3 | After 6h (or adjust env for test) | Log line: `✅ Connector token refresh: X refreshed, Y skipped, Z errors` (or no line if nothing to refresh) |
| 4 | If tokens exist and expire soon | `refreshed > 0` in logs |

### 1.5 Environment Variables

| Platform | Required Env Vars | Verified |
|----------|-------------------|----------|
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | |
| Twitter | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | |
| Instagram | Uses Facebook creds | |
| Reddit | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | |
| Global | `ENCRYPTION_KEY` (for decrypt/encrypt) | |

---

## PHASE 2 — Owner-Based Connector Management Validation (G2.4)

### 2.1 Schema Verification

| Check | Expected | Pass/Fail |
|-------|----------|-----------|
| Column exists | `community_ai_platform_tokens.connected_by_user_id UUID` | |
| Migration applied | `database/patch-community-ai-platform-tokens-connected-by-user.sql` run | |

```sql
-- Verify column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'community_ai_platform_tokens' AND column_name = 'connected_by_user_id';
```

### 2.2 Code Path Verification

| Item | Path | Check |
|------|------|-------|
| saveToken accepts connected_by_user_id | `platformTokenService.ts` | TokenInput includes it; payload persists it |
| Callbacks pass userId | linkedin, facebook, twitter, instagram, reddit callbacks | `connected_by_user_id: access!.userId` |
| getConnectorConnectedByUserId | `platformTokenService.ts` | Returns `connected_by_user_id` for row |
| Disconnect logic | `pages/api/community-ai/connectors/[platform].ts` | Admin OR owner allowed |

### 2.3 Functional Test — Owner Disconnect

| Step | Action | Expected |
|------|--------|----------|
| 1 | Login as **CONTENT_PUBLISHER** (non-admin) with MANAGE_CONNECTORS | Success |
| 2 | Connect a platform (e.g. LinkedIn) via `/community-ai/connectors` | Connected; `connected_by_user_id` set in DB |
| 3 | As same user, click **Disconnect** | 200 OK; token revoked |
| 4 | Verify status shows Not connected | Pass |

### 2.4 Functional Test — Non-Owner Disconnect (Blocked)

| Step | Action | Expected |
|------|--------|----------|
| 1 | User A (CONTENT_PUBLISHER) connects LinkedIn | Connected |
| 2 | User B (CONTENT_PUBLISHER) attempts Disconnect | 403 FORBIDDEN_ROLE |
| 3 | Message contains "Only Company Admin or the user who connected" | Pass |

### 2.5 Functional Test — Admin Disconnect

| Step | Action | Expected |
|------|--------|----------|
| 1 | User A connects platform | Connected |
| 2 | User B (COMPANY_ADMIN) clicks Disconnect | 200 OK; token revoked |

### 2.6 Legacy Token (No connected_by_user_id)

| Scenario | Expected |
|----------|----------|
| Token row has `connected_by_user_id = NULL` | Only Company Admin can disconnect |
| Non-admin cannot disconnect | 403 |

---

## PHASE 3 — End-to-End Reliability

### 3.1 Token Refresh → Owner Disconnect Flow

| Step | Action | Expected |
|------|--------|----------|
| 1 | Connect LinkedIn (token has expires_at) | Stored with connected_by_user_id |
| 2 | Simulate or wait until token near expiry (e.g. set expires_at to now + 12h) | — |
| 3 | Cron runs connector token refresh | Token refreshed; new expires_at |
| 4 | As connector owner, disconnect | 200 OK |

### 3.2 No Manual Intervention

| Check | Pass/Fail |
|-------|-----------|
| Token refresh runs automatically every 6h | |
| Owner can disconnect without admin | |
| Admin can always disconnect | |
| Audit log entries for connect/disconnect | |

---

## PHASE 4 — Verdict

| Feature | Verified | Notes |
|---------|----------|-------|
| G5.4 Token refresh automation | | |
| G2.4 Owner-based disconnect | | |
| Cron integration | | |
| Schema migration applied | | |
| Env vars configured | | |

### Conclusion

**Operational verification:** PASS / FAIL

---

## Sign-Off

| Role | Name | Date |
|------|------|------|
| Production Operations Engineer | | |

---

**End of Operational Verification**
