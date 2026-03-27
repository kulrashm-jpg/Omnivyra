# Activities Taxonomy & Resource Consumption Guide

**Version:** 1.0  
**Last Updated:** 2026-03-25  
**Maintainer:** Platform Architecture Team

This document defines all atomic activities in the Virality platform and their expected resource consumption patterns. Update this document whenever new features or activities are added.

---

## 1. USER & ACCOUNT LIFECYCLE

### 1.1 Create Account
**Parent Flow:** Authentication & Onboarding  
**Trigger:** New user signup  
**Atomic Steps:**
- **1.1.1 Validate Email & Credentials** → Supabase (auth check, user lookup)
- **1.1.2 Create User Record** → Supabase (INSERT), Firebase Auth
- **1.1.3 Initialize User Profile** → Supabase (INSERT user_profiles)
- **1.1.4 Send Welcome Email** → Vercel (email service), External API (SendGrid/Mailgun if used)
- **1.1.5 Log Audit Event** → Supabase (audit_logs INSERT)

**Resource Cost Drivers:**
- Database: Query count (2-5 reads, 3-4 writes)
- Email: Send count (1 transactional email)
- API Calls: 1-2 external calls if using third-party auth

**Creator-Dependent Factors:** None - standardized process  
**Cost Allocation:** 100% to account creation activity

---

### 1.2 User Onboarding Flow
**Parent Flow:** Account Lifecycle  
**Trigger:** Post-signup, first login  
**Atomic Steps:**
- **1.2.1 Fetch Available Integrations** → Supabase (SELECT integrations), API Gateway (JSON serialization)
- **1.2.2 Connect Social Platform** (LinkedIn, Twitter, etc.)
  - 1.2.2a Initiate OAuth → Vercel (OAuth endpoint)
  - 1.2.2b Request Auth Token → External API (LinkedIn/Twitter OAuth)
  - 1.2.2c Store Credentials** → Supabase (INSERT encrypted_tokens)
  - 1.2.2d Validate Connection** → External API (test API call)
  - **Cost:** Per platform: ~5 API calls + 2 DB writes + 1 validation call
  
- **1.2.3 Connect Community Platforms** (Discord, Slack, etc.)
  - Similar to 1.2.2, cost per platform
  
- **1.2.4 Set Timezone & Preferences** → Supabase (UPDATE user_settings)
- **1.2.5 Initialize Redis Cache** → Redis (SET user_preferences, activity_cache)

**Resource Cost Drivers:**
- **APIs:** 2-5 external platform integrations × (5-10 API calls each)
- **Database:** 20-30 writes, 30-50 reads
- **Redis:** 3-5 cache entries (~5KB each)
- **Vercel:** 2-5 OAuth callback requests

**Creator-Dependent Factors:**
- Number of platforms connected (1-10 platforms) → Linear API cost increase
  
**Cost Allocation:**
- Social platform connection: 70% to this activity, 30% to System (infrastructure overhead)
- Preferences: 100% to onboarding

---

## 2. CAMPAIGN MANAGEMENT

### 2.1 BOLT Campaign Flow (AI-Powered Theme Generation)
**Parent Flow:** Campaign Creation  
**Trigger:** User initiates BOLT campaign  
**Atomic Steps:**

#### Phase 1: Information Gathering
- **2.1.1 Analyze Brand Assets** → Supabase (SELECT brand_profiles), LLM API (Claude/GPT)
  - Cost: 1 LLM call (~500-2000 tokens)
- **2.1.2 Fetch Trending Topics** → External API (Trend API, news APIs)
  - Cost: 1-3 API calls, 100-500KB data
- **2.1.3 Pull Competitor Intelligence** (Optional) → External API (data aggregators)
  - Cost: 1-5 API calls

#### Phase 2: Theme Generation
- **2.1.4 Create Strategic Theme Cards** → LLM API (multi-turn conversation)
  - Cost: 5-10 LLM calls (~1000-5000 tokens each)
  - Uses: Trend API data + Brand insights
- **2.1.5 Generate Visuals** (If enabled) → Image Generation API (Stable Diffusion, DALL-E)
  - Cost: 1-3 image generations (~0.1-0.5 credits each)
  - Platform-dependent: Multi-platform themes = more variations

#### Phase 3: Planning
- **2.1.6 Create Weekly Plan** → Supabase (INSERT campaign_plans)
  - Cost: 5-10 API calls (schedule generation)
  - LLM: 2-3 calls for weekly strategy
- **2.1.7 Break Down to Daily Plans** → LLM API + Supabase
  - Cost: 7 LLM calls (one per day) + 7 DB writes
- **2.1.8 Generate Activity Workspace** → Supabase (INSERT campaign_activities)
  - Cost: 10-50 DB writes (one per activity)

#### Phase 4: Content Creation
- **2.1.9 Create Master Content** → LLM API (long-form generation)
  - Cost: 5-10 LLM calls (5000-10000 tokens each)
  - Vercel: CPU time (~2-5 seconds per activation)
- **2.1.10 Repurpose Content** → LLM API (multi-format adaptation)
  - Cost: Per platform × content types (text, carousel, video metadata)
  - 2-5 LLM calls per platform
- **2.1.11 Schedule Posts** → Supabase + Redis
  - Cost: 5-10 DB writes, 10-20 Redis cache entries
- **2.1.12 Publish/Share to Platforms** → External APIs
  - Cost: 1 API call per platform
  - Network: Vercel egress (100KB-5MB per platform)

**Resource Cost Summary (Per BOLT Campaign):**
| Resource | Min | Max | Driver |
|----------|-----|-----|--------|
| LLM Tokens | 30K | 100K | Content complexity, platform count |
| Supabase Reads | 50 | 200 | Plan generation, activity lookup |
| Supabase Writes | 30 | 100 | Plan storage, schedule setup |
| External APIs | 5 | 20 | Trends, competitor data, publishing |
| Image Gen | 0 | 10 | Visual variations per platform |
| Vercel (sec) | 5 | 20 | Content generation processing |
| Redis Keys | 10 | 50 | Schedule caching, activity state |

**Creator-Dependent Factors:**
- **Single Platform + Text Only** → Base cost (30K LLM tokens, 50 API calls)
- **2-3 Platforms + Text** → 1.5x cost (45K tokens, 75 API calls)
- **4+ Platforms + Video/Carousel** → 3-4x cost (90K-120K tokens, 150+ API calls)
- **With Competitor Intelligence** → +20% cost
- **Multi-week campaign** → Linear scaling per week

---

### 2.2 Recommendation Engine Campaign
**Parent Flow:** Campaign Creation  
**Trigger:** User uses Recommendation AI  
**Atomic Steps:**
- **2.2.1 Analyze Historical Performance** → Supabase (complex aggregate queries)
  - Cost: 5-10 heavy reads
- **2.2.2 Fetch Audience Insights** → LLM API (analysis)
  - Cost: 2-3 LLM calls
- **2.2.3 Generate Recommendations** → LLM + Supabase
  - Cost: 5-10 LLM calls, 20-50 reads
- **2.2.4-2.2.12** Similar to BOLT Phase 3-4

**Resource Cost Summary:**
- Similar to BOLT but +30% on analysis queries (historical data aggregation)
- -20% on content generation (using recommended templates)

---

### 2.3 Create Campaign Flow (Manual)
**Parent Flow:** Campaign Creation  
**Trigger:** User manually creates campaign  
**Atomic Steps:**
- **2.3.1 Create Campaign Skeleton** → Supabase (INSERT campaigns)
- **2.3.2 Define Strategy** → Supabase (UPDATE campaign_strategy)
- **2.3.3 Create Daily Plans** → Supabase + LLM (light, optional)
- **2.3.4 Activity Workspace Setup** → Supabase
- **2.3.5 Repurpose Content** → LLM API (if using smart repurpose)
- **2.3.6 Schedule Posts** → Supabase + Redis
- **2.3.7 Share to Platforms** → External APIs

**Resource Cost Summary:**
- 50-60% of BOLT campaign cost (less AI, more manual work)
- Supabase: 100+ writes, 30-50 reads
- LLM: 0-20 tokens (optional)
- External APIs: 5-15 calls

---

## 3. CONTENT MANAGEMENT

### 3.1 Blog Workflow
**Parent Flow:** Content Creation  
**Trigger:** New blog creation  
**Atomic Steps:**
- **3.1.1 Identify Topic** → LLM API (analysis, +trending topics)
  - Cost: 1-2 LLM calls
- **3.1.2 Select Topic** → Supabase (read available topics)
  - Cost: 1-5 reads
- **3.1.3 Write Blog** → LLM API (if using AI writer)
  - Cost: 5-10 LLM calls (5000-15000 tokens)
- **3.1.4 SEO & Geo Alignment** → LLM API
  - Cost: 2-3 LLM calls
- **3.1.5 Generate/Fetch Images** → Image API (Unsplash, DALL-E, or search)
  - Cost: 1-5 API calls
- **3.1.6 Format & Publish** → Supabase (INSERT), Vercel (CDN)
  - Cost: 2-3 writes, 100KB-5MB CDN egress

**Resource Cost Summary:**
| Resource | Min | Max |
|----------|-----|-----|
| LLM Tokens | 5K | 20K |
| Supabase Ops | 10 | 30 |
| Image APIs | 1 | 5 |
| Vercel CDN | 100KB | 5MB |

**Creator-Dependent Factors:**
- Manual writing: 0 LLM tokens
- AI-assisted: 10K-20K tokens
- Video blog: +Image API calls, +CDN usage

---

## 4. ENGAGEMENT & COMMAND CENTER

### 4.1 Monitor & Respond Flow
**Parent Flow:** Social Engagement  
**Trigger:** New social comments/messages  
**Atomic Steps:**
- **4.1.1 Fetch Comments/Messages** → External APIs (social platforms)
  - Cost: Per platform API call (polling or webhook)
- **4.1.2 Send to Command Center** → Redis + Supabase
  - Cost: 1 Redis SET + 1 Supabase INSERT per activity
- **4.1.3 AI Analysis (Optional)** → LLM API
  - Cost: 200-500 tokens per comment (sentiment, suggested response)
- **4.1.4 User Responds** → Supabase (INSERT response)
- **4.1.5 Post Response to Platform** → External API
  - Cost: 1 API call per response, 100B-10KB per post

**Resource Cost Summary (Per Monitoring Session):**
- **Passive monitoring (10 comments):**
  - APIs: 1-2 calls, LLM: 0-5K tokens, DB: 10 writes
- **Active engagement (50 comments + responses):**
  - APIs: 5-10 calls, LLM: 10K+ tokens, DB: 50+ writes, Redis: 50+ keys

---

## 5. INTELLIGENCE & AUTOMATION

### 5.1 Campaign Intelligence
**Activities:**
- Predictive scheduling optimization
- Automated A/B test suggestions
- Performance forecasting

**Cost per Activation:**
- LLM: 5-10K tokens
- Supabase: 20-50 reads (historical analysis)
- Redis: 5-10 cache entries

### 5.2 Content Intelligence
**Activities:**
- Content recommendation
- Hashtag generation
- Audience targeting optimization

**Cost per Activation:**
- LLM: 2-5K tokens
- Supabase: 10-30 reads
- APIs: 1-3 calls (audience data)

### 5.3 Platform-Specific Intelligence
- Email campaign optimization: +2-3K LLM tokens
- Ad placement strategy: +1-2 API calls
- Posting schedule optimization: +1 LLM call

---

## 6. INTEGRATIONS

### 6.1 External API Management
**Activities:**
- Connect new external API
- Test API connection
- Log API metrics

**Cost per Integration:**
- Supabase: 5-10 writes, 2-5 reads
- API Calls: 3-5 test calls
- Redis: 1 cache entry (config)

### 6.2 Blog & CMS Integration
**Activities:**
- Sync blog content
- Metadata enrichment
- SEO optimization

**Cost per Blog Sync:**
- Supabase: 5-20 writes
- APIs: 1-3 calls (if using external CMS)
- Vercel: Processing time (~1-2 seconds)

---

## 7. SYSTEM OVERHEAD (Unallocated)

**Uncovered Infrastructure Costs:**
- Database maintenance queries (VACUUM, ANALYZE)
- Cache warming and eviction
- Connection pooling
- Network overhead (inter-service communication)
- Logging and monitoring infrastructure
- Data backup and replication

**Typical Monthly Allocation:**
- Supabase unallocated: 20-30% of total DB capacity
- Redis unallocated: 10-20% of connections + memory
- Vercel unallocated: 5-10% of CPU capacity
- External APIs: Subscription minimums not fully utilized

**Optimization Opportunities:**
- Connection pooling tuning → Can reduce by 15-20%
- Query optimization → Can reduce by 10-30%
- Cache hit rate improvement → Can reduce by 5-15%
- Batch operations → Can reduce by 10-20%

---

## 8. FEATURE FLAGS & CONDITIONAL COSTS

### Multi-Activity Features (Additive Costs)
| Feature | Impact | Resource Increase |
|---------|--------|------------------|
| Competitor Intelligence | Campaign analysis | +20% LLM, +2 APIs |
| Image Generation | Visual variety | +50% cost (1-3 images) |
| Video Processing | Advanced creation | +200% cost, +Vercel CPU |
| Multi-language | Content expansion | +2x LLM tokens |
| Sentiment Analysis | Engagement | +500 tokens per comment |
| Predictive Scheduling | Optimization | +5K tokens |
| A/B Testing | Experimentation | +2x deployment cost |

---

## 9. ADDING NEW ACTIVITIES (Template)

When adding new features, document as follows:

```markdown
### X.X Feature Name
**Parent Flow:** [Category]
**Trigger:** [Event that starts activity]
**Atomic Steps:**
- **X.X.1 Step Name** → [Service Used] ([operation type])
  - Cost: [Resources consumed]
- [Repeat for each step]

**Resource Cost Summary:**
| Resource | Min | Max | Driver |
|----------|-----|-----|--------|
| [Resource] | [Min] | [Max] | [What causes variance] |

**Creator-Dependent Factors:**
- [Variable 1]: [Impact]
- [Variable 2]: [Impact]

**Cost Allocation:**
- [How cost should be split if shared resources]
```

---

## 10. RESOURCE COST REFERENCE TABLE

**Typical Costs per Unit:**
```
LLM Token: $0.000002 - $0.00002 (Claude/GPT-3.5 to GPT-4)
Supabase Read: $0.0000025 (included in free tier, ~$3/month at scale)
Supabase Write: $0.000005 (included in free tier, ~$6/month at scale)
Redis Operation: $0.00000001 - $0.000001 (memory-dependent)
Vercel CPU (per second): $0.000001 - $0.00001
External API Call: $0.001 - $0.1 (service-dependent)
Image Generation: $0.01 - $0.1 per image
CDN Egress (per GB): $0.02 - $0.08
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-25 | Initial taxonomy document with core activities |
| TBD | TBD | [To be updated as features evolve] |
