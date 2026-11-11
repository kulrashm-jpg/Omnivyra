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
  const { data: latest, error: latestError } = await ownedDbTable('whatsapp_templates')
    .select('version')
    .eq('company_id', input.company_id)
    .eq('template_name', input.template_name)
    .order('version', { ascending: false })
    .limit(1)
    .single();
  // A failed read is not "no versions yet" (unread-error census): that resubmitted as v1.
  // PGRST116 (no row) is the genuine first version.
  if (latestError && latestError.code !== 'PGRST116') {
    throw new Error(`Template versions unreadable: ${latestError.message}`);
  }

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
    const { data: account, error: accountError } = await ownedDbTable('social_accounts')
      .select('waba_id')
      .eq('id', input.social_account_id)
      .single();
    // The REAL cause is what the REJECTED row records: a failed read is not "waba_id not found".
    if (accountError && accountError.code !== 'PGRST116') {
      throw new Error(`Social account unreadable: ${accountError.message}`);
    }

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

    // A one-column write: retried, so only a PERSISTENT failure orphans the template (05).
    let storeError: { message: string } | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      ({ error: storeError } = await ownedDbTable('whatsapp_templates')
        .update({ meta_template_id })
        .eq('id', inserted.id));
      if (!storeError) break;
    }
    if (storeError) {
      // Meta HOLDS this template now, so it must not be marked REJECTED (Meta names are unique per
      // WABA: a local REJECTED row beside a live Meta template would also block recreating it).
      // And this is PERMANENT, not transient: the status webhook matches rows on meta_template_id,
      // so it can NEVER match this row - it stays PENDING (never sendable) and will not heal when
      // Meta approves it. Manual reconciliation from this log line is the only recovery.
      console.error('[whatsappTemplate] Meta accepted the template but its meta_template_id was NOT stored after 3 attempts: the row is ORPHANED (the status webhook can never match it); store this meta_template_id on the row manually', {
        template_id: inserted.id, meta_template_id, error: storeError.message,
      });
    }
  } catch (err) {
    // Mark as failed without deleting — preserves version history
    // best-effort: the submission error is re-thrown below either way; an unmarked row stays PENDING, never sendable
    const { error: markError } = await ownedDbTable('whatsapp_templates')
      .update({ status: 'REJECTED', rejection_reason: err instanceof Error ? err.message : 'Submission failed' })
      .eq('id', inserted.id);
    if (markError) console.warn('[whatsappTemplate] could not mark the failed submission REJECTED', { template_id: inserted.id, error: markError.message });
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

  // Deprecate any currently active version for same name+company. A silent failure left TWO
  // active versions (every send then fails to find "the" active one); it now throws, so the
  // webhook job retries and the new version is not activated beside the old.
  const { error: deprecateError } = await ownedDbTable('whatsapp_templates')
    .update({ is_active: false, status: 'DEPRECATED', deprecated_at: new Date().toISOString() })
    .eq('company_id', t.company_id)
    .eq('template_name', t.template_name)
    .eq('is_active', true)
    .neq('id', templateId);
  if (deprecateError) throw new Error(`Previous template version not deprecated: ${deprecateError.message}`);

  // Activate new version. A silent failure left NO active version while the webhook reported done.
  const { error: activateError } = await ownedDbTable('whatsapp_templates')
    .update({ is_active: true, status: 'APPROVED', approved_at: new Date().toISOString() })
    .eq('id', templateId);
  if (activateError) throw new Error(`Template not activated: ${activateError.message}`);
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
  const { data, error: lookupError } = await ownedDbTable('whatsapp_templates')
    .select('id')
    .eq('meta_template_id', event.message_template_id)
    .order('version', { ascending: false })
    .limit(1)
    .single();
  // A failed read is not "not our template": that dropped an APPROVED/PAUSED/DISABLED event.
  // Thrown, so the webhook job retries.
  if (lookupError && lookupError.code !== 'PGRST116') {
    throw new Error(`Template lookup failed for Meta template ${event.message_template_id}: ${lookupError.message}`);
  }

  if (!data) return; // Template not in our system — ignore

  if (event.event === 'APPROVED') {
    await activateTemplate(data.id);
  } else {
    // A silent failure here left a template Meta has PAUSED / DISABLED / REJECTED still active
    // and APPROVED for sending. Thrown, so the webhook job retries.
    const { error: statusError } = await ownedDbTable('whatsapp_templates')
      .update({
        status:           event.event,
        rejection_reason: event.reason ?? null,
        is_active:        false,
      })
      .eq('id', data.id);
    if (statusError) throw new Error(`Template ${event.event} not recorded: ${statusError.message}`);
  }
}
