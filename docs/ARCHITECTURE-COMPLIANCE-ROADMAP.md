# Architecture Compliance Roadmap: Future-Proof and Scale-Ready

This document reviews the current architecture against our two principles—**scale by adding infrastructure** and **multi-tenant safety**—and lists what is already aligned and what remains to be done so the system is fully compliant and “architecture of the future.”

---

## Principles (Target State)

1. **Scale by infrastructure** — More users → add more app instances, workers, DB/Redis capacity. No application redesign. (See [SCALING-INFRASTRUCTURE-PRINCIPLE.md](./SCALING-INFRASTRUCTURE-PRINCIPLE.md).)
2. **Multi-tenant safety** — Every request that touches company or campaign data must verify the authenticated user has access. Never trust client-supplied `companyId` for **which** company’s data to read or write; for campaign-scoped APIs, derive company from the campaign (e.g. `campaign_versions` by `campaign_id`) and then check user access to that company and campaign.

---

## Already Aligned

### Scaling
- **Stateless API** — No in-process session store; auth and state from DB/cookies.
- **Persistence in DB** — Supabase; no local-only storage for correctness.
- **Background work** — BullMQ + Redis; scale by adding workers.
- **Per-instance in-memory state** — Rate limits, caches, health maps are documented; adding instances does not break correctness.

### Multi-tenant and access
- **Plan API** (`/api/campaigns/ai/plan`) — Auth + company/campaign access; company derived from DB by `campaignId`; persistence uses `resolvedCompanyId` only.
- **Campaign [id] APIs (many)** — e.g. `strategy-status`, `progress`, `lead-conversion-intelligence`, `ai-improvements`, `approve-strategy`, `reject-frequency-rebalance`, etc. — use `getSupabaseUserFromRequest`, get `company_id` from `campaign_versions` by `campaign_id`, then `getUserRole` + `resolveEffectiveCampaignRole` (or equivalent). **Progress** also enforces campaign–company binding (campaign must belong to the company).
- **Company-scoped APIs** — Company profile, company users, playbooks, etc. take `companyId` from client but call `resolveCompanyAccess` / `ensureCompanyAccess` so the user must have access to that company before any read/write.
- **Campaign list** — Requires `companyId` and checks `getUserCompanyRole` + permission before listing.

---

## Gaps to Close (Compliance Work)

### 1. Campaign APIs with no auth — **DONE**

A shared helper `requireCampaignAccess(req, res, campaignId)` was added in `backend/services/campaignAccessService.ts`. The following endpoints now enforce auth and campaign access (company resolved from DB):

| Endpoint | Status |
|----------|--------|
| `GET /api/campaigns/get-weekly-plans` | Uses `requireCampaignAccess`; returns 401/403/404 when user has no access. |
| `GET /api/campaigns/daily-plans` | Same. |
| `GET /api/campaigns/[id]/readiness` | Same. |
| `POST /api/campaigns/forecast` | Same; body now requires only `campaignId` (company derived from campaign). |
| `POST /api/campaigns/audit-report` | Same; body now requires only `campaignId`. |
| `POST /api/learning/insights` | Same; body now requires only `campaignId`. |

### 2. Campaign–company binding — **DONE**

| Endpoint | Status |
|----------|--------|
| `POST /api/campaigns/approve` | Before update, loads `company_id` from `campaign_versions` for `campaignId`; returns 403 `CAMPAIGN_NOT_IN_COMPANY` if it does not match the client’s `companyId`. |

### 3. Consistent “campaign access” pattern — **DONE**

- **`requireCampaignAccess(req, res, campaignId)`** in `backend/services/campaignAccessService.ts`:
  - Returns 401 if not authenticated.
  - Loads `company_id` from `campaign_versions` by `campaign_id`; returns 404 if not found.
  - Checks `getUserRole` and `resolveEffectiveCampaignRole`; returns 403 on denial.
  - Returns `{ userId, companyId, campaignId, campaignAuth? }` for the handler to use.
- The six endpoints above use this helper; new campaign-scoped endpoints should use it as well.

### 4. Optional: Derive company from campaign everywhere (lower priority)

Where an API is **campaign-scoped** (e.g. forecast, audit-report, approve), best practice is to **not** rely on client-supplied `companyId` for which company’s data is used. Instead, resolve `company_id` from `campaign_versions` by `campaign_id` and use that for both access check and data access. That way one source of truth (DB) defines campaign–company relationship.

- Endpoints like **forecast**, **audit-report**, **approve** could be changed to take only `campaignId` (from path or body) and derive company server-side. This aligns with the plan API and reduces risk of client passing wrong company.

---

## Optional / Later (Nice-to-Have for “Architecture of the Future”)

- **Redis for shared rate limit / cache** — When you need global rate limiting or higher cache hit rate across instances, move the in-memory maps (see [SCALING-INFRASTRUCTURE-PRINCIPLE.md](./SCALING-INFRASTRUCTURE-PRINCIPLE.md)) to Redis. Infra change, not an app rewrite.
- **Stricter Content Architect scope** — Ensure Content Architect paths only allow access to companies/campaigns they are allowed to see (if not already enforced).
- **Audit logging** — Log access decisions (e.g. campaign id, company id, user id, outcome) for security and compliance; does not change scaling or multi-tenant model.

---

## Summary

| Area | Status | Next steps |
|------|--------|------------|
| Scale by infrastructure | Aligned | Keep stateless APIs; avoid new single-instance or sticky-session assumptions. |
| Multi-tenant (plan API, many [id] APIs) | Aligned | None. |
| Campaign APIs with no auth | **Done** | get-weekly-plans, daily-plans, [id]/readiness, forecast, audit-report, learning/insights now use `requireCampaignAccess`. |
| Campaign–company binding | **Done** | approve verifies campaign belongs to company before update. |
| Consistent campaign access | **Done** | `requireCampaignAccess` in `backend/services/campaignAccessService.ts`; use it for new campaign-scoped endpoints. |
| Derive company from campaign | **Done** | forecast, audit-report, learning/insights now require only `campaignId` and derive company from DB. |

**Note for API clients:** `POST /api/campaigns/forecast`, `POST /api/campaigns/audit-report`, and `POST /api/learning/insights` now require only `campaignId` in the body (and auth). Sending `companyId` is optional and ignored; company is resolved server-side from the campaign.
