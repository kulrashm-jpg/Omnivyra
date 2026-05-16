export const SAVED_VIEW_KINDS = [
  'search',
  'filter',
  'bookmark',
  'collection',
  'investigation_template',
] as const;
export type SavedViewKind = (typeof SAVED_VIEW_KINDS)[number];

export const COLLECTION_ITEM_KINDS = [
  'opportunity',
  'cluster',
  'source',
  'execution',
  'escalation',
  'incident',
  'note',
  'snapshot',
  'external_link',
] as const;
export type CollectionItemKind = (typeof COLLECTION_ITEM_KINDS)[number];

export type SavedIntelligenceView = {
  id: string;
  organization_id: string;
  view_kind: SavedViewKind;
  name: string;
  description: string | null;
  filter_payload: Record<string, unknown>;
  owner_user_id: string | null;
  shared: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AnalystCollectionItem = {
  id: string;
  organization_id: string;
  collection_id: string;
  item_kind: CollectionItemKind;
  item_ref: string;
  body: string | null;
  added_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
