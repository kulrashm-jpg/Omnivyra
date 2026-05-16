/**
 * Phase 10 — Enterprise onboarding automation.
 *
 * Templates declare recommended configuration for a given concern
 * (industry preset, source recommendation, governance baseline,
 * connector activation, RBAC starter, retention preset). An
 * `enterprise_onboarding_applications` row is the explicit operator
 * acknowledgement that a template was applied (or rolled back).
 *
 * Hard guarantees:
 *   • Templates do NOT auto-apply. `previewApplication` creates a
 *     `previewed` row; `approveApplication` flips it to `approved`;
 *     `markApplied` (caller-driven, after the operator wires through
 *     the underlying surfaces) finalises.
 *   • Applied payloads are persisted verbatim for replay.
 *   • Tenant-first reads; FK CASCADE on org delete.
 *   • Shared templates carry `organization_id IS NULL` so a single set
 *     of system-curated presets can serve all tenants.
 */

import { ownedDbTable } from '../db/writeOwner';
import {
  type EnterpriseOnboardingApplication,
  type EnterpriseOnboardingTemplate,
  type OnboardingApplicationStatus,
  type OnboardingTemplateKind,
} from '../types/enterpriseOnboarding';
import { publishRealtime } from './realtimePublisherService';
import { publishOnboardingTemplateApplied } from '../events/listeningEvents';

export type UpsertOnboardingTemplateInput = {
  organizationId: string | null;
  id?: string;
  templateKind: OnboardingTemplateKind;
  name: string;
  industry?: string | null;
  description?: string | null;
  payload: Record<string, unknown>;
  recommendedExplanation?: string | null;
  shared?: boolean;
  ownerUserId: string | null;
};

export async function upsertOnboardingTemplate(
  input: UpsertOnboardingTemplateInput,
): Promise<EnterpriseOnboardingTemplate> {
  const name = (input.name ?? '').trim().slice(0, 200);
  if (name.length === 0) throw new Error('onboarding_template_name_required');
  if (input.id) {
    const upd = await ownedDbTable('enterprise_onboarding_templates')
      .update({
        template_kind: input.templateKind,
        name,
        industry: input.industry ?? null,
        description: input.description ?? null,
        payload: input.payload,
        recommended_explanation: input.recommendedExplanation ?? null,
        shared: input.shared ?? false,
        owner_user_id: input.ownerUserId,
      })
      .eq('id', input.id)
      .select('*')
      .single();
    if (upd.error || !upd.data) throw new Error(`onboarding_template_update_failed:${upd.error?.message ?? 'unknown'}`);
    return upd.data as EnterpriseOnboardingTemplate;
  }
  const ins = await ownedDbTable('enterprise_onboarding_templates')
    .insert({
      organization_id: input.organizationId,
      template_kind: input.templateKind,
      name,
      industry: input.industry ?? null,
      description: input.description ?? null,
      payload: input.payload,
      recommended_explanation: input.recommendedExplanation ?? null,
      shared: input.shared ?? false,
      owner_user_id: input.ownerUserId,
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`onboarding_template_insert_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as EnterpriseOnboardingTemplate;
}

export async function listOnboardingTemplates(
  organizationId: string,
  options?: { templateKind?: OnboardingTemplateKind; industry?: string; includeShared?: boolean; limit?: number },
): Promise<EnterpriseOnboardingTemplate[]> {
  let q = ownedDbTable('enterprise_onboarding_templates')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 200)));
  if (options?.includeShared !== false) {
    q = q.or(`organization_id.eq.${organizationId},shared.eq.true`);
  } else {
    q = q.eq('organization_id', organizationId);
  }
  if (options?.templateKind) q = q.eq('template_kind', options.templateKind);
  if (options?.industry) q = q.eq('industry', options.industry);
  const { data } = await q;
  return (data as EnterpriseOnboardingTemplate[]) ?? [];
}

export type PreviewOnboardingApplicationInput = {
  organizationId: string;
  templateId?: string | null;
  templateKind: OnboardingTemplateKind;
  previewPayload: Record<string, unknown>;
  createdBy: string | null;
  metadata?: Record<string, unknown>;
};

export async function previewOnboardingApplication(
  input: PreviewOnboardingApplicationInput,
): Promise<EnterpriseOnboardingApplication> {
  const ins = await ownedDbTable('enterprise_onboarding_applications')
    .insert({
      organization_id: input.organizationId,
      template_id: input.templateId ?? null,
      template_kind: input.templateKind,
      status: 'previewed' as OnboardingApplicationStatus,
      preview_payload: input.previewPayload,
      applied_payload: {},
      created_by: input.createdBy,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) throw new Error(`onboarding_preview_failed:${ins.error?.message ?? 'unknown'}`);
  return ins.data as EnterpriseOnboardingApplication;
}

export async function approveOnboardingApplication(args: {
  organizationId: string;
  applicationId: string;
  approverUserId: string | null;
}): Promise<EnterpriseOnboardingApplication> {
  const upd = await ownedDbTable('enterprise_onboarding_applications')
    .update({
      status: 'approved' as OnboardingApplicationStatus,
      approved_by: args.approverUserId,
      approved_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.applicationId)
    .eq('status', 'previewed')
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`onboarding_approve_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as EnterpriseOnboardingApplication;
}

export async function markApplicationApplied(args: {
  organizationId: string;
  applicationId: string;
  appliedPayload: Record<string, unknown>;
}): Promise<EnterpriseOnboardingApplication> {
  const upd = await ownedDbTable('enterprise_onboarding_applications')
    .update({
      status: 'applied' as OnboardingApplicationStatus,
      applied_payload: args.appliedPayload,
      applied_at: new Date().toISOString(),
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.applicationId)
    .eq('status', 'approved')
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`onboarding_apply_failed:${upd.error?.message ?? 'unknown'}`);
  const app = upd.data as EnterpriseOnboardingApplication;
  try {
    await publishOnboardingTemplateApplied({
      organizationId: args.organizationId,
      applicationId: app.id,
      templateKind: app.template_kind,
      status: app.status,
      approvedBy: app.approved_by,
    });
    void publishRealtime({
      organizationId: args.organizationId,
      topic: 'onboarding',
      eventName: 'onboarding.template_applied',
      payload: { application_id: app.id, template_kind: app.template_kind },
    });
  } catch { /* best effort */ }
  return app;
}

export async function rollbackOnboardingApplication(args: {
  organizationId: string;
  applicationId: string;
  failureReason?: string | null;
}): Promise<EnterpriseOnboardingApplication> {
  const upd = await ownedDbTable('enterprise_onboarding_applications')
    .update({
      status: 'rolled_back' as OnboardingApplicationStatus,
      failure_reason: args.failureReason ?? null,
    })
    .eq('organization_id', args.organizationId)
    .eq('id', args.applicationId)
    .select('*')
    .single();
  if (upd.error || !upd.data) throw new Error(`onboarding_rollback_failed:${upd.error?.message ?? 'unknown'}`);
  return upd.data as EnterpriseOnboardingApplication;
}

export async function listOnboardingApplications(
  organizationId: string,
  options?: { status?: OnboardingApplicationStatus; limit?: number },
): Promise<EnterpriseOnboardingApplication[]> {
  let q = ownedDbTable('enterprise_onboarding_applications')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, options?.limit ?? 100)));
  if (options?.status) q = q.eq('status', options.status);
  const { data } = await q;
  return (data as EnterpriseOnboardingApplication[]) ?? [];
}
