/**
 * creditApprovalService — unit tests
 *
 * Mocks the supabase client so we can assert the service composes the right
 * payloads and routes errors correctly. The DB-level invariants (proposer
 * cannot self-sign, terminal status frozen, etc.) are enforced by the RPC,
 * not this service — so they're surfaced via simulated error strings here.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  proposeApproval,
  signApproval,
} from '../../services/billing/creditApprovalService';

type AnyMock = jest.Mock;

describe('creditApprovalService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('proposeApproval', () => {
    it('rejects when organizationId missing', async () => {
      const res = await proposeApproval({
        actionType: 'admin_grant',
        proposedBy: 'u1',
        payload: { organizationId: '', reason: 'r', amountCredits: 100 },
      });
      expect(res.ok).toBe(false);
    });

    it('rejects when grant amount non-positive', async () => {
      const res = await proposeApproval({
        actionType: 'admin_grant',
        proposedBy: 'u1',
        payload: { organizationId: 'o', reason: 'r', amountCredits: 0 },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('INVALID_AMOUNT');
    });

    it('auto-approves when required_approvals = 1', async () => {
      (supabase.rpc as AnyMock).mockResolvedValueOnce({ data: 1, error: null });
      const upsertMock = jest.fn().mockReturnValue({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'app-1', status: 'approved', required_approvals: 1 }, error: null }),
        }),
      });
      (supabase.from as AnyMock).mockReturnValue({ upsert: upsertMock });

      const res = await proposeApproval({
        actionType: 'admin_grant',
        proposedBy: 'u1',
        payload: { organizationId: 'o', reason: 'r', amountCredits: 100 },
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.autoApproved).toBe(true);
        expect(res.status).toBe('approved');
      }
    });

    it('returns pending when threshold > 1', async () => {
      (supabase.rpc as AnyMock).mockResolvedValueOnce({ data: 2, error: null });
      const upsertMock = jest.fn().mockReturnValue({
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'app-2', status: 'pending', required_approvals: 2 }, error: null }),
        }),
      });
      (supabase.from as AnyMock).mockReturnValue({ upsert: upsertMock });

      const res = await proposeApproval({
        actionType: 'admin_grant',
        proposedBy: 'u1',
        payload: { organizationId: 'o', reason: 'r', amountCredits: 10_000 },
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.autoApproved).toBe(false);
        expect(res.status).toBe('pending');
      }
    });
  });

  describe('signApproval', () => {
    it('classifies self-sign blocked code', async () => {
      (supabase.rpc as AnyMock).mockResolvedValueOnce({ data: null, error: { message: 'APPROVAL_SELF_NOT_ALLOWED' } });
      const res = await signApproval({ approvalId: 'a', approverId: 'u', decision: 'approve' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('SELF_SIGN_BLOCKED');
    });

    it('classifies expired', async () => {
      (supabase.rpc as AnyMock).mockResolvedValueOnce({ data: null, error: { message: 'APPROVAL_EXPIRED' } });
      const res = await signApproval({ approvalId: 'a', approverId: 'u', decision: 'approve' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('EXPIRED');
    });

    it('returns success payload on successful sign', async () => {
      (supabase.rpc as AnyMock).mockResolvedValueOnce({
        data: {
          id: 'a',
          status: 'approved',
          approvals_received: 2,
          required_approvals: 2,
          approve_count: 2,
          reject_count: 0,
        },
        error: null,
      });
      const res = await signApproval({ approvalId: 'a', approverId: 'u', decision: 'approve' });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.status).toBe('approved');
        expect(res.approveCount).toBe(2);
      }
    });
  });
});
