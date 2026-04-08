import { supabase } from '../db/supabaseClient';
import { encryptCredential, decryptCredential } from '../auth/credentialEncryption';

export interface LlmProvider {
  id: string;
  name: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmModel {
  id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LlmModelWithProvider extends LlmModel {
  provider_name: string;
  provider_display_name: string;
}

/**
 * Returns all providers (active + inactive) for super admin display.
 */
export async function getAllProviders(): Promise<LlmProvider[]> {
  const { data, error } = await supabase
    .from('llm_providers')
    .select('*')
    .order('name');
  if (error) throw new Error(`llmProviderService.getAllProviders: ${error.message}`);
  return data ?? [];
}

/**
 * Returns only active providers.
 */
export async function getActiveProviders(): Promise<LlmProvider[]> {
  const { data, error } = await supabase
    .from('llm_providers')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (error) throw new Error(`llmProviderService.getActiveProviders: ${error.message}`);
  return data ?? [];
}

/**
 * Returns all active models for a given provider name (e.g. "openai").
 */
export async function getModelsByProvider(providerName: string): Promise<LlmModel[]> {
  const { data: provider, error: provErr } = await supabase
    .from('llm_providers')
    .select('id')
    .eq('name', providerName)
    .eq('is_active', true)
    .maybeSingle();
  if (provErr) throw new Error(`llmProviderService.getModelsByProvider: ${provErr.message}`);
  if (!provider) return [];

  const { data, error } = await supabase
    .from('llm_models')
    .select('*')
    .eq('provider_id', provider.id)
    .eq('is_active', true)
    .order('model_key');
  if (error) throw new Error(`llmProviderService.getModelsByProvider: ${error.message}`);
  return data ?? [];
}

/**
 * Returns all active models across all active providers, with provider name attached.
 */
export async function getAllActiveModels(): Promise<LlmModelWithProvider[]> {
  const { data, error } = await supabase
    .from('llm_models')
    .select(`
      *,
      llm_providers!inner(name, display_name, is_active)
    `)
    .eq('is_active', true)
    .eq('llm_providers.is_active', true)
    .order('model_key');
  if (error) throw new Error(`llmProviderService.getAllActiveModels: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    id:                   row.id,
    provider_id:          row.provider_id,
    model_key:            row.model_key,
    display_name:         row.display_name,
    is_active:            row.is_active,
    metadata:             row.metadata ?? {},
    created_at:           row.created_at,
    updated_at:           row.updated_at,
    provider_name:        row.llm_providers.name,
    provider_display_name: row.llm_providers.display_name,
  }));
}

/**
 * All models (active + inactive) across all providers — for super admin listing.
 */
export async function getAllModels(): Promise<LlmModelWithProvider[]> {
  const { data, error } = await supabase
    .from('llm_models')
    .select(`
      *,
      llm_providers(name, display_name)
    `)
    .order('model_key');
  if (error) throw new Error(`llmProviderService.getAllModels: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    id:                   row.id,
    provider_id:          row.provider_id,
    model_key:            row.model_key,
    display_name:         row.display_name,
    is_active:            row.is_active,
    metadata:             row.metadata ?? {},
    created_at:           row.created_at,
    updated_at:           row.updated_at,
    provider_name:        row.llm_providers?.name ?? '',
    provider_display_name: row.llm_providers?.display_name ?? '',
  }));
}

/**
 * Upsert a provider by name. Returns the provider id.
 */
export async function upsertProvider(input: {
  name: string;
  display_name: string;
  is_active?: boolean;
}): Promise<LlmProvider> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('llm_providers')
    .upsert(
      {
        name:         input.name,
        display_name: input.display_name,
        is_active:    input.is_active ?? true,
        updated_at:   now,
      },
      { onConflict: 'name' }
    )
    .select()
    .single();
  if (error) throw new Error(`llmProviderService.upsertProvider: ${error.message}`);
  return data;
}

// ─── Company LLM Config ──────────────────────────────────────────────────────

export interface CompanyLlmConfig {
  id: string;
  company_id: string;
  provider_id: string;
  model_id: string;
  has_custom_api_key: boolean;
  is_active: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  provider_name: string;
  provider_display_name: string;
  model_key: string;
  model_display_name: string;
  model_metadata: Record<string, unknown>;
}

/**
 * Get the current LLM config for a company.
 * Returns null if no config is set (means company uses platform default).
 */
export async function getCompanyLlmConfig(companyId: string): Promise<CompanyLlmConfig | null> {
  const { data, error } = await supabase
    .from('company_llm_configs')
    .select(`
      *,
      llm_providers(name, display_name),
      llm_models(model_key, display_name, metadata)
    `)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw new Error(`llmProviderService.getCompanyLlmConfig: ${error.message}`);
  if (!data) return null;

  return {
    id:                   data.id,
    company_id:           data.company_id,
    provider_id:          data.provider_id,
    model_id:             data.model_id,
    has_custom_api_key:   !!data.api_key_encrypted,
    is_active:            data.is_active,
    updated_by:           data.updated_by ?? null,
    created_at:           data.created_at,
    updated_at:           data.updated_at,
    provider_name:        (data as any).llm_providers?.name ?? '',
    provider_display_name: (data as any).llm_providers?.display_name ?? '',
    model_key:            (data as any).llm_models?.model_key ?? '',
    model_display_name:   (data as any).llm_models?.display_name ?? '',
    model_metadata:       (data as any).llm_models?.metadata ?? {},
  };
}

/**
 * Save (upsert) company LLM config.
 * Pass api_key = null to keep existing key. Pass api_key = '' to remove it.
 */
export async function setCompanyLlmConfig(input: {
  company_id: string;
  provider_id: string;
  model_id: string;
  api_key?: string | null;
  is_active?: boolean;
  updated_by?: string | null;
}): Promise<CompanyLlmConfig> {
  const now = new Date().toISOString();

  // Resolve existing encrypted key so we can preserve it when api_key is not passed
  let api_key_encrypted: string | null | undefined = undefined; // undefined = don't touch
  if (input.api_key !== undefined) {
    if (input.api_key === null || input.api_key === '') {
      api_key_encrypted = null; // explicitly remove
    } else {
      api_key_encrypted = encryptCredential(input.api_key.trim());
    }
  }

  const upsertPayload: Record<string, unknown> = {
    company_id:   input.company_id,
    provider_id:  input.provider_id,
    model_id:     input.model_id,
    is_active:    input.is_active ?? true,
    updated_by:   input.updated_by ?? null,
    updated_at:   now,
  };
  if (api_key_encrypted !== undefined) {
    upsertPayload.api_key_encrypted = api_key_encrypted;
  }

  const { error } = await supabase
    .from('company_llm_configs')
    .upsert(upsertPayload, { onConflict: 'company_id' });
  if (error) throw new Error(`llmProviderService.setCompanyLlmConfig: ${error.message}`);

  const config = await getCompanyLlmConfig(input.company_id);
  if (!config) throw new Error('llmProviderService.setCompanyLlmConfig: config not found after upsert');
  return config;
}

/**
 * Resolve the effective API key for a company:
 * 1. Company's own BYOK key (decrypted) if set
 * 2. Platform default from env (OPENAI_API_KEY etc.)
 * Returns { key, source }
 */
export async function resolveCompanyApiKey(
  companyId: string,
  providerName: string,
): Promise<{ key: string; source: 'company' | 'platform' }> {
  const { data } = await supabase
    .from('company_llm_configs')
    .select('api_key_encrypted, is_active, llm_providers!inner(name)')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle();

  if (data?.api_key_encrypted) {
    try {
      const key = decryptCredential(data.api_key_encrypted);
      if (key) return { key, source: 'company' };
    } catch {
      // Fall through to platform default if decryption fails
    }
  }

  // Platform default — map provider name to env var
  const envMap: Record<string, string | undefined> = {
    openai:    process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  };
  const key = envMap[providerName] ?? '';
  return { key, source: 'platform' };
}

/**
 * Upsert a model by (provider_id, model_key). Returns the model row.
 */
export async function upsertModel(input: {
  provider_id: string;
  model_key: string;
  display_name: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<LlmModel> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('llm_models')
    .upsert(
      {
        provider_id:  input.provider_id,
        model_key:    input.model_key,
        display_name: input.display_name,
        is_active:    input.is_active ?? true,
        metadata:     input.metadata ?? {},
        updated_at:   now,
      },
      { onConflict: 'provider_id,model_key' }
    )
    .select()
    .single();
  if (error) throw new Error(`llmProviderService.upsertModel: ${error.message}`);
  return data;
}
