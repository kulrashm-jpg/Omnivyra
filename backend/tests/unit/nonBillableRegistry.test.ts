jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  registerNonBillable,
  getRegisteredEntry,
  auditRegistry,
  isRegisteredNonBillable,
  NON_BILLABLE_CATEGORIES,
} from '../../services/billing/nonBillableRegistry';

type AnyMock = jest.Mock;

describe('nonBillableRegistry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validates required fields', async () => {
    const r1 = await registerNonBillable({ actionKey: '', reason: 'r', approvedBy: 'u', category: 'internal_tool', ownerUserId: 'u' });
    expect(r1.ok).toBe(false);
    const r2 = await registerNonBillable({ actionKey: 'k', reason: '',  approvedBy: 'u', category: 'internal_tool', ownerUserId: 'u' });
    expect(r2.ok).toBe(false);
    const r3 = await registerNonBillable({ actionKey: 'k', reason: 'r', approvedBy: '',  category: 'internal_tool', ownerUserId: 'u' });
    expect(r3.ok).toBe(false);
    const r4 = await registerNonBillable({ actionKey: 'k', reason: 'r', approvedBy: 'u', category: 'bad' as any, ownerUserId: 'u' });
    expect(r4.ok).toBe(false);
  });

  it('writes a row when valid', async () => {
    const upsertMock = jest.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as AnyMock).mockReturnValue({ upsert: upsertMock });
    const r = await registerNonBillable({
      actionKey: 'cache_warm', reason: 'pre-warm cache', approvedBy: 'u1',
      category: 'system_internal_summary', ownerUserId: 'u1',
    });
    expect(r.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalled();
  });

  it('auto-computes expires_at for categories with a review window', async () => {
    let captured: Record<string, unknown> | null = null;
    const upsertMock = jest.fn().mockImplementation((row: Record<string, unknown>) => {
      captured = row;
      return Promise.resolve({ data: null, error: null });
    });
    (supabase.from as AnyMock).mockReturnValue({ upsert: upsertMock });
    await registerNonBillable({
      actionKey: 'k', reason: 'r', approvedBy: 'u1',
      category: 'pre_purchase_preview', ownerUserId: 'u1',
    });
    expect(captured).not.toBeNull();
    expect((captured as Record<string, unknown>).expires_at).toBeTruthy();
  });

  it('regex_false_positive entries never expire', async () => {
    let captured: Record<string, unknown> | null = null;
    const upsertMock = jest.fn().mockImplementation((row: Record<string, unknown>) => {
      captured = row;
      return Promise.resolve({ data: null, error: null });
    });
    (supabase.from as AnyMock).mockReturnValue({ upsert: upsertMock });
    await registerNonBillable({
      actionKey: 'k', reason: 'docstring', approvedBy: 'u1',
      category: 'regex_false_positive', ownerUserId: 'u1',
    });
    expect((captured as Record<string, unknown>).expires_at).toBeNull();
  });

  it('getRegisteredEntry returns expired flag correctly', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: {
              action_key: 'k', reason: 'r', approved_by: 'u',
              expires_at: yesterday, metadata: { category: 'internal_tool', owner_user_id: 'u' },
              created_at: '2024-01-01T00:00:00Z',
            },
            error: null,
          }),
        }),
      }),
    });
    const entry = await getRegisteredEntry('k');
    expect(entry?.expired).toBe(true);
  });

  it('isRegisteredNonBillable returns false for expired entries', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString();
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { action_key: 'k', reason: 'r', approved_by: 'u', expires_at: yesterday, metadata: {}, created_at: '2024-01-01T00:00:00Z' },
            error: null,
          }),
        }),
      }),
    });
    expect(await isRegisteredNonBillable('k')).toBe(false);
  });

  it('auditRegistry tallies missing owner / missing reason / expired', async () => {
    const rows = [
      { action_key: 'a', reason: 'ok', approved_by: 'u', expires_at: null, metadata: { category: 'internal_tool', owner_user_id: 'u' }, created_at: '2024-01-01' },
      { action_key: 'b', reason: 'ok', approved_by: 'u', expires_at: null, metadata: { category: 'internal_tool' /* no owner */ },     created_at: '2024-01-01' },
      { action_key: 'c', reason: '',   approved_by: 'u', expires_at: null, metadata: { category: 'internal_tool', owner_user_id: 'u' }, created_at: '2024-01-01' },
      { action_key: 'd', reason: 'ok', approved_by: 'u', expires_at: new Date(Date.now() - 1000).toISOString(), metadata: { category: 'internal_tool', owner_user_id: 'u' }, created_at: '2024-01-01' },
    ];
    (supabase.from as AnyMock).mockReturnValue({
      select: () => Promise.resolve({ data: rows, error: null }),
    });
    const r = await auditRegistry();
    expect(r.totalEntries).toBe(4);
    expect(r.missingOwnerCount).toBe(1);
    expect(r.missingReasonCount).toBe(1);
    expect(r.expiredCount).toBe(1);
  });

  it('NON_BILLABLE_CATEGORIES is the canonical taxonomy', () => {
    expect(NON_BILLABLE_CATEGORIES).toContain('inside_orchestrated_scope');
    expect(NON_BILLABLE_CATEGORIES).toContain('regex_false_positive');
  });
});
