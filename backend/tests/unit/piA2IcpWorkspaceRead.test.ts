/**
 * A2 — the ICP workspace read model.
 *
 * The persistence layer is doubled, so what is proven here is the HANDLER'S
 * behaviour: which state it reports, and — the decisive one — that it never
 * nominates a "current" proposal, because the data model has no such concept.
 */

import {
  readIcpWorkspace, type IcpWorkspacePorts,
} from '../../apiHandlers/prospects/icpWorkspaceRead';
import type { IcpVersionRecord } from '../../services/prospectIcp';

const ORG = '4bdbec26-4f7e-4e77-a965-d499e1472f5c';
const ICP_ID = '11111111-1111-4111-8111-111111111111';

const version = (over: Partial<IcpVersionRecord> = {}): IcpVersionRecord => ({
  id: `v-${over.version ?? 1}`,
  organizationId: ORG,
  icpId: ICP_ID,
  version: over.version ?? 1,
  status: over.status ?? 'proposed',
  criteria: over.criteria ?? [],
  proposal: over.proposal ?? {},
  proposedByModel: over.proposedByModel ?? 'gpt-4o-mini',
  ratifiedAt: over.ratifiedAt ?? null,
  ratifiedBy: over.ratifiedBy ?? null,
  supersededAt: over.supersededAt ?? null,
  supersededByVersion: over.supersededByVersion ?? null,
  createdAt: over.createdAt ?? '2026-09-05T00:00:00.000Z',
});

const ports = (over: Partial<IcpWorkspacePorts> = {}): IcpWorkspacePorts => ({
  resolveIcpByKey: over.resolveIcpByKey ?? (async () => ICP_ID),
  listIcpVersions: over.listIcpVersions ?? (async () => [version()]),
  getRatifiedIcp: over.getRatifiedIcp ?? (async () => null),
});

describe('A2 read model — Section states are never collapsed', () => {
  it('reports empty, not failed, when the tenant has no ICP', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({ resolveIcpByKey: async () => null }));
    expect(s.state).toBe('empty');
    expect(s.reason).toContain("no ICP named 'first-cut'");
    expect(s.data?.icpId).toBeNull();
  });

  it('reports empty when the ICP exists but has no versions', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({ listIcpVersions: async () => [] }));
    expect(s.state).toBe('empty');
    expect(s.reason).toContain('no versions yet');
    expect(s.data?.icpId).toBe(ICP_ID);
  });

  it('reports failed — NOT empty — when the store cannot be read', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      listIcpVersions: async () => { throw new Error('version list read failed'); },
    }));
    expect(s.state).toBe('failed');
    expect(s.state).not.toBe('empty');
    expect(s.reason).toContain('version list read failed');
    expect(s.data).toBeNull();
  });

  it('reports failed when the ICP lookup itself fails', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      resolveIcpByKey: async () => { throw new Error('lookup down'); },
    }));
    expect(s.state).toBe('failed');
  });
});

describe('A2 read model — it nominates no "current" proposal', () => {
  it('flags the choice when more than one proposal awaits a decision', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      listIcpVersions: async () => [version({ version: 3 }), version({ version: 2 })],
    }));
    expect(s.state).toBe('available');
    expect(s.data?.proposalChoiceRequired).toBe(true);
    expect(s.data?.proposals.map((p) => p.version)).toEqual([3, 2]);
    // No field anywhere names a winner.
    expect(JSON.stringify(s.data)).not.toMatch(/"current"|"isCurrent"|"active"/);
  });

  it('does not flag a choice when exactly one proposal exists', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports());
    expect(s.data?.proposalChoiceRequired).toBe(false);
  });

  it('keeps the ratified version out of the proposal list', async () => {
    const ratified = version({ version: 1, status: 'ratified', ratifiedAt: '2026-09-01T00:00:00.000Z' });
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      listIcpVersions: async () => [version({ version: 2 }), ratified],
      getRatifiedIcp: async () => ({
        organizationId: ORG, icpId: ICP_ID, icpKey: 'first-cut', version: 1,
        criteria: [], ratifiedAt: '2026-09-01T00:00:00.000Z', ratifiedBy: 'user-1',
      }),
    }));
    expect(s.data?.ratified?.version).toBe(1);
    expect(s.data?.proposals.map((p) => p.version)).toEqual([2]);
    expect(s.data?.proposalChoiceRequired).toBe(false);
  });

  it('reports no ratified ICP when the canonical accessor produces none', async () => {
    // A row claiming `ratified` is not enough: `getRatifiedIcp` is the only
    // function that produces a RatifiedIcp, and the evaluator accepts no other.
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      listIcpVersions: async () => [version({ version: 1, status: 'ratified' })],
      getRatifiedIcp: async () => null,
    }));
    expect(s.data?.ratified).toBeNull();
  });
});

describe('A2 read model — history', () => {
  it('summarises every version including superseded ones, newest first', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      listIcpVersions: async () => [
        version({ version: 3 }),
        version({ version: 2, status: 'superseded', supersededAt: '2026-09-04T00:00:00.000Z', supersededByVersion: 3 }),
        version({ version: 1, status: 'superseded' }),
      ],
    }));
    expect(s.data?.history.map((h) => h.version)).toEqual([3, 2, 1]);
    expect(s.data?.history[1].status).toBe('superseded');
    expect(s.data?.history[1].supersededByVersion).toBe(3);
    // Superseded versions are history, never proposals awaiting a decision.
    expect(s.data?.proposals.map((p) => p.version)).toEqual([3]);
  });

  it('counts criteria and targets without interpreting them', async () => {
    const s = await readIcpWorkspace(ORG, 'first-cut', ports({
      listIcpVersions: async () => [version({
        criteria: [{ id: 'a', kind: 'optional', subject: 'account', attribute: 'industry', predicate: { op: 'one_of', values: ['x'] } }],
        proposal: { targets: [{ rank: 1, title: 'T', roleTypes: ['user'], derivation: 'inferred', confidence: 'low', evidenceFields: ['industry'], evidenceQuotes: [], orgAssumption: 'a', factors: { e: 1, p: 0, b: 0, f: 0, r: 0, c: 0.5 } }] },
      })],
    }));
    expect(s.data?.history[0].criteriaCount).toBe(1);
    expect(s.data?.history[0].targetCount).toBe(1);
  });
});

describe('A2 read model — tenant scoping', () => {
  it('threads the caller-verified tenant into every read', async () => {
    const seen: string[] = [];
    await readIcpWorkspace(ORG, 'first-cut', {
      resolveIcpByKey: async (org) => { seen.push(org); return ICP_ID; },
      listIcpVersions: async (org) => { seen.push(org); return [version()]; },
      getRatifiedIcp: async (org) => { seen.push(org); return null; },
    });
    expect(seen).toEqual([ORG, ORG, ORG]);
  });
});
