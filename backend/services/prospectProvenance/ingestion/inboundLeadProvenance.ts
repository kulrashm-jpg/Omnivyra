/**
 * Inbound leads (`leadService.createLead`: embedded form, integration webhook,
 * website lead capture, authenticated manual entry) → canonical prospect
 * provenance.
 *
 * ─── GATED: THE SAME GATE AS EVERY OTHER PI WRITE ──────────────────────────
 * This creates/links a canonical prospect (`canonical_leads`) and a PI source
 * record, so it is behind `resolveLeadIngestionGate` — the global
 * `ENABLE_LEAD_INGESTION` kill switch AND the tenant's `lead_ingestion` flag,
 * failing closed. With the kill switch off (production default) it performs no
 * database read and no write; `createLead` behaves exactly as before.
 *
 * ─── WHAT IT WRITES (gate open) ────────────────────────────────────────────
 *   1. `source_records` via the existing PI `upsertSourceRecord` (provider
 *      `lead_<mode>`, record id = `leads.id`, observed_at = `leads.created_at`);
 *   2. the canonical prospect via WS-1 `resolveOrCreateProspect`, keyed by the
 *      already-resolved person (`inbound_person:<unified_person_id>`), so repeat
 *      submissions by one person converge on one prospect;
 *   3. a contribution (`leads:<leads.id>`) — originating only when step 2
 *      created the prospect.
 *
 * Never throws to `createLead`: run through `runDetached` (keep-alive on Vercel,
 * failures logged + counted).
 */
import { namespacedExternalRef, type SourceContributionResult } from '../../../../lib/prospectProvenance/contract';
import { INBOUND_LEAD_PROFILES, type InboundLeadMode } from './sourceProfiles';
import { recordObservedContribution, sourceObservedAt, type ContributionRecorder } from './recordContribution';
import { recordProvenanceOutcome, runDetached } from './provenanceTelemetry';

const INBOUND_MODES = Object.keys(INBOUND_LEAD_PROFILES) as InboundLeadMode[];

/**
 * The structural mode of a `createLead` call. Decided by WHICH entry point
 * produced the row (form / integration / tracked website session), never by the
 * free-text `source` the caller supplied. An explicit `mode` wins when given.
 */
export function classifyInboundLead(input: {
  mode?: string | null;
  form_id?: string | null;
  integration_id?: string | null;
  visitor_session_id?: string | null;
}): InboundLeadMode {
  if (input.mode && (INBOUND_MODES as string[]).includes(input.mode)) return input.mode as InboundLeadMode;
  if (input.form_id) return 'inbound_form';
  if (input.integration_id) return 'inbound_webhook';
  if (input.visitor_session_id) return 'website';
  return 'manual';
}

type LeadRow = Record<string, unknown>;

export interface InboundProvenanceDeps {
  gate?: (organizationId: string) => Promise<{ allowed: boolean; reason: string }>;
  upsertSourceRecord?: (input: Record<string, unknown>) => Promise<{ id: string; outcome: string }>;
  resolveProspect?: (organizationId: string, candidate: Record<string, unknown>) => Promise<{ prospectId: string | null; outcome: string; matchedKey?: 'namespaced' | 'legacy' }>;
  recorder?: ContributionRecorder;
  now?: () => string;
}

export type InboundProvenanceOutcome =
  | SourceContributionResult
  | { status: 'skipped'; reason: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function recordInboundLeadProvenance(
  organizationId: string,
  lead: LeadRow,
  mode: InboundLeadMode,
  deps: InboundProvenanceDeps = {},
): Promise<InboundProvenanceOutcome> {
  const skip = (reason: string): InboundProvenanceOutcome => {
    recordProvenanceOutcome('inbound_lead', 'skipped', { reason, mode });
    return { status: 'skipped', reason };
  };

  const gate = deps.gate ?? (async (org: string) =>
    (await import('../../leadIngestion/orchestrator')).resolveLeadIngestionGate(org));
  const decision = await gate(organizationId);
  if (!decision.allowed) return skip(`gate:${decision.reason}`);

  const leadId = str(lead.id);
  const personId = str(lead.unified_person_id);
  // Tenant comes from the caller's authenticated/validated context; a row that
  // claims another tenant is refused rather than written anywhere.
  if (str(lead.company_id) && str(lead.company_id) !== organizationId) return skip('tenant_mismatch');
  if (!leadId) return skip('no_lead_id');
  if (!personId) return skip('no_person');
  // Test submissions never become canonical prospects.
  if (lead.is_test === true) return skip('test_lead');

  const profile = INBOUND_LEAD_PROFILES[mode];
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const { observedAt, observedAtBasis } = sourceObservedAt(lead.created_at, now);
  const attribution = obj(lead.attribution);
  const sourceUrl = str(attribution.current_page) ?? str(attribution.landing_page);

  // 1. evidence — the existing PI source-record upsert (idempotent per lead id).
  const upsert = deps.upsertSourceRecord ?? (async (input: Record<string, unknown>) =>
    (await import('../../prospectIdentity/ingestionBoundary')).upsertSourceRecord(input as never, now));
  const sourceRecord = await upsert({
    organizationId,
    provider: `lead_${mode}`,
    entityType: 'person',
    sourceRecordId: leadId,
    rawPayload: lead,
    personId,
    observedAt: observedAtBasis === 'source' ? observedAt : null,
    ingestionRunId: null,
  });

  // 2. canonical prospect, anchored on the already-resolved person.
  const prospectKey = namespacedExternalRef('inbound_person', personId);
  const contributionRef = namespacedExternalRef(profile.refProvider, leadId);
  const resolve = deps.resolveProspect ?? (async (org: string, candidate: Record<string, unknown>) =>
    (await import('../../prospectIdentity/prospectResolution')).resolveOrCreateProspect(org, candidate as never, now));
  const prospect = await resolve(organizationId, {
    namespacedExternalLeadKey: prospectKey,
    // Display source (form_embed / website / webhook / manual) — unchanged vocabulary.
    source: str(lead.source) ?? mode,
    personId,
    email: str(lead.email),
    phone: str(lead.phone),
    fullName: str(lead.name),
    provenance: { sourceCategory: profile.sourceCategory, platform: profile.platform, externalRef: contributionRef },
  });
  if (!prospect.prospectId) return skip(`no_prospect:${prospect.outcome}`);

  // 3. contribution.
  return recordObservedContribution('inbound_lead', {
    organizationId,
    canonicalLeadId: prospect.prospectId,
    leadCreated: prospect.outcome === 'created',
    sourceCategory: profile.sourceCategory,
    externalRef: contributionRef,
    sourceRecordId: sourceRecord.id,
    platform: profile.platform,
    sourceUrl,
    observedAt,
    evidence: {
      leadId,
      formId: str(lead.form_id),
      integrationId: str(lead.integration_id),
      websiteId: str(lead.website_id),
      visitorSessionId: str(lead.visitor_session_id),
      consentState: str(lead.consent_state),
    },
    sourceMetadata: {
      displaySource: str(lead.source),
      inboundMode: mode,
      observedAtBasis,
      attribution,
    },
  }, deps.recorder);
}

/**
 * Fire-and-forget entry used by `createLead`: survives the response on Vercel,
 * never rejects, never delays the caller. Returns the settled promise for
 * long-lived callers and tests.
 */
export function scheduleInboundLeadProvenance(
  organizationId: string,
  lead: LeadRow,
  mode: InboundLeadMode,
  deps: InboundProvenanceDeps = {},
): Promise<void> {
  return runDetached('inbound_lead', async () => {
    await recordInboundLeadProvenance(organizationId, lead, mode, deps);
  }, { organizationId, mode, leadId: str(lead.id) });
}
