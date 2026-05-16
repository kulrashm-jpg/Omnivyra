export const LIFECYCLE_STATES = [
  'detected',
  'triaged',
  'reviewing',
  'qualified',
  'monitoring',
  'outreach_planned',
  'converted',
  'dismissed',
  'archived',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export type OpportunityLifecycleRecord = {
  id: string;
  organization_id: string;
  opportunity_feed_item_id: string;
  state: LifecycleState;
  previous_state: LifecycleState | null;
  reasoning: string | null;
  actor_user_id: string | null;
  is_initial: boolean;
  metadata: Record<string, unknown>;
  transitioned_at: string;
};

/**
 * Deterministic transition allowlist. One-way moves only between terminal
 * groups; any state can be moved back to a non-terminal predecessor as
 * long as the move is on the explicit list. `converted` and `archived` are
 * terminal — they only accept `archived` as a follow-up (so a converted
 * row can be tombstoned but never revived as detected). `dismissed` can be
 * reopened to `triaged` to handle accidental dismissal.
 */
export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  detected: ['triaged', 'dismissed', 'archived'],
  triaged: ['reviewing', 'qualified', 'dismissed', 'archived'],
  reviewing: ['triaged', 'qualified', 'dismissed', 'archived'],
  qualified: ['monitoring', 'outreach_planned', 'reviewing', 'dismissed', 'archived'],
  monitoring: ['qualified', 'outreach_planned', 'converted', 'dismissed', 'archived'],
  outreach_planned: ['monitoring', 'converted', 'dismissed', 'archived'],
  converted: ['archived'],
  dismissed: ['triaged', 'archived'],
  archived: [],
};

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === 'string'
    && (LIFECYCLE_STATES as readonly string[]).includes(value);
}

export type LifecycleTransitionDecision = {
  allowed: boolean;
  reason?: string;
};

export function canTransitionLifecycle(
  from: LifecycleState,
  to: LifecycleState,
): LifecycleTransitionDecision {
  if (from === to) return { allowed: false, reason: 'no_op_same_state' };
  const allowed = (ALLOWED_LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `transition_${from}_to_${to}_not_permitted` };
}
