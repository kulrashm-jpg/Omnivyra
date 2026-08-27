/**
 * The AI creative belonging to one generated activity, and its composition.
 *
 * WHY THIS EXISTS
 * ---------------
 * Campaign generation already produces a real creative and already records it
 * against the activity: the worker writes `creator_asset_id` and a
 * `rendered_asset` block into `daily_content_plans.content` and marks the row
 * `render_ready`. That relationship has been durable all along — Activity
 * Workspace simply never read it, so the screen showed text and a stock photo
 * picker while the generated image sat one column away.
 *
 * This reads it. It adds no table, no join table and no second copy of the
 * asset: the activity row already names its creative.
 *
 * TENANCY IS NOT INHERITED HERE
 * -----------------------------
 * `daily_content_plans` carries no `company_id` — it belongs to a campaign, and
 * the campaign belongs to the company. `ownedDbTable` is an observability
 * proxy, NOT a company-scoped accessor, so the ownership hop is performed
 * explicitly below. An activity whose campaign belongs to another tenant
 * resolves to null, indistinguishable from one that does not exist.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not render, does not resolve references, does not read asset bytes
 * and does not touch the stock-image path. It answers two questions — which
 * creative is this activity's, and which composition refines it — and leaves
 * every existing mechanism to do its own job.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { ACTIVITY_CREATIVE_COMPOSITION_TYPE } from '../../../lib/content/creatorCompositionAsset';

export interface ActivityCreative {
  activityId: string;
  campaignId: string | null;
  /** The generated creative, when one exists yet. */
  creatorAssetId: string | null;
  assetType: string | null;
  templateId: string | null;
  /** Rendered output URLs, exactly as the worker recorded them. */
  urls: string[];
  /** `render_ready` once a creative exists; anything else means not yet. */
  contentStatus: string | null;
  /**
   * Which version of this asset the urls above belong to.
   *
   * 1 is the campaign's own render. Anything higher is a refinement made in
   * Activity Workspace, and is what the user should see when they come back.
   */
  currentVersion: number;
  /** True once a refinement exists, so the workspace can say which it is showing. */
  isRefined: boolean;
  /**
   * The composition that refinements of THIS activity attach to.
   *
   * Always the activity's own id, so it is durable, server-owned and unique per
   * activity — and never the Creator's per-session, per-creator-type token,
   * which cannot represent one specific piece of scheduled content.
   */
  compositionType: string;
  compositionId: string;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Does this activity belong to this company?
 *
 * The ONE authorization question, asked through the campaign because that is
 * where company ownership lives. Never `user_id`, never `created_by`: an
 * activity is a company's, not an individual's, and two people in one company
 * must both be able to refine it.
 */
export async function activityBelongsToCompany(
  companyId: string,
  activityId: string,
): Promise<{ ok: boolean; campaignId: string | null }> {
  if (!companyId?.trim() || !activityId?.trim()) return { ok: false, campaignId: null };

  const { data: activity, error } = await ownedDbTable('daily_content_plans')
    .select('id, campaign_id')
    .eq('id', activityId)
    .maybeSingle();
  if (error || !activity) return { ok: false, campaignId: null };

  const campaignId = str((activity as Record<string, unknown>).campaign_id);
  if (!campaignId) return { ok: false, campaignId: null };

  const { data: campaign, error: campaignError } = await ownedDbTable('campaigns')
    .select('id, company_id')
    .eq('id', campaignId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (campaignError || !campaign) return { ok: false, campaignId: null };

  return { ok: true, campaignId };
}

/**
 * Resolve one activity's creative and its refinement composition.
 *
 * Returns null when the activity is not this company's — the same answer a
 * missing activity gives, so the endpoint cannot be used to discover which
 * activity ids exist under another tenant.
 *
 * A company's own activity that has not generated yet returns a record with a
 * null `creatorAssetId`: the composition identity is still valid and stable, so
 * the caller can tell "nothing generated yet" from "not yours" — which are very
 * different things to show a person.
 */
export async function resolveActivityCreative(input: {
  companyId: string | null | undefined;
  activityId: string | null | undefined;
}): Promise<ActivityCreative | null> {
  const companyId = String(input.companyId || '').trim();
  const activityId = String(input.activityId || '').trim();
  if (!companyId || !activityId) return null;

  const ownership = await activityBelongsToCompany(companyId, activityId);
  if (!ownership.ok) return null;

  const { data, error } = await ownedDbTable('daily_content_plans')
    .select('id, campaign_id, content, asset_type, template_id, content_status')
    .eq('id', activityId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const content = asObject(row.content);
  const rendered = asObject(content.rendered_asset);
  const urls = Array.isArray(rendered.urls)
    ? rendered.urls.filter((u): u is string => typeof u === 'string' && Boolean(u))
    : [];

  // Written by the generation worker onto the activity's own content.
  const creatorAssetId = str(rendered.creator_asset_id) ?? str(content.creator_asset_id);

  /*
   * WHAT THE USER SHOULD SEE WHEN THEY COME BACK.
   *
   * Refinement records its result as a new version on the asset's envelope and
   * deliberately does NOT rewrite the activity row — that row is campaign
   * history and version 1 must keep pointing at the campaign's own render.
   *
   * But it means the activity row alone is no longer the whole truth: someone
   * who refined, left, and returned would be shown the original again and would
   * reasonably conclude their refinement had been lost. So the envelope — which
   * IS the version authority — decides which render is current.
   *
   * Best-effort by design. If the envelope cannot be read, showing the
   * campaign's render is the right fallback: it is real, it is theirs, and it
   * is what existed before refinement was possible.
   */
  const current = await (async (): Promise<{ version: number; urls: string[] } | null> => {
    if (!creatorAssetId) return null;
    try {
      const { libraryReadAsset } = await import('../creatorAssetPersistenceService');
      const record = await libraryReadAsset({ companyId, assetId: creatorAssetId });
      const envelope = asObject((record as unknown as Record<string, unknown> | null)?.library ?? null);
      const versions = Array.isArray(envelope.versions) ? envelope.versions as Record<string, unknown>[] : [];
      const currentVersion = Number(envelope.currentVersion ?? 0);
      if (!versions.length || currentVersion <= 1) return null;
      const hit = versions.find((v) => Number(v.version) === currentVersion);
      const payload = asObject(hit?.payload);
      const refinedUrls = [
        ...(typeof payload.url === 'string' && payload.url ? [payload.url] : []),
        ...(Array.isArray(payload.files)
          ? payload.files.filter((f): f is string => typeof f === 'string' && Boolean(f))
          : []),
      ];
      return { version: currentVersion, urls: refinedUrls };
    } catch {
      return null;
    }
  })();

  return {
    activityId,
    campaignId: ownership.campaignId,
    creatorAssetId,
    assetType: str(row.asset_type) ?? str(content.asset_type),
    templateId: str(row.template_id),
    // The refinement's own output when one is current; otherwise the campaign's.
    urls: current && current.urls.length > 0 ? current.urls : urls,
    contentStatus: str(row.content_status) ?? str(content.content_status),
    currentVersion: current?.version ?? 1,
    isRefined: Boolean(current),
    compositionType: ACTIVITY_CREATIVE_COMPOSITION_TYPE,
    compositionId: activityId,
  };
}

/**
 * Can this activity's creative be refined with the guided workflow?
 *
 * Only once a creative actually exists. Offering refinement before generation
 * would be offering to refine nothing — and the honest thing to show then is
 * the activity's own status, not a disabled button with no explanation.
 */
export function activityCreativeIsRefinable(creative: ActivityCreative | null): boolean {
  return Boolean(creative?.creatorAssetId) && creative!.urls.length > 0;
}
