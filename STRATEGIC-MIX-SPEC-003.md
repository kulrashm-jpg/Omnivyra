# STRATEGIC-MIX-SPEC-003 — Content Workspace (R3-P1)

**Status: CANONICAL AMENDMENT to SPEC-001/SPEC-002.** Records the Content
Workspace foundation as implemented in R3-P1. Amendments continue as SPEC-004+.

---

## 1. The Content Workspace

One workspace, three operating scopes, zero new generators. The Content tab in
`/campaign-planner` (between Strategy and Alignment; opens with the skeleton,
soft-gated exactly like Alignment) is where campaign copy is built — manually,
AI-assisted, or fully generated, in any mix, per the user's choice.

- **Scopes:** Campaign (all slots) · Week (one week's slots) · Activity (one
  slot). Every scope supports generate, regenerate, and the selection modes
  `missing` (empty slots only — also "remaining"), `selected` (explicit ids),
  and `all` (with mandatory overwrite confirmation).
- **The workspace orchestrates; it never generates** (SPEC-001 §7.3). Text
  generation is N calls to the EXISTING `/api/planner/generate-workspace-content`
  seam (billed `content_basic` per platform, `generatePlatformVariants`
  operation) whose output — previously discarded by the Activity Workspace
  Drawer — is now captured into planner_state. Asset-family content stays with
  the P2 Library + P3 Assignments (surfaced read-only with an "asset assigned"
  badge; managed in Alignment).

## 2. Content substrate (I-7 honored)

Planning-time copy lives ON the calendar-plan activity as `draft_content`
(`{ body, source: 'manual'|'ai', manually_edited?, ai_operation?, updated_at }`)
plus `content_planning_status`. This extends the ENACTED substrate — activities
already carry copy fields (title/theme/angle/cta) and ride
`planner_state.calendar_plan` through the P1 draft seam wholesale — so
persistence required **no new field, no serialization change, no substrate**.
Legacy activities are byte-identical (fields absent until the workspace acts).
All mutation goes through the pure ops in `lib/campaign/campaignContentModel.ts`
(slot identity = `deriveStructureSlots`, unchanged).

## 3. Planning-only content lifecycle (amends the closed vocabulary, I-11)

`draft → review → approved` — reversible at every step (I-6), content-gated
(review/approved require a body), planning-owned. Execution lifecycle is
untouched: materialized/scheduled/publishing/published/archived remain
execution-owned on Assignments; nothing in execution reads or writes the
planning statuses. Any content mutation (manual edit, regeneration, applied
proposal) returns the item to `draft` — review always targets specific copy.

## 4. AI contract (SPEC-001 §4 upheld)

- **Generation** is explicit invocation; the invoking click IS the apply
  (§4.2). Regenerating over existing content — and always over manually
  edited content — requires explicit confirmation (§4.4); refused otherwise
  (`manual_overwrite_blocked`, never silent).
- **Assist verbs** (`/api/campaign-content/assist`, field-assist template):
  improve · shorten · expand · more_technical · more_executive ·
  more_emotional · alternatives · platform_adapt · audience_adapt ·
  improve_cta · improve_hook · improve_image_prompt. Pure service
  (`campaignContentAssistService`, LLM injected), billed through the existing
  `content_rewrite` action, gateway operation `campaignContentAssist`.
  **Proposal → apply:** the response is candidate copy only; the client
  applies as a distinct act. Honest degradation: shorten/expand fall back
  deterministically; other verbs return empty proposals with a reason —
  never a fake improvement.

## 5. Handoff (I-9 honored)

Finalize passes `draft_content` + `content_planning_status` into the row
content JSON on BOTH slot paths (adapter + inline), additively, with the
placeholder gate intact — the same pattern as the P4 `creator_asset`
passthrough. Rows without workspace content are byte-identical to pre-R3.
**In this phase the execution engine does not yet read `draft_content`** —
content adoption at scheduling/publishing is the designated next phase.

### Change log vs SPEC-001/002
1. Introduces the planning-only content lifecycle vocabulary (§3) — the I-11
   amendment for `content_planning_status`.
2. Names the calendar-plan activity as the planning-time Content substrate
   (SPEC-001 §1 "campaign-scoped drafts"), distinct from Library assets which
   remain Assignment-linked only (I-3 unchanged).
3. Extends the finalize content-JSON passthrough set (SPEC-002 §6) with
   `draft_content`/`content_planning_status`.

*STRATEGIC-MIX-SPEC-003 · records implemented behavior only.*
