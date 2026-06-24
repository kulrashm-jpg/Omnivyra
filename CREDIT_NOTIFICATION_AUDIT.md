# CREDIT_NOTIFICATION_AUDIT.md

In-app + email notification infrastructure vs the target notification policy (80/90/95%
session-start warnings; 85%+projection email). Audit only; evidence with file references.

## In-app notification infrastructure
| Capability | Location |
|---|---|
| Notification center (bell, polls 60s) | `components/NotificationBell.tsx` → `pages/api/notifications.ts` (reads `notifications` table) |
| Credit alert writer (+ dedup) | `backend/services/creditAlertService.ts` — inserts `notifications`; dedup via `credit_alert_log`, **24h window** |
| Existing banners/widgets | `components/monetization/UsageLimitBanner.tsx`, `components/billing/BillingSummaryWidget.tsx`, `components/credit-advisor/CreditAdvisorBanner.tsx`, `components/Header.tsx`/`layout/GlobalHeader.tsx` CreditPill |
| Toast | `components/retention/RewardToast.tsx` |

**Existing thresholds:** only **`low_20pct` and `low_10pct`** (low-balance), plus `depleted`,
`auto_topup` (`creditAlertService.ts`). **No 80 / 90 / 95% consumption warnings exist.**
(Note the policy is phrased as *consumption %* — 80/90/95 consumed — vs the current *remaining %*
20/10; these are complementary, not the same.)

## Session-start initialization
- `components/CompanyContext.tsx` (`<CompanyProvider>` in `pages/_app.tsx`) exposes session-ready
  gates `authChecked` + `companiesResolved` (true once session validated + companies fetched).
- `components/layout/AppLayout.tsx` wraps all authenticated pages (alongside `RewardToast`) — the
  natural mount point for a once-per-session warning banner.

## Once-per-session + dedup (already proven patterns)
- **Once-per-session:** `components/assistant/DailyBrief.tsx` uses `sessionStorage`
  (`omnivyra_daily_brief_dismissed`) checked on mount — a working, reusable pattern.
- **Server dedup:** `creditAlertService.wasAlertRecentlySent()` via `credit_alert_log` (24h).

## Email infrastructure
- Path: `backend/services/emailService.ts` → Supabase Edge Function
  `supabase/functions/send-transactional-email/index.ts` → AWS SES.
- Existing types: `team_invite`, `company_referral`, `inbound_signup_notice`,
  `team_invite_credentials`, `domain_verification_reminder` (+ `activation_outreach` per recent
  work). **No `credit_alert` email type.**
- Adding one is a known, small pattern: new `Template` union member + `render()` case + add to
  `KNOWN_TYPES` allowlist + a client `sendCreditAlert…` wrapper.

## Answers
- **Where can 80/90/95% warnings be injected (in-app)?** Best: a new banner mounted in
  `AppLayout.tsx` (covers all auth pages), gated on `authChecked && companiesResolved` from
  `CompanyContext`; optionally also surfaced through `NotificationBell` (persisted via the
  `notifications` table written by `creditAlertService`).
- **Once per session?** **YES, supported** — reuse the `DailyBrief` `sessionStorage` pattern
  (new keys e.g. `omnivyra_credit_warn_80/90/95`). No new infra needed.
- **Duplicate suppression?** **YES** — server-side already (`credit_alert_log`, 24h); extend with
  `low_80pct/90pct/95pct` alert types. Client session-dedup via sessionStorage for the banner.
- **Email send path + what's needed?** Path above; needed = a `credit_alert` Edge Function
  template + client wrapper + a trigger in `creditAlertService` that fires **only** when
  `consumption ≥ 85%` **AND** `creditForecastService` says remaining is insufficient for projected
  near-term usage (the projection already exists — STEP 6).

## Policy alignment / gaps
| Policy | Status |
|---|---|
| Session-start 80/90/95 warnings, once per session, no mid-op interruption | **Infra present** (AppLayout, session gates, sessionStorage, notification center); **thresholds + banner missing** |
| Email only when ≥85% AND remaining insufficient for projected usage (not merely 80%) | **Projection present** (`creditForecastService`); **email type + conditional trigger missing**. Current alerts are remaining-%-based (20/10), not consumption-% + projection-gated |

Audit only — no notification sends, no code.
