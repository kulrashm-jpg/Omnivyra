# Onboarding State Consolidation (ONBOARD-003)

Establishes **one** canonical onboarding state authority — `onboardingJourneyService`
(server) exposed through `/api/onboarding/journey` and the single client hook
`useOnboardingJourney`. Every live onboarding surface consumes it; the duplicate
onboarding progress models and orphaned onboarding UI are removed. Consumer
consolidation only — no endpoint, API, or lifecycle changes.

## Canonical onboarding authority

- **Server:** `backend/services/onboardingJourneyService.ts` — the single derivation
  of stages, statuses, `currentStep`, `platformReady`, and `readiness`. Nothing else
  computes onboarding state.
- **API:** `GET/POST /api/onboarding/journey` — unchanged.
- **Client:** `hooks/useOnboardingJourney.ts` (ONBOARD-002) — the one hook every
  onboarding surface uses. It reads the server truth and computes nothing.

## State model

The state is **server-derived** and exposes exactly one status vocabulary:
`not_started · pending · in_progress · completed · skipped · dismissed · blocked`
(plus "required" for mandatory stages). No surface uses an alternative vocabulary.

## Resume model

Resume always derives from `onboardingJourneyService` — there is no client
reconstruction and no persisted client progress. Post-login routing
(`/api/auth/post-login-route`) consumes `buildOnboardingJourney` and sends incomplete
users to `/onboarding/journey`; the journey/card/resume-link all re-fetch the
server truth on mount, so refresh/relogin resume identically.

## Consumer architecture

The live onboarding surfaces — the journey page, the dashboard onboarding card, and
the global resume link — all consume the canonical hook/API. Persistence is only
through the journey (`company_setup_progress.journey_state` via the existing POST
action); there is **no localStorage onboarding progress**.

## What was removed (the duplicate models / orphaned UI)

All five were orphaned (no live mount) and duplicated the canonical journey:

| Removed | Was | Why safe |
| --- | --- | --- |
| `hooks/useOnboarding.ts` | localStorage 3-step onboarding model | only the orphaned wizard/bar imported it |
| `components/onboarding/OnboardingWizard.tsx` | duplicate 3-step wizard | zero consumers |
| `components/onboarding/ProgressBar.tsx` | that wizard's progress bar | only the wizard imported it |
| `components/SetupProgress.tsx` | orphaned onboarding checklist | only `ContextualSetupPrompt` imported it |
| `components/ContextualSetupPrompt.tsx` | orphaned onboarding nudge | zero consumers |

Parity was confirmed first: the only live onboarding UI is journey-backed
(ONBOARD-002), so these carried no live behavior to preserve.

## What was intentionally kept (scope boundary)

- `hooks/useSetupProgress.ts` (+ `config/setupRegistry.ts`, `lib/setup/*`) is **not**
  an onboarding authority — it is a broader **workspace / feature-completion** model
  consumed by the assistant (`hooks/useAssistant.ts`) and next-action prompts
  (`hooks/useNextActionPrompt.ts`), which are not onboarding UI. No live onboarding
  surface consumes it. Removing/migrating those assistant consumers would be a
  redesign beyond onboarding scope (and a regression risk), so they are left as-is.
- `backend/services/activationReadinessService.ts` is a lower-level readiness check
  that the canonical journey itself **consumes** (`buildActivationReadiness`) — it is a
  dependency of the authority, not a competing onboarding UI model, so it is untouched.

## Backward compatibility

No endpoint, API, or onboarding-lifecycle changes. Only orphaned code was deleted and
no live import was broken (typecheck + all onboarding/assistant suites green). Every
preserved auth/journey behavior is unchanged.

## Files

- Removed: `hooks/useOnboarding.ts`, `components/onboarding/OnboardingWizard.tsx`,
  `components/onboarding/ProgressBar.tsx`, `components/SetupProgress.tsx`,
  `components/ContextualSetupPrompt.tsx`.
- Test: `backend/tests/unit/onboard003Consolidation.test.ts` — guards duplicate
  removal, single-authority consumption, server-derived resume, no-localStorage, one
  vocabulary.
