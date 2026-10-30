/**
 * A failed lead-source read stays fail-open but is no longer silent.
 *
 * Origin: production `active_leads` is the legacy table (company_id, no
 * organization_id); the old `activeLeads` reader filtered on organization_id, so
 * the read errored with 42703 on every call and nobody was told
 * (PI-STATE-OF-PROGRAMME DEFECT-009). That reader is now REMOVED (replaced by the
 * canonical provenance path); the fail-open-but-reported contract still governs
 * every remaining source read and is exercised here on `leads` / `canonical_leads`.
 */
type Behaviour = { error?: { code: string; message: string }; throws?: string; data?: unknown[] };
const behaviour: Record<string, Behaviour> = {};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = async () => {
      const b = behaviour[table] ?? {};
      if (b.throws) throw new Error(b.throws);
      return { data: b.error ? null : (b.data ?? []), error: b.error ?? null };
    };
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import {
  defaultLeadSourceReaders,
  resetReadFailureReportsForTests,
} from '../../services/leadIntelligence/leadIntelligenceReadService';

const MISSING_COLUMN = { code: '42703', message: 'column leads.company_id does not exist' };

describe('lead source reads — fail-open, never silent', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    for (const k of Object.keys(behaviour)) delete behaviour[k];
    resetReadFailureReportsForTests();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('the legacy active_leads reader no longer exists (it contributed nothing — 42703)', () => {
    expect(Object.keys(defaultLeadSourceReaders)).not.toContain('activeLeads');
  });

  it('a missing-column error still yields no rows (semantics unchanged)…', async () => {
    behaviour.leads = { error: MISSING_COLUMN };
    await expect(defaultLeadSourceReaders.leads('co1')).resolves.toEqual([]);
  });

  it('…and is reported with the table, the filter column and the error code', async () => {
    behaviour.leads = { error: MISSING_COLUMN };
    await defaultLeadSourceReaders.leads('co1');
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg, code, detail] = warn.mock.calls[0];
    expect(msg).toContain('leads read failed (filter company_id)');
    expect(msg).toContain('contributes no rows');
    expect(code).toBe('42703');
    expect(detail).toBe(MISSING_COLUMN.message);
  });

  it('reports each table + error code once per process, not on every call', async () => {
    behaviour.leads = { error: MISSING_COLUMN };
    for (let i = 0; i < 5; i += 1) await defaultLeadSourceReaders.leads(`co${i}`);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports a different error code on the same table separately', async () => {
    behaviour.leads = { error: MISSING_COLUMN };
    await defaultLeadSourceReaders.leads('co1');
    behaviour.leads = { error: { code: '42P01', message: 'relation "leads" does not exist' } };
    await defaultLeadSourceReaders.leads('co1');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1][1]).toBe('42P01');
  });

  it('a thrown exception is fail-open and reported too', async () => {
    behaviour.leads = { throws: 'socket hang up' };
    await expect(defaultLeadSourceReaders.leads('co1')).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('leads read failed (filter company_id)');
    expect(warn.mock.calls[0][1]).toBe('exception');
  });

  it('a successful read returns its rows and reports nothing', async () => {
    behaviour.canonical_leads = { data: [{ id: 'a' }, { id: 'b' }] };
    await expect(defaultLeadSourceReaders.canonicalLeads('co1')).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(warn).not.toHaveBeenCalled();
  });
});
