# Company Intelligence Activation Report

**Date:** 2026-03-07

---

## 1 — Companies Detected

| id | name |
|----|------|
| 9a345956-b11f-4058-b90c-9a4b730f172c | Drishiq |

---

## 2 — Topics Enabled

Inserted **3** new topic rows per company.

Default topics: `AI`, `marketing automation`, `SaaS tools`

---

## 3 — Keywords Enabled

Inserted **2** new keyword rows per company.

Default keywords: `artificial intelligence`, `automation software`

---

## 4 — Competitors Enabled

Inserted **2** new competitor rows per company.

Default competitors: `OpenAI`, `HubSpot`

---

## 5 — Company Signal Count

| Query | Result |
|-------|--------|
| `SELECT COUNT(*) FROM company_intelligence_signals` | **3** |

**Sample (company_id, signal_id, relevance_score, created_at):**

| company_id | signal_id | relevance_score | created_at |
|------------|-----------|-----------------|------------|
| 9a345956... | e598ea9b... | 0.75 | 2026-03-07T11:54:33.385+00:00 |
| 9a345956... | d9707eaf... | 0.575 | 2026-03-07T11:54:33.385+00:00 |
| 9a345956... | c2ec7686... | 0.575 | 2026-03-07T11:54:33.385+00:00 |

---

## Summary

- **Distribution triggered:** `distributeSignalsToCompanies(21 signal IDs)`
- **Result:** companiesProcessed=1, totalInserted=3, totalSkipped=0
- **Script:** `backend/scripts/activateCompanyIntelligence.ts`
