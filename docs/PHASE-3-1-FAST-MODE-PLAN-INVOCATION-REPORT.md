# Phase 3.1 — Fix Fast Mode Plan Invocation — Report

**Objective:** Fix Fast Mode (BOLT) planning so it uses the same internal contract as AI Chat. No changes to recommendation engine, weekly plan storage, Blueprint flow, or AI Chat flow.

---

## 1. Old incorrect plan call removed

**File:** `components/recommendations/tabs/TrendCampaignsTab.tsx`

Removed from `onBuildCampaignFast`:

- The entire block that built `collectedPlanningContext` (target_audience, tentative_start, audience_professional_segment, communication_style, content_depth, content_capacity, action_expectation) and called the plan API with:
  - `mode: 'generate_plan'`
  - `message: 'Generate my 12-week plan now.'`
  - `messages: []`
  - `durationWeeks: executionConfigPayload.campaign_duration`
  - `collectedPlanningContext`
  - `recommendationContext: sourceStrategicTheme`

That invocation was deleted.

---

## 2. New plan invocation code

**File:** `components/recommendations/tabs/TrendCampaignsTab.tsx`

**Guard before plan:**

```ts
if (!createdCampaignId) {
  throw new Error('Campaign ID missing before Fast Mode planning.');
}
```

**Step A — Fetch campaign after create/update:**

```ts
const campaignRes = await fetchWithAuth(
  `/api/campaigns?type=campaign&campaignId=${encodeURIComponent(createdCampaignId)}&companyId=${encodeURIComponent(companyId)}`
);
const campaignData = await campaignRes.json();
const prefilledPlanning = campaignData.prefilledPlanning ?? {};
const recommendationContextFromCampaign = campaignData.recommendationContext ?? null;
```

**Step B — Minimal conversation history (user confirms immediately):**

```ts
const conversationHistory = [
  { type: 'user' as const, message: 'Yes, generate my full 12-week plan now.' },
];
```

**Step C — Plan API call (same contract as AI Chat, no mode/message/durationWeeks/collectedPlanningContext):**

```ts
const planRes = await fetchWithAuth('/api/campaigns/ai/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    campaignId: createdCampaignId,
    companyId,
    context: 'campaign-planning',
    conversationHistory,
    prefilledPlanning,
    recommendationContext: recommendationContextFromCampaign,
    forceFreshPlanningThread: true,
  }),
});
```

Not passed: `durationWeeks`, `collectedPlanningContext`, `message`, `mode`, `messages`.

---

## 3. Plan API support for Fast Mode (same internal contract)

**File:** `pages/api/campaigns/ai/plan.ts`

- Destructure `forceFreshPlanningThread`, `prefilledPlanning`, `conversationHistory` (and keep `messages` as alias).
- When `forceFreshPlanningThread === true` and `conversationHistory.length > 0`: set `mode = mode ?? 'generate_plan'` and `message` from last user entry (`.message` or `.content`) or default `'Yes, generate my full 12-week plan now.'`.
- Use `prefilledPlanning` as `collectedPlanningContext` when provided, so orchestrator gets execution_config and duration from snapshot/prefilled planning.

**Diff snippet (plan API):**

```ts
const conversationHistory = Array.isArray(bodyConversationHistory)
  ? bodyConversationHistory
  : Array.isArray(bodyMessages) ? bodyMessages : [];

let mode = bodyMode;
let message = typeof bodyMessage === 'string' ? bodyMessage : '';

if (forceFreshPlanningThread === true && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
  mode = mode ?? 'generate_plan';
  const lastUser = [...conversationHistory].reverse().find((m: any) => m?.type === 'user' || m?.role === 'user');
  const lastUserText = lastUser && (typeof (lastUser as any).message === 'string' ? (lastUser as any).message : typeof (lastUser as any).content === 'string' ? (lastUser as any).content : null);
  message = message || lastUserText || 'Yes, generate my full 12-week plan now.';
}

const collectedPlanningContext =
  bodyPrefilledPlanning != null && typeof bodyPrefilledPlanning === 'object' && !Array.isArray(bodyPrefilledPlanning)
    ? bodyPrefilledPlanning
    : bodyCollectedPlanningContext;
```

Downstream logic still uses `mode`, `message`, and `existingCollectedPlanningContext` (from `collectedPlanningContext`), so duration is resolved from snapshot/execution_config in the orchestrator.

---

## 4. Confirmations

| Item | Status |
|------|--------|
| Duration now sourced from execution_config | Yes. Fast Mode sends `prefilledPlanning` from GET campaign (which includes `execution_config` from snapshot). Plan API uses it as `collectedPlanningContext`; orchestrator reads duration from snapshot `execution_config` (Phase 1 hardening). No `durationWeeks` sent from client. |
| execution_config and mode saved before plan | Yes. Plan is called only after PUT source-recommendation or POST campaigns succeeds; both persist `execution_config` and `mode: 'fast'`. Then we GET campaign to read `prefilledPlanning` and `recommendationContext` before calling plan. |
| AI Chat flow unchanged | Yes. `onBuildCampaignBlueprint` and `CampaignAIChat` component were not modified. Only `onBuildCampaignFast` and the plan API’s Fast Mode branch were changed. |
| No duplicate fields sent | Yes. Fast Mode request sends only: `campaignId`, `companyId`, `context`, `conversationHistory`, `prefilledPlanning`, `recommendationContext`, `forceFreshPlanningThread`. No `message`, `mode`, `messages`, `durationWeeks`, or `collectedPlanningContext` (API derives mode/message and uses prefilledPlanning as collectedPlanningContext). |

---

## 5. GET campaign returns `mode`

**File:** `pages/api/campaigns/index.ts`

GET `type=campaign` response already includes:

```ts
mode: (snapshot as { mode?: string } | null)?.mode ?? undefined,
```

No change made; confirmed present.

---

## 6. Build status

- **Modified files:** `TrendCampaignsTab.tsx`, `pages/api/campaigns/ai/plan.ts` — no linter errors.
- **Full repo build:** Still fails in `ActiveLeadsTab.tsx` (Lucide `CheckCircle` `title` prop) — unrelated to Phase 3.1. Fast Mode plan invocation changes compile.
