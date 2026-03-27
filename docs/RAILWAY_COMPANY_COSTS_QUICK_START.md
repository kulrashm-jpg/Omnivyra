# Quick Integration Guide: Railway Company & Activity Cost Tracking

## The Problem You're Solving
You need to see **WHO is using compute resources and WHAT they're doing** to understand cost allocation at the business level.

## The Solution in 3 Steps

### Step 1: Wrap Your API Handlers (2 min)

**Before:**
```typescript
// pages/api/campaigns/create.ts
async function handler(req, res) {
  // ... code ...
}
export default handler;
```

**After:**
```typescript
import { withComputeMetrics, COMPUTE_FEATURES } from '../../../backend/lib/railwayComputeMiddleware';

async function handler(req, res) {
  // ... code ...
}
export default withComputeMetrics(COMPUTE_FEATURES.CAMPAIGN_CREATE, handler);
```

**What this does:**
- Automatically captures company_id from request context
- Maps process to activity type ("campaign_planning")
- Records execution time and cost

### Step 2: Pass Company Context (1 min)

When the API is called, include company context in **one** of these ways:

**Option A: Header (Recommended)**
```typescript
fetch('/api/campaigns/create', {
  method: 'POST',
  headers: {
    'x-company-id': selectedCompanyId,  // Pass here
  },
  body: JSON.stringify(campaignData),
});
```

**Option B: Query Parameter**
```typescript
fetch(`/api/campaigns/create?companyId=${selectedCompanyId}`, {
  method: 'POST',
  body: JSON.stringify(campaignData),
});
```

**Option C: Request Body**
```typescript
fetch('/api/campaigns/create', {
  method: 'POST',
  body: JSON.stringify({
    company_id: selectedCompanyId,  // Include in body
    name: 'Q1 Campaign',
    // ... other fields
  }),
});
```

### Step 3: View on Dashboard (30 sec)

1. Go to: **System Health** → **🚂 Railway Efficiency**
2. Select: **💰 Company & Activity Breakdown**
3. Your data appears as companies/activities accumulate

---

## For Queue Jobs

**Wrap the processor:**
```typescript
import { withQueueMetrics, COMPUTE_FEATURES } from '../../../backend/lib/railwayComputeMiddleware';

export default withQueueMetrics(
  COMPUTE_FEATURES.ENGAGEMENT_POLLING,
  async (job, token) => {
    // Job code
  }
);
```

**Enqueue with company context:**
```typescript
await engagementQueue.add('polling', {
  company_id: selectedCompanyId,  // Must include this
  platformId: 'linkedin',
  // ... other job data
});
```

---

## For Cron Jobs (System-Level)

```typescript
import { withCronMetrics, COMPUTE_FEATURES } from '../../../backend/lib/railwayComputeMiddleware';

export default withCronMetrics(
  COMPUTE_FEATURES.ENGAGEMENT_POLLING,
  'engagement-polling-daily',
  async () => {
    // Cron job code
  },
  'engagement_polling' // Optional explicit activity type
);
```

---

## What You're Tracking

| Feature | Maps To Activity | Example Use Cases |
|---------|------------------|------------------|
| CAMPAIGN_* | campaign_planning | Create, parse, optimize plans |
| PUBLISH_* / SCHEDULE_* | publishing | Schedule posts, bulk publish |
| ENGAGEMENT_* | engagement | Polling, analysis, inbox processing |
| INTELLIGENCE_* | intelligence | Run signals, clustering, analysis |
| AI_* | content_generation | Generate posts, recommendations |
| COMMUNITY_* | community_ai | Community analysis, playbook eval |
| DATA_SYNC / CACHE_* | system_operations | Background maintenance, warming |

---

## Example: Full Campaign Flow

```typescript
// 1. Create campaign (estimate cost per company)
export default withComputeMetrics(
  COMPUTE_FEATURES.CAMPAIGN_CREATE,
  async (req, res) => {
    const { company_id } = req.body;
    
    // Create campaign...
    
    res.json({ campaign_id: newCampaign.id });
  }
);

// 2. Run campaign optimizer (queue job)
export default withQueueMetrics(
  COMPUTE_FEATURES.CAMPAIGN_OPTIMIZE,
  async (job) => {
    // Optimize strategy...
  }
);

// When enqueuing:
await optimizeQueue.add('optimize-campaign', {
  company_id: campaignOwnerCompanyId,  // Link cost to company
  campaign_id: campaignId,
});

// 3. Dashboard shows:
// Company: acme-corp
//   └─ Activity: campaign_planning
//     └─ Cost: $0.523 (24h)
//     └─ Calls: 42
//     └─ Top features: CAMPAIGN_CREATE, CAMPAIGN_OPTIMIZE
```

---

## Testing: Verify Data Flows

### 1. Make a Request
```bash
curl -X POST http://localhost:3000/api/campaigns/create \
  -H "Content-Type: application/json" \
  -H "x-company-id: test-company-123" \
  -d '{"name": "My Campaign"}'
```

### 2. Check Redis
```bash
# SSH into your Railway environment or use Redis CLI
redis-cli
LRANGE railway:compute:metrics:api 0 -1
# Should see metrics with company_id and activity_type
```

### 3. Check Dashboard
Visit System Health → Railway Efficiency → Company & Activity Breakdown
- Wait a minute for buffer to flush
- Should see "test-company-123" appear
- Expand to see activities and costs

---

## Common Patterns

### Pattern 1: API → Queue → Cron
```
User creates campaign
  └─ API handler records cost + company
  
  └─ Enqueues optimization job
      └─ Queue job records cost + company
      
      └─ Cron finishes overnight
           └─ Cron job records cost (system-level)
           
Result: Company sees costs for user-initiated (API+Queue)
         Platform sees system costs separately
```

### Pattern 2: Multi-Step Intelligence Process
```
Intelligence run started (tracked)
  └─ Signal clustering (tracked)
  └─ Opportunity detection (tracked)
  └─ Recommendation generation (tracked)

Company dashboard shows:
  intelligence: $2.45
    ├─ Feature: SIGNAL_CLUSTERING
    ├─ Feature: INTELLIGENCE_ANALYSIS
    └─ Feature: INTELLIGENCE_RUN
```

### Pattern 3: Shared Service (Platform-Level)
```
Email sending service (no company_id)
  └─ Still tracked as separate cost
  └─ Shows in "Feature Efficiency" view
  └─ Not attributed to individual companies
```

---

## Troubleshooting

**"My activity type shows as 'other'"**
- Check you're using COMPUTE_FEATURES constants
- Or add logic to `mapFeatureToActivity()` for custom features
- Or pass explicit `activityType` parameter to middleware

**"Company showing as NULL"**
- Verify header/query/body is being passed
- Check request context being extracted correctly
- Add console.log in middleware to debug

**"Cost is zero"**
- Ensure feature > 10ms duration (very fast operations may round to zero)
- Check metrics are actually being flushed to Redis
- Verify middleware is actually wrapping the handler

**"Seeing duplicate activities"**
- Check feature name → activity mapping isn't conflicting
- Ensure you're not wrapping same handler twice

---

## Next: Optimization with Insights

Once data is flowing, dashboard shows automated insights:
- "⚠️ acme-corp @ 35% of total cost"
- "Company activity imbalance: campaign_planning @ 60%"
- "Top 3 companies use 75% of compute"

Use these to:
1. **Identify** which customers drive cost
2. **Optimize** highest-cost activities
3. **Allocate** compute budgets per customer
4. **Upsell** compute-heavy features as premium tier

---

## Need More?

See full documentation: [RAILWAY_COMPANY_ACTIVITY_COSTS.md](./RAILWAY_COMPANY_ACTIVITY_COSTS.md)

Questions? Check troubleshooting section or review existing wrapping patterns in:
- `pages/api/campaigns/*.ts` (API examples)
- `backend/queue/processors/*.ts` (Queue examples)
- `backend/jobs/*.ts` (Cron examples)
