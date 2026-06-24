/**
 * customerActivationOperationsService.ts
 *
 * OPERATIONAL execution tracking (Phase 20) — not analytics/intelligence. Combines the
 * mechanical Activation Workbench rows with the persisted outreach workflow state and the
 * activity log into a per-customer progress tracker, and validates state transitions for the
 * write path. Pure compute over injected inputs; persistence lives in the API.
 */

import {
  buildRow,
  REQUIRED_MILESTONES,
  type CustomerActivationInput,
  type CustomerActivationRow,
  type MilestoneKey,
} from './customerActivationWorkbenchService';

export type OutreachState =
  | 'NOT_CONTACTED'
  | 'CONTACTED'
  | 'CUSTOMER_RESPONDED'
  | 'IN_PROGRESS'
  | 'ACTIVATED';

export const OUTREACH_STATES: OutreachState[] = [
  'NOT_CONTACTED', 'CONTACTED', 'CUSTOMER_RESPONDED', 'IN_PROGRESS', 'ACTIVATED',
];

export function isOutreachState(v: unknown): v is OutreachState {
  return typeof v === 'string' && (OUTREACH_STATES as string[]).includes(v);
}

export interface OutreachRecord {
  company_id: string;
  current_state: OutreachState;
  last_activity_date: string | null;
}

export interface ActivityLogEntry {
  id?: string;
  company_id: string;
  activity_type: string;
  activity_date: string;
  owner: string | null;
  notes: string | null;
  status: string | null;
}

export interface ActivationOperationRow {
  company_id: string;
  company_name: string;
  current_state: OutreachState;
  completed_milestones: MilestoneKey[];
  remaining_milestones: MilestoneKey[];
  activation_percent: number;
  last_activity_date: string | null;
  /** ACTIVATED is the derived truth when all milestones are complete, regardless of the
   *  operator-set workflow state (which tracks outreach, not milestone completion). */
  is_activated: boolean;
  recent_activity: ActivityLogEntry[];
  milestones: CustomerActivationRow['milestones'];
  action_cards: CustomerActivationRow['action_cards'];
}

/** Pure: assemble the operations tracker for all customers. */
export function buildOperations(
  inputs: CustomerActivationInput[],
  outreach: OutreachRecord[],
  activity: ActivityLogEntry[],
): ActivationOperationRow[] {
  const stateOf = (id: string): OutreachRecord | undefined => outreach.find((o) => o.company_id === id);
  const logOf = (id: string): ActivityLogEntry[] =>
    activity
      .filter((a) => a.company_id === id)
      .sort((a, b) => (a.activity_date < b.activity_date ? 1 : a.activity_date > b.activity_date ? -1 : 0))
      .slice(0, 10);

  return inputs.map((input) => {
    const row = buildRow(input);
    const rec = stateOf(input.company_id);
    const is_activated = row.activation_pct === 100;
    return {
      company_id: input.company_id,
      company_name: input.company_name,
      current_state: rec?.current_state ?? 'NOT_CONTACTED',
      completed_milestones: REQUIRED_MILESTONES.filter((m) => !row.remaining.includes(m)),
      remaining_milestones: row.remaining,
      activation_percent: row.activation_pct,
      last_activity_date: rec?.last_activity_date ?? null,
      is_activated,
      recent_activity: logOf(input.company_id),
      milestones: row.milestones,
      action_cards: row.action_cards,
    };
  });
}
