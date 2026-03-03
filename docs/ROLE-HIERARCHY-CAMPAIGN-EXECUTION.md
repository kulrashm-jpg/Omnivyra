# Role Hierarchy — Campaign Execution Model (Final)

**Goal:** Clear parent–child role relationship for company vs campaign execution. No UI changes. No business logic rewrite.

---

## 1. Role Hierarchy Diagram (Text)

```
                    ┌─────────────────────────────────────────────────────────┐
                    │ COMPANY LEVEL (user_company_roles)                        │
                    └─────────────────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    │                                                   │
                    ▼                                                   ▼
    ┌───────────────────────────┐                       ┌───────────────────────────┐
    │ SUPER_ADMIN /             │                       │ COMPANY_ADMIN             │
    │ CAMPAIGN_ARCHITECT        │                       │ (CMO-style oversight)     │
    │ (system / strategy)       │                       │                           │
    └───────────────────────────┘                       └─────────────┬─────────────┘
                    │                                                   │
                    │                                                   │ views all campaigns
                    │                                                   │ assigns campaign managers
                    │                                                   │ does NOT assign creators
                    │                                                   │
                    └───────────────────────────┬─────────────────────┘
                                                │
                    ┌───────────────────────────┴───────────────────────────┐
                    │ CAMPAIGN LEVEL (campaign_user_roles)                   │
                    └───────────────────────────────────────────────────────┘
                                                │
            ┌───────────────────────────────────┼───────────────────────────────────┐
            │                                   │                                   │
            ▼                                   ▼                                   ▼
┌─────────────────────────┐     ┌─────────────────────────┐     ┌─────────────────────────┐
│ CAMPAIGN_CONTENT_       │     │ CONTENT_CREATOR         │     │ (Company override       │
│ MANAGER                  │     │ (campaign-scoped only)  │     │  acts as full access    │
│ (campaign-scoped)        │     │                         │     │  to campaign)           │
│                          │     │ • Assigned tasks only   │     └─────────────────────────┘
│ • Weekly execution       │     │ • No planning access   │
│ • Assigns content         │     │ • No approve/schedule  │
│   creators                │     │   (execution only)     │
│ • Approves content        │     │                         │
│ • Schedules content       │     │                         │
└─────────────────────────┘     └─────────────────────────┘
```

**Parent–child:**

- **Company:** COMPANY_ADMIN is the only company-level “executive” role for this model (CMO-style). SUPER_ADMIN and CAMPAIGN_ARCHITECT sit above for system/strategy.
- **Campaign:** COMPANY_ADMIN can assign **CAMPAIGN_CONTENT_MANAGER** (and view all campaigns). CAMPAIGN_CONTENT_MANAGER assigns **CONTENT_CREATOR** and manages weekly execution. CONTENT_CREATOR has no planning or approval; task-level only.

---

## 2. Final Permission Matrix

### 2.1 Company-level permissions (user_company_roles)

| Permission | COMPANY_ADMIN | CAMPAIGN_ARCHITECT | SUPER_ADMIN | Campaign-level roles |
|------------|---------------|--------------------|-------------|-----------------------|
| VIEW_CAMPAIGNS (all) | ✓ | ✓ | ✓ | — (per campaign only) |
| VIEW_TEAM | ✓ | ✓ | ✓ | — |
| CREATE_USER (company) | ✓ (e.g. invite campaign managers) | — | ✓ | — |
| ASSIGN_ROLE (company) | ✓ (assign COMPANY_ADMIN / campaign managers only; not creators directly) | — | ✓ | — |
| MANAGE_EXTERNAL_APIS | ✓ | ✓ | ✓ | — |
| APPROVE_CONTENT | — (delegated to campaign) | — | ✓ | — |
| PUBLISH_CONTENT | — (delegated to campaign) | — | ✓ | — |
| CREATE_CAMPAIGN | ✓ | ✓ | ✓ | — |

**Rules enforced by matrix:**

- COMPANY_ADMIN: can view all campaigns, assign campaign managers; cannot directly assign or manage content creators (creators are campaign-scoped only).
- Campaign-level roles (CAMPAIGN_CONTENT_MANAGER, CONTENT_CREATOR) do not hold company-level permissions; they exist only in **campaign_user_roles** for execution.

### 2.2 Campaign-level permissions (campaign_user_roles)

| Action | CAMPAIGN_CONTENT_MANAGER | CONTENT_CREATOR | COMPANY_ADMIN (override) |
|--------|---------------------------|-----------------|---------------------------|
| VIEW_CAMPAIGN | ✓ | ✓ | ✓ |
| EDIT_CAMPAIGN_STRATEGY | ✓ | — | ✓ |
| COMMIT_PLAN | ✓ | — | ✓ |
| APPROVE_CONTENT | ✓ | — | ✓ |
| CREATE_CONTENT | ✓ | ✓ | ✓ |
| SCHEDULE_CONTENT | ✓ | — | ✓ |
| Assign content creators to campaign | ✓ | — | ✓ |

**Rules:**

- CONTENT_CREATOR: VIEW_CAMPAIGN + CREATE_CONTENT only (assigned tasks; no planning, no approve, no schedule).
- CAMPAIGN_CONTENT_MANAGER: full execution on the campaign (weekly execution, assign creators, approve, schedule).
- COMPANY_ADMIN: when acting in a campaign, has full access (override) without needing a campaign_user_roles row.

---

## 3. Permission Boundaries (Validation)

| Boundary | Rule | Status |
|----------|------|--------|
| COMPANY_ADMIN does not assign creators at company level | Creators exist only in campaign_user_roles; only CAMPAIGN_CONTENT_MANAGER (or COMPANY_ADMIN in campaign context) assigns them to a campaign. | Documented; enforce in company user APIs by restricting assignable roles to non–CONTENT_CREATOR at company level, or by only allowing CONTENT_CREATOR in campaign_user_roles. |
| Creators are always campaign-scoped | CONTENT_CREATOR is only in campaign_user_roles (per campaign). No CONTENT_CREATOR in user_company_roles for this model. | Documented; ensure invite/assign at company level cannot set CONTENT_CREATOR; creator assignment is via campaign_user_roles only. |
| Campaign manager manages execution | CAMPAIGN_CONTENT_MANAGER: weekly execution, assign creators, approve content, schedule. | Reflected in CAMPAIGN_PERMISSIONS (campaignRoleService); APIs to be gated by campaign role in enforcement phase. |
| Company admin views all, assigns managers only | COMPANY_ADMIN: VIEW_CAMPAIGNS (all), assign campaign managers; no direct creator management. | Reflected in matrix; API list below separates company-admin vs campaign-manager APIs. |

---

## 4. APIs by Role (Who Should Own What)

### 4.1 COMPANY_ADMIN only (company-level; no campaign execution)

| API / area | Purpose | Note |
|------------|---------|------|
| VIEW_CAMPAIGNS (list) | View all campaigns in company | campaigns/list, campaigns/index GET |
| Company user invite / list | Invite users, list team; assign COMPANY_ADMIN or “campaign manager” role only | company/users, users/invite, company/users/[userId]/role — restrict assignable roles to exclude CONTENT_CREATOR at company level |
| VIEW_TEAM | See company roster | Already COMPANY_ADMIN + SUPER_ADMIN |
| MANAGE_EXTERNAL_APIS | Company external API config | external-apis (company-scoped) |
| Company profile (strategy context) | CMO-level context, not weekly execution | company-profile/* read/edit for strategy |
| Create campaign | Create new campaign (company-level action) | campaigns/index POST |
| Assign campaign managers | Assign users to campaign as CAMPAIGN_CONTENT_MANAGER (campaign_user_roles) | New or existing “assign to campaign” API; COMPANY_ADMIN or CAMPAIGN_CONTENT_MANAGER can assign creators to campaign |

### 4.2 CAMPAIGN_CONTENT_MANAGER (campaign-scoped execution)

| API / area | Purpose | Note |
|------------|---------|------|
| Weekly execution | Commit plan, optimize week, scheduler payload | campaigns/commit-daily-plan, campaigns/optimize-week, campaigns/scheduler-payload, campaigns/regenerate-blueprint, run-preplanning |
| Approve / reject content | Content approval workflow | content/approve, content/reject |
| Schedule content | Build schedule, platform plan | campaigns/[id]/schedule-structured-plan, scheduler-payload (for their campaigns) |
| Assign content creators | Add CONTENT_CREATOR to campaign | campaign_user_roles insert (per campaign) |
| Strategy edit (within campaign) | Revise strategy, frequency rebalance, AI improvements | campaigns/[id]/revise-strategy, approve-frequency-rebalance, reject-frequency-rebalance, propose-frequency-rebalance, ai-improvements — can be COMPANY_ADMIN or CAMPAIGN_CONTENT_MANAGER |
| Progress / status | Campaign progress, strategy status | campaigns/[id]/progress, campaigns/[id]/strategy-status |
| Content list (campaign) | List content for campaign | content/list |
| Recommendations (campaign) | Merge recommendations, campaign recommendations | campaigns/[id]/merge-recommendations, campaigns/[id]/recommendations |

### 4.3 CONTENT_CREATOR (campaign-scoped; task only)

| API / area | Purpose | Note |
|------------|---------|------|
| VIEW_CAMPAIGN | See assigned campaign(s) | campaigns/[id] GET, campaigns/list (filtered to assigned) |
| CREATE_CONTENT | Create content for assigned tasks | content/generate-day, content/regenerate (for own tasks) |
| No access | Approve, schedule, commit plan, assign others, edit strategy | — |

---

## 5. Implementation Notes (No Behavior Rewrite in This Doc)

- **CAMPAIGN_CONTENT_MANAGER:** In code and `campaign_user_roles`, may be stored as **CAMPAIGN_OPERATOR** (alias). campaignRoleService treats CAMPAIGN_CONTENT_MANAGER and CAMPAIGN_OPERATOR as equivalent for permissions.
- **CONTENT_CREATOR:** Only in **campaign_user_roles** (per campaign). Not assigned at company level in this model; COMPANY_ADMIN does not “create content creators” in user_company_roles.
- **Company user APIs:** To align with “COMPANY_ADMIN cannot directly manage content creators,” restrict assignable roles at company level (e.g. COMPANY_ADMIN, or a “campaign manager” company role that maps to being assignable to campaigns as CAMPAIGN_CONTENT_MANAGER). CONTENT_CREATOR assignment is only via campaign_user_roles (assign to campaign).
- **Enforcement:** Current APIs still use company role or broad withRBAC; future phase can gate the APIs listed in §4.2 and §4.3 by resolveEffectiveCampaignRole + hasCampaignPermission.

---

## 6. Summary

| Item | Outcome |
|------|--------|
| **Final permission matrix** | §2.1 (company) and §2.2 (campaign). COMPANY_ADMIN: view all, assign managers only. CAMPAIGN_CONTENT_MANAGER: execution + assign creators. CONTENT_CREATOR: task-only, campaign-scoped. |
| **Role hierarchy diagram** | §1 (text). Company level → COMPANY_ADMIN; campaign level → CAMPAIGN_CONTENT_MANAGER → CONTENT_CREATOR. |
| **APIs by role** | §4. COMPANY_ADMIN-only vs CAMPAIGN_CONTENT_MANAGER vs CONTENT_CREATOR. |
| **Permission boundaries** | §3. Validated; creators always campaign-scoped; company admin does not assign creators at company level. |
| **No UI / no business logic rewrite** | Doc and campaignRoleService constants only; no change to UI or core business logic. |
