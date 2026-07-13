# Platform Activation Experience (ONBOARD-007)

After onboarding, Platform Activation is the natural transition into using the
platform: it explains what is already active, what capabilities are available,
what remains optional, and what additional value can still be unlocked. It is a
**pure read-model over existing authorities** — it computes no readiness and
introduces no second readiness model.

## One activation model (§1)

`lib/activation/platformActivation.ts` (`buildPlatformActivation(journey)`) is
the single Platform Activation authority. It is **pure and deterministic** and
composes only existing authorities:

- the **onboarding journey** (`useOnboardingJourney` / `onboardingJourneyService`)
  — the single readiness / Platform Ready authority;
- the **integration experience** (ONBOARD-006 `buildIntegrationExperience`,
  itself derived from the journey) — per-integration connection status.

It never queries anything itself, performs no writes, and reads `platformReady`
straight from the journey.

## Capability availability (§2)

`lib/activation/capabilityCatalog.ts` lists the major capabilities — Campaign
Planning, Content Writer, Content Creator, Publishing, Analytics, SEO,
Competitor Intelligence, Growth Intelligence, Recommendation Engine — each with
its prerequisite **signals**, expressed only as existing-authority references:

- a journey stage id (e.g. `company`) → stage completed;
- an integration catalog id (e.g. `google_analytics`, `website_cms`,
  `social_linkedin`) → that integration connected;
- the special `publish_channel` → any connected website or social channel.

Each capability resolves to one status, derived only from those signals:

| Status | Meaning |
| --- | --- |
| **Available** | all required signals met (and all enhancing signals met) |
| **Limited** | required signals met, but an *enhancing* signal is missing (works now, better with more) |
| **Requires setup** | a required signal is missing but actionable |
| **Unavailable** | a required signal is hard-blocked (its prerequisite isn't yet actionable) |
| **Recommended** | a not-yet-available capability whose missing signal is the authority's recommended next step |

Nothing is inferred: statuses are computed from the same integration/onboarding
signals the journey already derives. A capability is `Unavailable` (not merely
`Requires setup`) only when its prerequisite integration is itself `blocked` in
the integration experience (e.g. Analytics while GA4 is blocked behind Website).

## Activation Dashboard (§3)

`components/onboarding/ActivationDashboard.tsx` is the ONE reusable dashboard. It
renders: the **Platform Ready** banner (or progress), **capability availability**
(a card per capability), **recently unlocked** (operational capabilities),
**next recommended improvements** (following the authority's ordering, annotated
with the capabilities each unlocks), and **optional enhancements**. No AI.

## Unlock explanations (§4)

Every non-operational capability card shows **why** (the capability's purpose),
the **missing prerequisite(s)** (human labels reused from the integration /
journey metadata), and **what it unlocks** (deterministic copy). A `Set up`
action links to the existing surface that satisfies the first missing
prerequisite.

## Optional improvements (§5)

`optionalImprovements` surfaces non-blocking enhancements, deterministically:
connect more optional integrations (extra Social, CRM, Advertising,
Communication — not yet connected), improve the company profile, and upload
brand assets (when the optional review isn't complete). These are a **separate
list** — they are never capabilities and never block anything.

## Readiness authority (§6)

`activation.platformReady = journey.platformReady`, read only. Platform Activation
**never** calculates readiness; Platform Ready remains the sole readiness
authority (the onboarding journey).

## Idempotency (§7)

`buildPlatformActivation` is a pure function of the journey — no IO, no writes,
no mutation (a test asserts the journey is untouched). Refresh, resume, and
replay all yield the identical activation.

## Backward compatibility (§8)

No endpoint change (consumes the existing `GET /api/onboarding/journey` via the
hook), no API change, no onboarding change, no database change. Nothing in the
onboarding lifecycle is modified — this is additive UI + a client read-model.

## Files

- `lib/activation/capabilityCatalog.ts` — capabilities + prerequisite signals +
  deterministic unlock copy.
- `lib/activation/platformActivation.ts` — the pure activation read-model.
- `components/onboarding/ActivationDashboard.tsx` — the reusable dashboard.
- `pages/onboarding/activation.tsx` — the activation page.

## Tests

- `backend/tests/unit/onboard007PlatformActivation.test.ts` — capability
  availability across states (company-only, channel connected, GA4 connected,
  pre-company), unlock explanations, the Recommended overlay, optional
  improvements (non-blocking), dashboard sections, Platform Ready pass-through,
  purity, null-journey, determinism.
- `backend/tests/unit/onboard007ActivationDashboard.test.tsx` — the dashboard
  renders capability statuses, unlock explanations, the Platform Ready banner,
  next recommended, and optional enhancements.
