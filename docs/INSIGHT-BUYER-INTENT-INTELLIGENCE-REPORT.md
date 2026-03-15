# Insight Engine + Buyer Intent Intelligence — Implementation Report

**Date:** 2025-03-10  
**Scope:** Two intelligence layers: Insight Engine with Evidence, Buyer Intent Intelligence Engine.

---

## FILES_CREATED

| File | Description |
|------|-------------|
| `database/engagement_insights.sql` | engagement_insights + engagement_insight_evidence tables |
| `database/buyer_intent_accounts.sql` | buyer_intent_accounts table |
| `backend/services/insightIntelligenceService.ts` | generateInsights, getInsights (with evidence) |
| `backend/services/buyerIntentIntelligenceService.ts` | calculateBuyerIntentAccounts, getBuyerIntentAccounts |
| `backend/workers/insightLearningWorker.ts` | Runs every 6 hours |
| `backend/workers/buyerIntentLearningWorker.ts` | Runs every 30 minutes |
| `pages/api/engagement/insights.ts` | GET insights with evidence |
| `pages/api/engagement/buyer-intent.ts` | GET buyer intent accounts |
| `components/engagement/InsightPanel.tsx` | Insights list, View Evidence button |
| `components/engagement/InsightEvidenceModal.tsx` | Evidence modal: threads, platform, author, snippet, Open Conversation |
| `components/engagement/BuyerIntentPanel.tsx` | High Intent Accounts: author, platform, score, Open discussion, Add to lead tracking |

---

## FILES_MODIFIED

| File | Changes |
|------|---------|
| `components/engagement/AIEngagementAssistant.tsx` | Insights and Buyer Intent Accounts sections below Influencers |
| `components/engagement/index.ts` | Exported InsightPanel, InsightEvidenceModal, BuyerIntentPanel |
| `backend/scheduler/cron.ts` | INSIGHT_LEARNING_INTERVAL_MS = 6h, BUYER_INTENT_INTERVAL_MS = 30m; both workers |

---

## INSIGHTS_ENGINE

**Data sources:** engagement_opportunities

**Insight types:**
- competitor_complaints_increase (opportunity_type = competitor_complaint)
- buying_intent_detected (opportunity_type = buying_intent)
- recommendation_trend (opportunity_type = recommendation_request)
- problem_discussion_spike (opportunity_type = problem_discussion)

**Logic:** Compare last 7 days vs previous 7 days; compute change_percentage; store in engagement_insights; link evidence to engagement_insight_evidence (thread_id, message_id, author_name, platform, text_snippet).

**Retention:** Delete insights older than 7 days before inserting.

---

## EVIDENCE_SYSTEM

**Table:** engagement_insight_evidence (insight_id, thread_id, message_id, author_name, platform, text_snippet)

**Flow:** generateInsights fetches opportunities → messages → authors; inserts evidence rows per message.

**API:** GET /api/engagement/insights returns insights with evidence[] for each.

**UI:** InsightEvidenceModal shows discussion threads, platform icon, author, message snippet; "Open Conversation" calls onOpenConversation(thread_id).

---

## BUYER_INTENT_ENGINE

**Data source:** engagement_opportunities

**Signals:** buying_intent, recommendation_request, product_comparison, problem_discussion

**Score formula:**
```
intent_score = 0.35 * norm(buying_intent) + 0.25 * norm(recommendation_request)
             + 0.20 * norm(product_comparison) + 0.20 * norm(problem_discussion)
```

**Aggregation:** By author_id + platform.

---

## WORKER_SCHEDULE

| Worker | Interval |
|--------|----------|
| runInsightLearningWorker | 6 hours |
| runBuyerIntentLearningWorker | 30 minutes |

---

## API_ENDPOINTS

**GET /api/engagement/insights**
- Query: organization_id
- Response: `{ insights: [{ insight_title, insight_summary, change_percentage, evidence_count, evidence: [...] }] }`

**GET /api/engagement/buyer-intent**
- Query: organization_id, limit (optional)
- Response: `{ accounts: [{ author_name, platform, intent_score, message_count, last_detected_at }] }`

---

## UI_PANELS

- **InsightPanel:** Insights list; "View Evidence (N)" opens InsightEvidenceModal
- **InsightEvidenceModal:** Discussion threads with platform, author, snippet; "Open Conversation" opens thread
- **BuyerIntentPanel:** High Intent Accounts; "Open discussion" filters by author; "Add to lead tracking" (optional handler)

---

## COMPILATION_STATUS

| Field | Value |
|-------|-------|
| **status** | Pass |
| **errors** | None |
| **warnings** | None |

---

## Migration

1. Run `database/engagement_insights.sql`
2. Run `database/buyer_intent_accounts.sql`
