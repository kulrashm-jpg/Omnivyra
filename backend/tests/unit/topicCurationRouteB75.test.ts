/**
 * B7.5 — curation route authorization (test 9: unauthorized caller rejected).
 *
 * Proves the platform-tier capability gate runs BEFORE any service call, so an
 * unauthorized caller can never reach the writer.
 */

const mockRequireCapability = jest.fn();
jest.mock('../../security/requireCapability', () => ({
  requireCapability: (...a: unknown[]) => mockRequireCapability(...a),
}));

const mockConfirm = jest.fn();
const mockReverse = jest.fn();
jest.mock('../../services/content/knowledgeGraph/topicCurationService', () => ({
  confirmCanonicalTopic: (...a: unknown[]) => mockConfirm(...a),
  reverseCanonicalTopic: (...a: unknown[]) => mockReverse(...a),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/admin/knowledge-graph/canonical-topic';
import { INTELLIGENCE_OVERRIDE_MANAGE } from '../../../shared/contracts/security';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';

const mkRes = () => {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn(() => res as never);
  res.json = jest.fn(() => res as never);
  res.setHeader = jest.fn(() => res as never);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireCapability.mockResolvedValue({ ok: true, principal: { userId: 'op-1' } });
  mockConfirm.mockResolvedValue({ ok: true, action: 'confirmed', topicId: A, canonicalTopicId: B });
  mockReverse.mockResolvedValue({ ok: true, action: 'reversed', topicId: A, canonicalTopicId: null });
});

describe('B7.5 · route authorization', () => {
  it('9. an unauthorized caller never reaches the writer', async () => {
    mockRequireCapability.mockResolvedValue({ ok: false, sent: true });
    const res = mkRes();
    await handler({ method: 'POST', body: { topicId: A, canonicalTopicId: B } } as never, res as never);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockReverse).not.toHaveBeenCalled();
  });

  it('gates on the existing platform-tier capability — no new role model', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { topicId: A, canonicalTopicId: B } } as never, res as never);
    expect(mockRequireCapability.mock.calls[0][2]).toMatchObject({ capability: INTELLIGENCE_OVERRIDE_MANAGE });
    expect(INTELLIGENCE_OVERRIDE_MANAGE).toBe('intelligence.override.manage');
  });

  it('authorized POST confirms and returns 200', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { topicId: A, canonicalTopicId: B } } as never, res as never);
    expect(mockConfirm).toHaveBeenCalledWith(A, B);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('authorized DELETE reverses and returns 200', async () => {
    const res = mkRes();
    await handler({ method: 'DELETE', body: { topicId: A } } as never, res as never);
    expect(mockReverse).toHaveBeenCalledWith(A);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps typed failures to deterministic status codes', async () => {
    const cases: Array<[string, number]> = [
      ['self_reference', 400], ['canonical_is_alias', 400], ['would_create_cycle', 409],
      ['source_not_found', 404], ['write_failed', 500],
    ];
    for (const [reason, status] of cases) {
      jest.clearAllMocks();
      mockRequireCapability.mockResolvedValue({ ok: true, principal: {} });
      mockConfirm.mockResolvedValue({ ok: false, reason });
      const res = mkRes();
      await handler({ method: 'POST', body: { topicId: A, canonicalTopicId: B } } as never, res as never);
      expect(res.status).toHaveBeenCalledWith(status);
    }
  });

  it('rejects other methods before the guard', async () => {
    const res = mkRes();
    await handler({ method: 'GET', body: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mockRequireCapability).not.toHaveBeenCalled();
  });

  it('takes no companyId — the route cannot reach tenant data', async () => {
    const res = mkRes();
    await handler({ method: 'POST', body: { topicId: A, canonicalTopicId: B, companyId: 'x' } } as never, res as never);
    expect(mockConfirm).toHaveBeenCalledWith(A, B);   // companyId ignored entirely
  });
});
