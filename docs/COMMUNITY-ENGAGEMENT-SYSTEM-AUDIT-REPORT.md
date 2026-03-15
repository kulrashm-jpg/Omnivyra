# COMMUNITY ENGAGEMENT SYSTEM AUDIT REPORT

**Audit Date:** March 8, 2025  
**Scope:** Community Engagement module only  
**Methodology:** Codebase analysis — current implementation status only. No redesign or improvement suggestions.

---

## 1. Database Architecture

### 1.1 Engagement-Related Tables (Confirmed)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| **post_comments** | Ingested comments per scheduled post | `id`, `scheduled_post_id`, `platform_comment_id`, `platform`, `author_name`, `author_username`, `author_profile_url`, `content`, `parent_comment_id`, `is_reply`, `like_count`, `reply_count`, `sentiment_score`, `platform_created_at` |
| **comment_replies** | Human replies to comments (outbound) | `comment_id`, `user_id`, `content`, `status`, `platform_reply_id`, `sent_at` |
| **comment_likes** | User likes on comments | `comment_id`, `user_id`, `platform_like_id` |
| **comment_flags** | Flags (spam, inappropriate, etc.) | `comment_id`, `user_id`, `flag_type`, `status` |
| **community_ai_actions** | Suggested/executed actions | `tenant_id`, `organization_id`, `platform`, `action_type`, `target_id`, `suggested_text`, `status`, `playbook_id`, `discovered_user_id`, `execution_mode`, `execution_result`, `executed_at`, `skip_reason` |
| **community_ai_action_logs** | Action audit log | `action_id`, `tenant_id`, `organization_id`, `event_type`, `event_payload` |
| **community_ai_discovered_users** | Discovered users for network expansion | `tenant_id`, `organization_id`, `platform`, `profile_url`, `classification`, `eligible_for_engagement`, `discovered_via` |
| **community_ai_playbooks** | Automation playbooks | `tenant_id`, `organization_id`, `name`, `scope`, `tone`, `action_rules`, `limits`, `execution_modes`, `status` |
| **community_ai_auto_rules** | Auto-execution rules | `tenant_id`, `organization_id`, `rule_name`, `condition`, `action_type`, `max_risk_level`, `is_active` |
| **community_ai_notifications** | In-app notifications | `tenant_id`, `organization_id`, `action_id`, `event_type`, `message`, `is_read` |
| **community_ai_webhooks** | Outbound webhook config | `tenant_id`, `organization_id`, `event_type`, `webhook_url`, `is_active` |
| **community_ai_platform_tokens** | OAuth tokens for Community AI connectors | `tenant_id`, `organization_id`, `platform`, `access_token`, `refresh_token`, `expires_at` |
| **execution_guardrails** | Company-scoped execution limits | `company_id`, `auto_execution_enabled`, `daily_platform_limit`, `per_post_reply_limit`, `per_evaluation_limit` |

### 1.2 Additional Engagement-Related Tables (Different Pipelines)

| Table | Purpose | Notes |
|-------|---------|-------|
| **direct_messages** | DMs per social account | FK: `social_accounts`; not wired to Community AI flow |
| **message_replies** | Replies to DMs | FK: `direct_messages` |
| **engagement_rules** | User-defined rules (auto_reply, auto_like, etc.) | User-scoped; not integrated with Community AI |
| **community_posts** | Posts from campaign narratives | FK: `campaign_narratives`, `companies`; separate from `scheduled_posts` |
| **community_threads** | Multi-post threads (carousel, thread) | FK: `community_posts`; **not** conversation threading |
| **engagement_signals** | Engagement metrics per community_post | FK: `community_posts`; aggregates likes/comments/shares counts |

### 1.3 Relationships

- **post_comments** → `scheduled_posts` (ON DELETE CASCADE)
- **comment_replies** → `post_comments`, `users`
- **comment_likes** → `post_comments`, `users`
- **comment_flags** → `post_comments`, `users`
- **community_ai_actions** → `community_ai_discovered_users` (optional FK, ON DELETE SET NULL)
- **community_ai_action_logs** → no FK to `community_ai_actions` (action_id is stored but not enforced)
- **community_ai_actions** has **no FK** to `scheduled_posts` or `post_comments`; linkage is by `target_id` (platform_post_id or platform_comment_id) at read time

### 1.4 Indexes (Engagement Tables)

- `post_comments`: UNIQUE(`scheduled_post_id`, `platform_comment_id`); indexes on `scheduled_post_id`, `platform`, `author_username`, `created_at`, `is_flagged`, `sentiment_score`
- `community_ai_actions`: `(tenant_id, organization_id)`, `platform`, `status`, `(tenant_id, organization_id, discovered_user_id)`
- `community_ai_discovered_users`: UNIQUE(`tenant_id`, `organization_id`, `platform`, `profile_url`); indexes on `(tenant_id, organization_id)`, `platform`
- `community_ai_action_logs`: `action_id`, `(tenant_id, organization_id)`, `event_type`
- `execution_guardrails`: `company_id` (unique)

### 1.5 Phase 1 Entities: engagement_messages, engagement_threads, engagement_authors, engagement_sources

**These entities do NOT exist** in the current schema.

| Entity | Status | Equivalent / Notes |
|--------|--------|-------------------|
| **engagement_messages** | **Does not exist** | Closest: `post_comments` (comments only; no DMs, no unified message model) |
| **engagement_threads** | **Does not exist** | `community_threads` exists but models multi-post content threads (carousel/thread), **not** conversation threads. `post_comments.parent_comment_id` provides reply threading within a post. |
| **engagement_authors** | **Does not exist** | Author data is denormalized on `post_comments` (`author_name`, `author_username`, `author_profile_url`). No dedicated author table. |
| **engagement_sources** | **Does not exist** | Platform/source is stored per-row (`post_comments.platform`, `community_ai_actions.platform`). No unified source registry. |

---

## 2. Ingestion Pipeline

### 2.1 Flow

```
Platform API (LinkedIn, Twitter, Facebook, Instagram)
  → engagementIngestionService.fetchCommentsFromPlatform()
  → engagementIngestionService.normalizeCommentsForPlatform()
  → engagementIngestionService.persistComments() → post_comments (upsert)
  → (if ingested > 0) engagementEvaluationService.evaluatePostEngagement()
    → communityAiOmnivyraService.evaluateEngagement()
    → community_ai_actions (insert pending)
```

### 2.2 Services

| Service | Location | Role |
|---------|----------|------|
| **engagementIngestionService** | `backend/services/engagementIngestionService.ts` | Fetches comments from platform APIs, normalizes, upserts to `post_comments` |
| **engagementEvaluationService** | `backend/services/engagementEvaluationService.ts` | Triggered after ingestion; builds input, calls OmniVyra, persists suggested actions |

### 2.3 Platform Adapters (Comment Fetch)

| Platform | Implemented | Normalizer | API Endpoint |
|----------|-------------|------------|--------------|
| LinkedIn | ✓ | `normalizeLinkedInComments` | `v2/socialActions/{postId}/comments` |
| Twitter/X | ✓ | `normalizeTwitterComments` | `v2/tweets/{postId}/replies` |
| Facebook | ✓ | `normalizeFacebookComments` | `graph.facebook.com/v18.0/{postId}/comments` |
| Instagram | ✓ | `normalizeFacebookComments` (shared) | `graph.facebook.com/v18.0/{postId}/comments` |
| YouTube | ✗ | — | — |
| Reddit | ✗ | — | — |

### 2.4 Polling vs Webhook

- **Polling:** Implemented. `engagementPollingProcessor` selects published `scheduled_posts` (last 30 days, batch 50), calls `ingestComments(post.id)` per post. Enqueued by `schedulerService.enqueueEngagementPolling()` every 10 minutes. Queue: `engagement-polling`.
- **Webhook ingestion:** **Not implemented.** No inbound webhook for platform push of comments. `community_ai_webhooks` is for **outbound** webhooks (we call external URLs on executed/failed/high_risk_pending events).

### 2.5 Normalization

- Each platform has a `normalize*Comments` function mapping raw API response to `IngestCommentRow`:
  - `scheduled_post_id`, `platform_comment_id`, `platform`, `author_name`, `author_username`, `author_profile_url`, `content`, `platform_created_at`, `like_count`, `reply_count`
- Upsert key: `(scheduled_post_id, platform_comment_id)` — idempotent.

### 2.6 Conversation Threading

- **post_comments** has `parent_comment_id` (self-reference) and `is_reply` for reply threading.
- **engagementIngestionService** does **not** persist nested replies. It fetches top-level comments only; platform APIs used return first-level comments. Nested reply ingestion is not implemented.
- No `engagement_threads` (conversation threads) table; threading is via `parent_comment_id` only.

### 2.7 Credential Source

- Ingestion uses **tokenStore / social_accounts** (same as publish flow): `getToken(post.social_account_id)`.
- **community_ai_platform_tokens** is used for **action execution** (Community AI connectors), not for ingestion.

### 2.8 Separate Pipelines (Not Engagement Inbox)

- **engagementCaptureService** + **engagement_signals**: Captures engagement metrics (likes, comments, shares counts) for `community_posts` (narrative-derived). Inserts placeholder rows when APIs not configured. **Not** the same as comment ingestion.
- **communityPostEngine**: Converts `campaign_narratives` → `community_posts`. No engagement ingestion.

---

## 3. Action Execution Engine

### 3.1 Execution Service

| Service | Location | Role |
|---------|----------|------|
| **communityAiActionExecutor** | `backend/services/communityAiActionExecutor.ts` | `executeAction(action, approved, options)` — validates, loads playbook, checks guardrails, delegates to platform connector or RPA |

### 3.2 Action Types Supported

| Action | LinkedIn | Twitter | Facebook | Instagram | YouTube | Reddit |
|--------|----------|---------|----------|-----------|---------|--------|
| **reply** | ✓ | ✓ | ✓ | ✓ | Simulated | ✓ |
| **like** | ✓ | ✓ | ✓ | ✓ | Simulated | ✓ |
| **share** | ✓ | ✓ (retweet) | ✓ | ✗ | Simulated | ✗ |
| **follow** | ✗ | ✓ | ✗ | ✗ | Simulated | ✗ |
| **schedule** | — | — | — | — | Simulated | — |

- **YouTube connector:** Returns `success: true` with payload only; no real API call.
- **RPA mode:** `rpaWorkerService.executeRpaTask()` for platforms without API support.

### 3.3 Execution Modes

- **manual:** Simulated; returns `{ ok: true, status: 'executed' }` with `simulated: true`. No platform call.
- **api:** Uses platform connector `executeAction(action, token)`.
- **rpa:** Uses `rpaWorkerService` for browser automation.

### 3.4 Guardrails

| Component | Location | Role |
|-----------|----------|------|
| **executionGuardrailService** | `backend/services/executionGuardrailService.ts` | `canExecuteAction(action, context)` — checks `execution_guardrails` (auto_execution_enabled, daily_platform_limit, per_post_reply_limit, per_evaluation_limit). **Not** applied to manual `/api/community-ai/actions/execute`. |
| **playbookValidator** | `backend/services/playbooks/playbookValidator.ts` | `validateActionAgainstPlaybook()` — safety (URLs, sensitive topics, prohibited words), tone (max_length, emoji), action_rules, limits (replies/hour, follows/day), execution_modes, automation_levels |
| **communityAiPlatformPolicyService** | `backend/services/communityAiPlatformPolicyService.ts` | Global policy: `execution_enabled`, `require_human_approval` |

### 3.5 Logging

- **communityAiActionLogService** → `community_ai_action_logs`: event types `approved`, `executed`, `failed`, `skipped`, `scheduled`, `auto_executed`.
- **communityAiNotificationService** → `community_ai_notifications`.
- **communityAiWebhookService** → Outbound HTTP to `community_ai_webhooks` URLs on executed/failed/high_risk_pending.

### 3.6 Failure Handling

- Execution errors caught; status set to `failed`; `execution_result` stores error.
- Notifications and webhooks fired on failure.
- No automatic retry; manual re-approval required.

### 3.7 Token Source for Execution

- **platformTokenService** → `community_ai_platform_tokens` (tenant_id, organization_id, platform).
- Distinct from ingestion (social_accounts).

---

## 4. OmniVyra AI Integration

### 4.1 Where OmniVyra Runs

- **External service.** `omnivyraClientV1` calls `OMNIVYRA_BASE_URL/api/v1/omnivyra/community/engagement/evaluate` (POST).
- Enabled when `USE_OMNIVYRA=true|1|yes`.

### 4.2 Inputs

- **engagementEvaluationService** builds:
  - `tenant_id`, `organization_id`, `platform`
  - `post_data`: `scheduled_post_id`, `platform_post_id`, `content`, `platform`
  - `engagement_activity`: full comment objects from `post_comments`
  - `engagement_metrics`: `total_comments`, `recent_comments`
  - `brand_voice`: from company profile
  - `context`: `{ source: 'engagement_evaluation', scheduled_post_id }`

- **communityAiOmnivyraService.evaluateEngagement()** passes this to `evaluateCommunityAiEngagement()`.

### 4.3 Outputs / Storage

- OmniVyra returns `suggested_actions` (analysis, content_improvement, safety_classification, execution_links).
- **communityAiOmnivyraService** runs playbook evaluation and auto-rules; inserts into `community_ai_actions` with `status: 'pending'` when `requires_approval` is true.
- **engagementEvaluationService** does best-effort dedupe by `(platform, target_id, action_type, suggested_text)` before insert.

### 4.4 How Actions Are Triggered

1. **Ingestion** → `ingestComments()` → if comments > 0 → `evaluatePostEngagement()`.
2. **evaluatePostEngagement** → OmniVyra → playbook evaluation → auto-rules.
3. **evaluateAutoRules** (in communityAiOmnivyraService): low-risk actions matching auto_rules may be auto-executed (guardrail + `executeAction`).
4. **communityAiScheduler**: Processes `approved`/`scheduled` actions; executes via `executeAction`.
5. **Manual:** `/api/community-ai/actions/execute` — human approves, executes with `execution_mode: 'manual'` (simulated).

### 4.5 Fallback When OmniVyra Disabled

- Returns `{ analysis: 'OmniVyra disabled', suggested_actions: [], source: 'placeholder' }`.
- No actions created.

---

## 5. Playbook Automation

### 5.1 Tables

- **community_ai_playbooks**: scope (platforms, content_types, intents), tone, action_rules, limits, execution_modes, automation_rules, safety, status.
- **community_ai_auto_rules**: condition (JSONB), action_type, max_risk_level; used to auto-approve and execute matching actions.

### 5.2 Services

| Service | Location | Role |
|---------|----------|------|
| **playbookService** | `backend/services/playbooks/playbookService.ts` | CRUD for `community_ai_playbooks` |
| **playbookEvaluator** | `backend/services/playbooks/playbookEvaluator.ts` | `evaluatePlaybookForEvent()` — selects primary/secondary playbook by scope (platform, content_type, intent), builds decision (allowed_actions, requires_approval, execution_mode, tone) |
| **playbookValidator** | `backend/services/playbooks/playbookValidator.ts` | `validateActionAgainstPlaybook()` — safety, tone, limits, execution_modes |
| **communityAiAutoRuleService** | `backend/services/communityAiAutoRuleService.ts` | `evaluateAutoRules()` — matches suggested actions to auto_rules; auto-executes when conditions met (after guardrail + playbook validation) |

### 5.3 Automation Decision Flow

1. OmniVyra returns `suggested_actions`.
2. **evaluatePlaybookForEvent** selects playbook by platform, content_type, intent.
3. **validateActionAgainstPlaybook** checks safety, tone, limits.
4. **evaluateAutoRules**:
   - If `intent_classification.primary_intent === 'network_expansion'` → skipped (observation lock).
   - Otherwise: match rule by `action_type` + `matchesCondition(rule.condition, action)`.
   - If match and risk ≤ max_risk_level and not hard-blocked (follow, influencer, high risk, URL) → insert/update `community_ai_actions` with `status: 'approved'`, call `canExecuteAction`, then `executeAction(..., true, { source: 'auto' })`.
5. **communityAiScheduler**: Loads `approved`/`scheduled` actions, checks token/playbook, calls `canExecuteAction`, then `executeAction`.

---

## 6. User Discovery Infrastructure

### 6.1 Table

- **community_ai_discovered_users**: `tenant_id`, `organization_id`, `platform`, `external_user_id`, `external_username`, `profile_url`, `discovered_via` (api|rpa), `discovery_source`, `classification` (influencer|peer|prospect|spam_risk|unknown), `eligible_for_engagement`, `first_seen_at`, `last_seen_at`, `metadata`.

### 6.2 Population

| Source | Service | Method |
|--------|---------|--------|
| **API (mock)** | `userDiscoveryService.discoverUsersFromApi()` | Mock implementations for Reddit, Twitter, Instagram, Facebook; upserts to `community_ai_discovered_users` |
| **RPA (Reddit)** | `userDiscoveryService.discoverUsersFromRpa()` | `discoverUsersFromRedditRpa()` → upserts |
| **Network expansion** | `networkActionCandidateService.generateNetworkActionCandidates()` | **Reads** from `community_ai_discovered_users`; **creates** `community_ai_actions` for eligible users. Does **not** insert discovered users. |

### 6.3 What Is Recorded

- **Influencer / lead signals:** `classification` (influencer, peer, prospect, spam_risk, unknown). No structured scoring; classification is set at insert (often `'unknown'`).
- **Engagement history:** Not stored on discovered users. Engagement is in `community_ai_actions` (by `discovered_user_id` when present).
- **Interaction scoring:** No dedicated scoring. `confidence_score` exists on schema but is not populated by current discovery flows.

### 6.4 Network Intelligence View

- **community_ai_network_intelligence** (SQL view): Aggregates `community_ai_discovered_users` with action counts and eligibility.

---

## 7. Existing Capabilities Confirmed

| Capability | Status | Evidence |
|------------|--------|----------|
| Comment ingestion schema | ✓ | `post_comments` with platform-specific normalizers |
| AI engagement evaluation (OmniVyra) | ✓ | `communityAiOmnivyraService` + `omnivyraClientV1` |
| Suggested engagement actions | ✓ | `community_ai_actions` (pending) from evaluation |
| Automation playbooks | ✓ | `community_ai_playbooks`, playbookService, playbookEvaluator, playbookValidator |
| Action execution engine | ✓ | `communityAiActionExecutor` + platform connectors |
| Safety guardrails | ✓ | `executionGuardrailService`, playbookValidator, communityAiPlatformPolicyService |
| Action logging | ✓ | `community_ai_action_logs`, communityAiActionLogService |
| User discovery tracking | ✓ | `community_ai_discovered_users`, userDiscoveryService, networkActionCandidateService |
| Auto-rules | ✓ | `community_ai_auto_rules`, communityAiAutoRuleService |
| Scheduler execution | ✓ | `communityAiScheduler` processes approved/scheduled actions |
| Activity queue (read-only) | ✓ | `aiActivityQueueService.getAiActivityQueue()` — pending actions with related post/comment |
| Outbound webhooks | ✓ | `community_ai_webhooks`, communityAiWebhookService |
| **Unified Engagement Inbox** | ✗ | **Not implemented** |
| **Engagement inbox UI** | ✗ | **Not implemented** |

---

## 8. Missing Components for Phase 1

### 8.1 Unified Engagement Data Model

The target architecture assumes:

- **engagement_messages** — unified message model across platforms
- **engagement_threads** — conversation threads
- **engagement_authors** — normalized author entities
- **engagement_sources** — source/platform registry

**Current state:** None of these exist. The system uses:

- `post_comments` for comments only (no DMs, no unified message model)
- `post_comments.parent_comment_id` for reply threading (no first-class thread entity)
- Denormalized author fields on `post_comments`
- Platform stored per-row; no `engagement_sources` table

**Conclusion:** Phase 1 Engagement Data Foundation requires creation of these entities (or equivalent) to support a Unified Engagement Inbox.

### 8.2 Platform Coverage Gaps

- **Ingestion:** YouTube, Reddit — no comment fetch adapters.
- **Execution:** Instagram (share, follow), Facebook (follow), Reddit (share, follow), YouTube (all real execution) — not supported or simulated only.

### 8.3 Inbound Webhook Ingestion

- No webhook endpoint for platforms to push comments/engagement in real time.
- Ingestion is polling-only.

---

## 9. Architecture Risks or Conflicts

### 9.1 Dual Token Systems

- **Ingestion:** `social_accounts` + tokenStore (publish flow).
- **Execution:** `community_ai_platform_tokens` (Community AI connectors).
- Risk: Company may have connected `social_accounts` for publishing but not `community_ai_platform_tokens` for execution — actions fail with "Platform not connected."

### 9.2 Dual Post Models

- **scheduled_posts** (publish pipeline) → `post_comments` → engagement evaluation → `community_ai_actions`.
- **community_posts** (narrative pipeline) → `engagement_signals` (metrics only).
- `pages/api/community/engagement.ts` reads `engagement_signals` by `community_posts.company_id` — **not** `post_comments`. Different data sources for "engagement" APIs.

### 9.3 community_ai_actions Status Constraint

- Schema: `CHECK (status IN ('pending', 'approved', 'executed', 'failed', 'skipped'))`.
- Code uses `status: 'skipped_guardrail'` when guardrail blocks execution.
- **Risk:** If constraint is enforced, inserts/updates with `skipped_guardrail` may fail. Documentation states "status is text, no enum change" and relies on constraint not including `skipped_guardrail`; actual DB state may vary.

### 9.4 executed_at Consistency

- `communityAiAutoRuleService` and `communityAiScheduler` set `executed_at` when status becomes `executed`.
- **pages/api/community-ai/actions/execute** (manual execution) does **not** set `executed_at` — only `status`, `execution_result`, `final_text`, `updated_at`.
- Guardrail and analytics queries use `executed_at`; manual executions would have `executed_at = null`.

### 9.5 Discovered Users Population

- `community_ai_discovered_users` is populated by `userDiscoveryService` (API mocks + Reddit RPA).
- **No integration** with comment ingestion: comment authors are **not** automatically inserted into `community_ai_discovered_users`. Discovery is a separate, manual/RPA-driven flow.

---

*End of Audit Report*
