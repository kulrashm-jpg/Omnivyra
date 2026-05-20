/**
 * Embedded third-party form support — registration + lineage + diagnostics.
 *
 * Registers embedded form instances (HubSpot/Typeform/Tally/Jotform/Calendly/
 * Google Forms/generic). Submission ingestion CONTINUES to use the existing
 * hardened `/api/leads` (embedded mode) — this service does NOT add a
 * parallel ingestion path. Its job is lineage continuity: when a form has an
 * attribution token attached (via postMessage bridge or URL param at load),
 * we record an embedded-form lineage event so the conversion can be linked
 * back to the cross-domain handoff.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';

export type EmbeddedFormProvider =
  | 'hubspot'
  | 'typeform'
  | 'tally'
  | 'jotform'
  | 'calendly'
  | 'google_forms'
  | 'generic';

export interface RegisteredEmbeddedForm {
  id?: string;
  provider: EmbeddedFormProvider;
  formExternalId: string;
  hostPageUrl?: string | null;
  notes?: string;
  createdAt?: string;
}

let probe: boolean | null = null;
async function hasTable(): Promise<boolean> {
  if (probe !== null) return probe;
  try {
    const { error } = await ownedDbTable('embedded_form_lineage')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    probe = !error;
  } catch { probe = false; }
  return probe;
}

export async function registerEmbeddedForm(args: {
  companyId: string;
  provider: EmbeddedFormProvider;
  formExternalId: string;
  hostPageUrl?: string;
  registeredBy: string;
  notes?: string;
}): Promise<{ ok: boolean; detail: string }> {
  if (await hasTable()) {
    const { error } = await ownedDbTable('embedded_form_lineage').upsert(
      {
        company_id: args.companyId,
        provider: args.provider,
        form_external_id: args.formExternalId,
        host_page_url: args.hostPageUrl ?? null,
        registered_by: args.registeredBy,
        notes: args.notes ?? null,
      },
      { onConflict: 'company_id,provider,form_external_id', ignoreDuplicates: true },
    );
    if (error) return { ok: false, detail: error.message };
  }
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: args.registeredBy, type: 'user', label: 'embedded-form-registry' },
    action: 'embedded_form.registered',
    resourceType: 'embedded_form',
    resourceId: `${args.provider}:${args.formExternalId}`,
    severity: 'info',
    entityLineage: ['company', 'embedded_form', args.provider],
    detail: { provider: args.provider, formExternalId: args.formExternalId, hostPageUrl: args.hostPageUrl ?? null },
  }).catch(() => undefined);
  return { ok: true, detail: 'registered (idempotent on company+provider+formExternalId)' };
}

/**
 * Record a lineage event linking an embedded-form submission to a verified
 * attribution handoff. CALLER captures the handoff token via the SDK
 * postMessage bridge / URL param. We persist the link append-only — the
 * actual lead row remains owned by the hardened /api/leads writer.
 */
export async function recordEmbeddedFormHandoff(args: {
  companyId: string;
  provider: EmbeddedFormProvider;
  formExternalId: string;
  attributionNonce?: string;
  conversionId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await recordComplianceAudit({
    companyId: args.companyId,
    actor: { userId: null, type: 'system', label: 'embedded-form-handoff' },
    action: 'embedded_form.handoff_recorded',
    resourceType: 'embedded_form_handoff',
    resourceId: `${args.provider}:${args.formExternalId}:${args.attributionNonce ?? 'no-token'}`,
    severity: 'info',
    entityLineage: ['company', 'embedded_form', args.provider, 'handoff'],
    detail: {
      provider: args.provider,
      formExternalId: args.formExternalId,
      attributionNonce: args.attributionNonce ?? null,
      conversionId: args.conversionId ?? null,
      ...(args.detail ?? {}),
    },
  }).catch(() => undefined);
}

export async function listEmbeddedForms(companyId: string): Promise<RegisteredEmbeddedForm[]> {
  if (!(await hasTable())) {
    try {
      const { data } = await ownedDbTable('audit_events')
        .select('resource_id, metadata, created_at')
        .eq('company_id', companyId)
        .eq('resource_type', 'embedded_form')
        .order('created_at', { ascending: false })
        .limit(200);
      return ((data ?? []) as any[]).map((r) => ({
        provider: ((r.metadata ?? {}).provider ?? 'generic') as EmbeddedFormProvider,
        formExternalId: String((r.metadata ?? {}).formExternalId ?? ''),
        hostPageUrl: (r.metadata ?? {}).hostPageUrl ?? null,
        notes: (r.metadata ?? {}).notes ?? undefined,
        createdAt: r.created_at,
      }));
    } catch { return []; }
  }
  try {
    const { data } = await ownedDbTable('embedded_form_lineage')
      .select('id, provider, form_external_id, host_page_url, notes, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(200);
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      provider: r.provider,
      formExternalId: r.form_external_id,
      hostPageUrl: r.host_page_url ?? null,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
    }));
  } catch { return []; }
}

export interface EmbeddedDiagnostics {
  companyId: string;
  generatedAt: string;
  registered: number;
  handoffsRecorded24h: number;
  duplicateHandoffs24h: number;
  detail: string;
}

export async function buildEmbeddedFormDiagnostics(companyId: string): Promise<EmbeddedDiagnostics> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const registered = (await listEmbeddedForms(companyId)).length;
  let handoffs = 0;
  let dup = 0;
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('resource_id, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'embedded_form_handoff')
      .gte('created_at', since)
      .limit(2000);
    const seen = new Set<string>();
    for (const r of ((data ?? []) as any[])) {
      handoffs += 1;
      const k = String(r.resource_id ?? '');
      if (seen.has(k)) dup += 1; else seen.add(k);
    }
  } catch { /* ignore */ }
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    registered,
    handoffsRecorded24h: handoffs,
    duplicateHandoffs24h: dup,
    detail: dup > 0
      ? `${dup} duplicate embedded-form handoff(s) in 24h — receiver should idempotently suppress.`
      : 'No duplicate embedded-form handoffs detected.',
  };
}
