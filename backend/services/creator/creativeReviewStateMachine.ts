/**
 * Creative Review State Machine + Human Governance Orchestrator
 * (Phases 1, 2, 9).
 *
 * Authoritative state-transition layer for enterprise asset review.
 * Owns the full lifecycle: draft → generated → qa_review →
 * governance_review → brand_review → legal_review → approved →
 * published → archived (with rejection paths at every gate).
 *
 * NOT a database — in-memory bounded cache (Phase 10 cost ceilings).
 * Restart-safe: review state re-warms from the next render persisting
 * audit metadata on creator_assets.metadata.
 *
 * Deterministic. Every state transition is auditable; every actor's
 * role is permission-checked; deadlock + escalation-loop protection
 * is built in (Phase 9).
 */

import { canPerform, type CreativeAction, type CreativeReviewRole } from './creativeReviewRoles';

/* ── State machine ──────────────────────────────────────────────────── */

export type ReviewState =
  | 'draft'
  | 'generated'
  | 'qa_review'
  | 'governance_review'
  | 'brand_review'
  | 'legal_review'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'archived';

const TRANSITIONS: Record<ReviewState, ReadonlyArray<ReviewState>> = {
  draft:               ['generated', 'archived'],
  generated:           ['qa_review', 'rejected', 'archived'],
  qa_review:           ['governance_review', 'rejected', 'archived'],
  governance_review:   ['brand_review', 'approved', 'rejected', 'archived'],
  brand_review:        ['legal_review', 'approved', 'rejected', 'archived'],
  legal_review:        ['approved', 'rejected', 'archived'],
  approved:            ['published', 'brand_review', 'archived'], // approved can be rolled back to brand_review for re-review
  rejected:            ['draft', 'archived'],
  published:           ['archived'],
  archived:            [], // terminal
};

const ROLE_FOR_TRANSITION: Record<string, CreativeAction> = {
  'draft->generated':                    'submit_for_review',
  'draft->archived':                     'archive',
  'generated->qa_review':                'submit_for_review',
  'generated->rejected':                 'reject',
  'generated->archived':                 'archive',
  'qa_review->governance_review':        'approve_qa',
  'qa_review->rejected':                 'reject',
  'qa_review->archived':                 'archive',
  'governance_review->brand_review':     'approve_governance',
  'governance_review->approved':         'approve_governance',
  'governance_review->rejected':         'reject',
  'governance_review->archived':         'archive',
  'brand_review->legal_review':          'approve_brand',
  'brand_review->approved':              'approve_brand',
  'brand_review->rejected':              'reject',
  'brand_review->archived':              'archive',
  'legal_review->approved':              'approve_legal',
  'legal_review->rejected':              'reject',
  'legal_review->archived':              'archive',
  'approved->published':                 'publish',
  'approved->brand_review':              'request_regeneration',
  'approved->archived':                  'archive',
  'rejected->draft':                     'request_regeneration',
  'rejected->archived':                  'archive',
  'published->archived':                 'archive',
};

/* ── Audit + record types ───────────────────────────────────────────── */

export type TransitionAudit = {
  from: ReviewState | null;
  to: ReviewState;
  actorUserId: string | null;
  actorRole: CreativeReviewRole | null;
  action: CreativeAction;
  reason: string | null;
  comment: string | null;
  occurredAt: string;
  /** Audit-only escalation flag the orchestrator can set when a
   *  reviewer escalates. The escalation pipeline picks this up. */
  escalation?: { level: string; priority: string } | null;
  /** Optional bypass flag — only set when a privileged role used a bypass action. */
  bypassed?: boolean;
};

export type CreativeReviewRecord = {
  assetId: string;
  companyId: string;
  campaignId: string | null;
  currentState: ReviewState;
  history: ReadonlyArray<TransitionAudit>;
  /** Comments thread — separate from transitions so collaborators can
   *  comment WITHOUT advancing state. Phase 4 collaboration surface. */
  comments: ReadonlyArray<ReviewComment>;
  /** Phase 1 — campaign lock. When true, no further transitions are
   *  accepted except by privileged roles. */
  campaignLocked: boolean;
  createdAt: string;
  lastTransitionedAt: string;
  /** Phase 9 stale-state detection — set when the asset has been
   *  sitting in a non-terminal state for longer than the threshold. */
  stale: boolean;
  /** Phase 9 deadlock / override-churn counters. */
  overrideCount: number;
  escalationCount: number;
};

export type ReviewComment = {
  id: string;
  authorUserId: string | null;
  authorRole: CreativeReviewRole | null;
  text: string;
  occurredAt: string;
  /** Optional reference to a specific QA violation / governance violation. */
  pinnedTo?: string | null;
};

/* ── Bounded in-memory store ────────────────────────────────────────── */

const MAX_RECORDS = 5000;
const MAX_HISTORY_PER_RECORD = 60;
const MAX_COMMENTS_PER_RECORD = 80;
const STALE_STATE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_OVERRIDES_PER_ASSET = 4;             // Phase 9 — override-churn protection
const MAX_ESCALATIONS_PER_ASSET = 3;           // Phase 9 — escalation-loop protection
const RECORD_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

type StoreEntry = {
  record: CreativeReviewRecord;
  expiresAt: number;
};

const reviewStore = new Map<string, StoreEntry>();

function pruneIfFull(): void {
  if (reviewStore.size <= MAX_RECORDS) return;
  const firstKey = reviewStore.keys().next().value;
  if (firstKey) reviewStore.delete(firstKey);
}

function recordKey(assetId: string): string {
  return assetId.trim().toLowerCase();
}

/* ── Public API ─────────────────────────────────────────────────────── */

export class ReviewTransitionError extends Error {
  readonly code: 'invalid_state' | 'invalid_actor_role' | 'campaign_locked' | 'override_cap_reached' | 'escalation_cap_reached' | 'asset_not_found';
  constructor(code: ReviewTransitionError['code'], message: string) {
    super(message);
    this.name = 'ReviewTransitionError';
    this.code = code;
  }
}

/**
 * Establish a new review record for a freshly-generated asset. Called
 * from the renderer's audit-write path AFTER the asset's metadata
 * envelope is finalized.
 */
export function establishReviewRecord(input: {
  assetId: string;
  companyId: string;
  campaignId?: string | null;
  initialState?: ReviewState;
  actorUserId?: string | null;
  actorRole?: CreativeReviewRole | null;
}): CreativeReviewRecord {
  const initial: ReviewState = input.initialState ?? 'generated';
  const now = new Date().toISOString();
  const record: CreativeReviewRecord = {
    assetId: input.assetId,
    companyId: input.companyId,
    campaignId: input.campaignId ?? null,
    currentState: initial,
    history: [{
      from: null,
      to: initial,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      action: 'submit_for_review',
      reason: 'auto_established_on_generation',
      comment: null,
      occurredAt: now,
    }],
    comments: [],
    campaignLocked: false,
    createdAt: now,
    lastTransitionedAt: now,
    stale: false,
    overrideCount: 0,
    escalationCount: 0,
  };
  reviewStore.set(recordKey(input.assetId), {
    record,
    expiresAt: Date.now() + RECORD_TTL_MS,
  });
  pruneIfFull();
  return record;
}

export function getReviewRecord(assetId: string): CreativeReviewRecord | null {
  const entry = reviewStore.get(recordKey(assetId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    reviewStore.delete(recordKey(assetId));
    return null;
  }
  // Phase 9 — mark stale if last transition is older than threshold
  // and the state is non-terminal.
  const age = Date.now() - new Date(entry.record.lastTransitionedAt).getTime();
  const isTerminal = entry.record.currentState === 'published' || entry.record.currentState === 'archived';
  if (!isTerminal && age > STALE_STATE_MS && !entry.record.stale) {
    entry.record = { ...entry.record, stale: true };
  }
  return entry.record;
}

export function listReviewRecordsForCompany(companyId: string, limit = 100): ReadonlyArray<CreativeReviewRecord> {
  const cid = companyId.trim().toLowerCase();
  const out: CreativeReviewRecord[] = [];
  for (const entry of reviewStore.values()) {
    if (entry.expiresAt < Date.now()) continue;
    if (entry.record.companyId.toLowerCase() === cid) {
      out.push(entry.record);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Transition an asset to a new review state. Enforces:
 *   - state-machine legality (TRANSITIONS table)
 *   - role permission (canPerform)
 *   - campaign lock (only privileged actions can transition a locked asset)
 *   - override-churn cap (Phase 9)
 *   - audit trail history (bounded to MAX_HISTORY_PER_RECORD)
 */
export function transitionReviewState(input: {
  assetId: string;
  to: ReviewState;
  actorUserId: string;
  actorRole: CreativeReviewRole;
  reason?: string | null;
  comment?: string | null;
  bypass?: boolean;
}): CreativeReviewRecord {
  const key = recordKey(input.assetId);
  const entry = reviewStore.get(key);
  if (!entry) {
    throw new ReviewTransitionError('asset_not_found', `No review record for asset ${input.assetId}`);
  }
  if (entry.expiresAt < Date.now()) {
    reviewStore.delete(key);
    throw new ReviewTransitionError('asset_not_found', `Review record expired for asset ${input.assetId}`);
  }
  const record = entry.record;

  const legal = TRANSITIONS[record.currentState];
  if (!legal.includes(input.to)) {
    throw new ReviewTransitionError('invalid_state', `Illegal transition: ${record.currentState} → ${input.to}`);
  }

  const transitionKey = `${record.currentState}->${input.to}`;
  const action = ROLE_FOR_TRANSITION[transitionKey];
  if (!action) {
    throw new ReviewTransitionError('invalid_state', `No action defined for transition ${transitionKey}`);
  }

  // Bypass actions require explicit bypass permission AND opt-in.
  if (input.bypass) {
    if (!canPerform(input.actorRole, 'bypass_review')) {
      throw new ReviewTransitionError('invalid_actor_role', `Role ${input.actorRole} cannot bypass review`);
    }
  } else if (!canPerform(input.actorRole, action)) {
    throw new ReviewTransitionError('invalid_actor_role', `Role ${input.actorRole} cannot perform ${action}`);
  }

  // Phase 1 — campaign lock enforcement.
  if (record.campaignLocked) {
    const canOverrideLock = canPerform(input.actorRole, 'unfreeze_campaign');
    if (!canOverrideLock) {
      throw new ReviewTransitionError('campaign_locked', `Campaign locked; role ${input.actorRole} cannot transition`);
    }
  }

  // Phase 9 — override-churn cap. Counts transitions that rolled
  // BACKWARDS in the state machine OR re-entered the same state.
  const isOverride = TRANSITIONS[input.to].includes(record.currentState) || input.to === record.currentState;
  const newOverrideCount = isOverride ? record.overrideCount + 1 : record.overrideCount;
  if (isOverride && newOverrideCount > MAX_OVERRIDES_PER_ASSET) {
    throw new ReviewTransitionError('override_cap_reached', `Override cap (${MAX_OVERRIDES_PER_ASSET}) reached for asset ${input.assetId}`);
  }

  const now = new Date().toISOString();
  const auditEntry: TransitionAudit = {
    from: record.currentState,
    to: input.to,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action,
    reason: input.reason ?? null,
    comment: input.comment ?? null,
    occurredAt: now,
    bypassed: input.bypass === true,
  };

  const updated: CreativeReviewRecord = {
    ...record,
    currentState: input.to,
    history: [...record.history, auditEntry].slice(-MAX_HISTORY_PER_RECORD),
    lastTransitionedAt: now,
    stale: false,
    overrideCount: newOverrideCount,
  };
  reviewStore.set(key, { record: updated, expiresAt: Date.now() + RECORD_TTL_MS });
  return updated;
}

/* ── Phase 4 — Comments / collaboration thread ─────────────────────── */

export function addReviewComment(input: {
  assetId: string;
  authorUserId: string;
  authorRole: CreativeReviewRole;
  text: string;
  pinnedTo?: string | null;
}): CreativeReviewRecord {
  const key = recordKey(input.assetId);
  const entry = reviewStore.get(key);
  if (!entry) throw new ReviewTransitionError('asset_not_found', `No review record for asset ${input.assetId}`);
  const text = String(input.text || '').slice(0, 1000).trim();
  if (!text) return entry.record;
  const comment: ReviewComment = {
    id: `cmt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    authorUserId: input.authorUserId,
    authorRole: input.authorRole,
    text,
    occurredAt: new Date().toISOString(),
    pinnedTo: input.pinnedTo ?? null,
  };
  const updated: CreativeReviewRecord = {
    ...entry.record,
    comments: [...entry.record.comments, comment].slice(-MAX_COMMENTS_PER_RECORD),
  };
  reviewStore.set(key, { record: updated, expiresAt: entry.expiresAt });
  return updated;
}

/* ── Phase 1 — Campaign lock primitives ──────────────────────────────── */

export function lockCampaign(assetId: string, actorRole: CreativeReviewRole, reason: string): CreativeReviewRecord {
  if (!canPerform(actorRole, 'campaign_lock')) {
    throw new ReviewTransitionError('invalid_actor_role', `Role ${actorRole} cannot lock campaign`);
  }
  const key = recordKey(assetId);
  const entry = reviewStore.get(key);
  if (!entry) throw new ReviewTransitionError('asset_not_found', `No review record for asset ${assetId}`);
  const updated: CreativeReviewRecord = { ...entry.record, campaignLocked: true };
  reviewStore.set(key, { record: updated, expiresAt: entry.expiresAt });
  return updated;
}

export function unlockCampaign(assetId: string, actorRole: CreativeReviewRole): CreativeReviewRecord {
  if (!canPerform(actorRole, 'unfreeze_campaign')) {
    throw new ReviewTransitionError('invalid_actor_role', `Role ${actorRole} cannot unlock campaign`);
  }
  const key = recordKey(assetId);
  const entry = reviewStore.get(key);
  if (!entry) throw new ReviewTransitionError('asset_not_found', `No review record for asset ${assetId}`);
  const updated: CreativeReviewRecord = { ...entry.record, campaignLocked: false };
  reviewStore.set(key, { record: updated, expiresAt: entry.expiresAt });
  return updated;
}

/* ── Phase 9 — Diagnostics + safeguards ─────────────────────────────── */

export function reviewStoreStats(): {
  size: number;
  maxRecords: number;
  ttlMs: number;
  maxOverridesPerAsset: number;
  maxEscalationsPerAsset: number;
  staleStateThresholdMs: number;
} {
  return {
    size: reviewStore.size,
    maxRecords: MAX_RECORDS,
    ttlMs: RECORD_TTL_MS,
    maxOverridesPerAsset: MAX_OVERRIDES_PER_ASSET,
    maxEscalationsPerAsset: MAX_ESCALATIONS_PER_ASSET,
    staleStateThresholdMs: STALE_STATE_MS,
  };
}

export function clearAllReviewRecords(): void {
  reviewStore.clear();
}

/** Phase 9 — escalation-count increment, used by the escalation pipeline. */
export function incrementEscalationCount(assetId: string): { allowed: boolean; newCount: number; cap: number } {
  const key = recordKey(assetId);
  const entry = reviewStore.get(key);
  if (!entry) return { allowed: false, newCount: 0, cap: MAX_ESCALATIONS_PER_ASSET };
  const newCount = entry.record.escalationCount + 1;
  const allowed = newCount <= MAX_ESCALATIONS_PER_ASSET;
  if (allowed) {
    entry.record = { ...entry.record, escalationCount: newCount };
  }
  return { allowed, newCount, cap: MAX_ESCALATIONS_PER_ASSET };
}
