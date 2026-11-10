/**
 * Prompt 3 — community approval content binding and the TS evidence mirror.
 *
 *   - The binding hash covers tenant, action, platform, action type, target, recipient,
 *     playbook and text; NOT execution_mode (LD-2).
 *   - Evidence: approver, content hash, passkey window (−5 min .. +60 s around the
 *     server-stamped approved_at), and the 7-day lifetime from the D-02 constants:
 *     just before 7 days valid, exactly at 7 days expired, after expired.
 */

jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => ({
  beginAuthentication: jest.fn(),
  verifyAuthentication: jest.fn(),
}));

import {
  communityApprovalBindingHash,
  evaluateCommunityApprovalEvidence,
} from '../../services/communityApprovalBinding';
import { APPROVAL_LIFETIME_MS, APPROVAL_LIFETIME_DAYS } from '../../services/leadOutreachExecution/approvalBinding';
import { APPROVAL_PROOF_MAX_AGE_MS } from '../../services/leadOutreachExecution/approvalPasskey';

const ORG = '00000000-0000-4000-8000-0000000000b1';
const base = {
  id: '00000000-0000-4000-8000-0000000000c1',
  tenant_id: ORG,
  organization_id: ORG,
  platform: 'linkedin',
  action_type: 'reply',
  target_id: 'urn:li:comment:1',
  suggested_text: 'Thanks for sharing',
  playbook_id: 'pb-1',
  discovered_user_id: 'du-1',
};
const hashOf = (over: Record<string, unknown> = {}) => {
  const r = communityApprovalBindingHash({ ...base, ...over } as any);
  if (!r.ok) throw new Error(r.reason);
  return r.hash;
};

const APPROVED_AT = '2026-11-01T10:00:00.000Z';
const APPROVED_MS = Date.parse(APPROVED_AT);
const evidenced = (over: Record<string, unknown> = {}) => ({
  ...base,
  approved_at: APPROVED_AT,
  approved_by: '00000000-0000-4000-8000-0000000000a1',
  approved_content_hash: hashOf(),
  passkey_credential_id: 'cred-1',
  passkey_verified_at: '2026-11-01T09:59:30.000Z',
  ...over,
});

describe('communityApprovalBindingHash', () => {
  it('is deterministic and well formed', () => {
    expect(hashOf()).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOf()).toBe(hashOf());
  });

  it('does not bind execution_mode (LD-2)', () => {
    expect(hashOf({ execution_mode: 'browser' })).toBe(hashOf({ execution_mode: 'api' }));
  });

  it.each([
    ['id', '00000000-0000-4000-8000-0000000000c2'],
    ['platform', 'instagram'],
    ['action_type', 'like'],
    ['target_id', 'urn:li:comment:2'],
    ['suggested_text', 'Thanks for sharing!'],
    ['playbook_id', 'pb-2'],
    ['discovered_user_id', 'du-2'],
  ])('changes when %s changes', (field, value) => {
    expect(hashOf({ [field]: value })).not.toBe(hashOf());
  });

  it('binds the tenant', () => {
    const other = '00000000-0000-4000-8000-0000000000b9';
    expect(hashOf({ tenant_id: other, organization_id: other })).not.toBe(hashOf());
  });

  it('refuses a row it cannot bind', () => {
    expect(communityApprovalBindingHash({ ...base, tenant_id: '00000000-0000-4000-8000-0000000000b9' } as any).ok).toBe(false);
    expect(communityApprovalBindingHash({ ...base, target_id: null } as any).ok).toBe(false);
    expect(communityApprovalBindingHash({ ...base, id: '' } as any).ok).toBe(false);
  });
});

describe('evaluateCommunityApprovalEvidence', () => {
  it('uses the D-02 7-day lifetime', () => {
    expect(APPROVAL_LIFETIME_DAYS).toBe(7);
    expect(APPROVAL_LIFETIME_MS).toBe(7 * 24 * 3_600_000);
  });

  it('just before 7 days: valid', () => {
    const r = evaluateCommunityApprovalEvidence(evidenced(), APPROVED_MS + APPROVAL_LIFETIME_MS - 1);
    expect(r).toMatchObject({ ok: true, expiresAt: new Date(APPROVED_MS + APPROVAL_LIFETIME_MS).toISOString() });
  });

  it('exactly at 7 days: expired', () => {
    expect(evaluateCommunityApprovalEvidence(evidenced(), APPROVED_MS + APPROVAL_LIFETIME_MS))
      .toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
  });

  it('after 7 days: expired', () => {
    expect(evaluateCommunityApprovalEvidence(evidenced(), APPROVED_MS + APPROVAL_LIFETIME_MS + 1))
      .toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
  });

  it('no approval: HUMAN_APPROVAL_REQUIRED', () => {
    expect(evaluateCommunityApprovalEvidence(evidenced({ approved_at: null }), APPROVED_MS)).toMatchObject({ ok: false, code: 'HUMAN_APPROVAL_REQUIRED' });
    expect(evaluateCommunityApprovalEvidence(null, APPROVED_MS)).toMatchObject({ ok: false, code: 'HUMAN_APPROVAL_REQUIRED' });
  });

  it.each([
    ['no approver', { approved_by: null }],
    ['no content hash', { approved_content_hash: null }],
    ['a malformed content hash', { approved_content_hash: 'abc' }],
    ['no credential', { passkey_credential_id: null }],
    ['no verification time', { passkey_verified_at: null }],
    ['an unreadable approval time', { approved_at: 'not a time' }],
  ])('legacy / incomplete evidence (%s): APPROVAL_EVIDENCE_REQUIRED', (_l, over) => {
    expect(evaluateCommunityApprovalEvidence(evidenced(over), APPROVED_MS)).toMatchObject({ ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED' });
  });

  it('passkey window: −5 min and +60 s are inside, one ms beyond either is outside', () => {
    const at = (ms: number) => new Date(ms).toISOString();
    expect(evaluateCommunityApprovalEvidence(evidenced({ passkey_verified_at: at(APPROVED_MS - APPROVAL_PROOF_MAX_AGE_MS) }), APPROVED_MS).ok).toBe(true);
    expect(evaluateCommunityApprovalEvidence(evidenced({ passkey_verified_at: at(APPROVED_MS + 60_000) }), APPROVED_MS).ok).toBe(true);
    expect(evaluateCommunityApprovalEvidence(evidenced({ passkey_verified_at: at(APPROVED_MS - APPROVAL_PROOF_MAX_AGE_MS - 1) }), APPROVED_MS))
      .toMatchObject({ ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED' });
    expect(evaluateCommunityApprovalEvidence(evidenced({ passkey_verified_at: at(APPROVED_MS + 60_001) }), APPROVED_MS))
      .toMatchObject({ ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED' });
  });

  it('content changed after approval: APPROVAL_CONTENT_CHANGED', () => {
    expect(evaluateCommunityApprovalEvidence(evidenced({ suggested_text: 'edited' }), APPROVED_MS))
      .toMatchObject({ ok: false, code: 'APPROVAL_CONTENT_CHANGED' });
  });

  it('an approval stamped in the future (beyond clock skew) is refused', () => {
    expect(evaluateCommunityApprovalEvidence(evidenced(), APPROVED_MS - 60_001)).toMatchObject({ ok: false, code: 'APPROVAL_EVIDENCE_REQUIRED' });
    expect(evaluateCommunityApprovalEvidence(evidenced(), APPROVED_MS - 60_000).ok).toBe(true);
  });
});
