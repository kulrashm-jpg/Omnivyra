# PHASE 1 — Execution Configuration (UX Compact) — Implementation Report

**File:** `components/recommendations/tabs/TrendCampaignsTab.tsx`  
**Objective:** Add a compact, mandatory Execution Configuration bar at the top of the tab with 2-row responsive grid, validation before theme generation, `execution_config` injection into `strategicPayload`, and collapse-to-summary behavior. No AI Chat or backend changes.

---

## 1. Summary

- **Execution Configuration** bar added above strategic selectors and theme generation button.
- Uses existing UI: `Button` and `Input` from `@/components/ui`; ToggleGroup/Select/Checkbox/Popover/Calendar implemented inline with native HTML and compact styling (shadcn equivalents not present in the project).
- **Validation:** All seven fields required; "Generate Strategic Themes" is disabled until valid; explicit validation message on click if incomplete.
- **Payload:** `execution_config` is injected into `StrategicPayload` when valid; backend is not modified.
- **Collapse:** Summary bar when collapsed; "Edit" expands; "Collapse" when expanded; auto-collapse after successful theme generation.

---

## 2. TypeScript / Type Changes

### 2.1 New type and StrategicPayload extension

**New type (exported):**

```ts
export type ExecutionConfig = {
  target_audience: string;
  professional_segment: string | null;
  communication_style: string[];
  content_depth: string;
  content_capacity: string;
  campaign_duration: number;
  tentative_start: string | undefined;
  campaign_goal: string;
};
```

**StrategicPayload extension:**

```diff
  mapped_core_types?: string[];
+ /** Execution configuration from compact bar (Phase 1 UX). */
+ execution_config?: ExecutionConfig;
};
```

---

## 3. Imports Added

```ts
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
```

**Note:** ToggleGroup, Select, Checkbox, Popover, Calendar from shadcn were not present in the project. The bar uses native `<button>`, `<select>`, `<input type="checkbox">`, and an inline date popover with `<input type="date">` to match behavior and keep layout compact without adding new component files.

---

## 4. State Added

```ts
const [executionCollapsed, setExecutionCollapsed] = useState(false);
const [targetAudience, setTargetAudience] = useState<string | null>(null);
const [professionalSegment, setProfessionalSegment] = useState<string | null>(null);
const [communicationStyle, setCommunicationStyle] = useState<string[]>([]);
const [contentDepth, setContentDepth] = useState<string | null>(null);
const [contentCapacity, setContentCapacity] = useState<string | null>(null);
const [campaignDurationInput, setCampaignDurationInput] = useState<number>(12);
const [tentativeStartDate, setTentativeStartDate] = useState<Date | undefined>();
const [campaignGoal, setCampaignGoal] = useState<string | null>(null);
const [executionCalendarOpen, setExecutionCalendarOpen] = useState(false);
```

---

## 5. Validation Logic

```ts
const isExecutionValid =
  !!targetAudience &&
  communicationStyle.length > 0 &&
  !!contentDepth &&
  !!contentCapacity &&
  campaignDurationInput >= 4 &&
  !!tentativeStartDate &&
  !!campaignGoal;
```

- **Generate Strategic Themes** button: `disabled={isSubmitting || !isExecutionValid}`.
- **handleRun:** Early return with user-facing error if `!isExecutionValid`:
  - `setValidationError('Complete Execution Configuration (audience, style, depth, capacity, duration, start date, goal) before generating themes.');`

---

## 6. Payload Injection (buildStrategicPayload)

After building the base payload object, the following block appends `execution_config` when all execution fields are valid:

```ts
if (
  targetAudience &&
  communicationStyle.length > 0 &&
  contentDepth &&
  contentCapacity &&
  campaignDurationInput >= 4 &&
  tentativeStartDate &&
  campaignGoal
) {
  base.execution_config = {
    target_audience: targetAudience,
    professional_segment: professionalSegment ?? null,
    communication_style: communicationStyle,
    content_depth: contentDepth,
    content_capacity: contentCapacity,
    campaign_duration: campaignDurationInput,
    tentative_start: tentativeStartDate.toISOString(),
    campaign_goal: campaignGoal,
  };
}
return base;
```

Backend and API request shape are unchanged; the new field is simply sent in `strategicPayload`.

---

## 7. Auto-collapse After Success

On successful theme generation (when `trends.length > 0`), immediately before campaign creation logic:

```ts
setExecutionCollapsed(true);
```

---

## 8. Full JSX Block Added (Execution Configuration Section)

Placed **above** `StrategicAspectSelector` and the rest of the strategic selectors / theme button.

```jsx
<div className="border rounded-xl p-4 space-y-4 bg-muted/20">
  <div className="flex justify-between items-center">
    <h3 className="text-sm font-semibold">Execution Configuration</h3>
    {executionCollapsed ? (
      <Button variant="ghost" size="sm" onClick={() => setExecutionCollapsed(false)}>
        Edit
      </Button>
    ) : (
      <Button variant="ghost" size="sm" onClick={() => setExecutionCollapsed(true)} className="text-muted-foreground">
        Collapse
      </Button>
    )}
  </div>
  {executionCollapsed && (
    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
      <span>{targetAudience ?? '—'}</span>
      <span>{communicationStyle?.length ? communicationStyle.join(', ') : '—'}</span>
      <span>{contentDepth ?? '—'}</span>
      <span>{contentCapacity ?? '—'}</span>
      <span>{campaignDurationInput}w</span>
      <span>{campaignGoal ?? '—'}</span>
      <span>{tentativeStartDate ? tentativeStartDate.toLocaleDateString(undefined, { dateStyle: 'long' }) : '—'}</span>
    </div>
  )}
  {!executionCollapsed && (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
      {/* Row 1: Target Audience (toggle group), Professional Segment (conditional), Campaign Goal, Content Depth */}
      {/* Row 2: Content Capacity (select), Campaign Duration (input number min 4), Start Date (popover + date input), Communication Style (checkboxes, max 2) */}
      …grid content as in file…
    </div>
  )}
</div>
```

- **Layout:** `grid grid-cols-1 md:grid-cols-4 gap-3` — two logical rows on desktop, stacked on small screens.
- **Target Audience:** Single-select buttons: Professionals, Entrepreneurs, Students, SMB, Parents.
- **Professional Segment:** Shown only when Target Audience === "Professionals"; select: Managers, Job Seekers, Founders, Corporate.
- **Campaign Goal:** Single-select: Awareness, Leads, Engagement, Product.
- **Content Depth:** Single-select: Short, Medium, Long.
- **Content Capacity:** Select: 1/w, 2/w, 3/w, 5/w, Daily.
- **Campaign Duration:** Number input, min 4 (enforced in `onChange`).
- **Start Date:** Button opens popover with `<input type="date">` and "Done"; date formatted with `toLocaleDateString(..., { dateStyle: 'long' })` in summary and `dateStyle: 'medium'` in trigger.
- **Communication Style:** Checkboxes (Professional, Conversational, Educational, Inspirational); `onChange` enforces max 2 selections.

---

## 9. Diff-Style Summary of Code Changes

| Location | Change |
|----------|--------|
| **Types** | Added `ExecutionConfig`; added `execution_config?: ExecutionConfig` to `StrategicPayload`. |
| **Imports** | Added `Button`, `Input` from `@/components/ui`. |
| **State** | Added 10 state variables (executionCollapsed, targetAudience, professionalSegment, communicationStyle, contentDepth, contentCapacity, campaignDurationInput, tentativeStartDate, campaignGoal, executionCalendarOpen). |
| **Validation** | Added `isExecutionValid`; in `handleRun` early return + `setValidationError` when `!isExecutionValid`. |
| **Button** | "Generate Strategic Themes" `disabled={isSubmitting || !isExecutionValid}`. |
| **buildStrategicPayload** | Build `base` object; if execution fields valid, set `base.execution_config`; return `base`. |
| **handleRun success** | In `else` branch (trends.length > 0), call `setExecutionCollapsed(true)`. |
| **JSX** | New Execution Configuration block (collapse header, summary when collapsed, 2-row grid when expanded) inserted between mode indicator and `<StrategicAspectSelector>`. |

---

## 10. Layout Height

- Section uses `p-4 space-y-4`, `gap-3`, `text-xs` / `text-sm` labels, and compact controls (`h-9`, small padding).
- **Expanded:** Two rows of controls in a 4-column grid; estimated height on desktop is well under ~250px (roughly ~180–220px depending on wrapping).
- **Collapsed:** One line of summary text + header (~40–50px).

---

## 11. Date Formatting

- `date-fns` is not a project dependency. Used `Date.prototype.toLocaleDateString(undefined, { dateStyle: 'long' })` for summary and `{ dateStyle: 'medium' }` for the trigger button instead of `format(date, 'PPP')`.

---

## 12. Confirmation: Theme Generation Still Works

- **Flow:** User must fill all execution fields → button enables → click runs `handleRun` → `buildStrategicPayload()` includes `execution_config` → same `/api/recommendations/generate` call with `strategicPayload` (now with `execution_config`).
- No backend or API route changes; backend can ignore or store `execution_config` as-is.
- Build failure observed in this repo is from `ActiveLeadsTab.tsx` (Lucide `CheckCircle` `title` prop), not from `TrendCampaignsTab.tsx`. TrendCampaignsTab compiles and has no new linter errors.

---

## 13. Files Touched

- **Modified:** `components/recommendations/tabs/TrendCampaignsTab.tsx` (types, state, validation, payload, JSX, button disable, auto-collapse).
- **Not modified:** AI Chat, backend, `types.ts` (only `TrendCampaignsTab.tsx` uses `ExecutionConfig`; it is exported from the tab file).

---

**End of report.**
