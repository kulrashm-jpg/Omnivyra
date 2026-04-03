# SYSTEM INVENTORY
Generated: 2026-03-29

---

## REPOSITORIES

| Field | Value |
|-------|-------|
| **Name** | drishiq-admin-ui (Omnivyra) |
| **Version** | 1.0.0 |
| **Type** | Full-stack monorepo |
| **Purpose** | AI-powered social media management and campaign orchestration platform — campaign planning, content generation, scheduling, engagement management, analytics across social platforms |
| **Root** | `c:/virality` |

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16.1.6, React, TypeScript 5.9.2, Tailwind CSS 3.4.17 |
| Backend | Node.js, Express 5.2.1, ts-node |
| Database | Supabase (PostgreSQL) via service-role client |
| Cache / Queue | Redis (Upstash), BullMQ 5.68.0, IORedis 5.9.3 |
| AI / ML | OpenAI (gpt-4o-mini default), Anthropic Claude (optional) |
| Auth | Supabase Auth, Firebase (phone OTP), OAuth 2.0 |
| Validation | Zod, ESLint (custom runtime-enforcement plugin) |
| State | Zustand |
| PDF | PDFKit |

---

## SERVICES

### Backend Services (`backend/services/`)

**Campaign Services**

| File | Purpose |
|------|---------|
| `CampaignAutoOptimizationGuard.ts` | Guards against invalid auto-optimization triggers |
| `CampaignAutoOptimizationService.ts` | Automated campaign optimization logic |
| `CampaignBlueprintService.ts` | Campaign template / blueprint generation |
| `CampaignCompletionService.ts` | Marks campaigns as complete |
| `CampaignFinalizationGuard.ts` | Validates campaign finalization conditions |
| `CampaignHealthMonitor.ts` | Health scoring for active campaigns |
| `CampaignHealthService.ts` | Broader campaign health tracking |
| `CampaignLearningService.ts` | Records learnings from past campaigns |
| `CampaignMemoryService.ts` | Persistent campaign memory / context |
| `CampaignNegotiationService.ts` | Campaign negotiation workflows |
| `CampaignOptimizationIntelligenceService.ts` | AI-driven optimization suggestions |
| `CampaignOptimizationProposalService.ts` | Generates optimization proposals |
| `CampaignPlanCore.ts` | Core campaign planning logic |
| `CampaignPlanParser.ts` | Parses campaign plan text from AI output |
| `CampaignPreemptionService.ts` | Preemptive campaign actions |
| `CampaignPrePlanningService.ts` | Pre-planning validations |
| `CampaignPromptBuilder.ts` | Constructs AI prompts for campaigns |
| `CampaignRecoveryService.ts` | Recovery logic for failed campaigns |
| `CampaignRoiIntelligenceService.ts` | ROI analysis and intelligence |
| `CampaignScheduleEligibilityService.ts` | Checks if campaign can be scheduled |
| `CampaignStrategyEngine.ts` | Multi-strategy routing and selection |
| `CampaignWaveService.ts` | Wave-based campaign execution |

**Governance Services**

| File | Purpose |
|------|---------|
| `GovernanceAnalyticsService.ts` | Analytics for governance compliance |
| `GovernanceAuditService.ts` | Audit trail and compliance reporting |
| `GovernanceEventService.ts` | Governance event tracking |
| `GovernanceExplanationService.ts` | Explains governance decisions |
| `GovernanceLedgerVerificationService.ts` | Verifies audit ledger integrity |
| `GovernanceLockdownService.ts` | Emergency lockdown capabilities |
| `GovernanceMetricsService.ts` | Governance metrics collection |
| `GovernancePolicyRegistry.ts` | Registry of governance policies |
| `GovernanceProjectionService.ts` | Projects governance constraints forward |
| `GovernanceRateLimiter.ts` | Rate limiting enforcement |
| `GovernanceReplayService.ts` | Replays governance events for audit |
| `GovernanceSnapshotService.ts` | Snapshots governance state |

**Intelligence & Analytics Services**

| File | Purpose |
|------|---------|
| `aiGateway.ts` | Routes requests to AI models |
| `aiModelRouter.ts` | Selects optimal AI model per request |
| `aiOutputValidationService.ts` | Validates AI model outputs |
| `aiPlanningService.ts` | AI-assisted planning |
| `aiResponseCache.ts` | Caches AI responses |
| `analyticsService.ts` | General analytics aggregation |
| `businessIntelligenceService.ts` | Business intelligence reporting |
| `companyIntelligenceService.ts` | Company-level insights |
| `competitiveIntelligenceEngine.ts` | Competitive analysis |
| `intelligenceCoreEngine.ts` | Core intelligence processing |
| `intelligenceLearningModule.ts` | Learning module for intelligence |
| `intelligenceOrchestrationService.ts` | Orchestrates intelligence services |
| `intelligenceSimulationModule.ts` | Simulates intelligence outcomes |
| `intelligenceStrategyModule.ts` | Intelligence strategy selection |
| `insightIntelligenceService.ts` | Insight generation from signals |
| `strategicIntelligenceOrchestrationService.ts` | Strategic intelligence coordination |
| `strategicInsightService.ts` | Strategic insights from data |
| `strategicThemeEngine.ts` | Extracts strategic themes |

**Engagement Services**

| File | Purpose |
|------|---------|
| `engagementAnalyticsService.ts` | Engagement metric analysis |
| `engagementCaptureService.ts` | Captures engagement data from platforms |
| `engagementDigestService.ts` | Summarizes daily engagement activity |
| `engagementInboxService.ts` | Manages engagement inbox |
| `engagementIngestService.ts` | Ingests engagement data from APIs |
| `engagementInsightService.ts` | Generates engagement insights |
| `engagementOpportunityEngine.ts` | Identifies engagement opportunities |
| `engagementOpportunityResolutionService.ts` | Resolves opportunities into actions |
| `engagementPlaybookService.ts` | Playbooks for engagement responses |
| `engagementSignalCollector.ts` | Collects engagement signals |
| `feedbackIntelligenceEngine.ts` | Learns from user feedback |

**Content Services**

| File | Purpose |
|------|---------|
| `contentArchitectService.ts` | Content structure and architecture |
| `contentAssetService.ts` | Manages content assets |
| `contentClusterService.ts` | Groups similar content |
| `contentGenerationPipeline.ts` | End-to-end content generation |
| `contentGenerationService.ts` | Core content generation |
| `contentOpportunityEngine.ts` | Content opportunity detection |
| `contentOpportunityService.ts` | Content opportunity management |
| `contentOverlapService.ts` | Detects content overlap / duplication |
| `contentValidationService.ts` | Validates generated content |

**Lead & Opportunity Services**

| File | Purpose |
|------|---------|
| `leadDetectionService.ts` | Identifies potential leads from conversations |
| `leadIntelligenceService.ts` | Lead scoring and intelligence |
| `leadService.ts` | Core lead management |
| `leadQualifier.ts` | Qualifies leads against criteria |
| `leadThreadScoring.ts` | Scores conversation threads |
| `opportunityDetectionService.ts` | Detects growth opportunities |
| `opportunityRadarService.ts` | Opportunity discovery system |
| `opportunityService.ts` | Opportunity lifecycle management |
| `opportunitySlotsScheduler.ts` | Schedules opportunity execution |

**Learning & Feedback Services**

| File | Purpose |
|------|---------|
| `learningEngineService.ts` | Core learning logic |
| `learningDecayService.ts` | Time-based learning signal decay |
| `performanceFeedbackService.ts` | Feedback collection |
| `performanceInsightGenerator.ts` | Generates insights from performance data |
| `responseStrategyIntelligenceService.ts` | Learns optimal response strategies |

**Scheduling & Execution Services**

| File | Purpose |
|------|---------|
| `autopilotExecutionPipeline.ts` | Fully automated execution flow |
| `autonomousScheduler.ts` | Self-managing scheduler |
| `executionPlannerService.ts` | Plans campaign execution steps |
| `schedulingEngine.ts` | Core scheduling logic |
| `schedulingService.ts` | High-level scheduling operations |
| `weeklyScheduleAllocator.ts` | Allocates posts across a week |

**Signal & Trend Services**

| File | Purpose |
|------|---------|
| `signalEmbeddingService.ts` | Embeddings for market signals |
| `signalIntelligenceEngine.ts` | Processes market signals |
| `signalNormalizationService.ts` | Normalizes signal data |
| `signalRelevanceEngine.ts` | Filters relevant signals |
| `trendingTopicsService.ts` | Tracks trending topics |
| `trendProcessingService.ts` | Processes trend data |

**Recommendation Services**

| File | Purpose |
|------|---------|
| `recommendationBlueprintService.ts` | Creates recommendation blueprints |
| `recommendationBlueprintValidationService.ts` | Validates recommendation blueprints |
| `recommendationCampaignBuilder.ts` | Builds campaigns from recommendations |
| `recommendationEngine.ts` | Core recommendation engine |
| `recommendationPersistenceService.ts` | Persists recommendation state |
| `recommendationPolicyService.ts` | Governs recommendations |
| `recommendationScheduler.ts` | Schedules recommendations |

**Platform & Auth Services**

| File | Purpose |
|------|---------|
| `platformConnectorService.ts` | Manages platform connectors |
| `platformOauthConfigService.ts` | OAuth configuration per platform |
| `platformTokenService.ts` | Token lifecycle management |
| `socialPlatformPublisher.ts` | Publishes to social platforms |

**Admin, Config & Utility Services**

| File | Purpose |
|------|---------|
| `adminRuntimeConfig.ts` | Runtime configuration management |
| `auditLoggingService.ts` | Audit log persistence |
| `autoScalingSignal.ts` | Autoscaling webhook signals |
| `cacheWarmup.ts` | Pre-loads cache on startup |
| `companyApiConfigCache.ts` | Caches company API config |
| `companyContextCache.ts` | Caches company context |
| `companyContextGuardService.ts` | Guards company context isolation |
| `companyContextService.ts` | Company context management |
| `companyProfileService.ts` | Manages company profiles |
| `configService.ts` | Config service |
| `creditDeductionService.ts` | Deducts credits for operations |
| `creditGuardService.ts` | Credit allocation governance |
| `earnCreditsService.ts` | Awards credits to users |
| `externalApiService.ts` | Manages external API calls |
| `hotKeyCache.ts` | Hot-path key caching |
| `imageService.ts` | Image processing |
| `mediaService.ts` | Media upload / download |
| `promptContextCache.ts` | Caches prompt context |
| `redisExternalApiCache.ts` | Redis-backed external API cache |
| `usageTrackingService.ts` | Tracks platform usage metrics |
| `userManagementService.ts` | User lifecycle management |

**New / Untracked Services**

| File | Purpose |
|------|---------|
| `actionRegistryService.ts` | Registry of system actions |
| `adsIngestionService.ts` | Ingests ads data |
| `commandCenterReadinessService.ts` | Command center readiness scoring |
| `commandCenterStateService.ts` | Command center state management |
| `contentArchitectSecurityService.ts` | Security for content architect |
| `crawlerService.ts` | Web crawling |
| `crmIngestionService.ts` | CRM data ingestion |
| `decisionGenerationControlService.ts` | Controls decision generation |
| `decisionObjectService.ts` | Decision object lifecycle |
| `decisionReportService.ts` | Decision reporting |
| `decisionRuntimeGuardService.ts` | Runtime guards for decisions |
| `featureCompletionEventTriggers.ts` | Event triggers for feature completion |
| `featureCompletionService.ts` | Tracks feature completion |
| `featureCompletionSyncService.ts` | Syncs feature completion state |
| `ga4IngestionService.ts` | Google Analytics 4 ingestion |
| `growthIntelligenceService.ts` | Growth intelligence analysis |
| `gscIngestionService.ts` | Google Search Console ingestion |
| `ingestionRunService.ts` | Manages ingestion run lifecycle |
| `ingestionScheduler.ts` | Schedules data ingestion |
| `ingestionUtils.ts` | Ingestion shared utilities |
| `insightViewService.ts` | Insight view/display logic |
| `intelligenceExecutionContext.ts` | Execution context for intelligence |
| `keywordIntelligenceService.ts` | Keyword analysis intelligence |
| `monetizationTriggersService.ts` | Monetization event triggers |
| `readinessScoreService.ts` | Readiness scoring |
| `reportCardService.ts` | Report card generation |
| `userPreferencesService.ts` | User preferences management |

---

### Frontend App (`pages/`)

| Page | Purpose |
|------|---------|
| `_app.tsx` | App wrapper / global providers |
| `index.tsx` | Homepage |
| `home.tsx` | Home dashboard |
| `dashboard.tsx` | Main dashboard |
| `command-center.tsx` | Command center (41 KB) |
| `campaigns.tsx` | Campaign list |
| `campaign-planning.tsx` | Campaign planning UI |
| `campaign-planner.tsx` | Campaign wizard |
| `campaign-proposals.tsx` | Proposal generation |
| `create-campaign.tsx` | New campaign form |
| `content-creation.tsx` | Content builder |
| `content-architect.tsx` | Content structure tool |
| `content-adapter-config.tsx` | Platform adapter settings |
| `content-calendar.tsx` | Calendar view |
| `calendar-view.tsx` | Alternative calendar |
| `creative-scheduler.tsx` | Scheduling interface |
| `scheduler.tsx` | Scheduling dashboard |
| `schedule-review.tsx` | Review scheduled posts |
| `analytics.tsx` | Analytics dashboard |
| `analytics-dashboard.tsx` | Detailed analytics |
| `audience-insights.tsx` | Audience analysis |
| `insights.tsx` | Insights page |
| `engagement-inbox.tsx` | Engagement inbox |
| `community-engagement.tsx` | Community tools |
| `ai-chat.tsx` | AI chat interface |
| `ai-content-generator.tsx` | AI content generation |
| `super-admin.tsx` | Super admin panel |
| `system-dashboard.tsx` | System monitoring |
| `social-platforms.tsx` | Platform configuration |
| `external-apis.tsx` | External API setup |
| `external-apis-access.tsx` | API access controls |
| `team-management.tsx` | Team admin |
| `team-collaboration.tsx` | Collaboration tools |
| `create-account.tsx` | Account creation |
| `signup.tsx` | Signup |
| `login.tsx` | Login |
| `about.tsx` | About page |
| `activity-workspace.tsx` | Activity tracking |
| `blogs.tsx` | Blog management |
| `company-profile.tsx` | Company settings |
| `creative-dashboard.tsx` | Creative tools |
| `data-deletion.tsx` | GDPR data deletion |
| `recommendations.tsx` | Recommendations UI |
| `reports.tsx` | Reporting |
| `reports/` | Report sub-pages |
| `strategy-templates.tsx` | Strategy templates |
| `templates.tsx` | Template library |
| `topic-management.tsx` | Topic / tag management |
| `solutions.tsx` | Solutions page |
| `news-feed.tsx` | News feed |
| `notifications.tsx` | Notifications center |
| `auth/` | Auth sub-pages (callback, etc.) |
| `admin/` | Admin sub-pages |
| `blog/` | Blog content pages |
| `community-ai/` | Community AI pages (connectors, etc.) |

---

### Workers (`backend/workers/`)

| File | Purpose |
|------|---------|
| `main.ts` | **Unified worker entry point** — starts all queues in one process |
| `healthServer.ts` | HTTP health check server on port 8080 |
| `leadWorker.ts` | Lead detection and qualification |
| `leadThreadRecomputeWorker.ts` | Event-driven lead thread scoring |
| `conversationMemoryWorker.ts` | Conversation context rebuilding |
| `conversationTriageWorker.ts` | Routes conversations for AI response |
| `engagementDigestWorker.ts` | Daily engagement summarization |
| `engagementOpportunityDetectionWorker.ts` | Actionable opportunity scanner |
| `influencerLearningWorker.ts` | Influencer engagement pattern learning |
| `insightLearningWorker.ts` | Insight model updates from feedback |
| `intelligencePollingWorker.ts` | External signal ingestion (News, Google Alerts) |
| `opportunityLearningWorker.ts` | Opportunity detection model training |
| `replyIntelligenceAggregationWorker.ts` | Response performance aggregation |
| `responsePerformanceEvaluationWorker.ts` | Response quality scoring |
| `responseStrategyLearningWorker.ts` | Multi-context response strategy learning |
| `buyerIntentLearningWorker.ts` | Buyer intent classification |
| `campaignPlanningWorker.ts` | Campaign planning queue processor |

### Queues (BullMQ)

| Queue Name | Priority | Purpose |
|------------|----------|---------|
| `posting` | 1 (highest) | Time-critical social media post publishing |
| `ai-heavy` | 10 | Campaign planning, AI-intensive operations |
| `publish` | default | General publishing |
| `engagement-polling` | — | LinkedIn / Twitter engagement ingestion |
| `lead-thread-recompute` | — | Event-driven thread scoring |
| `conversation-memory-rebuild` | — | Event-driven conversation memory |
| `engine-jobs` | — | LEAD and MARKET_PULSE processing |
| `bolt-execution` | — | Workflow execution jobs |
| `campaign-planning` | — | AI-heavy campaign planning |
| `intelligence-polling` | — | External signal ingestion |

### Cron Jobs

**`backend/scheduler/cron.ts`** — Master cron (ticks every `CRON_INTERVAL_SECONDS`, default 60s)

| Interval | Tasks |
|----------|-------|
| 1–5 min | Lead thread recompute, conversation memory rebuild, engagement opportunity detection, conversation triage |
| 30 min | Signal clustering, engagement capture, engagement signal scheduling |
| 1–2 hrs | Engagement polling, intelligence polling, signal intelligence, strategic theme engine |
| 3–4 hrs | Community post engine, thread engine, content opportunity engine, narrative engine |
| 6 hrs | Feedback intelligence, company trend relevance, performance ingestion, connector token refresh |
| Daily | Auto-optimization, campaign health evaluation, performance aggregation, governance audits, learning decay |

**`pages/api/cron/`** — HTTP-triggered cron routes (callable by Railway/Vercel cron)

| File | Purpose |
|------|---------|
| `aggregate-blog-analytics.ts` | Aggregates blog post analytics |
| `anomaly-sweep.ts` | Detects anomalies in metrics |
| `autonomous-scheduler.ts` | Auto-scheduling logic |
| `campaign-health-monitor.ts` | Campaign health checks |
| `learning-decay.ts` | Time-decay of learning signals |
| `leverage-optimizer.ts` | Optimizes resource allocation |
| `process-scheduled-posts.ts` | Publishes scheduled posts |

---

## ENTRY POINTS

| File | Role |
|------|------|
| `instrumentation.ts` | Next.js startup hook — conditionally loads Node-only instrumentation |
| `instrumentation.node.ts` | Node.js startup — starts Redis protection; starts workers+cron if `ENABLE_AUTO_WORKERS=1` |
| `backend/workers/main.ts` | **Primary worker process** — starts health server + all BullMQ workers |
| `backend/scheduler/cron.ts` | **Primary cron process** — 50+ scheduled tasks (1 replica only) |
| `config/index.ts` | Configuration module — Zod-validated, deep-frozen, fail-fast on missing vars |
| `pages/_app.tsx` | Next.js frontend entry point |

**API Gateway:** No dedicated API gateway — all API routes are Next.js serverless functions under `pages/api/`.

**Health Check Endpoint:** `GET /health` → served by `backend/workers/healthServer.ts` on port 8080 (workers service only). Next.js rewrites `/health` → `/api/health`.

---

## INFRASTRUCTURE

### Supabase (Primary Database)

| Item | Detail |
|------|--------|
| Client | `backend/db/supabaseClient.ts` — singleton, service-role key |
| Pattern | Lazy initialization (deferred for Vercel build) |
| Auth | Service role (RLS bypass for backend) + Anon key (frontend) |
| Direct Postgres | `SUPABASE_DB_URL` — transaction pooler port 6543, migrations only |
| Proxy | `.from()` calls intercepted to track read/write counts |

**Migrations (`supabase/migrations/`)**

| File | Purpose |
|------|---------|
| `20260329_missing_tables.sql` | Adds missing tables |
| `20260329_reports_free_tracking.sql` | Free report tracking |
| `20260329_reports_generation_guardrails.sql` | Report generation limits |
| `20260329_reports_table.sql` | Reports table |
| `20260329_system_health_metrics.sql` | System health metrics table |
| `20260409_canonical_intelligence_model.sql` | Intelligence model schema |
| `20260410_decision_object_enforcement.sql` | Decision object enforcement |
| `20260411_decision_intelligence_stabilization.sql` | Decision intelligence stability fixes |
| `20260412_decision_generation_controls.sql` | Decision generation control table |
| `20260413_decision_feature_views.sql` | Decision feature views |
| `20260414_native_feature_issue_views.sql` | Feature issue views |
| `20260428_feature_completion_tracking.sql` | Feature completion tracking |
| `20260428_user_preferences.sql` | User preferences table |
| `20260429_data_ingestion_layer.sql` | Data ingestion layer tables |
| `supabase/rls_policies.sql` | Row-level security policies |

### Redis

| Item | Detail |
|------|--------|
| Provider | Upstash (production), local Redis 7 (dev via docker-compose) |
| Client library | IORedis 5.9.3 |
| TLS | Auto-detected for `rediss://` URLs (Upstash) |
| Client files | `lib/redis/client.ts`, `lib/redis/resilientClient.ts` |
| Usage protection | `lib/redis/usageProtection.ts` — daily command limits, overflow buffering |
| Instrumentation | `lib/redis/instrumentation.ts` — ops tracking |
| Failure strategy | `lib/redis/failureStrategy.ts` — graceful degradation |
| Queue blocker | Queues blocked at critical Redis usage threshold |
| Alert config | `.redis-usage-alert.json` |

### Queue System (BullMQ)

| Item | Detail |
|------|--------|
| Library | BullMQ 5.68.0 over IORedis |
| Client | `backend/queue/bullmqClient.ts` |
| Instrumentation | `backend/queue/queueInstrumentation.ts` |
| Stable IDs | `makeStableJobId()` — prevents duplicate job enqueueing |
| Throttling | Fan-out capped during high Redis usage |

### Storage

| Item | Detail |
|------|--------|
| Media storage | Supabase Storage (via `mediaService.ts`) |
| Image search | Unsplash, Pexels, Pixabay (external APIs) |
| Remote image domains | `*.supabase.co`, `unsplash.com` (configured in `next.config.js`) |

### External APIs / Integrations

| Service | Purpose |
|---------|---------|
| OpenAI | Primary AI (gpt-4o-mini default) |
| Anthropic Claude | Optional AI |
| Firebase | Phone OTP authentication |
| LinkedIn v2 API | Social publishing + OAuth |
| Twitter / X API v2 | Social publishing + OAuth |
| Facebook Graph API v2.1 | Social publishing + OAuth |
| Instagram Graph API | Social publishing + OAuth |
| YouTube Data API v3 | Video publishing + OAuth |
| TikTok Content API v2.1 | Video publishing + OAuth |
| Pinterest API v5 | Pin publishing + OAuth |
| Spotify Web API | Playlist publishing + OAuth |
| StarMaker API | Karaoke publishing |
| Suno API | AI music publishing |
| NewsAPI | Trend / signal ingestion |
| SerpAPI / SearchAPI | Search signal ingestion |
| Unsplash / Pexels / Pixabay | Stock image search |

### Platform Adapters (`backend/adapters/`)

| File | Platform | Key Scopes |
|------|----------|-----------|
| `facebookAdapter.ts` | Facebook Pages | pages_manage_posts, pages_read_engagement |
| `instagramAdapter.ts` | Instagram | instagram_basic, instagram_content_publish |
| `linkedinAdapter.ts` | LinkedIn | w_member_social, r_member_social |
| `youtubeAdapter.ts` | YouTube | youtube.upload |
| `tiktokAdapter.ts` | TikTok | video.upload, user.info.basic |
| `xAdapter.ts` | X (Twitter) | tweet.write, tweet.read |
| `pinterestAdapter.ts` | Pinterest | pins:read, pins:write |
| `spotifyAdapter.ts` | Spotify | playlist-modify-public/private |
| `starmakerAdapter.ts` | StarMaker | — |
| `sunoAdapter.ts` | Suno AI | — |
| `platformAdapter.ts` | Base interface | Abstract types + error handling |

---

## ENVIRONMENTS

### Dev

| Item | Detail |
|------|--------|
| App | `npm run dev` (Next.js dev server) |
| Workers | `npm run start:workers` (ts-node) |
| Cron | `npm run start:cron` (ts-node) |
| All services | `npm run worker:all` or `scripts/start-all.js` |
| Redis | Local via `docker-compose up` (redis:7, port 6379) |
| Env file | `.env.local` |
| Mock platforms | `USE_MOCK_PLATFORMS=true` |
| Dev overrides | `DEV_ROLE`, `DEV_COMPANY_IDS`, `DEV_USER_ID` |

### Test

| Item | Detail |
|------|--------|
| Runner | Jest (serial, `--runInBand`) |
| Config | `jest.config.js` |
| Test dirs | `backend/tests/unit/`, `backend/tests/integration/` |
| Env file | `.env.test` |
| Global teardown | `backend/tests/globalTeardown.ts` |

### Production

| Item | Detail |
|------|--------|
| Frontend | Vercel (Next.js) |
| Workers | Railway — `Dockerfile.worker`, `railway.json` |
| Cron | Railway — `Dockerfile.cron` (**must run as 1 replica**) |
| Redis | Upstash (managed, `rediss://` TLS) |
| Database | Supabase (hosted PostgreSQL) |
| Env file | Vercel / Railway dashboard env vars |
| App URL | `https://www.omnivyra.com` |

### Deployment Files

| File | Purpose |
|------|---------|
| `Dockerfile.worker` | Multi-stage build for workers (node:20-alpine) |
| `Dockerfile.cron` | Multi-stage build for cron (node:20-alpine, 1 replica) |
| `docker-compose.yml` | Local dev Redis only |
| `railway.json` | Railway config — Dockerfile.worker, restart on failure (max 5) |
| `tsconfig.worker.json` | TypeScript config for worker builds |
| `.env.example` | Canonical env var template |
| `.env.local` | Local dev (git-ignored) |
| `.env.test` | Test environment |
| `.env.vercel.local` | Vercel local override |
| `scripts/clean.js` | Build artifact cleanup |
| `scripts/start-all.js` | Starts all services for local dev |

---

## ENVIRONMENT VARIABLES

### Supabase (Database)

| Key | Description |
|-----|-------------|
| `SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Client-side URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend admin key (bypasses RLS) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anonymous client key |
| `SUPABASE_DB_URL` | Direct Postgres connection (migrations, port 6543) |

### Redis

| Key | Description |
|-----|-------------|
| `REDIS_URL` | Connection string (`redis://` or `rediss://`) |
| `UPSTASH_REDIS_REST_URL` | Upstash REST endpoint (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash auth token (optional) |

### OpenAI

| Key | Description |
|-----|-------------|
| `OPENAI_API_KEY` | API key |
| `OPENAI_RESPONSES_MODEL` | Model override (default: `gpt-4o-mini`) |
| `OPENAI_TIMEOUT` | Request timeout ms (default: 60000) |
| `OPENAI_MAX_RETRIES` | Retry count (default: 3) |

### Anthropic Claude

| Key | Description |
|-----|-------------|
| `ANTHROPIC_API_KEY` | API key (optional) |

### App Configuration

| Key | Description |
|-----|-------------|
| `NEXT_PUBLIC_APP_URL` | Public app URL |
| `ENABLE_AUTO_WORKERS` | Auto-start workers in Next.js process (`0`/`1`) |
| `USE_MOCK_PLATFORMS` | Use mock platform adapters (`false` in prod) |
| `CRON_INTERVAL_SECONDS` | Cron tick interval (default: `60`) |
| `PORT` | Worker health server port (default: `3001`) |

### Firebase (Phone OTP)

| Key | Description |
|-----|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |

### Encryption

| Key | Description |
|-----|-------------|
| `ENCRYPTION_KEY` | 64-char hex string (256-bit AES key for credential encryption) |

### OAuth — LinkedIn

| Key | Description |
|-----|-------------|
| `LINKEDIN_CLIENT_ID` | LinkedIn OAuth client ID |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn OAuth client secret |

### OAuth — Twitter / X

| Key | Description |
|-----|-------------|
| `TWITTER_CLIENT_ID` | Twitter/X OAuth client ID |
| `TWITTER_CLIENT_SECRET` | Twitter/X OAuth client secret |
| `X_CLIENT_ID` | Alias for `TWITTER_CLIENT_ID` |
| `X_CLIENT_SECRET` | Alias for `TWITTER_CLIENT_SECRET` |

### OAuth — Facebook & Instagram

| Key | Description |
|-----|-------------|
| `FACEBOOK_CLIENT_ID` | Facebook OAuth client ID |
| `FACEBOOK_CLIENT_SECRET` | Facebook OAuth client secret |
| `FACEBOOK_APP_ID` | Facebook app ID (token refresh) |
| `FACEBOOK_APP_SECRET` | Facebook app secret (token refresh) |
| `FACEBOOK_REDIRECT_URI` | Facebook OAuth redirect URI |
| `INSTAGRAM_CLIENT_ID` | Instagram OAuth client ID |
| `INSTAGRAM_CLIENT_SECRET` | Instagram OAuth client secret |

### OAuth — YouTube

| Key | Description |
|-----|-------------|
| `YOUTUBE_CLIENT_ID` | YouTube OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth client secret |

### Media APIs

| Key | Description |
|-----|-------------|
| `UNSPLASH_ACCESS_KEY` | Unsplash image search |
| `PEXELS_API_KEY` | Pexels image search |
| `PIXABAY_API_KEY` | Pixabay image search |

### Search & News

| Key | Description |
|-----|-------------|
| `NEWS_API_KEY` | NewsAPI |
| `SERP_API_KEY` | SerpAPI |
| `SEARCH_API_KEY` | Generic search API |

### Autoscaling

| Key | Description |
|-----|-------------|
| `AUTOSCALE_WEBHOOK_URL` | Webhook for queue depth alerts |
| `AUTOSCALE_SIGNAL_FILE` | Local signal file (default: `/tmp/omnivyra-autoscale`) |

### Governance & Security

| Key | Description |
|-----|-------------|
| `GOVERNANCE_POLICY_EXPECTED_HASH` | SHA-256 hash for policy integrity verification |
| `CONTENT_ARCHITECT_PASSWORD` | Password for content architect module |
| `DISABLE_AUDIT_LOGGING` | Disable audit logs (`true` in dev only) |
| `INTERNAL_METRICS_SECRET` | 32-byte hex secret for internal metrics endpoint |

### Feature Flags

| Key | Description |
|-----|-------------|
| `ENABLE_UNIFIED_CAMPAIGN_WIZARD` | Server-side flag for unified campaign wizard |
| `NEXT_PUBLIC_ENABLE_UNIFIED_CAMPAIGN_WIZARD` | Client-side flag |
| `ENABLE_PLANNER_ADAPTER` | Enable planner adapter |

### Dev-Only Overrides (never in production)

| Key | Description |
|-----|-------------|
| `DEV_ROLE` | Override authenticated user role |
| `DEV_COMPANY_IDS` | Override company context |
| `DEV_USER_ID` | Override user ID |

---

## SUMMARY STATISTICS

| Category | Count |
|----------|-------|
| Backend services | 340+ |
| Worker types | 17 |
| BullMQ queues | 10 |
| Cron tasks (scheduler) | 50+ |
| API cron routes | 7 |
| External platform adapters | 11 |
| Frontend pages | 59+ |
| API routes | 300+ |
| Environment variable keys | 55+ |
| Supabase migrations | 15 |
| Deployment targets | 3 (Vercel, Railway workers, Railway cron) |
