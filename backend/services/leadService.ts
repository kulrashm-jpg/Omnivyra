import { ownedDbTable } from '../db/writeOwner';
/**
 * Lead Capture Service — forms + leads tables
 * Handles: SaaS form builder, embed submissions, inbound webhook validation, manual entry
 */
import { supabase } from '../db/supabaseClient';
import { ensureUnifiedPerson } from '../../lib/identity/identityGateway';
import { mergeConnectionConfig } from './integrationCredentialService';
import { adoptLead } from './leadIntelligence/leadIntelligenceRuntime';
import { trackEvent } from './telemetry/telemetryDispatcher';
import { getLegacyLeads } from './leadIntelligence/legacyLeadCompat';

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
  website_id?: string | null;
  created_by: string;
  name: string;
  fields: FormField[];
  brand: FormBrand;
  allowed_domains?: string[] | null;
  integration_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  company_id: string;
  website_id?: string | null;
  created_by: string | null;
  name: string;
  email: string;
  phone: string | null;
  source: string;
  integration_id: string | null;
  form_id: string | null;
  metadata: Record<string, unknown>;
  attribution?: Record<string, unknown>;
  visitor_session_id?: string | null;
  consent_state?: string | null;
  is_test: boolean;
  created_at: string;
  unified_person_id: string | null;
}

// ─── FORMS ────────────────────────────────────────────────────────────────────

export async function createForm(
  companyId: string,
  userId: string,
  name: string,
  fields: FormField[],
  integrationId?: string | null,
  brand?: FormBrand,
  websiteId?: string | null,
): Promise<CaptureForm> {
  const { data, error } = await ownedDbTable('forms')
    .insert({ company_id: companyId, website_id: websiteId ?? null, created_by: userId, name, fields, brand: brand ?? {}, integration_id: integrationId ?? null })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CaptureForm;
}

export async function getForm(id: string, companyId?: string): Promise<CaptureForm | null> {
  let q = ownedDbTable('forms').select('*').eq('id', id);
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q.single();
  if (error) return null;
  return data as CaptureForm;
}

export async function getForms(companyId: string): Promise<CaptureForm[]> {
  const { data, error } = await ownedDbTable('forms')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as CaptureForm[];
}

export async function updateForm(
  id: string,
  companyId: string,
  updates: {
    name?: string;
    fields?: FormField[];
    brand?: FormBrand;
    integration_id?: string | null;
    website_id?: string | null;
    allowed_domains?: string[] | null;
  },
): Promise<CaptureForm> {
  const { data, error } = await ownedDbTable('forms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', companyId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CaptureForm;
}

export async function deleteForm(id: string, companyId: string): Promise<void> {
  const { error } = await ownedDbTable('forms').delete().eq('id', id).eq('company_id', companyId);
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
  website_id?: string | null;
  visitor_session_id?: string | null;
  attribution?: Record<string, unknown>;
  consent_state?: string | null;
}

export async function createLead(companyId: string, input: CreateLeadInput): Promise<Lead> {
  const unifiedPersonId = await ensureUnifiedPerson({
    email: input.email,
    phone: input.phone,
    companyId,
  });

  if (!unifiedPersonId) {
    throw new Error('IDENTITY_REQUIRED_FOR_LEAD');
  }

  const { data, error } = await ownedDbTable('leads')
    .insert({
      company_id: companyId,
      website_id: input.website_id ?? null,
      created_by: input.created_by ?? null,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      source: input.source ?? 'direct',
      form_id: input.form_id ?? null,
      integration_id: input.integration_id ?? null,
      metadata: input.metadata ?? {},
      attribution: input.attribution ?? {},
      visitor_session_id: input.visitor_session_id ?? null,
      consent_state: input.consent_state ?? null,
      is_test: input.is_test ?? false,
      unified_person_id: unifiedPersonId,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  // Canonical telemetry (append-only, fail-soft): a lead was captured. Deduped
  // per lead id.
  trackEvent({
    type: 'lead.captured',
    organizationId: companyId,
    actorId: input.created_by ?? null,
    entityId: (data as { id?: string }).id ?? null,
    metadata: { source: input.source ?? 'direct' },
  });
  // Phase 3 — route this lead through the Canonical Lead Intelligence facade
  // (website/forms/manual/webhook resolved from the row's source). Additive,
  // fire-and-forget, fail-open: never changes capture behaviour or the response.
  adoptLead('website', data as unknown as Record<string, unknown>);
  return data as Lead;
}

// Phase 6B — the legacy lead READ path now flows through the Canonical Lead
// Intelligence Repository (legacyLeadCompat), which mirrors the exact query +
// projects canonical → legacy. Byte-identical contract; one query (no duplication).
// (Reads only; createLead and the other writers below are unchanged.)
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
  return (await getLegacyLeads(companyId, filters)) as unknown as Lead[];
}

export async function deleteLead(id: string, companyId: string): Promise<void> {
  const { error } = await ownedDbTable('leads').delete().eq('id', id).eq('company_id', companyId);
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
): Promise<{ company_id: string; website_id?: string | null; integration_id: string } | null> {
  const { data, error } = await ownedDbTable('company_integrations')
    .select('id, company_id, website_id, website_connection_id, config, non_secret_config, type')
    .eq('id', integrationId)
    .single();
  if (error || !data) return null;
  if (data.type !== 'lead_webhook') return null;
  const cfg = await mergeConnectionConfig(
    String((data as any).company_id),
    (data as any).website_connection_id,
    ((data as any).non_secret_config ?? data.config) as Record<string, string>,
    data.config as Record<string, string>,
  );
  if (!cfg?.secret || cfg.secret !== webhookSecret) return null;
  return {
    company_id: data.company_id as string,
    website_id: (data as any).website_id ?? null,
    integration_id: data.id as string,
  };
}
