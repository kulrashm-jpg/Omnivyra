/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 · Phase 4 — Canonical Contact Producer.
 *
 * THE production seam: builds a canonical ContactUnderstanding from evidence already available at the
 * write path — a `contacts` row plus whatever channel/interaction observations the caller has already
 * fetched — and returns a persistable shadow record. Pure and deterministic (timestamps injected).
 * NO fetch, NO fabrication, NO defaults: unknown remains unknown.
 *
 * ─── EVIDENCE COVERAGE (honest) ────────────────────────────────────────────────────────────────────
 * A `contacts` row grounds identity (platform, platform_user_id, contact_key) and profile
 * (display_name, profile_url), and carries the upward reference to the Canonical Person
 * (unified_person_id). It grounds NOTHING about channels, interactions or affiliation — those columns
 * do not exist — so a producer run over a bare row abstains all three, and the affiliation facet, the
 * reachability facet and the engagement facet are absent rather than empty. A caller that has already
 * fetched such observations may pass them; one that has not gets an honest partial understanding.
 *
 * ─── OBSERVATION TIME IS NOT INVENTED ──────────────────────────────────────────────────────────────
 * The row's `updated_at` is when the row was last written, which is the best available evidence for
 * when its fields were observed. When it is absent the identity carries NO dated observation rather
 * than being stamped `asOf` — stamping it would make a row of unknown age score maximally fresh, the
 * same defect Phase 2 fixed in the recency dimension.
 *
 * ─── PARITY IS CARRIED, NOT DROPPED ────────────────────────────────────────────────────────────────
 * The record's `parity` is the measured `compareToRaw` value, not `null`. A shadow record whose parity
 * is unknown cannot answer the only question a shadow exists to answer — did the pipeline carry the
 * row through intact — so it is computed here and travels with the record.
 *
 * DORMANT / UNWIRED: importing this module changes no production behaviour. It is called by nothing,
 * registered nowhere, and gated by no flag because it has no side effects to gate.
 */

import type { ContactUnderstanding, ContactProjection, ContactUnderstandingShadowRecord } from '../types';
import type { ContactEvidenceInput, ContactChannelObservation, ContactInteractionObservation } from '../fromEvidence';
import type { ContactShadowComparison } from '../shadowRuntime';
import type { LegacyContactFields } from '../persistence';
import { assembleContactUnderstanding } from '../assembly';
import { compareToRaw } from '../shadowRuntime';
import { toShadowRecord, toLegacyFields } from '../persistence';

export const CONTACT_PRODUCER = 'canonicalContactProducer@1';

/** Already-fetched write-path inputs. No fetch happens here. */
export interface ContactWriteInputs {
  companyId: string;
  contactId: string;
  asOf: string;
  source?: string;
  /** When the row's fields were observed. Absent ⇒ identity carries no dated observation. */
  observedAt?: string | null;
  platform?: string | null;
  platformUserId?: string | null;
  contactKey?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
  unifiedPersonId?: string | null;
  /** Supplementary observations the caller has ALREADY fetched. Absent ⇒ abstain. */
  channels?: ContactChannelObservation[];
  interactions?: ContactInteractionObservation[];
  sourceRefs?: string[];
}

const clean = (v?: string | null): string | undefined => (v == null || String(v).trim() === '' ? undefined : String(v).trim());

/**
 * Map write-path inputs → the Phase 2 evidence contract. Identity and profile are emitted only when
 * BOTH a grounding field and an observation time exist: a field with no observation time has no place
 * on an evidence-weighted timeline, and inventing one would corrupt every freshness computation
 * downstream.
 */
export function collectContactEvidence(input: ContactWriteInputs): ContactEvidenceInput {
  const observedAt = clean(input.observedAt);
  const platform = clean(input.platform);
  const platformUserId = clean(input.platformUserId);
  const displayName = clean(input.displayName);
  const profileUrl = clean(input.profileUrl);

  const out: ContactEvidenceInput = {
    companyId: input.companyId,
    contactId: input.contactId,
    asOf: input.asOf,
    source: input.source ?? 'contacts_row',
    unifiedPersonId: clean(input.unifiedPersonId) ?? null,
  };

  if (platform && platformUserId && observedAt) {
    out.identity = { platform, platformUserId, handle: clean(input.contactKey) ? undefined : undefined, contactKey: clean(input.contactKey), observedAt };
  }
  if ((displayName || profileUrl) && observedAt) {
    out.profile = { displayName, profileUrl, observedAt };
  }
  if (input.channels?.length) out.channels = input.channels;
  if (input.interactions?.length) out.interactions = input.interactions;
  if (input.sourceRefs?.length) out.sourceRefs = input.sourceRefs;
  return out;
}

/** A persistable canonical record — the shared shadow record plus its production provenance. */
export interface CanonicalContactRecord extends ContactUnderstandingShadowRecord {
  identity_source: 'evidence';
  producer: string;
}

export interface CanonicalContactResult {
  understanding: ContactUnderstanding;
  projection: ContactProjection;
  legacy: LegacyContactFields;
  comparison: ContactShadowComparison;
  record: CanonicalContactRecord;
}

/**
 * Produce the canonical evidence-derived contact + a persistable record. Pure: no I/O, no clock, no
 * randomness. Reuses the certified Phase 1–3 seams rather than re-deriving any of them.
 */
export function produceCanonicalContact(input: ContactWriteInputs): CanonicalContactResult {
  const evidence = collectContactEvidence(input);
  const { understanding, projection } = assembleContactUnderstanding(evidence);
  const comparison = compareToRaw(understanding, evidence);
  const legacy = toLegacyFields(understanding);
  const record: CanonicalContactRecord = {
    ...toShadowRecord(understanding, projection, comparison.parity),
    identity_source: 'evidence',
    producer: CONTACT_PRODUCER,
  };
  return { understanding, projection, legacy, comparison, record };
}

// ── Write-path adapter: a `contacts`-shaped row → ContactWriteInputs (no fetch) ─────────────────────
/** The subset of a `contacts` row this producer reads. Snake_case, as stored. */
export interface ContactRowLike {
  id?: string | null;
  organization_id?: string | null;
  platform?: string | null;
  platform_user_id?: string | null;
  contact_key?: string | null;
  display_name?: string | null;
  profile_url?: string | null;
  unified_person_id?: string | null;
  updated_at?: string | null;
}

/**
 * Build write-path inputs from a `contacts` row. `organization_id` becomes `companyId` — the tenant is
 * part of the identity under the frozen WS-5E decision, so a row without one cannot produce a
 * tenant-scoped understanding and yields an empty companyId the caller must reject.
 */
export function writeInputsFromContactRow(
  row: ContactRowLike,
  asOf: string,
  extra: Pick<ContactWriteInputs, 'channels' | 'interactions' | 'sourceRefs' | 'source'> = {},
): ContactWriteInputs {
  return {
    companyId: clean(row.organization_id) ?? '',
    contactId: clean(row.id) ?? '',
    asOf,
    observedAt: clean(row.updated_at) ?? null,
    platform: clean(row.platform) ?? null,
    platformUserId: clean(row.platform_user_id) ?? null,
    contactKey: clean(row.contact_key) ?? null,
    displayName: clean(row.display_name) ?? null,
    profileUrl: clean(row.profile_url) ?? null,
    unifiedPersonId: clean(row.unified_person_id) ?? null,
    ...extra,
  };
}
