# Campaign Radar — AI Weekly Summary Narrative

Executive-friendly narrative summary at the top of Radar View. **GUIDED tone**: trusted strategist; insight + soft recommendations only. Rule-based; no advanced AI. Visible to COMPANY_ADMIN (CMO) and optionally CAMPAIGN_CONTENT_MANAGER.

---

## 1. Tone rules (GUIDED)

- **AI provides:** insight + soft recommendations.
- **Never:** commands, aggressive urgency, or mandatory directives.
- **Goal:** AI behaves like a trusted strategist, not a manager.

**Allowed language:**

- consider  
- recommended focus  
- opportunity  

**Avoid:**

- must  
- urgent  
- mandatory directives  

---

## 2. Narrative formula (order)

1. **Positive signal (if valid)** — Data-supported only; skip when none applies.
2. **Key insight or risk** — What supports momentum or what may be slowing flow (informative only).
3. **Soft recommendation** — Consider / recommended focus / opportunity; never a command.

Display order: positive → overall health → momentum/slowdown insight → soft recommendation. Max 3–4 sentences (or 4–5 when positive is present); human-readable; no technical language.

---

## 3. Positivity detection logic

Positive statements are **data-supported only**. No exaggerated praise. Implemented in `getDataSupportedPositiveSignal(health, stageHealthSummary)`; priority order (first match wins):

| Condition | Positive phrase |
|-----------|------------------|
| `totalActivities >= 1` and `overdueCount === 0` and `blockedCount === 0` | "Execution pace remains stable." |
| CREATE stage `count >= 1` and `!hasIssues` | "Creation stage shows strong momentum." |
| SCHEDULE stage `count >= 1` and `!hasIssues` | "Scheduling flow is healthy." |
| `approvedCount >= 1` and no overdue/blocked | "Approvals are moving through." |
| None of the above | `null` (skip positive section safely) |

If no positive signal exists, the positive section is omitted in the UI.

---

## 4. Tone validation rules

- **Professional tone only.** No casual praise, emotional language, or motivational wording.
- **Allowed examples (data-supported):** "Execution pace remains stable.", "Creation stage shows strong momentum.", "Scheduling flow is healthy."
- **Avoid:** casual praise, emotional language, motivational wording, exaggerated claims.
- **Recommendations:** use only "consider", "recommended focus", "opportunity"; never "must", "urgent", or mandatory directives.

---

## 5. Narrative template examples

**With positive signal (stable execution):**

- Positive: "Execution pace remains stable."
- Overall: "Campaign execution is on track."
- Momentum: "Momentum is supported by 5 approved, 3 in schedule."
- Slowdown: "No particular slowdowns at the moment."
- Soft recommendation: "Consider keeping an eye on upcoming due dates and stage movement."

**With positive signal (creation momentum):**

- Positive: "Creation stage shows strong momentum."
- Overall: "Campaign execution is largely on track, with a few items in review or unassigned."
- (rest as above)

**No positive signal (issues present):**

- (no positive paragraph)
- Overall: "Campaign execution has some items past due or blocked."
- Momentum: "Momentum is supported by 2 approved."
- Slowdown: "A few items may be slowing flow: 2 past due, 1 blocked, 1 unassigned."
- Soft recommendation: "Recommended focus: consider clearing past-due and blocked items when you can, then assigning any unassigned work."

---

## 6. Narrative generator logic

**Function:** `generateWeeklySummaryNarrative(health: CampaignHealth, activities: Activity[], options?: { now?: number })` in `lib/campaign-health-engine.ts`.

**Output:** `WeeklySummaryNarrative`:

- **positiveSignal** — `string | null`. Data-supported positive phrase when one applies; otherwise `null` (UI skips).
- **overallHealth** — Neutral overall health statement.
- **whatIsWorking** — Key insight on momentum.
- **needsAttention** — Key insight on slowdown (informative only).
- **recommendedFocus** — Soft recommendation only (consider / recommended focus / opportunity).

All copy is human-readable; no technical jargon. Positivity detection is in `getDataSupportedPositiveSignal()`; tone rules enforced in string templates.

---

## 7. Data aggregation inputs

| Input | Source |
|-------|--------|
| Overdue activities | `health.overdueCount` |
| Approval delays | `health.pendingApprovalCount` (waiting approval) |
| Stage bottlenecks | `health.stageHealthSummary` (stages with `hasIssues` or `blockedCount > 0`) |
| Unassigned activities | `health.unassignedCount` |
| Scheduling risks | Overdue + near-due count (near-due from `isNearDue(activity, now)` over `activities`) |

Approved count and scheduled count come from `health` and `activities`. No new API or store; all from existing health + activities.

---

## 8. UI integration steps

1. **Engine** — Add `WeeklySummaryNarrative` type and `generateWeeklySummaryNarrative(health, activities, options?)`. Use `isNearDue` from board-indicators for scheduling risks.
2. **Radar view** — Add optional prop `showWeeklyNarrative?: boolean`. When true, call `generateWeeklySummaryNarrative(health, activities)` in `useMemo` and render a **Weekly Summary** section at the **top** of the radar (above Recommended Actions).
3. **Section content** — Heading "Weekly Summary" with icon; a block that shows `positiveSignal` first when non-null, then overall health, momentum insight, slowdown insight, and soft recommendation.
4. **Visibility** — Parent (e.g. `EnterpriseExecutionLayout`) passes `showWeeklyNarrative={userRole === 'COMPANY_ADMIN' || userRole === 'CAMPAIGN_CONTENT_MANAGER'}` so only CMO and (optionally) campaign manager see it.
5. **Update frequency** — Narrative is computed from current health/activities on each render. For "once daily" updates, the caller can cache by date (e.g. cache key `YYYY-MM-DD`) and invalidate at day boundary; not implemented in this phase.

---

## 9. Implementation notes

- Tone is enforced in `lib/campaign-health-engine.ts`: all narrative strings use the allowed vocabulary and avoid commands/urgency.
- To add new narrative variants, keep the same formula (overall → insight → soft recommendation) and use only consider / recommended focus / opportunity.
- No code changes required in the UI for tone; the generator output is already GUIDED.

---

## 10. Constraints

- Human-readable summary only; no technical language.
- Max 3–4 sentences (four short sentences, one per section).
- Rule-based; no advanced AI.
- Update frequency: intended once daily; initial implementation recomputes on render (caching by date is a later step).
