/**
 * Community / listening / engagement → canonical prospect bridge (Agent 4).
 *
 * Three producers already write signals that never reached the canonical PI
 * prospect model (`canonical_leads` + `unified_persons` + `source_records`):
 *
 *   producer                                   row(s)                               category
 *   ─────────────────────────────────────────  ───────────────────────────────────  ─────────────────────
 *   listening pipeline → opportunity feed      opportunity_feed_items + lead_signals social_listening when the
 *                                                                                    item came from a listening
 *                                                                                    execution, else community
 *   engagement lead detection (writeLeadSignal) lead_signals source_type=engagement  engagement
 *   scheduled lead detection (leadJobProcessor) lead_signals source_type=listening   social_listening
 *
 * Each builder below is PURE and decides, explicitly and from data, the source
 * category, the namespaced key, the platform, the evidence URL, the observed
 * time (and records which field it came from), the run id and the typed signal
 * references. The I/O lives in `bridge/bridgeCore.ts`, which reuses the existing
 * PI services only.
 *
 * ─── GATING ───────────────────────────────────────────────────────────────
 * Every public entry point runs ONLY when the existing PI ingestion gate allows
 * the tenant: `resolveLeadIngestionGate` = `ENABLE_LEAD_INGESTION` (global kill
 * switch, default OFF) AND the tenant's `lead_ingestion` feature flag (default
 * absent ⇒ OFF; evaluation errors ⇒ OFF). No flag is added or changed here.
 * Gate closed ⇒ no canonical write of any kind (not even a read beyond the
 * gate itself). Lead Intelligence adoption of COMMUNITY feed items is NOT gated
 * by this and keeps running as before. Lead Intelligence adoption of ENGAGEMENT
 * signals IS gated by both controls (owner decision 3) — see
 * `admitEngagementSignal`, which the engagement writer calls.
 *
 * --- IDENTITY (owner decision 2) -------------------------------------------
 * No person is ever created from a bare social handle (bridge/verifiedIdentity.ts).
 * A community / listening prospect may exist WITHOUT a person; its contribution
 * carries platform, handle, originating feed record, source URL, observed time,
 * evidence and tenant.
 *
 * --- NEW PROSPECTS (owner decision 3) --------------------------------------
 * Community / listening / scheduled-detection events may create a prospect
 * (discovery sources). An engagement event may only ENRICH an existing one,
 * unless it passes the explicit rule in bridge/engagementQualification.ts.
 *
 * ─── NEVER THROWS ─────────────────────────────────────────────────────────
 * All entry points return a `BridgeOutcome` and never throw; outcomes are
 * counted and failures logged (bridge/observability.ts).
 */
import { isSourceCategory, type SourceCategory } from '../../../lib/prospectProvenance/contract';
import { bridgeSourceEvent } from './bridge/bridgeCore';
import { defaultBridgeDeps } from './bridge/defaultDeps';
import { observeBridgeOutcome } from './bridge/observability';
import { qualifyEngagementForNewProspect, type EngagementQualification } from './bridge/engagementQualification';
import type { BridgeDeps, BridgeKind, BridgeOutcome, BridgeSourceEvent, GateDecisionLike, ObservedAtBasis } from './bridge/types';

export type { BridgeOutcome } from './bridge/types';
export { qualifyEngagementForNewProspect, ENGAGEMENT_NEW_PROSPECT_MIN_INTENT, ENGAGEMENT_QUALIFICATION_RULE } from './bridge/engagementQualification';

/** Discovery sources (community / listening) may create a prospect; the rule name is recorded as evidence. */
const DISCOVERY_NEW_PROSPECT = { allowed: true, rule: 'discovery_source', reason: 'discovery_source' } as const;
export { getBridgeCounters, resetBridgeCounters } from './bridge/observability';

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (v: unknown): string | null => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};
const lower = (v: unknown): string | null => str(v)?.toLowerCase() ?? null;
const looksLikeUrl = (v: string | null): v is string => !!v && /^https?:\/\//i.test(v);

/** First parseable timestamp wins; the basis records which one. */
function pickObservedAt(candidates: Array<[ObservedAtBasis, unknown]>): { observedAt: string; basis: ObservedAtBasis } | null {
  for (const [basis, value] of candidates) {
    const at = iso(value);
    if (at) return { observedAt: at, basis };
  }
  return null;
}

/* ── Category rules (explicit, from data) ─────────────────────────────────── */

/**
 * A feed item produced by a listening execution is SOCIAL LISTENING. Only a feed
 * item with no execution in either its column or its explanation trace is
 * classified `community`. Not inferred from the display source (`community` in
 * Lead Intelligence), per the provenance contract.
 */
export function categoryForFeedItem(feed: Row): SourceCategory {
  const trace = obj(obj(feed.explanation).source_trace);
  const executionId = str(feed.listening_execution_id) ?? str(trace.listening_execution_id);
  return executionId ? 'social_listening' : 'community';
}

/** `lead_signals.source_type` → category. The CHECK constraint allows exactly these two. */
export function categoryForLeadSignal(signal: Row): SourceCategory | null {
  const t = lower(signal.source_type);
  if (t === 'engagement') return 'engagement';
  if (t === 'listening') return 'social_listening';
  return null;
}

/* ── Platform user id (the nesting fix) ───────────────────────────────────── */

/**
 * The feed stores the author id NESTED (`author_metadata.platform_user_id`,
 * opportunityFeedService insert). Readers that look at the top level (the Lead
 * Intelligence community adapter) see nothing. This is the one reader rule.
 */
export function feedAuthorPlatformUserId(feed: Row): string | null {
  return str(obj(feed.author_metadata).platform_user_id) ?? str(feed.platform_user_id);
}

/**
 * The feed row as handed to `adoptLead('community', …)`, with the author id also
 * lifted to the top level so the existing adapter resolves the person. Additive:
 * every original key is kept; nothing is overwritten.
 */
export function withCommunityAuthorIdentity(feed: Row): Row {
  const platformUserId = feedAuthorPlatformUserId(feed);
  if (!platformUserId || str(feed.platform_user_id)) return feed;
  return { ...feed, platform_user_id: platformUserId };
}

/* ── Builders (pure) ──────────────────────────────────────────────────────── */

export type BuildResult = { ok: true; event: BridgeSourceEvent } | { ok: false; reason: string };

/**
 * Community / listening feed item (+ its lead_signals row when available).
 *
 *   key           community:<feed.id>
 *   observedAt    lead_signals.metadata.posted_at
 *                 → explanation.source_trace.detected_at → lead_signals.detected_at → feed.created_at
 *   sourceUrl     lead_signals.metadata.content_url → feed.source_context.content_url
 *   run id        feed.listening_execution_id → explanation.source_trace.listening_execution_id
 */
export function buildCommunityFeedEvent(feed: Row, signal: Row | null): BuildResult {
  const org = str(feed.organization_id);
  const id = str(feed.id);
  if (!org || !id) return { ok: false, reason: 'feed_item_incomplete' };
  if (signal && str(signal.organization_id) !== org) return { ok: false, reason: 'signal_tenant_mismatch' };

  const sig = signal ?? {};
  const sigMeta = obj(sig.metadata);
  const explanation = obj(feed.explanation);
  const trace = obj(explanation.source_trace);
  const cluster = obj(explanation.cluster);
  const moderation = obj(explanation.moderation);
  const author = obj(feed.author_metadata);
  const sourceContext = obj(feed.source_context);

  const observed = pickObservedAt([
    ['posted_at', sigMeta.posted_at],
    ['source_trace_detected_at', trace.detected_at],
    ['signal_detected_at', sig.detected_at],
    ['feed_created_at', feed.created_at],
  ]);
  if (!observed) return { ok: false, reason: 'no_observed_time' };

  const executionId = str(feed.listening_execution_id) ?? str(trace.listening_execution_id);
  const contentUrl = str(sigMeta.content_url) ?? str(sourceContext.content_url);
  const leadSignalId = str(feed.signal_id) ?? str(sig.id);

  return {
    ok: true,
    event: {
      kind: 'community_feed',
      organizationId: org,
      sourceCategory: categoryForFeedItem(feed),
      provider: 'community',
      sourceRecordKey: id,
      prospectSource: 'community',
      identity: {
        platform: str(feed.platform),
        platformUserId: feedAuthorPlatformUserId(feed) ?? str(sig.platform_user_id),
        authorHandle: str(author.author_handle) ?? str(sigMeta.author_handle),
      },
      newProspect: { ...DISCOVERY_NEW_PROSPECT },
      platform: lower(feed.platform),
      sourceUrl: contentUrl,
      observedAt: observed.observedAt,
      observedAtBasis: observed.basis,
      ingestionRunId: executionId,
      refs: {
        opportunityFeedItemId: id,
        leadSignalId,
        contactId: str(sig.contact_id),
        engagementMessageId: null,
      },
      evidence: {
        opportunityFeedItemId: id,
        leadSignalId,
        signalSourceId: str(sig.source_id),
        listeningExecutionId: executionId,
        sourceIdentifier: str(feed.source_identifier) ?? str(trace.source_identifier),
        clusterId: str(feed.cluster_id) ?? str(cluster.cluster_id),
        clusterKey: str(cluster.cluster_key),
        opportunityType: str(feed.opportunity_type),
        detectedReason: str(feed.detected_reason),
        matchedKeywords: Array.isArray(feed.matched_keywords) ? feed.matched_keywords : [],
        signalExcerpt: str(feed.signal_excerpt),
        moderationOutcome: str(moderation.outcome),
        isComment: typeof sigMeta.is_comment === 'boolean' ? sigMeta.is_comment : null,
        scores: {
          scale: 'unit',
          opportunity: num(feed.opportunity_score),
          confidence: num(feed.confidence_score),
          urgency: num(feed.urgency_score),
        },
      },
      sourceMetadata: {
        authorHandle: str(author.author_handle) ?? str(sigMeta.author_handle),
        profileName: str(author.profile_name),
        profileTitle: str(author.profile_title),
        profileCompany: str(author.profile_company),
        postedAt: iso(sigMeta.posted_at),
        detectedAt: iso(trace.detected_at) ?? iso(sig.detected_at),
      },
      rawPayload: {
        opportunity_feed_item: feed,
        lead_signal: signal ? {
          id: sig.id, source_type: sig.source_type, source_id: sig.source_id, platform: sig.platform,
          platform_user_id: sig.platform_user_id ?? null,
          detected_at: sig.detected_at, contact_id: sig.contact_id, metadata: sigMeta,
        } : null,
      },
    },
  };
}

/**
 * Engagement lead signal (`lead_signals.source_type='engagement'`). Both writers
 * (leadDetectionService, communitySignalService) set `source_id` to
 * `engagement_messages.id`, so it is the message reference.
 *
 *   key           engagement:<engagement_messages.id>
 *   observedAt    metadata.message_created_at (platform time) → detected_at
 *   sourceUrl     metadata.content_url (none today: messages carry no URL on the signal)
 *   run id        none (engagement ingestion has no run entity)
 */
export function buildEngagementSignalEvent(signal: Row, qualification: EngagementQualification = qualifyEngagementForNewProspect(signal)): BuildResult {
  const org = str(signal.organization_id);
  const id = str(signal.id);
  const messageId = str(signal.source_id);
  if (!org || !id || !messageId) return { ok: false, reason: 'signal_incomplete' };
  if (categoryForLeadSignal(signal) !== 'engagement') return { ok: false, reason: 'not_engagement_signal' };
  const meta = obj(signal.metadata);
  const observed = pickObservedAt([
    ['message_created_at', meta.message_created_at],
    ['signal_detected_at', signal.detected_at],
  ]);
  if (!observed) return { ok: false, reason: 'no_observed_time' };
  const platform = str(signal.platform);
  return {
    ok: true,
    event: {
      kind: 'engagement_signal',
      organizationId: org,
      sourceCategory: 'engagement',
      provider: 'engagement',
      sourceRecordKey: messageId,
      prospectSource: 'engagement',
      identity: { platform, platformUserId: str(signal.platform_user_id), authorHandle: str(meta.author_handle) },
      // Engagement may ENRICH any existing prospect; it CREATES one only when qualified.
      newProspect: { allowed: qualification.qualified, rule: qualification.rule, reason: qualification.reason },
      platform: lower(platform),
      sourceUrl: str(meta.content_url),
      observedAt: observed.observedAt,
      observedAtBasis: observed.basis,
      ingestionRunId: null,
      refs: { leadSignalId: id, engagementMessageId: messageId, contactId: str(signal.contact_id), opportunityFeedItemId: null },
      evidence: {
        leadSignalId: id,
        engagementMessageId: messageId,
        threadId: str(signal.thread_id),
        engagementAuthorId: str(meta.author_id),
        leadIntent: str(meta.lead_intent),
        // Campaign/content attribution (previously dropped at engagementNormalizationService).
        scheduledPostId: str(meta.scheduled_post_id),
        scores: { scale: 'unit', intent: num(signal.intent_score), total: num(signal.total_score), confidence: num(signal.confidence_score) },
      },
      sourceMetadata: { migrationSource: str(signal.migration_source), contactKey: str(signal.contact_key) },
      rawPayload: {
        lead_signal: {
          id, source_type: signal.source_type, source_id: messageId, thread_id: signal.thread_id,
          platform: signal.platform, platform_user_id: signal.platform_user_id ?? null,
          detected_at: signal.detected_at, contact_id: signal.contact_id, metadata: meta,
        },
      },
    },
  };
}

/**
 * Scheduled lead detection (`leadJobProcessor`, Active Leads Engine v1). Writes
 * only `lead_signals` with `source_type='listening'`, so the category is
 * SOCIAL LISTENING; an engagement-typed signal is routed to the engagement
 * builder instead (explicit, never folded).
 *
 *   key           lead_detection:<lead_signals.id>
 *   observedAt    metadata.posted_at → detected_at (= posted_at ?? job time)
 *   sourceUrl     metadata.source_url → source_id when it is a URL
 *   run id        metadata.job_id (lead_jobs_v1.id)
 */
export function buildScheduledDetectionEvent(signal: Row): BuildResult {
  const category = categoryForLeadSignal(signal);
  if (category === 'engagement') return buildEngagementSignalEvent(signal);
  if (category !== 'social_listening') return { ok: false, reason: 'unknown_signal_source_type' };
  const org = str(signal.organization_id);
  const id = str(signal.id);
  if (!org || !id) return { ok: false, reason: 'signal_incomplete' };
  const meta = obj(signal.metadata);
  const observed = pickObservedAt([
    ['posted_at', meta.posted_at],
    ['signal_detected_at', signal.detected_at],
  ]);
  if (!observed) return { ok: false, reason: 'no_observed_time' };
  const sourceId = str(signal.source_id);
  const platform = str(signal.platform);
  const url = str(meta.source_url) ?? (looksLikeUrl(sourceId) ? sourceId : null);
  return {
    ok: true,
    event: {
      kind: 'scheduled_detection',
      organizationId: org,
      sourceCategory: 'social_listening',
      provider: 'lead_detection',
      sourceRecordKey: id,
      prospectSource: 'listening',
      identity: { platform, platformUserId: str(signal.platform_user_id), authorHandle: str(meta.author_handle) },
      newProspect: { ...DISCOVERY_NEW_PROSPECT },
      platform: lower(platform),
      sourceUrl: url,
      observedAt: observed.observedAt,
      observedAtBasis: observed.basis,
      ingestionRunId: str(meta.job_id),
      refs: { leadSignalId: id, contactId: str(signal.contact_id), opportunityFeedItemId: null, engagementMessageId: null },
      evidence: {
        leadSignalId: id,
        signalSourceId: sourceId,
        leadJobId: str(meta.job_id),
        mode: str(meta.mode),
        signalType: str(meta.signal_type),
        problemDomain: str(meta.problem_domain),
        region: str(meta.region),
        contentHash: str(meta.content_hash),
        dedupeHash: str(meta.dedupe_hash),
        riskFlag: typeof meta.risk_flag === 'boolean' ? meta.risk_flag : null,
        scores: { scale: 'unit', total: num(signal.total_score), confidence: num(signal.confidence_score) },
      },
      sourceMetadata: { migrationSource: str(signal.migration_source), language: str(meta.language) },
      rawPayload: {
        lead_signal: {
          id, source_type: signal.source_type, source_id: sourceId, platform: signal.platform,
          platform_user_id: signal.platform_user_id ?? null,
          detected_at: signal.detected_at, contact_id: signal.contact_id, metadata: meta,
        },
      },
    },
  };
}

/* ── Public entry points (gated, never throw) ─────────────────────────────── */

function rejected(kind: BridgeKind, organizationId: string | null, reason: string, status: 'skipped' | 'failed' = 'skipped'): BridgeOutcome {
  return observeBridgeOutcome({ kind, status, reason, organizationId, externalRef: null });
}

async function gateFor(kind: BridgeKind, organizationId: string | null, deps: BridgeDeps) {
  if (!organizationId) return { outcome: rejected(kind, null, 'organization_required') } as const;
  try {
    const decision = await deps.gate(organizationId);
    if (!decision.allowed) return { outcome: rejected(kind, organizationId, `gate_closed:${decision.reason}`) } as const;
    return { decision } as const;
  } catch (e) {
    // resolveLeadIngestionGate already fails closed; this guards an injected gate.
    return { outcome: rejected(kind, organizationId, `gate_closed:gate_error:${(e as Error).message}`) } as const;
  }
}

/**
 * Bridge one opportunity feed item. Reads its `lead_signals` row (tenant-scoped)
 * for URL, post time and contact; a missing signal row degrades to feed-only
 * evidence rather than dropping the contribution.
 */
export async function bridgeCommunityFeedItem(feed: Row, deps: BridgeDeps = defaultBridgeDeps()): Promise<BridgeOutcome> {
  const kind: BridgeKind = 'community_feed';
  try {
    const org = str(feed?.organization_id);
    const g = await gateFor(kind, org, deps);
    if ('outcome' in g) return g.outcome;
    const signalId = str(feed.signal_id);
    let signal: Row | null = null;
    if (signalId) {
      try {
        signal = await deps.loadLeadSignal(org as string, signalId);
      } catch (e) {
        return rejected(kind, org, `signal_load_failed:${(e as Error).message}`, 'failed');
      }
    }
    const built = buildCommunityFeedEvent(feed, signal);
    if (built.ok === false) return rejected(kind, org, built.reason, 'failed');
    return await bridgeSourceEvent(built.event, deps, { gateDecision: g.decision });
  } catch (e) {
    return rejected(kind, str(feed?.organization_id), `unexpected:${(e as Error)?.message}`, 'failed');
  }
}

/** Bridge one engagement lead signal row (as written by `writeLeadSignal`, with its id). */
export async function bridgeEngagementSignal(
  signal: Row,
  deps: BridgeDeps = defaultBridgeDeps(),
  options: { gateDecision?: GateDecisionLike } = {},
): Promise<BridgeOutcome> {
  const kind: BridgeKind = 'engagement_signal';
  try {
    const org = str(signal?.organization_id);
    const g = options.gateDecision
      ? (options.gateDecision.allowed
        ? { decision: options.gateDecision }
        : { outcome: rejected(kind, org, `gate_closed:${options.gateDecision.reason}`) })
      : await gateFor(kind, org, deps);
    if ('outcome' in g) return g.outcome;
    const built = buildEngagementSignalEvent(signal);
    if (built.ok === false) return rejected(kind, org, built.reason, 'failed');
    return await bridgeSourceEvent(built.event, deps, { gateDecision: g.decision });
  } catch (e) {
    return rejected(kind, str(signal?.organization_id), `unexpected:${(e as Error)?.message}`, 'failed');
  }
}

/** What the engagement writer should do with one engagement signal. */
export interface EngagementAdmission {
  /** The PI ingestion gate for the signal's tenant (kill switch AND tenant flag). */
  gate: GateDecisionLike;
  /** The bridge outcome (always present; `skipped: gate_closed` when the gate is closed). */
  bridge: BridgeOutcome;
  /** The explicit new-prospect qualification of this signal. */
  qualification: EngagementQualification;
  /**
   * May the signal be ADOPTED into Lead Intelligence (`adoptLead('engagement')`)?
   * Only when the gate is open AND it either enriched an existing prospect /
   * created a qualified one (`bridged`) or itself qualifies. An unqualified
   * engagement with no prospect to enrich creates NOTHING, anywhere.
   */
  adopt: boolean;
  adoptReason: 'gate_closed' | 'bridged' | 'qualified' | 'not_qualified_no_existing_prospect';
}

/**
 * Engagement admission (owner decision 3): ONE gate evaluation (the existing
 * `resolveLeadIngestionGate` through the bridge's deps seam) governs BOTH the
 * canonical bridge and Lead Intelligence adoption of this engagement signal.
 * Never throws.
 */
export async function admitEngagementSignal(signal: Row, deps: BridgeDeps = defaultBridgeDeps()): Promise<EngagementAdmission> {
  const qualification = qualifyEngagementForNewProspect(signal ?? {});
  const org = str(signal?.organization_id);
  let gate: GateDecisionLike;
  if (!org) {
    gate = { allowed: false, reason: 'organization_required' };
  } else {
    try {
      gate = await deps.gate(org);
    } catch (e) {
      gate = { allowed: false, reason: `gate_error:${(e as Error)?.message}` };
    }
  }
  const bridge = await bridgeEngagementSignal(signal, deps, { gateDecision: gate });
  if (!gate.allowed) return { gate, bridge, qualification, adopt: false, adoptReason: 'gate_closed' };
  if (bridge.status === 'bridged') return { gate, bridge, qualification, adopt: true, adoptReason: 'bridged' };
  if (qualification.qualified) return { gate, bridge, qualification, adopt: true, adoptReason: 'qualified' };
  return { gate, bridge, qualification, adopt: false, adoptReason: 'not_qualified_no_existing_prospect' };
}

/**
 * Bridge one signal produced by scheduled lead detection. Loads the persisted
 * row (tenant-scoped) so the contribution carries exactly what was stored,
 * including the contact the writer resolved.
 */
export async function bridgeScheduledDetectionSignal(
  organizationId: string,
  leadSignalId: string,
  deps: BridgeDeps = defaultBridgeDeps(),
): Promise<BridgeOutcome> {
  const kind: BridgeKind = 'scheduled_detection';
  try {
    const org = str(organizationId);
    const g = await gateFor(kind, org, deps);
    if ('outcome' in g) return g.outcome;
    const id = str(leadSignalId);
    if (!id) return rejected(kind, org, 'lead_signal_id_required', 'failed');
    let signal: Row | null;
    try {
      signal = await deps.loadLeadSignal(org as string, id);
    } catch (e) {
      return rejected(kind, org, `signal_load_failed:${(e as Error).message}`, 'failed');
    }
    if (!signal) return rejected(kind, org, 'signal_not_found', 'failed');
    const built = buildScheduledDetectionEvent(signal);
    if (built.ok === false) return rejected(kind, org, built.reason, 'failed');
    return await bridgeSourceEvent(built.event, deps, { gateDecision: g.decision });
  } catch (e) {
    return rejected(kind, str(organizationId), `unexpected:${(e as Error)?.message}`, 'failed');
  }
}

/** Exposed for tests/report: every category the bridge can emit is in the contract vocabulary. */
export const BRIDGE_CATEGORIES: readonly SourceCategory[] = (['community', 'social_listening', 'engagement'] as const)
  .filter((c) => isSourceCategory(c));
