# Social Platform Integration Layer — Implementation Report

**Date:** 2025-03-10  
**Scope:** Safe architectural cleanup — registry, capability mapping, connection testing, adapter-based ingestion.

---

## FILES_CREATED

| File | Description |
|------|-------------|
| `database/platform_registry.sql` | platform_registry table with seed data for 7 platforms |
| `database/platform_connectors.sql` | platform_connectors table with FK to platform_registry |
| `backend/services/platformRegistryService.ts` | getSupportedPlatforms, getPlatformCapabilities, validatePlatformKey |
| `backend/services/platformConnectorService.ts` | getConnector, storeConnector, updateConnector |
| `backend/services/platformAdapters/baseAdapter.ts` | IPlatformAdapter interface (publishContent, replyToComment, likeComment, fetchComments, testConnection) |
| `backend/services/platformAdapters/linkedinAdapter.ts` | LinkedIn implementation |
| `backend/services/platformAdapters/twitterAdapter.ts` | Twitter/X implementation |
| `backend/services/platformAdapters/youtubeAdapter.ts` | YouTube implementation |
| `backend/services/platformAdapters/redditAdapter.ts` | Reddit implementation |
| `backend/services/platformAdapters/index.ts` | getPlatformAdapter resolver |
| `pages/api/social-platforms/test-connection.ts` | POST /api/social-platforms/test-connection |
| `pages/api/social-platforms/registry.ts` | GET /api/social-platforms/registry |

---

## FILES_MODIFIED

| File | Changes |
|------|---------|
| `pages/social-platforms.tsx` | Platform dropdown from registry, auto-fill base_url and capabilities, Test Connection button |
| `backend/constants/platforms.ts` | Added reddit, facebook, tiktok to CANONICAL_PLATFORMS; aligned PLATFORM_LABELS |
| `backend/services/engagementIngestionService.ts` | fetchCommentsWithAdapterFallback: tries adapter first, falls back to legacy fetchers; added normalizeYouTubeComments, normalizeRedditComments |

---

## DATABASE_SCHEMA

### platform_registry

| Column | Type | Notes |
|--------|------|-------|
| platform_key | TEXT | PK |
| platform_label | TEXT | Display name |
| api_base_url | TEXT | Platform API base |
| auth_type | TEXT | Default oauth |
| supports_publishing | BOOLEAN | |
| supports_replies | BOOLEAN | |
| supports_comments | BOOLEAN | |
| supports_threads | BOOLEAN | |
| supports_video | BOOLEAN | |
| supports_ingestion | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

**Seed platforms:** linkedin, twitter, youtube, reddit, facebook, instagram, tiktok

### platform_connectors

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| organization_id | UUID | |
| platform_key | TEXT | FK → platform_registry(platform_key) |
| account_id | TEXT | |
| access_token | TEXT | |
| refresh_token | TEXT | |
| expires_at | TIMESTAMPTZ | |
| active | BOOLEAN | Default true |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Unique:** (organization_id, platform_key)

---

## PLATFORM_REGISTRY

- **Service:** `platformRegistryService.ts`
- **Functions:** `getSupportedPlatforms()`, `getPlatformCapabilities(platformKey)`, `validatePlatformKey(platformKey)`
- **Fallback:** In-memory `FALLBACK_REGISTRY` when table does not exist (pre-migration)
- **API:** `GET /api/social-platforms/registry` returns `{ platforms: [...] }`

---

## CONNECTOR_SYSTEM

- **Service:** `platformConnectorService.ts`
- **Functions:** `getConnector(organizationId, platformKey)`, `storeConnector(config)`, `updateConnector(config)`
- **Validation:** `platform_key` validated via `validatePlatformKey` before insert/update
- **Backward compatibility:** `community_ai_platform_tokens` and `social_accounts` unchanged; new connector system is additive

---

## ADAPTER_LAYER

- **Interface:** `IPlatformAdapter` in `baseAdapter.ts`
- **Methods:** `publishContent`, `replyToComment`, `likeComment`, `fetchComments`, `testConnection`
- **Implementations:** linkedinAdapter, twitterAdapter, youtubeAdapter, redditAdapter
- **Resolver:** `getPlatformAdapter(platformKey)` in `platformAdapters/index.ts`
- **Alias:** `x` → `twitter`

---

## INGESTION_CHANGES

- **Flow:** `ingestComments()` → `fetchCommentsWithAdapterFallback()` → adapter if available, else legacy `fetchCommentsFromPlatform()`
- **Fallback:** Existing `fetchLinkedInComments`, `fetchTwitterComments`, `fetchFacebookComments`, `fetchInstagramComments` retained
- **New normalizers:** `normalizeYouTubeComments`, `normalizeRedditComments` for adapter responses
- **No removals:** All legacy logic preserved

---

## TEST_CONNECTION_ENDPOINT

- **Path:** `POST /api/social-platforms/test-connection`
- **Payload:** `{ platform_key, credentials?: { access_token?, refresh_token?, expires_at? }, api_key_env_name? }`
- **Flow:** Validates platform_key → loads adapter → `adapter.testConnection(credentials)` → returns success/failure
- **Optional:** When `api_key_env_name` provided and no explicit credentials, server resolves token from `process.env[api_key_env_name]`

---

## UI_IMPROVEMENTS

- **Platform dropdown:** When registry loaded, shows dropdown from `GET /api/social-platforms/registry`
- **Auto-fill:** Selecting platform sets `name` (platform_label), `base_url` (api_base_url)
- **Capabilities:** Displays Publishing ✓, Replies ✓, Comments ✓, Ingestion ✓ when platform selected
- **Test Connection:** Button visible when platform selected; uses `api_key_env_name` for server-side token resolution

---

## BACKWARD_COMPATIBILITY

| Component | Status |
|-----------|--------|
| `community_ai_platform_tokens` | Unchanged |
| `social_accounts` | Unchanged |
| `backend/adapters/platformAdapter.ts` | Unchanged (publishing flow intact) |
| `backend/services/platformConnectors/*` | Unchanged (engagement flow intact) |
| `backend/queue/jobProcessors/publishProcessor` | Unchanged |
| `pages/api/engagement/reply` | Unchanged |
| `pages/api/engagement/like` | Unchanged |

---

## COMPILATION_STATUS

- **Linter:** No errors in modified/created files
- **Build:** Run `npm run build` to confirm full build succeeds
- **Database migration:** Run `platform_registry.sql` then `platform_connectors.sql` before using new connector features

---

## DEPLOYMENT_NOTES

1. Apply database migrations: `platform_registry.sql` → `platform_connectors.sql`
2. Existing flows (publishing via queue, engagement via communityAiActionExecutor) continue to work without changes
3. Social Platforms page will use registry dropdown when `platform_registry` is populated
4. Test Connection requires `api_key_env_name` pointing to a valid token in server environment
