/**
 * Strategic Mix P3 — the Assignment layer (SPEC-001: Assignment owns EVERY
 * structure↔content relationship).
 *
 * Canonical model:
 *   Campaign ── Structure (publishing opportunities, from the calendar plan)
 *            ── Content   (Asset Library — creator_assets, P2)
 *            └─ Assignment (THE only editable relationship between the two)
 *
 * An assignment references a campaign, a structure slot, and an asset — it
 * never embeds asset payloads (no duplicated asset state) and never embeds
 * structure (no duplicated structure state). Deleting an assignment removes a
 * RELATIONSHIP only; the asset lives on in the library, and one asset may be
 * referenced by any number of assignments (reuse is the point).
 *
 * Everything here is a PURE function over `CampaignAssignment[]` — the array
 * itself lives in planner_state.assignments and persists exclusively through
 * the canonical planning persistence seam (planner-draft-state PUT with
 * revision-checked conflicts, P1). No new persistence substrate (I-7).
 */

/* ── Structure slots (derived, never stored — structure stays single-owner) ── */

export interface StructureSlot {
  /** Stable slot identity: the activity's execution_id when present, else a
   *  deterministic week/day/platform/type key. */
  structure_id: string;
  week: number | null;
  day: string | null;
  platform: string | null;
  content_type: string | null;
  /** Display context from the structure (activity title/theme) — read-only. */
  title: string | null;
}

interface CalendarActivityLike {
  execution_id?: string;
  week_number?: number;
  platform?: string;
  content_type?: string;
  title?: string;
  theme?: string;
  day?: string;
}

interface CalendarPlanLike {
  days?: Array<{ week_number?: number; day?: string; activities?: CalendarActivityLike[] }>;
  activities?: CalendarActivityLike[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function slotFromActivity(
  a: CalendarActivityLike,
  fallbackWeek: number | null,
  fallbackDay: string | null,
  index: number,
): StructureSlot {
  const week = num(a.week_number) ?? fallbackWeek;
  const day = str(a.day) ?? fallbackDay;
  const platform = str(a.platform);
  const contentType = str(a.content_type);
  const structureId =
    str(a.execution_id) ??
    `slot:w${week ?? 0}:${(day ?? 'any').toLowerCase()}:${(platform ?? 'any').toLowerCase()}:${(contentType ?? 'any').toLowerCase()}:${index}`;
  return {
    structure_id: structureId,
    week,
    day,
    platform,
    content_type: contentType,
    title: str(a.title) ?? str(a.theme),
  };
}

/**
 * Derive the campaign's publishing opportunities from the calendar plan.
 * Structure DEFINES slots; it never creates or owns assets. Deterministic:
 * the same plan always yields the same slot ids, so assignments stay attached
 * across planner reloads.
 */
export function deriveStructureSlots(calendarPlan: CalendarPlanLike | null | undefined): StructureSlot[] {
  if (!calendarPlan || typeof calendarPlan !== 'object') return [];
  const slots: StructureSlot[] = [];
  const seen = new Set<string>();
  let index = 0;
  const push = (slot: StructureSlot) => {
    if (seen.has(slot.structure_id)) return;
    seen.add(slot.structure_id);
    slots.push(slot);
  };
  for (const dayEntry of Array.isArray(calendarPlan.days) ? calendarPlan.days : []) {
    const week = num(dayEntry?.week_number);
    const day = str(dayEntry?.day);
    for (const activity of Array.isArray(dayEntry?.activities) ? dayEntry.activities : []) {
      push(slotFromActivity(activity, week, day, index));
      index += 1;
    }
  }
  // Flat activity lists (older plans) — same derivation, same determinism.
  for (const activity of Array.isArray(calendarPlan.activities) ? calendarPlan.activities : []) {
    push(slotFromActivity(activity, null, null, index));
    index += 1;
  }
  return slots;
}

/* ── The Assignment entity ── */

/**
 * P4 lifecycle: draft → ready → confirmed → materialized → scheduled →
 * publishing → published → archived. The first three are PLANNING states
 * (fully editable); 'confirmed' is the handoff gate — only confirmed
 * assignments materialize into execution. From 'materialized' onward the
 * item is in a PROTECTED execution state and becomes immutable (per-item
 * lock — deterministic, purely a function of status; there is no
 * blueprint-wide freeze at this layer).
 */
export type AssignmentStatus =
  | 'draft'
  | 'ready'
  | 'confirmed'
  | 'materialized'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'archived';

export const ASSIGNMENT_LIFECYCLE: readonly AssignmentStatus[] = [
  'draft',
  'ready',
  'confirmed',
  'materialized',
  'scheduled',
  'publishing',
  'published',
  'archived',
];

/** Planning states — the user may set these freely via metadata edits. */
export const PLANNING_STATUSES: readonly AssignmentStatus[] = ['draft', 'ready', 'confirmed'];

/** Protected execution states — per-item lock (SPEC-001: planning stays
 *  editable until execution begins; only items IN execution freeze). */
export const LOCKED_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'materialized',
  'scheduled',
  'publishing',
  'published',
  'archived',
];

export function isAssignmentLocked(a: Pick<CampaignAssignment, 'status'>): boolean {
  return LOCKED_ASSIGNMENT_STATUSES.includes(a.status);
}

export interface CampaignAssignment {
  id: string;
  /** The owning campaign (draft or existing). Kept ON the entity so the layer
   *  can later graduate to its own table without a data reshape. */
  campaign_id: string | null;
  /** Content reference — the Asset Library id (P2). Never a payload. */
  asset_id: string;
  /** Optional version pin; null = follow the asset's current version. */
  asset_version: number | null;
  /** Structure reference — the slot this assignment fills. */
  structure_id: string;
  week: number | null;
  day: string | null;
  platform: string | null;
  content_type: string | null;
  /** Publication slot within the opportunity (e.g. 'primary', 'story'). */
  slot: string | null;
  status: AssignmentStatus;
  notes: string;
  /** Position among the slot's assignments (0-based, dense). */
  ordering: number;
  created_at: string;
  updated_at: string;
}

/** Injectable id/clock so every operation is testable + replay-safe. */
export interface AssignmentOpContext {
  now?: string;
  mintId?: () => string;
}

function nowOf(ctx?: AssignmentOpContext): string {
  return ctx?.now ?? new Date().toISOString();
}

function mintAssignmentId(ctx?: AssignmentOpContext): string {
  if (ctx?.mintId) return ctx.mintId();
  return `asg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const VALID_STATUS: readonly AssignmentStatus[] = ASSIGNMENT_LIFECYCLE;

/** Defensive parse for assignments arriving from persisted planner state
 *  (server snapshot or localStorage cache). Unknown shapes are dropped, never
 *  thrown on — a bad cache must not take the planner down. */
export function normalizeAssignments(raw: unknown): CampaignAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: CampaignAssignment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    const assetId = str(r.asset_id);
    const structureId = str(r.structure_id);
    if (!id || !assetId || !structureId) continue;
    out.push({
      id,
      campaign_id: str(r.campaign_id),
      asset_id: assetId,
      asset_version: num(r.asset_version),
      structure_id: structureId,
      week: num(r.week),
      day: str(r.day),
      platform: str(r.platform),
      content_type: str(r.content_type),
      slot: str(r.slot),
      status: VALID_STATUS.includes(r.status as AssignmentStatus) ? (r.status as AssignmentStatus) : 'draft',
      notes: typeof r.notes === 'string' ? r.notes : '',
      ordering: num(r.ordering) ?? 0,
      created_at: str(r.created_at) ?? new Date(0).toISOString(),
      updated_at: str(r.updated_at) ?? str(r.created_at) ?? new Date(0).toISOString(),
    });
  }
  return out;
}

/* ── Queries ── */

export function assignmentsForSlot(list: CampaignAssignment[], structureId: string): CampaignAssignment[] {
  return list.filter((a) => a.structure_id === structureId).sort((a, b) => a.ordering - b.ordering);
}

export function assignmentsForAsset(list: CampaignAssignment[], assetId: string): CampaignAssignment[] {
  return list.filter((a) => a.asset_id === assetId);
}

function nextOrdering(list: CampaignAssignment[], structureId: string): number {
  const peers = list.filter((a) => a.structure_id === structureId);
  return peers.length === 0 ? 0 : Math.max(...peers.map((a) => a.ordering)) + 1;
}

/* ── Operations (each returns a NEW array; input is never mutated) ── */

export interface AssignAssetInput {
  campaignId: string | null;
  assetId: string;
  assetVersion?: number | null;
  slot: StructureSlot;
  publicationSlot?: string | null;
  status?: AssignmentStatus;
  notes?: string;
}

/** Assign an asset to a structure slot. The asset may already be assigned
 *  elsewhere — reuse never duplicates the asset. */
export function assignAsset(
  list: CampaignAssignment[],
  input: AssignAssetInput,
  ctx?: AssignmentOpContext,
): { assignments: CampaignAssignment[]; assignment: CampaignAssignment } {
  const now = nowOf(ctx);
  const assignment: CampaignAssignment = {
    id: mintAssignmentId(ctx),
    campaign_id: input.campaignId ?? null,
    asset_id: input.assetId,
    asset_version: input.assetVersion ?? null,
    structure_id: input.slot.structure_id,
    week: input.slot.week,
    day: input.slot.day,
    platform: input.slot.platform,
    content_type: input.slot.content_type,
    slot: input.publicationSlot ?? null,
    status: input.status ?? 'draft',
    notes: input.notes ?? '',
    ordering: nextOrdering(list, input.slot.structure_id),
    created_at: now,
    updated_at: now,
  };
  return { assignments: [...list, assignment], assignment };
}

/** Bulk assign — one asset to many slots, or many assets to one slot. */
export function bulkAssign(
  list: CampaignAssignment[],
  inputs: AssignAssetInput[],
  ctx?: AssignmentOpContext,
): CampaignAssignment[] {
  let next = list;
  for (const input of inputs) next = assignAsset(next, input, ctx).assignments;
  return next;
}

/** Remove a relationship. The ASSET IS NEVER DELETED — it stays in the
 *  library and in every other assignment that references it. Locked items
 *  (in protected execution states) are kept — detaching them would desync
 *  planning from live execution. */
export function unassignAssignment(list: CampaignAssignment[], assignmentId: string): CampaignAssignment[] {
  return list.filter((a) => a.id !== assignmentId || isAssignmentLocked(a));
}

export function bulkUnassign(list: CampaignAssignment[], assignmentIds: string[]): CampaignAssignment[] {
  const drop = new Set(assignmentIds);
  return list.filter((a) => !drop.has(a.id) || isAssignmentLocked(a));
}

/** Move an assignment to a different structure slot (same identity, new
 *  placement — history/notes/status travel with it). Locked items don't move. */
export function moveAssignment(
  list: CampaignAssignment[],
  assignmentId: string,
  targetSlot: StructureSlot,
  ctx?: AssignmentOpContext,
): CampaignAssignment[] {
  const ordering = nextOrdering(list, targetSlot.structure_id);
  return list.map((a) =>
    a.id === assignmentId && !isAssignmentLocked(a)
      ? {
          ...a,
          structure_id: targetSlot.structure_id,
          week: targetSlot.week,
          day: targetSlot.day,
          platform: targetSlot.platform,
          content_type: targetSlot.content_type,
          ordering,
          updated_at: nowOf(ctx),
        }
      : a,
  );
}

/** Duplicate an assignment (same asset, new relationship) — optionally onto a
 *  different slot. The asset itself is REUSED, never copied. */
export function duplicateAssignment(
  list: CampaignAssignment[],
  assignmentId: string,
  targetSlot?: StructureSlot,
  ctx?: AssignmentOpContext,
): { assignments: CampaignAssignment[]; assignment: CampaignAssignment | null } {
  const source = list.find((a) => a.id === assignmentId);
  if (!source) return { assignments: list, assignment: null };
  const now = nowOf(ctx);
  const placement = targetSlot ?? {
    structure_id: source.structure_id,
    week: source.week,
    day: source.day,
    platform: source.platform,
    content_type: source.content_type,
    title: null,
  };
  const copy: CampaignAssignment = {
    ...source,
    id: mintAssignmentId(ctx),
    structure_id: placement.structure_id,
    week: placement.week,
    day: placement.day,
    platform: placement.platform,
    content_type: placement.content_type,
    ordering: nextOrdering(list, placement.structure_id),
    // A duplicate is a NEW planning relationship — it never inherits a
    // protected execution state from its source.
    status: PLANNING_STATUSES.includes(source.status) ? source.status : 'draft',
    created_at: now,
    updated_at: now,
  };
  return { assignments: [...list, copy], assignment: copy };
}

/** Replace the CONTENT of an assignment (new asset, same placement).
 *  Locked items keep their materialized content. */
export function replaceAssignmentAsset(
  list: CampaignAssignment[],
  assignmentId: string,
  newAssetId: string,
  newAssetVersion?: number | null,
  ctx?: AssignmentOpContext,
): CampaignAssignment[] {
  return list.map((a) =>
    a.id === assignmentId && !isAssignmentLocked(a)
      ? { ...a, asset_id: newAssetId, asset_version: newAssetVersion ?? null, updated_at: nowOf(ctx) }
      : a,
  );
}

/** Reorder a slot's assignments to the given id order (dense, 0-based).
 *  Ids not listed keep their relative order after the listed ones. A slot
 *  containing a locked assignment does not reorder (its materialized order
 *  is part of the execution handoff). */
export function reorderAssignments(
  list: CampaignAssignment[],
  structureId: string,
  orderedIds: string[],
  ctx?: AssignmentOpContext,
): CampaignAssignment[] {
  const slotItems = assignmentsForSlot(list, structureId);
  if (slotItems.some((a) => isAssignmentLocked(a))) return list;
  const rank = new Map<string, number>();
  orderedIds.forEach((id, i) => rank.set(id, i));
  const sorted = [...slotItems].sort((a, b) => {
    const ra = rank.has(a.id) ? (rank.get(a.id) as number) : orderedIds.length + a.ordering;
    const rb = rank.has(b.id) ? (rank.get(b.id) as number) : orderedIds.length + b.ordering;
    return ra - rb;
  });
  const newOrdering = new Map<string, number>();
  sorted.forEach((a, i) => newOrdering.set(a.id, i));
  const now = nowOf(ctx);
  return list.map((a) =>
    newOrdering.has(a.id) && newOrdering.get(a.id) !== a.ordering
      ? { ...a, ordering: newOrdering.get(a.id) as number, updated_at: now }
      : a,
  );
}

/** Editable assignment metadata — a whitelist patch (placement and content
 *  changes go through move/replace so every mutation stays intentional). */
export interface AssignmentMetadataPatch {
  status?: AssignmentStatus;
  notes?: string;
  slot?: string | null;
}

export function updateAssignmentMetadata(
  list: CampaignAssignment[],
  assignmentId: string,
  patch: AssignmentMetadataPatch,
  ctx?: AssignmentOpContext,
): CampaignAssignment[] {
  return list.map((a) => {
    if (a.id !== assignmentId || isAssignmentLocked(a)) return a;
    const next = { ...a, updated_at: nowOf(ctx) };
    // Users may only set PLANNING statuses here; execution states are
    // reached exclusively through advanceAssignmentStatus (the lifecycle).
    if (patch.status && PLANNING_STATUSES.includes(patch.status)) next.status = patch.status;
    if (typeof patch.notes === 'string') next.notes = patch.notes;
    if (patch.slot !== undefined) next.slot = str(patch.slot);
    return next;
  });
}

/**
 * Advance an assignment along the lifecycle (draft → … → archived).
 * FORWARD-ONLY and deterministic: a backward or unknown transition is a
 * no-op. This is the sole doorway into (and through) the protected
 * execution states — the lock never blocks the lifecycle itself.
 */
export function advanceAssignmentStatus(
  list: CampaignAssignment[],
  assignmentIds: string | string[],
  next: AssignmentStatus,
  ctx?: AssignmentOpContext,
): CampaignAssignment[] {
  const ids = new Set(Array.isArray(assignmentIds) ? assignmentIds : [assignmentIds]);
  const nextRank = ASSIGNMENT_LIFECYCLE.indexOf(next);
  if (nextRank < 0) return list;
  const now = nowOf(ctx);
  return list.map((a) => {
    if (!ids.has(a.id)) return a;
    const currentRank = ASSIGNMENT_LIFECYCLE.indexOf(a.status);
    if (nextRank <= currentRank) return a; // forward-only
    return { ...a, status: next, updated_at: now };
  });
}
