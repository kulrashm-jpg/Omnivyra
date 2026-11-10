/**
 * Prompt 3 — the community actions UI's reading of the execute / approve
 * responses (components/community-ai/communityExecuteResponse, used by
 * hooks/useCommunityActions). 202 and 503 are "queued", not failures; 409 is a
 * conflict; 423 is the kill switch / tenant policy; 403 expired or unusable
 * approvals ask for a fresh approval; 401 asks for the passkey.
 */
import { readExecuteResponse, readApproveResponse } from '../../../components/community-ai/communityExecuteResponse';

describe('readExecuteResponse', () => {
  it('200 is success', () => {
    expect(readExecuteResponse(200, { status: 'executed' })).toMatchObject({ ok: true, status: 'executed', message: null });
  });
  it('202 AWAITING_EXTENSION is success, queued', () => {
    const o = readExecuteResponse(202, { status: 'pending', code: 'AWAITING_EXTENSION' });
    expect(o).toMatchObject({ ok: true, status: 'pending', reload: true });
    expect(o.message).toMatch(/extension/i);
  });
  it('503 EXTENSION_NOT_READY is queued but not sent', () => {
    expect(readExecuteResponse(503, { error: 'EXTENSION_NOT_READY', code: 'EXTENSION_NOT_READY' })).toMatchObject({ ok: false, reload: true });
  });
  it.each(['ACTION_CLAIM_CONFLICT', 'ACTION_IN_PROGRESS', 'ACTION_DISPATCHED'])('409 %s is a conflict that reloads', (error) => {
    const o = readExecuteResponse(409, { error, current_status: 'executing' });
    expect(o).toMatchObject({ ok: false, reload: true, reapprove: false });
    expect(o.message).toMatch(/already/i);
  });
  it('422 ACTION_TERMINAL says it ended', () => {
    expect(readExecuteResponse(422, { error: 'ACTION_TERMINAL', current_status: 'failed' }).message).toMatch(/already ended \(failed\)/);
  });
  it('423 names the policy code and that nothing was sent', () => {
    const o = readExecuteResponse(423, { error: 'COMMUNITY_EXECUTION_DISABLED', code: 'PLATFORM_KILL_SWITCH' });
    expect(o).toMatchObject({ ok: false, reapprove: false });
    expect(o.message).toMatch(/PLATFORM_KILL_SWITCH/);
    expect(o.message).toMatch(/Nothing was sent/);
  });
  it.each(['APPROVAL_EXPIRED', 'APPROVAL_EVIDENCE_REQUIRED', 'APPROVAL_REQUIRED'])('403 %s asks for a fresh approval', (error) => {
    expect(readExecuteResponse(403, { error, code: error })).toMatchObject({ ok: false, reapprove: true });
  });
  it('403 TENANT_SCOPE_VIOLATION does not ask for re-approval', () => {
    expect(readExecuteResponse(403, { error: 'TENANT_SCOPE_VIOLATION' })).toMatchObject({ ok: false, reapprove: false });
  });
  it('401 STEP_UP_REQUIRED asks for the passkey', () => {
    expect(readExecuteResponse(401, { code: 'STEP_UP_REQUIRED' })).toMatchObject({ ok: false, stepUp: true });
  });
});

describe('readApproveResponse', () => {
  it('200 is approved', () => {
    expect(readApproveResponse(200, { status: 'approved' })).toMatchObject({ ok: true, status: 'approved' });
  });
  it('401 PASSKEY_REQUIRED asks for the passkey again', () => {
    expect(readApproveResponse(401, { error: 'PASSKEY_REQUIRED', code: 'passkey_required' })).toMatchObject({ ok: false, stepUp: true });
  });
  it('409 APPROVAL_STALE asks to review again', () => {
    expect(readApproveResponse(409, { error: 'APPROVAL_STALE' }).message).toMatch(/Review it again/);
  });
});
