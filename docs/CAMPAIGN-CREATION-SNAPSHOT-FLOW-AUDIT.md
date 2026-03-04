# CAMPAIGN CREATION + SNAPSHOT FLOW — Structured Audit

**Objective:** Confirm campaign lifecycle and storage timing before persisting `execution_config` and refactoring AI Chat. Audit only; no code modified.

---

## 1. Campaign Creation Timing

**When user clicks "Build Campaign Blueprint" from a Trend theme card:**

### Is a campaign record created immediately?

**Yes.** Either:

- **Path A (campaign already exists):** Campaign was created earlier when the user clicked "Generate Strategic Themes." In that case, "Build Campaign Blueprint" only saves the selected card to that campaign via PUT and then redirects.
- **Path B (no pre-created campaign):** A new campaign is created via POST to `/api/campaigns`, then the client redirects to the campaign page.

### If yes — file, API route, line

**Path A — Save card to existing campaign (no new campaign row):**

- **File:** `components/recommendations/tabs/TrendCampaignsTab.tsx`
- **Function:** Inline `async () => { ... }` passed as `onBuildCampaignBlueprint` to `RecommendationBlueprintCard` (starts ~line 1839).
- **API route:** `PUT /api/campaigns/[id]/source-recommendation`
- **Route file:** `pages/api/campaigns/[id]/source-recommendation.ts`
- **Code snippet (TrendCampaignsTab.tsx, lines 1905–1971):**

```tsx
if (generatedCampaignId) {
  const putRes = await fetchWithAuth(
    `/api/campaigns/${encodeURIComponent(generatedCampaignId)}/source-recommendation`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_recommendation_id: recId || null,
        source_strategic_theme: sourceStrategicTheme,
      }),
    }
  );
  // ...
  createdCampaignId = generatedCampaignId;
  setGeneratedCampaignId(null);
} else {
  // Path B: create new campaign
  const response = await fetchWithAuth('/api/campaigns', { method: 'POST', ... });
  // ...
}
// ...
router.push(`/campaign-details/${createdCampaignId}?${qs.toString()}`);
```

**Path B — Create new campaign:**

- **File:** `pages/api/campaigns/index.ts`
- **Handler:** POST branch of default export (req.method === 'POST').
- **Campaign insert:** Lines 336–341 (insert into `campaigns` table).
- **Code snippet (pages/api/campaigns/index.ts, lines 334–341):**

```ts
// Insert campaign into database
const { data: campaign, error } = await (supabase as any)
  .from('campaigns')
  .insert([campaignDataWithUser])
  .select()
  .single();
```

- **campaign_versions insert (creates first version with campaign_snapshot):** Lines 398–415.

```ts
const { error: versionError } = await (supabase as any)
  .from('campaign_versions')
  .insert({
    company_id: companyId,
    campaign_id: (campaign as { id: string }).id,
    campaign_snapshot: snapshotPayload,
    status: (campaign as { status?: string }).status ?? 'draft',
    version: 1,
    created_at: new Date().toISOString(),
    build_mode,
    context_scope: context_scope && context_scope.length > 0 ? context_scope : null,
    campaign_types,
    campaign_weights: campaign_weights,
    company_stage,
    market_scope,
    baseline_override: baseline_override && typeof baseline_override === 'object' ? baseline_override : null,
  });
```

### Is the campaign ID persisted in DB immediately?

**Yes.** For Path B, the campaign row is inserted (lines 336–341), then the `campaign_versions` row is inserted (398–415). Response is sent at 201 (lines 423–427). For Path A, the campaign already exists in DB; only `campaign_versions.campaign_snapshot` is updated.

### Is the campaign ID temporary in frontend state?

**No.** The campaign ID is either (1) from the server-created campaign (`data.campaign.id` or the UUID sent in the POST body), or (2) `generatedCampaignId` from state, which was set when the campaign was created at "Generate Strategic Themes" (POST /api/campaigns at that time). It is not a temporary client-only id; it is the real DB campaign id used for redirect.

### Is campaign created before AI Chat opens? Or only after AI Chat confirms planning?

**Campaign is created (or already exists) before AI Chat is opened.** The flow is: click "Build Campaign Blueprint" → create or update campaign (and optionally save card) → `router.push(`/campaign-details/${createdCampaignId}?...`)` → user lands on campaign-details page. AI Chat is a component on that page and opens later (e.g. user clicks to open chat). Campaign exists in DB before the user ever sees the campaign-details page or AI Chat.

### Insert before redirect?

**Yes.** Both paths perform the API call(s) and only then call `router.push(...)`. Redirect happens after insert/update complete (see TrendCampaignsTab.tsx ~1971).

---

## 2. Campaign Snapshot Creation Timing

### When is campaign_snapshot created?

- **At blueprint/campaign creation (Build flow):** When a **new** campaign is created via `POST /api/campaigns` (Path B), the first `campaign_versions` row is inserted with `campaign_snapshot: snapshotPayload` (pages/api/campaigns/index.ts, lines 398–415). So **campaign_snapshot is created at campaign creation** in that flow.
- **When campaign was pre-created at "Generate Strategic Themes":** The snapshot was created at that moment (same POST /api/campaigns). "Build Campaign Blueprint" then only **updates** that snapshot via PUT source-recommendation (merge in `source_strategic_theme` and `source_recommendation_id`).

### Is it created at blueprint creation? AI Chat completion? Weekly plan generation? Or later?

- **At blueprint creation (campaign creation):** Yes. The initial `campaign_snapshot` is created when the campaign is first created (POST /api/campaigns).
- **AI Chat completion:** AI plan API (`pages/api/campaigns/ai/plan.ts`) does **not** insert or update `campaign_versions`. It writes to `twelve_week_plan` via `saveAiCampaignPlan` / `saveStructuredCampaignPlan` in `backend/db/campaignPlanStore.ts`. So **campaign_snapshot is not created/updated at AI Chat completion** in the current flow.
- **Weekly plan generation:** `create-12week-plan` can create a **new** campaign and then insert a `campaign_versions` row with `campaign_snapshot: { campaign }` (create-12week-plan.ts lines 75–84) only when the campaign did not exist. It does not update an existing campaign’s snapshot with `weekly_plan`. Weekly plan data is stored in `twelve_week_plan` (and optionally elsewhere), not necessarily inside `campaign_versions.campaign_snapshot` in this flow.
- **Later:** Snapshot can be **updated** later by PUT `/api/campaigns/[id]/source-recommendation` (merge source card into existing snapshot). Other flows (e.g. approve-strategy) can create a **new** campaign_versions row (new version) with the same snapshot content; they do not necessarily add `weekly_plan` into the snapshot.

### File path, function, code snippet of snapshot insert/update

**Insert (initial snapshot at campaign creation):**

- **File:** `pages/api/campaigns/index.ts`
- **Function:** POST branch of the default API handler.
- **Snippet (lines 366–415, building snapshot then insert):**

```ts
const snapshotPayload: Record<string, unknown> = { campaign };
if (planning_context && typeof planning_context === 'object') {
  snapshotPayload.planning_context = planning_context;
}
if (typeof source_opportunity_id === 'string' && source_opportunity_id.trim()) {
  snapshotPayload.source_opportunity_id = source_opportunity_id.trim();
}
// ... target_regions, context_payload, recommendation_id, source_strategic_theme ...
const { error: versionError } = await (supabase as any)
  .from('campaign_versions')
  .insert({
    company_id: companyId,
    campaign_id: (campaign as { id: string }).id,
    campaign_snapshot: snapshotPayload,
    ...
  });
```

**Update (save card to existing campaign):**

- **File:** `pages/api/campaigns/[id]/source-recommendation.ts`
- **Function:** Default export handler (PUT).
- **Snippet (lines 73–86):**

```ts
const currentSnapshot = (latestVersion.campaign_snapshot as Record<string, unknown>) || {};
const updatedSnapshot: Record<string, unknown> = { ...currentSnapshot };
if (source_recommendation_id) {
  updatedSnapshot.source_recommendation_id = source_recommendation_id;
  const meta = (currentSnapshot.metadata as Record<string, unknown>) || {};
  updatedSnapshot.metadata = { ...meta, recommendation_id: source_recommendation_id };
}
if (source_strategic_theme) {
  updatedSnapshot.source_strategic_theme = source_strategic_theme;
}
const { error: updateError } = await supabase
  .from('campaign_versions')
  .update({ campaign_snapshot: updatedSnapshot })
  .eq('id', (latestVersion as { id: string }).id);
```

### Whether execution_config could be injected at that stage

**Yes.** Both at initial creation and at update:

- **Creation (index.ts):** `snapshotPayload` is built from request body (planning_context, source_strategic_theme, etc.). Adding `execution_config` from the request (e.g. from TrendCampaignsTab’s `strategicPayload.execution_config` when calling POST /api/campaigns) and setting `snapshotPayload.execution_config = body.execution_config` would persist it in the first snapshot.
- **Update (source-recommendation.ts):** `updatedSnapshot` is a merge of current snapshot plus new fields. Adding `execution_config` from the PUT body and assigning `updatedSnapshot.execution_config = body.execution_config` would persist or overwrite it at "Build Campaign Blueprint" when saving the card to an existing campaign.

So execution_config can be injected at both snapshot creation and at the source-recommendation update stage.

---

## 3. AI Chat Entry Flow

### Full routing chain

1. **TrendCampaignsTab**  
   - File: `components/recommendations/tabs/TrendCampaignsTab.tsx`  
   - Renders a list of theme cards; each card is `RecommendationBlueprintCard` with an `onBuildCampaignBlueprint` callback (inline async function, ~lines 1839–1981).

2. **RecommendationBlueprintCard**  
   - File: `components/recommendations/cards/RecommendationBlueprintCard.tsx`  
   - "Build Campaign Blueprint" button (e.g. lines 664–667, 858–860) calls `onClick={() => run(onBuildCampaignBlueprint)}`.  
   - So the function that runs on "Build Campaign Blueprint" is the **inline async function passed from TrendCampaignsTab** as `onBuildCampaignBlueprint` (TrendCampaignsTab.tsx ~1839–1981).

3. **What that function does**  
   - If `generatedCampaignId` exists: PUT `/api/campaigns/${generatedCampaignId}/source-recommendation` with card data, then `createdCampaignId = generatedCampaignId`.  
   - Else: POST `/api/campaigns` with new campaign payload, then `createdCampaignId` from response or sent id.  
   - Then `router.push(`/campaign-details/${createdCampaignId}?${qs.toString()}`)`.

4. **Page that opens**  
   - **Campaign details page:** `/campaign-details/[id]`  
   - File: `pages/campaign-details/[id].tsx`  
   - Dynamic segment `[id]` is the campaign id (e.g. `createdCampaignId`). So the URL is `/campaign-details/<campaignId>?companyId=...&fromRecommendation=1&recommendationId=...`.

5. **Where AI Chat gets campaignId**  
   - In `pages/campaign-details/[id].tsx`, the route param is read as: `const { id, companyId: companyIdFromUrl } = router.query;` (line 203).  
   - Campaign data is loaded by `loadCampaignDetails(campaignId)` (e.g. line 737), which uses `id`.  
   - **CampaignAIChat** is rendered with `campaignId={campaign.id}` (line 3488). So AI Chat receives `campaign.id`, which is the same as the page’s `id` (campaign loaded for that id).  
   - Snippet (lines 3479–3492):

```tsx
{campaign && !shouldForceWeeklyBlueprintView && (
  <CampaignAIChat
    isOpen={showAIChat}
    onClose={...}
    onMinimize={...}
    context="campaign-planning"
    forceFreshPlanningThread={false}
    companyId={effectiveCompanyId || undefined}
    campaignId={campaign.id}
    campaignData={campaign}
    recommendationContext={recommendationContext}
    prefilledPlanning={prefilledPlanning}
    ...
  />
)}
```

So: **TrendCampaignsTab → RecommendationBlueprintCard (onBuildCampaignBlueprint) → POST or PUT + router.push → campaign-details/[id] → id from router.query → loadCampaignDetails(id) → campaign state → CampaignAIChat receives campaignId={campaign.id}.**

---

## 4. Campaign Versioning

### Does AI Chat use campaign_versions?

**Yes, indirectly.** The AI plan API (`pages/api/campaigns/ai/plan.ts`) verifies access by loading `campaign_versions` for the given `campaignId` (lines 44–50):

```ts
const { data: versionForAccess } = await supabase
  .from('campaign_versions')
  .select('company_id')
  .eq('campaign_id', campaignId)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

It uses `campaign_versions` to resolve `company_id` and enforce company/campaign access. It does not read or write `campaign_snapshot` in this handler; planning context is taken from `getCampaignPlanningInputs`, `collectedPlanningContext`, and request body.

### Does it update campaign_versions during planning?

**No.** The plan API does not insert or update `campaign_versions`. It persists AI output to `twelve_week_plan` (and related) via `campaignPlanStore` (e.g. `saveStructuredCampaignPlan`, `saveAiCampaignPlan`). So **AI Chat does not update campaign_versions during planning.**

### Is planning context stored inside campaign_snapshot or campaign_versions?

**Planning context is stored inside campaign_snapshot**, which lives on the **campaign_versions** row. So effectively: **planning context is stored in `campaign_versions.campaign_snapshot`** (e.g. `planning_context`, `source_strategic_theme`, `target_regions`, `context_payload`). The `campaign_versions` table has a column `campaign_snapshot` (JSONB); that JSON holds planning context and other snapshot data.

- **File references:**  
  - Snapshot shape at creation: `pages/api/campaigns/index.ts` (snapshotPayload with planning_context, etc.).  
  - Snapshot read for prefilled planning / recommendation context: `pages/api/campaigns/index.ts` GET branch (e.g. versionRow.campaign_snapshot, lines 479–511).  
  - Schema: `database/campaign-versions.sql` — `campaign_snapshot JSONB NOT NULL`.

---

## 5. UI Stability Audit (Layout Shift Check)

### TrendCampaignsTab.tsx — Execution Configuration collapse/expand

**Relevant structure:** The Execution Configuration block is a single container that toggles between (1) collapsed: header + one-line summary, (2) expanded: header + full grid. No fixed height; height depends on `executionCollapsed`.

**Exact JSX structure around Execution Configuration block (components/recommendations/tabs/TrendCampaignsTab.tsx):**

```tsx
</div>   {/* end mode indicator */}
<div className="border rounded-xl p-4 space-y-4 bg-muted/20">
  <div className="flex justify-between items-center">
    <h3 className="text-sm font-semibold">Execution Configuration</h3>
    {executionCollapsed ? (
      <Button variant="ghost" size="sm" onClick={() => setExecutionCollapsed(false)}>Edit</Button>
    ) : (
      <Button variant="ghost" size="sm" onClick={() => setExecutionCollapsed(true)} className="text-muted-foreground">Collapse</Button>
    )}
  </div>
  {executionCollapsed && (
    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
      {/* summary spans */}
    </div>
  )}
  {!executionCollapsed && (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {/* full grid of controls */}
    </div>
  )}
</div>
<StrategicAspectSelector ... />
<OfferingFacetSelector ... />
{/* ... campaign focus, StrategicConsole, regions, intent summary, Generate button ... */}
<div id="recommendation-cards" ref={cardsSectionRef}>
  {/* theme cards / recommendation grid */}
</div>
```

**Does collapse/expand cause layout shift of strategic selectors?**

**Yes.** The Execution Configuration block sits directly above `StrategicAspectSelector`. When `executionCollapsed` flips, the block height changes (summary line vs full grid). Because the container has no fixed height, **StrategicAspectSelector and everything below it move vertically** (layout shift).

**Theme cards / recommendation grid?**

**Yes.** They are below the selectors and the Generate button, so they also move when the Execution Configuration height changes.

**Collapse: reduces height smoothly or causes jump?**

**Causes a discrete jump.** State change is immediate; there is no CSS transition or animation on the Execution Configuration block. Collapsing removes the grid and shows the summary line, so height decreases in one reflow; expanding does the opposite. So it’s a **jump**, not a smooth animated height change.

**Does height change affect surrounding components?**

**Yes.** All following siblings (StrategicAspectSelector, OfferingFacetSelector, campaign focus section, StrategicConsole, regions, intent summary, Generate button, recommendation-cards area) are in normal flow, so they shift up when collapsing and down when expanding.

**Suggestion: fixed-height container or animation lock?**

- **Fixed-height container:** Giving the Execution Configuration block a fixed min-height (e.g. matching the expanded height) would prevent shift when collapsing but would leave empty space when collapsed.  
- **Animation lock:** Using a fixed height for the expanded state and animating height (e.g. CSS transition or a small animation) on collapse/expand would reduce perceived jump.  
- **Reserve space:** Alternatively, keep the collapsed summary inside a container with a minimum height so that the difference between collapsed and expanded is smaller and shift is reduced.

So: **layout shift is confirmed; no fixed height or animation is currently applied; a fixed-height container or height animation would improve stability.**

---

## 6. Final Summary Table

| Event | Campaign Created? | Snapshot Created? | AI Chat Started? | Persisted? |
|-------|-------------------|-------------------|------------------|------------|
| **Click Build Blueprint** | Yes (if not already created at Generate Themes). Either POST /api/campaigns creates campaign + first campaign_versions row with campaign_snapshot, or PUT source-recommendation updates existing snapshot. | Yes (at campaign creation) or Updated (PUT source-recommendation merges card into existing snapshot). | No. User is still on recommendations; redirect happens after. | Yes. Campaign row and campaign_versions row (or update) are persisted before redirect. |
| **Open AI Chat** | No new campaign. Campaign already exists; user is on campaign-details page. | No new snapshot. Snapshot already exists. | Yes. User opens AI Chat on campaign-details; CampaignAIChat mounts with campaignId=campaign.id. | N/A (no new persistence at “open chat”). |
| **First AI answer** | No. | No. AI plan API writes to twelve_week_plan (campaignPlanStore), not to campaign_versions.campaign_snapshot. | Yes (chat is open and used). | Partially. AI output is persisted to twelve_week_plan (and related), not to campaign_snapshot. |
| **Weekly plan generation** | Only if create-12week-plan creates a new campaign (campaign didn’t exist). | New campaign_versions row with campaign_snapshot only when create-12week-plan creates the campaign. Otherwise weekly plan goes to twelve_week_plan. | Can be part of same flow (user confirming plan). | Yes for twelve_week_plan; campaign_snapshot only if new campaign created in that flow. |
| **Final confirmation** | No. | approve-strategy can create a **new** campaign_versions row (version+1) with same campaign_snapshot; it does not add weekly_plan to snapshot in the audited code. | No (confirmation is outside chat). | Yes for versioning (new row); snapshot content in audited flow is copied, not extended with weekly_plan in this step. |

---

**End of audit. No code was modified.**
