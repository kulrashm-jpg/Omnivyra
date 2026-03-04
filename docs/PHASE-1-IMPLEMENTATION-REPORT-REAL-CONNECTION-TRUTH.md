# PHASE 1 IMPLEMENTATION REPORT — REAL CONNECTION TRUTH LAYER

## 1. Files Modified

| File | Change |
|------|--------|
| `pages/api/accounts.ts` | GET now authenticates user and queries `social_accounts` for that user; returns real list; mock behavior removed. |
| `pages/api/accounts/[platform].ts` | DELETE now finds account by user_id + platform, sets `is_active = false` and clears token columns, returns 404 if not found. |
| `pages/community-ai/connectors.tsx` | Loads connector state from GET `/api/community-ai/connectors/status` on mount and after OAuth redirect; disconnect calls DELETE API then refetches status; Disconnect enabled when connected or expired. |

## 2. New APIs Created

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/community-ai/connectors/status` | Returns real connection status from `community_ai_platform_tokens` for tenant_id/organization_id. Query params: `tenant_id`, `organization_id`. Auth: `requireManageConnectors`. Response: array of `{ platform, expires_at, connected: true }` for rows with a token. |
| DELETE | `/api/community-ai/connectors/[platform]` | Revokes token via `platformTokenService.revokeToken(tenant_id, organization_id, platform)`. Query params: `tenant_id`, `organization_id`. Auth: `requireManageConnectors`. Response: `{ success: true, message: 'Account disconnected' }`. |

## 3. Behavior Before vs After

### Part 1 — `/api/accounts`

| Aspect | Before | After |
|--------|--------|--------|
| GET | Returned empty array unless query had `connected`, `account`, `mock`; then returned one mock item. Did not query DB. | Requires authenticated user (cookie/Authorization). Queries `social_accounts` WHERE `user_id = current_user.id` AND `is_active = true`. Returns array of `{ platform, account_name, username, follower_count, last_sync_at, token_expires_at, is_active }`. |
| Mock | Yes (query-param driven). | Removed. |

### Part 2 — DELETE `/api/accounts/[platform]`

| Aspect | Before | After |
|--------|--------|--------|
| DELETE | Logged and returned 200 with message; no DB change. | Authenticates user. Finds `social_accounts` where `user_id = current_user.id` and platform matches (canonical key, e.g. twitter/x). If not found → 404. Updates row: `is_active = false`, `access_token = null`, `refresh_token = null`, `token_expires_at = null`. Returns `{ success: true, message: 'Account disconnected' }`. Row not hard-deleted. |

### Part 3 — Community AI connectors page

| Aspect | Before | After |
|--------|--------|--------|
| Source of truth | Local state only; initial state all "disconnected"; "connected" only from query params after OAuth redirect. | On mount (and when `tenant_id` changes), fetches GET `/api/community-ai/connectors/status`. State built from DB: each platform in display list gets `status: 'connected'` and `expires_at` if API returns an entry for that platform; otherwise `status: 'disconnected'`. |
| Expired | Not derived from DB. | If token exists and `expires_at < now`, `resolveStatus` returns `'expired'`; UI shows "Expired". |
| After OAuth redirect | Set one platform to "connected" in state from query params. | On `connected` + `status=success` in query, calls `fetchStatus()` so state is refreshed from DB. |

### Part 4 — Community AI disconnect

| Aspect | Before | After |
|--------|--------|--------|
| Disconnect action | `handleDisconnect` only updated local state to "disconnected". | Calls DELETE `/api/community-ai/connectors/[platform]?tenant_id=&organization_id=` with credentials. On success, calls `fetchStatus()` to reload state from DB. |
| Revoke in DB | No. | Yes; DELETE handler calls `platformTokenService.revokeToken(tenant_id, organization_id, platform)`, which nulls `access_token`, `refresh_token`, `expires_at` in `community_ai_platform_tokens`. |

## 4. Verified Scenarios

| Scenario | Verification |
|----------|--------------|
| **Connect → visible in UI** | After user completes OAuth for a Community AI connector, callback saves token via `platformTokenService.saveToken`. Connectors page either refetches on `connected`+`status=success` or user refreshes; GET `/api/community-ai/connectors/status` returns that platform with `connected: true`; UI shows Connected (or Expired if `expires_at` in past). |
| **Disconnect → removed from DB + UI** | User clicks Disconnect; DELETE `/api/community-ai/connectors/[platform]` runs and calls `revokeToken`, clearing token columns. Then `fetchStatus()` runs; status API returns only rows with non-null `access_token`, so revoked platform is no longer in the list; UI merges and shows that platform as "Not connected". |
| **Page refresh → state persists correctly** | Connectors page fetches status on mount. After refresh, same GET status runs; state is built from DB only. No dependency on query params for initial state. |
| **Expired token shows expired state** | Status API returns `expires_at` for connected platforms. In connectors.tsx, `resolveStatus(record)` returns `'expired'` when `record.status === 'connected'` and `record.expires_at` is in the past. UI shows "Expired" and Disconnect remains enabled. |

---

*No changes were made to publishProcessor, platformAdapter, tokenRefresh, or DB schema. Auth and error response patterns match existing community-ai endpoints.*
