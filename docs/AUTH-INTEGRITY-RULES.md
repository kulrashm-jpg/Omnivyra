# Auth Integrity Rules

This document captures the containment rules for email verification, logout,
onboarding, and user-scoped persistence.

## Why These Rules Exist

The auth verification flow previously allowed a stale browser identity to become
active while a different newly registered user was completing email
verification. The dangerous failure chain was simple: the callback could enter
without a usable verification token, restore an existing Supabase session from
browser persistence, and continue into onboarding or workspace routing as the
wrong user.

That is an auth integrity incident, not a cosmetic routing issue. A stale user
session can leak profile data, attach onboarding progress to the wrong account,
reuse a previous organization selection, or make a new user appear inside an
existing user's workspace. The callback must therefore prove that the active
identity came from the verification input itself, and must fail closed whenever
that proof is absent.

Global organization persistence created a second contamination path. Keys such
as `selected_company_id` and `company_id` are not identities by themselves, but
when restored before the current authenticated user is known they can point a
fresh session at another user's company context. Organization selection must be
scoped to the authenticated principal or cleared on identity change.

Hydration timing made the issue easier to trigger. Server-side routing,
Supabase client restoration, `onAuthStateChange`, onboarding draft loading, and
CompanyContext hydration can all fire while verification is still in progress.
During `/auth/*` and `/create-account`, normal session restoration must not win
over the verification flow.

Fail-closed behavior is mandatory because every permissive fallback in this
area has the same worst case: the browser already has some other valid identity
and the app accidentally accepts it. Missing, expired, reused, malformed, or
failed verification input must leave the browser unauthenticated.

## Callback Model

`/auth/callback` is fail-closed. It may authenticate only from a verification
input supplied by Supabase:

- a PKCE `code`
- an implicit-flow hash containing `access_token` and `refresh_token`

The callback must not call `auth.getSession()` as a fallback and must not trust
an existing browser session. Missing, expired, reused, or failed verification
inputs must redirect to `/login?error=verification_invalid_or_expired` after
clearing browser and server auth state.

## Storage Isolation

Company and organization identity persistence must be scoped to the authenticated
principal. Do not read or write global `selected_company_id` or `company_id`
keys from feature modules.

Allowed patterns:

- use `CompanyContext` as the source of truth for selected company
- use `getUserScopedLocalStorage` / `setUserScopedLocalStorage`
- use route parameters when a company was explicitly provided for that route
- keep short-lived, non-identity transfer payloads in `sessionStorage`

Prohibited patterns:

- `localStorage.getItem('selected_company_id')`
- `localStorage.getItem('company_id')`
- `localStorage.setItem('selected_company_id', ...)`
- `localStorage.setItem('company_id', ...)`
- restoring organization context before the current auth identity is known

## Logout Guarantees

Logout must clear both identity authorities:

- backend `/api/auth/logout` revokes and clears `omnivyra_session`
- Supabase `auth.signOut()` clears the provider session
- `clearBrowserAuthState()` removes Supabase cookies/storage and auth-scoped app
  persistence

A logged-out refresh must not restore a Supabase identity, an
`omnivyra_session`, or a selected organization.

## Onboarding Isolation

Signup and verification must begin from a clean auth context. `/create-account`
clears any existing session before user input is accepted. Onboarding drafts are
stored under user-scoped keys and are removed during auth cleanup.

## Bootstrap Guardrails

Normal session restoration probes are skipped while an auth bootstrap route is
active. In particular, `/auth/*` and `/create-account` must not run the normal
`INITIAL_SESSION -> post-login-route` probe while verification is still syncing
the user row.

## CI And Invariant Enforcement

The permanent protection lock is:

- `npm run check:auth-integrity-invariants`
- `npm run test:auth-integrity`
- `.github/workflows/auth-integrity.yml`

The invariant script blocks known unsafe patterns before browser tests run:

- `auth.getSession()` inside `/auth/callback`
- callback code that lacks explicit token exchange/session establishment
- callback code that lacks fail-closed invalid verification handling
- global `localStorage` reads/writes for `selected_company_id` or `company_id`
  outside the approved storage utility and regression harness

The browser regression suite requires these deterministic environment variables:

- `AUTH_E2E_BASE_URL`
- `AUTH_E2E_TIMEOUT_MS`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SESSION_COOKIE_SECRET`

Failed auth-integrity CI runs upload `auth-integrity-server.log` and
`test-results/auth-integrity/**` so future failures include browser screenshots,
storage snapshots, cookies, route state, and server startup output.
