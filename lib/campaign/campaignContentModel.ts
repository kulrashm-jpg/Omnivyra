/**
 * Strategic Mix R3-P1 — the Content Workspace model (SPEC-001 §3.2; SPEC-002
 * amendment R3).
 *
 * Planning-time content lives ON the calendar-plan activity as a
 * `draft_content` envelope plus a planning-only lifecycle
 * (`content_planning_status`: draft → review → approved). This extends the
 * ENACTED substrate — activities already carry copy fields (title/theme/
 * angle/cta via the Build sub-tab) and ride planner_state through the P1
 * draft seam wholesale, so persistence needs no new field, no new substrate
 * (I-7). Execution lifecycle is untouched: these fields are planning-owned
 * and never read by the scheduler/publisher.
 *
 * Ownership boundaries (I-3):
 *  - The ACTIVITY is the plan-of-record content item (it becomes the
 *    daily_content_plans row whose content JSON carries the copy — the same
 *    place content lives post-finalize today).
 *  - Library assets keep flowing through Assignments only; this module never
 *    touches assignments or asset payloads.
 *
 * Everything here is a PURE function over CalendarPlan-like data. The
 * workspace UI composes these with the existing store action
 * (setCalendarPlan); generation itself happens in EXISTING services — this
 * module only plans targets and applies returned copy (SPEC-001 §7.3: the
 * workspace orchestrates, it never generates).
 */

import { deriveStructureSlots, type StructureSlot } from './campaignAssignments';

/* ── Planning-owned content envelope ── */

export const CONTENT_PLANNING_STATUSES = ['draft', 'review', 'approved'] as const;
export type ContentPlanningStatus = (typeof CONTENT_PLANNING_STATUSES)[number];

export function isContentPlanningStatus(v: unknown): v is ContentPlanningStatus {
  return typeof v === 'string' && (CONTENT_PLANNING_STATUSES as readonly string[]).includes(v);
}

export interface ActivityContentDraft {
  /** Platform-native, ready-to-review copy (the generation seam's variant). */
  body: string;
  /** Who produced the CURRENT body. Manual edits always win over AI. */
  source: 'manual' | 'ai';
  /** Set once a user has edited the body; guards silent AI overwrite (§4.4). */
  manually_edited?: boolean;
  /** The assist/generation operation that produced an AI body (audit only). */
  ai_operation?: string;
  updated_at: string;
}

/** The activity fields this module owns. Kept structurally compatible with
 *  CalendarPlanActivity (the store type) without importing React-side code —
 *  deliberately NO index signature so the store type assigns cleanly; spread
 *  copies preserve whatever extra fields an activity carries. */
export interface ContentBearingActivity {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  day?: string;
  objective?: string;
  draft_content?: ActivityContentDraft | null;
  content_planning_status?: ContentPlanningStatus;
}

export interface ContentPlanLike {
  weeks?: unknown[];
  days?: Array<{ week_number?: number; day?: string; activities?: ContentBearingActivity[] }>;
  activities?: ContentBearingActivity[];
}

/* ── Derived content items (slot + planning content state) ── */

export interface ContentWorkspaceItem {
  slot: StructureSlot;
  /** null when the slot has no draft content yet. */
  draft: ActivityContentDraft | null;
  /** Stored status when content exists; 'draft' is implied on fresh content. */
  status: ContentPlanningStatus;
  has_content: boolean;
  manually_edited: boolean;
}

const cloneDraft = (d: ActivityContentDraft): ActivityContentDraft => ({ ...d });

function readDraft(a: ContentBearingActivity): ActivityContentDraft | null {
  const d = a.draft_content;
  if (!d || typeof d !== 'object' || typeof d.body !== 'string' || !d.body.trim()) return null;
  return d;
}

/**
 * Derive the workspace view: one item per structure slot, in slot order.
 * Deterministic — same plan, same items (identity via deriveStructureSlots).
 */
export function deriveContentItems(plan: ContentPlanLike | null | undefined): ContentWorkspaceItem[] {
  const slots = deriveStructureSlots(plan as Parameters<typeof deriveStructureSlots>[0]);
  const bySlot = new Map<string, ContentBearingActivity>();
  visitActivities(plan, (activity, slotId) => {
    // First writer wins — matches deriveStructureSlots dedupe order.
    if (!bySlot.has(slotId)) bySlot.set(slotId, activity);
  });
  return slots.map((slot) => {
    const activity = bySlot.get(slot.structure_id);
    const draft = activity ? readDraft(activity) : null;
    const status = activity && isContentPlanningStatus(activity.content_planning_status)
      ? activity.content_planning_status
      : 'draft';
    return {
      slot,
      draft,
      status,
      has_content: Boolean(draft),
      manually_edited: Boolean(draft?.manually_edited),
    };
  });
}

/**
 * Walk every activity in the plan (days index first, then the flat list —
 * the exact traversal deriveStructureSlots uses) handing the visitor each
 * activity together with its derived slot id. BOTH copies of a logical
 * activity (days + flat) receive the same slot id, so a mutation applied via
 * this walk keeps the two lists in sync — the store's mergePlanActivities
 * contract.
 */
function visitActivities(
  plan: ContentPlanLike | null | undefined,
  visit: (activity: ContentBearingActivity, slotId: string, list: 'days' | 'flat') => void,
): void {
  if (!plan || typeof plan !== 'object') return;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // Occurrence counters give index-keyed (no execution_id) activities a
  // per-composite-key ordinal that is stable across BOTH lists, unlike the
  // global index deriveStructureSlots embeds. Slot ids from execution_id
  // (the planner-generated norm) match exactly; index-keyed ids match by
  // composite key + occurrence ordinal.
  const keyOf = (a: ContentBearingActivity, fw: number | null, fd: string | null) => {
    const week = num(a.week_number) ?? fw;
    const day = str(a.day) ?? fd;
    return `w${week ?? 0}:${(day ?? 'any').toLowerCase()}:${(str(a.platform) ?? 'any').toLowerCase()}:${(str(a.content_type) ?? 'any').toLowerCase()}`;
  };
  const walk = (
    activities: ContentBearingActivity[] | undefined,
    fw: number | null,
    fd: string | null,
    list: 'days' | 'flat',
    seenPerKey: Map<string, number>,
  ) => {
    for (const activity of Array.isArray(activities) ? activities : []) {
      if (!activity || typeof activity !== 'object') continue;
      const executionId = str(activity.execution_id);
      if (executionId) {
        visit(activity, executionId, list);
        continue;
      }
      const key = keyOf(activity, fw, fd);
      const ordinal = seenPerKey.get(key) ?? 0;
      seenPerKey.set(key, ordinal + 1);
      visit(activity, `${key}#${ordinal}`, list);
    }
  };
  const daysSeen = new Map<string, number>();
  for (const dayEntry of Array.isArray(plan.days) ? plan.days : []) {
    walk(dayEntry?.activities, num(dayEntry?.week_number), str(dayEntry?.day), 'days', daysSeen);
  }
  const flatSeen = new Map<string, number>();
  walk(plan.activities, null, null, 'flat', flatSeen);
}

/** Resolve the target key visitActivities uses for a structure slot id.
 *  execution_id slots map 1:1; index-keyed slot ids (slot:w1:monday:…:N with
 *  a GLOBAL index) are re-derived to the composite+ordinal form. */
function slotMatchKeys(plan: ContentPlanLike | null | undefined, slotId: string): Set<string> {
  if (!slotId.startsWith('slot:')) return new Set([slotId]);
  // Re-derive slots and composite ordinals in one pass so the global-index
  // key maps onto the per-key ordinal used by visitActivities.
  const slots = deriveStructureSlots(plan as Parameters<typeof deriveStructureSlots>[0]);
  const perKeyCount = new Map<string, number>();
  for (const slot of slots) {
    const key = `w${slot.week ?? 0}:${(slot.day ?? 'any').toLowerCase()}:${(slot.platform ?? 'any').toLowerCase()}:${(slot.content_type ?? 'any').toLowerCase()}`;
    const ordinal = perKeyCount.get(key) ?? 0;
    perKeyCount.set(key, ordinal + 1);
    if (slot.structure_id === slotId) return new Set([`${key}#${ordinal}`]);
  }
  return new Set([slotId]);
}

/* ── Mutations (pure — return a NEW plan; unrelated activities untouched) ── */

export interface ContentMutationResult {
  plan: ContentPlanLike;
  changed: boolean;
  reason?: 'not_found' | 'manual_overwrite_blocked' | 'no_content' | 'invalid_status';
}

function mutateSlot(
  plan: ContentPlanLike | null | undefined,
  slotId: string,
  update: (activity: ContentBearingActivity) => ContentBearingActivity,
): ContentMutationResult {
  if (!plan || typeof plan !== 'object') return { plan: plan ?? {}, changed: false, reason: 'not_found' };
  const targets = slotMatchKeys(plan, slotId);
  let changed = false;
  const mapActivities = (
    activities: ContentBearingActivity[] | undefined,
    fw: number | null,
    fd: string | null,
    seenPerKey: Map<string, number>,
  ): ContentBearingActivity[] | undefined => {
    if (!Array.isArray(activities)) return activities;
    return activities.map((activity) => {
      if (!activity || typeof activity !== 'object') return activity;
      const executionId = typeof activity.execution_id === 'string' && activity.execution_id.trim() ? activity.execution_id.trim() : null;
      let id: string;
      if (executionId) {
        id = executionId;
      } else {
        const week = typeof activity.week_number === 'number' && Number.isFinite(activity.week_number) ? activity.week_number : fw;
        const day = typeof activity.day === 'string' && activity.day.trim() ? activity.day.trim() : fd;
        const platform = typeof activity.platform === 'string' && activity.platform.trim() ? activity.platform.trim() : null;
        const contentType = typeof activity.content_type === 'string' && activity.content_type.trim() ? activity.content_type.trim() : null;
        const key = `w${week ?? 0}:${(day ?? 'any').toLowerCase()}:${(platform ?? 'any').toLowerCase()}:${(contentType ?? 'any').toLowerCase()}`;
        const ordinal = seenPerKey.get(key) ?? 0;
        seenPerKey.set(key, ordinal + 1);
        id = `${key}#${ordinal}`;
      }
      if (!targets.has(id)) return activity;
      changed = true;
      return update(activity);
    });
  };
  const daysSeen = new Map<string, number>();
  const next: ContentPlanLike = {
    ...plan,
    ...(Array.isArray(plan.days)
      ? {
          days: plan.days.map((dayEntry) => ({
            ...dayEntry,
            activities: mapActivities(
              dayEntry?.activities,
              typeof dayEntry?.week_number === 'number' ? dayEntry.week_number : null,
              typeof dayEntry?.day === 'string' ? dayEntry.day : null,
              daysSeen,
            ),
          })),
        }
      : {}),
    ...(Array.isArray(plan.activities)
      ? { activities: mapActivities(plan.activities, null, null, new Map()) }
      : {}),
  };
  return changed ? { plan: next, changed } : { plan, changed: false, reason: 'not_found' };
}

/** Apply AI-generated copy. The invoking user action IS the apply (SPEC-001
 *  §4.2) — but regenerating over manually edited copy requires the explicit
 *  overwrite flag (§4.4); otherwise the mutation is refused, never silent. */
export function applyGeneratedContent(
  plan: ContentPlanLike | null | undefined,
  slotId: string,
  body: string,
  opts: { operation?: string; overwriteManual?: boolean; now?: string } = {},
): ContentMutationResult {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) return { plan: plan ?? {}, changed: false, reason: 'no_content' };
  let blocked = false;
  const result = mutateSlot(plan, slotId, (activity) => {
    const existing = readDraft(activity);
    if (existing?.manually_edited && !opts.overwriteManual) {
      blocked = true;
      return activity;
    }
    return {
      ...activity,
      draft_content: {
        body: trimmed,
        source: 'ai' as const,
        ...(opts.operation ? { ai_operation: opts.operation } : {}),
        updated_at: opts.now ?? new Date().toISOString(),
      },
      // New copy always re-enters review from the bottom of the ladder.
      content_planning_status: 'draft' as const,
    };
  });
  if (blocked) return { plan: plan ?? {}, changed: false, reason: 'manual_overwrite_blocked' };
  return result;
}

/** Manual edit — always allowed on planning content; marks the draft as
 *  user-owned and returns the item to 'draft' (review targets specific copy). */
export function applyManualContentEdit(
  plan: ContentPlanLike | null | undefined,
  slotId: string,
  body: string,
  opts: { now?: string } = {},
): ContentMutationResult {
  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (!trimmed) return { plan: plan ?? {}, changed: false, reason: 'no_content' };
  return mutateSlot(plan, slotId, (activity) => ({
    ...activity,
    draft_content: {
      body: trimmed,
      source: 'manual' as const,
      manually_edited: true,
      updated_at: opts.now ?? new Date().toISOString(),
    },
    content_planning_status: 'draft' as const,
  }));
}

/** Remove the planning content from a slot (structure/slot untouched). */
export function removeActivityContent(plan: ContentPlanLike | null | undefined, slotId: string): ContentMutationResult {
  return mutateSlot(plan, slotId, (activity) => {
    const { draft_content: _drop, content_planning_status: _drop2, ...rest } = activity;
    return rest;
  });
}

/** Copy content from one slot to another. The duplicate is a fresh planning
 *  copy: it re-enters at 'draft' and never inherits review state. */
export function duplicateActivityContent(
  plan: ContentPlanLike | null | undefined,
  fromSlotId: string,
  toSlotId: string,
  opts: { now?: string } = {},
): ContentMutationResult {
  const source = deriveContentItems(plan).find((i) => i.slot.structure_id === fromSlotId);
  if (!source?.draft) return { plan: plan ?? {}, changed: false, reason: 'no_content' };
  const draft = cloneDraft(source.draft);
  return mutateSlot(plan, toSlotId, (activity) => ({
    ...activity,
    draft_content: { ...draft, updated_at: opts.now ?? new Date().toISOString() },
    content_planning_status: 'draft' as const,
  }));
}

/** Move content between slots — duplicate to the target, clear the source.
 *  Placement itself stays structure-owned; only the copy travels. */
export function moveActivityContent(
  plan: ContentPlanLike | null | undefined,
  fromSlotId: string,
  toSlotId: string,
  opts: { now?: string } = {},
): ContentMutationResult {
  const copied = duplicateActivityContent(plan, fromSlotId, toSlotId, opts);
  if (!copied.changed) return copied;
  const cleared = removeActivityContent(copied.plan, fromSlotId);
  return cleared.changed ? cleared : copied;
}

/** Planning lifecycle transition. Draft ⇄ Review ⇄ Approved — reversible in
 *  planning (I-6); forward steps require content to exist. Closed vocabulary
 *  (I-11): unknown statuses are rejected, never stored. */
export function setContentPlanningStatus(
  plan: ContentPlanLike | null | undefined,
  slotId: string,
  status: ContentPlanningStatus,
): ContentMutationResult {
  if (!isContentPlanningStatus(status)) return { plan: plan ?? {}, changed: false, reason: 'invalid_status' };
  let missingContent = false;
  const result = mutateSlot(plan, slotId, (activity) => {
    if (status !== 'draft' && !readDraft(activity)) {
      missingContent = true;
      return activity;
    }
    return { ...activity, content_planning_status: status };
  });
  if (missingContent) return { plan: plan ?? {}, changed: false, reason: 'no_content' };
  return result;
}

/* ── Generation scopes (SPEC R3-P1: Campaign / Week / Activity) ── */

export type ContentGenerationScope =
  | { kind: 'campaign' }
  | { kind: 'week'; week: number }
  | { kind: 'activity'; slot_id: string };

export type ContentGenerationMode = 'all' | 'missing' | 'selected';

export interface ContentGenerationTarget {
  slot_id: string;
  week: number | null;
  day: string | null;
  platform: string | null;
  content_type: string | null;
  topic: string | null;
  has_content: boolean;
  manually_edited: boolean;
}

/**
 * Plan WHICH slots a generation run covers. Pure selection — the caller
 * feeds each target to the EXISTING generation endpoint and applies results
 * via applyGeneratedContent. 'missing' covers only empty slots ("generate
 * missing/remaining only"); 'selected' intersects with explicit ids;
 * 'all' includes filled slots — the UI must confirm overwrites for the
 * manually_edited ones it returns (they are flagged, never silently hit).
 * Slots without a platform are never targetable (nothing to generate for).
 */
export function planContentGeneration(
  plan: ContentPlanLike | null | undefined,
  scope: ContentGenerationScope,
  mode: ContentGenerationMode = 'missing',
  selectedIds: readonly string[] = [],
): ContentGenerationTarget[] {
  const selected = new Set(selectedIds);
  return deriveContentItems(plan)
    .filter((item) => {
      if (!item.slot.platform) return false;
      if (scope.kind === 'week' && item.slot.week !== scope.week) return false;
      if (scope.kind === 'activity' && item.slot.structure_id !== scope.slot_id) return false;
      if (mode === 'missing' && item.has_content) return false;
      if (mode === 'selected' && !selected.has(item.slot.structure_id)) return false;
      return true;
    })
    .map((item) => ({
      slot_id: item.slot.structure_id,
      week: item.slot.week,
      day: item.slot.day,
      platform: item.slot.platform,
      content_type: item.slot.content_type,
      topic: item.slot.title,
      has_content: item.has_content,
      manually_edited: item.manually_edited,
    }));
}

/* ── Coverage summary (assist-only readout for the workspace/Board) ── */

export interface ContentCoverageSummary {
  total: number;
  with_content: number;
  empty: number;
  approved: number;
  in_review: number;
  drafts: number;
  weeks: Array<{ week: number | null; total: number; with_content: number; approved: number }>;
}

export function summarizeContentCoverage(plan: ContentPlanLike | null | undefined): ContentCoverageSummary {
  const items = deriveContentItems(plan);
  const byWeek = new Map<number | null, { week: number | null; total: number; with_content: number; approved: number }>();
  let withContent = 0;
  let approved = 0;
  let inReview = 0;
  for (const item of items) {
    const entry = byWeek.get(item.slot.week) ?? { week: item.slot.week, total: 0, with_content: 0, approved: 0 };
    entry.total += 1;
    if (item.has_content) {
      withContent += 1;
      entry.with_content += 1;
      if (item.status === 'approved') { approved += 1; entry.approved += 1; }
      if (item.status === 'review') inReview += 1;
    }
    byWeek.set(item.slot.week, entry);
  }
  return {
    total: items.length,
    with_content: withContent,
    empty: items.length - withContent,
    approved,
    in_review: inReview,
    drafts: withContent - approved - inReview,
    weeks: Array.from(byWeek.values()).sort((a, b) => (a.week ?? 0) - (b.week ?? 0)),
  };
}
