# Community Platforms Extension — Implementation Report

**Date:** 2025-03-10  
**Scope:** Community platforms for signal detection and intelligence; platform grouping; community signal service.

---

## FILES_CREATED

| File | Description |
|------|-------------|
| `backend/services/platformAdapters/slackAdapter.ts` | Slack API adapter (fetchComments, testConnection) |
| `backend/services/platformAdapters/discordAdapter.ts` | Discord API v10 adapter |
| `backend/services/platformAdapters/githubDiscussionsAdapter.ts` | GitHub Discussions adapter (publish, reply, fetch) |
| `backend/services/platformAdapters/stackoverflowAdapter.ts` | Stack Overflow API adapter |
| `backend/services/platformAdapters/productHuntAdapter.ts` | Product Hunt GraphQL adapter |
| `backend/services/platformAdapters/communityAdapterTypes.ts` | CommunityMessage type |
| `backend/services/communitySignalService.ts` | detectBuyingIntent, detectProblemDiscussion, detectRecommendationRequests, detectCompetitorMentions; storeOpportunity, storeLeadSignal |

---

## FILES_MODIFIED

| File | Changes |
|------|---------|
| `database/platform_registry.sql` | Added platform_category column; seeded slack, discord, github, stackoverflow, producthunt, hackernews (community) |
| `backend/services/platformRegistryService.ts` | platform_category in types and FALLBACK_REGISTRY; getPlatformCategory() |
| `backend/services/platformAdapters/index.ts` | Mapped slack, discord, github, stackoverflow, producthunt adapters |
| `backend/services/engagementIngestionService.ts` | ingestCommunityChannel(); getPlatformCategory import |
| `backend/services/engagementNormalizationService.ts` | syncFromCommunityMessages(); CommunityMessageInput; analyzeAndStoreSignals call |
| `backend/services/platformRateLimitService.ts` | Added limits for slack, discord, github, stackoverflow, producthunt, hackernews |
| `pages/social-platforms.tsx` | platform_category in RegistryPlatform; optgroup grouping (Social Platforms, Community Platforms) |

---

## PLATFORMS_ADDED

| platform_key | platform_label | platform_category | supports_publishing | supports_replies | supports_ingestion |
|--------------|----------------|-------------------|---------------------|------------------|--------------------|
| slack | Slack Communities | community | ✗ | ✗ | ✓ |
| discord | Discord | community | ✗ | ✗ | ✓ |
| github | GitHub Discussions | community | ✓ | ✓ | ✓ |
| stackoverflow | Stack Overflow | community | ✓ | ✓ | ✓ |
| producthunt | Product Hunt | community | ✓ | ✗ | ✓ |
| hackernews | Hacker News | community | ✗ | ✗ | ✓ |

---

## COMMUNITY_ADAPTERS

| Adapter | fetchComments | testConnection | publishContent | replyToComment | likeComment |
|---------|---------------|----------------|----------------|----------------|-------------|
| slackAdapter | ✓ channels.history | ✓ auth.test | Not supported | Not supported | Not supported |
| discordAdapter | ✓ channels/:id/messages | ✓ users/@me | Not supported | Not supported | Not supported |
| githubDiscussionsAdapter | ✓ discussions comments | ✓ user | ✓ create discussion | ✓ comment | N/A |
| stackoverflowAdapter | ✓ questions answers | ✓ me | ✓ post answer | ✓ comment | N/A |
| productHuntAdapter | ✓ post comments (GraphQL) | ✓ viewer | ✓ createPost | Not supported | Not supported |

Adapters normalize responses to `{ thread_id, message_id, author, text, created_at, platform }` (CommunityMessage).

---

## SIGNAL_ENGINE

**communitySignalService.ts**

- **detectBuyingIntent(content)** — patterns: buy, purchase, budget, demo, trial
- **detectProblemDiscussion(content)** — patterns: struggling, issue, bug, help with
- **detectRecommendationRequests(content)** — patterns: recommend, alternatives, best for
- **detectCompetitorMentions(content, competitorNames)** — substring match against org competitor list
- **storeOpportunity()** — writes to `engagement_opportunities`
- **storeLeadSignal()** — writes to `engagement_lead_signals`
- **analyzeAndStoreSignals()** — runs all detectors and stores matches; called from syncFromCommunityMessages

---

## INGESTION_CHANGES

- **ingestCommunityChannel(platformKey, channelId, accessToken, organizationId)** — New entry point for community platforms. Verifies platform_category=community, calls adapter.fetchComments(), syncs via syncFromCommunityMessages to engagement_messages.
- **syncFromCommunityMessages()** — Resolves source, thread, authors; inserts messages; triggers analyzeAndStoreSignals and processMessageForLeads.
- **Existing ingestComments()** — Unchanged; continues to handle social platforms via scheduled_posts.

---

## COMPILATION_STATUS

- **Linter:** No errors
- **Existing pipelines:** Unchanged — publishing (platformAdapter), engagement (communityAiActionExecutor), social ingestion (ingestComments) preserved
- **Database:** Run `platform_registry.sql` to add platform_category column and community platform seeds

---

## BACKWARD_COMPATIBILITY

| Component | Status |
|-----------|--------|
| `backend/adapters/platformAdapter.ts` | Unchanged |
| `backend/services/platformConnectors/*` | Unchanged |
| `backend/queue/jobProcessors/publishProcessor` | Unchanged |
| `pages/api/engagement/reply` | Unchanged |
| `pages/api/engagement/like` | Unchanged |
| Social ingestion (ingestComments) | Unchanged |
