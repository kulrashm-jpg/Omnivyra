/**
 * Individual intelligence — the facts one person's journey decisions read.
 *
 * Every fact comes from an EXISTING canonical source; this module owns no store
 * and creates no second person, contact or intelligence model:
 *
 *   person        resolveSubjectPersonId (leads / canonical_leads → unified_persons)
 *   contact       unified_persons.primary_email / primary_phone (presence only)
 *   permission    contact_governance_records through the pure `mayContact`
 *   lead intel    lead_intelligence_profiles via getPersistedLeadIntelligence
 *   prospect intel the latest prospect_score_evaluations row
 *   prospect state readCurrentProspectState (PI's lifecycle ledger)
 *
 * TENANT FIRST on every read. A fact that cannot be read is OMITTED, never
 * defaulted: journey policy treats an unknown fact as unmet (fail closed), and
 * the reason is reported in `gaps` so an operator can tell "not eligible" from
 * "we could not tell".
 *
 * The facts carry no contact value: only presence and permission. A person's
 * address never leaves its canonical table through this module.
 */

import { ownedDbTable } from '../../db/writeOwner';
import { resolveSubjectPersonId } from '../leadOutreachExecution/personAnchor';
import { getPersistedLeadIntelligence } from '../leadIntelligenceOrchestration/readIntegration';
import { loadTenantGovernanceRecords, normalizeGovernanceTarget } from '../prospectIdentity/contactGovernanceRepository';
import { mayContact } from '../prospectIdentity/contactGovernance';
import { readCurrentProspectState } from '../prospectLifecycle/lifecycleReader';
import type { SubjectRef } from '../executionSubject/subjectRef';
import type { JourneyFacts } from './journeyPolicy';

export interface IndividualFactsResult {
  readonly facts: JourneyFacts;
  /** The resolved canonical person, when any. */
  readonly personId: string | null;
  /** Why a fact is missing — codes, never personal data. */
  readonly gaps: readonly string[];
  /** True only when PI's lifecycle was read and this prospect has no ledger yet. */
  readonly prospectLedgerAbsent: boolean;
}

/** Injected seams, so the journey engine is testable without a database. */
export interface IndividualIntelligencePort {
  resolvePerson(organizationId: string, subject: SubjectRef): Promise<{ ok: boolean; personId: string | null }>;
  readPersonContacts(organizationId: string, personId: string): Promise<{ email: string | null; phone: string | null } | null>;
  readLeadIntelligence(organizationId: string, leadId: string): Promise<{ intentBand: string | null; qualificationBand: string | null; confidence: number | null } | null>;
  readProspectScore(organizationId: string, prospectId: string): Promise<{ intent: number | null; overall: number | null; confidence: number | null } | null>;
  channelPermission(organizationId: string, personId: string | null, channel: 'email' | 'whatsapp', target: string | null, now: string): Promise<boolean | null>;
  /** PI's current state; null when the prospect has no ledger yet. A port without it has no lifecycle source. */
  readProspectState?(organizationId: string, prospectId: string): Promise<string | null>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const durableIntelligencePort: IndividualIntelligencePort = {
  resolvePerson: (organizationId, subject) => resolveSubjectPersonId(organizationId, subject),

  async readPersonContacts(organizationId, personId) {
    const res = await ownedDbTable('unified_persons')
      .select('primary_email, primary_phone')
      .eq('company_id', organizationId)          // TENANT FIRST
      .eq('id', personId)
      .maybeSingle();
    if (res.error) return null;
    const row = (res.data ?? null) as Record<string, unknown> | null;
    return row === null ? { email: null, phone: null } : { email: text(row.primary_email), phone: text(row.primary_phone) };
  },

  async readLeadIntelligence(organizationId, leadId) {
    try {
      const { record } = await getPersistedLeadIntelligence(organizationId, leadId);
      if (!record) return null;
      const b = (record.intelligence as unknown as { confidenceBreakdown?: Record<string, unknown> }).confidenceBreakdown ?? {};
      return { intentBand: text(b.intentBand), qualificationBand: text(b.qualificationBand), confidence: num(b.overall) };
    } catch {
      return null;
    }
  },

  async readProspectScore(organizationId, prospectId) {
    const res = await ownedDbTable('prospect_score_evaluations')
      .select('score_intent, score_overall, confidence, evaluated_at')
      .eq('organization_id', organizationId)      // TENANT FIRST
      .eq('prospect_id', prospectId)
      .order('evaluated_at', { ascending: false })
      .limit(1);
    if (res.error || !Array.isArray(res.data)) return null;
    const row = (res.data[0] ?? null) as Record<string, unknown> | null;
    if (row === null) return null;
    return { intent: num(row.score_intent), overall: num(row.score_overall), confidence: num(row.confidence) };
  },

  async channelPermission(organizationId, personId, channel, target, now) {
    const loaded = await loadTenantGovernanceRecords(organizationId, [channel]);
    if (!loaded.ok) return null;                  // unreadable → unknown → fail closed
    const verdict = mayContact({
      organizationId,
      personId,
      targetNormalized: normalizeGovernanceTarget(channel, target),
      channel,
      now,
      records: loaded.records,
    });
    return verdict.decision === 'allowed';
  },

  async readProspectState(organizationId, prospectId) {
    return (await readCurrentProspectState(organizationId, prospectId))?.state ?? null;
  },
};

/** The state could not be read, so "closed" cannot be ruled out. Callers must not contact. */
export const PROSPECT_STATE_UNREADABLE_GAP = 'prospect_state_unreadable';

/**
 * The facts for one individual, at `now`. Never throws for a missing source: the
 * fact is omitted and the gap recorded.
 */
export async function loadIndividualFacts(
  organizationId: string,
  subject: SubjectRef,
  now: string,
  port: IndividualIntelligencePort = durableIntelligencePort,
): Promise<IndividualFactsResult> {
  const facts: JourneyFacts = { subject_kind: subject.kind };
  const gaps: string[] = [];
  let prospectLedgerAbsent = false;

  let personId: string | null = null;
  try {
    const resolved = await port.resolvePerson(organizationId, subject);
    if (!resolved.ok) gaps.push('person_unreadable');
    personId = resolved.ok ? resolved.personId : null;
    if (resolved.ok && personId === null) gaps.push('person_unresolved');
  } catch {
    gaps.push('person_unreadable');
  }

  let email: string | null = null;
  let phone: string | null = null;
  if (personId !== null) {
    const contacts = await port.readPersonContacts(organizationId, personId).catch(() => null);
    if (contacts === null) {
      gaps.push('contacts_unreadable');
    } else {
      email = contacts.email;
      phone = contacts.phone;
      facts.has_email = email !== null;
      facts.has_phone = phone !== null;
    }
  }

  // Permission is evaluated for the person AND their address, exactly as the
  // engines do, so the journey never plans an action the engine will refuse.
  for (const channel of ['email', 'whatsapp'] as const) {
    const target = channel === 'email' ? email : phone;
    if (personId === null && target === null) {
      gaps.push(`${channel}_permission_unanchored`);
      continue;
    }
    const allowed = await port.channelPermission(organizationId, personId, channel, target, now).catch(() => null);
    if (allowed === null) gaps.push(`${channel}_permission_unreadable`);
    else facts[channel === 'email' ? 'email_permitted' : 'whatsapp_permitted'] = allowed;
  }

  if (subject.kind === 'lead') {
    const intel = await port.readLeadIntelligence(organizationId, subject.id).catch(() => null);
    if (intel === null) {
      gaps.push('lead_intelligence_unavailable');
    } else {
      if (intel.intentBand !== null) facts.lead_intent_band = intel.intentBand;
      if (intel.qualificationBand !== null) facts.lead_qualification_band = intel.qualificationBand;
      if (intel.confidence !== null) facts.lead_intelligence_confidence = intel.confidence;
    }
  } else {
    const score = await port.readProspectScore(organizationId, subject.id).catch(() => null);
    if (score === null) {
      gaps.push('prospect_score_unavailable');
    } else {
      if (score.intent !== null) facts.prospect_score_intent = score.intent;
      if (score.overall !== null) facts.prospect_score_overall = score.overall;
      if (score.confidence !== null) facts.prospect_score_confidence = score.confidence;
    }
    if (port.readProspectState) {
      try {
        const state = await port.readProspectState(organizationId, subject.id);
        if (state !== null) facts.prospect_lifecycle_state = state;
        else prospectLedgerAbsent = true;
      } catch {
        gaps.push(PROSPECT_STATE_UNREADABLE_GAP);
      }
    }
  }

  return { facts, personId, gaps, prospectLedgerAbsent };
}
