/**
 * A3D — Omnivyra Extension → PI evidence.
 *
 * The extension already captures people. It just does not hand them to PI: its
 * observations land in `engagement_threads` / `engagement_messages` and stop
 * there, which is why the baseline audit found 126 engagement threads and 2
 * person-linked ones. This module is the missing hand-off, and nothing more.
 *
 * ─── IT COMPOSES; IT IMPLEMENTS ALMOST NOTHING ────────────────────────────
 * Identity is B1's `resolveSocialContactIdentity`, which already asks the W1
 * shadow resolver whether the tenant knows this platform identity, records one
 * `external_id` claim, links only on a single deterministic match, parks a
 * duplicate candidate on ambiguity, and NEVER mints a person from a bare
 * handle. Evidence is LI-2's `ingestSourceRecord`. Both already exist, are
 * tested against live Postgres, and are not reimplemented here.
 *
 * ─── WHAT THE EXTENSION ACTUALLY GIVES US, AND WHAT IT DOES NOT ───────────
 * Traced end to end through `/api/extension/events/{comments,dms}`:
 *
 *   comments → author_name, author_handle, author_self
 *   dms      → participant_name, participant_username, participant_avatar_url
 *   stored   → engagement_authors(platform, platform_user_id, username,
 *              display_name, profile_url, avatar_url)
 *
 * That is IDENTITY evidence. It is not ICP evidence: no `job_title`,
 * `department`, `country_code`, `region` or `city` reaches the server.
 *
 * The LinkedIn scraper does build `rawContext: { company, headline, location }`
 * for Sales Navigator and Recruiter surfaces — but `rawContext` appears only in
 * `platforms/linkedin/scraper.js`, no transport sends it, and no route accepts
 * it. So it does not exist as far as the platform is concerned.
 *
 * This module therefore produces identity evidence and, today, ZERO attribute
 * assertions. It says so rather than inferring a title from a name, which is
 * the one thing that would make extension evidence look richer than it is.
 *
 * PURE except where noted: `normalizeExtensionObservation` does no I/O.
 */

import {
  ingestSourceRecord, type ProviderSourceRecord,
} from '../../prospectIdentity/ingestionBoundary';
import {
  resolveSocialContactIdentity, type SocialContactResolutionResult,
} from '../../prospectIdentity/socialContactResolution';
import type { ProviderField } from './contract';

/** The acquisition source id. Matches the descriptor in `sources.ts`. */
export const EXTENSION_SOURCE_ID = 'omnivyra_extension';

/**
 * Canonical attributes the extension could supply IF it transmitted them.
 * Empty on purpose: nothing in the shipped transport carries one. Kept as a
 * named constant so the day a field is added, one place changes.
 */
export const EXTENSION_SUPPLIED_ATTRIBUTES: readonly string[] = [];

/** Why an observation produced no attribute assertions. */
export const NO_ATTRIBUTE_REASON =
  'the extension transmits identity fields only (name, handle, profile url); no ICP-nameable '
  + 'attribute reaches the server, so no attribute assertion is made';

/** One person the extension observed, in whatever shape the route received. */
export interface ExtensionAuthorObservation {
  readonly platform: string;
  /** The platform's own id for this person. The strongest identity evidence. */
  readonly platformUserId?: string | null;
  /** Handle / username. Used as the identity when no platform id was captured. */
  readonly handle?: string | null;
  readonly displayName?: string | null;
  readonly profileUrl?: string | null;
  /** True when the logged-in user wrote it. Never a prospect. */
  readonly self?: boolean | null;
  /** The PLATFORM's timestamp for the observation, when it gave one. */
  readonly observedAt?: string | null;
  /** The engagement record this came from, for correlation only. */
  readonly sourceReference: string;
}

export type NormalizationOutcome =
  | 'usable'
  | 'self_authored'      // the tenant's own user; never a prospect
  | 'no_identity'        // nothing that could identify a person
  | 'unsupported_platform';

export interface NormalizedExtensionObservation {
  readonly outcome: NormalizationOutcome;
  /** The platform identity B1 will resolve on. Null when unusable. */
  readonly platformIdentity: string | null;
  readonly platform: string;
  /** Canonical attribute assertions. EMPTY today — see NO_ATTRIBUTE_REASON. */
  readonly fields: readonly ProviderField[];
  /** Redacted, LI-2 hashes and stores it. Never a token or a cookie. */
  readonly rawPayload: Record<string, unknown>;
  readonly observedAt: string | null;
  readonly reason: string;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

/** Platforms the extension is permitted to observe, per its manifest. */
const SUPPORTED_PLATFORMS = new Set(['linkedin', 'facebook', 'instagram', 'x']);

/**
 * Reduce one captured author to the provider-neutral shape.
 *
 * The identity preference is deliberate: a platform user id is immutable, a
 * handle can be changed by its owner, and a display name identifies nobody.
 * A name alone therefore yields `no_identity` rather than a weak match — B1
 * would refuse it anyway, and refusing here keeps the reason precise.
 */
export function normalizeExtensionObservation(
  input: ExtensionAuthorObservation,
): NormalizedExtensionObservation {
  const platform = clean(input.platform)?.toLowerCase() ?? '';
  const base = { platform, fields: [] as ProviderField[], observedAt: clean(input.observedAt) };

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return {
      ...base, outcome: 'unsupported_platform', platformIdentity: null, rawPayload: {},
      reason: `'${input.platform}' is not a platform the extension observes`,
    };
  }

  // The tenant's own user is not a prospect. Recording them would put the
  // operator into their own prospect repository.
  if (input.self === true) {
    return {
      ...base, outcome: 'self_authored', platformIdentity: null, rawPayload: {},
      reason: 'authored by the logged-in user; not a prospect observation',
    };
  }

  const platformIdentity = clean(input.platformUserId) ?? clean(input.handle);
  if (!platformIdentity) {
    return {
      ...base, outcome: 'no_identity', platformIdentity: null, rawPayload: {},
      reason: 'no platform user id or handle was captured; a display name identifies nobody',
    };
  }

  // Only fields PI's evidence model justifies. No avatar, no message content,
  // no session data — LI-2 redacts credential-shaped keys, but the smaller
  // rule is not to send them.
  const rawPayload: Record<string, unknown> = { platform, platform_identity: platformIdentity };
  const displayName = clean(input.displayName);
  const profileUrl = clean(input.profileUrl);
  if (displayName) rawPayload.display_name = displayName;
  if (profileUrl) rawPayload.profile_url = profileUrl;

  return {
    ...base,
    outcome: 'usable',
    platformIdentity,
    // EMPTY. See NO_ATTRIBUTE_REASON — inferring a title from a name here is
    // exactly the fabrication this pipeline exists to prevent.
    fields: [],
    rawPayload,
    reason: NO_ATTRIBUTE_REASON,
  };
}

export type BridgeOutcome =
  | 'observed_and_linked'     // evidence recorded, canonical person attached
  | 'observed_unlinked'       // evidence recorded, linkage withheld
  | 'observed_ambiguous'      // evidence recorded, >1 person matched, nothing linked
  | 'not_observed';           // nothing usable; nothing written

export interface BridgeResult {
  readonly outcome: BridgeOutcome;
  readonly sourceRecordId: string | null;
  readonly personId: string | null;
  readonly identityOutcome: SocialContactResolutionResult['outcome'] | null;
  readonly candidatePersonIds: readonly string[];
  readonly assertionsRecorded: number;
  readonly reason: string;
}

export interface ExtensionBridgePorts {
  ingest: typeof ingestSourceRecord;
  resolveIdentity: typeof resolveSocialContactIdentity;
  now(): string;
}

export const defaultExtensionBridgePorts: ExtensionBridgePorts = {
  ingest: ingestSourceRecord,
  resolveIdentity: resolveSocialContactIdentity,
  now: () => new Date().toISOString(),
};

/**
 * Bridge one observed author into PI evidence.
 *
 * @param organizationId the tenant the EXTENSION SESSION resolved. The routes
 *        derive it from an HMAC-signed token and trust no client-supplied
 *        organization_id; this function is given that verified value and never
 *        reads one from the payload.
 * @param contactId the engagement-side contact row B1 resolves identity for.
 */
export async function bridgeExtensionObservation(
  organizationId: string,
  contactId: string,
  observation: ExtensionAuthorObservation,
  ports: ExtensionBridgePorts = defaultExtensionBridgePorts,
): Promise<BridgeResult> {
  const org = String(organizationId ?? '').trim();
  if (!org) {
    return {
      outcome: 'not_observed', sourceRecordId: null, personId: null, identityOutcome: null,
      candidatePersonIds: [], assertionsRecorded: 0,
      reason: 'organizationId is required — an observation is never tenant-less',
    };
  }

  const normalized = normalizeExtensionObservation(observation);
  if (normalized.outcome !== 'usable' || !normalized.platformIdentity) {
    return {
      outcome: 'not_observed', sourceRecordId: null, personId: null, identityOutcome: null,
      candidatePersonIds: [], assertionsRecorded: 0, reason: normalized.reason,
    };
  }

  // ── identity first: B1 decides, and refuses to mint a person ─────────────
  const identity = await ports.resolveIdentity({
    organizationId: org,
    contactId,
    platform: normalized.platform,
    platformUserId: normalized.platformIdentity,
    now: normalized.observedAt ?? ports.now(),
  });

  const linkedPersonId = identity.outcome === 'linked' || identity.outcome === 'already_linked'
    ? identity.personId
    : null;

  // ── evidence: LI-2 owns the write, the hash and the redaction ────────────
  const record: ProviderSourceRecord = {
    organizationId: org,
    provider: EXTENSION_SOURCE_ID,
    entityType: 'person',
    // Stable per (source, platform, identity), so a repeated capture of the
    // same person updates the record instead of multiplying it.
    sourceRecordId: `${EXTENSION_SOURCE_ID}:${normalized.platform}:${normalized.platformIdentity}`,
    rawPayload: normalized.rawPayload,
    // Attached ONLY on a deterministic match. Ambiguity links nothing.
    personId: linkedPersonId,
    accountId: null,
    // The PLATFORM's timestamp, never our clock — `ingested_at` is LI-2's and
    // stays distinct from when the observation was actually made.
    observedAt: normalized.observedAt,
    ingestionRunId: observation.sourceReference,
    personAttributes: {},
    accountAttributes: {},
    // The extension states no confidence, so none is invented.
    confidence: null,
  };

  const ingested = await ports.ingest(record);

  const outcome: BridgeOutcome = linkedPersonId
    ? 'observed_and_linked'
    : identity.outcome === 'ambiguous' ? 'observed_ambiguous' : 'observed_unlinked';

  return {
    outcome,
    sourceRecordId: ingested.sourceRecordId,
    personId: linkedPersonId,
    identityOutcome: identity.outcome,
    candidatePersonIds: identity.candidatePersonIds,
    assertionsRecorded: ingested.assertionsRecorded,
    reason: outcome === 'observed_and_linked'
      ? `observation recorded and linked to ${linkedPersonId}`
      : `observation recorded; canonical linkage withheld (${identity.outcome}: ${identity.reason})`,
  };
}
