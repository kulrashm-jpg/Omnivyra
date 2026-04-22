import { supabase } from '../db/supabaseClient';

export type CreatorAssetType =
  | 'image'
  | 'carousel'
  | 'video'
  | 'post_with_asset'
  | 'thread_with_asset';

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
  post_with_asset: {
    id: 'builtin-post-with-asset',
    type: 'post_with_asset',
    name: 'Post With Asset',
    structure_schema: {
      text: 'single_post',
      asset: 'image',
      frame_count: 1,
      frame_roles: ['supporting_asset'],
      output_shape: 'caption_with_single_asset',
    },
    style_schema: {
      visual_density: 'supporting',
      preferred_layout: 'caption_led',
    },
    mapping_rules: {
      caption_strategy: 'caption_primary',
      hashtag_strategy: 'platform_native',
    },
    is_default: true,
  },
  thread_with_asset: {
    id: 'builtin-thread-with-asset',
    type: 'thread_with_asset',
    name: 'Thread With Asset',
    structure_schema: {
      slides: 'thread_sequence',
      asset: 'carousel',
      frame_count: 1,
      frame_roles: ['supporting_asset'],
      output_shape: 'thread_with_attachment',
    },
    style_schema: {
      visual_density: 'supporting',
      preferred_layout: 'thread_led',
    },
    mapping_rules: {
      caption_strategy: 'thread_opening_caption',
      hashtag_strategy: 'minimal',
    },
    is_default: true,
  },
};

export function resolveCreatorAssetType(contentType: string): CreatorAssetType {
  const value = String(contentType || '').trim().toLowerCase();
  if (['carousel', 'slides', 'slide', 'presentation', 'deck', 'pdf', 'slider'].includes(value)) return 'carousel';
  if (['image', 'photo', 'graphic', 'visual', 'banner', 'infographic'].includes(value)) return 'image';
  if (['thread'].includes(value)) return 'thread_with_asset';
  if (['post'].includes(value)) return 'post_with_asset';
  return 'video';
}

export function deriveCreatorAssetTypeFromIntent(input: {
  contentType: string;
  targetPlatforms?: string[];
}): CreatorAssetType {
  const normalizedType = String(input.contentType || '').trim().toLowerCase();
  const platforms = Array.isArray(input.targetPlatforms)
    ? input.targetPlatforms.map((platform) => String(platform).trim().toLowerCase())
    : [];

  if (normalizedType === 'post' && platforms.some((platform) => platform === 'x' || platform === 'twitter')) {
    return 'thread_with_asset';
  }

  return resolveCreatorAssetType(normalizedType);
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
