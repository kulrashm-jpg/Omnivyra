# 🏗️ Project Architecture Documentation
## Database Module & System Functionality

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Database Module](#database-module)
4. [Module Functionality](#module-functionality)
5. [Data Flow & Relationships](#data-flow--relationships)
6. [API Structure](#api-structure)
7. [Key Features & Workflows](#key-features--workflows)
8. [Technology Stack](#technology-stack)

---

## 🎯 Project Overview

**Virality Engine** is a comprehensive social media management and campaign planning platform designed to help users create, schedule, publish, and analyze content across multiple social media platforms.

### Core Purpose
- **Content Planning**: 12-week strategic campaign planning with AI assistance
- **Content Creation**: Multi-platform content creation with platform-specific formatting
- **Scheduling**: Automated scheduling and publishing to social media platforms
- **Analytics**: Performance tracking and optimization insights
- **AI Integration**: AI-powered content generation, improvement, and optimization

### Supported Platforms
- LinkedIn
- Twitter/X
- Instagram
- Facebook
- YouTube
- TikTok

---

## 🏛️ System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND LAYER                           │
│  Next.js 15 + React 18 + TypeScript + Tailwind CSS          │
│  - Campaign Planning UI                                      │
│  - Content Creation Interfaces                               │
│  - Analytics Dashboards                                      │
│  - AI Chat Interfaces                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ HTTP/REST API
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                     API LAYER                                │
│  Next.js API Routes (/api/*)                                 │
│  - Campaign Management                                        │
│  - Content Operations                                        │
│  - AI Services                                                │
│  - Social Media Integration                                  │
│  - Analytics & Reporting                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
┌─────────▼───┐ ┌──────▼──────┐ ┌──▼─────────────┐
│  DATABASE   │ │  QUEUE      │ │  EXTERNAL      │
│  (Supabase) │ │  (BullMQ)   │ │  APIs          │
│             │ │             │ │  (AI, Social)   │
└─────────────┘ └─────────────┘ └────────────────┘
```

### Component Architecture

1. **Presentation Layer** (Frontend)
   - User interface components
   - Forms and data entry
   - Real-time previews
   - Analytics visualizations

2. **Application Layer** (API Routes)
   - Business logic
   - Data validation
   - Authentication/Authorization
   - External service integration

3. **Data Layer** (Database)
   - PostgreSQL (via Supabase)
   - Structured data storage
   - Relationships and constraints
   - Performance optimization

4. **Processing Layer** (Background Jobs)
   - Queue system (BullMQ/Redis)
   - Scheduled publishing
   - Media processing
   - Analytics aggregation

---

## 🗄️ Database Module

### Database Technology

- **Database**: PostgreSQL (via Supabase)
- **ORM/Access**: Supabase JavaScript Client
- **Connection**: REST API + WebSocket for real-time features
- **Location**: Cloud-hosted (Supabase)

### Database Schema Overview

The database consists of **21 core tables** organized into 7 functional modules:

```
┌──────────────────────────────────────────────────────────────┐
│                    DATABASE MODULES                           │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. USER & AUTHENTICATION MODULE                            │
│     ├─ users                                                 │
│     └─ social_accounts                                      │
│                                                               │
│  2. CAMPAIGN PLANNING MODULE                                │
│     ├─ campaigns                                            │
│     ├─ campaign_goals                                       │
│     ├─ weekly_content_refinements                          │
│     └─ daily_content_plans                                  │
│                                                               │
│  3. CONTENT MANAGEMENT MODULE                               │
│     ├─ content_templates                                    │
│     ├─ scheduled_posts                                      │
│     └─ recurring_posts                                      │
│                                                               │
│  4. MEDIA MANAGEMENT MODULE                                 │
│     ├─ media_files                                         │
│     └─ scheduled_post_media                                │
│                                                               │
│  5. BACKGROUND PROCESSING MODULE                            │
│     ├─ queue_jobs                                          │
│     └─ queue_job_logs                                       │
│                                                               │
│  6. ANALYTICS & REPORTING MODULE                            │
│     ├─ content_analytics                                    │
│     ├─ platform_performance                                │
│     ├─ hashtag_performance                                  │
│     ├─ ai_content_analysis                                 │
│     ├─ optimal_posting_times                               │
│     ├─ audience_insights                                   │
│     ├─ competitor_analysis                                 │
│     └─ roi_analysis                                         │
│                                                               │
│  7. SYSTEM & CONFIGURATION MODULE                           │
│     ├─ notifications                                        │
│     ├─ platform_configurations                             │
│     └─ system_settings                                      │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## 📊 Module Functionality

### 1. USER & AUTHENTICATION MODULE

#### Tables

**`users`**
- **Purpose**: Core user account information
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `email` (Unique identifier)
  - `name` (User display name)
  - `created_at`, `updated_at` (Timestamps)
- **Functionality**: Stores basic user profile data

**`social_accounts`**
- **Purpose**: Connected social media platform accounts
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `platform` (VARCHAR: 'linkedin', 'twitter', etc.)
  - `platform_user_id` (Platform-specific user ID)
  - `access_token`, `refresh_token` (OAuth credentials)
  - `token_expires_at` (Token expiration)
  - `is_active` (Boolean flag)
  - `permissions` (Array of granted scopes)
- **Functionality**:
  - Stores OAuth credentials for each connected platform
  - Tracks account status and permissions
  - Enables multi-platform publishing

**Relationships**:
- `users` 1:N `social_accounts`
- `users` 1:N `campaigns`

---

### 2. CAMPAIGN PLANNING MODULE

#### Tables

**`campaigns`**
- **Purpose**: Marketing campaign definitions and metadata
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `name` (Campaign name)
  - `description` (Campaign description)
  - `start_date`, `end_date` (Campaign timeline)
  - `status` (VARCHAR: 'planning', 'active', 'completed', etc.)
  - `key_messages` (TEXT[]: Core messaging points)
  - `success_metrics` (TEXT[]: KPIs to track)
  - `created_at`, `updated_at` (Timestamps)
- **Functionality**:
  - Root entity for all campaign activities
  - Stores campaign strategy and objectives
  - Tracks campaign lifecycle status

**`campaign_goals`**
- **Purpose**: Detailed objectives for campaigns
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `campaign_id` (FK → campaigns.id)
  - `content_type` (Type of content)
  - `platform` (Target platform)
  - `quantity` (Target number of posts)
  - `metrics` (JSONB: Engagement targets)
- **Functionality**: Defines specific, measurable campaign objectives

**`weekly_content_refinements`**
- **Purpose**: 12-week campaign structure with weekly themes
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `campaign_id` (FK → campaigns.id)
  - `week_number` (INTEGER: 1-12)
  - `theme` (Weekly theme)
  - `focus_area` (Main focus for the week)
  - `marketing_channels` (TEXT[]: Platforms to use)
  - `existing_content` (TEXT: Pre-existing content to incorporate)
  - `content_notes` (TEXT: Additional context)
  - `content_plan` (JSONB: Structured weekly plan)
  - `performance_targets` (JSONB: Weekly KPIs)
  - `refinement_status` (VARCHAR: 'ai_enhanced', 'user_edited', 'approved')
- **Functionality**:
  - Enables 12-week strategic planning
  - Stores weekly themes and focus areas
  - Tracks refinement and approval status
  - Supports AI enhancement workflow

**`daily_content_plans`**
- **Purpose**: Daily content breakdown by platform
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `campaign_id` (FK → campaigns.id)
  - `week_number` (Which week this day belongs to)
  - `day_of_week` (VARCHAR: 'Monday', 'Tuesday', etc.)
  - `date` (DATE: Specific date)
  - `platform` (Target platform)
  - `content_type` (Platform-specific content type)
  - `topic` (Content topic/subject)
  - `content` (Actual content text)
  - `hashtags` (TEXT[]: Relevant hashtags)
  - `scheduled_post_id` (FK → scheduled_posts.id, nullable)
  - `status` (VARCHAR: 'planned', 'created', 'scheduled', 'published')
  - `marketing_channels`, `existing_content`, `content_notes`
- **Functionality**:
  - Breaks down weekly plans into daily, platform-specific content
  - Links daily plans to scheduled posts when published
  - Tracks content creation and publishing status
  - Supports AI-generated content adjustments

**Relationships**:
- `campaigns` 1:N `campaign_goals`
- `campaigns` 1:N `weekly_content_refinements`
- `campaigns` 1:N `daily_content_plans`
- `campaigns` 1:N `scheduled_posts`
- `weekly_content_refinements` 1:N `daily_content_plans` (via week_number)

**Data Flow**:
```
Campaign Created
    ↓
12-Week Structure Generated (weekly_content_refinements)
    ↓
Weekly Themes Defined
    ↓
Daily Plans Created (daily_content_plans)
    ↓
Content Scheduled (scheduled_posts)
    ↓
Published to Platforms
```

---

### 3. CONTENT MANAGEMENT MODULE

#### Tables

**`content_templates`**
- **Purpose**: Reusable content templates with variables
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `campaign_id` (FK → campaigns.id, nullable)
  - `name` (Template name)
  - `content` (Template text with variables)
  - `platform` (Target platform)
  - `content_type` (Type of content)
  - `variables` (JSONB: Template variables like {name}, {company})
  - `media_requirements` (JSONB: Media specs)
  - `usage_count` (Usage tracking)
- **Functionality**: Enables content reuse and templating

**`scheduled_posts`**
- **Purpose**: Central table for all scheduled/published content across platforms
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `social_account_id` (FK → social_accounts.id)
  - `campaign_id` (FK → campaigns.id, nullable)
  - `template_id` (FK → content_templates.id, nullable)
  - `platform` (VARCHAR: Platform name)
  - `content_type` (VARCHAR: 'post', 'article', 'video', etc.)
  - `title`, `content` (Content fields)
  - `hashtags`, `mentions` (TEXT[])
  - `scheduled_for` (TIMESTAMP: When to publish)
  - `timezone` (Timezone for scheduling)
  - `status` (VARCHAR: 'draft', 'scheduled', 'publishing', 'published', 'failed')
  - `published_at` (When actually published)
  - `post_url`, `platform_post_id` (Platform response data)
  - Media fields (video, image, audio specific)
  - Performance tracking fields (views, likes, shares, etc.)
  - AI assessment scores
- **Functionality**:
  - **Unified content storage** across all platforms
  - Platform-specific field support (video duration, image dimensions, etc.)
  - Thread/series support (Twitter threads, Instagram carousels)
  - Status tracking through publishing lifecycle
  - Error handling and retry logic
  - Performance metrics storage

**`recurring_posts`**
- **Purpose**: Automated recurring content generation
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id`, `social_account_id` (Owner and account)
  - `frequency` (VARCHAR: 'daily', 'weekly', 'monthly', 'custom')
  - `content_template` (Template text)
  - `days_of_week`, `time_of_day` (Scheduling pattern)
  - `next_post_at` (Next scheduled time)
- **Functionality**: Automates repetitive content publishing

**Relationships**:
- `scheduled_posts` N:1 `social_accounts`
- `scheduled_posts` N:1 `campaigns` (optional)
- `scheduled_posts` N:1 `content_templates` (optional)
- `scheduled_posts` N:1 `scheduled_posts` (parent_post_id for threads)

---

### 4. MEDIA MANAGEMENT MODULE

#### Tables

**`media_files`**
- **Purpose**: Centralized media file storage and metadata
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `campaign_id` (FK → campaigns.id, nullable)
  - `filename`, `file_url`, `file_path` (Storage info)
  - `file_size`, `mime_type` (File properties)
  - `media_type` (VARCHAR: 'image', 'video', 'audio', 'document')
  - `width`, `height`, `duration` (Media properties)
  - `platforms` (TEXT[]: Compatible platforms)
  - `ai_tags`, `ai_description` (AI-generated metadata)
  - `content_moderation_score` (Safety score)
  - `usage_count` (Usage tracking)
- **Functionality**:
  - Stores media file metadata (not the files themselves)
  - Tracks platform compatibility
  - AI-powered tagging and description
  - Content moderation scoring

**`scheduled_post_media`**
- **Purpose**: Many-to-many relationship between posts and media
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `scheduled_post_id` (FK → scheduled_posts.id)
  - `media_file_id` (FK → media_files.id)
  - `position` (INTEGER: Order in carousel/gallery)
  - `platform_specific_data` (JSONB: Platform-specific settings)
- **Functionality**: Links multiple media files to a single post

**Relationships**:
- `scheduled_posts` N:M `media_files` (via scheduled_post_media)
- `media_files` N:1 `campaigns` (optional grouping)

---

### 5. BACKGROUND PROCESSING MODULE

#### Tables

**`queue_jobs`**
- **Purpose**: Background job queue for async operations
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `scheduled_post_id` (FK → scheduled_posts.id)
  - `job_type` (VARCHAR: 'publish', 'retry', 'analytics', 'media_processing')
  - `status` (VARCHAR: 'pending', 'processing', 'completed', 'failed')
  - `priority` (INTEGER: Higher = more important)
  - `attempts`, `max_attempts` (Retry logic)
  - `scheduled_for` (When to execute)
  - `next_retry_at` (Retry scheduling)
  - `error_message`, `error_code` (Error tracking)
  - `metadata`, `result_data` (JSONB: Job-specific data)
- **Functionality**:
  - Manages async publishing tasks
  - Implements retry logic for failed jobs
  - Prioritizes high-priority posts
  - Tracks job execution status

**`queue_job_logs`**
- **Purpose**: Detailed logging for queue jobs
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `job_id` (FK → queue_jobs.id)
  - `log_level` (VARCHAR: 'debug', 'info', 'warn', 'error')
  - `message` (TEXT: Log message)
  - `metadata` (JSONB: Additional context)
- **Functionality**: Provides audit trail and debugging capability

**Relationships**:
- `queue_jobs` 1:N `queue_job_logs`
- `queue_jobs` N:1 `scheduled_posts`

**Workflow**:
```
Scheduled Post Created
    ↓
Queue Job Created (status: 'pending')
    ↓
Job Picked Up by Worker (status: 'processing')
    ↓
Publishing Attempt
    ↓
Success → (status: 'completed')
Failure → Retry Logic (status: 'failed', retry_count++)
```

---

### 6. ANALYTICS & REPORTING MODULE

#### Tables

**`content_analytics`**
- **Purpose**: Daily engagement metrics per post
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `scheduled_post_id` (FK → scheduled_posts.id)
  - `user_id` (FK → users.id)
  - `platform` (Platform name)
  - `analytics_date` (DATE: Metrics date)
  - Engagement metrics: `views`, `likes`, `shares`, `comments`, `saves`, `retweets`, `reactions`
  - Calculated metrics: `engagement_rate`, `reach`, `impressions`
  - `platform_metrics` (JSONB: Platform-specific data)
- **Functionality**:
  - Tracks daily performance for each post
  - Enables time-series analysis
  - Stores platform-specific metrics

**`platform_performance`**
- **Purpose**: Platform-wide daily performance summaries
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `platform` (Platform name)
  - `date` (DATE: Performance date)
  - Aggregated metrics: `total_posts`, `total_views`, `total_likes`, etc.
  - `avg_engagement_rate` (Calculated average)
  - `best_post_id` (FK → scheduled_posts.id, nullable)
  - `best_post_engagement` (Best post's engagement rate)
- **Functionality**: Provides high-level platform performance overview

**`hashtag_performance`**
- **Purpose**: Tracks hashtag effectiveness
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `hashtag` (Hashtag text)
  - `platform` (Platform name)
  - `date` (DATE: Performance date)
  - `usage_count` (How many times used)
  - `total_engagement`, `avg_engagement_rate`, `reach`
- **Functionality**: Helps identify high-performing hashtags

**`ai_content_analysis`**
- **Purpose**: AI-powered content analysis and scoring
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `scheduled_post_id` (FK → scheduled_posts.id)
  - `analysis_type` (VARCHAR: 'content_quality', 'engagement_prediction', 'brand_safety')
  - `score` (DECIMAL: 0.00-1.00)
  - `confidence` (DECIMAL: 0.00-1.00)
  - `analysis_data` (JSONB: Detailed analysis)
- **Functionality**: Pre-publish content quality assessment

**`optimal_posting_times`**
- **Purpose**: ML-based optimal posting time recommendations
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `platform` (Platform name)
  - `day_of_week` (INTEGER: 0=Sunday, 1=Monday, etc.)
  - `hour` (INTEGER: 0-23)
  - `engagement_score` (DECIMAL: Predicted engagement)
  - `sample_size` (Number of posts analyzed)
- **Functionality**: Learns from historical data to recommend posting times

**`audience_insights`**
- **Purpose**: Audience demographic and behavioral data
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `platform` (Platform name)
  - `social_account_id` (FK → social_accounts.id)
  - `date` (DATE: Insights date)
  - `age_groups`, `gender_distribution`, `location_distribution` (JSONB)
  - `interests`, `peak_hours`, `peak_days` (JSONB)
  - `follower_growth`, `engagement_trend` (Metrics)
- **Functionality**: Provides audience understanding for targeting

**`competitor_analysis`**
- **Purpose**: Competitive benchmarking data
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `competitor_name` (Competitor identifier)
  - `platform` (Platform name)
  - `competitor_handle` (Competitor's platform handle)
  - `follower_count`, `engagement_rate`, `posting_frequency`
  - `content_themes`, `top_performing_content` (JSONB)
  - `growth_rate`, `engagement_comparison` (Comparison metrics)
- **Functionality**: Enables competitive intelligence

**`roi_analysis`**
- **Purpose**: Return on investment calculations
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `campaign_id` (FK → campaigns.id)
  - `platform` (Platform name)
  - `analysis_date` (DATE: Analysis date)
  - Investment: `time_invested_hours`, `content_creation_cost`, `advertising_spend`
  - Return: `leads_generated`, `conversions`, `revenue_generated`
  - Calculated: `roi_percentage`, `cost_per_lead`, `cost_per_conversion`
- **Functionality**: Measures campaign ROI and efficiency

**Relationships**:
- `content_analytics` N:1 `scheduled_posts`
- `platform_performance` N:1 `scheduled_posts` (via best_post_id)
- `ai_content_analysis` N:1 `scheduled_posts`
- `audience_insights` N:1 `social_accounts`

---

### 7. SYSTEM & CONFIGURATION MODULE

#### Tables

**`notifications`**
- **Purpose**: User notifications and alerts
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `user_id` (FK → users.id)
  - `type` (VARCHAR: 'post_published', 'post_failed', 'campaign_complete', etc.)
  - `title`, `message` (Notification content)
  - `data` (JSONB: Additional notification data)
  - `is_read` (Boolean flag)
- **Functionality**: Real-time notification system

**`platform_configurations`**
- **Purpose**: Platform-specific settings and limits
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `platform` (VARCHAR: Unique platform identifier)
  - `configuration` (JSONB: Platform settings)
  - `is_active` (Boolean flag)
- **Functionality**: Stores platform API limits, requirements, and settings

**`system_settings`**
- **Purpose**: Global system configuration
- **Key Fields**:
  - `id` (UUID, Primary Key)
  - `setting_key` (VARCHAR: Unique key)
  - `setting_value` (TEXT: Setting value)
  - `description` (TEXT: Setting description)
  - `is_public` (Boolean: Public visibility)
- **Functionality**: Application-wide configuration management

---

## 🔄 Data Flow & Relationships

### Complete Entity Relationship Diagram

```
┌──────────┐
│  users   │
└────┬─────┘
     │
     ├─────────────────────────────────────┐
     │                                       │
     │                                       │
┌────▼──────────┐                  ┌────────▼─────────┐
│social_accounts│                  │   campaigns      │
└────┬──────────┘                  └────────┬─────────┘
     │                                       │
     │                                       ├──────────────┐
     │                                       │              │
┌────▼──────────────┐         ┌─────────────▼──┐   ┌──────▼───────────────┐
│ scheduled_posts   │         │weekly_content_ │   │  campaign_goals      │
└────┬──────────────┘         │refinements     │   └──────────────────────┘
     │                        └────────┬─────────┘
     │                                 │
     │                        ┌────────▼──────────┐
     │                        │daily_content_plans │
     │                        └────────┬───────────┘
     │                                 │
     ├─────────────────────────────────┘
     │
     ├──────────────────────────────────┐
     │                                   │
┌────▼─────────────┐          ┌─────────▼──────────┐
│  queue_jobs      │          │content_analytics  │
└────┬─────────────┘          └───────────────────┘
     │
┌────▼─────────────┐
│queue_job_logs    │
└──────────────────┘
```

### Key Data Flows

#### 1. Campaign Creation Flow

```
User Creates Campaign
    ↓
campaigns table (status: 'planning')
    ↓
AI/User Generates 12-Week Structure
    ↓
weekly_content_refinements (12 records, week_number: 1-12)
    ↓
Weekly Themes & Focus Areas Defined
    ↓
Daily Plans Created
    ↓
daily_content_plans (multiple records per week)
    ↓
Content Scheduled
    ↓
scheduled_posts table (status: 'scheduled')
```

#### 2. Publishing Flow

```
scheduled_posts (status: 'scheduled')
    ↓
queue_jobs created (job_type: 'publish', status: 'pending')
    ↓
Background Worker Picks Up Job
    ↓
queue_jobs (status: 'processing')
    ↓
OAuth Token Retrieved from social_accounts
    ↓
Platform API Call (Post to LinkedIn/Twitter/etc.)
    ↓
Success:
    scheduled_posts (status: 'published', published_at set, post_url set)
    queue_jobs (status: 'completed')
    ↓
Failure:
    queue_jobs (status: 'failed', error_message set, retry_count++)
    (Retry logic: next_retry_at calculated)
```

#### 3. Analytics Collection Flow

```
scheduled_posts (status: 'published')
    ↓
Platform API Call (Fetch engagement metrics)
    ↓
content_analytics (daily records created)
    ↓
Aggregation:
    platform_performance (daily summaries)
    hashtag_performance (hashtag analysis)
    optimal_posting_times (ML training data)
```

#### 4. AI Enhancement Flow

```
weekly_content_refinements / daily_content_plans
    ↓
AI Service Called (GPT/Claude)
    ↓
Content Enhanced
    ↓
Original record updated (refinement_status: 'ai_enhanced')
    ↓
ai_content_analysis record created (quality scores)
```

---

## 🔌 API Structure

### Campaign Management APIs

**Base Path**: `/api/campaigns/`

| Endpoint | Method | Purpose | Key Tables Used |
|----------|--------|---------|-----------------|
| `/api/campaigns` | POST | Create campaign | `campaigns` |
| `/api/campaigns` | GET | List campaigns | `campaigns`, `users` |
| `/api/campaigns/[id]` | GET | Get campaign details | `campaigns`, `weekly_content_refinements` |
| `/api/campaigns/save` | POST | Save campaign | `campaigns` |
| `/api/campaigns/create-12week-plan` | POST | AI-generated 12-week plan | `campaigns`, `weekly_content_refinements` |
| `/api/campaigns/save-comprehensive-plan` | POST | Save full 12-week plan | `weekly_content_refinements`, `daily_content_plans` |
| `/api/campaigns/hierarchical-navigation` | GET | Get campaign hierarchy | `campaigns`, `weekly_content_refinements` |
| `/api/campaigns/commit-weekly-plan` | POST | Commit weekly plan | `weekly_content_refinements`, `daily_content_plans` |
| `/api/campaigns/commit-daily-plan` | POST | Commit daily plan | `daily_content_plans` |

### Content & Scheduling APIs

**Base Path**: `/api/schedule/`

| Endpoint | Method | Purpose | Key Tables Used |
|----------|--------|---------|-----------------|
| `/api/schedule/posts` | POST | Schedule a post | `scheduled_posts`, `queue_jobs` |
| `/api/schedule/posts/[id]` | GET | Get scheduled post | `scheduled_posts` |
| `/api/schedule/posts/[id]` | PUT | Update scheduled post | `scheduled_posts` |
| `/api/schedule/posts/[id]` | DELETE | Cancel scheduled post | `scheduled_posts`, `queue_jobs` |

### AI Services APIs

**Base Path**: `/api/ai/`

| Endpoint | Method | Purpose | Key Tables Used |
|----------|--------|---------|-----------------|
| `/api/ai/generate-comprehensive-plan` | POST | Generate 12-week plan | `campaigns`, `weekly_content_refinements` |
| `/api/ai/generate-content` | POST | Generate content | `content_templates`, `ai_content_analysis` |
| `/api/ai/weekly-amendment` | POST | Enhance weekly plan | `weekly_content_refinements` |
| `/api/ai/daily-amendment` | POST | Enhance daily plan | `daily_content_plans` |
| `/api/ai/campaign-learnings` | GET | Get AI insights | `ai_content_analysis` |

### Analytics APIs

**Base Path**: `/api/analytics/`

| Endpoint | Method | Purpose | Key Tables Used |
|----------|--------|---------|-----------------|
| `/api/analytics/posting` | GET | Post performance | `content_analytics`, `scheduled_posts` |
| `/api/campaigns/performance-data` | GET | Campaign analytics | `platform_performance`, `roi_analysis` |
| `/api/campaigns/weekly-performance` | GET | Weekly metrics | `content_analytics`, `daily_content_plans` |

### Social Media Integration APIs

**Base Path**: `/api/auth/` and `/api/social/`

| Endpoint | Method | Purpose | Key Tables Used |
|----------|--------|---------|-----------------|
| `/api/auth/[platform]` | GET | OAuth initiation | `social_accounts` |
| `/api/auth/[platform]/callback` | GET | OAuth callback | `social_accounts` |
| `/api/social/post` | POST | Publish post | `scheduled_posts`, `social_accounts`, `queue_jobs` |

---

## ✨ Key Features & Workflows

### 1. 12-Week Campaign Planning

**User Journey**:
1. User creates a campaign (`campaigns` table)
2. System generates 12-week structure (`weekly_content_refinements`)
3. User defines weekly themes and focus areas
4. AI can enhance weekly plans (`refinement_status: 'ai_enhanced'`)
5. Daily plans generated (`daily_content_plans`)
6. Content scheduled (`scheduled_posts`)
7. Published to platforms

**Database Impact**:
- 1 `campaigns` record
- 12 `weekly_content_refinements` records
- 60-84 `daily_content_plans` records (5-7 days × 12 weeks)
- Multiple `scheduled_posts` records

### 2. AI-Powered Content Enhancement

**Workflow**:
- User clicks "AI Improve" on weekly/daily plan
- API calls GPT/Claude with existing content
- AI suggests improvements
- User approves → database updated
- `ai_content_analysis` record created with scores

**Database Impact**:
- `weekly_content_refinements` or `daily_content_plans` updated
- `ai_content_analysis` record created
- `refinement_status` updated to 'ai_enhanced'

### 3. Multi-Platform Publishing

**Workflow**:
- Content created in `daily_content_plans`
- User schedules post → `scheduled_posts` created
- `queue_jobs` created for background processing
- Worker processes job:
  - Retrieves OAuth token from `social_accounts`
  - Calls platform API
  - Updates `scheduled_posts` with results
  - Creates `content_analytics` record

**Database Impact**:
- 1 `scheduled_posts` record
- 1 `queue_jobs` record
- 1 `content_analytics` record (after publishing)
- Updates to `platform_performance`

### 4. Analytics & Reporting

**Workflow**:
- Daily job collects metrics from platforms
- Creates/updates `content_analytics` records
- Aggregates into `platform_performance`
- Calculates `hashtag_performance`
- Updates `optimal_posting_times` ML model

**Database Impact**:
- Multiple `content_analytics` records (one per post per day)
- `platform_performance` records (one per platform per day)
- `hashtag_performance` updates
- `optimal_posting_times` updates

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 15
- **Language**: TypeScript
- **UI Library**: React 18
- **Styling**: Tailwind CSS
- **State Management**: React Hooks (useState, useEffect)

### Backend
- **API Framework**: Next.js API Routes
- **Database**: PostgreSQL (via Supabase)
- **Database Client**: Supabase JavaScript Client
- **Queue System**: BullMQ (Redis-backed)
- **File Storage**: Supabase Storage (for media files)

### External Services
- **AI Services**: OpenAI GPT, Anthropic Claude
- **Social Media APIs**:
  - LinkedIn API
  - Twitter/X API
  - Instagram Basic Display API
  - Facebook Graph API
  - YouTube Data API

### Development Tools
- **Package Manager**: npm
- **Version Control**: Git
- **Environment**: Node.js

---

## 📝 Database Maintenance & Optimization

### Indexes

**Critical Indexes** (Already Created):
- `idx_scheduled_posts_campaign_id` - Fast campaign filtering
- `idx_scheduled_posts_status` - Status-based queries
- `idx_scheduled_posts_scheduled_for` - Time-based scheduling queries
- `idx_daily_content_plans_campaign_id` - Campaign planning queries
- `idx_content_analytics_post_id` - Analytics lookups
- `idx_queue_jobs_status` - Job processing

**Recommended Composite Indexes**:
```sql
CREATE INDEX idx_daily_content_plans_campaign_id_date_platform 
ON daily_content_plans(campaign_id, date, platform);

CREATE INDEX idx_content_analytics_scheduled_post_id_analytics_date 
ON content_analytics(scheduled_post_id, analytics_date);

CREATE INDEX idx_platform_performance_user_id_date_platform 
ON platform_performance(user_id, date, platform);
```

### Constraints

**Foreign Key Constraints**:
- All `*_id` columns reference parent tables
- ON DELETE CASCADE for dependent records
- ON DELETE SET NULL for optional relationships

**Unique Constraints**:
- `users.email` - Unique
- `social_accounts(user_id, platform, platform_user_id)` - Unique account per platform
- `weekly_content_refinements(campaign_id, week_number)` - Unique week per campaign
- `daily_content_plans` - Various unique combinations

### Data Integrity

- **Orphan Prevention**: Foreign key constraints prevent orphan records
- **Referential Integrity**: CASCADE deletes ensure data consistency
- **Validation**: Application-level validation before database writes
- **Audit Trail**: `queue_job_logs` provides operation history

---

## 🔒 Security Considerations

### Authentication
- OAuth 2.0 for social media platforms
- Token storage in `social_accounts` table
- Token refresh logic for expired tokens

### Authorization
- User-scoped data access (user_id filtering)
- Row-level security (RLS) recommended for Supabase
- API-level authorization checks

### Data Privacy
- Sensitive tokens encrypted at rest
- Access tokens stored securely
- User data isolation via `user_id` foreign keys

---

## 📊 Performance Considerations

### Query Optimization
- Indexes on all foreign key columns
- Composite indexes for common query patterns
- Efficient JOIN strategies

### Scalability
- Queue-based publishing (async processing)
- Batch analytics updates
- Caching strategies for frequently accessed data

### Monitoring
- `queue_job_logs` for error tracking
- `content_analytics` for performance monitoring
- Database query performance tracking

---

## 🎯 Conclusion

The **Virality Engine** database module is a comprehensive, well-structured system designed for:

1. **Scalability**: Handles large volumes of campaigns, posts, and analytics
2. **Flexibility**: Supports multiple platforms with unified structure
3. **Reliability**: Robust error handling and retry mechanisms
4. **Intelligence**: AI integration for content enhancement and optimization
5. **Performance**: Optimized indexes and efficient data relationships

The modular design allows for easy extension and maintenance while maintaining data integrity and performance.

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Maintained By**: Development Team

