# Legacy Routing Deletion Audit

Date: 2026-04-28

## Purpose

This audit classifies old-looking pages and routes into safe cleanup buckets so we can remove legacy residue without breaking the current Omnivyra flow.

Buckets:
- `Delete now`: safe to remove with high confidence.
- `Replace then delete`: not a real destination anymore, but still has live callers.
- `Keep and refactor`: still part of the current route graph or auth flow.

## Executive Summary

The app still has real dependencies on `/dashboard`, `/welcome`, `/home`, and `/auth/callback`.

The safest immediate delete candidate is:

The best next cleanup targets are redirect shims and alias pages:
- `pages/content-calendar.tsx`
- `pages/calendar-view.tsx`
- `pages/signup.tsx`

Those should not be deleted first. Their callers should be migrated first, then the pages can be removed safely.

## Delete Now


Status:
- `Delete now`, pending one final sanity check for external callers.

Why:
- The file is explicitly marked deprecated and only returns `410 Gone`.
- It no longer participates in the Supabase auth flow.

Evidence:
- No active internal route flow uses it.
- Remaining references are only comments, such as:
  - [pages/api/auth/check-user.ts](/c:/virality/pages/api/auth/check-user.ts:46)

Recommended action:
2. Delete the endpoint.
3. Monitor for any external client breakage if older clients still call it.

Confidence:
- High

## Replace Then Delete

### 2. `pages/content-calendar.tsx`

Status:
- `Replace then delete`

Why:
- This is only a redirect shim to `/dashboard`.
- It is not a real feature page.

Evidence:
- [pages/content-calendar.tsx](/c:/virality/pages/content-calendar.tsx:1)
- Still called from [components/dashboard/DashboardCalendarTab.tsx](/c:/virality/components/dashboard/DashboardCalendarTab.tsx:162)

Recommended action:
1. Replace callers with the true destination.
2. Decide whether the real destination should be `/dashboard?tab=calendar` or a newer calendar route.
3. Delete `pages/content-calendar.tsx` after callers are updated.

Confidence:
- High

### 3. `pages/calendar-view.tsx`

Status:
- `Replace then delete`

Why:
- This is also just a redirect shim to `/dashboard`.
- It has no product logic of its own.

Evidence:
- [pages/calendar-view.tsx](/c:/virality/pages/calendar-view.tsx:1)

Recommended action:
1. Search for inbound links outside this audit scope if needed.
2. Replace any remaining caller with the real calendar destination.
3. Delete `pages/calendar-view.tsx`.

Confidence:
- High

### 4. `pages/signup.tsx`

Status:
- `Replace then delete`

Why:
- This page looks like an older lightweight signup alias.
- The richer current account creation flow is in `pages/create-account.tsx`.

Evidence:
- [pages/signup.tsx](/c:/virality/pages/signup.tsx:1)
- Still linked from:
  - [components/growth/SharedPageCTA.tsx](/c:/virality/components/growth/SharedPageCTA.tsx:54)
  - [components/growth/InviteFriends.tsx](/c:/virality/components/growth/InviteFriends.tsx:40)
- Still treated as a public auth route in:
  - [pages/_app.tsx](/c:/virality/pages/_app.tsx:163)
  - [pages/_app.tsx](/c:/virality/pages/_app.tsx:218)
  - [components/CompanyContext.tsx](/c:/virality/components/CompanyContext.tsx:371)

Recommended action:
1. Move all `/signup` callers to `/create-account`.
2. Remove `/signup` from public-route special-casing once no callers remain.
3. Delete `pages/signup.tsx`.

Confidence:
- Medium-high

## Keep And Refactor

### 5. `pages/auth/callback.tsx`

Status:
- `Keep and refactor`

Why:
- This is an active auth bootstrap page, not a legacy leftover.
- Login, signup confirmation, magic link, and OAuth land here.

Evidence:
- [pages/auth/callback.tsx](/c:/virality/pages/auth/callback.tsx:1)
- Calls:
  - `/api/auth/sync-supabase-user`
  - `/api/auth/verify-email`
  - `/api/auth/post-login-route`

Recommended action:
- Keep it.
- Refactor stale `/dashboard` assumptions only after auth route policy is finalized.

Confidence:
- Very high

### 6. `pages/dashboard.tsx`

Status:
- `Keep and refactor`

Why:
- `/dashboard` is still a real, live route.
- It is not just a compatibility alias today.

Evidence:
- [pages/dashboard.tsx](/c:/virality/pages/dashboard.tsx:1)
- Backed by [components/DashboardPage.tsx](/c:/virality/components/DashboardPage.tsx:1)
- Referenced across navigation, onboarding, admin blog pages, analytics links, and intelligence links.

Recommended action:
- Keep it for now.
- If product wants `/command-center` to become the single canonical home, do that as a migration project rather than deleting `/dashboard` outright.

Confidence:
- Very high

### 7. `pages/welcome.tsx`

Status:
- `Keep and refactor`

Why:
- This still participates in first-login and company-join onboarding flow.

Evidence:
- [pages/welcome.tsx](/c:/virality/pages/welcome.tsx:1)
- Routed from:
  - [pages/api/auth/verify-email.ts](/c:/virality/pages/api/auth/verify-email.ts:172)
  - [pages/onboarding/company.tsx](/c:/virality/pages/onboarding/company.tsx:247)
  - [pages/onboarding/company.tsx](/c:/virality/pages/onboarding/company.tsx:253)

Recommended action:
- Keep it.
- Later decide whether the welcome step is still desired product behavior or whether users should go straight into their chosen workspace.

Confidence:
- Very high

### 8. `pages/home.tsx`

Status:
- `Keep and refactor`

Why:
- This is part of the current pinned-home flow.
- It may feel old, but it is still intentionally used.

Evidence:
- [pages/home.tsx](/c:/virality/pages/home.tsx:1)
- Reached from:
  - [pages/login.tsx](/c:/virality/pages/login.tsx:127)
  - [pages/index.tsx](/c:/virality/pages/index.tsx:45)
  - [pages/auth/callback.tsx](/c:/virality/pages/auth/callback.tsx:157)
- Navigation config also treats `/dashboard`, `/home`, and `/command-center` as related workspace roots:
  - [components/layout/navigationConfig.tsx](/c:/virality/components/layout/navigationConfig.tsx:46)
  - [components/layout/navigationConfig.tsx](/c:/virality/components/layout/navigationConfig.tsx:206)

Recommended action:
- Keep it until the product decides whether pinned-home remains a supported concept.

Confidence:
- High

### 9. Auth And Onboarding APIs With Stale Route Defaults

Status:
- `Keep and refactor`

Why:
- These APIs are current, but they still encode older landing-route assumptions.

Evidence:
- [pages/api/auth/post-login-route.ts](/c:/virality/pages/api/auth/post-login-route.ts:124)
- [pages/api/auth/verify-email.ts](/c:/virality/pages/api/auth/verify-email.ts:172)
- [pages/api/auth/set-password.ts](/c:/virality/pages/api/auth/set-password.ts:105)
- [pages/api/auth/set-password.ts](/c:/virality/pages/api/auth/set-password.ts:122)
- [pages/api/onboarding/profile.ts](/c:/virality/pages/api/onboarding/profile.ts:70)

Recommended action:
1. Define the canonical landing policy:
   - `/dashboard`
   - `/command-center`
   - `/home` when pinned
2. Normalize these APIs to that policy.
3. Only then consider removing alias pages.

Confidence:
- Very high

## Suggested Cleanup Order

### Phase 1: Safe Routing Cleanup

1. Replace `/signup` callers with `/create-account`.
2. Replace `/content-calendar` and `/calendar-view` callers with the real destination.
3. Remove public-route exceptions that exist only for deleted aliases.

### Phase 2: Auth Routing Normalization

1. Standardize `verify-email`, `set-password`, `post-login-route`, and onboarding profile routing.
2. Reduce stale hardcoded `/dashboard` fallbacks where a more current route policy should apply.

### Phase 3: Delete Legacy Artifacts

1. Delete `pages/signup.tsx`
2. Delete `pages/content-calendar.tsx`
3. Delete `pages/calendar-view.tsx`

## Not Safe To Delete In This Audit

These may look old but are still active:
- `pages/auth/callback.tsx`
- `pages/dashboard.tsx`
- `components/DashboardPage.tsx`
- `pages/welcome.tsx`
- `pages/home.tsx`
- `pages/login.tsx`
- `pages/create-account.tsx`
- `pages/index.tsx`

## Recommendation


The highest-value next implementation is:
1. migrate callers off `/signup`
2. migrate callers off `/content-calendar` and `/calendar-view`
3. normalize auth landing routes
4. then delete the now-unreachable files
