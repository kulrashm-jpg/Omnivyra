# Railway Compute Cost Intelligence - Quick Reference

## 🚀 5-Minute Integration

### Copy-Paste API Handler Example
```typescript
// pages/api/ai/generate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { withComputeMetrics, COMPUTE_FEATURES } from '../../../backend/lib/railwayComputeMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const result = await generateAIContent(req.body);
  res.status(200).json({ result });
}

// Wrap it!
export default withComputeMetrics(COMPUTE_FEATURES.AI_GENERATION, handler);
```

### Copy-Paste Queue Job Example
```typescript
// In your queue processor
import { withQueueMetrics, COMPUTE_FEATURES } from '../../backend/lib/railwayComputeMiddleware';

const publishProcessor = withQueueMetrics(
  COMPUTE_FEATURES.PUBLISH,
  async (job) => {
    await publishPost(job.data);
    return { published: true };
  }
);

// Use in Worker
new Worker('publish', publishProcessor, { connection: redis });
```

### Copy-Paste Cron Job Example
```typescript
// In your cron job
import { withCronMetrics, COMPUTE_FEATURES } from '../../backend/lib/railwayComputeMiddleware';

export default withCronMetrics(
  COMPUTE_FEATURES.ENGAGEMENT_POLLING,
  'engagementPolling',
  async () => {
    await pollEngagements();
  }
);
```

---

## 📊 What You'll See

After wrapping endpoints, visit:
```
Super Admin → System Health → 🚂 Railway Efficiency
```

**Overview Cards:**
```
┌─────────────────────────────────────────┐
│ 💰 Estimated Cost    │ ⏱️ Compute Time   │
│ $1.23 (last 24h)    │ 4.2 hours        │
│ $37/mo estimate     │ 850ms avg req    │
│                     │                   │
│ 📞 Request Count    │                   │
│ 5,432 requests      │                   │
└─────────────────────────────────────────┘
```

**Top Features:**
```
| Feature           | Cost % | Calls | Cost  |
|-------------------|--------|-------|-------|
| ai_generation     | 42%    | 234   | $0.52 |
| campaign_run      | 28%    | 87    | $0.35 |
| engagement_polling| 18%    | 144   | $0.22 |
```

**Insights Generated:**
```
⚠️ ai_generation dominates at 42% — consider caching
⏱️ Average duration is 850ms — check for N+1 queries
🔄 campaign_run is slow but called frequently
```

---

## 🎯 Features

| Feature | Purpose |
|---------|---------|
| **Automatic tracking** | No manual setup per request |
| **Cost calculation** | Railway pricing model applied |
| **Insights** | Auto-detect cost concentration, slow jobs, high volume |
| **Drill-down** | API endpoints, queue jobs, cron breakdown |
| **Control suggestions** | Caching, rate limiting, frequency adjustment |
| **Monthly projection** | Extrapolates 24h to 30 days |

---

## 🔄 Data Flow Architecture

```
┌──────────────────────┐
│  API Handler         │
│  Queue Job           │ ──> recordComputeMetric()
│  Cron Task           │      (low overhead)
└──────────────────────┘
            ↓
┌──────────────────────┐
│  In-Memory Buffer    │ (100 metrics or 60s)
└──────────────────────┘
            ↓
┌──────────────────────┐
│  Redis List          │ (24h retention)
│  railway:compute:*   │
└──────────────────────┘
            ↓
┌──────────────────────────────────────┐
│  GET /api/admin/railway-efficiency   │
│  • Retrieve from Redis               │
│  • Calculate costs                   │
│  • Generate insights                 │
│  • Return JSON                       │
└──────────────────────────────────────┘
            ↓
┌──────────────────────────────────────┐
│  RailwayEfficiencyPanel              │
│  • Display cards & tabs              │
│  • Show drill-down data              │
│  • List control actions              │
└──────────────────────────────────────┘
```

---

## 📋 Feature Names (Copy-Paste Ready)

```typescript
// AI & Content
COMPUTE_FEATURES.AI_GENERATION
COMPUTE_FEATURES.AI_CHAT

// Campaign Management
COMPUTE_FEATURES.CAMPAIGN_CREATE
COMPUTE_FEATURES.CAMPAIGN_RUN
COMPUTE_FEATURES.CAMPAIGN_OPTIMIZE

// Publishing & Scheduling
COMPUTE_FEATURES.PUBLISH
COMPUTE_FEATURES.SCHEDULE

// Engagement
COMPUTE_FEATURES.ENGAGEMENT_POLLING
COMPUTE_FEATURES.ENGAGEMENT_ANALYSIS
COMPUTE_FEATURES.ENGAGEMENT_INBOX

// Intelligence
COMPUTE_FEATURES.INTELLIGENCE_RUN
COMPUTE_FEATURES.INTELLIGENCE_ANALYSIS
COMPUTE_FEATURES.SIGNAL_CLUSTERING

// Community AI
COMPUTE_FEATURES.COMMUNITY_AI_ANALYSIS
COMPUTE_FEATURES.PLAYBOOK_EVAL

// System
COMPUTE_FEATURES.DATA_SYNC
COMPUTE_FEATURES.CACHE_WARMUP
COMPUTE_FEATURES.AUDIT_RUN
```

---

## 🧪 Manual Testing

### Test 1: Check Redis is storing metrics
```bash
redis-cli
> LLEN railway:compute:metrics:api
(integer) 45
> LRANGE railway:compute:metrics:api 0 0
```

### Test 2: Check API endpoint
```bash
curl http://localhost:3000/api/admin/railway-efficiency?hours=1
```

### Test 3: Visit dashboard
```
→ http://localhost:3000/super-admin/system-health
→ Click 🚂 Railway Efficiency tab
→ Should see your metrics
```

---

## 💡 Common Patterns

### Pattern 1: Database Query
```typescript
export default withComputeMetrics(COMPUTE_FEATURES.DATA_SYNC, async (req, res) => {
  const data = await fetchFromDB();
  res.json(data);
});
```

### Pattern 2: AI/LLM Call
```typescript
export default withComputeMetrics(COMPUTE_FEATURES.AI_GENERATION, async (req, res) => {
  const output = await llm.generate(req.body);
  res.json(output);
});
```

### Pattern 3: External API Call
```typescript
export default withComputeMetrics(COMPUTE_FEATURES.ENGAGEMENT_POLLING, async (req, res) => {
  const data = await linkedinAPI.fetchComments();
  res.json(data);
});
```

### Pattern 4: Complex Job
```typescript
const complexJobProcessor = withQueueMetrics(
  COMPUTE_FEATURES.CAMPAIGN_RUN,
  async (job) => {
    // Long-running computation
    return { success: true };
  }
);
```

---

## 🔍 Cost Model

```
Cost per request = CPU cost + Memory cost

CPU cost = (duration_ms / 1000) × $0.000000417
Memory cost = (estimated_memory_gb) × (duration_sec) × $0.0000000289

Example 1 (fast request):
- 50ms duration, 128MB
- CPU: 0.05 * 0.000000417 = $0.00000002
- Mem: 0.125 * 0.05 * 0.0000000289 = $0.00000000000181
- Total: ~$0.00000002 (negligible)

Example 2 (AI generation):
- 2,000ms duration, 512MB
- CPU: 2.0 * 0.000000417 = $0.000834
- Mem: 0.5 * 2.0 * 0.0000000289 = $0.00000000289
- Total: ~$0.000834

Example 3 (batch job):
- 60,000ms duration, 1GB
- CPU: 60.0 * 0.000000417 = $0.025
- Mem: 1.0 * 60.0 * 0.0000000289 = $0.001734
- Total: ~$0.027
```

---

## 👁️ What Auto-Insights Look Like

**Cost Concentration:**
```
"⚠️ ai_generation dominates compute cost at 58% — 
 consider optimization or caching"
```

**Performance:**
```
"⏱️ Average request duration is 1,850ms — 
 check for slow database queries or external API calls"
```

**Efficiency:**
```
"✓ Average completion time is very fast (45ms) — 
 compute is well-optimized"
```

**High-Volume Slow Job:**
```
"🔄 campaign_run is slow (1,200ms) but called frequently — 
 batching could help"
```

---

## 🛑 Troubleshooting

### No metrics showing up?
```
1. Check API handler was wrapped with withComputeMetrics()
2. Make a test request: curl http://localhost:3000/api/...
3. Check Redis: redis-cli LLEN railway:compute:metrics:api
4. Wait 60 seconds or make 100+ requests to flush buffer
```

### Cost seems too high?
```
1. Check memory estimation in recordComputeMetric() call
2. Verify Railway pricing rates in railwayComputeInstrumentation.ts
3. May include all dependent operations (DB queries, external calls)
```

### Insights not generated?
```
1. Need at least 10 metrics of a feature to show insights
2. Make multiple requests to same endpoint
3. Wait for insights engine to process
```

---

## 📈 Expected Metrics

After 1 hour of normal traffic:
```
Total requests: 1,000-5,000
Total compute time: 30-60 minutes
Estimated hourly cost: $0.50-$5.00
Top feature: AI or Campaign operations (40-60% of cost)
```

After 1 week:
```
You should see clear patterns:
- Which features are expensive
- Which endpoints are slow
- Which cron jobs run too frequently
```

After 2 weeks:
```
Ready to optimize based on insights:
- Cache expensive features (-20% cost)
- Profile slow endpoints (-15% cost)
- Adjust cron intervals (-10% cost)
Total potential: -45% compute cost
```

---

## 🎬 Next Steps

### Today: Add Instrumentation
1. Wrap top 3 API endpoints
2. Wrap top 2 queue processors
3. Test that metrics appear

### This Week: Monitor & Optimize
1. Review insights daily
2. Identify top 3 optimization opportunities
3. Start implementing easy wins

### Next Week: Cost Reduction
1. Add caching to expensive endpoints
2. Adjust cron frequencies
3. Profile slow jobs
4. Measure impact

---

## 📞 File Locations

**To integrate:**
- Go to: any `pages/api/` file
- Add: `import { withComputeMetrics, COMPUTE_FEATURES } from '../../../backend/lib/railwayComputeMiddleware'`
- Wrap: `export default withComputeMetrics(COMPUTE_FEATURES.XXX, handler)`

**To view:**
- URL: `http://localhost:3000/super-admin/system-health`
- Click: 🚂 Railway Efficiency tab

**To read code:**
- Core: `lib/instrumentation/railwayComputeInstrumentation.ts`
- Middleware: `backend/lib/railwayComputeMiddleware.ts`
- API: `pages/api/admin/railway-efficiency.ts`
- UI: `components/super-admin/RailwayEfficiencyPanel.tsx`

---

## ✨ That's It!

Wrap 3-5 endpoints today and start seeing metrics.

Questions? See: `docs/RAILWAY_COMPUTE_COST_INTELLIGENCE.md`
