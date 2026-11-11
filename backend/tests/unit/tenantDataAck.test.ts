/**
 * Tenant data-controller acknowledgement (owner requirement, 2026-11-11).
 */
import {
  categoryStatus,
  loadTenantDataNotice,
  noticeTextHash,
  recordTenantDataAck,
  assertTenantDataAck,
  TenantDataAckRequired,
  type AckRow,
  type TenantDataNotice,
} from '../../services/compliance/tenantDataAck';

const RAW = {
  version: 'v2', status: 'PENDING COUNSEL REVIEW', publishedAt: '2026-11-10T00:00:00.000Z', graceDays: 14,
  title: 'T', intro: 'I', categories: { vendor_data: 'V', salesnav_capture: 'S', contact_data: 'C' },
};
const N: TenantDataNotice = loadTenantDataNotice(RAW);
const ORG = '00000000-0000-4000-8000-0000000000aa';
const ADMIN = '00000000-0000-4000-8000-0000000000a1';
const row = (over: Partial<AckRow> & { cats?: string[]; hash?: string }): AckRow => ({
  consent_version: over.consent_version ?? 'v2', granted_by: ADMIN, granted_at: '2026-11-10T12:00:00Z',
  scope_snapshot: over.cats ?? ['vendor_data'], metadata: { text_sha256: over.hash ?? N.textSha256 },
});
const D = (s: string) => new Date(s);

describe('the notice', () => {
  it('the shipped config loads, is marked PENDING COUNSEL REVIEW and covers all three categories', () => {
    const n = loadTenantDataNotice();
    expect(n.status).toBe('PENDING COUNSEL REVIEW');
    expect(Object.keys(n.categories)).toEqual(['vendor_data', 'salesnav_capture', 'contact_data']);
    expect(n.textSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('any wording edit changes the hash', () => {
    expect(noticeTextHash({ ...RAW, intro: 'I.' })).not.toBe(N.textSha256);
    expect(noticeTextHash({ ...RAW, categories: { ...RAW.categories, contact_data: 'C!' } })).not.toBe(N.textSha256);
  });
});

describe('per-category state', () => {
  it('never accepted -> required (blocked)', () => {
    expect(categoryStatus(N, [], 'vendor_data', D('2026-11-11'))).toMatchObject({ state: 'required', allowed: false });
  });
  it('accepted at this version + text -> current (allowed)', () => {
    expect(categoryStatus(N, [row({})], 'vendor_data', D('2026-11-11'))).toMatchObject({ state: 'current', allowed: true, acceptedBy: ADMIN });
  });
  it('a NEW category is required even when others are accepted', () => {
    expect(categoryStatus(N, [row({ cats: ['vendor_data'] })], 'contact_data', D('2026-11-11')).state).toBe('required');
  });
  it('an OLDER version: GRACE (allowed) until publishedAt + graceDays, then EXPIRED (blocked)', () => {
    const old = [row({ consent_version: 'v1' })];
    expect(categoryStatus(N, old, 'vendor_data', D('2026-11-23T23:59:59Z'))).toMatchObject({ state: 'grace', allowed: true, graceEndsAt: '2026-11-24T00:00:00.000Z' });
    expect(categoryStatus(N, old, 'vendor_data', D('2026-11-24T00:00:00Z'))).toMatchObject({ state: 'expired', allowed: false });
  });
  it('same version, different text hash (edited without a bump) -> text_changed (blocked, no grace)', () => {
    expect(categoryStatus(N, [row({ hash: 'f'.repeat(64) })], 'vendor_data', D('2026-11-11'))).toMatchObject({ state: 'text_changed', allowed: false });
  });
  it('unreadable ledger -> unknown (blocked: fail closed)', () => {
    expect(categoryStatus(N, null, 'vendor_data', D('2026-11-11'))).toMatchObject({ state: 'unknown', allowed: false });
  });
  it('the NEWEST row covering the category decides', () => {
    const rows = [row({ cats: ['contact_data'] }), row({ consent_version: 'v1', cats: ['vendor_data', 'contact_data'] })];
    expect(categoryStatus(N, rows, 'contact_data', D('2026-12-30')).state).toBe('current');
    expect(categoryStatus(N, rows, 'vendor_data', D('2026-12-30')).state).toBe('expired');
  });
});

describe('enforcement', () => {
  it('assertTenantDataAck throws TenantDataAckRequired naming category + state; allows current and grace', async () => {
    await expect(assertTenantDataAck(ORG, 'vendor_data', D('2026-11-11'), { notice: N, read: async () => [] }))
      .rejects.toMatchObject({ name: 'TenantDataAckRequired', category: 'vendor_data', state: 'required' });
    await expect(assertTenantDataAck(ORG, 'vendor_data', D('2026-11-11'), { notice: N, read: async () => [row({ consent_version: 'v1' })] }))
      .resolves.toMatchObject({ state: 'grace' });
    await expect(assertTenantDataAck(ORG, 'vendor_data', D('2026-11-11'), { notice: N, read: async () => null }))
      .rejects.toBeInstanceOf(TenantDataAckRequired);
  });
});

describe('recording an acceptance', () => {
  const base = { organizationId: ORG, userId: ADMIN, categories: ['vendor_data', 'contact_data'], shownVersion: 'v2', shownTextSha256: N.textSha256, now: D('2026-11-11T09:00:00Z') };
  const deps = (over: Record<string, unknown> = {}) => {
    const written: Array<Record<string, unknown>> = [];
    return { written, d: { notice: N, isAdmin: async () => true, read: async () => [], record: (async (x: Record<string, unknown>) => { written.push(x); return {}; }) as never, ...over } };
  };

  it('writes ONE consent row: capability, version, categories, text hash; tenant + acceptor from the caller', async () => {
    const { written, d } = deps();
    await expect(recordTenantDataAck(base, d)).resolves.toEqual({ acceptedVersion: 'v2', categories: ['vendor_data', 'contact_data'] });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      organizationId: ORG, grantedBy: ADMIN, capability: 'tenant_data_controller_ack', platform: 'pi_data',
      consentVersion: 'v2', scopeSnapshot: ['vendor_data', 'contact_data'], source: 'ui',
      metadata: { text_sha256: N.textSha256, wording_status: 'PENDING COUNSEL REVIEW' },
    });
  });

  it('a RE-acceptance after a wording change records the previous version and the grace window', async () => {
    const { written, d } = deps({ read: async () => [row({ consent_version: 'v1', cats: ['vendor_data'] })] });
    await recordTenantDataAck({ ...base, categories: ['vendor_data'] }, d);
    expect(written[0].metadata).toMatchObject({ previous_version: 'v1', grace_started_at: '2026-11-10T00:00:00.000Z', grace_ends_at: '2026-11-24T00:00:00.000Z' });
  });

  it('a STALE screen (version or text hash not the current one) is refused, nothing written', async () => {
    for (const over of [{ shownVersion: 'v1' }, { shownTextSha256: 'e'.repeat(64) }, { shownTextSha256: '' }]) {
      const { written, d } = deps();
      await expect(recordTenantDataAck({ ...base, ...over }, d)).rejects.toMatchObject({ code: 'stale_notice' });
      expect(written).toEqual([]);
    }
  });

  it('only a COMPANY_ADMIN of THIS tenant; an unreadable role refuses (never assumed)', async () => {
    let r = deps({ isAdmin: async () => false });
    await expect(recordTenantDataAck(base, r.d)).rejects.toMatchObject({ code: 'not_company_admin' });
    expect(r.written).toEqual([]);
    r = deps({ isAdmin: async () => null });
    await expect(recordTenantDataAck(base, r.d)).rejects.toMatchObject({ code: 'membership_unknown' });
    expect(r.written).toEqual([]);
  });

  it('unknown or empty categories are refused', async () => {
    for (const categories of [[], ['everything'], ['vendor_data', 'x']]) {
      const { d } = deps();
      await expect(recordTenantDataAck({ ...base, categories }, d)).rejects.toMatchObject({ code: 'invalid_categories' });
    }
  });
});
