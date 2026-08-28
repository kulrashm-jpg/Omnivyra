/**
 * Strategic Mix P1 — client side of the Draft Campaign persistence foundation
 * (SPEC-001 invariants I-1/I-2: a server Draft Campaign owns planner state
 * from the first moment; browser storage is CACHE ONLY, never canonical).
 *
 * Pure API helpers + the serialized state contract. All React wiring lives in
 * PlannerSessionProvider (plannerSessionStore.ts) so there is exactly one
 * state owner.
 *
 * Conflict model (deterministic): every save carries the last-synced
 * `baseRevision`. A 409 means another tab/device wrote first — the server
 * copy is adopted wholesale (server is the source of truth), then editing
 * continues from the new revision. Last-writer-wins per revision step; the
 * loser never silently overwrites.
 */

import { fetchWithAuth } from '../community-ai/fetchWithAuth';
import { DRAFT_FINALIZED_CODE } from '../../lib/campaign/plannerDraftLifecycle';
import type { PlannerSessionState } from './plannerSessionStore';

/** The persisted subset — deliberately identical to the localStorage cache
 *  payload (minus stored_at) so server and cache never diverge in shape. */
export type PlannerDraftState = Record<string, unknown>;

export function serializePlannerState(s: PlannerSessionState): PlannerDraftState {
  return {
    idea_spine: s.idea_spine,
    strategy_context: s.strategy_context,
    skeleton_confirmed: s.skeleton_confirmed === true,
    strategy_confirmed: s.strategy_confirmed === true,
    campaign_type: s.campaign_type ?? 'TEXT',
    platform_content_requests: s.platform_content_requests ?? null,
    plan_snapshot_hash: s.plan_snapshot_hash ?? null,
    campaign_structure: s.campaign_structure ?? null,
    calendar_plan: s.calendar_plan ?? null,
    company_context_mode: s.company_context_mode ?? 'full_company_context',
    focus_modules: s.focus_modules ?? [],
    strategic_themes: s.strategic_themes ?? [],
    strategic_card: s.strategic_card ?? null,
    // Strategic Mix P3 — Assignment owns every structure↔content link; the
    // array persists through this same canonical seam (no new substrate, I-7).
    assignments: s.assignments ?? [],
  };
}

export async function createOrResumePlannerDraft(
  companyId: string,
): Promise<{ campaignId: string; resumed: boolean } | null> {
  try {
    const res = await fetchWithAuth('/api/campaigns/planner-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.campaign_id
      ? { campaignId: String(data.campaign_id), resumed: data.resumed === true }
      : null;
  } catch {
    return null; // network failure → planner keeps working on the local cache
  }
}

/**
 * BLOCK-1 — the probe result for a candidate draft id.
 *
 * `finalized` is a LIFECYCLE verdict from the server (409 DRAFT_FINALIZED).
 * A `null` return is the absence of a verdict — the request itself failed —
 * and callers must not treat it as evidence either way.
 */
export interface PlannerDraftStateResult {
  plannerState: PlannerDraftState | null;
  revision: number;
  /** The campaign is at or past the execution handoff; it is not a draft. */
  finalized: boolean;
}

export async function fetchPlannerDraftState(
  campaignId: string,
): Promise<PlannerDraftStateResult | null> {
  try {
    const res = await fetchWithAuth(
      `/api/campaigns/${encodeURIComponent(campaignId)}/planner-draft-state`,
    );
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      if (data?.code === DRAFT_FINALIZED_CODE) {
        return { plannerState: null, revision: 0, finalized: true };
      }
      return null; // an unrecognised 409 is not a lifecycle verdict
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    return {
      plannerState:
        data.planner_state && typeof data.planner_state === 'object' ? data.planner_state : null,
      revision: Number(data.revision ?? 0),
      finalized: false,
    };
  } catch {
    return null;
  }
}

export type SaveDraftResult =
  | { ok: true; conflict: false; revision: number }
  | { ok: false; conflict: true; plannerState: PlannerDraftState | null; revision: number }
  /** BLOCK-1: `finalized` separates "this campaign is no longer a draft" from
   *  an ordinary transient failure. The former is terminal for the session;
   *  the latter is retried on the next state change. */
  | { ok: false; conflict: false; finalized: boolean };

/* ── R2-P5: Draft Status indicator (SPEC-001 §6.2 "Always saved") ─────────
 * A pure reducer over the EXISTING persistence lifecycle's events — the
 * provider emits what already happens (debounce armed, PUT resolved,
 * conflict adopted, bootstrap hydrating); no second persistence tracker.
 */

export type DraftSaveStatus = 'saving' | 'saved' | 'syncing' | 'sync_failed' | 'offline';

export type DraftSaveEvent =
  | 'bootstrap_start' // draft create-or-resume + server hydrate began
  | 'bootstrap_done'  // server state adopted (or fresh draft ready)
  | 'dirty'           // local edit — autosave debounce armed
  | 'save_ok'         // PUT stored, revision advanced
  | 'save_conflict'   // 409 — server copy adopted (deterministic winner)
  | 'save_failed';    // transient/offline failure — retried on next change

export function nextDraftSaveStatus(
  _current: DraftSaveStatus,
  event: DraftSaveEvent,
  online: boolean = true,
): DraftSaveStatus {
  switch (event) {
    case 'bootstrap_start':
      return online ? 'syncing' : 'offline';
    case 'bootstrap_done':
      return 'saved';
    case 'dirty':
      return online ? 'saving' : 'offline';
    case 'save_ok':
      return 'saved';
    case 'save_conflict':
      // The server copy won and was adopted — the session is in sync.
      return 'saved';
    case 'save_failed':
      return online ? 'sync_failed' : 'offline';
    default:
      return _current;
  }
}

export async function savePlannerDraftState(
  campaignId: string,
  plannerState: PlannerDraftState,
  baseRevision: number,
): Promise<SaveDraftResult> {
  try {
    const res = await fetchWithAuth(
      `/api/campaigns/${encodeURIComponent(campaignId)}/planner-draft-state`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planner_state: plannerState, baseRevision }),
      },
    );
    if (res.status === 409) {
      const data = await res.json().catch(() => null);
      // Two distinct 409s share this route. DRAFT_FINALIZED is a lifecycle
      // verdict — the campaign left draft space, so there is nothing to adopt
      // and nothing to retry. Anything else is the stale-revision conflict,
      // whose server copy must be adopted.
      if (data?.code === DRAFT_FINALIZED_CODE) {
        return { ok: false, conflict: false, finalized: true };
      }
      return {
        ok: false,
        conflict: true,
        plannerState:
          data?.planner_state && typeof data.planner_state === 'object' ? data.planner_state : null,
        revision: Number(data?.revision ?? 0),
      };
    }
    if (!res.ok) return { ok: false, conflict: false, finalized: false };
    const data = await res.json().catch(() => null);
    return { ok: true, conflict: false, revision: Number(data?.revision ?? baseRevision + 1) };
  } catch {
    return { ok: false, conflict: false, finalized: false }; // offline → retry on next change
  }
}
