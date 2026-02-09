import { supabase } from '../db/supabaseClient';

export interface StrategyTemplate {
  id: string;
  user_id: string;
  company_id?: string | null;
  name: string;
  description?: string | null;
  objective: string;
  campaign_intent?: string | null;
  target_audience: string;
  key_platforms: string[];
  content_pillars?: Record<string, any> | null;
  content_frequency?: Record<string, any> | null;
  distribution_preferences?: Record<string, any> | null;
  tags?: string[] | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

const mapTemplate = (row: any): StrategyTemplate => ({
  id: row.id,
  user_id: row.user_id,
  company_id: row.company_id ?? null,
  name: row.name,
  description: row.description ?? null,
  objective: row.objective,
  campaign_intent: row.campaign_intent ?? null,
  target_audience: row.target_audience,
  key_platforms: row.key_platforms || [],
  content_pillars: row.content_pillars ?? null,
  content_frequency: row.content_frequency ?? null,
  distribution_preferences: row.distribution_preferences ?? null,
  tags: row.tags ?? [],
  is_public: row.is_public === true,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export async function listStrategyTemplates(
  userId: string,
  options: { company_id?: string; is_public?: boolean; tags?: string[] } = {}
): Promise<StrategyTemplate[]> {
  let query = supabase
    .from('strategy_templates')
    .select('*')
    .or(`user_id.eq.${userId},is_public.eq.true`);

  if (options.company_id) {
    query = query.eq('company_id', options.company_id);
  }
  if (options.is_public !== undefined) {
    query = query.eq('is_public', options.is_public);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list strategy templates: ${error.message}`);
  }
  return (data || []).map(mapTemplate);
}

export async function getStrategyTemplate(
  templateId: string
): Promise<StrategyTemplate | null> {
  const { data, error } = await supabase
    .from('strategy_templates')
    .select('*')
    .eq('id', templateId)
    .single();
  if (error || !data) return null;
  return mapTemplate(data);
}

export async function createStrategyTemplate(
  userId: string,
  template: {
    company_id?: string | null;
    name: string;
    description?: string | null;
    objective: string;
    campaign_intent?: string | null;
    target_audience: string;
    key_platforms: string[];
    content_pillars?: Record<string, any> | null;
    content_frequency?: Record<string, any> | null;
    distribution_preferences?: Record<string, any> | null;
    tags?: string[];
    is_public?: boolean;
  }
): Promise<StrategyTemplate> {
  const { data, error } = await supabase
    .from('strategy_templates')
    .insert({
      user_id: userId,
      company_id: template.company_id ?? null,
      name: template.name,
      description: template.description ?? null,
      objective: template.objective,
      campaign_intent: template.campaign_intent ?? null,
      target_audience: template.target_audience,
      key_platforms: template.key_platforms,
      content_pillars: template.content_pillars ?? null,
      content_frequency: template.content_frequency ?? null,
      distribution_preferences: template.distribution_preferences ?? null,
      tags: template.tags ?? [],
      is_public: template.is_public ?? false,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to create strategy template: ${error.message}`);
  }
  return mapTemplate(data);
}

export async function updateStrategyTemplate(
  templateId: string,
  updates: {
    name?: string;
    description?: string | null;
    objective?: string;
    campaign_intent?: string | null;
    target_audience?: string;
    key_platforms?: string[];
    content_pillars?: Record<string, any> | null;
    content_frequency?: Record<string, any> | null;
    distribution_preferences?: Record<string, any> | null;
    tags?: string[];
    is_public?: boolean;
  }
): Promise<StrategyTemplate> {
  const { data, error } = await supabase
    .from('strategy_templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', templateId)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update strategy template: ${error.message}`);
  }
  return mapTemplate(data);
}

export async function deleteStrategyTemplate(templateId: string): Promise<void> {
  const { error } = await supabase.from('strategy_templates').delete().eq('id', templateId);
  if (error) {
    throw new Error(`Failed to delete strategy template: ${error.message}`);
  }
}
