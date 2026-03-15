# OmniVyra Social Connection — Database Schema Validation

**Document:** Database reliability validation for `community_ai_platform_tokens`  
**Role:** Database Reliability Engineer  
**Input:** `database/deploy-community-ai-platform-tokens.sql`  
**Date:** March 2025

---

## Objective

Confirm that the `community_ai_platform_tokens` table and the **G2.4 ownership column** have been deployed correctly and safely in the production database.

Verification criteria:

- Table exists
- Ownership column exists
- Indexes exist
- Schema is compatible with connector token refresh service
- Schema supports owner-based disconnect logic

---

## PHASE 1 — Table Existence Verification

**Run the following query:**

```sql
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'community_ai_platform_tokens'
) AS table_exists;
```

**Expected:** `table_exists` = `true`

---

## PHASE 2 — Column Verification

**Run the following query:**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'community_ai_platform_tokens'
ORDER BY ordinal_position;
```

**Expected columns:**

| column_name         | data_type      | is_nullable |
|---------------------|----------------|-------------|
| id                  | uuid           | NO          |
| tenant_id           | uuid           | NO          |
| organization_id    | uuid           | NO          |
| platform           | text           | NO          |
| access_token       | text           | YES         |
| refresh_token      | text           | YES         |
| expires_at         | timestamp without time zone | YES |
| created_at         | timestamp without time zone | YES |
| updated_at         | timestamp without time zone | YES |
| **connected_by_user_id** | uuid | YES |

**Critical:** `connected_by_user_id` must be present for G2.4 owner-based disconnect.

---

## PHASE 3 — Index Verification

**Run the following query:**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'community_ai_platform_tokens'
ORDER BY indexname;
```

**Expected indexes (at minimum):**

| indexname | Purpose |
|-----------|---------|
| community_ai_platform_tokens_pkey | Primary key on id |
| idx_community_ai_platform_tokens_tenant_id | Lookup by tenant |
| idx_community_ai_platform_tokens_organization_id | Lookup by org |
| idx_community_ai_platform_tokens_platform | Lookup by platform |
| idx_community_ai_platform_tokens_connected_by | G2.4 owner lookup (partial: WHERE connected_by_user_id IS NOT NULL) |

---

## PHASE 4 — Service Compatibility Check

The connector token refresh service (`connectorTokenRefreshService.ts`) expects:

| Column | Required | Used for |
|--------|----------|----------|
| id | Yes | Row identity |
| tenant_id | Yes | Org scope |
| organization_id | Yes | Org scope |
| platform | Yes | Platform filter |
| access_token | Yes | Encrypted token |
| refresh_token | Yes | OAuth refresh |
| expires_at | Yes | Refresh eligibility (`isExpiringSoon`) |

The platform token service (`platformTokenService.ts`) expects:

| Column | Required | Used for |
|--------|----------|----------|
| connected_by_user_id | Yes (G2.4) | Owner-based disconnect (`getConnectorConnectedByUserId`) |

**Verification:** Ensure all columns exist per Phase 2. If any are missing, re-run the deployment script.

---

## PHASE 5 — Owner-Based Disconnect Support

The disconnect API (`[platform].ts`) uses `getConnectorConnectedByUserId(tenant_id, organization_id, platform)` which queries:

```sql
SELECT connected_by_user_id
FROM community_ai_platform_tokens
WHERE tenant_id = $1 AND organization_id = $2 AND platform = $3;
```

**Verification:** `connected_by_user_id` column must exist and be of type `uuid` (nullable). Legacy rows may have `NULL`; new connections will store the connecting user's ID.

---

## One-Shot Validation Script

Run the bundled validation script against your database:

```bash
psql $SUPABASE_DB_URL -f database/validate-community-ai-platform-tokens.sql
```

Or in Supabase SQL Editor: paste and run the contents of `database/validate-community-ai-platform-tokens.sql`.

---

## Validation Result Checklist

| Check | Pass/Fail | Notes |
|-------|-----------|-------|
| Table exists | | |
| All required columns present | | |
| connected_by_user_id exists (G2.4) | | |
| All indexes created | | |
| Schema compatible with refresh service | | |
| Schema supports owner-based disconnect | | |

### Conclusion

**Database validation:** PASS / FAIL

---

## Sign-Off

| Role | Name | Date |
|------|------|------|
| Database Reliability Engineer | | |

---

**End of Database Validation**
