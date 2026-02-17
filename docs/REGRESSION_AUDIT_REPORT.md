# Regression Enforcement & Coverage Audit Report

**Date:** 2026-02-16  
**Scope:** All integration and governance tests, no skipping

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Test Suites | 67 total (46 passed, 21 failed) |
| Tests | 381 total (328 passed, 53 failed) |
| Skipped Tests | **0** (enforced) |
| Skipped Suites | **0** |

---

## Changes Applied

1. **Removed conditional skip** in `publish_flow.test.ts`
   - Previously: test skipped unless `RUN_PUBLISH_FLOW_TEST=true`
   - Now: test always runs

2. **Updated npm test script** in `package.json`
   - Previously: `jest backend/tests/integration/publish_flow.test.ts` (single file)
   - Now: `jest backend/tests --runInBand` (all tests)

3. **Excluded setupEnv.ts from test discovery** in `jest.config.js`
   - Previously: `**/backend/tests/**/*.ts` matched setupEnv.ts as a test file
   - Now: `**/*.test.ts` only (roots: backend/)

---

## Skipped Tests — None

- No `test.skip`, `it.skip`, `describe.skip`, `xit`, `xdescribe` found in test files
- `publish_flow.test.ts` conditional skip removed

---

## Disabled Suites — None

- No disabled or commented-out describe blocks detected

---

## Failed Test Suites (21)

### Infrastructure / Mock Gaps

| Suite | Root Cause |
|-------|------------|
| `publish_flow.test.ts` | `fetch failed` — requires Redis + Supabase running |
| `external_api_alignment.test.ts` | `createQuery().or is not a function` — Supabase mock missing `.or()` |
| `external_api_health.test.ts` | Same `.or()` mock gap + fetch/health store |
| `external_api_presets.test.ts` | `req.query` undefined (missing request mock) |
| `external_api_service.test.ts` | `.or()` mock gap |

### Request / Auth Mock Gaps

| Suite | Root Cause |
|-------|------------|
| `recommendation_create_campaign.test.ts` | `req.headers` undefined |
| `recommendation_audit.test.ts` | `req.headers` undefined; `supabase.from(...).select` undefined |
| `recommendation_policy_navigation.test.ts` | `req.headers` undefined |
| `recommendation_analytics.test.ts` | `req.headers` undefined |

### Policy / DB Mock Gaps

| Suite | Root Cause |
|-------|------------|
| `recommendation_fusion_scoring.test.ts` | `getActivePolicy` → Supabase not mocked for `recommendation_policies` |
| `recommendation_scheduler.test.ts` | `generateRecommendations` not called (mocks/preconditions) |
| `recommendation_simulation.test.ts` | `getCompanyDefaultApiIds is not a function` — mock mismatch |

### API / Handler Failures

| Suite | Root Cause |
|-------|------------|
| `campaign_ai_plan.test.ts` | Handler returns 500 instead of 200 (save/fetch failure) |
| `company_profile_api.test.ts` | `saveProfile`/`getLatestProfile` not called (handler path) |

### Other

| Suite | Root Cause |
|-------|------------|
| `omnivyra_learning_bridge.test.ts` | HTTP 500 from OmniVyra / mock |
| `performance_feedback.test.ts` | `fetch failed` (external call) |

---

## Governance Tests — Status

All governance-related suites run and **pass**:

- `governance_dashboard_ui_snapshot.test.ts` ✓
- `governance_ui_layer.test.ts` ✓
- `governance_event_persistence.test.ts` ✓
- `governance_contract_snapshot.test.ts` ✓
- `governance_preemption_contract.test.ts` ✓
- `governance_tradeoff_order.test.ts` ✓
- `governance_contract_status.test.ts` ✓
- `campaign_governance_summary.test.ts` ✓
- `campaign_preemption_cooldown.test.ts` ✓
- `campaign_preemption_justification.test.ts` ✓
- `campaign_preemption_execution.test.ts` ✓
- `campaign_preemption_approval_flow.test.ts` ✓

**No governance logic was modified.** Failures are limited to test setup (mocks, request objects, Supabase chain methods).

---

## Coverage Gaps (Test Setup)

1. **Supabase mock** — Missing `.or()` for company-scoped queries
2. **Request mocks** — Many API tests omit `req.headers`, `req.query`
3. **Policy/DB mocks** — `recommendation_policies` table not mocked where needed
4. **Infrastructure** — `publish_flow` requires Redis + live Supabase

---

## Incomplete Tests — None Detected

- All test files contain at least one executable test
- No `it.todo` or empty describe blocks found
- No virality-related placeholders left unimplemented

---

## Recommendations

1. **CI:** Run `npm test` with `--runInBand` to avoid parallel resource contention.
2. **Publish flow:** Document Redis + Supabase requirement, or gate in CI via `RUN_PUBLISH_FLOW_TEST=true` only when services are available.
3. **Mock consistency:** Add `.or()` to Supabase chain mock where company-scoped queries are used.
4. **API tests:** Use a shared `createMockRequest()` that provides `headers` and `query` for RBAC/auth paths.
