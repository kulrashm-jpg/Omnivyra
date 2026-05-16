import { ownedDbTable } from '../db/writeOwner';
/**
 * Block Template Service
 *
 * CRUD for reusable block-layout templates. Company-scoped with
 * system-provided defaults (is_default = true).
 * Follows the strategyTemplateService pattern.
 */

import { supabase } from '../db/supabaseClient';
import type { ContentBlock } from '../../lib/blog/blockTypes';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Continuity-metadata block stashed at the head of `content_blocks` for
 * every Creator-saved asset. Mirrors the WriterAttachedAsset continuity
 * bundle so "Use Existing Asset" restoration behaves identically to
 * attached-asset reopen.
 *
 * The block is a real ContentBlock with `type: 'creator_continuity'` so
 * downstream renderers (blog, post, etc.) can skip it via the standard
 * unknown-type filter — there is NO schema change. Legacy templates
 * without the block simply lack the metadata; restoration is defensive.
 *
 * Surfaced on `BlockTemplate.creator_metadata` after `mapRow()` extracts
 * + strips it from `content_blocks`.
 */
export interface CreatorContinuityMetadata {
  /** 'image' | 'banner' | 'infographic' | 'carousel' | 'pdf' | 'slider' */
  asset_type?:           string | null;
  attachment_mode?:      'embedded_copy' | 'supporting_visual' | null;
  asset_composition_intent?: Record<string, unknown> | null;
  copy_policy?: Record<string, unknown> | null;
  source_text_transform?: string | null;
  overlay_text?: {
    hook?:           string;
    headline?:       string;
    keyInsight?:     string;
    cta?:            string;
    supportingText?: string;
  } | null;
  subtype?:        string | null;
  brand_mode?:     'brand-aware' | 'independent' | null;
  brand_presence?: 'minimal' | 'balanced' | 'strong' | null;
  platform?:       string | null;
  files?:          string[] | null;
  preview_kind?:   string | null;
  platformContext?: string | null;
  renderIdentityHash?: string | null;
  /** Full renderer metadata blob from media_bundle.metadata. */
  renderer_metadata?: Record<string, unknown> | null;
  /** Schema version for the bundle itself; bump only on breaking changes. */
  schema_version?:    number;
  /**
   * True when this bundle was synthesized by {@link synthesizeLegacyCreatorMetadata}
   * from non-structured signals (tags / description / format_type) on
   * an asset created before the structured bundle existed. Lets the
   * client / observer paths distinguish "modern save → modern restore"
   * from "legacy save → best-effort restore".
   */
  synthesized_from_legacy?: boolean;
}

/** Block-type marker used in content_blocks[0]. */
export const CREATOR_CONTINUITY_BLOCK_TYPE = 'creator_continuity' as const;

/** Current bundle shape version. Bump on a breaking shape change. */
export const CREATOR_CONTINUITY_SCHEMA_VERSION = 1;

/**
 * Schema versions this codebase knows how to parse safely. New code paths
 * MUST add their version to this set; an unknown version falls through to
 * the legacy-fallback path (treat as no metadata) rather than crash.
 */
const SUPPORTED_CONTINUITY_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1]);

/**
 * Allowed string values for free-form enum-ish fields. Anything outside
 * the set is dropped during {@link sanitizeCreatorContinuity} so the
 * downstream restore can rely on the values it sees.
 */
const KNOWN_ATTACHMENT_MODES = new Set(['embedded_copy', 'supporting_visual']);
const KNOWN_BRAND_MODES = new Set(['brand-aware', 'independent']);
const KNOWN_BRAND_PRESENCE = new Set(['minimal', 'balanced', 'strong']);

/**
 * Build the leading content-block that carries the continuity bundle.
 * Callers prepend this to their `content_blocks` array on save; the API
 * round-trips it back as `creator_metadata` via {@link extractCreatorContinuity}.
 *
 * Returns a generic {@link ContentBlock}-shaped object — the `type` is a
 * marker downstream renderers don't recognize and will skip in their
 * unknown-type filter, so it never renders as user-visible content.
 */
export function buildCreatorContinuityBlock(input: CreatorContinuityMetadata): ContentBlock {
  return {
    type: CREATOR_CONTINUITY_BLOCK_TYPE,
    data: { ...input, schema_version: CREATOR_CONTINUITY_SCHEMA_VERSION },
  } as unknown as ContentBlock;
}

export interface BlockTemplate {
  id: string;
  company_id: string | null;
  created_by: string | null;
  name: string;
  description: string | null;
  content_type: string;
  format_type: string | null;
  content_blocks: ContentBlock[];
  thumbnail_url: string | null;
  is_default: boolean;
  is_public: boolean;
  usage_count: number;
  tags: string[];
  /**
   * Continuity metadata for Creator-saved assets. Populated when a
   * `creator_continuity` block is present at the head of
   * `content_blocks`. Null on legacy templates / non-Creator templates.
   *
   * The block itself is stripped from the returned `content_blocks`
   * so blog / post renderers don't have to know about the marker type.
   */
  creator_metadata: CreatorContinuityMetadata | null;
  created_at: string;
  updated_at: string;
}

/**
 * Sanitize the raw continuity payload — drop fields with values outside
 * the documented contract, but preserve everything else. The function
 * returns a NEW object (never mutates input) so callers' references stay
 * stable. Unknown / future fields pass through untouched so a slightly-
 * older deploy reading a slightly-newer write doesn't lose data.
 */
function sanitizeCreatorContinuity(raw: unknown): CreatorContinuityMetadata | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const out: CreatorContinuityMetadata = {};

  if (typeof data.asset_type === 'string') out.asset_type = data.asset_type;
  if (typeof data.attachment_mode === 'string' && KNOWN_ATTACHMENT_MODES.has(data.attachment_mode)) {
    out.attachment_mode = data.attachment_mode as 'embedded_copy' | 'supporting_visual';
  }
  if (data.asset_composition_intent && typeof data.asset_composition_intent === 'object') {
    out.asset_composition_intent = data.asset_composition_intent as Record<string, unknown>;
  }
  if (data.copy_policy && typeof data.copy_policy === 'object') {
    out.copy_policy = data.copy_policy as Record<string, unknown>;
  }
  if (typeof data.source_text_transform === 'string') out.source_text_transform = data.source_text_transform;
  if (data.overlay_text && typeof data.overlay_text === 'object') {
    out.overlay_text = data.overlay_text as CreatorContinuityMetadata['overlay_text'];
  }
  if (typeof data.subtype === 'string') out.subtype = data.subtype;
  if (typeof data.brand_mode === 'string' && KNOWN_BRAND_MODES.has(data.brand_mode)) {
    out.brand_mode = data.brand_mode as 'brand-aware' | 'independent';
  }
  if (typeof data.brand_presence === 'string' && KNOWN_BRAND_PRESENCE.has(data.brand_presence)) {
    out.brand_presence = data.brand_presence as 'minimal' | 'balanced' | 'strong';
  }
  if (typeof data.platform === 'string') out.platform = data.platform;
  if (Array.isArray(data.files)) {
    const filtered = data.files.filter((f): f is string => typeof f === 'string');
    if (filtered.length > 0) out.files = filtered;
  }
  if (typeof data.preview_kind === 'string') out.preview_kind = data.preview_kind;
  if (typeof data.platformContext === 'string') out.platformContext = data.platformContext;
  if (typeof data.renderIdentityHash === 'string') out.renderIdentityHash = data.renderIdentityHash;
  if (data.renderer_metadata && typeof data.renderer_metadata === 'object') {
    out.renderer_metadata = data.renderer_metadata as Record<string, unknown>;
  }
  if (typeof data.schema_version === 'number') out.schema_version = data.schema_version;

  return out;
}

/**
 * Extract the leading `creator_continuity` block (if any) and return the
 * structured continuity metadata + the remaining content blocks. Used by
 * `mapRow` so the API surface exposes `creator_metadata` separately and
 * downstream renderers receive clean content blocks.
 *
 * Schema-version safety (Phase polish):
 *   - schema_version = 1 → parse + sanitize (current shape)
 *   - schema_version unset → parse + sanitize (treated as v1 for compat)
 *   - schema_version is a known future version → degrade to `metadata: null`
 *     and leave blocks untouched. The marker block is still stripped so
 *     downstream renderers don't see it, but no fields are surfaced.
 *
 * Defensive parsing: anything that isn't shaped like the contract is
 * silently ignored. Legacy templates fall through with `metadata: null`
 * and the full original blocks array. Exported so call sites that read
 * raw block_templates rows (and tests) can apply the same logic.
 */
export function extractCreatorContinuity(rawBlocks: unknown): {
  metadata: CreatorContinuityMetadata | null;
  blocks: ContentBlock[];
} {
  const arr = Array.isArray(rawBlocks) ? rawBlocks : [];
  const first = arr[0];
  if (
    !first
    || typeof first !== 'object'
    || (first as Record<string, unknown>).type !== CREATOR_CONTINUITY_BLOCK_TYPE
  ) {
    return { metadata: null, blocks: arr as ContentBlock[] };
  }

  const data = (first as Record<string, unknown>).data;
  const rest = arr.slice(1) as ContentBlock[];

  // Schema-version branching. An unknown version means a newer writer
  // produced this block; we strip the marker (so renderers don't see it)
  // but surface `metadata: null` rather than guess at the shape.
  if (data && typeof data === 'object') {
    const version = (data as Record<string, unknown>).schema_version;
    if (typeof version === 'number' && !SUPPORTED_CONTINUITY_SCHEMA_VERSIONS.has(version)) {
      return { metadata: null, blocks: rest };
    }
  }

  return { metadata: sanitizeCreatorContinuity(data), blocks: rest };
}

/**
 * Best-effort legacy backfill — synthesize a minimal continuity bundle
 * from non-structured signals (description prose, tags, format_type,
 * name) when no `creator_continuity` block exists. Applied by `mapRow`
 * AFTER `extractCreatorContinuity` returns null.
 *
 * Inputs we mine for signal:
 *   - tags: `'creator-asset'` membership, `'source:<type>'`, `'audience:<x>'`,
 *           `'cta:<x>'`, `'renderer:<x>'`, `'logo:<x>'`, `'layout:<x>'`
 *   - description: legacy save sites JSON-stringified renderer metadata
 *                  here ("Renderer metadata: {...}"). Parse it back.
 *   - format_type: 'image' / 'banner' / 'infographic' / 'carousel' / 'pdf'
 *                  / 'slider' (matches `asset_type` semantics).
 *
 * Returns null when the asset doesn't look like a Creator asset (no
 * `creator-asset` tag) — preserves the "this is a non-Creator template"
 * signal. Always returns a stamped `synthesized_from_legacy: true` flag so
 * downstream consumers know they're looking at a backfilled bundle.
 */
export function synthesizeLegacyCreatorMetadata(row: {
  description: string | null;
  tags: string[];
  format_type: string | null;
  name: string;
}): CreatorContinuityMetadata | null {
  const tags = Array.isArray(row.tags) ? row.tags : [];
  if (!tags.includes('creator-asset')) return null;

  const sourceTag = tags.find((t) => t.startsWith('source:'));
  const sourceAssetType = sourceTag ? sourceTag.replace(/^source:/, '').trim() : null;
  const assetType = sourceAssetType || row.format_type || null;

  // Mine description for the legacy JSON.stringify-ed renderer metadata
  // block. Pre-cleanup saves embedded it after the marker phrase. The
  // parse is best-effort: failure means no renderer_metadata, not a throw.
  let rendererMetadata: Record<string, unknown> | null = null;
  if (typeof row.description === 'string') {
    const marker = 'Renderer metadata: ';
    const idx = row.description.indexOf(marker);
    if (idx >= 0) {
      const tail = row.description.slice(idx + marker.length).trim();
      try {
        const parsed = JSON.parse(tail);
        if (parsed && typeof parsed === 'object') {
          rendererMetadata = parsed as Record<string, unknown>;
        }
      } catch {
        // Description prose may not be valid JSON; ignore.
      }
    }
  }

  const platformContext = rendererMetadata && typeof rendererMetadata.platformContext === 'string'
    ? rendererMetadata.platformContext
    : null;

  const out: CreatorContinuityMetadata & { synthesized_from_legacy?: boolean } = {
    asset_type:       assetType,
    platform:         platformContext,
    platformContext,
    renderer_metadata: rendererMetadata,
    schema_version:   CREATOR_CONTINUITY_SCHEMA_VERSION,
    // Stamp the synthesized flag so handlers can tell modern vs legacy
    // continuity apart in `creatorEvent` logs.
    synthesized_from_legacy: true,
  };
  return out;
}

function mapRow(row: any): BlockTemplate {
  const { metadata: extractedMetadata, blocks } = extractCreatorContinuity(row.content_blocks);
  // Legacy backfill: when the structured bundle is absent BUT the row
  // looks like a Creator asset (has the `creator-asset` tag), synthesize
  // a minimal bundle from tags + description + format_type. NEVER
  // overwrites structured metadata — only fills the null slot.
  const creatorMetadata = extractedMetadata
    ?? synthesizeLegacyCreatorMetadata({
      description: row.description ?? null,
      tags:        row.tags ?? [],
      format_type: row.format_type ?? null,
      name:        row.name ?? '',
    });
  return {
    id: row.id,
    company_id: row.company_id ?? null,
    created_by: row.created_by ?? null,
    name: row.name,
    description: row.description ?? null,
    content_type: row.content_type,
    format_type: row.format_type ?? null,
    content_blocks: blocks,
    thumbnail_url: row.thumbnail_url ?? null,
    is_default: row.is_default === true,
    is_public: row.is_public === true,
    usage_count: row.usage_count ?? 0,
    tags: row.tags ?? [],
    creator_metadata: creatorMetadata,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listBlockTemplates(
  companyId: string,
  options: { content_type?: string; format_type?: string } = {},
): Promise<BlockTemplate[]> {
  let query = ownedDbTable('block_templates')
    .select('*')
    .or(`company_id.eq.${companyId},is_default.eq.true`);

  if (options.content_type) {
    query = query.eq('content_type', options.content_type);
  }
  if (options.format_type) {
    query = query.eq('format_type', options.format_type);
  }

  const { data, error } = await query.order('is_default', { ascending: false }).order('usage_count', { ascending: false });
  if (error) throw new Error(`Failed to list block templates: ${error.message}`);
  return (data || []).map(mapRow);
}

// ── Get ──────────────────────────────────────────────────────────────────────

export async function getBlockTemplate(id: string): Promise<BlockTemplate | null> {
  const { data, error } = await ownedDbTable('block_templates')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return mapRow(data);
}

// ── Create ───────────────────────────────────────────────────────────────────

export async function createBlockTemplate(
  userId: string,
  companyId: string,
  template: {
    name: string;
    description?: string;
    content_type: string;
    format_type?: string;
    content_blocks: ContentBlock[];
    tags?: string[];
    is_public?: boolean;
  },
): Promise<BlockTemplate> {
  const { data, error } = await ownedDbTable('block_templates')
    .insert({
      company_id: companyId,
      created_by: userId,
      name: template.name,
      description: template.description ?? null,
      content_type: template.content_type,
      format_type: template.format_type ?? null,
      content_blocks: template.content_blocks,
      tags: template.tags ?? [],
      is_public: template.is_public ?? false,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create block template: ${error.message}`);
  return mapRow(data);
}

// ── Update ───────────────────────────────────────────────────────────────────

export async function updateBlockTemplate(
  id: string,
  updates: Partial<Pick<BlockTemplate, 'name' | 'description' | 'content_blocks' | 'tags' | 'is_public'>>,
): Promise<BlockTemplate> {
  const { data, error } = await ownedDbTable('block_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('is_default', false) // cannot update system defaults
    .select()
    .single();
  if (error) throw new Error(`Failed to update block template: ${error.message}`);
  return mapRow(data);
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteBlockTemplate(id: string): Promise<void> {
  const { error } = await ownedDbTable('block_templates')
    .delete()
    .eq('id', id)
    .eq('is_default', false); // cannot delete system defaults
  if (error) throw new Error(`Failed to delete block template: ${error.message}`);
}

// ── Increment usage ─────────────────────────────────────────────────────────

export async function incrementTemplateUsage(id: string): Promise<void> {
  const { error } = await supabase.rpc('increment_block_template_usage', { template_id: id });
  if (error) {
    // Fallback: manual increment
    const tpl = await getBlockTemplate(id);
    if (tpl) {
      await ownedDbTable('block_templates')
        .update({ usage_count: tpl.usage_count + 1 })
        .eq('id', id);
    }
  }
}
