/**
 * ICP evidence — read-only access to Prospect Intelligence's OWN records of who
 * has been evaluated against which ICP version.
 *
 * Prospect Intelligence is a separate workstream and owns ICPs (`prospect_icps`,
 * `prospect_icp_versions`, D1) and score evaluations (`prospect_score_evaluations`).
 * Orchestration only READS them here — it scores nothing, qualifies nothing and
 * keeps no copy. "Evaluated under ICP v" means: PI recorded an evaluation of that
 * prospect citing that exact ICP id and version. An abstention (no ratified ICP)
 * carries no ICP and therefore never counts.
 *
 * Tenant-first on every read.
 */

import { ownedDbTable } from '../../db/writeOwner';

export interface IcpEvaluation {
  readonly evaluationId: string;
  readonly prospectId: string;
  readonly scoreIcp: number | null;
  readonly evaluatedAt: string;
}

export interface IcpEvidencePort {
  /** The status of one ICP version in this tenant, or null when it does not exist. */
  versionStatus(organizationId: string, icpId: string, version: number): Promise<string | null>;
  /** The currently ratified version of an ICP, or null when none is ratified. */
  ratifiedVersion(organizationId: string, icpId: string): Promise<number | null>;
  /** The latest evaluation per prospect under exactly (icpId, version). */
  evaluationsUnder(organizationId: string, icpId: string, version: number, prospectIds?: readonly string[]): Promise<Map<string, IcpEvaluation>>;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const PAGE = 1000;

export const durableIcpEvidence: IcpEvidencePort = {
  async versionStatus(organizationId, icpId, version) {
    const res = await ownedDbTable('prospect_icp_versions')
      .select('status')
      .eq('organization_id', organizationId)
      .eq('icp_id', icpId)
      .eq('version', version)
      .maybeSingle();
    if (res.error) throw Object.assign(new Error('ICP version unreadable'), { code: 'icp_unreadable' });
    return res.data ? String((res.data as Record<string, unknown>).status) : null;
  },

  async ratifiedVersion(organizationId, icpId) {
    const res = await ownedDbTable('prospect_icp_versions')
      .select('version')
      .eq('organization_id', organizationId)
      .eq('icp_id', icpId)
      .eq('status', 'ratified')
      .maybeSingle();
    if (res.error) throw Object.assign(new Error('ICP version unreadable'), { code: 'icp_unreadable' });
    return res.data ? num((res.data as Record<string, unknown>).version) : null;
  },

  async evaluationsUnder(organizationId, icpId, version, prospectIds) {
    const out = new Map<string, IcpEvaluation>();
    let query = ownedDbTable('prospect_score_evaluations')
      .select('id, prospect_id, score_icp, evaluated_at')
      .eq('organization_id', organizationId)
      .eq('icp_id', icpId)
      .eq('icp_version', version);
    if (prospectIds && prospectIds.length > 0) query = query.in('prospect_id', [...prospectIds]);
    const res = await query.order('evaluated_at', { ascending: false }).limit(PAGE * 10);
    if (res.error) throw Object.assign(new Error('score evaluations unreadable'), { code: 'evidence_unreadable' });
    for (const r of (res.data ?? []) as Array<Record<string, unknown>>) {
      const prospectId = String(r.prospect_id);
      if (out.has(prospectId)) continue;      // newest first: the first row is the latest
      out.set(prospectId, { evaluationId: String(r.id), prospectId, scoreIcp: num(r.score_icp), evaluatedAt: String(r.evaluated_at) });
    }
    return out;
  },
};
