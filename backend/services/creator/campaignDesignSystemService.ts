/**
 * Campaign Design System Service — persists the Campaign ↔ Collection pin.
 *
 * Reuses the collection service (resolution + validation) and the pure
 * campaign-design-system model (attach / health / compare / upgrade). The pinned
 * snapshot is stored so the campaign is version-stable; upgrade re-pins. No
 * duplicate campaign-template model, no rendering path.
 *
 * Best-effort: an unapplied table yields null so campaigns are unaffected.
 */

import { supabase } from '../../db/supabaseClient';
import type { TemplateAssetFamily } from '../../../lib/creator-templates';
import {
  type CampaignDesignSystem,
  type CampaignDesignHealth,
  type CollectionVersionDiff,
  type AttachValidation,
  canAttachCollection,
  attachCollection,
  campaignDesignHealth,
  compareCollectionVersions,
  upgradeCampaign,
  resolveCampaignTemplate,
} from '../../../lib/creator-templates/campaignDesignSystem';
import { getCollection, buildResolver } from './collectionService';
import type { CreatorTemplate } from '../../../lib/creator-templates';
import { resolveAutoSelection } from '../../../lib/creator-templates/autoSelection';
import type { RecommendationContext } from '../../../lib/creator-templates/templateRecommendation';

const TABLE = 'campaign_design_systems';
const nowIso = () => new Date().toISOString();

function hydrate(row: Record<string, unknown>): CampaignDesignSystem | null {
  const dj = row.design_system_json;
  if (!dj || typeof dj !== 'object') return null;
  const ds = JSON.parse(JSON.stringify(dj)) as CampaignDesignSystem;
  ds.campaignId = String(row.campaign_id ?? ds.campaignId);
  ds.collectionId = String(row.collection_id ?? ds.collectionId);
  ds.pinnedVersion = typeof row.pinned_version === 'number' ? row.pinned_version : ds.pinnedVersion;
  ds.status = (String(row.status ?? ds.status) as CampaignDesignSystem['status']);
  return ds;
}

function toRow(ds: CampaignDesignSystem, companyId: string): Record<string, unknown> {
  return {
    company_id: companyId,
    campaign_id: ds.campaignId,
    collection_id: ds.collectionId,
    pinned_version: ds.pinnedVersion,
    status: ds.status,
    required_families: ds.requiredFamilies,
    design_system_json: ds,
    updated_at: nowIso(),
  };
}

export async function getCampaignDesignSystem(campaignId: string): Promise<CampaignDesignSystem | null> {
  try {
    const { data, error } = await supabase.from(TABLE).select('*').eq('campaign_id', campaignId).maybeSingle();
    if (error || !data) return null;
    return hydrate(data as Record<string, unknown>);
  } catch { return null; }
}

/** Resolve a campaign design system's owning company — the API authorization boundary. */
export async function getCampaignDesignSystemCompanyId(campaignId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from(TABLE).select('company_id').eq('campaign_id', campaignId).maybeSingle();
    if (error || !data) return null;
    return String((data as Record<string, unknown>).company_id);
  } catch { return null; }
}

/**
 * Attach a collection to a campaign. Validates (reused collection validation +
 * required families) BEFORE persisting. Upserts on campaign_id (one per campaign).
 */
export async function attachCollectionToCampaign(input: {
  companyId: string;
  campaignId: string;
  collectionId: string;
  requiredFamilies?: TemplateAssetFamily[];
}): Promise<{ designSystem: CampaignDesignSystem | null; validation: AttachValidation }> {
  const collection = await getCollection(input.collectionId);
  if (!collection) return { designSystem: null, validation: { ok: false, errors: ['Collection not found.'], missingFamilies: [] } };
  const resolve = await buildResolver(collection.templateIds);
  const validation = canAttachCollection(collection, resolve, input.requiredFamilies ?? []);
  if (!validation.ok) return { designSystem: null, validation };

  const ds = attachCollection({ campaignId: input.campaignId, collection, requiredFamilies: input.requiredFamilies, now: nowIso() });
  try {
    const { data, error } = await supabase.from(TABLE).upsert(toRow(ds, input.companyId), { onConflict: 'campaign_id' }).select('*').maybeSingle();
    if (error || !data) return { designSystem: null, validation };
    return { designSystem: hydrate(data as Record<string, unknown>), validation };
  } catch { return { designSystem: null, validation }; }
}

export async function detachCampaignDesignSystem(campaignId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(TABLE).delete().eq('campaign_id', campaignId);
    return !error;
  } catch { return false; }
}

/* ── Per-PIECE template selection (campaign generation) ──────────────────
 * The campaign's pinned collection holds several templates per asset family.
 * At generation, each content piece picks the best-fit template for ITS context
 * (deterministic recommendation engine — no AI call here). The pool is loaded
 * ONCE per campaign run; `selectTemplateFromPool` is pure and called per piece.
 */

export interface CampaignTemplatePool {
  /** Resolved campaign templates grouped by asset family (from the pinned snapshot). */
  byFamily: Map<TemplateAssetFamily, CreatorTemplate[]>;
  collectionId: string;
}

export interface CampaignTemplatePieceSelection {
  templateId: string;
  template: CreatorTemplate;
  source: 'recommended';
  /** How many candidate templates the family offered (for telemetry/debug). */
  candidateCount: number;
}

/** Load + resolve a campaign's pinned templates once, grouped by family. Null when
 *  no design system is pinned / the table is unapplied ⇒ caller keeps today's flow. */
export async function loadCampaignTemplatePool(campaignId: string): Promise<CampaignTemplatePool | null> {
  const ds = await getCampaignDesignSystem(campaignId);
  if (!ds) return null;
  // Use the LIVE collection so manual/AI edits made in the gallery reach generation
  // immediately; fall back to the pinned snapshot only if the collection is gone.
  const live = await getCollection(ds.collectionId);
  const templateIds = live?.templateIds ?? ds.pinnedSnapshot.templateIds;
  const resolve = await buildResolver(templateIds);
  const byFamily = new Map<TemplateAssetFamily, CreatorTemplate[]>();
  for (const id of templateIds) {
    const t = resolve(id);
    if (!t) continue;
    const arr = byFamily.get(t.assetFamily) ?? [];
    arr.push(t);
    byFamily.set(t.assetFamily, arr);
  }
  if (byFamily.size === 0) return null;
  return { byFamily, collectionId: ds.collectionId };
}

/** Pure per-piece selection: best-fit template for this family + piece context. */
export function selectTemplateFromPool(
  pool: CampaignTemplatePool,
  family: TemplateAssetFamily,
  context: RecommendationContext,
): CampaignTemplatePieceSelection | null {
  const templates = pool.byFamily.get(family) ?? [];
  if (templates.length === 0) return null;
  const selection = resolveAutoSelection({ templates, context: { ...context, assetFamily: family } });
  if (!selection.templateId) return null;
  const template = templates.find((t) => t.id === selection.templateId);
  if (!template) return null;
  return { templateId: selection.templateId, template, source: 'recommended', candidateCount: templates.length };
}

/** Recommend the campaign's template for a family (from the PINNED snapshot). */
export async function recommendCampaignTemplate(campaignId: string, family: TemplateAssetFamily) {
  const ds = await getCampaignDesignSystem(campaignId);
  if (!ds) return null;
  const resolve = await buildResolver(ds.pinnedSnapshot.templateIds);
  return resolveCampaignTemplate(ds, family, resolve);
}

/** Dashboard health for a campaign's pinned collection. */
export async function getCampaignDesignHealth(campaignId: string): Promise<{ designSystem: CampaignDesignSystem; health: CampaignDesignHealth } | null> {
  const ds = await getCampaignDesignSystem(campaignId);
  if (!ds) return null;
  const resolve = await buildResolver(ds.pinnedSnapshot.templateIds);
  return { designSystem: ds, health: campaignDesignHealth(ds, resolve) };
}

/** Deterministic comparison: pinned snapshot vs the live latest collection. */
export async function getCampaignCollectionUpgrade(campaignId: string): Promise<{ designSystem: CampaignDesignSystem; latestVersion: number; diff: CollectionVersionDiff } | null> {
  const ds = await getCampaignDesignSystem(campaignId);
  if (!ds) return null;
  const latest = await getCollection(ds.collectionId);
  if (!latest) return null;
  const resolve = await buildResolver([...new Set([...ds.pinnedSnapshot.templateIds, ...latest.templateIds])]);
  return { designSystem: ds, latestVersion: latest.version, diff: compareCollectionVersions(ds.pinnedSnapshot, latest, resolve) };
}

/** Upgrade the campaign to the latest collection version (re-pins the snapshot). */
export async function upgradeCampaignDesignSystem(input: { companyId: string; campaignId: string }): Promise<CampaignDesignSystem | null> {
  const ds = await getCampaignDesignSystem(input.campaignId);
  if (!ds) return null;
  const latest = await getCollection(ds.collectionId);
  if (!latest) return null;
  const upgraded = upgradeCampaign(ds, latest, nowIso());
  try {
    const { data, error } = await supabase.from(TABLE).upsert(toRow(upgraded, input.companyId), { onConflict: 'campaign_id' }).select('*').maybeSingle();
    if (error || !data) return null;
    return hydrate(data as Record<string, unknown>);
  } catch { return null; }
}
