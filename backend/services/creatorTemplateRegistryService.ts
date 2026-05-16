import { supabase } from '../db/supabaseClient';
import { getCreatorGovernance, normalizeCreatorFormat } from '../../lib/shared/creatorGovernanceRegistry';

export type CreatorAssetType =
  | 'image'
  | 'carousel'
  | 'video';

export type CreatorTemplateRecord = {
  id: string;
  type: CreatorAssetType;
  name: string;
  structure_schema: Record<string, unknown>;
  style_schema: Record<string, unknown>;
  mapping_rules: Record<string, unknown>;
  is_default?: boolean;
};

const BUILTIN_TEMPLATES: Record<CreatorAssetType, CreatorTemplateRecord> = {
  image: {
    id: 'builtin-image-single',
    type: 'image',
    name: 'Single Image',
    structure_schema: {
      frame_count: 1,
      frame_roles: ['hero'],
      output_shape: 'single_visual',
    },
    style_schema: {
      visual_density: 'focused',
      preferred_layout: 'hero_with_supporting_copy',
    },
    mapping_rules: {
      caption_strategy: 'single_caption',
      hashtag_strategy: 'supporting_tags',
    },
    is_default: true,
  },
  carousel: {
    id: 'builtin-carousel-standard',
    type: 'carousel',
    name: 'Standard Carousel',
    structure_schema: {
      frame_count: 6,
      frame_roles: ['hook', 'insight', 'insight', 'insight', 'proof', 'cta'],
      output_shape: 'slide_series',
    },
    style_schema: {
      visual_density: 'moderate',
      preferred_layout: 'headline_plus_supporting_visual',
    },
    mapping_rules: {
      caption_strategy: 'summary_caption',
      hashtag_strategy: 'save_share_tags',
    },
    is_default: true,
  },
  video: {
    id: 'builtin-video-shortform',
    type: 'video',
    name: 'Shortform Video',
    structure_schema: {
      frame_count: 5,
      frame_roles: ['hook', 'setup', 'insight', 'payoff', 'cta'],
      output_shape: 'scene_sequence',
    },
    style_schema: {
      pacing: 'fast',
      preferred_layout: 'hook_then_value',
    },
    mapping_rules: {
      caption_strategy: 'native_platform_caption',
      hashtag_strategy: 'discovery_plus_niche',
    },
    is_default: true,
  },
};

export function resolveCreatorAssetType(contentType: string): CreatorAssetType {
  const value = normalizeCreatorFormat(contentType);
  const governance = getCreatorGovernance(value);
  if (!governance) {
    console.warn('[creator-governance][unsupported-format]', {
      content_type: contentType,
      normalized_content_type: value,
      source: 'resolveCreatorAssetType',
    });
    throw new Error(`Unsupported creator content type: ${String(contentType || '').trim() || 'unknown'}`);
  }
  if (!governance.ai_renderable || governance.guidance_only || governance.daily_plan_only) {
    console.warn('[creator-governance][non-renderable-format]', {
      content_type: contentType,
      normalized_content_type: value,
      canonical_asset_family: governance.canonical_asset_family,
      source: 'resolveCreatorAssetType',
    });
    throw new Error(`Creator format "${value}" is guidance-only and cannot be rendered or scheduled autonomously`);
  }
  if (governance.canonical_asset_family === 'image') return 'image';
  if (governance.canonical_asset_family === 'carousel') return 'carousel';
  if (governance.canonical_asset_family === 'video') return 'video';
  throw new Error(`Creator format "${value}" is not mapped to a renderable asset family`);
}

/**
 * Same family-resolution as {@link resolveCreatorAssetType} but allows the
 * caller to opt in to guidance-only formats (video/reel/short/podcast). Used
 * by the theme-treatment generation path which produces a written blueprint
 * — scenes / hook / CTA / audio cues — instead of a rendered asset.
 *
 * The 'audio' family is mapped onto 'video' here because the prompt + asset
 * payload shape are scene-based for both video and audio episodes; the
 * downstream consumer differentiates via `content_type`.
 */
export function resolveCreatorAssetTypeAllowGuidance(contentType: string): CreatorAssetType {
  const value = normalizeCreatorFormat(contentType);
  const governance = getCreatorGovernance(value);
  if (!governance) {
    throw new Error(`Unsupported creator content type: ${String(contentType || '').trim() || 'unknown'}`);
  }
  if (governance.canonical_asset_family === 'image') return 'image';
  if (governance.canonical_asset_family === 'carousel') return 'carousel';
  // 'video' and 'audio' both produce scene-based theme blueprints.
  return 'video';
}

/**
 * @deprecated With the per-row eligibility refactor, "guidance-only" no
 * longer maps cleanly to a single flag. The four formats that previously
 * set `guidance_only: true` are now attachment-required. This helper now
 * delegates to {@link isAttachmentRequiredFormat} so existing routing
 * (e.g. the generate API's theme-treatment branch) keeps working without
 * a callsite migration.
 */
export function isGuidanceOnlyContentType(contentType: string): boolean {
  const governance = getCreatorGovernance(contentType);
  return Boolean(governance?.media_upload_required);
}

export function deriveCreatorAssetTypeFromIntent(input: {
  contentType: string;
  targetPlatforms?: string[];
}): CreatorAssetType {
  return resolveCreatorAssetType(String(input.contentType || '').trim().toLowerCase());
}

export function getBuiltinCreatorTemplate(assetType: CreatorAssetType): CreatorTemplateRecord {
  return BUILTIN_TEMPLATES[assetType];
}

export async function getCreatorTemplateById(input: {
  templateId: string;
  assetType: CreatorAssetType;
  companyId?: string | null;
}): Promise<CreatorTemplateRecord | null> {
  const normalizedTemplateId = String(input.templateId || '').trim();
  if (!normalizedTemplateId) return null;

  const builtin = Object.values(BUILTIN_TEMPLATES).find((template) => template.id === normalizedTemplateId);
  if (builtin) {
    return builtin.type === input.assetType ? builtin : null;
  }

  try {
    let query = supabase
      .from('creator_template_registry')
      .select('id, type, name, structure_schema, style_schema, mapping_rules, is_default')
      .eq('id', normalizedTemplateId)
      .eq('type', input.assetType);

    if (input.companyId) {
      query = query.or(`company_id.eq.${input.companyId},company_id.is.null`);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error || !data) return null;

    return {
      id: String((data as any).id || normalizedTemplateId),
      type: input.assetType,
      name: String((data as any).name || normalizedTemplateId),
      structure_schema: ((data as any).structure_schema as Record<string, unknown>) ?? {},
      style_schema: ((data as any).style_schema as Record<string, unknown>) ?? {},
      mapping_rules: ((data as any).mapping_rules as Record<string, unknown>) ?? {},
      is_default: Boolean((data as any).is_default),
    };
  } catch {
    return null;
  }
}

export async function getCreatorTemplate(input: {
  assetType: CreatorAssetType;
  templateId?: string | null;
  companyId?: string | null;
}): Promise<CreatorTemplateRecord> {
  const { assetType, templateId, companyId } = input;
  const fallback = BUILTIN_TEMPLATES[assetType];

  try {
    let query = supabase
      .from('creator_template_registry')
      .select('id, type, name, structure_schema, style_schema, mapping_rules, is_default')
      .eq('type', assetType);

    if (templateId) {
      query = query.eq('id', templateId);
    } else {
      query = query.eq('is_default', true);
      if (companyId) {
        query = query.or(`company_id.eq.${companyId},company_id.is.null`);
      }
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return fallback;

    return {
      id: String((data as any).id || fallback.id),
      type: assetType,
      name: String((data as any).name || fallback.name),
      structure_schema: ((data as any).structure_schema as Record<string, unknown>) ?? fallback.structure_schema,
      style_schema: ((data as any).style_schema as Record<string, unknown>) ?? fallback.style_schema,
      mapping_rules: ((data as any).mapping_rules as Record<string, unknown>) ?? fallback.mapping_rules,
      is_default: Boolean((data as any).is_default),
    };
  } catch {
    return fallback;
  }
}
