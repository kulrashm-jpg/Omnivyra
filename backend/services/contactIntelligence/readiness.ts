/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 5 — Contact readiness (pure; assessment only).
 *
 * Verifies that Contact Understanding is ready to serve as a canonical source for downstream programs,
 * and — separately — reports honestly what still stands between the subsystem and activation. Nothing
 * here activates anything: every function is a pure assessment over inputs the caller supplies.
 *
 * ─── TWO DIFFERENT QUESTIONS, DELIBERATELY NOT MERGED ──────────────────────────────────────────────
 * CONSUMER readiness asks "is the shape right" — does an understanding satisfy the platform's
 * consumption surface: canonical shape, references-only graph, determinism, projectability, contract
 * conformance. It is a property of the code and is true today.
 *
 * ACTIVATION readiness asks "may it be switched on" — is the flag set, is a persistence store bound,
 * is a producer registered. It is a property of the DEPLOYMENT and is false today, on purpose.
 *
 * Collapsing them into one boolean is how a subsystem that is structurally sound gets reported as
 * "not ready" forever, or worse, how one whose store is unbound gets reported as ready. A consumer
 * needs to know which of the two is missing, because the remedies belong to different owners.
 *
 * ─── CAPABILITY readiness ──────────────────────────────────────────────────────────────────────────
 * Between those sits the question a consumer actually asks first: given the evidence I can supply,
 * which parts of a contact will actually carry data? A `contacts` row alone grounds identity and
 * profile and nothing else, so a caller that has fetched no channels learns that reachability will
 * abstain BEFORE it builds anything on it.
 */

import type { ContactUnderstanding } from './types';
import type { ContactEvidenceInput } from './fromEvidence';
import { assembleContactUnderstanding } from './assembly';
import { validateContactContract, CONTACT_CANONICAL_CONTRACT } from './contract';
import { isContactUnderstandingEnabled, isContactProjectionAuthoritative } from './flags';
import type { ContactShadowPersistDeps } from './production/contactShadowPersistence';

// ── Consumer readiness ─────────────────────────────────────────────────────────────────────────────
export const CONTACT_DOWNSTREAM_CONSUMERS = ['lead', 'journey', 'intent', 'qualification', 'crm', 'outreach'] as const;
export type ContactDownstreamConsumer = typeof CONTACT_DOWNSTREAM_CONSUMERS[number];

export interface ContactConsumerReadiness {
  exposesCanonicalSurface: boolean;  // {graph, reasoning, contradictions, builtAt}
  referencesOnly: boolean;
  deterministic: boolean;
  projectable: boolean;
  graphCitizen: boolean;
  tenantScoped: boolean;
  contractConformant: boolean;
  consumers: Record<ContactDownstreamConsumer, boolean>;
  ready: boolean;
}

/** Structural readiness — a property of the code, assessed by building twice and comparing. */
export function assessContactConsumerReadiness(input: ContactEvidenceInput): ContactConsumerReadiness {
  const a = assembleContactUnderstanding(input);
  const b = assembleContactUnderstanding(input);
  const u: ContactUnderstanding = a.understanding;

  const exposesCanonicalSurface = !!u.graph?.root && Array.isArray(u.graph.edges) && Array.isArray(u.reasoning) && Array.isArray(u.contradictions) && typeof u.builtAt === 'string';
  const graphCitizen = u.graph.root.type === 'contact' && u.graph.edges.every((e) => e.from.type === 'contact');
  const referencesOnly = u.graph.edges.every((e) => e.to.type !== 'contact');
  const deterministic = JSON.stringify(a.understanding) === JSON.stringify(b.understanding);
  const projectable = a.projection.key.contactId === u.key.contactId && a.projection.key.companyId === u.key.companyId;
  const tenantScoped = !!String(u.key.companyId ?? '').trim();
  const contractConformant = validateContactContract(u).conforms;

  const ready = exposesCanonicalSurface && graphCitizen && referencesOnly && deterministic && projectable && tenantScoped && contractConformant;
  const consumers = Object.fromEntries(CONTACT_DOWNSTREAM_CONSUMERS.map((c) => [c, ready])) as Record<ContactDownstreamConsumer, boolean>;
  return { exposesCanonicalSurface, referencesOnly, deterministic, projectable, graphCitizen, tenantScoped, contractConformant, consumers, ready };
}

// ── Capability readiness ───────────────────────────────────────────────────────────────────────────
export const CONTACT_CAPABILITIES = ['identity', 'profile', 'affiliation', 'channels', 'engagement', 'attribution'] as const;
export type ContactCapability = typeof CONTACT_CAPABILITIES[number];

export interface ContactCapabilityRow { capability: ContactCapability; grounded: boolean; reason: string | null; }
export interface ContactCapabilityReadiness { rows: ContactCapabilityRow[]; groundedCount: number; abstainingCount: number; }

/**
 * Which capabilities the supplied evidence can actually ground. Reported BEFORE anything is built, so
 * a caller learns that reachability will abstain rather than discovering an empty facet afterwards.
 */
export function assessContactCapabilityReadiness(input: ContactEvidenceInput): ContactCapabilityReadiness {
  const row = (capability: ContactCapability, grounded: boolean, reason: string): ContactCapabilityRow =>
    ({ capability, grounded, reason: grounded ? null : reason });

  const rows: ContactCapabilityRow[] = [
    row('identity', !!input.identity, 'no platform identity observation supplied'),
    row('profile', !!input.profile, 'no profile observation supplied'),
    row('affiliation', !!input.affiliation, 'no affiliation observation supplied (a contacts row grounds none)'),
    row('channels', !!input.channels?.length, 'no channel observations supplied'),
    row('engagement', !!input.interactions?.length, 'no interaction observations supplied'),
    row('attribution', !!input.sourceRefs?.length, 'no source references supplied'),
  ];
  const groundedCount = rows.filter((r) => r.grounded).length;
  return { rows, groundedCount, abstainingCount: rows.length - groundedCount };
}

// ── Activation validation ──────────────────────────────────────────────────────────────────────────
export type ContactActivationBlocker =
  | 'flag_disabled'
  | 'projection_not_authoritative'
  | 'no_persistence_binding'
  | 'no_producer_registration';

export interface ContactActivationValidation {
  understandingEnabled: boolean;
  projectionAuthoritative: boolean;
  persistenceBound: boolean;
  blockers: ContactActivationBlocker[];
  canActivate: boolean;
}

export interface ContactActivationProbe {
  /** Supplied when a caller has bound a store. Absent ⇒ persistence is unbound. */
  persist?: ContactShadowPersistDeps;
  /** Supplied when a caller has registered a producer in its own runtime. */
  producerRegistered?: boolean;
}

/**
 * Deployment readiness. Honest by construction: it reports what is missing rather than what is
 * present, and it cannot be satisfied by this subsystem alone — `no_persistence_binding` is resolved
 * by whoever owns the store, and `no_producer_registration` by whoever owns the runtime.
 *
 * `canActivate` requires the understanding flag AND a bound store AND a registered producer. The
 * authoritative-projection flag is reported but does NOT gate activation: shadow operation is a valid
 * and expected activation state, and requiring authority to activate would force a subsystem straight
 * from dark to load-bearing.
 */
export function validateContactActivation(probe: ContactActivationProbe = {}): ContactActivationValidation {
  const understandingEnabled = isContactUnderstandingEnabled();
  const projectionAuthoritative = isContactProjectionAuthoritative();
  const persistenceBound = typeof probe.persist?.readShadow === 'function' && typeof probe.persist?.writeShadow === 'function';
  const producerRegistered = probe.producerRegistered === true;

  const blockers: ContactActivationBlocker[] = [];
  if (!understandingEnabled) blockers.push('flag_disabled');
  if (!persistenceBound) blockers.push('no_persistence_binding');
  if (!producerRegistered) blockers.push('no_producer_registration');
  if (!projectionAuthoritative) blockers.push('projection_not_authoritative');

  return {
    understandingEnabled,
    projectionAuthoritative,
    persistenceBound,
    blockers,
    // `projection_not_authoritative` is informational — see the note above.
    canActivate: understandingEnabled && persistenceBound && producerRegistered,
  };
}

// ── Runtime compatibility ──────────────────────────────────────────────────────────────────────────
export interface ContactRuntimeCompatibility {
  contractVersion: number;
  modelVersion: number;
  compatible: boolean;
  reason: string | null;
}

/**
 * Whether a consumer built against `expectedContractVersion` may consume this subsystem. Contact
 * refuses to serve a consumer pinned to a different contract version rather than silently serving a
 * shape that consumer was not written for.
 */
export function checkContactRuntimeCompatibility(expectedContractVersion: number, expectedModelVersion?: number): ContactRuntimeCompatibility {
  const contractVersion = CONTACT_CANONICAL_CONTRACT.contractVersion;
  const modelVersion = CONTACT_CANONICAL_CONTRACT.modelVersion;

  if (expectedContractVersion !== contractVersion) {
    return { contractVersion, modelVersion, compatible: false, reason: `consumer expects contract v${expectedContractVersion}, subsystem publishes v${contractVersion}` };
  }
  if (expectedModelVersion != null && expectedModelVersion !== modelVersion) {
    return { contractVersion, modelVersion, compatible: false, reason: `consumer expects model v${expectedModelVersion}, subsystem publishes v${modelVersion}` };
  }
  return { contractVersion, modelVersion, compatible: true, reason: null };
}
