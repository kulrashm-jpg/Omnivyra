# OmniVyra Social Connection — Compliance & Access Hierarchy

**Document:** User access model and compliance for social platform connections  
**Product:** OmniVyra  
**Purpose:** Ensure multi-tenant security, U.S. SaaS standards, and platform policy compliance  
**Based on:** `OMNIVYRA-SOCIAL-CONNECTION-IMPLEMENTATION-PLAN.md`

---

## Phase 1 — User Access Model

### 1.1 Access Hierarchy (Defined)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 0: SYSTEM                                                                   │
│ ─────────────────────────────────────────────────────────────────────────────────│
│ • super_admin (user_roles)                                                        │
│ • Manages platform_oauth_configs (global OAuth credentials)                       │
│ • Cross-tenant visibility for debugging only; no token access                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 1: COMPANY                                                                   │
│ ─────────────────────────────────────────────────────────────────────────────────│
│ • company_admin (user_company_roles)                                               │
│ • Full access to company's connected accounts                                     │
│ • Can connect, disconnect, reconnect platforms for the company                     │
│ • Can view all social_accounts for company_id                                     │
│ • Cannot access other companies' data                                             │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 2: ROLE-BASED CONNECTOR ACCESS                                              │
│ ─────────────────────────────────────────────────────────────────────────────────│
│ • content_publisher, content_reviewer (user_company_roles)                        │
│ • Can connect their own social accounts to the company                            │
│ • Can use connected accounts for publishing / engagement                           │
│ • Cannot disconnect accounts connected by other users (unless company_admin)      │
│ • Can view accounts they connected; company_admin sees all                         │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ LEVEL 3: USER-ACCOUNT BINDING                                                     │
│ ─────────────────────────────────────────────────────────────────────────────────│
│ • social_accounts(user_id, company_id, platform, ...)                            │
│ • Each row = one user's connection of one platform account to one company         │
│ • User A cannot use User B's tokens                                               │
│ • Company X cannot see Company Y's tokens                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Hierarchical Access Rules

| Role               | Connect Account | View Own | View All Company | Disconnect Own | Disconnect Other | Use for Publish |
|--------------------|-----------------|----------|------------------|----------------|------------------|-----------------|
| **super_admin**    | No*             | No*      | No*              | No*            | No*              | No*             |
| **company_admin**  | Yes             | Yes      | Yes              | Yes            | Yes              | Yes             |
| **content_publisher** | Yes        | Yes      | No               | Yes            | No               | Yes             |
| **content_reviewer**  | Yes         | Yes      | No               | Yes            | No               | Yes             |
| **content_creator**   | No**          | No**     | No               | No             | No               | No**            |
| **view_only**        | No            | No       | No               | No             | No               | No              |

*super_admin configures OAuth credentials only; does not connect personal accounts.  
**content_creator can create content but cannot connect accounts; publishing requires content_publisher+.

---

## Phase 2 — Multi-Tenant Data Isolation

### 2.1 Isolation Rules

1. **Read social_accounts**
   - Always filter by `company_id = :companyId` (from session/selected company).
   - For non–company-admin: also filter `user_id = :userId` (user sees only their own connections).
   - For company_admin: may read all rows for `company_id`.

2. **Write social_accounts**
   - Always set `company_id` from validated context (never from client alone).
   - Validate user has `MANAGE_CONNECTORS` (or equivalent) for that `company_id` before insert/update/delete.

3. **Token usage (publishing, engagement, ingestion)**
   - Resolve tokens only for `social_accounts` where `company_id` matches the operation’s company context.
   - Never return tokens to the client; use server-side only.
   - Audit: log which `(user_id, company_id)` triggered token usage.

### 2.2 Validation Checkpoints

| Checkpoint        | Validation |
|-------------------|------------|
| OAuth start       | User has active membership in `company_id` (user_company_roles) and role in `MANAGE_CONNECTORS` |
| OAuth callback    | State includes `companyId`; verify user still has access before persisting |
| Connect page load  | Resolve `companyId` from session; return only platforms/accounts for that company |
| Token fetch       | Caller’s `company_id` matches `social_accounts.company_id` |
| Disconnect        | User is company_admin OR (content_publisher/content_reviewer AND `user_id` matches row) |

---

## Phase 3 — U.S. SaaS & Platform Policy Compliance

### 3.1 OAuth & Platform Policies

| Requirement              | Implementation |
|--------------------------|----------------|
| **Minimal scopes**       | Request only scopes needed for publish/engage; avoid broad read scopes unless required |
| **User consent**         | OAuth flow requires explicit user authorization on platform (LinkedIn, Facebook, etc.) |
| **Token storage**        | Encrypt tokens at rest (AES-256-GCM via tokenStore) |
| **Token refresh**        | Implement refresh before expiry; do not persist expired tokens in plaintext |
| **Revocation**           | Provide disconnect; support platform token revocation where available |
| **No credential exposure** | Client ID/Secret never sent to client; users never enter credentials |

### 3.2 Data Handling (CCPA / State Privacy)

- Tokens are **not** personal data for CCPA sale; they are operational credentials.
- Support user/company deletion: cascade delete `social_accounts` when company or user is removed.
- Log access for audit; retain only as long as needed for operations and compliance.

### 3.3 Platform-Specific Notes

- **LinkedIn:** Use approved Marketing API products; comply with [LinkedIn Terms](https://www.linkedin.com/legal/api-terms).
- **Facebook/Instagram:** Follow [Facebook Platform Terms](https://developers.facebook.com/terms/); Business use requires Business verification where applicable.
- **Twitter/X:** Comply with [Developer Agreement](https://developer.twitter.com/en/developer-terms).
- **YouTube:** [YouTube API Services Terms](https://developers.google.com/youtube/terms).

---

## Phase 4 — Permission Requirements for Operations

### 4.1 Capability Matrix

| Operation                    | Required Capability   | Enforced In                    |
|-----------------------------|------------------------|--------------------------------|
| View Connect Accounts page  | `MANAGE_CONNECTORS`    | Connect UI, `/api/oauth/platforms` |
| Click Connect (OAuth start)  | `MANAGE_CONNECTORS`    | `/api/oauth/{platform}/start`  |
| OAuth callback (save token) | Valid session + state  | `/api/oauth/{platform}/callback` |
| Disconnect account          | `MANAGE_CONNECTORS` + (own row OR company_admin) | Disconnect API |
| Use token for publish       | `PUBLISH_CONTENT` or higher | Publish pipeline            |
| Use token for engagement    | `EXECUTE_ACTIONS`      | Community AI action executor   |

### 4.2 Role → Capability Mapping (Current)

From `communityAiCapabilities.ts` and `rbacService.ts`:

- **MANAGE_CONNECTORS:** COMPANY_ADMIN, SUPER_ADMIN, CONTENT_PUBLISHER, CONTENT_REVIEWER
- **PUBLISH_CONTENT:** CONTENT_PUBLISHER, COMPANY_ADMIN, SUPER_ADMIN
- **EXECUTE_ACTIONS:** CONTENT_PUBLISHER, COMPANY_ADMIN, SUPER_ADMIN

---

## Phase 5 — Enterprise Scaling Safeguards

### 5.1 Rate Limiting & Quotas

| Resource          | Safeguard |
|-------------------|-----------|
| OAuth starts      | Per user/company: limit starts per minute to reduce abuse |
| Token storage     | Enforce max connected accounts per company (configurable) |
| Platform API calls| Respect platform rate limits; implement backoff and queueing |

### 5.2 Audit Trail

Log (do not expose to client):

- `(user_id, company_id, platform, action)` for: connect, disconnect, reconnect.
- Token usage: `(company_id, platform, operation)` for publish/engagement.
- Failed access attempts: `(user_id, company_id, resource, reason)`.

### 5.3 Separation of Duties

- **System admin:** Configures OAuth apps; does not connect accounts.
- **Company admin:** Manages company connectors; may connect on behalf of company.
- **Content publishers/reviewers:** Connect and use their own accounts within the company.

---

## Phase 6 — Implementation Checklist for Compliance

| # | Item | Status |
|---|------|--------|
| 1 | Enforce `company_id` in all social_accounts reads/writes | Required |
| 2 | Validate company membership + MANAGE_CONNECTORS before OAuth start | Required |
| 3 | Restrict Connect page and `/api/oauth/platforms` to MANAGE_CONNECTORS | Required |
| 4 | Enforce user_id filter for non-admin (view own connections only) | Required |
| 5 | Disconnect: allow only company_admin OR owner of connection | Required |
| 6 | Encrypt tokens at rest (tokenStore) | Exists |
| 7 | Never expose Client ID/Secret to client | Required |
| 8 | Add audit logging for connect/disconnect/token usage | Recommended |
| 9 | Document platform terms compliance in admin docs | Recommended |
| 10 | Add RLS or equivalent for social_accounts if using Supabase RLS | Optional |

---

## Summary

| Principle | Implementation |
|-----------|----------------|
| **Access hierarchy** | System → Company → Role → User-account binding |
| **Tenant isolation** | All queries filter by `company_id`; non-admin filtered by `user_id` |
| **Permission model** | MANAGE_CONNECTORS for connect/disconnect; PUBLISH/EXECUTE for token use |
| **Compliance** | Encrypted tokens, minimal scopes, user consent, platform terms |
| **Enterprise** | Audit logging, rate limits, separation of duties |

Users access only social accounts they are authorized for. Company data stays isolated. The system aligns with U.S. SaaS practices and major platform policies and scales for enterprise use.
