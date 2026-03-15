# Cost Analysis Framework — LLM, APIs, Infrastructure

**Purpose:** Unified cost analysis for planning: LLM tokens, external APIs, and infrastructure by user range. Use with [LLM-TOKEN-CONSUMPTION-TABLE.md](./LLM-TOKEN-CONSUMPTION-TABLE.md) for full token breakdown.

---

## 1. Cost Categories Overview

| Category | Example | Tracking | Notes |
|----------|---------|----------|-------|
| **LLM (OpenAI/Anthropic)** | Chat completions, embeddings | `usage_events`, `usage_meter_monthly` | Primary; pricing in `usageLedgerService` |
| **Embeddings (OpenAI)** | Signal embeddings | Not in usage_events | Separate API; ~$0.00002/1K tokens |
| **Whisper (OpenAI)** | Voice transcription | Not in usage_events | Per minute of audio |
| **External APIs** | Trend APIs, OmniVyra | `usage_events` (source_type=external_api) | Cost often $0 in ledger; vendor-specific |
| **Infrastructure** | Supabase, Redis, Workers, Hosting | — | Fixed + variable by user load |

---

## 2. Other LLM/API Cost Areas (Beyond Main Inventory)

### 2.1 Embeddings (OpenAI text-embedding-3-small)

| Service | File | Usage | Cost Model |
|---------|------|-------|------------|
| Signal embeddings | `signalEmbeddingService.ts` | Per topic/signal embedding | ~$0.00002/1K input tokens; output = vector (no tokens) |
| Backfill script | `scripts/backfill-signal-embeddings.ts` | Batch backfill | Same |

**Rough cost:** 50–200 input tokens per topic → ~$0.000001–0.000004 per topic. Bulk 10K topics ≈ $0.01–0.04.

---

### 2.2 Whisper (Voice Transcription)

| API | File | Usage | Cost Model |
|-----|------|-------|------------|
| Voice transcribe | `pages/api/voice/transcribe.ts` | Per voice clip | $0.006/minute (Whisper) |

**Not logged in `usage_events`** — add if needed for cost attribution.

---

### 2.3 OmniVyra (External AI Service)

| Path | Service | Usage | Cost |
|------|---------|-------|------|
| Reply suggestions | `engagementAiAssistantService` → `evaluateCommunityAiEngagement` | Per "Suggest reply" | Vendor contract |
| Trend relevance | `externalApiService` → `getTrendRelevance` | Per recommendation fetch | Vendor contract |
| Community AI engagement | `communityAiOmnivyraService`, `engagementConversationIntelligenceService` | Per engagement analysis | Vendor contract |

**Note:** OmniVyra uses external API; tokens not in our OpenAI bill. Cost tracked via vendor invoicing.

---

### 2.4 External Trend / Intelligence APIs

| Source | Table | Purpose | Typical Cost |
|--------|-------|---------|--------------|
| Trend APIs | `external_api_sources` | Google Trends, News, etc. | Free tier or vendor pricing |
| Company API configs | `company_api_configs` | Per-company limits | — |

**Tracked:** `logExternalApiUsage`, `external_api_usage` (if table exists); `usage_events` with `source_type: 'external_api'`. Most presets log `total_cost: 0`; actual cost depends on vendor.

---

### 2.5 Platform Connectors (Publish / OAuth)

| Connector | Purpose | Cost |
|-----------|---------|------|
| LinkedIn, Twitter, Facebook, Instagram, Reddit, etc. | OAuth, publish | Usually free (platform API); rate limits apply |
| Tokens | `social_accounts`, `platform_tokens` | — |

---

## 3. LLM Pricing (Current — usageLedgerService)

| Provider | Model | Input per 1K | Output per 1K |
|----------|-------|--------------|---------------|
| OpenAI | gpt-4o-mini | $0.0003 | $0.0006 |
| OpenAI | gpt-4o | $0.005 | $0.015 |
| Anthropic | claude-3-5-sonnet | $0.003 | $0.015 |

**Embeddings (not in ledger):** text-embedding-3-small ≈ $0.00002/1K tokens.  
**Whisper:** ≈ $0.006/minute.

---

## 4. Infrastructure Cost Tiers by User Range

Infrastructure scales with: **companies**, **MAU**, **campaigns**, **engagement threads**, **worker load**.

### 4.1 Core Components

| Component | Purpose | Scale Factor |
|-----------|---------|--------------|
| **Supabase** | DB, auth, storage, Realtime | Rows, bandwidth, storage |
| **Redis** | Queues (BullMQ), caching | Memory, connections |
| **Workers** | BOLT, publish, engagement, intelligence, etc. | Job throughput |
| **Next.js / Hosting** | App, API routes | Requests, compute |
| **OpenAI** | LLM calls | Token volume |
| **OmniVyra** (optional) | Engagement AI | Request volume |

### 4.2 Suggested Infrastructure Tiers

| Tier | Users (MAU) | Companies | Campaigns/mo | Engagement/mo | Est. infra/month (ballpark) |
|------|-------------|-----------|--------------|---------------|-----------------------------|
| **Starter** | 10–50 | 1–5 | 5–20 | 100–500 | $50–150 (Supabase free + Redis Cloud + Vercel) |
| **Growth** | 50–200 | 5–20 | 20–100 | 500–2K | $150–400 (Supabase Pro, Redis, 1–2 workers) |
| **Scale** | 200–1K | 20–100 | 100–500 | 2K–10K | $400–1,200 (Supabase, Redis, 2–4 workers, more compute) |
| **Enterprise** | 1K+ | 100+ | 500+ | 10K+ | $1,200+ (dedicated DB, Redis cluster, worker fleet) |

**Assumptions:** Shared SaaS; no dedicated per-tenant infra. Adjust for on-prem or enterprise SLAs.

### 4.3 Per-Component Guidance

| Component | Starter | Growth | Scale | Enterprise |
|-----------|---------|--------|-------|------------|
| **Supabase** | Free tier | Pro ($25/mo) | Pro / Team | Dedicated / custom |
| **Redis** | Free 30MB / Upstash | Redis Cloud 100MB | Redis Cloud 1GB+ | Cluster |
| **Workers** | 1 process (all queues) | 1–2 | 2–4 | Fleet |
| **Hosting** | Vercel Hobby/Pro | Vercel Pro | Pro + edge | Custom |
| **Storage** | Supabase 1GB | 8GB | 100GB+ | Custom |

---

## 5. LLM Cost Estimation by Activity

Using token ranges from [LLM-TOKEN-CONSUMPTION-TABLE.md](./LLM-TOKEN-CONSUMPTION-TABLE.md) and gpt-4o-mini pricing:

| Activity | Est. Tokens (in+out) | Est. Cost (gpt-4o-mini) |
|----------|----------------------|--------------------------|
| Campaign plan (1) | 15K | ~$0.005 |
| Parse plan | 5K | ~$0.002 |
| Weekly distribution (4 weeks) | 15K | ~$0.005 |
| Master content (×20) | 25K | ~$0.008 |
| Platform variants (×20) | 30K | ~$0.01 |
| **4-week BOLT total** | ~90K | **~$0.03** |
| Response generation (1) | 2K | ~$0.0007 |
| Conversation triage (1) | 1.2K | ~$0.0004 |
| Memory summary (1) | 2K | ~$0.0007 |
| Insight content ideas (1) | 1.2K | ~$0.0004 |

**Rough monthly LLM (per active company):** 2 BOLT + 50 responses + 100 triages + 30 memory + 10 insights ≈ **$0.10–0.30** (low activity) to **$1–5** (high activity).

---

## 6. API Cost Summary

| API Type | Logged? | Typical Cost | Notes |
|----------|---------|--------------|-------|
| OpenAI Chat | Yes (`usage_events`) | Per token | Primary LLM |
| OpenAI Embeddings | No | ~$0.00002/1K | Add to ledger if needed |
| OpenAI Whisper | No | $0.006/min | Add if used |
| OmniVyra | External | Vendor | Not in our usage_events |
| Trend APIs | Yes (`source_type=external_api`) | Varies | Often free tier |
| Platform OAuth | No | Free | Rate limits only |

---

## 7. Cost Analysis Checklist

- [ ] **LLM:** Use `usage_events` + `usage_meter_monthly` for token/cost by org, campaign, process_type.
- [ ] **Embeddings:** Add logging to `signalEmbeddingService` if cost matters.
- [ ] **Whisper:** Add logging to transcribe API if used.
- [ ] **External APIs:** Ensure `logExternalApiUsage` + `usage_events` capture all paid calls; map `external_api_sources` to vendor pricing.
- [ ] **OmniVyra:** Track via vendor dashboard; no server-side cost in our DB.
- [ ] **Infrastructure:** Monitor Supabase/Redis/hosting dashboards; size by MAU/campaigns/engagement.
- [ ] **Per-tenant:** Use `organization_id` (and `campaign_id` where available) for attribution.

---

## 8. Queries for Cost Reporting

**LLM cost by organization (last 30 days):**
```sql
SELECT organization_id, SUM(total_cost) AS llm_cost, SUM(total_tokens) AS tokens
FROM usage_events
WHERE source_type = 'llm' AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY organization_id;
```

**External API calls (for volume analysis):**
```sql
SELECT organization_id, source_name, COUNT(*) AS calls
FROM usage_events
WHERE source_type = 'external_api' AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY organization_id, source_name;
```

**LLM by process type:**
```sql
SELECT process_type, SUM(total_tokens) AS tokens, SUM(COALESCE(total_cost, 0)) AS cost
FROM usage_events
WHERE source_type = 'llm' AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY process_type
ORDER BY tokens DESC;
```

---

## 9. References

- **LLM inventory:** [LLM-TOKEN-CONSUMPTION-TABLE.md](./LLM-TOKEN-CONSUMPTION-TABLE.md)
- **Usage ledger:** `backend/services/usageLedgerService.ts`
- **AI gateway:** `backend/services/aiGateway.ts`
- **External API:** `backend/services/externalApiService.ts`
- **BOLT flow:** [BOLT-ASYNC-EXECUTION.md](./BOLT-ASYNC-EXECUTION.md)

---

*Update pricing and tiers as providers and plans change.*
