# Onboarding Journey Wiring (ONBOARD-002)

Makes the canonical onboarding journey the **single visible onboarding experience**.
The backend authority already existed (`onboardingJourneyService` +
`/api/onboarding/journey`); ONBOARD-002 only **exposes it** — post-login routing,
a dashboard card, a global resume link, and the Platform Ready banner. No endpoint,
API, onboarding-state, or lifecycle changes.

## Canonical onboarding routing

`GET /api/auth/post-login-route` now consumes the server-derived journey authority.
After the preserved gates (unverified → `/login`, no-password → `/auth/set-password`,
SUPER_ADMIN → `/super-admin/dashboard`), it decides:

```
buildOnboardingJourney(userId)  ← the ONE authority (never recomputed on client or here)
  platformReady === true   → user-preferred workspace (/command-center | dashboard)
  platformReady === false  → /onboarding/journey   (resume exactly where they stopped)
```

`buildOnboardingJourney` works at any stage — before a profile or company exists — so
every incomplete state (verify / profile / company / integrations) **converges on the
one canonical journey** `/onboarding/journey`. If the journey build throws, routing
**fails open to the journey** (never traps the user). The endpoint contract is
unchanged (`{ route }`).

## Dashboard integration

`components/onboarding/DashboardOnboardingCard.tsx` is mounted at the top of the
dashboard (`DashboardPage.tsx`). While incomplete it shows a **persistent card** with:
progress (server `completionPercentage`), the current stage + its status, a blocked
note when later stages are waiting, the server-recommended **required actions** (each
linking to the stage's existing surface), a **Continue setup** button to the journey,
and a **dismiss** affordance **only when the current stage allows it** (which posts the
existing `dismiss` action). When the journey reaches Platform Ready it **replaces the
card with the completion banner** ("🎉 Platform Ready").

## Global resume

`components/onboarding/ResumeSetupLink.tsx` is mounted in the global header
(`GlobalHeaderMain`), so **any authenticated user whose onboarding is incomplete** gets
a "Resume setup" chip — on the dashboard, every app page, and the Command Center (which
shares the global header). It renders nothing once Platform Ready. Both the card and the
link consume the **single** `useOnboardingJourney` hook, so there is **no duplicated
resume logic** — one fetch shape, one destination (`CANONICAL_JOURNEY_HREF =
/onboarding/journey`).

## Status vocabulary

The card and journey page share **one** status vocabulary from the journey service:
`completed / in_progress / pending / not_started / skipped / dismissed / blocked`, plus
"Required" for mandatory stages. No new vocabulary is invented.

## Resume behavior

The journey is **derived, not stored on the client**, so browser refresh, new login,
and partial completion all resume identically — `useOnboardingJourney` re-fetches
`/api/onboarding/journey` on mount and renders the server truth. A test asserts a
re-mount (refresh) re-derives the identical card.

## Platform Ready authority

Platform Ready remains **100% server-derived** (`onboardingJourneyService`
`platformReady = mandatoryComplete && optionalResolved`). Nothing in this change
computes readiness on the client — the hook, card, banner, resume link, and post-login
route all **read** `journey.platformReady` / `journey.readiness.*`.

## Orphaned UI

The pre-existing orphaned components (`SetupProgress`, `OnboardingWizard`,
`ContextualSetupPrompt`) use different, non-journey progress models. Per scope they are
**not** rewritten or deleted here (duplicate cleanup is out of scope). The correct
component to reconnect — the canonical **journey page** — is now reachable via routing,
the dashboard card's Continue button, and the header resume link. The new card/link are
thin, journey-backed surfaces, not rewrites of the orphaned components.

## Files

- `pages/api/auth/post-login-route.ts` — routing consumes `buildOnboardingJourney`.
- `hooks/useOnboardingJourney.ts` — the single journey hook (`CANONICAL_JOURNEY_HREF`, `isOnboardingIncomplete`).
- `components/onboarding/DashboardOnboardingCard.tsx` — card + Platform Ready banner.
- `components/onboarding/ResumeSetupLink.tsx` — global resume chip.
- `components/DashboardPage.tsx` — mounts the card.
- `components/layout/GlobalHeaderMain.tsx` — mounts the resume link.

## Tests

- `backend/tests/unit/onboard002Routing.test.ts` — platformReady→workspace, not-ready→journey,
  no-company→journey, fail-open, SUPER_ADMIN/unverified/no-password gates preserved.
- `backend/tests/unit/onboard002Ui.test.tsx` — card (progress/current/actions/continue/blocked),
  completion banner, required-only, resume link (present/absent), resume-after-refresh parity.
