# Strategy Leaks After Weekly Blueprint Creation

**Rule:** Daily planning should not make strategic decisions.  
**Scope:** Flow after weekly blueprint exists — from blueprint resolution through daily plan generation and any downstream adjustments.  
**No code modified; analysis only.**

---

## Summary

The following decisions are still made **after** the weekly blueprint is produced. Each is a “strategy leak” that violates the rule that daily planning should only generate content.

For each leak:

- **Decision:** What is being decided
- **Where:** File and approximate location
- **Why blueprint doesn’t have it:** Reason it’s missing from weekly output
- **Move to weekly enrichment?:** Whether it should be moved into weekly (or pre-daily) enrichment

---

## 1. Entire slot definition when blueprint has no execution_items (AI path)

| | |
|--|--|
| **Decision** | What to publish each day: **day_index**, **platform**, **content_type**, **short_topic**, **full_topic**, **reasoning**, and effective **intent** (objective, audience, CTA, brief) per slot. |
| **Where** | `backend/services/dailyContentDistributionPlanService.ts`: `generateDailyDistributionPlan()` calls an LLM with a long system prompt. The LLM returns `daily_plan[]` with day_index, platform, content_type, short_topic, full_topic, reasoning, festival_consideration. Then `pages/api/campaigns/generate-weekly-structure.ts` (lines 622–656) maps each AI slot to a `DailyPlanItem` using **hardcoded** intent: `whoAreWeWritingFor: 'General Audience'`, `ctaType: 'Learn more'`, `desiredAction: 'Learn more'`, `contentGuidance: deriveContentGuidance(null)` (default). |
| **Why blueprint doesn’t have it** | When the user/campaign path never produces `execution_items` (e.g. no `platform_content_requests`, or blueprint from strategy/LLM without skeleton merge), the week only has `platform_allocation`, `content_type_mix`, `topics_to_cover`. There is no per-slot, per-day plan. So “what runs which day on which platform with what intent” doesn’t exist at weekly level. |
| **Move to weekly enrichment?** | **Yes.** The desired end state is: weekly blueprint always contains a full execution layer (e.g. execution_items with topic_slots and intent, and ideally day assignment). Then daily only expands that into rows. Until then, the “no execution_items” path is inherently a strategy leak; the fix is to ensure weekly planning (or a weekly enrichment step) always produces execution_items (and optionally day hints) so the AI path is no longer needed for structure. |

---

## 2. Which day each slot lands on (execution_items path)

| | |
|--|--|
| **Decision** | **Day index (1–7)** for each piece: which weekday each topic_slot is scheduled. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts`: `spreadEvenlyAcrossDays(exec.count_per_week, 7)` (lines 518–528, 671). For each execution_item, day indices are computed locally (e.g. round((i+0.5)*7/n - 0.5)); then for STAGGERED, `dayIndex = ((baseDayIndex - 1 + pi) % 7) + 1` for each platform. The blueprint’s `resolved_postings` (if any) are **not** used here; day is always recomputed. |
| **Why blueprint doesn’t have it** | The orchestrator builds `resolved_postings` with progression and platform/topic/intent, but the resolved posting shape and whether it includes a stable day assignment is tied to the orchestrator’s internal build. The canonical blueprint and `getUnifiedCampaignBlueprint` return weeks with `execution_items` and optionally `resolved_postings`; the generate-weekly-structure API does not read day from blueprint—it always derives day from a local spread. So “which day” is not treated as part of the committed blueprint. |
| **Move to weekly enrichment?** | **Yes.** Weekly output should either (a) include **day_index** (or equivalent) per slot in execution_items / resolved_postings so daily just uses it, or (b) define a single deterministic rule (e.g. “always use spreadEvenlyAcrossDays”) and document that the blueprint’s “day rule” is that rule. Prefer (a): store day assignment in the blueprint (e.g. in topic_slots or in resolved_postings) so daily does not recompute. Enrichment could set it when building/merging execution_items. |

---

## 3. Distribution strategy / campaign mode (fallback from request)

| | |
|--|--|
| **Decision** | Whether the week is **QUICK_LAUNCH** (same_day_per_topic) or **STAGGERED**, and thus how days and platforms are assigned (e.g. one platform per day offset vs all platforms same day). |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (lines 478–487). `distributionStrategy` is read from `(weekBlueprint as any).distribution_strategy`; if not set, it falls back to **request body** `distribution_mode`, then default `'staggered'`. So strategy can come from the **API request** at daily-generation time. |
| **Why blueprint doesn’t have it** | `distribution_strategy` is not on the canonical `CampaignBlueprintWeek` type; it lives in `week_extras` or ad-hoc. Some code paths (orchestrator) set it; others don’t. So it’s often missing from the stored blueprint. |
| **Move to weekly enrichment?** | **Yes.** Weekly blueprint should always carry **distribution_strategy** (or equivalent) on the week so daily does not need request-time strategy. Set it during weekly planning or in a weekly enrichment step and persist on the week (e.g. week_extras or first-class field). |

---

## 4. Default platform when item has no platforms (AI path)

| | |
|--|--
| **Decision** | **Which platform** to use when a daily item has no platform targets (e.g. AI returned something without platform, or list is empty). |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (lines 834–838). When `item.platformTargets` is empty and not using execution_items, `platforms = getDefaultPlatformTargets(weekBlueprint)`, which picks the **top platform by allocation** (e.g. linkedin). So “where to post” is decided at daily time from week-level allocation. |
| **Why blueprint doesn’t have it** | In the AI path, each slot comes from the LLM with a platform; if the pipeline ever produced an item with no platform, the blueprint doesn’t have a per-slot platform—we only have week-level platform_allocation. So daily fills the gap. |
| **Move to weekly enrichment?** | **Partially.** Prefer that every slot in the blueprint has an explicit platform (so no default needed). If the weekly blueprint always has execution_items with selected_platforms/slot_platforms, this leak goes away for the execution path. For the AI path, see leak #1. |

---

## 5. Content guidance default when brief is missing (execution_items path)

| | |
|--|--|
| **Decision** | **Primary format, max word target, and platform-with-highest-limit** for each daily item (contentGuidance). |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts`: when building each `DailyPlanItem` from execution_items we call `deriveContentGuidance(null)` (lines 701, 724). So we never pass the slot or week brief; we always get the **default**: `{ primaryFormat: 'long-form social post', maxWordTarget: 800, platformWithHighestLimit: 'linkedin' }`. |
| **Why blueprint doesn’t have it** | Blueprint can have `week.topics[]` with `contentTypeGuidance` per topic, but (a) execution_items path doesn’t map slot to that brief (no briefByKey lookup for the slot’s topic), and (b) slot intent doesn’t carry format/word guidance. So the daily layer never uses weekly guidance and always falls back to a global default. |
| **Move to weekly enrichment?** | **Yes.** Weekly enrichment (or merge) should attach **content guidance** per slot (e.g. from week.topics[].contentTypeGuidance by topic, or from execution_item content_type). Then generate-weekly-structure should use it (e.g. deriveContentGuidance(briefForSlot)) instead of passing null. |

---

## 6. Reassigning content type when platform rejects it (auto_rebalance)

| | |
|--|--|
| **Decision** | **Content type** of a piece when the platform rejects the requested type: e.g. switch to “post” or “tweet” so the item becomes valid. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (lines 898–927). After `validateDailyItemAgainstPlatformRules`, if `autoRebalanceEffective && validated.validation_status === 'invalid'`, we call `getPlatformRules(platform)` and pick a **preferred** type (post, then tweet, then first supported) and re-validate with that type. So we **change** content_type at daily time to satisfy platform rules. |
| **Why blueprint doesn’t have it** | Blueprint stores content_type per execution_item (from platform_content_requests / skeleton). It doesn’t store “if platform X doesn’t support this type, use Y.” So when platform rules say “not supported,” daily fixes it by choosing another type. |
| **Move to weekly enrichment?** | **Yes.** Weekly enrichment (or validation at commit time) should either (a) ensure every (platform, content_type) in the blueprint is allowed by platform rules so daily never needs to rebalance, or (b) store an explicit **fallback content_type** per platform so daily applies a rule, not a new choice. Prefer (a): validate at weekly commit and disallow invalid combinations so daily never reassigns type. |

---

## 7. Reassigning platform and optionally content type (auto_optimize_distribution)

| | |
|--|--|
| **Decision** | **Which platform** (and sometimes **content type**) each item is published to, when “optimization” says to reduce certain platforms and move volume to “preferred” ones. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (lines 1034–1100). We call `analyzeExecutionFeedback(feedbackHistory)` and `suggestPublishingStrategy(weeklyPlanForOptimization, optimizationSummary)` to get `reduced_platforms` and `preferred_platforms`. Then for each row on a reduced platform we **reassign** to `preferredPlatform` (e.g. linkedin) and re-validate; if still invalid, we apply the same auto_rebalance logic (preferred content type). So we change both **platform** and possibly **content_type** at daily time based on historical feedback. |
| **Why blueprint doesn’t have it** | Blueprint reflects the plan at commit time; it doesn’t encode “after N weeks, shift from platform A to B.” That “strategy” is computed at daily-generation time from prior weeks’ execution feedback. |
| **Move to weekly enrichment?** | **Debatable.** If “rebalance by feedback” is strategy, it should be decided when the **weekly plan is (re)committed** (e.g. “next week we’re reducing X and emphasizing Y”) and written into the blueprint, not when generating daily. So: move the **decision** to a weekly (or re-plan) step: run analyzeExecutionFeedback + suggestPublishingStrategy there and update the week’s platform_allocation / execution_items; then daily just expands that. If we keep auto_optimize at daily time, it remains a strategy leak. |

---

## 8. Scheduled date changes (campaign waves)

| | |
|--|--|
| **Decision** | **Exact calendar date** of each item: wave logic can **move** the base date (e.g. +0, +1, +3 days by platform order) to stagger publishing. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (lines 716–754). When `enableCampaignWaves` is true, we build `waveItems` from current rows (platform, topic, base_date, stability), call `generatePlatformWaveSchedule(waveItems)`, and then **overwrite** `entry.row.date` with `assignment.scheduled_date` and attach wave_info to content. So the **date** (and thus “which day” in calendar terms) is changed at daily time. |
| **Why blueprint doesn’t have it** | Blueprint doesn’t store wave policy or per-slot scheduled_date. Day index is computed in daily (see #2); wave service then shifts dates by platform. So “when exactly to publish” is decided in the daily layer. |
| **Move to weekly enrichment?** | **Yes.** If wave staggering is strategy, the blueprint should either (a) store **scheduled_date** (or day_index) per slot so wave logic is applied at weekly commit and daily just persists it, or (b) define wave rules on the week (e.g. in week_extras) and have a single place that applies them when building the execution view, so daily doesn’t mutate dates. Prefer (a): weekly output includes final dates or day assignments; daily doesn’t change them. |

---

## 9. Narrative style fallback (execution_items path)

| | |
|--|--|
| **Decision** | **Narrative style** (tone) for the piece when the slot intent doesn’t provide a distinct one. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (lines 723, 724): `narrativeStyle: writingAngle || 'clear, practical, outcome-driven'`. So we use slot’s writing_angle if present, otherwise a **hardcoded** default. |
| **Why blueprint doesn’t have it** | Slot intent has writing_angle (and week has toneGuidance in capsule), but we don’t map narrativeStyle from weeklyContextCapsule or from a per-slot narrative hint. So when writing_angle is missing or not used as narrative, daily injects a default. |
| **Move to weekly enrichment?** | **Yes.** Weekly enrichment should ensure each slot has a **narrative_style** or equivalent (from capsule or topic brief). Then daily uses that instead of a literal default. |

---

## 10. Target region for holiday/festival (AI path input)

| | |
|--|--|
| **Decision** | **Target region** (and thus holiday/festival awareness) when the AI daily distribution is called. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts` (line 619): `targetRegion: null` is passed to `generateAIDailyDistribution()`. So the LLM never receives a region and cannot adapt for holidays/festivals. If we later pass a region from company/campaign, **where** that value comes from would be a decision point; currently the decision is “don’t consider region.” |
| **Why blueprint doesn’t have it** | Blueprint doesn’t store target_region or festival policy per week. Company/campaign may have it elsewhere. |
| **Move to weekly enrichment?** | **Yes.** If we want holiday-aware distribution, **target_region** (or “no region”) should be on the week (or campaign) and passed from blueprint/context into the AI path. Then the “decision” is made at weekly (or company) level, not by daily omitting it. |

---

## 11. Minimum slots and spread rules in AI path (dailyContentDistributionPlanService)

| | |
|--|--|
| **Decision** | **How many slots** to ask for and **how to spread** them across days (e.g. “at least 5 slots,” “use 5 different days,” “same_day_per_topic vs staggered” grouping). |
| **Where** | `backend/services/dailyContentDistributionPlanService.ts`: `buildUserPrompt()` sets `minimum_slots: Math.max(3, topicList.length, 5)` and a long `distribution_instruction`; the system prompt enforces “spread across the week,” “content fatigue,” “cascade strategy.” Then (lines 284–318) we **post-process** AI output: if one slot and multiple topics we duplicate to one per topic and put all on Monday; if all same day we force round-robin days; then we apply same_day_per_topic vs staggered grouping. So **count and spread rules** are decided in the daily service (and prompt), not in the blueprint. |
| **Why blueprint doesn’t have it** | When there are no execution_items, the blueprint doesn’t specify “how many pieces” or “which day each.” So the AI path invents both; the service then enforces its own spread rules. |
| **Move to weekly enrichment?** | **Yes.** Eliminating the AI path (see #1) removes this. If we keep a fallback, then “minimum slots” and “spread rule” should come from the blueprint (e.g. total_weekly_content_count and distribution_strategy) and be passed in, not hardcoded in the daily service. |

---

## 12. KPI target fallback

| | |
|--|--|
| **Decision** | **Weekly KPI focus** string on each daily item when the week doesn’t expose it. |
| **Where** | `pages/api/campaigns/generate-weekly-structure.ts`: `kpiTarget: String((weekBlueprint as any)?.weekly_kpi_focus ?? 'Reach growth')` (e.g. lines 658, 726). So we have a default if the week has no weekly_kpi_focus. |
| **Why blueprint doesn’t have it** | Blueprint week can have weekly_kpi_focus; when it’s missing we default. So the “decision” is only the fallback value. |
| **Move to weekly enrichment?** | **Low priority.** Enrichment could set weekly_kpi_focus on every week so daily never needs a default. |

---

## List of strategy leaks (checklist)

Violations of “daily planning should not make strategic decisions”:

1. **AI path invents full slot definition** (day, platform, content_type, topic phrasing, intent) when blueprint has no execution_items.  
2. **Day assignment** for execution_items path is computed in daily (`spreadEvenlyAcrossDays`) instead of read from blueprint.  
3. **Distribution strategy / campaign mode** can be taken from request body when not on blueprint.  
4. **Default platform** when item has no platforms (AI path) from week allocation.  
5. **Content guidance** always default when building from execution_items (brief not used).  
6. **Content type reassignment** (auto_rebalance) when platform rejects type.  
7. **Platform (and sometimes content type) reassignment** (auto_optimize_distribution) from execution feedback.  
8. **Scheduled date changes** (campaign waves) applied at daily time.  
9. **Narrative style** default when slot has no explicit style.  
10. **Target region** for AI path fixed to null (region not from blueprint).  
11. **Slot count and spread rules** for AI path defined in daily service/prompt, not blueprint.  
12. **KPI target** fallback when week has no weekly_kpi_focus.

---

**End of document.**
