# OmniVyra Social Connection — Final Operational Policy

**Document:** U.S.-compliant operational rules for social platform connections  
**Product:** OmniVyra  
**Purpose:** Definitive policy for implementation; all code and processes must comply  
**Based on:** `OMNIVYRA-SOCIAL-CONNECTION-COMPLIANCE-ACCESS-HIERARCHY.md`, `OMNIVYRA-SOCIAL-CONNECTION-IMPLEMENTATION-PLAN.md`

---

## Phase 1 — Core Principle

**The platform must follow this rule:**

> **No user may access, connect, disconnect, or use a social account unless they (a) have an active membership in the company that owns that account, and (b) hold a role that explicitly grants the capability for that operation.**

In short: **Access is granted only when membership + role permit it.** No exceptions.

---

## Phase 2 — Operational Rules (Mandatory)

### Rule 2.1 — Tenant Isolation (Non-Negotiable)

| Rule | Requirement |
|------|-------------|
| **R2.1.1** | Every read of `social_accounts` MUST filter by `company_id = :companyId` where `companyId` is resolved from the authenticated request (session, JWT, or validated `selectedCompanyId`). |
| **R2.1.2** | Every write to `social_accounts` MUST set `company_id` from validated context (never from untrusted client input alone). |
| **R2.1.3** | Token fetch/usage MUST only resolve tokens for rows where `social_accounts.company_id` equals the operation's company context. |
| **R2.1.4** | APIs that return account lists MUST filter by `company_id`; callers without valid company context receive 400/403. |

### Rule 2.2 — User Authorization (Every Request)

| Rule | Requirement |
|------|-------------|
| **R2.2.1** | Before OAuth start: verify user has `user_company_roles.status = 'active'` for `company_id` and role in `MANAGE_CONNECTORS` (COMPANY_ADMIN, CONTENT_PUBLISHER, CONTENT_REVIEWER). |
| **R2.2.2** | Before OAuth callback: re-validate user session and that `companyId` from state matches a company the user belongs to. |
| **R2.2.3** | Connect page load: resolve `companyId` from session; return only platforms and accounts for that company. |
| **R2.2.4** | Disconnect: allow only if (a) user is COMPANY_ADMIN, or (b) user has MANAGE_CONNECTORS and `social_accounts.user_id = requesting user`. |
| **R2.2.5** | Publish/engagement: require `PUBLISH_CONTENT` or `EXECUTE_ACTIONS`; use tokens only for the same `company_id` as the operation. |

### Rule 2.3 — Credential Handling (Zero User Exposure)

| Rule | Requirement |
|------|-------------|
| **R2.3.1** | OAuth Client ID and Secret MUST never be sent to the client or logged in plaintext. |
| **R2.3.2** | Users MUST never enter Client ID, Client Secret, API base URL, or access token env names. |
| **R2.3.3** | Credentials MUST be resolved server-side from `platform_oauth_configs`, `external_api_sources`, or `.env` only. |
| **R2.3.4** | Tokens MUST be stored encrypted at rest (tokenStore / AES-256-GCM). |

### Rule 2.4 — Platform Policy Compliance

| Rule | Requirement |
|------|-------------|
| **R2.4.1** | OAuth scopes MUST be the minimum required for publish and engagement (no excessive read scopes). |
| **R2.4.2** | User consent MUST be obtained via platform OAuth flow (explicit authorization on LinkedIn, Facebook, etc.). |
| **R2.4.3** | Disconnect MUST revoke or invalidate local tokens; support platform token revocation where available. |
| **R2.4.4** | Token refresh MUST run before expiry; do not persist expired tokens in plaintext. |

### Rule 2.5 — Minimal Friction (User Experience)

| Rule | Requirement |
|------|-------------|
| **R2.5.1** | Connect flow MUST be one click: user selects company (if multi-company), clicks "Connect {Platform}", completes OAuth. |
| **R2.5.2** | Connect page MUST show only platforms with valid OAuth config and enabled status. |
| **R2.5.3** | Connect page MUST NOT present credential fields to any non–super-admin user. |
| **R2.5.4** | Error messages MUST be user-friendly; never expose internal config details. |

### Rule 2.6 — Audit & Observability

| Rule | Requirement |
|------|-------------|
| **R2.6.1** | Log (server-side, not client): `(user_id, company_id, platform, action)` for connect, disconnect, reconnect. |
| **R2.6.2** | Log failed access attempts: `(user_id, company_id, resource, reason)`. |
| **R2.6.3** | Do NOT log tokens, Client ID, or Client Secret. |

---

## Phase 3 — Enforcement Points

| Location | Rule(s) | Action |
|----------|---------|--------|
| `/api/oauth/{platform}/start` | R2.2.1, R2.3.1–3 | Validate company membership + MANAGE_CONNECTORS; resolve credentials server-side |
| `/api/oauth/{platform}/callback` | R2.1.2, R2.2.2, R2.4.1–4 | Validate state; set company_id; store encrypted tokens |
| `GET /api/oauth/platforms` | R2.1.1, R2.2.3 | Filter by company_id; return only authorized data |
| Disconnect API | R2.1.1, R2.2.4 | Validate company + (admin OR owner) |
| TokenStore / getToken | R2.1.3 | Enforce company_id in upstream caller |
| Publish pipeline | R2.2.5 | Require PUBLISH_CONTENT; filter accounts by company_id |
| Community AI executor | R2.2.5 | Require EXECUTE_ACTIONS; filter by company_id |

---

## Phase 4 — Capability Matrix (Quick Reference)

| Operation | Capability | Roles |
|------------|------------|-------|
| View Connect page | MANAGE_CONNECTORS | COMPANY_ADMIN, CONTENT_PUBLISHER, CONTENT_REVIEWER |
| Connect platform | MANAGE_CONNECTORS | Same |
| Disconnect own | MANAGE_CONNECTORS + owner | Same |
| Disconnect other | COMPANY_ADMIN only | COMPANY_ADMIN |
| Publish using token | PUBLISH_CONTENT | CONTENT_PUBLISHER, COMPANY_ADMIN |
| Execute engagement | EXECUTE_ACTIONS | Same |
| Configure OAuth (global) | SUPER_ADMIN | SUPER_ADMIN |

---

## Phase 5 — Compliance Summary

| Expectation | Policy Rule |
|-------------|-------------|
| U.S. SaaS standards | R2.1 (isolation), R2.2 (authorization), R2.3 (credential handling), R2.6 (audit) |
| Platform developer policies | R2.4 (OAuth scopes, consent, revocation, refresh) |
| User authorization | R2.2 (membership + role on every operation) |
| Minimal friction | R2.5 (one-click connect, no credential input) |
| Tenant isolation | R2.1 (company_id on all reads/writes) |

---

## Phase 6 — Policy Checklist for New Code

Before merging any change that touches social connections:

- [ ] All `social_accounts` queries include `company_id` filter.
- [ ] OAuth start/callback validate company membership and role.
- [ ] No credentials or tokens sent to client.
- [ ] Connect UI has no credential input for non–super-admin.
- [ ] Disconnect enforces admin OR owner.
- [ ] Audit logging in place for connect/disconnect (no sensitive data).

---

**End of Operational Policy**
