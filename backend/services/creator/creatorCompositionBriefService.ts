/**
 * Creator composition brief — server persistence of the writer content a
 * Creator draft is built from (see migration 20261222000000).
 *
 * Tenant-scoped by construction: every read and write names the company the
 * caller was ALREADY authorised for (the route runs enforceCompanyAccess
 * first) and filters on it, and the uniqueness key includes company_id, so a
 * draft id minted in one tenant can never resolve another tenant's brief.
 *
 * Fail-soft: the brief is a convenience over the browser-session copy, so a
 * missing table (migration not applied yet) or a transient DB error degrades
 * to "no stored brief" on read and an `unavailable` result on write, never a
 * broken editor.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { sanitizeCreatorBrief, type CreatorBrief } from '../../../lib/creator-content/creatorBrief';
import { CREATOR_COMPOSITION_TYPE } from '../../../lib/content/creatorCompositionAsset';

export const CREATOR_COMPOSITION_BRIEFS_TABLE = 'creator_composition_briefs';

/** Draft ids are opaque tokens (`creator_<type>_<ms>_<entropy>` or a Writer session token). */
const COMPOSITION_ID_RE = /^[A-Za-z0-9_.:-]{1,160}$/;

export function isValidCompositionId(id: unknown): id is string {
  return typeof id === 'string' && COMPOSITION_ID_RE.test(id);
}

export async function getCreatorCompositionBrief(
  companyId: string,
  compositionId: string,
): Promise<CreatorBrief | null> {
  if (!companyId || !isValidCompositionId(compositionId)) return null;
  try {
    const { data, error } = await ownedDbTable(CREATOR_COMPOSITION_BRIEFS_TABLE)
      .select('brief')
      .eq('company_id', companyId)
      .eq('composition_type', CREATOR_COMPOSITION_TYPE)
      .eq('composition_id', compositionId)
      .maybeSingle();
    if (error || !data) return null;
    return sanitizeCreatorBrief((data as { brief?: unknown }).brief);
  } catch {
    return null;
  }
}

export type SaveBriefResult =
  | { ok: true; brief: CreatorBrief }
  | { ok: false; reason: 'invalid' | 'unavailable' };

export async function saveCreatorCompositionBrief(input: {
  companyId: string;
  userId: string;
  compositionId: string;
  brief: unknown;
}): Promise<SaveBriefResult> {
  const brief = sanitizeCreatorBrief(input.brief);
  if (!input.companyId || !isValidCompositionId(input.compositionId) || !brief) {
    return { ok: false, reason: 'invalid' };
  }
  try {
    const now = new Date().toISOString();
    const { error } = await ownedDbTable(CREATOR_COMPOSITION_BRIEFS_TABLE)
      .upsert(
        {
          company_id: input.companyId,
          composition_type: CREATOR_COMPOSITION_TYPE,
          composition_id: input.compositionId,
          brief,
          source: brief.source,
          updated_by: input.userId,
          updated_at: now,
        },
        { onConflict: 'company_id,composition_type,composition_id' },
      );
    if (error) return { ok: false, reason: 'unavailable' };
    return { ok: true, brief };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
