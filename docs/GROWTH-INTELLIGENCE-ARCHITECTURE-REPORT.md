# Growth Intelligence — Comprehensive Architecture Report

This document provides a full view of the current system structure, services, and dependencies to plan integration of a new **Growth Intelligence** module.

---

## 1. Project Overview

### Frameworks & Runtime

| Area | Technology |
|------|------------|
| **Frontend** | Next.js 16 (React), Tailwind CSS, Lucide React, react-icons |
| **Backend** | Node.js, Next.js API routes (Pages Router), TypeScript |
| **Build** | Next.js webpack, `next build` / `next start` |

### Backend Services

- **API layer**: Next.js API routes under `pages/api/` (283+ route files). No separate backend server; all server logic runs in Next.js.
- **Workers**: Separate Node processes for queues:
  - **Publish worker**: processes `publish` queue jobs (BullMQ) → platform adapters.
  - **Engagement polling worker**: processes `engagement-polling` jobs.
  - **Intelligence polling worker**: fetches external APIs, populates `intelligence_signals`.
- **Scheduler/Cron**: `backend/scheduler/cron.ts` — enqueues intelligence polling (e.g. every 2h), other scheduled tasks.
- **Start scripts**: `npm run start:worker`, `npm run start:cron` (ts-node).

### Database Systems

- **Primary**: **Supabase (PostgreSQL)**.
  - Client: `@supabase/supabase-js`.
  - Backend uses **service role** client from `backend/db/supabaseClient.ts` (server-only).
  - Frontend may use anon/key client for auth; API routes use service role for data access.
- **Schema**: SQL files in `database/` (195+ files); applied manually or via migration scripts. No single canonical schema file; tables are introduced across many migrations (e.g. `step2-core-tables.sql`, `clean-unified-schema.sql`, `enhanced-content-planning-schema.sql`, `community_ai_*.sql`, etc.).

### External Integrations

- **Auth**: Supabase Auth (sessions, OAuth). Token from `Authorization: Bearer` or cookies `sb-*-auth-token`.
- **AI/LLM**: **OpenAI** via `openai` package and `backend/services/aiGateway.ts`; LangChain used in some flows (`@langchain/openai`, `langchain`). Usage metered and enforced via `usageLedgerService`, `usageEnforcementService`, `usageMeterService`.
- **Social platforms**: OAuth and publishing via adapters in `backend/adapters/` (e.g. `instagramAdapter`) and `backend/services/socialConnectors/`; connectors under `pages/api/community-ai/connectors/` (LinkedIn, Twitter, Instagram, Facebook, Reddit) for Community AI.
- **Intelligence APIs**: Configurable external APIs (e.g. YouTube Trends, NewsAPI, SerpAPI) via `external_api_sources`, `externalApiService`, `trendProcessingService`; polling by intelligence worker; results in `intelligence_signals` → clustering → `strategic_themes`, `campaign_opportunities`.
- **Optional**: Redis for BullMQ (publish, engagement-polling, intelligence-polling queues).

### Hosting Environment

- Not specified in repo. Typical deployment: Node host (Vercel, VM, or container) for Next.js; separate process(es) for workers and cron; Supabase hosted; Redis if queues are used.

---

## 2. Repository Structure

```
/
├── backend/                    # Server-side logic (no HTTP; used by API routes & workers)
│   ├── adapters/               # Platform-specific publish/API adapters (e.g. Instagram)
│   ├── auth/                   # Auth helpers (if any beyond services)
│   ├── chatGovernance/         # AI chat governance
│   ├── config/                 # Backend configuration
│   ├── contracts/              # Type/contract definitions
│   ├── db/                     # Supabase client, stores, queries (campaigns, plans, posts, etc.)
│   ├── governance/             # Governance policies, config, snapshot/restore
│   ├── integration/            # External integrations
│   ├── jobs/                   # Job definitions / orchestration
│   ├── lib/                    # Shared backend libs
│   ├── middleware/             # withRBAC, etc.
│   ├── queue/                  # BullMQ client, job processors (publish, engagement-polling), startWorkers
│   ├── scheduler/              # Cron/scheduler (intelligence polling, etc.)
│   ├── services/               # Core business logic (campaigns, content, AI, community, analytics, etc.)
│   │   ├── ai/                 # AI-specific services
│   │   ├── llm/                # LLM adapters (e.g. openaiAdapter)
│   │   ├── platformConnectors/ # Platform connector implementations
│   │   ├── socialConnectors/   # Social publishing/engagement
│   │   ├── playbooks/         # Community AI playbooks
│   │   └── ...
│   ├── tests/                  # Unit and integration tests
│   ├── types/                  # Backend TypeScript types
│   ├── utils/                  # Backend utilities
│   └── workers/                # Worker entry points (e.g. intelligencePollingWorker, leadWorker)
├── components/                 # React UI components
│   ├── activity-board/         # Activity/card UI
│   ├── community-ai/           # Community AI UI
│   ├── recommendations/       # Recommendation cards, tabs, engine UI
│   ├── strategy/               # Strategy/intelligence panels
│   └── ui/                     # Shared UI (e.g. PlatformIcon)
├── database/                  # SQL schema and migrations (many .sql files)
├── docs/                      # Documentation (audits, APIs, migrations)
├── hooks/                     # React hooks
├── lib/                       # Shared frontend/backend lib (planning, intelligence, queue client, types)
│   ├── ai/                    # AI helpers
│   ├── intelligence/          # Distribution intelligence, strategic memory
│   ├── planning/              # Master content, execution adapter, distribution engine
│   └── services/              # Queue client, etc.
├── pages/                     # Next.js Pages Router
│   ├── api/                   # API routes (283+ .ts handlers)
│   ├── admin/                 # Admin pages (e.g. blog)
│   ├── campaign-*             # Campaign details, calendar, daily-plan, planning
│   ├── community-ai/          # Community AI pages
│   ├── campaigns/             # Campaigns list, [id], recommendations
│   └── ...
├── platform/                   # Python services (optional; api under platform/services)
├── public/                    # Static assets
├── scripts/                   # Setup, migrations, test runners
├── styles/                    # Global CSS
├── templates/                 # Email/content templates (if any)
└── utils/                     # Frontend/universal utils (platform icons, content taxonomy, execution status)
```

**Purpose of major directories**

| Directory | Purpose |
|-----------|---------|
| **backend/** | All server-only logic: DB access, queues, workers, scheduler, business services, adapters, governance. No HTTP; consumed by `pages/api` and worker processes. |
| **components/** | Reusable React components for campaigns, community AI, recommendations, activity board, strategy. |
| **database/** | SQL DDL and migrations for Supabase/PostgreSQL. Many tables; no single source of truth file. |
| **docs/** | Architecture notes, API docs, migration and audit docs. |
| **lib/** | Shared code used by both API and frontend: planning pipelines, intelligence, queue client, types. |
| **pages/** | Next.js routes: `pages/api/*` = API; other `pages/*` = UI pages. |
| **utils/** | Cross-cutting utilities: platform icons, content taxonomy, execution status, etc. |

---

## 3. Core System Modules

### Authentication

- **Where**: Supabase Auth; token resolution in `backend/services/supabaseAuthService.ts` (`getSupabaseUserFromRequest`: Bearer header or `sb-*` cookies).
- **Usage**: API handlers call `getSupabaseUserFromRequest(req)` or use `withRBAC` wrapper. No root Next.js middleware; auth is per-route.
- **RBAC**: `backend/middleware/withRBAC.ts` + `backend/services/rbacService.ts` (e.g. `enforceRole`). Requires `companyId` (query/body) and allowed roles. Used on many campaign, recommendation, governance, analytics, and opportunity routes.

### Organization / Tenant Management

- **Companies**: `companies` table; `company_id` / `companyId` used across campaigns, recommendations, usage, governance.
- **User–company**: `user_company_roles`; RBAC resolves user’s role per company via `userContextService` and `rbacService`.
- **Multi-tenant**: Scoping by `company_id` / `organization_id` / `tenant_id` in API and services (e.g. Community AI: `tenant_id`, `organization_id`).

### Campaign Management

- **Location**: `backend/services/` (e.g. `campaignAiOrchestrator`, `campaignHealthService`, plan stores), `backend/db/` (campaign plans, execution), `pages/api/campaigns/` (50+ routes).
- **Concepts**: Campaigns, 12-week/weekly/daily plans, strategies, blueprints, execution items, readiness, virality assessment, preemption, governance.
- **Key tables**: `campaigns`, `campaign_strategies`, `weekly_content_plans` / `weekly_content_refinements`, `daily_content_plans`, `scheduled_posts`, `platform_execution_plans`, `campaign_governance_events`, `campaign_virality_assessments`, `campaign_opportunities`.

### Content Generation

- **Location**: `backend/services/contentGenerationService.ts` (OpenAI), `backend/services/aiGateway.ts` (LLM gateway with usage/limits), `lib/planning/` (master content, variants), `backend/services/buildCreatorInstruction.ts`, content pipeline and overlap detection.
- **Flow**: Company profile + campaign + week/day plan + trend → AI generates headline, caption, hook, CTA, hashtags, etc.; platform variants; stored in plans / execution items.

### Social Media Publishing

- **Location**: `backend/adapters/` (e.g. `platformAdapter`), `backend/services/publishNowService.ts`, `backend/queue/jobProcessors/publishProcessor.ts`, `pages/api/social/publish.ts`, `pages/api/schedule/posts/`.
- **Flow**: Scheduled posts in DB → publish queue job → processor → platform adapter → update `scheduled_posts` (status, `platform_post_id`). Optional immediate publish via API.

### Community Engagement System

- **Location**: `pages/api/community-ai/` (many routes), `backend/services/communityAi*` (actions, playbooks, connectors, notifications, webhooks), `backend/services/engagementIngestionService.ts`, `pages/api/social/comments.ts`.
- **Concepts**: Community AI actions (approve/execute), playbooks, connectors (LinkedIn, Twitter, etc.), discovered users, comments/replies ingestion, forecasts, executive summaries.

### AI Integrations

- **Location**: `backend/services/aiGateway.ts` (OpenAI, usage logging, enforcement), `backend/services/llm/`, `backend/services/contentGenerationService.ts`, company profile and campaign AI in `pages/api/company-profile/` and `pages/api/campaigns/`, `pages/api/ai/` (GPT/Claude chat, topic generation, etc.).
- **Usage**: Content generation, topic suggestions, problem transformation, marketing intelligence, campaign messages, lead qualification, voice transcribe; usage metered and capped per org.

### Analytics & Reporting

- **Location**: `backend/services/analyticsService.ts`, `backend/db/performanceStore.ts`, `pages/api/analytics/` (campaign-roi, company-roi, post, platform, report, optimization), `pages/api/performance/`, `pages/api/governance/campaign-analytics.ts`, `pages/api/community-ai/` metrics and forecasts.
- **Concepts**: Performance metrics, engagement, ROI, optimization proposals, campaign/company analytics, Community AI KPIs and forecasts.

---

## 4. Database Schema Overview

Tables are spread across many SQL files. Below is a consolidated view of major entities and relationships.

### Core / Identity

| Table | Purpose |
|-------|---------|
| **users** | User accounts (email, name, subscription, etc.). |
| **companies** | Tenants (name, website, industry, status). |
| **user_company_roles** | User role per company (for RBAC). |
| **social_accounts** | User’s connected social accounts (platform, tokens, etc.). |

### Campaign & Planning

| Table | Purpose |
|-------|---------|
| **campaigns** | Campaign metadata (name, dates, status, virality_playbook_id, etc.). |
| **campaign_strategies** | Strategy records linked to campaigns. |
| **weekly_content_plans** / **weekly_content_refinements** | Week-level plans and refinements. |
| **daily_content_plans** | Day-level execution items (topic, platform, content_type, etc.). |
| **platform_execution_plans** | Platform-specific execution plans. |
| **scheduled_posts** | Posts to publish (platform, content, scheduled_for, status, platform_post_id). |
| **queue_jobs** | Jobs for publish/other queues (status, payload). |
| **queue_job_logs** | Audit log for queue jobs. |
| **campaign_governance_events** | Governance events (preemption, approval, etc.). |
| **campaign_virality_assessments** | Virality/readiness assessments. |
| **campaign_opportunities** | Campaign opportunities from intelligence pipeline. |
| **twelve_week_plan** (or similar) | 12-week plan data. |

### Content & Media

| Table | Purpose |
|-------|---------|
| **content_templates** | Reusable content templates. |
| **media_files** | Media assets. |
| **scheduled_post_media** | Link scheduled posts to media. |
| **content_analytics** / **platform_performance** | Analytics per content/platform. |

### Community AI

| Table | Purpose |
|-------|---------|
| **community_ai_actions** | Actions (e.g. reply, like) — status, approval, execution. |
| **community_ai_playbooks** | Playbook definitions. |
| **community_ai_platform_tokens** | Tokens for Community AI connectors. |
| **community_ai_discovered_users** | Discovered users. |
| **community_ai_action_logs** | Action audit log. |
| **community_ai_auto_rules** | Auto-rule configuration. |

### Intelligence & External APIs

| Table | Purpose |
|-------|---------|
| **external_api_sources** | Registry of external APIs (base_url, auth, rate limits). |
| **external_api_health** | Per-source health and reliability. |
| **external_api_usage** | Per source/user/date usage. |
| **intelligence_signals** | Raw signals from external APIs. |
| **signal_clusters** / **signal_intelligence** | Clustered and processed signals. |
| **strategic_themes** | Derived strategic themes. |
| **campaign_opportunities** | Opportunities derived from themes/signals. |
| **theme_company_relevance** | Relevance of themes to companies. |

### Recommendations & Leads

| Table | Purpose |
|-------|---------|
| **recommendation_jobs** (e.g. v2) | Recommendation generation jobs. |
| **recommendation_policies** | Policy config for recommendations. |
| **recommendation_snapshots** | Snapshots of recommendation state. |
| **lead_*** (e.g. lead_intent_clusters_v1) | Lead/engine data. |

### Governance & Admin

| Table | Purpose |
|-------|---------|
| **governance_*** (events, snapshots, projections) | Governance state and history. |
| **super_admin_audit_logs** | Audit log for super-admin actions. |
| **usage_meter_monthly** | Usage metering. |

### Comments & Engagement

| Table | Purpose |
|-------|---------|
| **post_comments** | Comments on posts. |
| **comment_replies** | Replies to comments. |
| **comment_likes**, **comment_flags** | Engagement and moderation. |

**Data flow (simplified)**

- **Campaigns**: `campaigns` → strategies → weekly/daily plans → `scheduled_posts` → `queue_jobs` → publish → `platform_post_id` + analytics.
- **Intelligence**: `external_api_sources` → polling → `intelligence_signals` → clustering → `strategic_themes` / `campaign_opportunities` (and theme–company relevance).
- **Community AI**: Connectors + playbooks → `community_ai_actions` → approve/execute → action logs and webhooks.
- **Analytics**: Performance/engagement data → `content_analytics` / performance stores → analytics APIs and reports.

---

## 5. API Layer

### Route Groups (by prefix)

| Prefix | Purpose |
|--------|---------|
| **/api/auth/** | OAuth (LinkedIn, Twitter, Instagram, YouTube, Spotify, TikTok, Pinterest) — auth and callbacks. |
| **/api/accounts** | Account linking / platform accounts. |
| **/api/admin/** | Audit logs, blog CRUD, delete activity/campaign/content, super-admin grant/revoke. |
| **/api/ai/** | GPT/Claude chat, topic generation, content generation, campaign messages, learnings, amendments. |
| **/api/analytics/** | Campaign ROI, company ROI, post/platform analytics, report, optimization, toggle auto-optimize. |
| **/api/campaigns/** | Full campaign lifecycle: CRUD, list, plans (12-week, weekly, daily), save/commit, readiness, progress, virality gate/assess, recommendations, preemption, schedule, memory, risk. |
| **/api/community-ai/** | Actions, connectors (auth/callback per platform), playbooks, forecasts, metrics, executive summary, trends, strategic memory, webhooks. |
| **/api/company-profile/** | Company profile CRUD, problem transformation, target customer, marketing intelligence, mission context. |
| **/api/content/** | Content list, approve, reject, regenerate, generate-day, platform-rules. |
| **/api/executive/** | Campaign health (executive view). |
| **/api/external-apis/** | External API config, presets, health, company config, requests (submit/approve). |
| **/api/governance/** | Campaign/company analytics, snapshots, restore, replay, run-audit, ledger verification. |
| **/api/intelligence/** | Decision timeline, strategic memory, summary, theme-preview. |
| **/api/leads/** | Lead job create, signal, outreach-plan, simulate. |
| **/api/recommendations/** | Generate, run, merge, refresh, job create/history, audit, state, create-campaign, etc. |
| **/api/schedule/** | Schedule posts CRUD. |
| **/api/scheduler/** | Schedule/posts. |
| **/api/social/** | Comments (fetch/reply), post, publish. |
| **/api/super-admin/** | Login, companies, plans, usage, RBAC, community AI policy, connection health. |
| **/api/performance/** | Collect, ingest, campaign performance. |
| **/api/opportunities/** | List, action, promote, refresh-slots. |
| **/api/queue/** | Queue stats. |
| **/api/templates/** | Template CRUD, render. |
| **/api/users/** | User list, invite, role. |
| **/api/virality/** | Playbooks. |
| **/api/voice/** | Notes, transcribe. |

(Plus blog, media, platform, strategy-templates, tracking, trending, trends, validate, etc.)

### Authentication Mechanisms

- **withRBAC**: Wraps handler; enforces role for a given `companyId`. Uses `getSupabaseUserFromRequest` and `enforceRole` (userContextService + rbacService). Used on content, users, campaigns (subset), recommendations, opportunities, governance, analytics, external-apis, collaboration-plans, outreach-plans, omnivyra.
- **Per-handler auth**: Many routes call `getSupabaseUserFromRequest(req)` or a local `requireAuth` and return 401 if no user.
- **Super-admin only**: Some routes (e.g. publish, admin deletes) also call `isSuperAdmin(user.id)` and return 403 if not.
- **Token source**: Supabase: `Authorization: Bearer <token>` or cookies `sb-*-auth-token`. Resolved in `backend/services/supabaseAuthService.ts`.

---

## 6. AI Integrations

### Where AI Is Used

- **backend/services/aiGateway.ts**: Central OpenAI gateway; usage logged and enforced per organization; used by campaign AI, company profile, and other server flows.
- **backend/services/contentGenerationService.ts**: Direct OpenAI for content generation (headline, caption, hook, CTA, hashtags, script, blog draft).
- **backend/services/companyProfileService.ts**, **leadQualifier.ts**, **leadPredictiveQualifier.ts**, **opportunityGenerators.ts**: Company context, lead qualification, opportunity generation.
- **pages/api/company-profile/** (define-problem-transformation, infer, define-target-customer, generate-marketing-intelligence, etc.): Profile and positioning.
- **pages/api/ai/** (gpt-chat, claude-chat, generate-content, generate-topics, campaign-messages, topic-suggestions, amendments): User-facing AI features.
- **pages/api/campaigns/** (AI plan, suggestions, strategy): Campaign planning and refinement.
- **pages/api/voice/transcribe.ts**: Transcription (OpenAI or similar).
- **lib/content-analyzer.ts**: Content analysis (likely LLM-backed).

### Tasks / Prompts

- Content: “Generate platform-specific content… JSON with headline, caption, hook, callToAction, hashtags, script?, blogDraft?, tone, trendUsed?, reasoning.”
- Company profile: Problem transformation, target customer, marketing intelligence (structured outputs).
- Campaign: Topic suggestions, strategy, weekly/daily amendments, plan generation.
- Leads: Qualification, outreach plan generation.

### Where Responses Are Stored

- Content: In weekly/daily plan payloads, execution items, and related content fields (e.g. `master_content`, platform variants).
- Company profile: `company_profiles` and related tables.
- Campaign AI: Campaign strategies, plans, memory, and AI history endpoints.
- Usage: `usageLedgerService` / usage meter and enforcement (e.g. `usage_meter_monthly`, org-level caps).

---

## 7. Campaign Execution Flow

1. **Planning**: Campaign created → strategy and 12-week/weekly/daily plans (UI + APIs: save, commit, get-weekly-plans, daily-plans).
2. **Content creation**: For each day/item, content can be AI-generated (content generation service + company profile + plan + trend) or edited; stored in daily execution items / refinements.
3. **Readiness**: Readiness and virality checks (e.g. `campaignReadinessService`, virality gate/assess); execution status (PENDING → IN_PROGRESS → FINALIZED → SCHEDULED) used in calendar/activity views.
4. **Scheduling**: Plans turned into `scheduled_posts` (e.g. via schedule-structured-plan, save-daily-plan, scheduler payload). Optional scheduler API for posting times.
5. **Publishing**:  
   - **Async**: Job enqueued (BullMQ `publish` queue) → worker runs `publishProcessor` → platform adapter publishes → `scheduled_posts` updated (status, `platform_post_id`), analytics recorded, campaign completion checked.  
   - **Immediate**: `POST /api/social/publish` (super-admin) → `publishNow` → same adapter and DB updates.
6. **Post-publish**: Engagement polling worker can pull comments/engagement; data stored for analytics and Community AI.

---

## 8. Community System Flow

- **Connectors**: OAuth per platform under `pages/api/community-ai/connectors/[platform]` (auth + callback). Tokens stored in `community_ai_platform_tokens`.
- **Actions**: User or system creates actions in `community_ai_actions`. Approval flow: approve endpoint → then execute. Execute handler loads action, validates playbook, calls `communityAiActionExecutor`, logs via `communityAiActionLogService`, notifies and sends webhooks.
- **Comments**: `pages/api/social/comments`: action `fetch` uses `ingestComments` / `getCommentsForScheduledPost` (engagementIngestionService); reply actions call platform-specific reply helpers (LinkedIn, Twitter). Comments/replies can be stored in `post_comments`, `comment_replies`.
- **Playbooks**: Playbook definitions and evaluation; actions validated against playbooks (`playbookValidator`, `playbookService`).
- **Discovery**: Discovered users and network intelligence services support Community AI features.

---

## 9. Current Analytics & Reporting

- **Backend**: `analyticsService` computes engagement rate, best platforms/content types/times, trend success, top/underperforming assets from performance metrics; `performanceStore` (list/save); ROI and optimization proposal services.
- **APIs**: Campaign ROI, company ROI, post-level and platform analytics, report, optimization, toggle auto-optimize; governance campaign/company analytics; Community AI metrics, forecasts, executive summary; performance collect/ingest.
- **Storage**: Metrics in `content_analytics`, `platform_performance`, and similar tables; governance and campaign health reports; business/audit reports via dedicated endpoints.

---

## 10. Integration Points for New Modules

Suitable extension points without replacing existing flows:

| Point | Location | Use for Growth Intelligence |
|-------|----------|-----------------------------|
| **Campaign execution lifecycle** | After plan commit / when items move to SCHEDULED; `publishProcessor` after publish; campaign completion service | Hook to record “growth” events (e.g. content scheduled, published). |
| **Analytics / performance** | `performance/collect`, `performance/ingest`, `analyticsService`, `recordPostAnalytics` in publish processor | Ingest or aggregate metrics for growth scoring, funnels, cohort metrics. |
| **Recommendation and opportunities** | `recommendation_jobs`, opportunities APIs, campaign_opportunities | Feed “growth” signals (e.g. opportunity accepted → campaign created). |
| **Intelligence pipeline** | After `intelligence_signals` or `strategic_themes` / `campaign_opportunities` | Use themes and opportunities as inputs to growth models or scores. |
| **Community AI actions** | After action execute (log, webhook); `community_ai_actions` state changes | Track engagement and conversion from Community AI. |
| **Governance events** | `campaign_governance_events`, snapshot/restore, run-audit | Optional: growth metrics by governance state or policy. |
| **Usage and metering** | `usage_meter_monthly`, usage ledger, enforcement | Optional: growth vs. usage or cost. |
| **New API namespace** | e.g. `pages/api/growth-intelligence/` | Dedicated Growth Intelligence endpoints (scores, funnels, recommendations). |
| **New tables** | `database/` | e.g. `growth_intelligence_metrics`, `growth_scores`, `growth_events` if needed. |

---

## 11. Scalability Considerations

- **Stateless API**: Next.js API routes are stateless; horizontal scaling by adding instances.
- **Workers**: Publish, engagement-polling, and intelligence-polling run in separate processes; can scale by increasing worker concurrency or worker instances; Redis/BullMQ supports multiple consumers.
- **Database**: Supabase/PostgreSQL; scaling via connection pooling, read replicas, and indexing (indexes defined in various migration files).
- **AI**: Centralized in `aiGateway` with org-level usage checks; rate limits and token caps help avoid overload; consider per-tenant queues or backpressure if needed.
- **External APIs**: Rate limits and health in `external_api_*` tables; polling interval (e.g. 2h) and worker design limit load.
- **No app-wide cache**: No in-process or Redis cache layer described; heavy reads could be mitigated with caching later.

---

## 12. Summary: Where Growth Intelligence Should Integrate

**Recommended integration for a Growth Intelligence module:**

1. **Data sources**  
   - **Campaigns**: Plans, execution status, publish events, readiness/virality.  
   - **Analytics**: Performance and ROI APIs and DB tables.  
   - **Recommendations & opportunities**: Merge/accept events, campaign creation from recommendations/opportunities.  
   - **Intelligence**: Strategic themes, campaign_opportunities, theme_company_relevance.  
   - **Community AI**: Action execution and engagement.  
   - **Usage**: Optional link to usage/metering for efficiency metrics.

2. **Hooks to add**  
   - **After publish** (in `publishProcessor` or `publishNow`): Emit growth event or write to a `growth_events` / metrics table.  
   - **After recommendation/opportunity → campaign**: Record conversion for growth funnel.  
   - **After Community AI action execute**: Record engagement/conversion.  
   - **Scheduled job**: Periodic aggregation job (e.g. daily) to compute growth scores or funnels from existing analytics and events.

3. **New surface**  
   - **API**: `pages/api/growth-intelligence/` for scores, funnels, trends, and recommendations (read-only at first).  
   - **DB**: Optional `growth_*` tables for events, scores, and snapshots.  
   - **UI**: New dashboard or panels (e.g. under existing campaign/executive/recommendations areas) consuming the new API.

4. **Auth and tenanting**  
   - Reuse existing auth (`getSupabaseUserFromRequest`) and RBAC (`withRBAC`) with `companyId` so all growth data is scoped per company.

5. **Avoid**  
   - Replacing or duplicating core campaign execution, scheduling, or publishing logic.  
   - Bypassing usage/LLM enforcement when calling AI from Growth Intelligence.

This gives a single place (Growth Intelligence) to define “growth” (e.g. content shipped, opportunities converted, engagement, ROI) and to expose it via dedicated APIs and UI while reusing the rest of the architecture.
