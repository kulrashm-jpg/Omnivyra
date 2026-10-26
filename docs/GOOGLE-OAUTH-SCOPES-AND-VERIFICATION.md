# Google OAuth: scopes per product, the saved Super Admin setting, and verification

For: the Omnivyra owner / operator who manages the Google OAuth client.
Status: code change local on `integration/bing-gsc-ga`; no production setting has been changed.

## 1. What each connect flow requests (code)

`scopesForCapability()` (backend/services/analyticsIntegrationServiceProviders.ts) builds the scope list
for ONE flow from the saved Super Admin list (or the built-in default):

| Flow | Requested scopes |
|---|---|
| Connect Search Console | the saved list **minus** every `…/auth/analytics…` scope, **plus** `https://www.googleapis.com/auth/webmasters.readonly` |
| Connect Google Analytics | the saved list **minus** every `…/auth/webmasters…` / `…/auth/searchconsole…` scope, **plus** `https://www.googleapis.com/auth/analytics.readonly` |

Sign-in scopes in the saved list (`openid`, `email`, `profile`) are kept for both flows.
Tests: `backend/tests/unit/googleSyncRepair.test.ts` ("OAuth scopes") and
`backend/tests/unit/googleConnectFlowScopes.test.ts` (the generated authorisation URLs).

**Existing connections stay valid.** GA4 and Search Console are separate integration rows
(`analytics_integrations.provider = 'GA4' | 'GSC'`), each with its own token. A token that was granted
both scopes keeps working; it simply holds one more scope than its product needs. The connect request
still sends `include_granted_scopes=true`, so Google may return previously granted scopes on a new token;
that is Google's incremental-authorisation behaviour and needs no action.

## 2. The saved Super Admin setting

Where: Super Admin → Analytics provider configuration → Google (row `google_analytics` in
`analytics_provider_config`, column `scopes`).

Current state (as reported; not read by this change): includes both
`https://www.googleapis.com/auth/analytics.readonly` and `https://www.googleapis.com/auth/webmasters.readonly`.

Intended final state: sign-in scopes only —

```
openid
email
profile
```

Each flow then adds its own product scope (section 1). Leaving both product scopes in the saved list is
harmless with this code (each flow strips the other product's scope); removing them makes the saved
setting say what is actually requested.

Manual change procedure (needs separate authorisation; production configuration):
1. Deploy the code in section 1 first. Without it, removing a product scope from the saved list would
   stop that flow from requesting it.
2. Super Admin → Analytics provider configuration → Google → Scopes: set to `openid`, `email`,
   `profile`. Save (step-up authentication is required).
3. Verify: start "Connect Search Console" on a test company and check the Google consent screen lists
   only Search Console access (plus name/email). Repeat for "Connect Google Analytics".
4. Rollback: restore the previous list in the same field.

## 3. Google Cloud: publishing status and verification (owner checks)

This repository holds no evidence of the app's Google Cloud state. Do not assume it is verified.

Where to look (Google Cloud console, the project that owns the OAuth client saved in Super Admin):
- **Google Auth Platform → Audience** (`https://console.cloud.google.com/auth/audience`):
  user type (Internal / External) and publishing status (Testing / In production).
- **Google Auth Platform → Data access**: the scopes registered for the app; Google marks sensitive
  scopes with a *sensitive* indicator there.
- **Google Auth Platform → Branding**: app name, logo, home page, privacy policy, authorised domains.
- **Verification Center** (in Google Auth Platform): whether verification is required, submitted or complete.

What the states mean (Google Cloud documentation, read 26 Oct 2026):
- **Testing**: only up to 100 listed test users can authorise. For an External app,
  *"Authorizations by a test user will expire seven days from the time of consent"*, including the
  refresh token (unless only name/email/profile scopes are requested). Symptom here: connections that
  fail every week with `invalid_grant` → shown as "reconnect required".
- **In production** without verification while requesting sensitive scopes: users see an
  "unverified app" warning, and user caps apply until verification completes.

Evidence to capture (screenshots, no secrets): the Audience page (user type + publishing status), the
Data access page (scopes and their sensitive indicators), and the Verification Center status.
Decision for the owner: whether to publish the app to production and submit it for verification for
`analytics.readonly` and `webmasters.readonly`.

## 4. What changed for availability (for reference)

| State | Meaning | Source |
|---|---|---|
| Provider configured | the platform OAuth client is saved and enabled | Super Admin (`isGooglePlatformOauthConfigured`) |
| Tenant connected | this company's integration is connected, not revoked, with an active property | `analytics_integrations`, `analytics_properties` |
| Data available | this company has a completed import | `ingestion_runs` |
| Data fresh | the latest completed import is ≤ 3 days (GA4) / ≤ 5 days (Search Console) old | `ingestion_runs` |

Platform-wide views (provider activation matrix) report only "provider configured". Company-facing
decisions and the per-company provider health use all four. Environment variables such as
`GSC_OAUTH_CLIENT_ID` or `GA4_OAUTH` are not read by the OAuth flow and are no longer treated as
evidence of anything.
