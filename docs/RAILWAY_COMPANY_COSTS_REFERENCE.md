# Railway Company & Activity Costs - Quick Reference

## 🎯 What This Does

Shows you **which company uses how much compute for what activity**:

```
Company → Activity → Features → Cost
acme-corp → campaign_planning → CAMPAIGN_CREATE, OPTIMIZE → $1.23 daily
beta-inc  → publishing → PUBLISH → $0.87 daily
```

---

## 🚀 3-Step Quick Start

### Step 1: Wrap Handler
```typescript
import { withComputeMetrics, COMPUTE_FEATURES } from './railwayComputeMiddleware';
export default withComputeMetrics(COMPUTE_FEATURES.CAMPAIGN_CREATE, handler);
```

### Step 2: Pass Company
```typescript
fetch('/api/campaigns/create', {
  headers: { 'x-company-id': companyId },  // ← Add this
  body: JSON.stringify(data)
});
```

### Step 3: View Dashboard
**System Health → 🚂 Railway Efficiency → 💰 Company & Activity**

---

## 📊 Dashboard Views

### Company View
```
✓ Expandable company cards (Building2 icon)
✓ Activities nested within each company
✓ Cost bars showing % of total
✓ Top features per activity
✓ Drill-down on click
```

### Activity View
```
✓ Activity breakdown across all companies  
✓ Top companies for each activity
✓ Top features by activity
✓ Cost bars and percentages
```

---

## 🔧 Implementation Checklist

- [ ] Wrap API handlers with `withComputeMetrics`
- [ ] Wrap queue processors with `withQueueMetrics`  
- [ ] Wrap cron jobs with `withCronMetrics`
- [ ] Add `company_id` to request headers/body
- [ ] Add `company_id` to job.data for queue jobs
- [ ] Visit dashboard after making some requests
- [ ] Check Redis for metrics flowing: `LRANGE railway:compute:metrics:api 0 -1`

---

## 📁 Files Changed

| File | Type | What Changed |
|------|------|-------------|
| `lib/instrumentation/railwayComputeInstrumentation.ts` | Modified | Added company_id, activity_type fields; company/activity aggregation |
| `backend/lib/railwayComputeMiddleware.ts` | Modified | Auto-extract company_id; feature→activity mapping |
| `pages/super-admin/system-health.tsx` | Modified | Added sub-tabs for company/efficiency views |
| `pages/api/admin/railway-company-costs.ts` | **NEW** | API endpoint for company/activity breakdown |
| `components/super-admin/RailwayCompanyCostsPanel.tsx` | **NEW** | UI component for hierarchical view |
| `docs/RAILWAY_COMPANY_COSTS_*.md` | **NEW** | Full documentation (4 guides) |

---

## 🎨 UI Overview

```
┌─ Summary Cards ─────────────────────────────────────┐
│ Total Cost  │ Companies │ Activities │ Requests     │
│ $12.45      │ 8         │ 5          │ 45,000      │
└─────────────────────────────────────────────────────┘

┌─ Key Insights ──────────────────────────────────────┐
│ • Top cost driver: acme-corp @ 35%                  │
│ • Most intensive: campaign_planning @ 42%           │
│ • 8 companies using compute (diversified)           │
└─────────────────────────────────────────────────────┘

┌─ Companies List ────────────────────────────────────┐
│ [▶] acme-corp           $2.45    35%                │
│     [▼] campaign_planning $1.20   17%                │
│         - CAMPAIGN_CREATE: $0.85                    │
│         - CAMPAIGN_OPTIMIZE: $0.35                  │
│     [▶] publishing       $0.88    13%                │
│     [▶] engagement       $0.37    5%                │
│                                                     │
│ [▶] beta-inc            $1.05    15%                │
│     [▼] publishing       $0.87    12%                │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

---

## 🔌 API Reference

### Endpoint
```
GET /api/admin/railway-company-costs?hours=24&companyId=abc123
```

### Response
```json
{
  "summary": {
    "total_cost_usd": 12.45,
    "estimated_monthly_usd": 373.50,
    "company_count": 8,
    "activity_count": 5
  },
  "companies": [{
    "company_id": "acme-corp",
    "total_cost_usd": 2.45,
    "cost_pct": 35,
    "activities": [{
      "activity_type": "campaign_planning",
      "cost_usd": 1.20,
      "cost_pct": 17,
      "top_features": [...]
    }]
  }],
  "activities": [...],
  "insights": [
    "Top cost driver: acme-corp @ 35% of total",
    "Most compute-intensive: campaign_planning @ 42%",
    ...
  ]
}
```

---

## 🎯 Activity Types (Auto-Mapped)

| Feature Pattern | Maps To | Examples |
|-----------------|---------|----------|
| `CAMPAIGN_*` | campaign_planning | CREATE, RUN, OPTIMIZE |
| `PUBLISH_*` / `SCHEDULE_*` | publishing | PUBLISH, SCHEDULE, BULK |
| `ENGAGEMENT_*` | engagement | POLLING, ANALYSIS, INBOX |
| `INTELLIGENCE_*` | intelligence | RUN, ANALYSIS, SIGNALS |
| `AI_*` / `*CHAT` | content_generation | GENERATION, RECOMMENDATIONS |
| `COMMUNITY_*` | community_ai | ANALYSIS, PLAYBOOK |
| `*_SYNC` / `CACHE_*` | system_operations | DATA_SYNC, CACHE_WARMUP |

---

## 💰 Cost Formula

```
Total = CPU Cost + Memory Cost

CPU Cost = Duration (seconds) × $0.000000417
Memory Cost = Memory (GB) × Duration (seconds) × $0.0000000289

Memory Estimate:
  Base: 128 MB
  +10 MB per second of execution

Example: 5-second campaign creation
  Memory: 128 + 50 = 178 MB = 0.174 GB
  CPU: 5 × $0.000000417 = $0.002085
  Memory: 0.174 × 5 × $0.0000000289 = $0.000000252
  Total: ~$0.002086
```

---

## 🚨 Common Issues

| Problem | Solution |
|---------|----------|
| No data showing | Wrap handlers and pass company_id; wait 1+ min |
| Company is NULL | Add `x-company-id` header or `company_id` in body |
| Cost is $0.00 | Request needs >10ms; check metrics flush |
| Activity is "other" | Feature mapping may be wrong; check middleware |
| Only features showing | Metrics from before company tracking won't have context |

---

## 📈 Expected Data Flow

```
Day 1: Wrap endpoints (1-2 endpoints)
  → After 1 minute: Can see metrics in Redis
  → After 5 minutes: Dashboard shows basic data
  
Day 2-3: Wrap more endpoints (5-10 total)
  → Dashboard shows multiple companies
  → Activities start appearing
  → Insights generate automatically
  
Day 4-7: Wrap remaining endpoints
  → Clear patterns emerge
  → Optimization targets identified
  → Can start cost reduction initiatives
```

---

## 🎓 Learning Resources

| Doc | Length | Purpose |
|-----|--------|---------|
| Quick Start | 2 min read | Get running immediately |
| Implementation | 5 min read | Understand the changes |
| Full Docs | 15 min read | Complete reference |
| API Docs | 5 min read | Endpoint details |

---

## ✨ Key Features

✅ **Automatic Context Extraction** — No manual tracking needed  
✅ **Hierarchical View** — Company → Activity → Feature  
✅ **Proportional Costs** — See % of total at each level  
✅ **Auto-Insights** — Business-level recommendations  
✅ **Sub-Tab View** — Both company and feature efficiency visible  
✅ **Real-Time Updates** — 60-second auto-refresh  
✅ **Zero Overhead** — <1ms per request  
✅ **24-Hour Retention** — Full day of historical data  

---

## 🎯 Success Metrics

| Timeline | Goal |
|----------|------|
| Week 1 | 5+ endpoints wrapped; Data appearing on dashboard |
| Week 2 | 15+ endpoints wrapped; Top cost drivers identified |
| Week 3 | Caching/optimization implemented for #1 cost driver |
| Week 4 | 80%+ backend coverage; 5-15% cost reduction achieved |

---

## 💡 Optimization Ideas

Based on insights:
1. **Cache expensive activities** (if campaign_planning is high)
2. **Reduce activity frequency** (if engagement polling runs too often)
3. **Optimize slow features** (if avg_duration_ms is high)
4. **Tier customers by compute usage** (build premium "high-compute" tier)
5. **Set cost budgets per company** (chargeback model)

---

## 🔗 Quick Links

- **View Dashboard:** System Health → 🚂 Railway Efficiency → 💰 Company & Activity
- **API Endpoint:** `/api/admin/railway-company-costs?hours=24`
- **Quick Start Guide:** [docs/RAILWAY_COMPANY_COSTS_QUICK_START.md](./RAILWAY_COMPANY_COSTS_QUICK_START.md)
- **Full Documentation:** [docs/RAILWAY_COMPANY_ACTIVITY_COSTS.md](./RAILWAY_COMPANY_ACTIVITY_COSTS.md)

---

**Ready to go?** Start wrapping your endpoints! 🚀
