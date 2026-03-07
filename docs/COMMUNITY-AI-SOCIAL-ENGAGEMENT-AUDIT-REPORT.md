# Community AI & Social Engagement Architecture Audit Report

**Date:** March 7, 2025  
**Scope:** Community AI and Social Engagement platform capabilities  
**Audit Type:** Technical architecture inspection (no redesign proposals)

---

## SECTION 1 — Existing Capabilities

### 1.1 Content Layer
| Capability | Status | Location |
|------------|--------|----------|
| **Content storage** | ✓ | `scheduled_posts`, platform-specific tables (`linkedin_posts`, `twitter_tweets`, `instagram_feed_posts`, `facebook_posts`, etc.) |
| **Platform publishing** | ✓ | `backend/adapters/platformAdapter.ts`, per-platform adapters (LinkedIn, X, Instagram, Facebook, YouTube, TikTok, etc.) |
| **Content scheduling** | ✓ | `structuredPlanScheduler.ts`, `schedulerService.ts`, `queue_jobs`, `queue_job_logs` |
| **Post analytics (aggregate)** | ✓ | `content_analytics` (views, likes, shares, comments, engagement_rate, retweets, quotes, reactions) |
| **Media support** | ✓ | `media_files`, `scheduled_post_media`, platform-specific media fields |
| **Campaign content mapping** | ✓ | `campaigns`, `campaign_content`, `scheduled_posts.campaign_id` |

### 1.2 Engagement Layer
| Capability | Status | Location |
|------------|--------|----------|
| **Comment schema** | ✓ | `post_comments` (author, content, sentiment_score, sentiment_label, is_flagged, like_count, reply_count) |
| **Comment replies schema** | ✓ | `comment_replies`, `comment_likes`, `comment_flags` |
| **Comment ingestion** | ✓ | `engagementIngestionService.ts` — fetches from platform APIs and upserts into `post_comments` |
| **Engagement rules schema** | ✓ | `engagement_rules` (auto_reply, auto_like, auto_follow, keyword_alert) |
| **Community AI actions** | ✓ | `community_ai_actions` — like, reply, share, follow, schedule with status lifecycle |
| **Action execution** | ✓ | `communityAiActionExecutor.ts`, platform connectors (LinkedIn, Facebook, Twitter, Instagram, YouTube, Reddit) |
| **Engagement evaluation (AI)** | ✓ | `communityAiOmnivyraService.ts` — OmniVyra API for analysis, suggested_actions, safety_classification |

### 1.3 Community AI Module
| Capability | Status | Location |
|------------|--------|----------|
| **Discovered users** | ✓ | `community_ai_discovered_users` (platform, profile_url, classification: influencer/peer/prospect/spam_risk/unknown, eligible_for_engagement) |
| **Network intelligence view** | ✓ | `community_ai_network_intelligence` — aggregates discovered users + action counts + eligibility |
| **Playbooks** | ✓ | `community_ai_playbooks`, `playbookService.ts`, `playbookEvaluator.ts`, `playbookValidator.ts` |
| **Auto-rules** | ✓ | `community_ai_auto_rules`, `communityAiAutoRuleService.ts` |
| **Notifications** | ✓ | `community_ai_notifications` (approved, executed, failed, high_risk_pending) |
| **Platform tokens (tenant/org)** | ✓ | `community_ai_platform_tokens`, `platformTokenService.ts` |
| **Webhooks** | ✓ | `community_ai_webhooks`, `communityAiWebhookService.ts` |
| **Action logs** | ✓ | `community_ai_action_logs` — approved, executed, failed, skipped, scheduled, auto_executed |
| **Guardrails** | ✓ | `executionGuardrailService.ts`, `execution_guardrails` |

### 1.4 AI Intelligence Layer (Campaign / Trend)
| Capability | Status | Location |
|------------|--------|----------|
| **Intelligence signals** | ✓ | `intelligence_signals` — topic, cluster_id, confidence_score, source_api_id |
| **Signal clustering** | ✓ | `signal_clusters`, `signalClusterEngine` (or equivalent), clustering via `cluster_id` |
| **Signal intelligence** | ✓ | `signal_intelligence` — momentum_score, trend_direction (UP/STABLE/DOWN) |
| **Strategic themes** | ✓ | `strategic_themes`, `strategicThemeEngine.ts` |
| **Intelligence graph edges** | ✓ | `intelligence_graph_edges` — signal-to-signal relationships |
| **Trend recommendation engine** | ✓ | `recommendationEngine.ts` — trend scoring, geo/audience fit, sentiment |
| **Company intelligence** | ✓ | `companyIntelligenceAggregator.ts`, `companyIntelligenceEngine.ts` — customer_sentiment, trend clusters |

### 1.5 Discovery / Distribution
| Capability | Status | Location |
|------------|--------|----------|
| **User discovery (RPA/API)** | ✓ | `discoverUsersFromRedditRpa`, `community_ai_discovered_users` via api/rpa |
| **Network action candidates** | ✓ | `networkActionCandidateService.ts` — eligible_for_engagement filtering |
| **Content distribution planning** | ✓ | `dailyContentDistributionPlanService.ts`, `contentBlueprintCache` |

### 1.6 Moderation & Governance (Partial)
| Capability | Status | Location |
|------------|--------|----------|
| **Comment flags schema** | ✓ | `comment_flags` — flag_type: spam, inappropriate, harassment, other |
| **Post comment flags** | ✓ | `post_comments.is_flagged`, `post_comments.flag_reason` |
| **Chat moderation (abuse/spam)** | ✓ | `chatGovernance/types.ts` — codes: abuse, gibberish, misleading, off_topic, spam, empty, too_long |
| **Platform compliance** | ✓ | `validatePlatformCompliance`, `platform_compliance_reports` |
| **Safety classification** | ✓ | OmniVyra `safety_classification` in engagement evaluation output |

### 1.7 Metrics & Analytics
| Capability | Status | Location |
|------------|--------|----------|
| **Engagement score metrics** | ✓ | `growthIntelligence/metrics/engagementScore.ts` — views, likes, shares, comments, engagement_rate |
| **Community engagement metrics** | ✓ | `growthIntelligence/metrics/communityEngagement.ts` — executed actions, replies, likes, shares |
| **Growth intelligence** | ✓ | `growthIntelligenceService`, metrics: communityEngagement, contentVelocity, publishingSuccess, opportunityActivation |
| **Performance feedback** | ✓ | `performanceFeedbackService.ts`, `performance_feedback` |
| **Activity feed (product)** | ✓ | `activity_feed` — user actions (post_published, campaign_updated, etc.) |
| **Notifications (user)** | ✓ | `notifications` — user_id, type, is_read |

---

## SECTION 2 — Partial Implementations

### 2.1 Comment & Engagement Ingestion
- **Schema exists:** `post_comments`, `comment_replies`, `comment_likes`, `comment_flags`
- **Ingestion exists:** `engagementIngestionService.ts` writes to `post_comments`
- **Gap:** No automated pipeline that triggers ingestion on a schedule or webhook; Community AI post API receives `post_details: null`, `engagement_activity: []` — engagement data often empty at evaluation time

### 2.2 Sentiment & Moderation
- **Schema:** `post_comments.sentiment_score`, `post_comments.sentiment_label` (-1 to 1)
- **No dedicated sentiment pipeline:** sentiment is schema-ready but no service populates it from content analysis
- **Spam risk classification:** `community_ai_discovered_users.classification` includes `spam_risk`; OmniVyra provides safety_classification
- **No toxicity detection service:** no dedicated toxicity/offensive-content AI pipeline

### 2.3 Recommendation Engine
- **Trend recommendation:** `recommendationEngine.ts` — campaign/content recommendations from external API signals (trends, volume, sentiment)
- **Network recommendations:** `networkIntelligence/recommendationService.ts` — platform mix, eligibility rates
- **No user-facing content feed ranking:** recommendations target campaign planning and Community AI actions, not end-user feed ordering

### 2.4 Credential & Publish Paths
- **Two credential systems:** `social_accounts` (user-level, tokenStore) vs `community_ai_platform_tokens` (tenant/org)
- **Two publish paths:** `platformAdapter` (queue + social_accounts) vs `socialPlatformPublisher` (external_api_sources)

### 2.5 Discovery Pipeline
- **Discovered users:** populated via RPA/API discovery
- **No unified discovery orchestration:** no single job that discovers → classifies → creates actions in one pipeline

---

## SECTION 3 — Missing Platform Capabilities

### 3.1 Content Layer
- **Unified content store:** Content spread across `scheduled_posts` and legacy platform tables (`linkedin_posts`, `twitter_tweets`, etc.); no single canonical content table for social engagement
- **Content versioning:** No version history for edits
- **Content moderation queue:** No workflow for human review of flagged content

### 3.2 Engagement Layer
- **Engagement events table:** No `engagement_events` or equivalent storing discrete events such as:
  - `post_viewed`
  - `post_liked`
  - `post_commented`
  - `post_shared`
- **Reactions:** Only aggregate counts in `content_analytics`; no per-user reaction storage
- **Engagement ingestion automation:** No cron/webhook that routinely pulls engagement and triggers AI evaluation

### 3.3 Community Graph
- **No community graph:** No `user_relationships`, `follows`, or `user_follows` table
- **Follower counts:** Stored on `social_accounts` (follower_count, following_count) but no graph of who-follows-who
- **No in-app social graph:** Relationships exist only on external platforms

### 3.4 Topic Graph (Community Context)
- **Topic graph for community:** `intelligence_graph_edges` and `signal_clusters` model signal-to-signal relationships for *campaign intelligence*, not community content topics
- **No topic hierarchy for community posts:** No `topics` or `communities` table for organizing user-generated content

### 3.5 Engagement Graph
- **No engagement graph:** No structure modeling who engaged with whose content (user→post→action)
- **Action history:** `community_ai_actions` tracks brand actions, not end-user engagement events

### 3.6 Feed & Discovery
- **No feed generation API:** No service that assembles a ranked feed for a user
- **No feed ranking algorithm:** No relevance/engagement-based ordering for content display
- **No community discovery UI/API:** No “discover communities” or “suggested to follow” logic
- **No trending content API:** Trends exist for campaign planning, not for surfacing trending posts to users

### 3.7 Notifications
- **Limited notification types:** `community_ai_notifications` (action events) and `notifications` (user assignments)
- **No engagement notifications:** No “someone liked your post”, “new comment”, “new follower” notifications
- **No real-time delivery:** No websocket/push infrastructure

---

## SECTION 4 — Community AI Capabilities

### 4.1 Implemented
| Capability | Implementation |
|------------|----------------|
| **Engagement evaluation** | OmniVyra API + playbooks + auto-rules → suggested_actions (like, reply, share, follow, schedule) |
| **Action prioritization** | `engagementPriorityService.ts` — deterministic scoring (reply=50, like=30, share=35, follow=25) |
| **Discovered user classification** | influencer, peer, prospect, spam_risk, unknown |
| **Eligibility gating** | `eligible_for_engagement`, `blocked_reason` on discovered users |
| **Playbook rules** | Automation levels (observe/assist/automate), rate limits (replies/hour, follows/day) |
| **Safety classification** | OmniVyra `safety_classification` |
| **Intent classification** | `community_ai_actions.intent_classification` (JSONB) |
| **Risk levels** | `community_ai_actions.risk_level`, `requires_human_approval` |
| **Executive summary** | `executiveSummaryService.ts` — discovered users, platform mix, eligibility |
| **Week-over-week metrics** | `weekOverWeekService.ts` — trend up/down/flat |

### 4.2 External / Delegated
- **OmniVyra:** External API for engagement analysis; platform may pass empty post/engagement when data not ingested
- **RPA discovery:** User discovery via RPA (e.g., Reddit); API discovery path exists

---

## SECTION 5 — Community AI Gaps

### 5.1 Topic Clustering (Community Content)
- **Campaign intelligence:** `signal_clusters`, `signal_intelligence` cluster *external API signals* for trend/campaign planning
- **Community content:** No clustering of comments, posts, or conversations within the platform
- **Gap:** No topic clustering of community conversations or comment threads

### 5.2 Conversation Summarization
- **Not implemented:** No service that summarizes comment threads or multi-turn conversations
- **Schema:** No `conversation_summaries` or equivalent table

### 5.3 Engagement Scoring (Community Context)
- **Campaign engagement:** `engagementScore.ts` aggregates content_analytics per campaign
- **Community AI:** No per-comment or per-thread engagement score for prioritization
- **OmniVyra:** Provides suggested_actions but no explicit numeric engagement score surfaced in platform logic

### 5.4 Expert Identification
- **Classification:** `community_ai_discovered_users.classification` includes `influencer` but no structured “expert” detection
- **No expertise graph:** No scoring of user expertise by topic or domain
- **No “top contributors” or “key voices” logic:** Beyond classification, no rank-by-expertise

### 5.5 Trend Detection (Community)
- **Campaign trends:** `signal_intelligence`, `strategicThemeEngine`, `opportunityDetectionEngine` for market/trend signals
- **Community trends:** No detection of trending topics *within* community conversations or comments
- **Gap:** Trending is external-signal driven, not community-conversation driven

### 5.6 Automated AI Pipeline
- **No end-to-end pipeline:** Fetch engagement → persist → evaluate → create actions is not automated
- **Manual trigger:** Community AI evaluation typically triggered by API call with often-empty engagement data

---

## SECTION 6 — World-Class Platform Requirements

### 6.1 Content Layer
- Unified content model with platform-agnostic abstraction
- Content versioning and edit history
- Rich media metadata and accessibility
- Content moderation workflow with human-in-the-loop

### 6.2 Engagement Layer
- **Engagement events store:** Discrete events (post_viewed, post_liked, post_commented, post_shared) for analytics and ML
- Real-time engagement ingestion (webhooks or frequent polling)
- Per-user reaction storage (who liked what)
- Threaded conversation structure with nesting

### 6.3 Graphs
- **Community graph:** User relationships (follows, blocks, mutes)
- **Topic graph:** Topics, communities, and content-to-topic mapping
- **Engagement graph:** User→content→action for recommendation and analytics

### 6.4 AI Intelligence
- Topic clustering of community content
- Conversation summarization
- Engagement scoring for comments/threads
- Expert/authority identification by topic
- Community-internal trend detection
- Automated pipeline: ingest → analyze → suggest → (optional) execute

### 6.5 Discovery
- Feed generation API with ranking (relevance, recency, engagement, diversity)
- Recommendation engine for content and people
- Community discovery (suggested communities, topics)
- Trending content surfaced to users

### 6.6 Moderation
- Spam detection (automated)
- Toxicity detection (e.g., Perspective API or equivalent)
- Reporting workflow with triage and escalation
- Appeal and review flows

### 6.7 Notifications
- Engagement-triggered notifications (likes, comments, shares, follows)
- Real-time or near-real-time delivery
- Notification preferences and batching

---

## SECTION 7 — Architectural Risks

### 7.1 Scalability
- **Two credential stacks:** Complexity and key management overhead; potential token refresh storms
- **No engagement event stream:** Aggregation-only analytics limit ML and real-time features
- **Intelligence pipeline:** Signal clustering and intelligence engines may require batching/async as volume grows

### 7.2 Engagement Limitations
- **Empty engagement at evaluation:** Community AI often evaluates with `post_details: null`, `engagement_activity: []` — limits AI quality
- **No automated trigger:** Evaluation depends on manual or indirect triggers; no event-driven pipeline
- **Disconnected ingestion:** `engagementIngestionService` exists but is not wired into a scheduled job or webhook that feeds Community AI

### 7.3 Data Fragmentation
- **Content:** Spread across `scheduled_posts` and legacy platform tables
- **Credentials:** `social_accounts` vs `community_ai_platform_tokens` with no mapping
- **Company/tenant:** Campaigns and scheduling are user-centric; Community AI is tenant/org-centric

### 7.4 Graph Absence
- **No community graph:** Cannot implement “friends of friends” or graph-based recommendations
- **No engagement graph:** Cannot optimize for “users who liked X also liked Y” or similar patterns
- **No topic graph for community:** Hard to surface “related discussions” or topic-based discovery

### 7.5 Moderation Surface
- **Reporting:** `comment_flags` exists but no full triage workflow
- **Toxicity:** No automated toxicity detection; reliance on external APIs (OmniVyra) for safety
- **Spam:** Classification exists but no automated spam-filtering pipeline

### 7.6 Discovery & Feed
- **No feed:** Cannot surface a personalized, ranked content feed
- **No ranking:** Cannot optimize for engagement or relevance in display order
- **Recommendation scope:** Limited to campaign/trend recommendations, not user-facing content discovery

---

## Appendix A — Database Tables Summary

### Content & Posts
- `scheduled_posts`, `linkedin_posts`, `twitter_tweets`, `instagram_feed_posts`, `facebook_posts`, `youtube_videos`, etc.
- `campaigns`, `campaign_content`
- `content_analytics`

### Comments & Engagement
- `post_comments`, `comment_replies`, `comment_likes`, `comment_flags`
- `engagement_rules`

### Community AI
- `community_ai_actions`, `community_ai_action_logs`
- `community_ai_discovered_users`
- `community_ai_playbooks`, `community_ai_auto_rules`
- `community_ai_notifications`, `community_ai_webhooks`
- `community_ai_platform_tokens`, `community_ai_platform_policy`

### Intelligence (Campaign/Trend)
- `intelligence_signals`, `signal_clusters`, `signal_intelligence`
- `intelligence_graph_edges`, `intelligence_signal_entities`
- `company_intelligence_signals`, `strategic_themes`
- `scheduling_intelligence_signals`

### Users & Accounts
- `users`
- `social_accounts` (follower_count, following_count — counts only, no graph)
- No `user_relationships`, `follows`, or `communities` table

### Activity & Notifications
- `activity_feed` (product actions)
- `notifications` (user assignments)
- No `engagement_events` table

---

## Appendix B — Key Services Summary

| Service | Responsibility |
|---------|----------------|
| `engagementEvaluationService` | Triggers evaluateEngagement, persists suggested_actions to community_ai_actions |
| `engagementIngestionService` | Fetches comments from platforms, upserts into post_comments |
| `communityAiOmnivyraService` | OmniVyra + playbooks + auto-rules → suggested_actions |
| `communityAiActionExecutor` | Executes like/reply/share/follow via platform connectors |
| `recommendationEngine` | Trend recommendations for campaigns (volume, sentiment, geo) |
| `growthIntelligence/metrics/engagementScore` | Aggregates content_analytics (views, likes, shares, comments) |
| `growthIntelligence/metrics/communityEngagement` | Counts executed community_ai_actions by type |
| `signalIntelligenceEngine` | Converts signal_clusters → signal_intelligence (momentum, direction) |
| `strategicThemeEngine` | Strategic themes from signal_intelligence |
| `companyIntelligenceAggregator` | Trend clusters, customer sentiment from signals |

---

*End of Audit Report*
