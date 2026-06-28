/**
 * Design System management glue (CREATOR-030).
 *
 * Pure helpers shared by the campaign Design System panel (which links into the
 * canonical Template Gallery) and the gallery's campaign mode (which edits the
 * pinned collection directly). One management surface — the gallery — for Writer,
 * standalone Creator, and campaigns. No member editor, no second gallery, no
 * temporary template storage.
 */

import type { TemplateAssetFamily } from './types';

/** Toggle a template id in a member set (immutably): present → removed, else added. */
export function toggleMemberSet(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The collection PATCH op for a toggle, given current membership. */
export function memberOp(isMember: boolean): 'add' | 'remove' {
  return isMember ? 'remove' : 'add';
}

export interface ManageGalleryLink {
  pathname: string;
  query: Record<string, string>;
}

/**
 * Build the canonical Template Gallery link for managing a campaign's Design System.
 * The `[type]` route scopes the gallery to one family (family filtering); `collection_id`
 * puts the gallery in campaign mode (multi-select edits THIS collection). `campaign_id`
 * + `return_to` are carried so the gallery can return to the planner (coverage refresh).
 */
export function buildManageGalleryHref(input: {
  family: TemplateAssetFamily;
  collectionId: string;
  campaignId?: string;
  returnTo?: string;
}): ManageGalleryLink {
  const query: Record<string, string> = { collection_id: input.collectionId };
  if (input.campaignId) query.campaign_id = input.campaignId;
  if (input.returnTo) query.return_to = input.returnTo;
  return { pathname: `/command-center/creator-content/${input.family}/templates`, query };
}
