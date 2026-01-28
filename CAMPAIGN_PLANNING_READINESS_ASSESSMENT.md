# Campaign Planning & Readiness System: Factual Assessment

**Date:** 2025-01-23  
**Scope:** Campaign, Planning, Assets, Readiness, Scheduling Gates, Job Linkage  
**Method:** Codebase analysis only (no redesign proposals)

---

## 1. What Exists (Confirmed)

### Campaign Models & Tables

- **`campaigns` table** (`database/campaign-management-clean-schema.sql:45-60`)
  - Purpose: Root entity for campaign management
  - Fields: `id`, `user_id`, `name`, `description`, `status`, `current_stage`, `timeframe`, `start_date`, `end_date`, `thread_id`, `launched_at`, `completed_at`
  - Status values: `'planning'`, `'market-analysis'`, `'content-creation'`, `'schedule-review'`, `'active'`, `'completed'`, `'paused'`, `'cancelled'`
  - **Status:** Actively used (referenced in multiple API endpoints)

- **`campaign_goals` table** (`database/campaign-management-clean-schema.sql:62-74`)
  - Purpose: Detailed objectives per campaign
  - Fields: `campaign_id`, `content_type`, `platform`, `quantity`, `frequency`, `target_audience`, `objectives` (TEXT[]), `metrics` (JSONB)
  - **Status:** Schema exists, usage unclear from codebase search

- **`campaign_strategies` table** (`database/enhanced-content-planning-schema.sql:10-37`)
  - Purpose: Comprehensive campaign strategy storage
  - Fields: `campaign_id`, `objective`, `target_audience`, `key_platforms`, `campaign_phases` (JSONB), `content_pillars` (JSONB), `content_frequency` (JSONB), `overall_goals` (JSONB), `weekly_kpis` (JSONB)
  - **Status:** Schema exists, usage unclear

### Planning Structures

- **`weekly_content_refinements` table** (`db-utils/safe-database-migration.sql:192-208`)
  - Purpose: 12-week campaign structure with weekly themes
  - Fields: `campaign_id`, `week_number`, `theme`, `focus_area`, `refinement_status`, `content_plan` (JSONB), `performance_targets` (JSONB), `marketing_channels` (TEXT[])
  - Status values: `'ai_enhanced'`, `'user_edited'`, `'approved'` (inferred from refinement_status)
  - **Status:** Actively used (referenced in `backend/services/riskAssessor.ts:74-93`)

- **`weekly_content_plans` table** (`database/enhanced-content-planning-schema.sql:40-73`)
  - Purpose: Enhanced weekly planning with completion tracking
  - Fields: `campaign_id`, `week_number`, `phase`, `theme`, `focus_area`, `content_types` (TEXT[]), `platform_strategy` (JSONB), `status`, `completion_percentage`
  - Status values: `'planned'`, `'in_progress'`, `'completed'`
  - **Status:** Schema exists, referenced in `pages/api/campaigns/metrics.ts:246-249` for completion calculation

- **`daily_content_plans` table** (`database/enhanced-content-planning-schema.sql:76-115`, `db-utils/safe-database-migration.sql:211-233`)
  - Purpose: Daily content breakdown by platform
  - Fields: `campaign_id`, `week_number`, `day_of_week`, `date`, `platform`, `content_type`, `content`, `hashtags`, `media_requirements` (JSONB), `status`, `scheduled_post_id` (nullable FK)
  - Status values: `'planned'`, `'content-created'`, `'media-ready'`, `'scheduled'`, `'published'`, `'failed'` (from one schema) OR `'planned'`, `'scheduled'`, `'published'`, `'completed'` (from another)
  - **Status:** Schema exists (multiple versions), linkage to `scheduled_posts` via `scheduled_post_id` exists

### Job Linkage

- **`queue_jobs` table** (`db-utils/safe-database-migration.sql:339-396` - inferred from references)
  - Purpose: Background job queue for publishing
  - Fields: `id`, `scheduled_post_id` (FK), `job_type`, `status`, `scheduled_for`, `priority`, `attempts`, `max_attempts`
  - **Linkage:** `queue_jobs.scheduled_post_id` → `scheduled_posts.id`
  - **Status:** Actively used (`backend/scheduler/schedulerService.ts:86-93`, `backend/queue/jobProcessors/publishProcessor.ts`)

- **`scheduled_posts` table** (`db-utils/critical-missing-tables.sql:73-162`)
  - Purpose: Unified content scheduling across platforms
  - Fields: `id`, `user_id`, `social_account_id`, `campaign_id` (nullable FK), `platform`, `content_type`, `content`, `scheduled_for`, `status`, `published_at`, `platform_post_id`
  - Status values: `'draft'`, `'scheduled'`, `'publishing'`, `'published'`, `'failed'`, `'cancelled'`
  - **Linkage:** `scheduled_posts.campaign_id` → `campaigns.id` (nullable)
  - **Status:** Actively used (core scheduling entity)

### Progress/Completion Tracking

- **Campaign Progress API** (`pages/api/campaigns/[id]/progress.ts`)
  - Purpose: Calculate campaign progress based on scheduled/published posts
  - Logic: Counts `scheduled_posts` with `status='scheduled'` and `status='published'` for a campaign
  - Returns: `scheduled_posts`, `published_posts`, `total_posts`, `progress_percentage`
  - **Status:** Implemented and used (`pages/index.tsx:878`)

- **Campaign Completion Update** (`pages/api/campaigns/metrics.ts:243-281`)
  - Purpose: Update campaign status based on weekly plan completion
  - Logic: Aggregates `completion_percentage` from `weekly_content_plans`, sets campaign `status` to `'completed'` if >= 100%, `'active'` if >= 50%
  - **Status:** Implemented but references `weekly_content_plans` (may not match actual table name)

### Risk Assessment

- **Risk Assessment Service** (`backend/services/riskAssessor.ts`)
  - Purpose: Calculate risk scores for campaign readiness
  - Checks: Missing social accounts, incomplete content plans, missing media, date conflicts, missing dates
  - Returns: Risk score (0-100), risk level (`'low'`, `'medium'`, `'high'`), factors, mitigation suggestions
  - **Status:** Implemented and functional

---

## 2. What Exists but Is Incomplete

### Readiness Logic

- **Readiness Checklist** (`DEVELOPMENT_BACKLOG_ENRICHED.json:225-266`)
  - **Status:** Planned but not implemented
  - Expected: `GET /api/campaigns/[id]/readiness` endpoint
  - Expected checks: Social accounts connected, weekly plans created, daily plans created, media uploaded, posts scheduled
  - **Current State:** Only risk assessment exists (`backend/services/riskAssessor.ts`), no explicit readiness percentage or blocking logic

### Asset Representation

- **Media Files Table** (`db-utils/safe-database-migration.sql:263-288`)
  - Purpose: Store media assets
  - Fields: `id`, `user_id`, `campaign_id` (nullable FK), `filename`, `file_url`, `media_type`, `platforms` (TEXT[]), `usage_count`
  - **Status:** Schema exists, linkage to campaigns exists, but:
    - No explicit "asset readiness" status
    - No validation that required media exists before scheduling
    - Media referenced in `scheduled_posts.media_urls` (TEXT[]) but not enforced

- **Content as Assets**
  - **Daily Content Plans** have `status` field but no explicit "asset" concept
  - **Scheduled Posts** contain content but are execution entities, not planning assets
  - **Gap:** No unified "asset" model that tracks readiness state (content ready, media ready, etc.)

### Planning Flow

- **Campaign Status Transitions**
  - Schema defines: `'planning'`, `'market-analysis'`, `'content-creation'`, `'schedule-review'`, `'active'`, `'completed'`, `'paused'`, `'cancelled'`
  - **Reality:** No explicit state machine or transition guards found in codebase
  - Status updated manually or via completion percentage (`pages/api/campaigns/metrics.ts:262-267`)

- **Weekly to Daily Planning**
  - Schema supports: `daily_content_plans.week_number` links to `weekly_content_refinements.week_number`
  - **Reality:** Linkage exists but no enforcement that daily plans must exist before scheduling
  - No validation that all weeks have daily plans before campaign can be "ready"

### Scheduling Gates

- **Scheduler Service** (`backend/scheduler/schedulerService.ts:33-119`)
  - Purpose: Find due posts and enqueue them
  - **Current Logic:** 
    - Queries `scheduled_posts` where `status='scheduled'` AND `scheduled_for <= NOW()`
    - Creates `queue_jobs` for each due post
    - **No readiness checks:** Does not verify campaign readiness, asset availability, or planning completeness before enqueueing
  - **Status:** Functional but no gates/guards

- **Publish Processor** (`backend/queue/jobProcessors/publishProcessor.ts`)
  - Purpose: Execute publish jobs
  - **Current Logic:**
    - Checks job idempotency
    - Publishes to platform
    - Updates `scheduled_posts.status` to `'published'`
  - **No readiness checks:** Does not verify campaign readiness before publishing

---

## 3. What Is Missing

### Data Models

- **Explicit Readiness State**
  - No `campaign_readiness` table or readiness score field on `campaigns`
  - No readiness checklist items table
  - No readiness history/audit trail

- **Asset Readiness Tracking**
  - No `asset_readiness` or `content_asset` table
  - No status tracking for "content ready", "media ready", "scheduled ready"
  - Media files exist but no validation that required media is attached to daily plans or scheduled posts

- **Planning Completeness**
  - No validation that all 12 weeks have plans
  - No validation that all daily plans within a week exist
  - No "planning complete" flag or percentage

- **Job-to-Campaign Direct Linkage**
  - `queue_jobs` links to `scheduled_posts` only (via `scheduled_post_id`)
  - `scheduled_posts` links to `campaigns` (via `campaign_id`, nullable)
  - **Gap:** No direct `campaign_id` on `queue_jobs` for campaign-level job queries
  - **Gap:** No campaign-level job aggregation or status

### Logic

- **Readiness Calculation**
  - No explicit readiness percentage calculation
  - No readiness checklist evaluation
  - Risk assessment exists but is not used as a readiness gate

- **Planning Validation**
  - No validation that weekly plans are complete before daily planning
  - No validation that daily plans are complete before scheduling
  - No validation that required assets (media) exist before scheduling

- **Scheduling Gates/Guards**
  - No check that campaign is "ready" before allowing posts to be scheduled
  - No check that campaign is "active" before enqueueing jobs
  - No check that required assets exist before publishing
  - Scheduler enqueues any post with `status='scheduled'` regardless of campaign state

- **Status Transition Guards**
  - No enforcement that campaign must be in `'schedule-review'` before moving to `'active'`
  - No enforcement that all planning steps are complete before status changes
  - Status changes appear to be manual or based only on completion percentage

### Orchestration

- **Campaign Lifecycle Orchestration**
  - No explicit workflow engine or state machine
  - No automated progression from `'planning'` → `'content-creation'` → `'schedule-review'` → `'active'`
  - Each stage appears to be manually triggered

- **Planning-to-Execution Bridge**
  - `daily_content_plans` can link to `scheduled_posts` via `scheduled_post_id`
  - **Gap:** No automated process to create `scheduled_posts` from `daily_content_plans`
  - **Gap:** No validation that daily plan is "ready" before creating scheduled post

- **Readiness-to-Scheduling Bridge**
  - No process that checks readiness before allowing scheduling
  - No process that blocks scheduling if readiness checks fail
  - Scheduling appears to be independent of readiness state

### Guards

- **Pre-Scheduling Guards**
  - No guard preventing `scheduled_posts` creation if campaign is not ready
  - No guard preventing scheduling if weekly/daily plans are incomplete
  - No guard preventing scheduling if required media is missing

- **Pre-Execution Guards**
  - No guard in scheduler service checking campaign readiness
  - No guard in publish processor checking campaign readiness
  - No guard checking asset availability before publishing

- **Status Transition Guards**
  - No guard preventing status change to `'active'` if readiness checks fail
  - No guard preventing status change to `'completed'` if not all posts published
  - Status changes appear unguarded

---

## 4. Execution Reality Summary

**Current Behavior:**

Campaigns are created with `status='planning'`. Users can create weekly plans (`weekly_content_refinements`) and daily plans (`daily_content_plans`) independently. There is no enforcement that all weeks are planned or that daily plans exist for each week.

Users can create `scheduled_posts` at any time, linking them to campaigns via `campaign_id` (nullable). The scheduler service (`backend/scheduler/schedulerService.ts`) runs periodically (via cron) and queries for `scheduled_posts` where `status='scheduled'` and `scheduled_for <= NOW()`. It creates `queue_jobs` for these posts without checking:
- Campaign readiness
- Campaign status
- Asset availability
- Planning completeness

The publish processor (`backend/queue/jobProcessors/publishProcessor.ts`) executes jobs without readiness checks. It publishes posts if they have `status='scheduled'` and no `platform_post_id`.

Campaign status is updated based on completion percentage (`pages/api/campaigns/metrics.ts:243-281`), but this calculation references `weekly_content_plans` which may not be the active table. Status can be `'planning'`, `'active'` (if completion >= 50%), or `'completed'` (if completion >= 100%), but these status values do not block execution.

**In Summary:** Campaigns can have posts scheduled and published even if planning is incomplete, assets are missing, or the campaign is not in an "active" state. There are no gates preventing execution based on readiness.

---

## File References Summary

### Active/Used Files
- `database/campaign-management-clean-schema.sql` - Campaign tables
- `db-utils/safe-database-migration.sql` - Weekly/daily planning tables
- `backend/services/riskAssessor.ts` - Risk assessment (functional)
- `backend/scheduler/schedulerService.ts` - Scheduler (no gates)
- `backend/queue/jobProcessors/publishProcessor.ts` - Job execution (no gates)
- `pages/api/campaigns/[id]/progress.ts` - Progress calculation
- `pages/api/campaigns/metrics.ts` - Completion update

### Planned but Not Implemented
- `DEVELOPMENT_BACKLOG_ENRICHED.json:225-266` - Readiness checklist (planned)

### Schema Files (Multiple Versions)
- `database/enhanced-content-planning-schema.sql` - Enhanced planning schema
- `database/enhanced-content-planning-migration.sql` - Migration scripts
- Multiple schema files with overlapping/conflicting definitions

---

**Assessment Complete.**  
**No redesign proposals included per requirements.**
