# Integration Experience (ONBOARD-006)

ONE canonical Integration Experience: a user always sees what integrations
exist, what is connected, what is missing, what is recommended, what depends on
what, and what to connect next. It is a **presentation + composition layer** —
it reuses every existing authority and computes nothing. No new endpoint, API,
or OAuth; no database change.

## One status + dependency + readiness authority

The Integration Experience is built **purely from the onboarding journey**
(`onboardingJourneyService`, surfaced by the existing `GET /api/onboarding/journey`
and the `useOnboardingJourney` hook). That journey is the single authority for:

- **status** — each integration's status is *relabelled* from the journey stage
  status / social provider state into the canonical vocabulary (never inferred);
- **dependencies** — depends-on / unlocks / blocked-by come from the journey
  stage's `dependencies` + `guidance` (the one dependency authority);
- **Platform Ready** — read from `journey.platformReady`; the experience never
  recomputes readiness.

`lib/integrations/integrationExperience.ts` (`buildIntegrationExperience(journey)`)
is a **pure, deterministic** function — no IO, no mutation, resume/refresh safe.

## Canonical Integration model & cards (§1)

`components/onboarding/IntegrationCard.tsx` is the ONE reusable card. Each card
shows: **name, category, status, required/optional, why it matters,
dependencies (depends-on / unlocks / blocked-by), estimated setup time**, and
the **connect / reconnect / disconnect / learn-more** actions — all routing to
**existing** setup surfaces (`/website-setup`, `/social-platforms`,
`/integrations?focus=data`, `/integrations`). No new OAuth flow is introduced.

## Categories (§2)

The single taxonomy (`IntegrationCategory`, `CATEGORY_ORDER`): **CMS · Analytics
· Search · Social · Advertising · CRM · Communication · Website · Other**. There
was no pre-existing category taxonomy to reuse, so this catalog establishes the
one canonical categorization (no duplication).

## Status model (§3)

Canonical statuses: **Connected · Detected · Available · Pending · Blocked ·
Skipped · Disconnected · Error · Expired**. They are relabelled from the
authority, never inferred:

| Source (authority) | → Canonical |
| --- | --- |
| stage `completed` | Connected |
| stage `in_progress` | Pending |
| stage `pending` / `not_started` | Available |
| stage `blocked` | Blocked |
| stage `skipped` / `dismissed` | Skipped |
| social provider `connected` | Connected |
| social provider `detected` | Detected |
| social provider `expired` / `reconnect_required` | Expired |
| social provider `failed` | Error |
| catalog-only (no signal) | Available |

## Dependency model (§4)

Each integration mapped to a journey stage inherits that stage's dependency data:
`dependsOn` (dependency titles), `unlocks` (stage guidance), and `blockedBy`
(unmet dependency titles). This is the **same** dependency graph the onboarding
journey derives (GA4/GSC depend on Website / CMS, etc.) — no second dependency
engine.

## Provider information (§6)

Provider identifiers mirror the existing authorities — cms/registry provider
types (WordPress, Shopify, Ghost, Drupal, Joomla, Webflow, Wix, Squarespace,
Custom), analytics GA4/GSC, and the social platform keys the journey emits
(LinkedIn, Facebook, Instagram, X, YouTube, TikTok, Pinterest, Reddit). Social
per-platform status is read from the social stage's `providers[]`. Advertising /
CRM / Communication providers (Google Ads, Meta Ads, HubSpot, Mailchimp) are
catalog-only entries shown as **Available** and linking to the existing
integrations hub. Providers are never fabricated.

## Progressive experience (§5)

`buildIntegrationExperience` returns deterministic sections:

- **Next recommended** — follows the authority's `readiness.recommendations`
  ordering, one representative actionable integration per recommended stage
  (capped at 3).
- **Recently connected** — the connected integrations. (Connect timestamps are
  not tracked by the authority, so ordering is deterministic catalog order
  rather than true recency.)
- **Remaining** — actionable, not-yet-connected integrations (minus the
  recommended ones).
- **Platform benefits** — static, deterministic copy (no AI).
- Plus the full catalog grouped by category, and `platformReady` +
  `completionPercentage` read from the authority.

## Platform Ready (§7)

`experience.platformReady = journey.platformReady`, read only. The Integration
Experience never computes readiness; Platform Ready continues to consume the
canonical onboarding authority.

## Idempotency (§8)

The experience is derived from the server-derived journey and holds no client
state, so refresh, resume, and replay are identical. It performs no writes.

## Backward compatibility (§9)

- **No endpoint change** — consumes the existing `GET /api/onboarding/journey`.
- **No API change / No OAuth change** — connect/reconnect/disconnect link to the
  existing setup surfaces; no new flow.
- **No database change.**
- The one server-side touch is additive: the `website_cms` stage now also
  exposes the connected CMS platform in `providers[]` (previously only in the
  detail string) — no contract removal; all existing onboarding tests pass.

## Files

- `lib/integrations/integrationCatalog.ts` — the canonical catalog (categories +
  provider metadata + links to the authority).
- `lib/integrations/integrationExperience.ts` — the pure composition read-model.
- `components/onboarding/IntegrationCard.tsx` — the reusable card.
- `pages/onboarding/integrations.tsx` — the Integration Experience view.
- `backend/services/onboardingJourneyService.ts` — additive `website_cms`
  connected-provider exposure.

## Tests

- `backend/tests/unit/onboard006IntegrationExperience.test.ts` — status
  relabelling (incl. social detected/expired, catalog-only Available, null
  journey), dependency surfacing, category ordering, provider reuse, recommended
  ordering, connected/remaining split, Platform Ready pass-through, deterministic
  resume/refresh, purity (no journey mutation).
- `backend/tests/unit/onboard006IntegrationCard.test.tsx` — the card renders the
  read-model fields and the connect/reconnect/disconnect/learn-more actions by
  status.
