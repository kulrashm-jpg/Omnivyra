# BOLT Platform Picker — Manual QA Smoke-Test Checklist

Operational verification checklist for the capability-aware platform picker
across all four BOLT modes. **Not** a substitute for the automated unit /
centralization tests under `backend/tests/unit/` — those cover the contract.
This document covers visual + interaction behavior that no unit test reaches.

Run before every release that touches:
- `lib/shared/social/platformCapabilities.ts`
- `lib/shared/social/platformContentFilter.ts`
- `components/bolt/BoltPlatformPicker.tsx`
- `hooks/useBoltPlatformPicker.ts`
- `pages/api/bolt/available-platforms.ts`

## Prerequisites

1. A test company with the following connected social accounts:
   - LinkedIn ✅
   - X / Twitter ✅
   - Facebook ✅
   - Instagram ✅
   - TikTok ✅
   - YouTube ✅
   - (Optional, for unknown-platform check) a row in `social_accounts` whose
     `platform` value is NOT in `PLATFORM_CAPABILITY_REGISTRY` — e.g.
     `'mystery-net'`. Insert manually via DB only if you want to exercise
     fail-closed rendering.
2. Browser DevTools console open — capability log events appear there.

## A. BOLT (Text) — `/command-center/bolt-text`

| # | Check | Expected |
|---|---|---|
| A1 | "PLATFORMS" chip row appears below "CONTENT SHARING" | ✓ |
| A2 | Supported chips (enabled, amber accent on selection) | LinkedIn, X, Facebook |
| A3 | Disabled chips with tooltip on hover | Instagram, TikTok, YouTube, Pinterest |
| A4 | Instagram tooltip text | "Instagram requires media (image or video) for publishing." |
| A5 | Clicking a disabled chip does nothing (no toggle, no console error) | ✓ |
| A6 | DevTools console contains a `platform.capability.filtered` event with `surface: "bolt:bolt-text"` | ✓ |
| A7 | Unknown platform (if seeded) does NOT appear as either enabled OR disabled chip | ✓ |
| A8 | Deselect all supported chips → "Select at least one platform" warning surfaces | ✓ |

## B. BOLT (Creator) — `/command-center/bolt-creator-strategy`

| # | Check | Expected |
|---|---|---|
| B1 | "PLATFORMS" chip row appears below "CONTENT SHARING" | ✓ |
| B2 | Supported chips (enabled, indigo accent) | Instagram, TikTok, YouTube |
| B3 | Disabled chips with tooltip | LinkedIn, X, Facebook |
| B4 | LinkedIn tooltip text | "linkedin does not support creator content." (or platform-specific note) |
| B5 | DevTools console event: `surface: "bolt:bolt-creator"`, `resolvedCapability: "creator"` | ✓ |
| B6 | Unknown platform absent from render | ✓ |

## C. Intelligent Mix — `/command-center/intelligent-mix-strategy`

| # | Check | Expected |
|---|---|---|
| C1 | "PLATFORMS" chip row appears below the start-date section | ✓ |
| C2 | ALL registry-known connected platforms enabled (no disabled chips) | LinkedIn, X, Facebook, Instagram, TikTok, YouTube |
| C3 | Accent color | teal |
| C4 | DevTools console: `surface: "bolt:intelligent-mix"`, `resolvedCapability: null` (union mode), `blocked: false` | ✓ |
| C5 | Unknown platform absent from render | ✓ |
| C6 | NO blocking-state message appears (this is the legitimate `capability: null` path) | ✓ |

## D. Strategy Mix — `/command-center/bolt-combined-strategy`

| # | Check | Expected |
|---|---|---|
| D1 | "PLATFORMS" chip row appears between Content Sharing and Campaign Start Date | ✓ |
| D2 | ALL registry-known connected platforms enabled | same set as C2 |
| D3 | Accent color | violet |
| D4 | DevTools console: `surface: "bolt:strategy-mix"`, `resolvedCapability: null` | ✓ |
| D5 | NO blocking-state message | ✓ |

## E. Cross-Mode Consistency

| # | Check | Expected |
|---|---|---|
| E1 | Switching from `/bolt-text` → `/bolt-creator-strategy` shows DIFFERENT enabled/disabled chip sets | ✓ |
| E2 | Same platform appears with same label across all modes (no "X" vs "Twitter" mismatch) | ✓ |
| E3 | Disconnecting a social account and reloading any mode → the chip disappears entirely (not disabled) | ✓ |
| E4 | All four modes emit `platform.capability.filtered` exactly once on initial load | ✓ |

## F. Blocking State (synthetic)

Hard to trigger naturally — mode resolution failure means the API returned
`capability: null` for a single-capability mode. To verify the blocking-state
UI:

1. Temporarily patch `pages/api/bolt/available-platforms.ts` to return
   `{ capability: null, supported: [], hidden: [], unregistered: [] }` for the
   `bolt-text` mode.
2. Reload `/command-center/bolt-text`.
3. **Expected:** "Unable to determine compatible publishing platforms for this
   BOLT mode." replaces the chip row.
4. Revert the patch.

## G. Server Validation (defense in depth)

| # | Check | Expected |
|---|---|---|
| G1 | Even if a user selects an incompatible platform by URL-hacking `selected_platforms`, the BOLT pipeline rejects/filters it | filtered via `filterConnectedPlatformsForContent` in `boltPipelineService` |
| G2 | Direct publish to an incompatible platform via `/api/social/publish` returns `400 { code: 'CAPABILITY_NOT_SUPPORTED' or 'MEDIA_REQUIRED' }` | covered by `publishNowService.capability.test.ts` |

---

**If any check fails, do NOT ship.** File a regression note and link to the
specific row.
