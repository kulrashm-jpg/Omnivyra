/**
 * PRIVILEGE/credentials class 1+2 (2026-11-12): PUT /api/provider-accounts/[id]
 * merges the supplied credential fields onto a READ of the stored envelope.
 *  - The read's error was never checked: a failed read merged onto NOTHING and
 *    the update overwrote the envelope with only the supplied fields (every
 *    other stored secret dropped).
 *  - The update was by id only: a concurrent PUT or a token-refresh write
 *    between the read and the write was silently reverted (lost update).
 * Now: read error -> 503, nothing written; the update is a CAS on the envelope
 * as read (ProviderAccountConflictError -> 409).
 */
export {};
type Row = Record<string, any>;
let mockAccounts: Row[] = [];

// ── service level: the REAL updateProviderAccount over a filter-applying fake ──
function mockQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  let payload: Row = {};
  const exec = async () => {
    const hit = mockAccounts.filter((r) => filters.every((f) => f(r)));
    for (const r of hit) Object.assign(r, payload);
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const b: any = {
    update: (p: Row) => { payload = p; return b; },
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; },
    select: () => b,
    single: async () => { const r = await exec(); return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: 'not single' } }; },
    then: (ok: any, ko: any) => exec().then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => mockQuery() }));

import { updateProviderAccount, ProviderAccountConflictError } from '../../services/providerAccountService';

beforeEach(() => { mockAccounts = [{ id: 'a1', credentials_encrypted: 'ENV-v1', account_name: 'x' }]; });

describe('updateProviderAccount CAS', () => {
  it('control: envelope unchanged since the read -> updated', async () => {
    await updateProviderAccount('a1', { credentials_encrypted: 'ENV-v2' }, { expectCredentialsEncrypted: 'ENV-v1' });
    expect(mockAccounts[0].credentials_encrypted).toBe('ENV-v2');
  });
  it('envelope CHANGED since the read (token refresh) -> ProviderAccountConflictError, the newer envelope stands', async () => {
    mockAccounts[0].credentials_encrypted = 'ENV-refreshed';
    await expect(updateProviderAccount('a1', { credentials_encrypted: 'ENV-v2' }, { expectCredentialsEncrypted: 'ENV-v1' }))
      .rejects.toBeInstanceOf(ProviderAccountConflictError);
    expect(mockAccounts[0].credentials_encrypted).toBe('ENV-refreshed');
  });
  it('a NULL stored envelope is matched with IS NULL', async () => {
    mockAccounts[0].credentials_encrypted = null;
    await updateProviderAccount('a1', { credentials_encrypted: 'ENV-new' }, { expectCredentialsEncrypted: null });
    expect(mockAccounts[0].credentials_encrypted).toBe('ENV-new');
  });
  it('control: without opts (non-credential patch) the plain update still applies', async () => {
    await updateProviderAccount('a1', { account_name: 'y' });
    expect(mockAccounts[0].account_name).toBe('y');
  });
});
