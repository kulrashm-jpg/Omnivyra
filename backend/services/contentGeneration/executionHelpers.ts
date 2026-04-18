import { nonEmpty, asObject, toPositiveNumber, MEDIA_DEPENDENT_TYPES } from './contentTypeHelpers';
import type { DailyExecutionItemLike, PlatformTarget, MasterContentPayload } from './types';

export function isMediaDependentContentType(content_type: unknown): boolean {
  const normalized = nonEmpty(content_type).toLowerCase();
  return MEDIA_DEPENDENT_TYPES.has(normalized);
}

function mediaTypeMatchesRequirement(
  assetTypeRaw: unknown,
  requiredType: 'image' | 'video' | 'thumbnail' | 'illustration'
): boolean {
  const assetType = nonEmpty(assetTypeRaw).toLowerCase();
  if (!assetType) return false;
  if (requiredType === 'video') return assetType.includes('video');
  if (requiredType === 'thumbnail') return assetType.includes('thumbnail') || assetType.includes('image');
  if (requiredType === 'illustration') return assetType.includes('illustration') || assetType.includes('image');
  return assetType.includes('image') || assetType.includes('thumbnail') || assetType.includes('illustration');
}

export function hasValidAttachedMedia(item: DailyExecutionItemLike): boolean {
  const mediaAssets = Array.isArray(item?.media_assets) ? item.media_assets : [];
  let hasValidSource = false;
  for (const asset of mediaAssets) {
    const sourceUrl = nonEmpty(asset?.source_url);
    if (!sourceUrl) {
      console.warn('[content-generation-pipeline][media-asset-empty-source-url]', {
        execution_id: item.execution_id ?? null,
      });
      continue;
    }
    hasValidSource = true;
  }
  return hasValidSource;
}

export function resolveMediaStatus(item: DailyExecutionItemLike): 'missing' | 'ready' | undefined {
  const isMediaType = isMediaDependentContentType(item?.content_type);
  const mediaAssets = Array.isArray(item?.media_assets) ? item.media_assets : [];
  const hasValidSource = hasValidAttachedMedia(item);

  if (isMediaType) {
    if (mediaAssets.length === 0) {
      console.warn('[content-generation-pipeline][media-dependent-missing-assets]', {
        execution_id: item.execution_id ?? null,
        content_type: item.content_type ?? null,
      });
    }
    return hasValidSource ? 'ready' : 'missing';
  }

  if (mediaAssets.length > 0) {
    console.warn('[content-generation-pipeline][non-media-has-media-assets]', {
      execution_id: item.execution_id ?? null,
      content_type: item.content_type ?? null,
      media_assets_count: mediaAssets.length,
    });
  }
  return undefined;
}

export function resolvePlatformTargets(item: DailyExecutionItemLike): PlatformTarget[] {
  const normalizeTarget = (input: unknown): PlatformTarget | null => {
    if (typeof input === 'string') {
      const platform = nonEmpty(input).toLowerCase();
      if (!platform) return null;
      return {
        platform,
        content_type: nonEmpty(item.content_type).toLowerCase() || 'post',
      };
    }
    const obj = asObject(input);
    if (!obj) return null;
    const platform = nonEmpty(obj.platform).toLowerCase();
    if (!platform) return null;
    return {
      platform,
      content_type: nonEmpty(obj.content_type).toLowerCase() || nonEmpty(item.content_type).toLowerCase() || 'post',
      max_length: toPositiveNumber(obj.max_length),
      generation_overrides: asObject(obj.generation_overrides) || undefined,
    };
  };

  const fromArray = (value: unknown): PlatformTarget[] => {
    const arr = Array.isArray(value) ? value : [];
    return arr.map(normalizeTarget).filter(Boolean) as PlatformTarget[];
  };

  const activeTargets = fromArray(item.active_platform_targets);
  if (activeTargets.length > 0) return activeTargets;

  const plannedTargets = fromArray(item.planned_platform_targets);
  if (plannedTargets.length > 0) return plannedTargets;

  // Compatibility fallback when explicit targets are absent.
  const selectedPlatforms = fromArray(item.selected_platforms);
  if (selectedPlatforms.length > 0) return selectedPlatforms;

  const fallbackPlatform = nonEmpty(item.platform).toLowerCase();
  if (!fallbackPlatform) return [];
  return [{ platform: fallbackPlatform, content_type: nonEmpty(item.content_type).toLowerCase() || 'post' }];
}

export function buildExecutionReadiness(item: DailyExecutionItemLike): {
  text_ready: boolean;
  media_ready: boolean;
  platform_ready: boolean;
  discoverability_ready: boolean;
  algorithm_ready: boolean;
  ready_to_schedule: boolean;
  blocking_reasons: string[];
} {
  const masterGenerated = nonEmpty(item?.master_content?.generation_status).toLowerCase() === 'generated';
  const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
  const preferredPlatform = nonEmpty(item?.platform).toLowerCase();
  const selectedVariant =
    variants.find((v) => nonEmpty(v?.platform).toLowerCase() === preferredPlatform) || variants[0];
  const hasVariant = Boolean(selectedVariant);

  const text_ready = masterGenerated && hasVariant;
  const platform_ready =
    Boolean(selectedVariant) &&
    nonEmpty(selectedVariant?.generation_status).toLowerCase() === 'generated' &&
    !nonEmpty(selectedVariant?.generated_content).includes('[PLATFORM ADAPTATION FAILED]');

  const discoverability_ready = Boolean(selectedVariant?.discoverability_meta);
  const algorithm_ready = Boolean(selectedVariant?.algorithmic_formatting_meta);

  const requirements = Array.isArray(selectedVariant?.media_search_intent?.media_requirements)
    ? selectedVariant!.media_search_intent!.media_requirements
    : [];
  const requiredMedia = requirements.filter((r) => r.required);
  const assets = Array.isArray(item?.media_assets) ? item!.media_assets! : [];
  const mediaNotRequired = requiredMedia.length === 0;
  const allRequiredPresent =
    mediaNotRequired ||
    requiredMedia.every((requirement) =>
      assets.some((asset) => mediaTypeMatchesRequirement(asset?.type, requirement.media_type))
    );
  const media_ready = allRequiredPresent;

  const blocking_reasons: string[] = [];
  if (!text_ready) blocking_reasons.push('text_not_ready');
  if (!platform_ready) blocking_reasons.push('platform_not_ready');
  if (!discoverability_ready) blocking_reasons.push('discoverability_not_ready');
  if (!algorithm_ready) blocking_reasons.push('algorithm_not_ready');
  if (!media_ready) blocking_reasons.push('missing_required_media');

  const ready_to_schedule =
    text_ready && media_ready && platform_ready && discoverability_ready && algorithm_ready;

  return {
    text_ready,
    media_ready,
    platform_ready,
    discoverability_ready,
    algorithm_ready,
    ready_to_schedule,
    blocking_reasons,
  };
}

export function buildExecutionJobsFromItem(item: DailyExecutionItemLike): Array<{
  job_id: string;
  platform: string;
  content_type: string;
  variant_ref: string;
  ready_to_schedule: boolean;
  status: 'ready' | 'blocked';
  blocking_reasons: string[];
}> {
  const variants = Array.isArray(item?.platform_variants) ? item.platform_variants : [];
  const readiness = item?.execution_readiness;
  const canSchedule = Boolean(readiness?.ready_to_schedule);
  const readinessBlocking = Array.isArray(readiness?.blocking_reasons) ? readiness!.blocking_reasons : [];
  const executionId = nonEmpty(item?.execution_id) || 'execution-item';

  return variants.map((variant) => {
    const platform = nonEmpty(variant?.platform).toLowerCase() || 'unknown';
    const contentType = nonEmpty(variant?.content_type).toLowerCase() || 'post';
    const ready_to_schedule = canSchedule && Boolean(variant);
    const status: 'ready' | 'blocked' = ready_to_schedule ? 'ready' : 'blocked';
    return {
      job_id: `${executionId}-${platform}`,
      platform,
      content_type: contentType,
      variant_ref: `${platform}::${contentType}`,
      ready_to_schedule,
      status,
      blocking_reasons: status === 'blocked' ? readinessBlocking : [],
    };
  });
}
