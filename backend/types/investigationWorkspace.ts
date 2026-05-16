export const INVESTIGATION_STATUSES = ['open', 'in_progress', 'resolved', 'archived'] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export const INVESTIGATION_ITEM_KINDS = [
  'opportunity',
  'cluster',
  'source',
  'execution',
  'escalation',
  'graph_snapshot',
  'note',
  'replay_link',
] as const;
export type InvestigationItemKind = (typeof INVESTIGATION_ITEM_KINDS)[number];

export const INVESTIGATION_MAX_ITEMS = 200 as const;

export type InvestigationWorkspace = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  status: InvestigationStatus;
  created_by: string | null;
  closed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type InvestigationWorkspaceItem = {
  id: string;
  organization_id: string;
  workspace_id: string;
  item_kind: InvestigationItemKind;
  item_ref: string;
  body: string | null;
  pinned: boolean;
  added_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
