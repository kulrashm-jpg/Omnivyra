/**
 * Strategic Mix R3-P2 — canonical content resolution (SPEC-003 §5 → SPEC-004).
 *
 * ONE pure function decides whether a plan row's content envelope carries
 * Content-Workspace copy that execution should publish INSTEAD of generating.
 * Both text-lane consumers (processBlockSchedule and
 * generateContentForDailyPlans) call this — the resolution order lives in
 * exactly one place, mirroring how creator_asset has one override seam.
 *
 * Resolution order (R3-P2.1 contract — Release 3 freeze semantics):
 *   1. APPROVED workspace content  → adopt (the ONLY adoption tier)
 *   2. existing AI generation      → caller proceeds exactly as today
 *   3. existing fallback behaviour → caller proceeds exactly as today
 *
 * Review and Draft are PLANNING states only — never execution candidates.
 * "Review" universally means "not yet approved" to marketing teams; the
 * label and the execution consequence must agree (R3 Product Audit,
 * critical issue #1). No exception paths, no hidden policy.
 *
 * Ownership: this module READS planner-owned fields (draft_content,
 * content_planning_status) and never writes anything. Execution-owned
 * lifecycle is untouched.
 */

export type WorkspaceAdoptionTier = 'approved';

export interface WorkspaceContentResolution {
  /** True when workspace copy is the canonical publishing source. */
  adopted: boolean;
  /** The exact body to publish (verbatim from the workspace) when adopted. */
  body: string | null;
  /** Which lifecycle tier granted adoption (only 'approved' can). */
  tier: WorkspaceAdoptionTier | null;
  reason:
    | 'approved'
    | 'review_not_eligible'
    | 'draft_not_eligible'
    | 'no_workspace_content';
}

const NOT_ADOPTED: Omit<WorkspaceContentResolution, 'reason'> = {
  adopted: false,
  body: null,
  tier: null,
};

/**
 * Resolve workspace content from a PARSED daily_content_plans content
 * envelope (or any object carrying the planner-owned fields). Accepts
 * unknown input defensively — malformed envelopes resolve to not-adopted,
 * never throw.
 */
export function resolveWorkspaceContent(parsed: unknown): WorkspaceContentResolution {
  if (!parsed || typeof parsed !== 'object') {
    return { ...NOT_ADOPTED, reason: 'no_workspace_content' };
  }
  const envelope = parsed as { draft_content?: unknown; content_planning_status?: unknown };
  const draft = envelope.draft_content;
  const body =
    draft && typeof draft === 'object' && typeof (draft as { body?: unknown }).body === 'string'
      ? (draft as { body: string }).body.trim()
      : '';
  if (!body) return { ...NOT_ADOPTED, reason: 'no_workspace_content' };

  const status = typeof envelope.content_planning_status === 'string'
    ? envelope.content_planning_status.trim()
    : '';
  if (status === 'approved') return { adopted: true, body, tier: 'approved', reason: 'approved' };
  if (status === 'review') return { ...NOT_ADOPTED, reason: 'review_not_eligible' };
  return { ...NOT_ADOPTED, reason: 'draft_not_eligible' };
}
