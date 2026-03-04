# Phase 3.2 — BOLT Refinement + Safety Hardening — Report

**Objective:** Refine BOLT UX and add minimal production hardening. No changes to recommendation engine, Blueprint flow, AI Chat logic, duration logic, or snapshot schema.

---

## 1. Safety guard diff (plan API)

**File:** `pages/api/campaigns/ai/plan.ts`

- Added `context: bodyContext` to body destructuring.
- Replaced Fast Mode detection condition:

**Before:**

```ts
if (forceFreshPlanningThread === true && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
```

**After:**

```ts
if (
  bodyContext === 'campaign-planning' &&
  forceFreshPlanningThread === true &&
  Array.isArray(conversationHistory) &&
  conversationHistory.length > 0
) {
```

Fast Mode only activates when `context === 'campaign-planning'`. Other logic unchanged.

---

## 2. fastLoading state implementation

**File:** `components/recommendations/tabs/TrendCampaignsTab.tsx`

- **State (component level, with other useState):**

```ts
const [fastLoadingCardId, setFastLoadingCardId] = useState<string | null>(null);
```

- **When BOLT clicked:** `setFastLoadingCardId(card.id)` after execution bar validation, immediately before `try {`.
- **After redirect (success):** `setFastLoadingCardId(null)` before `router.push(\`/campaign-details/${createdCampaignId}?mode=fast\`)`.
- **On plan API failure:** `setFastLoadingCardId(null)` before `router.push(\`/campaign-details/${createdCampaignId}\`)` and `return`.
- **On catch (any other error):** `setFastLoadingCardId(null)` at start of catch block, then `setValidationError(...)`.

**File:** `components/recommendations/cards/RecommendationBlueprintCard.tsx`

- **Prop:** `fastLoading?: boolean` added to type and destructuring.
- **Pass from TrendCampaignsTab:** `fastLoading={fastLoadingCardId === card.id}` on `RecommendationBlueprintCard`.

---

## 3. Updated BOLT button JSX

**File:** `components/recommendations/cards/RecommendationBlueprintCard.tsx`

**Minimized and full Actions sections — same BOLT button:**

```tsx
<button
  type="button"
  onClick={() => run(onBuildCampaignFast)}
  disabled={busy || fastLoading || !onBuildCampaignFast}
  className="min-w-[110px] px-4 py-2 text-sm font-medium rounded-lg border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition"
>
  {fastLoading ? '⚡ Generating…' : '⚡ BOLT'}
</button>
```

- `disabled`: includes `fastLoading`.
- Label: `fastLoading ? '⚡ Generating…' : '⚡ BOLT'`.
- Classes: `min-w-[110px]`, `transition`, and the specified BOLT styles (no change to Blueprint button).

---

## 4. Duplicate prevention confirmation

At the top of `onBuildCampaignFast`:

```ts
if (fastLoadingCardId) return;
```

If any card is already in Fast loading state, the handler returns immediately. Together with `setFastLoadingCardId(card.id)` at start of the flow and `disabled={busy || fastLoading || !onBuildCampaignFast}`, double-click / duplicate execution is prevented.

---

## 5. Failure fallback confirmation

When the plan API fails:

```ts
if (!planRes.ok) {
  console.error('Fast Mode plan failed');
  setFastLoadingCardId(null);
  router.push(`/campaign-details/${createdCampaignId}`);
  return;
}
```

- Campaign already exists (created via PUT or POST).
- User is sent to campaign details without `?mode=fast`.
- User can open AI Chat manually; no dead state.
- No `throw`; loading state is cleared and navigation happens.

---

## 6. Build status

- **Modified files:** `pages/api/campaigns/ai/plan.ts`, `components/recommendations/tabs/TrendCampaignsTab.tsx`, `components/recommendations/cards/RecommendationBlueprintCard.tsx` — no linter errors.
- **Full repo build:** Fails in `components/recommendations/tabs/ActiveLeadsTab.tsx` (Lucide `CheckCircle` `title` prop) — unrelated to Phase 3.2. All Phase 3.2 changes compile.
