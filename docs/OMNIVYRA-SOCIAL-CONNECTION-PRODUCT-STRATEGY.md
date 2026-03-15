# OmniVyra Social Connection — Final Product Strategy

**Document:** Definitive product behavior for social platform connections in production  
**Product:** OmniVyra  
**Status:** Final product decision  
**Audience:** Product, engineering, support, customers

---

## Phase 1 — Final Product Rule

**The system must operate under this rule:**

> **A user connects social accounts with one click, never touches credentials, and sees only what their company and role allow.** The platform handles everything else.

In short: **One click. No credentials. Strict boundaries.**

---

## Phase 2 — How OmniVyra Behaves (Product Behavior)

### 2.1 For the Customer (End User)

| Scenario | Product behavior |
|----------|------------------|
| **Connecting a platform** | User selects their company (if they belong to more than one), clicks "Connect LinkedIn" (or Facebook, Instagram, etc.), is redirected to that platform to authorize, then returns to OmniVyra with the account connected. No forms. No Client ID or Secret. |
| **Viewing connected accounts** | User sees a list of platforms: status (Connected / Not connected), expiry when available, and a Connect or Reconnect button. They see only accounts for the company they have selected. |
| **Disconnecting** | User clicks Disconnect. If they connected the account, it disconnects. If someone else connected it, only a Company Admin can disconnect. |
| **Publishing** | User schedules or publishes content. OmniVyra uses connected accounts for the user's company. The user does not choose tokens or credentials. |
| **Multi-company** | If the user belongs to multiple companies, they select the company first. All Connect, View, and Publish actions are scoped to that company. No cross-company visibility. |

### 2.2 For the Company Admin

| Scenario | Product behavior |
|----------|------------------|
| **Managing connectors** | Admin sees all connected accounts for their company (regardless of who connected them). Can connect, disconnect, or reconnect any platform. |
| **Inviting users** | Admin assigns roles (Content Publisher, Content Reviewer, etc.). Only users with appropriate roles can connect accounts or publish. |
| **Company isolation** | Admin sees only their company's data. No access to other companies. |

### 2.3 For the Platform (System Admin / OmniVyra Operator)

| Scenario | Product behavior |
|----------|------------------|
| **Configuring OAuth** | System admin configures OAuth Client ID and Secret for each platform once (in admin settings or platform_oauth_configs). Customers never see or edit these. |
| **Platform availability** | Only platforms with valid OAuth configuration and enabled status appear on the Connect page. |
| **Support** | If a platform is missing, the customer contacts support. OmniVyra operators enable it; the customer does not configure credentials. |

---

## Phase 3 — Explicit Product Decisions

| Decision | Choice | Rationale |
|----------|---------|-----------|
| **Credential entry** | Users never enter credentials | Reduces friction; meets U.S. SaaS expectations; aligns with platform policies |
| **Connect entry point** | Single place: Community AI → Connect Accounts | One predictable location; no scattered config screens |
| **Company context** | Always required; from session/selector | Multi-tenant isolation; no ambiguous scope |
| **Visibility** | User sees own connections; Admin sees all company connections | Least privilege; admin control |
| **Token handling** | Server-side only; encrypted at rest | Security; platform compliance |
| **Platform list** | Dynamic from config; only enabled platforms | No dead options; simple UX |
| **Error handling** | User-friendly messages; no config details | Supportable; secure |

---

## Phase 4 — Out of Scope (What OmniVyra Does Not Do)

| Not in product | Reason |
|----------------|--------|
| Per-company OAuth apps | Operational complexity; single global config preferred |
| User-editable Client ID/Secret | Security; platform policy; friction |
| Cross-company account sharing | Tenant isolation; compliance |
| Token export or API key display | Security; platform terms |
| Custom platform addition by customer | Support model; controlled rollout |

---

## Phase 5 — Success Criteria (Product)

The product strategy succeeds when:

1. **Minimal effort:** A Content Publisher connects LinkedIn in under 60 seconds with one click.
2. **No credential exposure:** No customer ever enters OAuth credentials.
3. **Clear boundaries:** Each company sees only its own connected accounts; each user sees only what their role allows.
4. **Platform alignment:** OmniVyra complies with LinkedIn, Facebook, Twitter, YouTube, and Reddit developer policies.
5. **Operational simplicity:** One OAuth configuration per platform; no per-company credential setup.

---

## Phase 6 — One-Page Summary

**OmniVyra Social Connection in Production**

- **Users:** Click Connect → authorize on platform → done. No credentials.
- **Admins:** See all company connections; manage any. Company-isolated.
- **Operators:** Configure OAuth once per platform. No per-customer credential setup.
- **Rules:** Membership + role = access. Company-scoped. Encrypted tokens. Audit logging.

**Final product rule:** *One click. No credentials. Strict boundaries.*

---

**End of Product Strategy**
