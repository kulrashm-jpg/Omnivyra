/**
 * A3D — Omnivyra Extension → PI evidence.
 *
 * The extension already captures people. It just does not hand them to PI: its
 * observations land in `engagement_threads` / `engagement_messages` and stop
 * there, which is why the baseline audit found 126 engagement threads and 2
 * person-linked ones. This module is the missing hand-off, and nothing more.
 *
 * ─── IT COMPOSES; IT IMPLEMENTS ALMOST NOTHING ────────────────────────────
 * Identity is the W1 shadow resolver — the same primitive B1 itself calls —
 * which answers whether the tenant already knows this platform identity, agrees
 * on at most one person, and NEVER mints a person from a bare handle. Evidence
 * is LI-2's `ingestSourceRecord`. Both already exist, are tested against live
 * Postgres, and are not reimplemented here.
 *
 * ─── WHAT THE EXTENSION ACTUALLY GIVES US, AND WHAT IT DOES NOT ───────────
 * Traced end to end through three routes, correcting an earlier claim that
 * `raw_context` never leaves the extension — it does:
 *
 *   /events/comments → author_name, author_handle, author_self
 *   /events/dms      → participant_name, participant_username, avatar
 *   /events          → author_name, author_profile_url, author_username AND
 *                      data.raw_context { company, headline, location } from the
 *                      Sales Navigator and Recruiter scraper surfaces, persisted
 *                      by `extensionEventIngestionService` onto the message
 *
 * So profile context IS available. It is still not ICP evidence, for reasons
 * specific to each field — see `REFUSED_CONTEXT_MAPPINGS`. A headline is
 * marketing copy, not a job title; a company name is not an account identity;
 * "San Francisco Bay Area" is not an ISO country.
 *
 * This module therefore produces identity evidence, retains profile context as
 * labelled source evidence, and asserts ZERO canonical attributes. Mapping a
 * headline onto `job_title` would not merely be useless — `job_title` is matched
 * by exact `one_of`, so it would never match — it would let LI-2 overwrite a
 * real title with a slogan.
 *
 * PURE except where noted: `normalizeExtensionObservation` does no I/O.
 */

import {
  ingestSourceRecord, type ProviderSourceRecord,
} from '../../prospectIdentity/ingestionBoundary';
import {
  resolveSocialContactIdentity, type SocialContactResolutionResult,
} from '../../prospectIdentity/socialContactResolution';
import { resolveIdentityShadow } from '../../prospectIdentity/shadowResolver';
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
  /**
   * Free-form profile text the scraper captured on Sales Navigator and
   * Recruiter surfaces and transmitted as `data.raw_context`.
   *
   * Retained as EVIDENCE and never converted into a canonical attribute — see
   * `REFUSED_CONTEXT_MAPPINGS`.
   */
  readonly profileContext?: {
    readonly headline?: string | null;
    readonly company?: string | null;
    readonly location?: string | null;
  } | null;
}

/**
 * Context the extension really does transmit, and why each is NOT mapped to the
 * canonical attribute it superficially resembles.
 *
 * This is the difference between an acquisition source that is honest and one
 * that quietly degrades the spine. Each refusal below is specific:
 */
export const REFUSED_CONTEXT_MAPPINGS: Readonly<Record<string, string>> = {
  // A LinkedIn headline is marketing copy — "Helping SaaS teams scale | ex-Google"
  // — not a job title. `job_title` is matched by EXACT `one_of`, so a headline
  // would never match; worse, LI-2 would apply it as the canonical `job_title`
  // and overwrite a real one with a slogan.
  headline: 'job_title',
  // A company NAME is not an account identity. W4 requires a provider reference
  // or a domain precisely because two companies share a name every day, and no
  // domain is transmitted.
  company: 'account',
  // "San Francisco Bay Area" is not a city, a region or an ISO-3166 country.
  // Splitting it into one would be inference presented as observation.
  location: 'city / region / country_code',
};

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

  // Profile context is kept as EVIDENCE under its own key, verbatim and clearly
  // labelled as unmapped. A reviewer can read it; the evaluator never sees it,
  // and no canonical column is written from it. See REFUSED_CONTEXT_MAPPINGS.
  const context: Record<string, string> = {};
  for (const key of ['headline', 'company', 'location'] as const) {
    const value = clean(input.profileContext?.[key]);
    if (value) context[key] = value;
  }
  if (Object.keys(context).length) {
    rawPayload.observed_profile_context = context;
    rawPayload.observed_profile_context_note =
      'retained as source evidence only; deliberately not mapped to a canonical attribute';
  }

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
 * The identity port for the EXTENSION EVENT path.
 *
 * B1's `resolveSocialContactIdentity` links a `contacts` row — it ends in
 * `.eq('id', contactId)` against `contacts`. The extension event path creates
 * `engagement_authors`, not `contacts`, so handing it an engagement author id
 * would address a row that does not exist and silently link nothing.
 *
 * Rather than change B1 (its semantics are frozen) or make the engagement path
 * write a `contacts` row it has never written, this port calls the SAME W1
 * primitive B1 itself calls — `resolveIdentityShadow` — and returns the same
 * result shape. The identity question is identical; only the contact-linking
 * half, which has nothing to link here, is absent.
 *
 * It reads. It never writes an identity, and never creates a person.
 */
export function makeShadowIdentityPort(
  resolveShadow: typeof resolveIdentityShadow = resolveIdentityShadow,
): ExtensionBridgePorts['resolveIdentity'] {
  return (async (input: {
    organizationId: string; platform: string | null | undefined;
    platformUserId: string | null | undefined; now?: string;
  }) => {
    const resolution = await resolveShadow(
      input.organizationId,
      [{ claimType: 'external_id', value: input.platformUserId, platform: input.platform }],
      input.now,
    );

    // W1's vocabulary mapped onto B1's, so the bridge sees one shape.
    const outcome = resolution.outcome === 'matched_claim' || resolution.outcome === 'matched_spine'
      ? 'linked'
      : resolution.outcome === 'ambiguous' ? 'ambiguous'
        : resolution.outcome === 'unusable' ? 'unusable' : 'unresolved';

    return {
      outcome,
      // Attached ONLY on a single agreed person. Ambiguity yields null.
      personId: outcome === 'linked' ? resolution.personId : null,
      claim: 'not_attempted' as const,
      candidatePersonIds: resolution.candidatePersonIds,
      duplicatesParked: 0,
      failureCodes: [],
      reason: resolution.verdicts[0]?.reason ?? `w1 shadow: ${resolution.outcome}`,
    };
  }) as ExtensionBridgePorts['resolveIdentity'];
}

/** Ports for the extension event path: LI-2 for evidence, W1 for identity. */
export const extensionEventBridgePorts: ExtensionBridgePorts = {
  ingest: ingestSourceRecord,
  resolveIdentity: makeShadowIdentityPort(),
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

/**
 * Bridge an observation and NEVER let its failure touch the caller.
 *
 * The production caller is the extension ingestion path, which has already
 * written a valid engagement record by the time this runs. PI acquisition is
 * strictly additive: a bridge failure must leave that engagement capture
 * intact, so this swallows the error and returns a `not_observed` result
 * carrying the reason. The failure is reported, never silent, and never
 * rethrown into a path that would discard a real engagement event.
 */
export async function bridgeExtensionObservationSafely(
  organizationId: string,
  contactId: string,
  observation: ExtensionAuthorObservation,
  ports: ExtensionBridgePorts = defaultExtensionBridgePorts,
): Promise<BridgeResult> {
  try {
    return await bridgeExtensionObservation(organizationId, contactId, observation, ports);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Observable, not swallowed: the engagement write stands, and the PI
    // failure is stated with its cause.
    console.warn('[pi.extensionBridge] observation failed; engagement capture is unaffected', {
      platform: observation.platform,
      sourceReference: observation.sourceReference,
      reason: message,
    });
    return {
      outcome: 'not_observed', sourceRecordId: null, personId: null, identityOutcome: null,
      candidatePersonIds: [], assertionsRecorded: 0,
      reason: `PI observation failed; engagement capture unaffected: ${message}`,
    };
  }
}

/** The `data` an extension event carries, narrowed to what PI can use. */
export interface ExtensionEventData {
  readonly author_name?: string | null;
  readonly author_username?: string | null;
  readonly author_profile_url?: string | null;
  readonly author_self?: boolean | null;
  readonly created_at?: string | number | null;
  readonly raw_context?: Record<string, unknown> | null;
}

const contextString = (ctx: Record<string, unknown> | null | undefined, key: string): string | null =>
  (ctx && typeof ctx[key] === 'string' ? (ctx[key] as string) : null);

/**
 * Map one extension event onto an observation.
 *
 * The platform identity is `author_username` or the profile URL — NOT the
 * engagement layer's synthesised author id, which is derived from a message id
 * and identifies an event rather than a person. Using it would create a new
 * "identity" per comment.
 */
export function observationFromExtensionEvent(input: {
  readonly platform: string;
  readonly platformMessageId: string;
  readonly data: ExtensionEventData;
}): ExtensionAuthorObservation | null {
  const handle = clean(input.data.author_username);
  const profileUrl = clean(input.data.author_profile_url);
  // A profile URL is a durable platform identity; a display name is not.
  const identity = handle ?? profileUrl;
  if (!identity) return null;

  const ctx = input.data.raw_context ?? null;
  const createdAt = typeof input.data.created_at === 'string' ? input.data.created_at : null;

  return {
    platform: input.platform,
    platformUserId: handle ? null : profileUrl,
    handle: handle ?? profileUrl,
    displayName: clean(input.data.author_name),
    profileUrl,
    self: input.data.author_self === true,
    observedAt: createdAt,
    sourceReference: input.platformMessageId,
    profileContext: ctx
      ? {
        headline: contextString(ctx, 'headline'),
        company: contextString(ctx, 'company'),
        location: contextString(ctx, 'location'),
      }
      : null,
  };
}
