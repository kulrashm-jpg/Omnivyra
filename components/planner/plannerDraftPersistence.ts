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

export async function fetchPlannerDraftState(
  campaignId: string,
): Promise<{ plannerState: PlannerDraftState | null; revision: number } | null> {
  try {
    const res = await fetchWithAuth(
      `/api/campaigns/${encodeURIComponent(campaignId)}/planner-draft-state`,
    );
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data) return null;
    return {
      plannerState:
        data.planner_state && typeof data.planner_state === 'object' ? data.planner_state : null,
      revision: Number(data.revision ?? 0),
    };
  } catch {
    return null;
  }
}

export type SaveDraftResult =
  | { ok: true; conflict: false; revision: number }
  | { ok: false; conflict: true; plannerState: PlannerDraftState | null; revision: number }
  | { ok: false; conflict: false };

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
      return {
        ok: false,
        conflict: true,
        plannerState:
          data?.planner_state && typeof data.planner_state === 'object' ? data.planner_state : null,
        revision: Number(data?.revision ?? 0),
      };
    }
    if (!res.ok) return { ok: false, conflict: false };
    const data = await res.json().catch(() => null);
    return { ok: true, conflict: false, revision: Number(data?.revision ?? baseRevision + 1) };
  } catch {
    return { ok: false, conflict: false }; // offline → retry on next change
  }
}
