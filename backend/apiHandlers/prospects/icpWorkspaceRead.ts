/**
 * A2 — the ICP workspace read model.
 *
 * Assembles everything the reviewer needs to answer one question before
 * ratifying: WHAT am I looking at, and what is authoritative right now?
 *
 * ─── IT RESOLVES NO AMBIGUITY IT WAS NOT GIVEN ────────────────────────────
 * A1 recorded a real gap: repeated generation creates several `proposed`
 * versions and the model has no "current proposal" concept. Exactly one version
 * may be `ratified`; any number may be `proposed`. This handler therefore
 * returns every proposal and FLAGS the ambiguity — it does not nominate a
 * winner, because "newest = current" is a rule nobody wrote. Inventing it here
 * would be indistinguishable downstream from a rule the product had decided.
 *
 * ─── STATE IS NEVER COLLAPSED ─────────────────────────────────────────────
 * It reuses the frozen `Section<T>` envelope: `empty` (no ICP, or an ICP with
 * no versions) is not `failed`, and `failed` is not `empty`. A tenant that has
 * never generated an ICP is a legitimate answer, not an error.
 */

import {
  getRatifiedIcp, listIcpVersions, resolveIcpByKey,
  type IcpVersionRecord, type RatifiedIcp,
} from '../../services/prospectIcp';
import type { Section } from './prospectIntelligenceRead';

/** One row of the version ledger, as the reviewer sees it. */
export interface IcpVersionSummary {
  readonly version: number;
  readonly status: IcpVersionRecord['status'];
  readonly createdAt: string;
  readonly ratifiedAt: string | null;
  readonly ratifiedBy: string | null;
  readonly supersededAt: string | null;
  readonly supersededByVersion: number | null;
  /** Non-null only when a model produced it. A human edit carries null. */
  readonly proposedByModel: string | null;
  readonly criteriaCount: number;
  readonly targetCount: number;
}

export interface IcpWorkspace {
  readonly icpKey: string;
  readonly icpId: string | null;
  /** The authoritative ICP, or null when nothing has been ratified yet. */
  readonly ratified: IcpVersionRecord | null;
  /** Every `draft`/`proposed` version, newest first. Never pre-selected. */
  readonly proposals: readonly IcpVersionRecord[];
  /** Full ledger, newest first, including superseded versions. */
  readonly history: readonly IcpVersionSummary[];
  /**
   * True when more than one version is awaiting a decision. The reviewer must
   * choose; the platform has no rule that makes one of them current.
   */
  readonly proposalChoiceRequired: boolean;
}

export interface IcpWorkspacePorts {
  resolveIcpByKey: typeof resolveIcpByKey;
  listIcpVersions: typeof listIcpVersions;
  getRatifiedIcp: typeof getRatifiedIcp;
}

export const defaultIcpWorkspacePorts: IcpWorkspacePorts = {
  resolveIcpByKey, listIcpVersions, getRatifiedIcp,
};

const summarise = (v: IcpVersionRecord): IcpVersionSummary => ({
  version: v.version,
  status: v.status,
  createdAt: v.createdAt,
  ratifiedAt: v.ratifiedAt,
  ratifiedBy: v.ratifiedBy,
  supersededAt: v.supersededAt,
  supersededByVersion: v.supersededByVersion,
  proposedByModel: v.proposedByModel,
  criteriaCount: v.criteria.length,
  targetCount: v.proposal?.targets?.length ?? 0,
});

const section = <T, >(state: Section<T>['state'], reason: string, data: T | null = null): Section<T> =>
  ({ state, reason, data });

/**
 * Read one tenant's ICP workspace.
 *
 * @param organizationId the VERIFIED tenant. Never taken from a request body.
 */
export async function readIcpWorkspace(
  organizationId: string,
  icpKey: string,
  ports: IcpWorkspacePorts = defaultIcpWorkspacePorts,
): Promise<Section<IcpWorkspace>> {
  let icpId: string | null;
  try {
    icpId = await ports.resolveIcpByKey(organizationId, icpKey);
  } catch (e) {
    // The seam could not be reached. That is NOT the same as "no ICP".
    return section<IcpWorkspace>('failed', e instanceof Error ? e.message : String(e));
  }

  if (!icpId) {
    return section<IcpWorkspace>(
      'empty',
      `no ICP named '${icpKey}' exists in this tenant yet`,
      { icpKey, icpId: null, ratified: null, proposals: [], history: [], proposalChoiceRequired: false },
    );
  }

  let versions: IcpVersionRecord[];
  let ratifiedIcp: RatifiedIcp | null = null;
  try {
    versions = await ports.listIcpVersions(organizationId, icpId);
    // Read through the canonical accessor rather than filtering the list: it is
    // the one function that produces a `RatifiedIcp`, and the evaluator accepts
    // nothing else. Filtering here would build a lookalike.
    ratifiedIcp = await ports.getRatifiedIcp(organizationId, icpKey);
  } catch (e) {
    return section<IcpWorkspace>('failed', e instanceof Error ? e.message : String(e));
  }

  if (!versions.length) {
    return section<IcpWorkspace>(
      'empty',
      'this ICP exists but has no versions yet — generate a proposal to begin',
      { icpKey, icpId, ratified: null, proposals: [], history: [], proposalChoiceRequired: false },
    );
  }

  const ratified = versions.find((v) => v.status === 'ratified') ?? null;
  const proposals = versions.filter((v) => v.status === 'proposed' || v.status === 'draft');

  return section<IcpWorkspace>('available', 'ok', {
    icpKey,
    icpId,
    // `ratifiedIcp` proves the canonical accessor agrees; the full record is
    // what the reviewer needs to compare against.
    ratified: ratifiedIcp ? ratified : null,
    proposals,
    history: versions.map(summarise),
    proposalChoiceRequired: proposals.length > 1,
  });
}
