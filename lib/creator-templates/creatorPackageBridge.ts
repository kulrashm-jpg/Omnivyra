/**
 * Creator Result → Campaign Package bridge — the ONE canonical projection from a
 * creator generation result into the canonical CampaignPackage. There must be
 * exactly one implementation of "creator result → PackageAsset[]"; this is it.
 *
 * Pure + deterministic + defensive (reads existing data only — media_bundle,
 * diagnostic report, packaging, applied_variant, generated_assets fan-out). No
 * generation/rendering, no new model, no duplicated projection. The creator UI
 * and any future consumer must call THIS rather than re-assembling assets.
 */

import { buildCampaignPackage, type CampaignPackage, type PackageAsset } from './campaignPackage';

function obj(v: unknown): Record<string, unknown> { return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}; }
function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function str(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v.trim() : null; }
function strList(v: unknown): string[] { return arr(v).filter((x): x is string => typeof x === 'string'); }

export interface CreatorPackageContext {
  templateName: string;
  templateId: string;
  assetFamily: string;
  selectedPlatform?: string | null;
  campaign: { name?: string | null; objective?: string | null; audience?: string | null; platforms?: string[] };
  edited?: boolean;
  regenerations?: number;
  inProgress?: boolean;
}

/** The single canonical projection of a creator result into PackageAsset[]. */
export function creatorResultToPackageAssets(result: unknown, ctx: CreatorPackageContext): PackageAsset[] {
  const r = obj(result);
  const output = obj(r.output);
  const bundle = obj(obj(output.asset_payload).media_bundle);
  const meta = obj(bundle.metadata);
  const diag = obj(meta.creator_diagnostic_report);
  const diagTpl = obj(diag.template);
  const diagRender = obj(diag.rendering);
  const packaging = obj(output.packaging);
  const appliedVariant = obj(meta.applied_variant);

  const branding = str(diagRender.brandingProfile) ?? str(meta.brand_mode);
  const cta = str(packaging.cta);
  const caption = str(packaging.caption);
  const platform = str(ctx.selectedPlatform) ?? str(r.primary_platform);
  const generatedAt = str(diag.generatedAt);

  const primary: PackageAsset = {
    id: str(r.persisted_asset_id),
    assetType: str(output.asset_type) ?? ctx.assetFamily,
    template: str(diagTpl.name) ?? ctx.templateName,
    templateId: str(diagTpl.id) ?? ctx.templateId,
    variant: str(appliedVariant.variant_family),
    platform,
    cta,
    branding,
    status: ctx.inProgress ? 'processing' : 'completed',
    previewUrl: str(bundle.url) ?? str(arr(bundle.files)[0]),
    url: str(bundle.url),
    files: strList(bundle.files),
    caption,
    generatedAt,
    edited: !!ctx.edited,
    regenerations: ctx.regenerations ?? 0,
  };

  const fanout = arr(r.generated_assets);
  if (fanout.length > 0) {
    return fanout.map((g) => {
      const ga = obj(g);
      return {
        id: str(ga.persisted_asset_id),
        assetType: str(ga.asset_type) ?? primary.assetType,
        template: str(ga.template_id) ?? primary.template,
        templateId: str(ga.template_id) ?? primary.templateId,
        variant: str(ga.variant_family),
        platform,
        cta,
        branding,
        status: ga.ok === false ? 'failed' : 'completed',
        previewUrl: null,
        url: null,
        files: [],
        caption: null,
        generatedAt,
      } as PackageAsset;
    });
  }
  return [primary];
}

/** Build the canonical CampaignPackage directly from a creator generation result. */
export function buildCreatorCampaignPackage(result: unknown, ctx: CreatorPackageContext): CampaignPackage {
  return buildCampaignPackage({
    campaign: {
      name: ctx.campaign.name ?? ctx.templateName,
      objective: ctx.campaign.objective ?? null,
      audience: ctx.campaign.audience ?? null,
      platforms: ctx.campaign.platforms ?? [],
    },
    assets: creatorResultToPackageAssets(result, ctx),
  });
}
