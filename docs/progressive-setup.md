# Progressive Setup Experience (ONBOARD-005)

Turns onboarding into a **progressive setup experience**: after company
bootstrap, a user always knows what is complete, what is next, what is blocked,
what is optional, and how to reach Platform Ready. The experience stays 100%
**server-derived** — it is an additive UI + derivation layer over the ONE
canonical authority (`onboardingJourneyService`). No new flow, no new
completion authority, no endpoint or API change.

## One canonical setup flow (§1)

The single sequence lives in `JOURNEY_STAGES` (`onboardingJourneyService.ts`):

```
Email Verified → Profile → Company → Company Review → Social Accounts
  → Website / CMS → Google Analytics → Google Search Console → Platform Ready
```

There is no second flow. The progressive UI renders these stages; it never
invents or reorders them.

## Setup cards (§2)

`components/onboarding/SetupCard.tsx` is the **one reusable card**. It is
presentational and computes nothing — every value comes from the journey
authority via `useOnboardingJourney`. Each card shows:

- **title**, **status** badge, **Required/Optional**
- **why it matters** (`stage.why`)
- **guidance** — what completing it *unlocks* / what stays *blocked* (§4)
- **required action** (Continue / Set up → the stage's existing surface)
- **skip** and **dismiss** — only when the stage allows them
- **estimated completion** (`stage.estimatedMinutes`)
- **dependencies** (unmet ones listed as "Complete first: …")
- **providers** — connection/detection chips for integration stages

The progressive setup page (`pages/onboarding/journey.tsx`) groups the cards by
state — **Up next** (the server `currentStep`), **To do**, **Blocked**,
**Skipped** (reopenable), **Completed** — and shows a progress bar from the
authority's `completionPercentage`.

## Dependency model (§3)

Dependencies are declared once in the stage catalog (`dependsOn`) and resolved
by the authority's existing blocked-gate — **no duplicated dependency logic**.
ONBOARD-005 adds *integration sequencing*:

| Stage | Depends on |
| --- | --- |
| Company Review, Social, Website / CMS | Company |
| **Google Analytics** | **Website / CMS** |
| **Google Search Console** | **Website / CMS** |
| Platform Ready | every mandatory stage |

A stage whose dependency is unresolved is **blocked** (not actionable). Because
a *skip* resolves a stage, skipping Website unblocks GA4/GSC too — sequencing is
enforced without ever trapping the user. Each card receives its dependencies
resolved to human titles + a `met` flag (`stage.dependencies`).

## Setup guidance (§4)

Every stage carries deterministic, static copy (`STAGE_GUIDANCE`) — **no AI**:

- `guidance.unlocks` — what becomes available after completing the stage.
- `guidance.blockedWithout` — what stays blocked/unavailable until it's done.

Combined with the derived `blocked` status, an incomplete stage always explains
why it's needed, what it unlocks, and what remains blocked.

## CMS detection (§5)

The website crawl **deliberately does not fingerprint CMS**
(`websiteFingerprintService` returns `CMS: null // produced by the CMS layer,
not the crawl`). The only source of a CMS platform name is a **connected
`company_integrations` row**. So the Website / CMS card:

- shows the connected platform name when one exists — e.g. "WordPress connected"
  (`formatCmsPlatform` maps `wordpress`→WordPress, `shopify`→Shopify,
  `custom_blog_api`→Custom, …);
- otherwise shows generic website-integration copy.

No re-crawl, and a platform name is never fabricated.

## Social status (§6)

Two distinct sources, never conflated:

- **Connected** — a `social_accounts` row (mapped through the canonical 9-state
  `ConnectionState` → `connected / pending / expired / reconnect_required /
  failed`). Only a connected account satisfies the Social stage.
- **Detected** — a crawl-discovered URL on `company_profiles` (from the
  ONBOARD-004 bootstrap) with **no** connected account → provider state
  `detected`. It is surfaced ("Detected on your website: …") but never counts as
  connected and is never fabricated.

A platform that is connected is never also listed as detected.

## Platform Ready (§7)

Platform Ready remains the **single** completion decision from the authority
(`platformReady = all mandatory completed && all optional resolved`). The
progressive UI reads it; it never recomputes completion. Every card contributes
only through the authority's derived status.

## Idempotency (§8)

The journey is **derived, not stored on the client**, so refresh, relogin, and
partial completion resume identically. Stage actions (skip/dismiss/reopen) are
idempotent through the existing `company_setup_progress.journey_state` override
store — no duplicated writes. The added derivation is pure read.

## Backward compatibility (§9)

- No endpoint or API change — `GET/POST /api/onboarding/journey` is untouched;
  the new stage fields (`estimatedMinutes`, `dependencies`, `guidance`,
  `providers`, provider `detected`) are **additive** and flow through the
  existing GET.
- No onboarding-lifecycle change — the stage catalog, statuses, override rules,
  and Platform Ready decision are unchanged except the additive GA4/GSC→Website
  dependency (integration sequencing, §3).
- The original stage contract fields all remain.

## Files

- `backend/services/onboardingJourneyService.ts` — additive derivation:
  `estimatedMinutes`, resolved `dependencies`, `guidance` (`STAGE_GUIDANCE`),
  CMS platform name (`formatCmsPlatform` + connected-integration read), social
  `detected`, and GA4/GSC→Website sequencing.
- `components/onboarding/SetupCard.tsx` — the reusable setup card.
- `pages/onboarding/journey.tsx` — the progressive setup view (grouped cards +
  progress).
- `hooks/useOnboardingJourney.ts` — client types for the additive fields.

## Tests

- `backend/tests/unit/onboard005ProgressiveSetup.test.ts` — ordering, GA4/GSC→
  Website sequencing (blocked/unblock-on-skip + resolved deps), per-stage
  guidance/estimate/deps, CMS detection (connected-only, no fabrication), social
  connected-vs-detected (incl. no double-listing), Platform Ready, deterministic
  resume/refresh, backward-compatible fields.
- `backend/tests/unit/onboard005SetupCard.test.tsx` — the card renders exactly
  the server-derived fields and gates skip/dismiss/continue by status.
