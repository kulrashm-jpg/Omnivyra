# OmniVyra Social Connection — Final Governance Rules

**Document:** Enforceable implementation rules; single source of truth for engineering, product, support  
**Product:** OmniVyra  
**Status:** Locked for production  
**Authority:** Final product governance  
**Based on:** `OMNIVYRA-SOCIAL-CONNECTION-PRODUCT-STRATEGY.md`

---

## Phase 1 — Final Product Experience

### OmniVyra must behave exactly as follows.

**User journey:**

1. **User lands on Connect Accounts**  
   - Path: Community AI → Connect Accounts (or equivalent single entry point).  
   - Company selector visible if user belongs to multiple companies.  
   - Page shows a list of platforms (LinkedIn, Facebook, Instagram, Twitter, YouTube, Reddit, etc.) with status: Connected / Not connected, and expiry when available.  
   - No credential fields. No Client ID, Secret, API URL, or token env input.

2. **User clicks "Connect LinkedIn"** (or any platform)  
   - Redirect to platform OAuth.  
   - User authorizes on LinkedIn (or platform).  
   - Redirect back to OmniVyra Connect page.  
   - Account shows as Connected. No manual steps.

3. **User views connected accounts**  
   - User sees only accounts for the selected company.  
   - Non-admin: sees only connections they created.  
   - Company Admin: sees all company connections.  
   - No cross-company visibility.

4. **User disconnects**  
   - If user connected the account: Disconnect works.  
   - If another user connected it: Only Company Admin can disconnect.

5. **User publishes content**  
   - OmniVyra uses connected accounts for the user's company automatically.  
   - User does not select tokens or credentials.  
   - Publishing/engagement scoped to selected company.

---

## Phase 2 — Enforceable Implementation Rules

### Rule G1 — User Experience (Minimal Friction)

| ID | Rule | Enforcement |
|----|------|-------------|
| G1.1 | Connect flow MUST be one click: Connect button → OAuth redirect → return → done. | No intermediate forms or credential input. |
| G1.2 | Connect page MUST NOT show Client ID, Client Secret, API base URL, or token env fields to any non–super-admin user. | UI conditional; API rejects credential input from users. |
| G1.3 | Connect page MUST show only platforms with valid OAuth config and enabled status. | Platform list from `platform_oauth_configs` or equivalent. |
| G1.4 | Error messages MUST be user-friendly; MUST NOT expose internal config, credentials, or stack details. | Standard error copy; no tech details to client. |
| G1.5 | Single entry point: Connect Accounts reachable from Community AI (or one documented path). | No scattered or duplicate connect UIs. |

### Rule G2 — Tenant Isolation (Strong Boundaries)

| ID | Rule | Enforcement |
|----|------|-------------|
| G2.1 | Every `social_accounts` read MUST filter by `company_id` from validated session/context. | No queries without company filter. |
| G2.2 | Every `social_accounts` write MUST set `company_id` from validated context (never from untrusted client alone). | Server resolves company; client cannot override. |
| G2.3 | Token resolution MUST use only rows where `social_accounts.company_id` matches the operation's company. | Publish/engagement filter by company_id. |
| G2.4 | Company Admin sees all company connections; non-admin sees only own connections. | Role-based filter on queries. |
| G2.5 | No cross-company visibility. User with multiple companies selects one; all data scoped to that company. | Company selector required; no union across companies. |

### Rule G3 — Credential Handling (Secure)

| ID | Rule | Enforcement |
|----|------|-------------|
| G3.1 | OAuth Client ID and Secret MUST never be sent to the client or logged. | Server-side only; no credential in responses or logs. |
| G3.2 | Credentials MUST be resolved from `platform_oauth_configs`, `external_api_sources`, or `.env` only. | No user-provided credentials. |
| G3.3 | Tokens MUST be stored encrypted at rest (tokenStore / AES-256-GCM). | No plaintext token storage. |
| G3.4 | Tokens MUST never be returned to the client. | Server-side use only. |

### Rule G4 — Authorization (Every Request)

| ID | Rule | Enforcement |
|----|------|-------------|
| G4.1 | Before OAuth start: validate `user_company_roles` (active) + role in MANAGE_CONNECTORS for `company_id`. | Block redirect if invalid. |
| G4.2 | Before OAuth callback: re-validate session and that `companyId` from state is valid for user. | Block save if invalid. |
| G4.3 | Connect page load: resolve `companyId` from session; return only data for that company. | 400/403 if no valid company. |
| G4.4 | Disconnect: allow only Company Admin OR (MANAGE_CONNECTORS + `user_id` = row owner). | Check before delete. |
| G4.5 | Publish/engagement: require PUBLISH_CONTENT or EXECUTE_ACTIONS; filter accounts by `company_id`. | Role + company check. |

### Rule G5 — U.S.-Standard SaaS Practices

| ID | Rule | Enforcement |
|----|------|-------------|
| G5.1 | OAuth scopes MUST be minimal (only what publish/engagement need). | Hardcoded or config per platform. |
| G5.2 | User consent MUST be obtained via platform OAuth (explicit authorize). | No bypass. |
| G5.3 | Disconnect MUST revoke/invalidate local tokens. | Implement revocation on disconnect. |
| G5.4 | Token refresh MUST run before expiry. | Scheduled refresh; no expired plaintext. |
| G5.5 | Audit log: `(user_id, company_id, platform, action)` for connect/disconnect. No tokens/logs. | Server-side logging. |

### Rule G6 — Simple Onboarding

| ID | Rule | Enforcement |
|----|------|-------------|
| G6.1 | New company: no OAuth setup required. OAuth configured globally by OmniVyra. | Single config per platform. |
| G6.2 | Company Admin or Content Publisher can connect first account immediately. | No approval step for connect. |
| G6.3 | Platform list shows only what is enabled and configured. | No "coming soon" or broken options. |
| G6.4 | If a platform is missing: support enables it; customer does not configure. | Documented support process. |

---

## Phase 3 — Enforcement Checklist (Per Release)

Before release, verify:

- [ ] **G1:** Connect is one click; no credential fields; single entry point.
- [ ] **G2:** All `social_accounts` queries filter by `company_id`; role-based visibility.
- [ ] **G3:** No credentials to client; tokens encrypted; never returned.
- [ ] **G4:** OAuth start/callback validate membership + role; disconnect enforces admin or owner.
- [ ] **G5:** Minimal scopes; consent; revocation; audit logging.
- [ ] **G6:** No per-company OAuth setup; platforms from config only.

---

## Phase 4 — Support & Product Reference

| Scenario | Expected Behavior | Reference |
|----------|-------------------|-----------|
| Customer asks "How do I connect LinkedIn?" | "Go to Community AI → Connect Accounts, click Connect LinkedIn, authorize on LinkedIn." | G1.1, G1.5 |
| Customer asks "Where do I enter Client ID?" | "You don't. OmniVyra is already configured. Contact support if a platform is missing." | G1.2, G6.4 |
| Customer sees another company's data | Bug. Escalate. | G2.1, G2.4, G2.5 |
| Customer cannot disconnect | "If you connected it, you can disconnect. If someone else did, only a Company Admin can." | G4.4 |
| Platform not on Connect page | "That platform may not be enabled yet. Contact support." | G1.3, G6.4 |

---

## Phase 5 — Governance Summary

| Priority | Governance Rule |
|----------|-----------------|
| Minimal friction | G1 (one click, no credentials, single entry) |
| U.S. SaaS practices | G5 (scopes, consent, revocation, audit) |
| Strong tenant isolation | G2 (company_id everywhere; no cross-company) |
| Secure credentials | G3 (no client exposure; encrypted tokens) |
| Simple onboarding | G6 (no per-company OAuth; config-driven platforms) |

**Product experience:** One click. No credentials. Strict boundaries.  
**Implementation lock:** All rules G1–G6 are mandatory. No exceptions without governance approval.

---

**End of Governance Rules**
