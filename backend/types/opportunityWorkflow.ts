export const ASSIGNMENT_ROLES = ['analyst', 'reviewer', 'owner', 'observer'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const NOTE_VISIBILITIES = ['internal', 'team', 'redacted'] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];

export const DISPOSITIONS = [
  'qualified',
  'disqualified',
  'low_priority',
  'revisit_later',
  'not_relevant',
  'converted',
  'duplicate',
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export type OpportunityAssignment = {
  id: string;
  organization_id: string;
  opportunity_feed_item_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string | null;
  role: AssignmentRole;
  metadata: Record<string, unknown>;
  unassigned_at: string | null;
  created_at: string;
};

export type OpportunityNote = {
  id: string;
  organization_id: string;
  opportunity_feed_item_id: string;
  author_user_id: string | null;
  body: string;
  visibility: NoteVisibility;
  metadata: Record<string, unknown>;
  edited_at: string | null;
  created_at: string;
};

export type OpportunityTag = {
  id: string;
  organization_id: string;
  opportunity_feed_item_id: string;
  tag: string;
  created_by: string | null;
  created_at: string;
};

export type OpportunityDisposition = {
  id: string;
  organization_id: string;
  opportunity_feed_item_id: string;
  disposition: Disposition;
  reason: string | null;
  set_by_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
