# Content limits: production source and canonical authority (D3)

Owner ruling, Checkpoint 1 item 8:
- Validation rules come only from evidence-backed platform/provider limits and verified existing constraints. Agent-proposed limits do not become mandatory rules.
- `platformAdaptationProfiles.ts` is the canonical social source once its production authority is verified. The competing sets are reconciled against evidence; no legacy definition is deleted without consumer analysis.

Status: implemented locally on `outreach/foundation-base-20261104` (step D3). Applies to the Outreach channel-content layer (`lib/outreach/channelContent`) only. No other module's values were changed.

## 1. Is `platformAdaptationProfiles.ts` on the production path?

**Yes, for style only. It defines no numeric character limit.**

Its only numeric field is `wordRange` (words). Every other number in it is prose inside prompt text, such as "280-char hard limit", "max 70 characters" and "500-char cap". None of that prose is checked anywhere.

Production imports (re-verified on the foundation tree, 2026-11-05):

| Consumer | Import | Use | Reached from | Effect |
|---|---|---|---|---|
| `backend/services/contentGeneration/platformVariantGenerator.ts:18` | `getPlatformProfile`, `listPlatformProfiles`, `listPlatformKeys` | `styleDirective` at :93, :137, :412 | `backend/queue/jobProcessors/contentGenerationProcessor.ts:39` (`renderPlatformVariantsFromBlueprint`), the content-generation queue | Prompt text only |
| `backend/services/content/runtime/generationRuntime.ts:73`, `promptAssembler.ts:39` | `getPlatformProfile`, type | Profile rendered into the prompt | Delegated runtimes behind `WRITER_RUNTIME_DELEGATION_ENABLED`, `TEXTGEN_RUNTIME_DELEGATION_ENABLED`, `CONTENTGEN_DAY_RUNTIME_DELEGATION_ENABLED` (default off) | Prompt text only |
| `backend/services/content/qualityEngine.ts:21` (`wordRange` :218) and `predictionEngine.ts:30` (:291) | `getPlatformProfile` | Word-range scoring | Quality and prediction scoring | Score only (advisory) |
| `lib/outreach/channelContent/socialAdapter.ts` | `getPlatformProfile` | Style, emoji policy and word range | Outreach content layer (no runtime consumer yet) | Advisory findings |

**Conclusion:**
- It is the verified production authority for platform **style**: tone, hooks, formatting guidance, and word ranges as advisory scoring.
- It cannot be the authority for hard character, hashtag or media limits, because it has none.
- Its prose numbers are not evidence. They stay guidance.

## 2. The competing numeric definitions

| # | Definition | Where it acts | Status |
|---|---|---|---|
| **DB** | `scheduled_posts` CHECKs `chk_<platform>_content`, `chk_hashtag_limits`, `chk_media_limits` (`supabase/_schema/baseline.sql:22664-22673`) | Every write of a scheduled post; Postgres refuses a violating row | **Verified existing constraint (enforced)** |
| UCP | `backend/services/unifiedContentProcessor.ts:32` `PLATFORM_CHAR_LIMITS` | Truncates when `enforce_char_limit: true` | Production code mirror of the DB: identical values on the five DB platforms; adds tiktok, pinterest and reddit with no enforced backing |
| PD | `lib/content/promotionDraft.ts:54` `PROMOTION_PLATFORM_CHAR_LIMITS` | Disables Send in the promotion workspace UI | Client-side, self-described "advisory" |
| PL | `lib/platforms.ts` `PLATFORM_CONFIGS[].constraints` | Variant truncation for x/twitter/linkedin | Production truncation |
| Bolt | `boltScheduleBlockProcessor.ts` (local map) | Truncation | Production, local copy |
| QE | `qualityEngine.ts` (local copy) | Score only | Advisory |
| SH | `lib/shared/contentFormatter.ts` | `schedulingCharLimitGuard.ts` behind `SCHEDULE_CHAR_LIMIT_MODE` (default `off`) | Off by default |

### Per-platform character values

| Platform | DB (enforced) | UCP | PD | Outreach layer after D3 |
|---|---|---|---|---|
| linkedin | **3000** | 3000 | 3000 | hard 3000 |
| twitter / x | **280** (`twitter`; `chk_platform` has no `x`) | 280 | 280 | hard 280 (x maps to twitter) |
| instagram | **2200** | 2200 | 2200 | hard 2200 |
| youtube | **5000** | 5000 | (none) | hard 5000 (**before D3: no cap at all**, because PD has no youtube entry) |
| facebook | **63206** | 63206 | 63206 | hard 63206 |
| threads | not allowed in `scheduled_posts` | (none) | 500 | advisory 500 (**before D3: hard 500 with no evidence**) |
| pinterest | not allowed | 500 | 500 | advisory 500 |
| reddit | not allowed | 40000 | 40000 | advisory 40000 |
| tiktok | not allowed | 2200 | (none) | no cap |

No registry in the code cites a provider document. The only cited justification is the DB constraint itself.

## 3. Canonical decision, as implemented

| Rule | Value | Enforcement | Evidence |
|---|---|---|---|
| Social character cap, 5 platforms | as the DB | **hard (error)** | `scheduled_posts` CHECKs; pinned by a drift test to `baseline.sql` and to the UCP map |
| Social character cap, other platforms | PD value | advisory (warning) | none |
| Social style, emoji policy, word range | `platformAdaptationProfiles` | advisory (warning) | style authority, no limits |
| Email subject length | 200 | **hard** | verified existing constraint: `emailContentGenerator.ts:42` `SUBJECT_MAX` (drift-tested) |
| WhatsApp text body | 4096 | **hard** | provider-documented: Meta's WhatsApp text-message reference states 4096 (the page found is the On-Premises API version, which Meta is sunsetting); Cloud API partner guides state the same. The Cloud API reference page itself was not confirmed. WhatsApp sending remains blocked |
| Email body 10000; community reply 1500; voice 3000; SMS 459 chars and 3 segments | policy | advisory | none (agent-proposed, C-A-2) |
| Link and emoji counts on every channel | policy | advisory | none |
| GSM 03.38 segment arithmetic | standard | used to count, not to refuse | standard |

**Not limits, so unchanged and still errors:** a required field that is empty; a line break in an email subject (header injection); personalization outside the 041-D allow-list; any placeholder on a public surface (community reply, social post); a missing personalization value.

Code:
- `lib/outreach/channelContent/limitEvidence.ts`: `SCHEDULED_POSTS_CHAR_LIMITS`, `scheduledPostsCharLimit`, `HARD_LIMIT_EVIDENCE`.
- `types.ts`: `LimitEnforcement`, and an `enforcement` on every length, link, emoji and segment rule.
- `profiles.ts`: each number classified as above.
- `channelRules.ts`: severity follows enforcement.
- `socialAdapter.ts`: hard cap from the DB constraint; PD only as advisory where no enforced cap exists.

The layer still has no runtime consumer (only its two test suites import it), so no production path changes.

**Legacy values are not deleted or changed.** PD, PL, Bolt, QE, SH and UCP keep their values; each has production or UI consumers.

## 4. Discrepancies returned to their owners (not changed here)

| ID | Finding | Risk | Owner |
|---|---|---|---|
| CL-1 | `lib/platforms.ts` allows 10 hashtags for twitter/x; the DB allows 2 | Content shaped to PL can be refused by `chk_hashtag_limits` at schedule time | Content Platform |
| CL-2 | Bolt's facebook 63000 vs DB 63206 | Stricter, harmless; divergent copy | Content Platform (Bolt) |
| CL-3 | The PD comment says it "mirrors the server-side limits"; untrue for threads (500, no server value) | Client-only | Content Platform |
| CL-4 | `scheduled_posts.chk_platform` has no `x`, tiktok, pinterest, reddit or threads | Values for those platforms have no enforced backing | Content Platform |
| CL-5 | Argument swap: `pinterestAdapter.ts:123`, `tiktokAdapter.ts:228`, `spotifyAdapter.ts:139`, `starmakerAdapter.ts:89` and `sunoAdapter.ts:88` call `formatContentForPlatform('<platform>', post.content, …)`, but the signature (`backend/utils/contentFormatter.ts:146`) is `(content, platform)` | The pin description and TikTok caption would be the literal word `pinterest` / `tiktok`. Not run; liveness of these adapters not checked | Publishing adapters owner (not Outreach). Reported, not fixed |
| CL-6 | WhatsApp 4096: confirm against Meta's current Cloud API reference before WhatsApp is unblocked | Evidence gap only; the value can only refuse | WhatsApp engine owner |
