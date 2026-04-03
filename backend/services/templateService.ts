/**
 * Template Service
 * 
 * Manages reusable content templates with variable substitution.
 * 
 * Features:
 * - Create, read, update, delete templates
 * - Variable substitution ({brand_name}, {product_name}, etc.)
 * - Template usage tracking
 * - Platform-specific templates
 */

import { supabase } from '../db/supabaseClient';
import { sanitizeTextArtifacts } from './export/renderTextSanitizer';

export interface ContentTemplate {
  id: string;
  user_id: string;
  campaign_id?: string;
  name: string;
  description?: string;
  content: string;
  platform: string;
  content_type: string;
  hashtags?: string[];
  media_requirements?: Record<string, any>;
  variables?: Record<string, any>;
  tags?: string[];
  is_public: boolean;
  usage_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface TemplateVariable {
  name: string;
  description?: string;
  default_value?: string;
  required: boolean;
}

/**
 * Create a new content template
 */
export async function createTemplate(
  userId: string,
  template: {
    name: string;
    description?: string;
    content: string;
    platform: string;
    content_type: string;
    campaign_id?: string;
    hashtags?: string[];
    media_requirements?: Record<string, any>;
    variables?: Record<string, any>;
    tags?: string[];
    is_public?: boolean;
  }
): Promise<ContentTemplate> {
  const { data, error } = await supabase
    .from('content_templates')
    .insert({
      user_id: userId,
      campaign_id: template.campaign_id || null,
      name: template.name,
      description: template.description || null,
      content: template.content,
      platform: template.platform,
      content_type: template.content_type,
      hashtags: template.hashtags || [],
      media_requirements: template.media_requirements || {},
      variables: template.variables || {},
      tags: template.tags || [],
      is_public: template.is_public || false,
      usage_count: 0,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create template: ${error.message}`);
  }

  return mapTemplate(data);
}

/**
 * Get template by ID
 */
export async function getTemplate(templateId: string): Promise<ContentTemplate | null> {
  const { data, error } = await supabase
    .from('content_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapTemplate(data);
}

/**
 * List templates for a user
 */
export async function listTemplates(
  userId: string,
  options: {
    platform?: string;
    campaign_id?: string;
    is_public?: boolean;
    tags?: string[];
  } = {}
): Promise<ContentTemplate[]> {
  let query = supabase
    .from('content_templates')
    .select('*')
    .or(`user_id.eq.${userId},is_public.eq.true`);

  if (options.platform) {
    query = query.eq('platform', options.platform);
  }

  if (options.campaign_id) {
    query = query.eq('campaign_id', options.campaign_id);
  }

  if (options.is_public !== undefined) {
    query = query.eq('is_public', options.is_public);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list templates: ${error.message}`);
  }

  return (data || []).map(mapTemplate);
}

/**
 * Update template
 */
export async function updateTemplate(
  templateId: string,
  updates: {
    name?: string;
    description?: string;
    content?: string;
    hashtags?: string[];
    media_requirements?: Record<string, any>;
    variables?: Record<string, any>;
    tags?: string[];
    is_public?: boolean;
  }
): Promise<ContentTemplate> {
  const { data, error } = await supabase
    .from('content_templates')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update template: ${error.message}`);
  }

  return mapTemplate(data);
}

/**
 * Delete template
 */
export async function deleteTemplate(templateId: string): Promise<void> {
  const { error } = await supabase
    .from('content_templates')
    .delete()
    .eq('id', templateId);

  if (error) {
    throw new Error(`Failed to delete template: ${error.message}`);
  }
}

/**
 * Render template with variable substitution
 */
export function renderTemplate(
  template: ContentTemplate,
  variables: Record<string, string>
): {
  content: string;
  hashtags: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  let content = template.content;

  // Extract variables from template content
  const variablePattern = /\{([^}]+)\}/g;
  const templateVariables = new Set<string>();
  let match;

  while ((match = variablePattern.exec(template.content)) !== null) {
    templateVariables.add(match[1]);
  }

  // Check for missing required variables
  if (template.variables) {
    Object.keys(template.variables).forEach(varName => {
      const varDef = template.variables![varName] as TemplateVariable;
      if (varDef.required && !variables[varName]) {
        warnings.push(`Missing required variable: ${varName}`);
      }
    });
  }

  // Substitute variables
  templateVariables.forEach(varName => {
    const value = variables[varName] || 
                 (template.variables?.[varName] as TemplateVariable)?.default_value || 
                 '';
    
    if (!variables[varName] && !(template.variables?.[varName] as TemplateVariable)?.default_value) {
      warnings.push(`Variable ${varName} not provided and has no default`);
    }

    content = content.replace(new RegExp(`\\{${varName}\\}`, 'g'), value);
  });

  // Process hashtags (substitute variables in hashtags too)
  let hashtags = template.hashtags || [];
  hashtags = hashtags.map(tag => {
    let processedTag = tag;
    templateVariables.forEach(varName => {
      const value = variables[varName] || 
                   (template.variables?.[varName] as TemplateVariable)?.default_value || 
                   '';
      processedTag = processedTag.replace(new RegExp(`\\{${varName}\\}`, 'g'), value);
    });
    return processedTag.startsWith('#') ? processedTag : `#${processedTag}`;
  });

  return {
    content: sanitizeTextArtifacts(content.trim()),
    hashtags,
    warnings,
  };
}

/**
 * Increment template usage count
 */
export async function incrementTemplateUsage(templateId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_template_usage', {
    template_id: templateId,
  });

  // Fallback if RPC doesn't exist
  if (error) {
    const template = await getTemplate(templateId);
    if (template) {
      await supabase
        .from('content_templates')
        .update({ usage_count: template.usage_count + 1 })
        .eq('id', templateId);
    }
  }
}

/**
 * Map database row to ContentTemplate
 */
function mapTemplate(row: any): ContentTemplate {
  return {
    id: row.id,
    user_id: row.user_id,
    campaign_id: row.campaign_id,
    name: row.name,
    description: row.description,
    content: row.content,
    platform: row.platform,
    content_type: row.content_type,
    hashtags: row.hashtags || [],
    media_requirements: row.media_requirements || {},
    variables: row.variables || {},
    tags: row.tags || [],
    is_public: row.is_public || false,
    usage_count: row.usage_count || 0,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

