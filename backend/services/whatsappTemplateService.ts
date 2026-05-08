import { ownedDbTable } from '../db/writeOwner';
/**
 * WhatsApp Template Service
 *
 * Manages WhatsApp Business template lifecycle:
 *  - Submit new versions to Meta
 *  - Activate on approval (webhook-driven)
 *  - Deprecate previous versions
 *  - Safe template retrieval (Improvement 5 + Refinement 7)
 */

import { supabase } from '../db/supabaseClient';
import { getValidAccessToken } from '../auth/metaAuthService';

const META_GRAPH = 'https://graph.facebook.com/v22.0';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TemplateComponent {
  type:       'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?:    'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?:      string;
  buttons?:   TemplateButton[];
}

export interface TemplateButton {
  type:        'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text:        string;
  url?:        string;
  phone_number?: string;
}

export interface CreateTemplateInput {
  company_id:        string;
  social_account_id: string;
  template_name:     string;
  template_category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language_code?:    string;
  components:        TemplateComponent[];
}

export interface WhatsAppTemplate {
  id:               string;
  company_id:       string;
  social_account_id: string;
  template_name:    string;
  version:          number;
  is_active:        boolean;
  template_category: string;
  language_code:    string;
  components:       TemplateComponent[];
  meta_template_id: string | null;
  status:           string;
  rejection_reason: string | null;
  submitted_at:     string | null;
  approved_at:      string | null;
}

// ── Submit new template version ───────────────────────────────────────────────

export async function submitTemplate(input: CreateTemplateInput): Promise<string> {
  // 1. Find highest existing version for this template_name + company
  const { data: latest } = await ownedDbTable('whatsapp_templates')
    .select('version')
    .eq('company_id', input.company_id)
    .eq('template_name', input.template_name)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const newVersion = (latest?.version ?? 0) + 1;

  // 2. Insert new pending version
  const { data: inserted, error } = await ownedDbTable('whatsapp_templates')
    .insert({
      company_id:        input.company_id,
      social_account_id: input.social_account_id,
      template_name:     input.template_name,
      version:           newVersion,
      is_active:         false,
      template_category: input.template_category,
      language_code:     input.language_code ?? 'en_US',
      components:        input.components,
      status:            'PENDING',
      submitted_at:      new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !inserted) throw new Error(`Failed to insert template: ${error?.message}`);

  // 3. Submit to Meta
  try {
    const accessToken = await getValidAccessToken(input.social_account_id);
    const { data: account } = await ownedDbTable('social_accounts')
      .select('waba_id')
      .eq('id', input.social_account_id)
      .single();

    if (!account?.waba_id) throw new Error('waba_id not found on social account');

    const res = await fetch(`${META_GRAPH}/${account.waba_id}/message_templates`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:       input.template_name,
        category:   input.template_category,
        language:   input.language_code ?? 'en_US',
        components: input.components,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Meta returned ${res.status}`);
    }

    const { id: meta_template_id } = await res.json();

    await ownedDbTable('whatsapp_templates')
      .update({ meta_template_id })
      .eq('id', inserted.id);
  } catch (err) {
    // Mark as failed without deleting — preserves version history
    await ownedDbTable('whatsapp_templates')
      .update({ status: 'REJECTED', rejection_reason: err instanceof Error ? err.message : 'Submission failed' })
      .eq('id', inserted.id);
    throw err;
  }

  return inserted.id;
}

// ── Activate approved template (called by webhook handler) ───────────────────

export async function activateTemplate(templateId: string): Promise<void> {
  const { data: t, error } = await ownedDbTable('whatsapp_templates')
    .select('company_id, template_name')
    .eq('id', templateId)
    .single();

  if (error || !t) throw new Error(`Template not found: ${templateId}`);

  // Deprecate any currently active version for same name+company
  await ownedDbTable('whatsapp_templates')
    .update({ is_active: false, status: 'DEPRECATED', deprecated_at: new Date().toISOString() })
    .eq('company_id', t.company_id)
    .eq('template_name', t.template_name)
    .eq('is_active', true)
    .neq('id', templateId);

  // Activate new version
  await ownedDbTable('whatsapp_templates')
    .update({ is_active: true, status: 'APPROVED', approved_at: new Date().toISOString() })
    .eq('id', templateId);
}

// ── Get active template for sending ──────────────────────────────────────────

/**
 * Improvement 5 + Refinement 7:
 * Returns the single active+approved template, throws on missing or unapproved.
 * Call before every broadcast or template message send.
 */
export async function getActiveTemplate(
  companyId:    string,
  templateName: string,
): Promise<WhatsAppTemplate> {
  const { data, error } = await ownedDbTable('whatsapp_templates')
    .select('*')
    .eq('company_id', companyId)
    .eq('template_name', templateName)
    .eq('is_active', true)
    .eq('status', 'APPROVED')
    .single();

  // Refinement 7: explicit null/missing check before use
  if (error || !data) {
    throw new Error(
      `No active approved template found for "${templateName}" (company: ${companyId}). ` +
      `Submit a template and wait for Meta approval before sending.`
    );
  }

  // Improvement 5: double-check safety guard (defensive, covers stale cache scenarios)
  if (!data.is_active || data.status !== 'APPROVED') {
    throw new Error(
      `Template "${templateName}" v${data.version} is not approved (status: ${data.status}). ` +
      `Cannot send unapproved templates.`
    );
  }

  return data as WhatsAppTemplate;
}

// ── Handle Meta webhook for template status updates ───────────────────────────

export async function handleTemplateStatusWebhook(event: {
  message_template_id: string;
  message_template_name: string;
  event: 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  reason?: string;
}): Promise<void> {
  const { data } = await ownedDbTable('whatsapp_templates')
    .select('id')
    .eq('meta_template_id', event.message_template_id)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  if (!data) return; // Template not in our system — ignore

  if (event.event === 'APPROVED') {
    await activateTemplate(data.id);
  } else {
    await ownedDbTable('whatsapp_templates')
      .update({
        status:           event.event,
        rejection_reason: event.reason ?? null,
        is_active:        false,
      })
      .eq('id', data.id);
  }
}
