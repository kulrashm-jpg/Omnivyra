/**
 * Prospect ↔ opportunity contract (Agent 5, provenance programme).
 *
 * Design doc: docs/architecture/PROSPECT-OPPORTUNITY-LIFECYCLE.md.
 *
 * PURE. No database access, no clock, no randomness. Only TYPE imports from the
 * backend, so this module has no runtime dependency on a database client.
 *
 * What it does: given rows the existing tables already hold, it builds the
 * per-prospect, per-opportunity view the owner asked for:
 *   - one canonical prospect (`canonical_leads`),
 *   - its source attribution (`prospect_source_contributions`), held ONCE at
 *     prospect level and shared by every opportunity,
 *   - its opportunities, each with its own type, owner, status, status-change
 *     audit and disposition.
 *
 * What it does NOT do:
 *   - It does not invent a status vocabulary. `status` is the existing
 *     `opportunity_lifecycle_states.state` vocabulary (LIFECYCLE_STATES), read
 *     through the existing `readCurrentLifecycleState` result type.
 *   - It does not roll several opportunities of one type into one status. That
 *     rule (the 20260817 `active_leads` roll-up) is an open owner decision, so
 *     `byType` only groups ids.
 *   - It does not attach an opportunity to a prospect by guesswork. An
 *     opportunity belongs to a prospect only when one of the prospect's own
 *     contributions cites it (`opportunity_feed_item_id`).
 *   - It does not model snooze. No existing column carries a snooze deadline,
 *     so `snoozedUntil` is always null and the gap is declared in
 *     ROLLUP_FIELD_MAP. `revisit_later` is surfaced as a disposition and is NOT
 *     reinterpreted as a snooze.
 *
 * Grain today: an opportunity is an `opportunity_feed_items` row (one classified
 * community signal). That grain is retention-deleted and exists only for
 * community/listening signals; the durable per-(prospect, type) entity is a gap
 * with a DDL proposal in the design doc.
 */

import type { LifecycleState } from '../../backend/types/opportunityLifecycle';
import type { OpportunityType } from '../../backend/types/opportunityFeed';
import type {
  Disposition,
  OpportunityAssignment,
  OpportunityDisposition,
} from '../../backend/types/opportunityWorkflow';
import type {
  LifecycleReadResult,
  LifecycleUnreadableReason,
} from '../../backend/services/opportunityLifecycleService';
import type { ProvenanceContribution } from '../prospectProvenance/contract';

// ── Field map: the never-applied 20260817 `active_leads` roll-up → existing carriers ──

export type RollupFieldStatus =
  /** An existing column carries the same meaning at the opportunity grain. */
  | 'mapped'
  /** An existing column carries it, but with a different vocabulary — owner decision. */
  | 'mapped_different_vocabulary'
  /** No existing column carries it. */
  | 'gap';

export interface RollupFieldMapping {
  readonly carrier: string | null;
  readonly status: RollupFieldStatus;
  readonly note: string;
}

/**
 * Every user-owned / identity field of `supabase/migrations/20260817_active_leads_object_model.sql`
 * (`active_leads`) mapped to where the existing schema keeps it. A test asserts
 * this covers all the fields the design brief names.
 */
export const ROLLUP_FIELD_MAP: Readonly<Record<string, RollupFieldMapping>> = {
  organization_id: {
    carrier: 'canonical_leads.company_id (= companies.id); opportunity_feed_items.organization_id',
    status: 'mapped',
    note: 'Same identity (companies.id) on every table.',
  },
  contact_id: {
    carrier: 'canonical_leads.unified_person_id; contacts.unified_person_id; lead_signals.contact_id',
    status: 'mapped_different_vocabulary',
    note: 'Different grain: the design keyed a per-platform contact; the canonical anchor is the cross-platform person (N contacts → 1 person).',
  },
  opportunity_type: {
    carrier: 'opportunity_feed_items.opportunity_type',
    status: 'mapped',
    note: 'Same 8-value CHECK as the design. Signal grain, not a prospect-level roll-up.',
  },
  status: {
    carrier: 'opportunity_lifecycle_states.state (latest row per opportunity_feed_item_id)',
    status: 'mapped_different_vocabulary',
    note: 'Existing 9-state vocabulary differs from the design 8-state one; no 1:1 mapping (owner decision D-1).',
  },
  owner_user_id: {
    carrier: "opportunity_assignments.assigned_to_user_id WHERE role = 'owner' AND unassigned_at IS NULL",
    status: 'mapped',
    note: 'One active owner is NOT enforced by the database (UNIQUE with nullable unassigned_at); the view reports contradictions.',
  },
  snoozed_until: {
    carrier: null,
    status: 'gap',
    note: "No column carries a snooze deadline. opportunity_dispositions 'revisit_later' has no timestamp.",
  },
  status_changed_at: {
    carrier: 'opportunity_lifecycle_states.transitioned_at (latest row)',
    status: 'mapped',
    note: 'Append-only history is stronger than a last-changed scalar.',
  },
  status_changed_by: {
    carrier: 'opportunity_lifecycle_states.actor_user_id (latest row)',
    status: 'mapped',
    note: 'NULL for system transitions.',
  },
};

// ── Inputs (rows already loaded, tenant-filtered by the caller) ─────────────

/** The `opportunity_feed_items` columns the view needs. */
export interface FeedItemOpportunityRow {
  id: string;
  organizationId: string;
  opportunityType: OpportunityType;
  platform: string;
  createdAt: string;
}

/** A `prospect_source_contributions` row as the unified reader exposes it, with its keys. */
export interface ProspectContributionRow extends ProvenanceContribution {
  organizationId: string;
  canonicalLeadId: string;
}

export interface ProspectOpportunityInputs {
  organizationId: string;
  /** `canonical_leads.id`. */
  prospectId: string;
  contributions: readonly ProspectContributionRow[];
  feedItems: readonly FeedItemOpportunityRow[];
  /** Keyed by `opportunity_feed_items.id`; the result of the existing `readCurrentLifecycleState`. */
  lifecycle: Readonly<Record<string, LifecycleReadResult>>;
  assignments: readonly OpportunityAssignment[];
  dispositions: readonly OpportunityDisposition[];
}

// ── Output ─────────────────────────────────────────────────────────────────

export type OpportunityStatus =
  | {
      kind: 'present';
      state: LifecycleState;
      isInitial: boolean;
      /** 20260817 `status_changed_at`. */
      changedAt: string;
      /** 20260817 `status_changed_by`. NULL for a system transition. */
      changedBy: string | null;
    }
  /** No lifecycle history. Never defaulted to `detected` (FR-A39). */
  | { kind: 'missing' }
  | { kind: 'unreadable'; reason: LifecycleUnreadableReason | 'cross_tenant' | 'subject_mismatch'; detail: string };

export type OpportunityOwner =
  | { kind: 'assigned'; userId: string; assignedAt: string; assignedBy: string | null }
  | { kind: 'unassigned' }
  /** More than one distinct active owner. The database does not prevent it; we do not pick one. */
  | { kind: 'contradictory'; userIds: string[] };

export interface ProspectOpportunityView {
  opportunityRef: { table: 'opportunity_feed_items'; id: string };
  organizationId: string;
  prospectId: string;
  opportunityType: OpportunityType;
  platform: string;
  status: OpportunityStatus;
  owner: OpportunityOwner;
  /** Always null: no existing carrier (ROLLUP_FIELD_MAP.snoozed_until is a gap). */
  snoozedUntil: null;
  latestDisposition: { disposition: Disposition; at: string; by: string | null; reason: string | null } | null;
  /** Ids of the prospect's contributions that cite THIS opportunity's signal. */
  citingContributionIds: string[];
}

export type ProspectOpportunityAnomaly =
  | { kind: 'cross_tenant_row'; table: string; id: string }
  | { kind: 'foreign_prospect_contribution'; id: string }
  | { kind: 'multiple_originating'; ids: string[] }
  /** A feed item was supplied that none of this prospect's contributions cites. Excluded. */
  | { kind: 'feed_item_not_cited'; id: string }
  /** A contribution cites a feed item that was not supplied (e.g. retention-deleted). */
  | { kind: 'cited_feed_item_absent'; contributionId: string; opportunityFeedItemId: string };

export interface ProspectOpportunitiesResult {
  organizationId: string;
  prospectId: string;
  /** Prospect-level and SHARED by every opportunity. Never partitioned per opportunity. */
  sourceAttribution: {
    originating: ProspectContributionRow | null;
    contributing: ProspectContributionRow[];
  };
  opportunities: ProspectOpportunityView[];
  /** Grouping only. No roll-up status per type (owner decision D-3). */
  byType: Partial<Record<OpportunityType, string[]>>;
  anomalies: ProspectOpportunityAnomaly[];
}

// ── The projection ─────────────────────────────────────────────────────────

const byTimeThenId = <T extends { id: string }>(time: (r: T) => string) =>
  (a: T, b: T): number => {
    const t = time(a).localeCompare(time(b));
    return t !== 0 ? t : a.id.localeCompare(b.id);
  };

function statusOf(
  read: LifecycleReadResult | undefined,
  organizationId: string,
  feedItemId: string,
): OpportunityStatus {
  if (!read || read.kind === 'missing') return { kind: 'missing' };
  if (read.kind === 'unreadable') return { kind: 'unreadable', reason: read.reason, detail: read.detail };
  if (read.record.organization_id !== organizationId) {
    return { kind: 'unreadable', reason: 'cross_tenant', detail: `lifecycle_row_org:${read.record.organization_id}` };
  }
  if (read.record.opportunity_feed_item_id !== feedItemId) {
    return { kind: 'unreadable', reason: 'subject_mismatch', detail: `lifecycle_row_item:${read.record.opportunity_feed_item_id}` };
  }
  return {
    kind: 'present',
    state: read.state,
    isInitial: read.isInitial,
    changedAt: read.record.transitioned_at,
    changedBy: read.record.actor_user_id,
  };
}

function ownerOf(active: OpportunityAssignment[]): OpportunityOwner {
  if (active.length === 0) return { kind: 'unassigned' };
  const userIds = Array.from(new Set(active.map((a) => a.assigned_to_user_id))).sort();
  if (userIds.length > 1) return { kind: 'contradictory', userIds };
  const latest = [...active].sort(byTimeThenId<OpportunityAssignment>((a) => a.created_at)).pop()!;
  return { kind: 'assigned', userId: latest.assigned_to_user_id, assignedAt: latest.created_at, assignedBy: latest.assigned_by_user_id };
}

/**
 * Build the per-opportunity view of one prospect from existing rows.
 * Deterministic: the same inputs in any order produce the same output.
 */
export function buildProspectOpportunities(input: ProspectOpportunityInputs): ProspectOpportunitiesResult {
  const { organizationId: org, prospectId } = input;
  const anomalies: ProspectOpportunityAnomaly[] = [];

  // 1. Attribution: this tenant's, this prospect's contributions only.
  const contributions: ProspectContributionRow[] = [];
  for (const c of input.contributions) {
    if (c.organizationId !== org) anomalies.push({ kind: 'cross_tenant_row', table: 'prospect_source_contributions', id: c.id });
    else if (c.canonicalLeadId !== prospectId) anomalies.push({ kind: 'foreign_prospect_contribution', id: c.id });
    else contributions.push(c);
  }
  contributions.sort(byTimeThenId<ProspectContributionRow>((c) => c.observedAt));
  const originatingRows = contributions.filter((c) => c.role === 'originating');
  if (originatingRows.length > 1) anomalies.push({ kind: 'multiple_originating', ids: originatingRows.map((c) => c.id) });
  // With more than one originating row we refuse to pick one.
  const originating = originatingRows.length === 1 ? originatingRows[0] : null;
  const contributing = contributions.filter((c) => c !== originating);

  // 2. Which opportunities belong to this prospect: those its contributions cite.
  const citations = new Map<string, string[]>();
  for (const c of contributions) {
    const fid = c.signalRefs.opportunityFeedItemId;
    if (!fid) continue;
    citations.set(fid, [...(citations.get(fid) ?? []), c.id]);
  }

  const items = new Map<string, FeedItemOpportunityRow>();
  for (const f of input.feedItems) {
    if (f.organizationId !== org) anomalies.push({ kind: 'cross_tenant_row', table: 'opportunity_feed_items', id: f.id });
    else if (!citations.has(f.id)) anomalies.push({ kind: 'feed_item_not_cited', id: f.id });
    else items.set(f.id, f);
  }
  for (const [fid, ids] of citations) {
    if (!items.has(fid)) {
      for (const cid of ids) anomalies.push({ kind: 'cited_feed_item_absent', contributionId: cid, opportunityFeedItemId: fid });
    }
  }

  // 3. Workflow rows, tenant-checked (the FKs on these tables are single-column).
  const activeOwners = new Map<string, OpportunityAssignment[]>();
  for (const a of input.assignments) {
    if (a.organization_id !== org) { anomalies.push({ kind: 'cross_tenant_row', table: 'opportunity_assignments', id: a.id }); continue; }
    if (a.role !== 'owner' || a.unassigned_at !== null || !items.has(a.opportunity_feed_item_id)) continue;
    activeOwners.set(a.opportunity_feed_item_id, [...(activeOwners.get(a.opportunity_feed_item_id) ?? []), a]);
  }
  const latestDisposition = new Map<string, OpportunityDisposition>();
  for (const d of [...input.dispositions].sort(byTimeThenId<OpportunityDisposition>((x) => x.created_at))) {
    if (d.organization_id !== org) { anomalies.push({ kind: 'cross_tenant_row', table: 'opportunity_dispositions', id: d.id }); continue; }
    if (items.has(d.opportunity_feed_item_id)) latestDisposition.set(d.opportunity_feed_item_id, d);
  }

  // 4. One view per opportunity, deterministic order: type, then created_at, then id.
  const opportunities: ProspectOpportunityView[] = [...items.values()]
    .sort((a, b) =>
      a.opportunityType.localeCompare(b.opportunityType)
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id))
    .map((f) => {
      const d = latestDisposition.get(f.id);
      return {
        opportunityRef: { table: 'opportunity_feed_items' as const, id: f.id },
        organizationId: org,
        prospectId,
        opportunityType: f.opportunityType,
        platform: f.platform,
        status: statusOf(input.lifecycle[f.id], org, f.id),
        owner: ownerOf(activeOwners.get(f.id) ?? []),
        snoozedUntil: null,
        latestDisposition: d ? { disposition: d.disposition, at: d.created_at, by: d.set_by_user_id, reason: d.reason } : null,
        citingContributionIds: [...(citations.get(f.id) ?? [])].sort(),
      };
    });

  const byType: Partial<Record<OpportunityType, string[]>> = {};
  for (const o of opportunities) (byType[o.opportunityType] ??= []).push(o.opportunityRef.id);

  return { organizationId: org, prospectId, sourceAttribution: { originating, contributing }, opportunities, byType, anomalies };
}
