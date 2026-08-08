/**
 * CI-B202..B207 — Contact evidence assembly (pure, deterministic).
 *
 * Normalises ALREADY-FETCHED, source-shaped observations of a platform person into canonical
 * `EvidenceRef[]`, then derives facets, score contributions and references-only graph edges from them.
 * It performs NO I/O: fetching is the caller's concern, exactly as `intentFromEvidence` and the
 * company evidence adapters are handed their inputs rather than reading them. Nothing here is a
 * producer, a writer, or a runtime consumer.
 *
 * ─── THE FOUR RULES THIS LAYER ENFORCES ────────────────────────────────────────────────────────────
 *  1. ABSTAIN, NEVER INFER. A facet is populated only when evidence for it was supplied. A score
 *     dimension abstains (`value: null`) rather than defaulting to 0 — an abstention says "not
 *     measured", a 0 says "measured and found absent", and collapsing them would make an unenriched
 *     contact indistinguishable from an unreachable one.
 *  2. PROVENANCE SURVIVES. Every `EvidenceRef` carries the `source.system` its observation came from,
 *     per-input rather than per-call, so a channel learned from LinkedIn is never attributed to the
 *     caller's default source.
 *  3. CONFIDENCE IS DERIVED, NOT ASSERTED. Facet and contribution confidence come from
 *     `facetConfidenceFromEvidence` over the exact evidence subset that produced the value. This layer
 *     never invents a confidence number.
 *  4. REFERENCES ONLY. `contact_of` (→ person) and `works_at` (→ company) are edges to entities owned
 *     elsewhere. Contact owns its own node and nothing else.
 *
 * ─── WHY THE COUNT-BASED DIMENSIONS SATURATE ───────────────────────────────────────────────────────
 * `identity_strength`, `reachability` and `engagement_depth` are all "how much of X was observed",
 * and none has a natural maximum. They use n/(n+k), which is monotonic, never reaches 1.0, and has no
 * cliff — more evidence always moves the number, and the score never claims certainty it cannot have.
 * A fixed threshold (e.g. "3 channels ⇒ 1.0") would assert a ceiling nothing in the data supports.
 * Each k is stated at its use site with the midpoint it implies.
 *
 * Deterministic: `asOf` is injected, no clock is read, no randomness, and every collection is sorted
 * before it reaches an output.
 */

import type {
  ContactFacets, ContactContribution, ContactChannelType, ContactChannelEntry,
  ContactPlatform, EvidenceRef,
} from './types';
import type { GraphEdge, ReasoningTrace } from '../intelligence/canonical';
import { facet, evidenceRef, facetConfidenceFromEvidence, decayFactor, clamp01, reasoningTrace } from '../intelligence/canonical';
import { contactEdge } from './graph';

// ── Source-shaped inputs (already fetched; this layer only normalizes) ─────────────────────────────
export interface ContactIdentityInput { platform: ContactPlatform; platformUserId: string; handle?: string; contactKey?: string; observedAt: string; source?: string; }
export interface ContactProfileInput { displayName?: string; username?: string; profileUrl?: string; avatarUrl?: string; bio?: string; observedAt: string; source?: string; }
export interface ContactAffiliationInput { companyRef?: string | null; role?: string; seniority?: string; department?: string; observedAt: string; source?: string; }
export interface ContactChannelObservation { channel: ContactChannelType; value?: string; verified?: boolean; observedAt: string; source?: string; }
export interface ContactInteractionObservation { threadRef?: string; messageRef?: string; observedAt: string; source?: string; }

export interface ContactEvidenceInput {
  companyId: string;
  contactId: string;
  /** Injected instant. Nothing here reads a clock. */
  asOf: string;
  /** Default provenance for observations that do not name their own source. */
  source?: string;
  /** Upward reference to the Canonical Person. `null`/absent ⇒ not yet resolved — never fabricated. */
  unifiedPersonId?: string | null;
  identity?: ContactIdentityInput;
  profile?: ContactProfileInput;
  affiliation?: ContactAffiliationInput;
  channels?: ContactChannelObservation[];
  interactions?: ContactInteractionObservation[];
  sourceRefs?: string[];
  /** Freshness half-life for the recency dimension, days. */
  halfLifeDays?: number;
}

/** Deterministic canonical id: slug of contactId (exact — same id ⇒ same contact). */
export function resolveContactId(contactId: string): string {
  return String(contactId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'contact';
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');
/** Saturating observation curve — see the header note on why this shape rather than a threshold. */
const saturate = (n: number, k: number): number => (n <= 0 ? 0 : clamp01(n / (n + k)));

export interface AdoptedContact {
  key: { companyId: string; contactId: string };
  facets: Partial<ContactFacets>;
  evidence: EvidenceRef[];
  contributions: ContactContribution[];
  edges: GraphEdge[];
  reasoning: ReasoningTrace[];
}

export function contactFromEvidence(input: ContactEvidenceInput): AdoptedContact {
  const src = input.source ?? 'contact_capture';
  const id = resolveContactId(input.contactId);
  const halfLife = input.halfLifeDays ?? 90;
  const asOf = input.asOf;

  const evidence: EvidenceRef[] = [];
  /**
   * Evidence whose `observedAt` came from the INPUT rather than from `asOf`. Only these are real
   * observations of the world, and only these may drive `recency`. The canonical-id anchor and the
   * attribution refs are stamped at `asOf` because the caller supplied no timestamp for them —
   * counting either would peg the freshest observation at `asOf` and make recency permanently 1.0,
   * which would report a contact last seen two years ago as maximally fresh.
   */
  const datedEv: EvidenceRef[] = [];
  const contributions: ContactContribution[] = [];
  const edges: GraphEdge[] = [];
  const reasoning: ReasoningTrace[] = [];
  const facets: Partial<ContactFacets> = {};

  const one = <T>(name: keyof ContactFacets, value: T, evs: EvidenceRef[]) => { (facets as any)[name] = facet(value, evs); };
  const mk = (label: string, value: string | number, at: string, idx: number, srcSys: string): EvidenceRef => {
    const e = evidenceRef({ id: `contact:${label}:${idx}:${srcSys}:${at}`, kind: 'observed', label, value, source: { system: srcSys }, observedAt: at, recordedAt: at });
    evidence.push(e); return e;
  };
  /** `mk` for an observation that carries its own timestamp — the only kind recency may read. */
  const mkDated = (label: string, value: string | number, at: string, idx: number, srcSys: string): EvidenceRef => {
    const e = mk(label, value, at, idx, srcSys); datedEv.push(e); return e;
  };
  /** A dimension always contributes: with evidence it carries a value, without it abstains explicitly. */
  const contribute = (dimension: ContactContribution['dimension'], value: number | null, evs: EvidenceRef[]) => {
    contributions.push({ dimension, contributor: 'contactFromEvidence', method: 'deterministic', value, confidence: evs.length ? facetConfidenceFromEvidence(evs) : 0, evidence: evs, asOf });
  };

  // ── Identity ────────────────────────────────────────────────────────────────────────────────────
  // `canonical_id` is derived from the key, not inferred about the world, so it is always safe to
  // state. Platform fields appear only when observed. `unifiedPersonId` is a REFERENCE upward.
  const identityEv: EvidenceRef[] = [mk('contact', id, asOf, 0, src)];
  const idIn = input.identity;
  if (idIn) {
    const idSrc = idIn.source ?? src;
    identityEv.push(mkDated('platform', idIn.platform, idIn.observedAt, 1, idSrc));
    identityEv.push(mkDated('platform_user_id', idIn.platformUserId, idIn.observedAt, 2, idSrc));
    if (has(idIn.handle)) identityEv.push(mkDated('handle', idIn.handle!, idIn.observedAt, 3, idSrc));
    if (has(idIn.contactKey)) identityEv.push(mkDated('contact_key', idIn.contactKey!, idIn.observedAt, 4, idSrc));
  }
  one('identity', {
    canonical_id: id,
    platform: idIn?.platform,
    platformUserId: idIn?.platformUserId,
    handle: idIn?.handle,
    contactKey: idIn?.contactKey,
    unifiedPersonId: input.unifiedPersonId ?? null,
  }, identityEv);

  if (has(input.unifiedPersonId)) {
    edges.push(contactEdge(id, 'contact_of', 'person', input.unifiedPersonId!, [mk('unified_person', input.unifiedPersonId!, asOf, 0, src)], 0.9));
  }

  // ── Profile ─────────────────────────────────────────────────────────────────────────────────────
  const pIn = input.profile;
  if (pIn) {
    const pSrc = pIn.source ?? src;
    const pEv: EvidenceRef[] = [];
    if (has(pIn.displayName)) pEv.push(mkDated('display_name', pIn.displayName!, pIn.observedAt, 0, pSrc));
    if (has(pIn.username)) pEv.push(mkDated('username', pIn.username!, pIn.observedAt, 1, pSrc));
    if (has(pIn.profileUrl)) pEv.push(mkDated('profile_url', pIn.profileUrl!, pIn.observedAt, 2, pSrc));
    if (has(pIn.avatarUrl)) pEv.push(mkDated('avatar_url', pIn.avatarUrl!, pIn.observedAt, 3, pSrc));
    if (has(pIn.bio)) pEv.push(mkDated('bio', pIn.bio!, pIn.observedAt, 4, pSrc));
    // A profile input carrying no populated field is not a profile — abstain rather than set an empty facet.
    if (pEv.length) one('profile', { displayName: pIn.displayName, username: pIn.username, profileUrl: pIn.profileUrl, avatarUrl: pIn.avatarUrl, bio: pIn.bio }, pEv);
  }

  // ── Affiliation ─────────────────────────────────────────────────────────────────────────────────
  const aIn = input.affiliation;
  if (aIn) {
    const aSrc = aIn.source ?? src;
    const aEv: EvidenceRef[] = [];
    if (has(aIn.companyRef)) aEv.push(mkDated('company_ref', aIn.companyRef!, aIn.observedAt, 0, aSrc));
    if (has(aIn.role)) aEv.push(mkDated('role', aIn.role!, aIn.observedAt, 1, aSrc));
    if (has(aIn.seniority)) aEv.push(mkDated('seniority', aIn.seniority!, aIn.observedAt, 2, aSrc));
    if (has(aIn.department)) aEv.push(mkDated('department', aIn.department!, aIn.observedAt, 3, aSrc));
    if (aEv.length) {
      one('affiliation', { companyRef: aIn.companyRef ?? null, role: aIn.role, seniority: aIn.seniority, department: aIn.department }, aEv);
      // The company is REFERENCED — Contact never re-owns a company node.
      if (has(aIn.companyRef)) edges.push(contactEdge(id, 'works_at', 'company', aIn.companyRef!, aEv, 0.7));
    }
  }

  // ── Channels + reachability ─────────────────────────────────────────────────────────────────────
  const channelObs = [...(input.channels ?? [])].sort((x, y) => x.channel.localeCompare(y.channel) || x.observedAt.localeCompare(y.observedAt));
  const channelEv: EvidenceRef[] = [];
  const byChannel = new Map<string, ContactChannelEntry>();
  channelObs.forEach((c, i) => {
    const cSrc = c.source ?? src;
    channelEv.push(mkDated(`channel:${c.channel}`, c.value ?? c.channel, c.observedAt, i, cSrc));
    const prev = byChannel.get(c.channel);
    // Verification is monotonic: once a channel is observed verified, a later unverified sighting of
    // the same channel does not un-verify it.
    byChannel.set(c.channel, { channel: c.channel, value: c.value ?? prev?.value, verified: (prev?.verified ?? false) || (c.verified ?? false) });
  });
  const distinctChannels = byChannel.size;
  if (distinctChannels > 0) {
    const channels = [...byChannel.values()].sort((x, y) => String(x.channel).localeCompare(String(y.channel)));
    // `preferred` is the first VERIFIED channel in deterministic order, or the first channel. It is a
    // selection among observed channels, never a new fact.
    const preferred = (channels.find((c) => c.verified) ?? channels[0]).channel;
    one('channels', { channels, preferred }, channelEv);
    one('reachability', { reachable: true, distinctChannels }, channelEv);
  }

  // ── Engagement ──────────────────────────────────────────────────────────────────────────────────
  const interactions = [...(input.interactions ?? [])].sort((x, y) => x.observedAt.localeCompare(y.observedAt));
  const interactionEv: EvidenceRef[] = [];
  interactions.forEach((it, i) => {
    const iSrc = it.source ?? src;
    interactionEv.push(mkDated('interaction', it.messageRef ?? it.threadRef ?? 'interaction', it.observedAt, i, iSrc));
  });
  const distinctThreads = new Set(interactions.map((i) => i.threadRef).filter(Boolean) as string[]).size;
  if (interactions.length > 0) {
    one('engagement', {
      totalMessages: interactions.length,
      totalThreads: distinctThreads,
      firstInteractionAt: interactions[0].observedAt,
      lastInteractionAt: interactions[interactions.length - 1].observedAt,
    }, interactionEv);
  }

  // ── Attribution ─────────────────────────────────────────────────────────────────────────────────
  const sourceRefs = [...new Set(input.sourceRefs ?? [])].sort();
  if (sourceRefs.length) {
    const sEv = sourceRefs.map((r, i) => mk('source_ref', r, asOf, i, src));
    one('attribution', { sourceRefs, firstSeenSource: sourceRefs[0] }, sEv);
  }

  // ── Score contributions ─────────────────────────────────────────────────────────────────────────
  // identity_strength: k=2 ⇒ two independent corroborating sources sit at 0.5. Identity asserted by a
  // single observer is a weak claim however detailed it is, which is why this counts SOURCES not fields.
  const identityCorroboration = new Set(identityEv.concat(facets.profile ? (facets.profile.evidence ?? []) : []).map((e) => e.source.system)).size;
  contribute('identity_strength', idIn ? saturate(identityCorroboration, 2) : null, idIn ? identityEv : []);

  // reachability: k=1 ⇒ one channel is 0.5, two 0.67. One route to a person is real but fragile.
  contribute('reachability', distinctChannels > 0 ? saturate(distinctChannels, 1) : null, channelEv);

  // engagement_depth: k=5 ⇒ five observed interactions sit at 0.5. Counts interactions, not threads,
  // because a long single thread is genuine depth.
  contribute('engagement_depth', interactions.length > 0 ? saturate(interactions.length, 5) : null, interactionEv);

  // recency: the shared freshness decay over the freshest DATED observation. Naturally 0..1, so no
  // saturation. Interactions are preferred when present — how recently someone actually engaged is a
  // sharper signal than when their profile was last scraped. Abstains when nothing was dated.
  const recencyEv = interactionEv.length ? interactionEv : datedEv;
  const freshest = recencyEv.reduce<string | null>((acc, e) => (acc === null || e.observedAt > acc ? e.observedAt : acc), null);
  contribute('recency', freshest ? clamp01(decayFactor(freshest, asOf, halfLife)) : null, recencyEv);

  // ── Reasoning ───────────────────────────────────────────────────────────────────────────────────
  const unknowns: string[] = [];
  if (!idIn) unknowns.push('no_platform_identity_evidence');
  if (distinctChannels === 0) unknowns.push('no_channel_evidence');
  if (interactions.length === 0) unknowns.push('no_interaction_evidence');
  if (!has(input.unifiedPersonId)) unknowns.push('unresolved_canonical_person');

  reasoning.push(reasoningTrace({
    claim: 'contact_identity',
    conclusion: idIn ? `${idIn.platform}:${idIn.platformUserId}` : null,
    because: idIn ? identityEv : [],
    confidence: idIn ? facetConfidenceFromEvidence(identityEv) : 0,
    method: 'deterministic',
    unknowns,
  }));

  return { key: { companyId: input.companyId, contactId: id }, facets, evidence, contributions, edges, reasoning };
}
