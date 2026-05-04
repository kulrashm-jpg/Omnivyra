/**
 * Block Template Service
 *
 * CRUD for reusable block-layout templates. Company-scoped with
 * system-provided defaults (is_default = true).
 * Follows the strategyTemplateService pattern.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import type { ContentBlock } from '../../lib/blog/blockTypes';

// ── Types ────────────────────────────────────────────────────────────────────

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
  created_at: string;
  updated_at: string;
}

function mapRow(row: any): BlockTemplate {
  return {
    id: row.id,
    company_id: row.company_id ?? null,
    created_by: row.created_by ?? null,
    name: row.name,
    description: row.description ?? null,
    content_type: row.content_type,
    format_type: row.format_type ?? null,
    content_blocks: (row.content_blocks ?? []) as ContentBlock[],
    thumbnail_url: row.thumbnail_url ?? null,
    is_default: row.is_default === true,
    is_public: row.is_public === true,
    usage_count: row.usage_count ?? 0,
    tags: row.tags ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listBlockTemplates(
  companyId: string,
  options: { content_type?: string; format_type?: string } = {},
): Promise<BlockTemplate[]> {
  let query = supabase
    .from('block_templates')
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
  const { data, error } = await supabase
    .from('block_templates')
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
  const { data, error } = await supabase
    .from('block_templates')
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
  const { data, error } = await supabase
    .from('block_templates')
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
  const { error } = await supabase
    .from('block_templates')
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
      await supabase
        .from('block_templates')
        .update({ usage_count: tpl.usage_count + 1 })
        .eq('id', id);
    }
  }
}
