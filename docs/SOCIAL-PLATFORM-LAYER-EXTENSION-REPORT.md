# Social Platform Integration Layer — Extension Report

**Date:** 2025-03-10  
**Scope:** WhatsApp, Pinterest, Quora; rate limits; platform policies; adapter guidelines.

---

## FILES_CREATED

| File | Description |
|------|-------------|
| `backend/services/platformAdapters/whatsappAdapter.ts` | WhatsApp Business API adapter |
| `backend/services/platformAdapters/pinterestAdapter.ts` | Pinterest API v5 adapter |
| `backend/services/platformAdapters/quoraAdapter.ts` | Quora API adapter |
| `backend/services/platformRateLimitService.ts` | In-memory rate limit per platform |
| `backend/constants/platformPolicies.ts` | Platform-specific publish restrictions |

---

## FILES_MODIFIED

| File | Changes |
|------|---------|
| `database/platform_registry.sql` | Added seeds for whatsapp, pinterest, quora |
| `backend/services/platformAdapters/baseAdapter.ts` | Added withRateLimit, enforcePublishPolicy; template_name in payload |
| `backend/services/platformAdapters/index.ts` | Mapped whatsapp, pinterest, quora adapters |
| `backend/services/platformRegistryService.ts` | Added whatsapp, pinterest, quora to FALLBACK_REGISTRY |
| `backend/services/platformConnectorService.ts` | No changes; already validates platform_key via validatePlatformKey |
| `pages/social-platforms.tsx` | Added supports_threads to capability display |

**Existing adapters (linkedin, twitter, youtube, reddit):** Wrapped all methods with `withRateLimit`; `publishContent` calls `enforcePublishPolicy` where applicable.

---

## PLATFORMS_ADDED

| platform_key | platform_label | supports_publishing | supports_replies | supports_comments | supports_threads | supports_ingestion |
|--------------|----------------|---------------------|------------------|-------------------|-------------------|--------------------|
| whatsapp | WhatsApp Business | ✓ | ✓ | ✗ | ✓ | ✓ |
| pinterest | Pinterest | ✓ | ✗ | ✓ | ✗ | ✓ |
| quora | Quora | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## RATE_LIMIT_SYSTEM

| Platform | Limit | Window |
|----------|-------|--------|
| linkedin | 100 | 1 min |
| twitter | 900 | 15 min |
| youtube | 10000 | 1 min (quota-based) |
| reddit | 60 | 1 min |
| facebook | 200 | 1 min |
| instagram | 200 | 1 min |
| tiktok | 100 | 1 min |
| whatsapp | 80 | 1 min |
| pinterest | 200 | 1 min |
| quora | 60 | 1 min |

**Implementation:** In-memory `rateLimitMap` keyed by platform. `checkRateLimit(platformKey)` increments counter and throws `RateLimitExceededError` when exceeded. Adapters call `withRateLimit(platformKey, fn)` at the start of each method.

---

## PLATFORM_POLICIES

| Platform | Policy |
|----------|--------|
| linkedin | max_post_length: 3000, supports_hashtags: true |
| twitter | max_post_length: 280, supports_hashtags: true |
| youtube | max_post_length: 5000 |
| reddit | subreddit_required: true |
| whatsapp | template_required: true, conversation_window_hours: 24 |
| pinterest | requires_image: true |
| quora | answers_only: true |

**Enforcement:** `enforcePublishPolicy(platformKey, payload)` runs before `publishContent`. Throws `PlatformPolicyError` when invalid.

---

## ADAPTER_IMPLEMENTATIONS

### WhatsApp
- **publishContent:** Sends message via WhatsApp Business API (phone number ID + token)
- **replyToComment:** Replies to message thread
- **likeComment:** Not supported
- **fetchComments:** Returns message data when configured; else empty
- **testConnection:** Validates Graph API token

### Pinterest
- **publishContent:** Creates Pin (requires media_urls)
- **replyToComment:** Not supported
- **likeComment:** Not supported
- **fetchComments:** Fetches pin comments
- **testConnection:** Verifies OAuth via `/user_account`

### Quora
- **publishContent:** Creates answer (question_id in platform_post_id)
- **replyToComment:** Comments on answer
- **likeComment:** Upvotes
- **fetchComments:** Fetches replies to answer
- **testConnection:** Verifies token via `/me`

---

## COMPILATION_STATUS

- **Linter:** No errors in modified/created files
- **Existing pipelines:** Unchanged — publishing (platformAdapter), engagement (communityAiActionExecutor), ingestion (engagementIngestionService) paths preserved
- **Database:** Run `platform_registry.sql` to add new platform seeds

---

## BACKWARD_COMPATIBILITY

| Component | Status |
|-----------|--------|
| `backend/adapters/platformAdapter.ts` | Unchanged |
| `backend/services/platformConnectors/*` | Unchanged |
| `backend/queue/jobProcessors/publishProcessor` | Unchanged |
| `pages/api/engagement/reply` | Unchanged |
| `pages/api/engagement/like` | Unchanged |
| `engagementIngestionService` | Unchanged; new adapters available via getPlatformAdapter |
