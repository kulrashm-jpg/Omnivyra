/**
 * Intelligence Governance Service
 * Phase-2: Super Admin Governance Layer
 *
 * Responsibilities:
 * - Manage intelligence categories (intelligence_categories)
 * - Manage plan limits (plan_limits) — unified limits and feature flags
 * - Expose configuration for admin APIs
 *
 * Does NOT call external APIs. Database only.
 */

import { supabase } from '../db/supabaseClient';

export type IntelligenceCategory = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  created_at: string;
};

export type PlanLimit = {
  id: string;
  plan_id: string;
  resource_key: string;
  limit_value: number | null;
  created_at: string;
};

export type QueryTemplate = {
  id: string;
  api_source_id: string | null;
  category: string | null;
  template: string;
  enabled: boolean;
  created_at: string;
};

export type ApiPreset = {
  id: string;
  name: string;
  base_url: string;
  purpose: string;
  category: string | null;
  is_active: boolean;
  is_preset: boolean;
  created_at: string;
};

// --- Intelligence Categories ---

export async function getCategories(enabledOnly = false): Promise<IntelligenceCategory[]> {
  let query = supabase
    .from('intelligence_categories')
    .select('id, name, description, enabled, created_at')
    .order('name');
  if (enabledOnly) {
    query = query.eq('enabled', true);
  }
  const { data, error } = await query;
  if (error) throw new Error(`getCategories failed: ${error.message}`);
  return (data ?? []) as IntelligenceCategory[];
}

export async function createCategory(params: {
  name: string;
  description?: string | null;
  enabled?: boolean;
}): Promise<IntelligenceCategory> {
  const { data, error } = await supabase
    .from('intelligence_categories')
    .insert({
      name: params.name.trim().toUpperCase(),
      description: params.description?.trim() || null,
      enabled: params.enabled ?? true,
    })
    .select('id, name, description, enabled, created_at')
    .single();
  if (error) throw new Error(`createCategory failed: ${error.message}`);
  return data as IntelligenceCategory;
}

export async function updateCategory(
  id: string,
  params: { name?: string; description?: string | null }
): Promise<IntelligenceCategory> {
  const updates: Record<string, unknown> = {};
  if (params.name !== undefined) updates.name = params.name.trim().toUpperCase();
  if (params.description !== undefined) updates.description = params.description?.trim() || null;
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase
      .from('intelligence_categories')
      .select('id, name, description, enabled, created_at')
      .eq('id', id)
      .single();
    if (!data) throw new Error('Category not found');
    return data as IntelligenceCategory;
  }
  const { data, error } = await supabase
    .from('intelligence_categories')
    .update(updates)
    .eq('id', id)
    .select('id, name, description, enabled, created_at')
    .single();
  if (error) throw new Error(`updateCategory failed: ${error.message}`);
  return data as IntelligenceCategory;
}

export async function setCategoryEnabled(id: string, enabled: boolean): Promise<IntelligenceCategory> {
  const { data, error } = await supabase
    .from('intelligence_categories')
    .update({ enabled })
    .eq('id', id)
    .select('id, name, description, enabled, created_at')
    .single();
  if (error) throw new Error(`setCategoryEnabled failed: ${error.message}`);
  return data as IntelligenceCategory;
}

// --- Plan Limits (unified limits and feature flags) ---

export type PlanWithLimits = {
  id: string;
  plan_key: string;
  name: string;
  description: string | null;
  is_active: boolean;
  limits: PlanLimit[];
};

export async function listPlansWithLimits(): Promise<PlanWithLimits[]> {
  const { data: plans, error: plansErr } = await supabase
    .from('pricing_plans')
    .select('id, plan_key, name, description, is_active')
    .eq('is_active', true)
    .order('plan_key');
  if (plansErr) throw new Error(`listPlansWithLimits failed: ${plansErr.message}`);
  const result: PlanWithLimits[] = [];
  for (const p of plans ?? []) {
    const limits = await getPlanLimits(p.id);
    result.push({
      id: p.id,
      plan_key: p.plan_key,
      name: p.name,
      description: p.description,
      is_active: p.is_active,
      limits,
    });
  }
  return result;
}

export async function getPlanLimits(planId: string): Promise<PlanLimit[]> {
  const { data, error } = await supabase
    .from('plan_limits')
    .select('id, plan_id, resource_key, limit_value, created_at')
    .eq('plan_id', planId)
    .order('resource_key');
  if (error) throw new Error(`getPlanLimits failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    ...r,
    limit_value: r.limit_value != null ? Number(r.limit_value) : null,
  })) as PlanLimit[];
}

export async function setPlanLimit(
  planId: string,
  resourceKey: string,
  value: number | null
): Promise<PlanLimit> {
  const { data, error } = await supabase
    .from('plan_limits')
    .upsert(
      { plan_id: planId, resource_key: resourceKey.trim(), limit_value: value },
      { onConflict: 'plan_id,resource_key' }
    )
    .select('id, plan_id, resource_key, limit_value, created_at')
    .single();
  if (error) throw new Error(`setPlanLimit failed: ${error.message}`);
  return {
    ...data,
    limit_value: data.limit_value != null ? Number(data.limit_value) : null,
  } as PlanLimit;
}

// --- Query Templates ---

export async function listQueryTemplates(): Promise<QueryTemplate[]> {
  const { data, error } = await supabase
    .from('intelligence_query_templates')
    .select('id, api_source_id, category, template, enabled, created_at')
    .order('created_at');
  if (error) throw new Error(`listQueryTemplates failed: ${error.message}`);
  return (data ?? []) as QueryTemplate[];
}

export async function createQueryTemplate(params: {
  api_source_id?: string | null;
  category?: string | null;
  template: string;
  enabled?: boolean;
}): Promise<QueryTemplate> {
  const { data, error } = await supabase
    .from('intelligence_query_templates')
    .insert({
      api_source_id: params.api_source_id ?? null,
      category: params.category?.trim() || null,
      template: params.template.trim(),
      enabled: params.enabled ?? true,
    })
    .select('id, api_source_id, category, template, enabled, created_at')
    .single();
  if (error) throw new Error(`createQueryTemplate failed: ${error.message}`);
  return data as QueryTemplate;
}

export async function updateQueryTemplate(
  id: string,
  params: { category?: string | null; template?: string }
): Promise<QueryTemplate> {
  const updates: Record<string, unknown> = {};
  if (params.category !== undefined) updates.category = params.category?.trim() || null;
  if (params.template !== undefined) updates.template = params.template.trim();
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase
      .from('intelligence_query_templates')
      .select('id, api_source_id, category, template, enabled, created_at')
      .eq('id', id)
      .single();
    if (!data) throw new Error('Query template not found');
    return data as QueryTemplate;
  }
  const { data, error } = await supabase
    .from('intelligence_query_templates')
    .update(updates)
    .eq('id', id)
    .select('id, api_source_id, category, template, enabled, created_at')
    .single();
  if (error) throw new Error(`updateQueryTemplate failed: ${error.message}`);
  return data as QueryTemplate;
}

export async function setQueryTemplateEnabled(id: string, enabled: boolean): Promise<QueryTemplate> {
  const { data, error } = await supabase
    .from('intelligence_query_templates')
    .update({ enabled })
    .eq('id', id)
    .select('id, api_source_id, category, template, enabled, created_at')
    .single();
  if (error) throw new Error(`setQueryTemplateEnabled failed: ${error.message}`);
  return data as QueryTemplate;
}

// --- API Presets ---

export async function listApiPresets(): Promise<ApiPreset[]> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .select('id, name, base_url, purpose, category, is_active, is_preset, created_at')
    .eq('is_preset', true)
    .order('name');
  if (error) throw new Error(`listApiPresets failed: ${error.message}`);
  return (data ?? []) as ApiPreset[];
}

export async function createApiPreset(params: {
  name: string;
  base_url: string;
  purpose?: string;
  category?: string | null;
  is_active?: boolean;
  method?: string;
  auth_type?: string;
  api_key_env_name?: string | null;
  headers?: Record<string, string>;
  query_params?: Record<string, string | number>;
}): Promise<ApiPreset> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .insert({
      name: params.name.trim(),
      base_url: params.base_url.trim(),
      purpose: params.purpose?.trim() || 'trends',
      category: params.category?.trim() || null,
      is_active: params.is_active ?? true,
      is_preset: true,
      method: params.method || 'GET',
      auth_type: params.auth_type || 'none',
      api_key_env_name: params.api_key_env_name || null,
      headers: params.headers ?? {},
      query_params: params.query_params ?? {},
      retry_count: 2,
      timeout_ms: 8000,
      rate_limit_per_min: 60,
    })
    .select('id, name, base_url, purpose, category, is_active, is_preset, created_at')
    .single();
  if (error) throw new Error(`createApiPreset failed: ${error.message}`);
  return data as ApiPreset;
}

export async function updateApiPreset(
  id: string,
  params: {
    name?: string;
    base_url?: string;
    purpose?: string;
    category?: string | null;
    is_active?: boolean;
  }
): Promise<ApiPreset> {
  const updates: Record<string, unknown> = {};
  if (params.name !== undefined) updates.name = params.name.trim();
  if (params.base_url !== undefined) updates.base_url = params.base_url.trim();
  if (params.purpose !== undefined) updates.purpose = params.purpose?.trim();
  if (params.category !== undefined) updates.category = params.category?.trim() || null;
  if (params.is_active !== undefined) updates.is_active = params.is_active;
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase
      .from('external_api_sources')
      .select('id, name, base_url, purpose, category, is_active, is_preset, created_at')
      .eq('id', id)
      .eq('is_preset', true)
      .single();
    if (!data) throw new Error('API preset not found');
    return data as ApiPreset;
  }
  const { data, error } = await supabase
    .from('external_api_sources')
    .update(updates)
    .eq('id', id)
    .eq('is_preset', true)
    .select('id, name, base_url, purpose, category, is_active, is_preset, created_at')
    .single();
  if (error) throw new Error(`updateApiPreset failed: ${error.message}`);
  return data as ApiPreset;
}

export async function setApiPresetEnabled(id: string, is_active: boolean): Promise<ApiPreset> {
  const { data, error } = await supabase
    .from('external_api_sources')
    .update({ is_active })
    .eq('id', id)
    .eq('is_preset', true)
    .select('id, name, base_url, purpose, category, is_active, is_preset, created_at')
    .single();
  if (error) throw new Error(`setApiPresetEnabled failed: ${error.message}`);
  return data as ApiPreset;
}
