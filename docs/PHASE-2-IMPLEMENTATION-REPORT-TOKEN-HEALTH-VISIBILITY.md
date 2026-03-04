# PHASE 2 IMPLEMENTATION REPORT — TOKEN HEALTH & FAILURE VISIBILITY

## 1. Files Modified

| File | Change |
|------|--------|
| `pages/api/accounts.ts` | Import `getConnectionStatus`. For each account in GET response, add `connection_status` (computed from `token_expires_at`). No existing fields removed; auth unchanged. |
| (new) `backend/services/connectionHealthStatus.ts` | Added. Exports `getConnectionStatus(tokenExpiresAt, hasAccessToken?)` and type `ConnectionStatus`. |

## 2. New Endpoint Created

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/super-admin/connection-health` | Returns connection health overview for all active `social_accounts`. Auth: `requireSuperAdminAccess` (same as other super-admin endpoints). Response: `success`, `total_accounts`, `expired_count`, `expiring_soon_count`, `active_count`, `no_token_count`, `accounts[]`. |

## 3. Health Logic Implementation

**Location:** `backend/services/connectionHealthStatus.ts`

**Rules (server-side `Date.now()`):**

- **no_token** — `token_expires_at` is null/empty OR `hasAccessToken === false` (when provided).
- **expired** — `token_expires_at <= now`.
- **expiring_soon** — `token_expires_at` in (now, now + 24h].
- **active** — `token_expires_at > now + 24h`.

**Constants:** 24h = 24 * 60 * 60 * 1000 ms. Invalid or NaN expiry is treated as `no_token`.

**Usage:**

- `/api/accounts`: `getConnectionStatus(row.token_expires_at)` only (no access_token in select); `no_token` when expiry is null.
- `/api/super-admin/connection-health`: selects `access_token` for status only (not returned); `getConnectionStatus(row.token_expires_at, hasAccessToken)` so `no_token` when expiry is null or access_token is null/empty.

## 4. Sample Response Structure

**GET `/api/accounts` (excerpt):**

```json
[
  {
    "platform": "linkedin",
    "account_name": "Jane Doe",
    "username": "jane",
    "follower_count": 100,
    "last_sync_at": "2025-03-01T12:00:00.000Z",
    "token_expires_at": "2025-04-01T00:00:00.000Z",
    "is_active": true,
    "connection_status": "active"
  }
]
```

**GET `/api/super-admin/connection-health`:**

```json
{
  "success": true,
  "total_accounts": 12,
  "expired_count": 2,
  "expiring_soon_count": 1,
  "active_count": 7,
  "no_token_count": 2,
  "accounts": [
    {
      "company_id": "uuid-or-null",
      "user_id": "uuid",
      "platform": "linkedin",
      "account_name": "Acme Corp",
      "token_expires_at": "2025-04-01T00:00:00.000Z",
      "connection_status": "active"
    }
  ]
}
```

`company_id` is resolved from `user_company_roles` (first row per user); null if no role.

## 5. Verified Scenarios

| Scenario | Verification |
|----------|--------------|
| **Active token** | `token_expires_at` > now + 24h → `connection_status: "active"` in both `/api/accounts` and super-admin response. |
| **Expiring soon token** | `token_expires_at` in (now, now + 24h] → `connection_status: "expiring_soon"`; counted in `expiring_soon_count`. |
| **Expired token** | `token_expires_at` <= now → `connection_status: "expired"`; counted in `expired_count`. |
| **Null token** | `token_expires_at` null (and, in super-admin, access_token null/empty) → `connection_status: "no_token"`; counted in `no_token_count`. |
| **Super admin summary counts** | `total_accounts` = length of `accounts`; `expired_count` + `expiring_soon_count` + `active_count` + `no_token_count` = `total_accounts`. |

---

*No changes to publishProcessor, platformAdapter, tokenRefresh, or DB schema. Read-only exposure only.*
