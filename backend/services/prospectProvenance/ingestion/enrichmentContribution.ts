/**
 * Provider enrichment → provenance (owner decision 5, 2026-10-30; closure C).
 *
 * When enrichment persists a provider's answer about a prospect's person or
 * account, the provider becomes a CONTRIBUTING source of that prospect. It is
 * recorded beside the originating source and never replaces it:
 *
 *   - `leadCreated` is always false, so the writer can only insert a
 *     `contributing` row. Enrichment never creates a prospect, so it can never
 *     originate one — and a prospect with no originating row is not
 *     re-originated by enrichment either (the writer's rule).
 *   - This module writes ONLY `prospect_source_contributions` (through the one
 *     writer). It never writes `canonical_leads` — not `source`, not
 *     `created_at`, not `lead_metadata` — and never touches the originating
 *     contribution (the table is append-only).
 *
 * REFRESH SEMANTICS (closure C). The external reference is CONTENT-ADDRESSED:
 *
 *     enrichment_<provider>:<subject>:<entityId>:<fingerprint>
 *
 * where `<fingerprint>` is the first 16 hex chars of the sha256 of the
 * NORMALISED observed attribute values (see `enrichmentObservationFingerprint`).
 * The idempotency key stays the contract's
 * `(organization_id, canonical_lead_id, external_ref)`, so:
 *   - a retry, or a refresh that observes the same values ⇒ the same ref ⇒
 *     `duplicate` (idempotent, nothing new);
 *   - a refresh that observes MATERIALLY different values ⇒ a new ref ⇒ a new
 *     `contributing` row. Earlier enrichment rows stay (append-only history).
 * Provider timestamps, the raw payload hash, confidence and the correlation id
 * are deliberately NOT part of the fingerprint: they change on every call
 * without the observation changing.
 *
 * APPLICABILITY (contract § "Enrichment contributions: refresh and
 * applicability"):
 *   - PERSON evidence attaches to that person's prospect only when unambiguous:
 *     a caller-given prospect must be anchored to that person
 *     (`canonical_leads.unified_person_id`); without a caller prospect, the
 *     tenant must hold exactly one prospect anchored to the person.
 *   - ACCOUNT evidence attaches only to prospects whose link to that account is
 *     EVIDENCED: the prospect's originating source record names the account,
 *     or the prospect's person names it (`unified_persons.account_id`) or holds
 *     a current `person_account_relationships` row for it. It is recorded with
 *     `evidence.evidenceLevel = 'account'` — never presented as person-level.
 *     Without a caller prospect, every evidenced prospect receives it (capped);
 *     no prospect without evidence ever does (no blind fan-out).
 *
 * NEVER FATAL. Every outcome is counted and every failure is logged
 * (provenanceTelemetry, path `pi_enrichment`); nothing here throws, so a
 * provenance failure can never fail the enrichment that already persisted.
 */
import { createHash } from 'crypto';
import type { SourceContributionResult } from '../../../../lib/prospectProvenance/contract';
import { ownedDbTable } from '../../../db/writeOwner';
import { piEnrichmentProfile, toNamespacedRef } from './sourceProfiles';
import { recordObservedContribution, sourceObservedAt, type ContributionRecorder } from './recordContribution';
import { recordProvenanceOutcome } from './provenanceTelemetry';

export type EnrichmentSubject = 'person' | 'account';

/** One observed attribute value. Values feed the fingerprint only; they are never stored in evidence. */
export interface ObservedEnrichmentValue {
  readonly subject: EnrichmentSubject;
  readonly attribute: string;
  readonly value: unknown;
}

export interface EnrichmentContributionInput {
  organizationId: string;
  /** The enrichment provider that answered (`apollo`, `clearbit`, …). */
  providerId: string;
  subject: EnrichmentSubject;
  /** `unified_persons.id` or `prospect_accounts.id`. */
  entityId: string;
  /** The canonical prospect, when the caller knows it. */
  prospectId?: string | null;
  /** `source_records.id` returned by the LI-2 boundary for this observation. */
  sourceRecordId: string | null;
  /** The provider's own timestamp, when it gave one. */
  observedAt: string | null;
  /** Ingestion instant; the honest fallback when the provider gave no time. */
  ingestedAt: string;
  correlationId?: string | null;
  /** Canonical attribute names the provider returned. Names only, never values. */
  attributes?: readonly string[];
  /** The observed values — hashed into the reference fingerprint, never persisted. */
  observedValues?: readonly ObservedEnrichmentValue[];
  payloadHash?: string | null;
}

export type EnrichmentSkipReason =
  | 'unmapped_provider'
  | 'no_source_record'
  | 'no_prospect'
  | 'ambiguous_prospect'
  | 'prospect_not_anchored_to_person'
  | 'account_link_unevidenced'
  | 'too_many_account_prospects';

/** How a prospect's link to an account is evidenced. */
export type AccountLinkEvidence =
  | 'originating_source_record'
  | 'person_primary_account'
  | 'person_account_relationship';

export interface EnrichmentFanoutTarget {
  readonly prospectId: string;
  readonly outcome: SourceContributionResult;
}

export type EnrichmentContributionOutcome =
  | SourceContributionResult
  | { status: 'skipped'; reason: EnrichmentSkipReason }
  | { status: 'fanout'; targets: readonly EnrichmentFanoutTarget[] };

/** Tenant prospects anchored to a person. Returns at most `limit` ids. */
export type PersonProspectFinder = (organizationId: string, personId: string, limit: number) => Promise<string[]>;

/** The person a tenant prospect is anchored to; `undefined` when the prospect is not the tenant's. */
export type ProspectPersonReader = (organizationId: string, prospectId: string) => Promise<string | null | undefined>;

/** How (if at all) one tenant prospect is evidenced as linked to an account. */
export type ProspectAccountLinkReader = (
  organizationId: string, prospectId: string, accountId: string,
) => Promise<AccountLinkEvidence | null>;

/**
 * Tenant prospects evidenced as linked to an account. `complete` is false when
 * any underlying read hit `limit` (the true set may be larger than returned).
 */
export type AccountProspectFinder = (
  organizationId: string, accountId: string, limit: number,
) => Promise<{ targets: Array<{ prospectId: string; via: AccountLinkEvidence }>; complete: boolean }>;

/** Upper bound for an account fan-out; above it nothing is recorded (reported, never truncated). */
export const ACCOUNT_FANOUT_CAP = 50;

const ids = (data: unknown, col: string): string[] =>
  ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => (r[col] == null ? '' : String(r[col])))
    .filter((v) => v !== '');

const defaultPersonProspectFinder: PersonProspectFinder = async (organizationId, personId, limit) => {
  const { data, error } = await ownedDbTable('canonical_leads')
    .select('id')
    .eq('company_id', organizationId)          // tenant boundary — never optional
    .eq('unified_person_id', personId)
    .limit(limit);
  if (error) throw new Error(`canonical_leads lookup failed: ${error.message}`);
  return ids(data, 'id');
};

const defaultProspectPersonReader: ProspectPersonReader = async (organizationId, prospectId) => {
  const { data, error } = await ownedDbTable('canonical_leads')
    .select('id, unified_person_id')
    .eq('company_id', organizationId)
    .eq('id', prospectId)
    .limit(1);
  if (error) throw new Error(`canonical_leads lookup failed: ${error.message}`);
  const row = ((data ?? []) as Array<{ unified_person_id?: string | null }>)[0];
  if (!row) return undefined;
  return row.unified_person_id ? String(row.unified_person_id) : null;
};

/** Account ids named by the ORIGINATING contribution's source record of one prospect. */
async function originatingAccountIds(organizationId: string, prospectId: string): Promise<string[]> {
  const { data: contribs, error } = await ownedDbTable('prospect_source_contributions')
    .select('source_record_id')
    .eq('organization_id', organizationId)
    .eq('canonical_lead_id', prospectId)
    .eq('contribution_role', 'originating')
    .limit(1);
  if (error) throw new Error(`prospect_source_contributions lookup failed: ${error.message}`);
  const srIds = ids(contribs, 'source_record_id');
  if (srIds.length === 0) return [];
  const { data: srs, error: srError } = await ownedDbTable('source_records')
    .select('account_id')
    .eq('organization_id', organizationId)
    .in('id', srIds);
  if (srError) throw new Error(`source_records lookup failed: ${srError.message}`);
  return ids(srs, 'account_id');
}

const defaultProspectAccountLinkReader: ProspectAccountLinkReader = async (organizationId, prospectId, accountId) => {
  if ((await originatingAccountIds(organizationId, prospectId)).includes(accountId)) return 'originating_source_record';

  const personId = await defaultProspectPersonReader(organizationId, prospectId);
  if (!personId) return null;

  const { data: persons, error } = await ownedDbTable('unified_persons')
    .select('account_id')
    .eq('company_id', organizationId)
    .eq('id', personId)
    .limit(1);
  if (error) throw new Error(`unified_persons lookup failed: ${error.message}`);
  if (ids(persons, 'account_id').includes(accountId)) return 'person_primary_account';

  const { data: rels, error: relError } = await ownedDbTable('person_account_relationships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('person_id', personId)
    .eq('account_id', accountId)
    .is('ended_at', null)                       // current relationships only
    .limit(1);
  if (relError) throw new Error(`person_account_relationships lookup failed: ${relError.message}`);
  return ids(rels, 'id').length > 0 ? 'person_account_relationship' : null;
};

const defaultAccountProspectFinder: AccountProspectFinder = async (organizationId, accountId, limit) => {
  const out = new Map<string, AccountLinkEvidence>();
  let complete = true;
  const note = (rows: unknown) => { if (((rows ?? []) as unknown[]).length >= limit) complete = false; };

  // 1. The prospect's ORIGINATING source record names the account.
  const { data: srs, error: srError } = await ownedDbTable('source_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('account_id', accountId)
    .limit(limit);
  if (srError) throw new Error(`source_records lookup failed: ${srError.message}`);
  note(srs);
  const srIds = ids(srs, 'id');
  if (srIds.length > 0) {
    const { data: contribs, error } = await ownedDbTable('prospect_source_contributions')
      .select('canonical_lead_id')
      .eq('organization_id', organizationId)
      .eq('contribution_role', 'originating')
      .in('source_record_id', srIds)
      .limit(limit);
    if (error) throw new Error(`prospect_source_contributions lookup failed: ${error.message}`);
    note(contribs);
    for (const id of ids(contribs, 'canonical_lead_id')) if (!out.has(id)) out.set(id, 'originating_source_record');
  }

  // 2. The prospect's person names the account (primary employer, or a current relationship).
  const personVia = new Map<string, AccountLinkEvidence>();
  const { data: persons, error: pError } = await ownedDbTable('unified_persons')
    .select('id')
    .eq('company_id', organizationId)
    .eq('account_id', accountId)
    .limit(limit);
  if (pError) throw new Error(`unified_persons lookup failed: ${pError.message}`);
  note(persons);
  for (const id of ids(persons, 'id')) personVia.set(id, 'person_primary_account');
  const { data: rels, error: rError } = await ownedDbTable('person_account_relationships')
    .select('person_id')
    .eq('organization_id', organizationId)
    .eq('account_id', accountId)
    .is('ended_at', null)
    .limit(limit);
  if (rError) throw new Error(`person_account_relationships lookup failed: ${rError.message}`);
  note(rels);
  for (const id of ids(rels, 'person_id')) if (!personVia.has(id)) personVia.set(id, 'person_account_relationship');

  if (personVia.size > 0) {
    const { data: leads, error } = await ownedDbTable('canonical_leads')
      .select('id, unified_person_id')
      .eq('company_id', organizationId)
      .in('unified_person_id', [...personVia.keys()])
      .limit(limit);
    if (error) throw new Error(`canonical_leads lookup failed: ${error.message}`);
    note(leads);
    for (const r of (leads ?? []) as Array<{ id: unknown; unified_person_id: unknown }>) {
      const id = String(r.id);
      if (!out.has(id)) out.set(id, personVia.get(String(r.unified_person_id)) ?? 'person_primary_account');
    }
  }

  if (out.size >= limit) complete = false;
  return { targets: [...out.entries()].slice(0, limit).map(([prospectId, via]) => ({ prospectId, via })), complete };
};

/* ── Content addressing ─────────────────────────────────────────────────── */

function normaliseValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    return s === '' ? null : s;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const items = v.map(normaliseValue).filter((x) => x !== null).map((x) => JSON.stringify(x));
    const unique = [...new Set(items)].sort();
    return unique.length ? unique : null;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const n = normaliseValue(o[k]);
      if (n !== null) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  return String(v);
}

/**
 * The fingerprint of one enrichment observation: sha256 (first 16 hex) of the
 * normalised `(subject, attribute, value)` set. Order-, case- and
 * whitespace-insensitive; empty values are ignored; a repeated attribute keeps
 * every distinct value. Timestamps, confidence and payload hashes are NOT
 * inputs, so an identical refresh yields the identical fingerprint.
 */
export function enrichmentObservationFingerprint(values: readonly ObservedEnrichmentValue[] | null | undefined): string {
  const lines = new Set<string>();
  for (const f of values ?? []) {
    const attribute = String(f?.attribute ?? '').trim().toLowerCase();
    const value = normaliseValue(f?.value);
    if (!attribute || value === null) continue;
    lines.add(JSON.stringify([f.subject === 'account' ? 'account' : 'person', attribute, value]));
  }
  const canonical = [...lines].sort().join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

/**
 * The namespaced reference for one enrichment observation, or null for an
 * unusable provider id (or a malformed fingerprint). With a fingerprint — every
 * recorded contribution carries one — the reference is content-addressed;
 * without one it is the subject-level stem.
 */
export function enrichmentExternalRef(
  providerId: string, subject: EnrichmentSubject, entityId: string, fingerprint?: string | null,
): string | null {
  const profile = piEnrichmentProfile(providerId);
  const id = String(entityId ?? '').trim();
  if (!profile || !id) return null;
  if (fingerprint == null) return toNamespacedRef(profile.refProvider, `${subject}:${id}`);
  const fp = String(fingerprint).trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(fp)) return null;
  return toNamespacedRef(profile.refProvider, `${subject}:${id}:${fp}`);
}

/* ── Recording ──────────────────────────────────────────────────────────── */

export interface EnrichmentContributionDeps {
  recorder?: ContributionRecorder;
  findPersonProspects?: PersonProspectFinder;
  readProspectPerson?: ProspectPersonReader;
  readProspectAccountLink?: ProspectAccountLinkReader;
  findAccountProspects?: AccountProspectFinder;
}

interface Target { prospectId: string; resolvedBy: 'caller' | 'person_anchor' | 'account_link'; accountLink: AccountLinkEvidence | null }

export async function recordEnrichmentContribution(
  input: EnrichmentContributionInput,
  deps: EnrichmentContributionDeps = {},
): Promise<EnrichmentContributionOutcome> {
  const skip = (reason: EnrichmentSkipReason): EnrichmentContributionOutcome => {
    recordProvenanceOutcome('pi_enrichment', 'skipped', {
      reason, organizationId: input.organizationId, providerId: input.providerId, subject: input.subject,
    });
    return { status: 'skipped', reason };
  };

  try {
    const profile = piEnrichmentProfile(input.providerId);
    const fingerprint = enrichmentObservationFingerprint(input.observedValues);
    const externalRef = enrichmentExternalRef(input.providerId, input.subject, input.entityId, fingerprint);
    if (!profile || !externalRef) return skip('unmapped_provider');
    if (!input.sourceRecordId) return skip('no_source_record');

    const callerProspect = String(input.prospectId ?? '').trim() || null;
    const targets: Target[] = [];

    if (input.subject === 'person') {
      if (callerProspect) {
        const anchored = await (deps.readProspectPerson ?? defaultProspectPersonReader)(input.organizationId, callerProspect);
        if (anchored !== input.entityId) return skip('prospect_not_anchored_to_person');
        targets.push({ prospectId: callerProspect, resolvedBy: 'caller', accountLink: null });
      } else {
        const found = await (deps.findPersonProspects ?? defaultPersonProspectFinder)(
          input.organizationId, input.entityId, 2,
        );
        if (found.length === 0) return skip('no_prospect');
        if (found.length > 1) return skip('ambiguous_prospect');
        targets.push({ prospectId: found[0], resolvedBy: 'person_anchor', accountLink: null });
      }
    } else if (callerProspect) {
      const via = await (deps.readProspectAccountLink ?? defaultProspectAccountLinkReader)(
        input.organizationId, callerProspect, input.entityId,
      );
      if (!via) return skip('account_link_unevidenced');
      targets.push({ prospectId: callerProspect, resolvedBy: 'caller', accountLink: via });
    } else {
      const found = await (deps.findAccountProspects ?? defaultAccountProspectFinder)(
        input.organizationId, input.entityId, ACCOUNT_FANOUT_CAP + 1,
      );
      // Never a partial fan-out: an incomplete or over-cap set records nothing.
      if (!found.complete || found.targets.length > ACCOUNT_FANOUT_CAP) return skip('too_many_account_prospects');
      if (found.targets.length === 0) return skip('no_prospect');
      for (const f of found.targets) targets.push({ prospectId: f.prospectId, resolvedBy: 'account_link', accountLink: f.via });
    }

    const { observedAt, observedAtBasis } = sourceObservedAt(input.observedAt, input.ingestedAt);
    const recordOne = (t: Target) => recordObservedContribution('pi_enrichment', {
      organizationId: input.organizationId,
      canonicalLeadId: t.prospectId,
      // Enrichment NEVER originates a prospect.
      leadCreated: false,
      sourceCategory: profile.sourceCategory,
      externalRef,
      sourceRecordId: input.sourceRecordId,
      platform: profile.platform,
      sourceUrl: null,
      observedAt,
      ingestionRunId: input.correlationId ?? null,
      evidence: {
        sourceRecordId: input.sourceRecordId,
        subject: input.subject,
        // Account evidence is ABOUT THE COMPANY — never presented as person-level.
        evidenceLevel: input.subject,
        entityId: input.entityId,
        personId: input.subject === 'person' ? input.entityId : null,
        accountId: input.subject === 'account' ? input.entityId : null,
        accountLink: t.accountLink,
        attributes: [...(input.attributes ?? [])],
        observationFingerprint: fingerprint,
        payloadHash: input.payloadHash ?? null,
      },
      sourceMetadata: {
        path: 'pi_enrichment',
        providerId: profile.platform,
        observedAtBasis,
        prospectResolvedBy: t.resolvedBy,
        correlationId: input.correlationId ?? null,
      },
    }, deps.recorder);

    if (input.subject === 'account' && !callerProspect) {
      const out: EnrichmentFanoutTarget[] = [];
      for (const t of targets) out.push({ prospectId: t.prospectId, outcome: await recordOne(t) });
      return { status: 'fanout', targets: out };
    }
    return await recordOne(targets[0]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    recordProvenanceOutcome('pi_enrichment', 'error', {
      organizationId: input.organizationId, providerId: input.providerId, subject: input.subject, message,
    });
    return { status: 'error', code: 'threw', message };
  }
}
