# Distribution Strategy Visibility (Final Step)

## Objective

Expose `distribution_strategy` so creators understand scheduling decisions (why posts are staggered, why same-day launches occur). UI-only exposure; no logic changes.

---

## 1. API fields added

### get-weekly-plans

- **Source mapping (blueprint path):** Each week object now includes `distribution_strategy: (w as any).distribution_strategy ?? null`.
- **Response shape:** Each item in the array includes `distribution_strategy` when present (additive; legacy rows have `null`).

### daily-plans

- **Week context:** When a blueprint exists, each plan is enriched with `distribution_strategy` from the matching blueprint week (`week_number`).
- **Response shape:** Each daily plan object may include `distribution_strategy` when the week has it (additive).

### activity-workspace/resolve

- **Payload:** The resolved payload now includes `distribution_strategy` from the activity’s blueprint week when present (additive).

---

## 2. Example payloads

### get-weekly-plans (one week item)

```json
{
  "weekNumber": 2,
  "phase": "Awareness",
  "theme": "Awareness",
  "focusArea": "Drive awareness",
  "contentTypes": ["post", "video"],
  "platform_allocation": { "linkedin": 3, "facebook": 2 },
  "topics_to_cover": ["Problem we solve", "Customer story"],
  "execution_items": [],
  "distribution_strategy": "STAGGERED"
}
```

### daily-plans (one plan item with week context)

```json
{
  "id": "uuid",
  "weekNumber": 2,
  "dayOfWeek": "Tuesday",
  "platform": "linkedin",
  "contentType": "post",
  "title": "Problem we solve",
  "distribution_strategy": "STAGGERED"
}
```

### activity-workspace/resolve response

```json
{
  "workspaceKey": "activity-workspace-<campaignId>-<executionId>",
  "payload": {
    "campaignId": "...",
    "weekNumber": 2,
    "day": "Tuesday",
    "activityId": "...",
    "title": "Problem we solve",
    "distribution_strategy": "STAGGERED"
  }
}
```

---

## 3. Example UI render snippet

### Activity workspace (header subtitle)

Text only; label appended when `distribution_strategy` is present:

```tsx
<p className="text-sm text-gray-600">
  Week {payload.weekNumber || '—'} • {payload.day || '—'} • {payload.title || 'Untitled activity'}
  {(payload as any).distribution_strategy && (
    <> • Distribution: {String((payload as any).distribution_strategy).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}</>
  )}
</p>
```

Rendered examples:

- `Distribution: AI Optimized`
- `Distribution: Staggered`
- `Distribution: Quick Launch`

### Campaign daily plan (week header)

Per-week label under the week title when the week has a strategy:

```tsx
<h2 className="font-semibold text-gray-900">Week {weekNumber}: {theme}</h2>
{distributionStrategy && (
  <p className="text-xs text-gray-500 mt-0.5">
    Distribution: {String(distributionStrategy).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}
  </p>
)}
```

---

## Purpose

Creators can see:

- **Why posts are staggered** when the label shows “Distribution: Staggered”.
- **Why same-day launches occur** when the label shows “Distribution: Quick Launch”.
- **Default behavior** when the label shows “Distribution: AI Optimized”.

This improves trust in the scheduling decisions made by the planning intelligence layer.
