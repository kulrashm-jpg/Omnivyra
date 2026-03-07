# Phase-4 Company Signal Filtering Engine — Implementation Report

---

## 1. File Created

| File | Path |
|------|------|
| Company Signal Filtering Engine | `backend/services/companySignalFilteringEngine.ts` |

---

## 2. Exported Methods

| Method | Signature | Purpose |
|--------|-----------|---------|
| `loadCompanyIntelligenceConfiguration` | `(companyId: string) => Promise<CompanyIntelligenceConfiguration>` | Load config from Phase-3 tables (enabled items only) |
| `evaluateSignalAgainstCompany` | `(signal: IntelligenceSignalInput, companyConfig: CompanyIntelligenceConfiguration) => SignalMatchEvaluation` | Evaluate single signal against config |
| `filterSignalsForCompany` | `(companyId: string, signals: T[]) => Promise<FilteredSignalWithEvaluation<T>[]>` | Main filter; returns signals with at least one match |

**Exported types:**
- `CompanyIntelligenceConfiguration`
- `IntelligenceSignalInput`
- `SignalMatchEvaluation`
- `FilteredSignalWithEvaluation<T>`

---

## 3. Filtering Logic

**Relevance rule:** Signal is relevant if **at least one** of `topic_match`, `competitor_match`, `product_match`, `region_match`, `keyword_match` is true.

| Condition | Logic |
|-----------|-------|
| topic_match | Signal topic contains config topic (substring) OR token overlap |
| competitor_match | Signal topic contains any enabled competitor_name (substring) |
| product_match | Signal topic contains any enabled product_name (substring) |
| region_match | `normalized_payload.geo` or `normalized_payload.region` contains any enabled region |
| keyword_match | Signal topic contains any enabled keyword (substring) |

**Match output:**
- `matched_topics`: config topic strings that matched
- `matched_competitors`: config competitor_name strings that matched
- `matched_regions`: config region strings that matched

**Tokenization:** Lowercase, strip non-alphanumeric, split on whitespace, tokens ≥ 2 chars.

**Empty config:** If no enabled items in any table, returns `[]`.

**Empty topic:** Signals with empty topic are skipped.

---

## 4. Configuration Loading Queries

| Table | Query | Filter |
|-------|-------|--------|
| company_intelligence_topics | `getCompanyTopics(companyId)` | `.filter(t => t.enabled)` |
| company_intelligence_competitors | `getCompanyCompetitors(companyId)` | `.filter(c => c.enabled)` |
| company_intelligence_products | `getCompanyProducts(companyId)` | `.filter(p => p.enabled)` |
| company_intelligence_regions | `getCompanyRegions(companyId)` | `.filter(r => r.enabled)` |
| company_intelligence_keywords | `getCompanyKeywords(companyId)` | `.filter(k => k.enabled)` |

Queries run in parallel via `Promise.all`. Values normalized to lowercase, trimmed, deduplicated.

---

## 5. Integration Point with Existing Company Intelligence Flow

**File:** `backend/services/companyIntelligenceStore.ts`

**Function:** `processInsertedSignalsForCompany(companyId, insertedSignalIds)`

**Flow change:**

```
BEFORE:
  fetchSignalsByIds → loadCompanyContextForIntelligence → transformToCompanySignals → insertCompanyIntelligenceSignals

AFTER:
  fetchSignalsByIds → filterSignalsForCompany → [filtered signals] → loadCompanyContextForIntelligence → transformToCompanySignals → insertCompanyIntelligenceSignals
```

**Code change:**
1. After `fetchSignalsByIds`, call `filterSignalsForCompany(companyId, signals)`.
2. If `filtered.length === 0`, return `{ inserted: 0, skipped: 0 }`.
3. Build `globalInputs` from `filtered.map(f => f.signal)`.
4. Existing `loadCompanyContextForIntelligence` and `transformToCompanySignals` run on filtered signals only.

**Downstream:** `companySignalRankingEngine` (future) will sit between filter output and `insertCompanyIntelligenceSignals`; evaluation metadata is available for that step.
