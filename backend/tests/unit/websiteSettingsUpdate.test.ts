/**
 * Phase 17 Part 1 — editable website settings. updateWebsite patches websites.settings
 * (no new table) tenant-scoped. Recording mock for the websites table.
 */
const state: { row: any; patch: any; filters: Array<[string, unknown]> } = { row: null, patch: null, filters: [] };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const b: Record<string, unknown> = {};
    b.update = (p: any) => { state.patch = p; return b; };
    b.eq = (c: string, v: unknown) => { state.filters.push([c, v]); return b; };
    b.is = () => b;
    b.select = () => b;
    b.single = () => Promise.resolve({ data: state.row, error: null });
    return b;
  },
}));

import { updateWebsite } from '../../services/websiteService';

beforeEach(() => { state.row = { id: 'w1', company_id: 'co1', settings: {} }; state.patch = null; state.filters = []; });

describe('Phase 17 — updateWebsite', () => {
  it('patches settings + name + domainId, tenant-scoped', async () => {
    const out = await updateWebsite('w1', 'co1', { name: 'Acme', settings: { allow_unverified_ingestion: false, allowed_tracking_domains: ['acme.com'] }, domainId: 'dom1' });
    expect(state.patch.name).toBe('Acme');
    expect(state.patch.settings).toEqual({ allow_unverified_ingestion: false, allowed_tracking_domains: ['acme.com'] });
    expect(state.patch.domain_id).toBe('dom1');
    expect(state.patch.updated_at).toBeTruthy();
    expect(state.filters).toContainEqual(['id', 'w1']);
    expect(state.filters).toContainEqual(['company_id', 'co1']);
    expect(out.id).toBe('w1');
  });

  it('only sets provided fields (no accidental overwrite)', async () => {
    await updateWebsite('w1', 'co1', { settings: { x: 1 } });
    expect(state.patch.settings).toEqual({ x: 1 });
    expect('name' in state.patch).toBe(false);
    expect('domain_id' in state.patch).toBe(false);
  });
});
