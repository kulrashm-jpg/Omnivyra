/**
 * Lead Capture Service — forms + leads tables
 * Handles: SaaS form builder, embed submissions, inbound webhook validation, manual entry
 */
import { supabase } from '../db/supabaseClient';

export type FieldType = 'text' | 'email' | 'phone';

export interface FormField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
}

export interface FormBrand {
  heading?: string;          // Title shown to visitors (e.g. "Get in Touch")
  description?: string;      // Optional tagline below heading
  submit_label?: string;     // Button text (default "Submit")
  success_message?: string;  // Shown after submit
  primary_color?: string;    // Hex color for button + focus (default #6366f1)
  font?: 'system' | 'sans' | 'serif';
}

export interface CaptureForm {
  id: string;
  company_id: string;
  created_by: string;
  name: string;
  fields: FormField[];
  brand: FormBrand;
  integration_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  company_id: string;
  created_by: string | null;
  name: string;
  email: string;
  phone: string | null;
  source: string;
  integration_id: string | null;
  form_id: string | null;
  metadata: Record<string, unknown>;
  is_test: boolean;
  created_at: string;
}

// ─── FORMS ────────────────────────────────────────────────────────────────────

export async function createForm(
  companyId: string,
  userId: string,
  name: string,
  fields: FormField[],
  integrationId?: string | null,
  brand?: FormBrand,
): Promise<CaptureForm> {
  const { data, error } = await supabase
    .from('forms')
    .insert({ company_id: companyId, created_by: userId, name, fields, brand: brand ?? {}, integration_id: integrationId ?? null })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CaptureForm;
}

export async function getForm(id: string, companyId?: string): Promise<CaptureForm | null> {
  let q = supabase.from('forms').select('*').eq('id', id);
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q.single();
  if (error) return null;
  return data as CaptureForm;
}

export async function getForms(companyId: string): Promise<CaptureForm[]> {
  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as CaptureForm[];
}

export async function updateForm(
  id: string,
  companyId: string,
  updates: { name?: string; fields?: FormField[]; brand?: FormBrand; integration_id?: string | null },
): Promise<CaptureForm> {
  const { data, error } = await supabase
    .from('forms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CaptureForm;
}

export async function deleteForm(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from('forms').delete().eq('id', id).eq('company_id', companyId);
  if (error) throw new Error(error.message);
}

// ─── LEADS ────────────────────────────────────────────────────────────────────

export interface CreateLeadInput {
  name: string;
  email: string;
  phone?: string;
  source?: string;
  form_id?: string | null;
  integration_id?: string | null;
  created_by?: string | null;
  metadata?: Record<string, unknown>;
  is_test?: boolean;
}

export async function createLead(companyId: string, input: CreateLeadInput): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      company_id: companyId,
      created_by: input.created_by ?? null,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      source: input.source ?? 'direct',
      form_id: input.form_id ?? null,
      integration_id: input.integration_id ?? null,
      metadata: input.metadata ?? {},
      is_test: input.is_test ?? false,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Lead;
}

export async function getLeads(
  companyId: string,
  filters?: {
    form_id?: string;
    integration_id?: string;
    source?: string;
    since?: string;
    search?: string;
    is_test?: boolean;
  },
): Promise<Lead[]> {
  let q = supabase
    .from('leads')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (filters?.form_id) q = q.eq('form_id', filters.form_id);
  if (filters?.integration_id) q = q.eq('integration_id', filters.integration_id);
  if (filters?.source) q = q.eq('source', filters.source);
  if (filters?.since) q = q.gte('created_at', filters.since);
  if (filters?.is_test !== undefined) q = q.eq('is_test', filters.is_test);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []) as Lead[];
}

export async function getLead(id: string, companyId: string): Promise<Lead | null> {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).eq('company_id', companyId).single();
  if (error) return null;
  return data as Lead;
}

export async function deleteLead(id: string, companyId: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id).eq('company_id', companyId);
  if (error) throw new Error(error.message);
}

// ─── INBOUND WEBHOOK AUTH ─────────────────────────────────────────────────────

/**
 * Validate inbound webhook credentials.
 * Checks: integration exists, type is lead_webhook, secret matches config.secret.
 * Returns company_id on success, null on failure.
 */
export async function validateWebhookAuth(
  integrationId: string,
  webhookSecret: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('company_integrations')
    .select('company_id, config, type')
    .eq('id', integrationId)
    .single();
  if (error || !data) return null;
  if (data.type !== 'lead_webhook') return null;
  const cfg = data.config as Record<string, string>;
  if (!cfg?.secret || cfg.secret !== webhookSecret) return null;
  return data.company_id as string;
}
