import { ROLE_CAPABILITIES, roleHasCapability, hasExecutionCapability } from '../../../lib/execution/executionCapabilities';
import { buildIdempotencyKey, validateEmailTarget, previewEmail, envLiveSendEnabled, dispatchEmail } from '../../../backend/services/execution/emailExecutionConnector';
import { envExecutionEnabled } from '../../../backend/services/execution/executionControlService';

describe('LC-501 execution guards (pure)', () => {
  it('enforces role separation (executor cannot approve; approver cannot execute)', () => {
    expect(roleHasCapability(['executor'], 'campaign.execute')).toBe(true);
    expect(roleHasCapability(['executor'], 'campaign.approve')).toBe(false);
    expect(roleHasCapability(['approver'], 'campaign.approve')).toBe(true);
    expect(roleHasCapability(['approver'], 'campaign.execute')).toBe(false);
    expect(roleHasCapability(['creator'], 'campaign.execute')).toBe(false);
    expect(ROLE_CAPABILITIES.auditor).toEqual([]);
  });

  it('capability check is default-deny', () => {
    expect(hasExecutionCapability(undefined, 'campaign.execute')).toBe(false);
    expect(hasExecutionCapability([], 'campaign.execute')).toBe(false);
    expect(hasExecutionCapability(['campaign.execute'], 'campaign.execute')).toBe(true);
  });

  it('execution + live-send env gates default OFF', () => {
    delete process.env.GTM_EXECUTION_ENABLED;
    delete process.env.GTM_LIVE_SEND;
    expect(envExecutionEnabled()).toBe(false);
    expect(envLiveSendEnabled()).toBe(false);
  });

  it('idempotency key is deterministic + stable', () => {
    const a = buildIdempotencyKey('c1', 'e1', 'email', 'm1');
    const b = buildIdempotencyKey('c1', 'e1', 'email', 'm1');
    const c = buildIdempotencyKey('c1', 'e2', 'email', 'm1');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });

  it('validates recipients and previews without sending', () => {
    expect(validateEmailTarget('a@b.com').ok).toBe(true);
    expect(validateEmailTarget('nope').ok).toBe(false);
    expect(previewEmail({ subject: 'Hi', body: 'x'.repeat(500) }, 'a@b.com').bodyPreview).toHaveLength(240);
  });

  it('email connector NEVER dispatches live (dry-run only) even if live env were set', async () => {
    process.env.GTM_LIVE_SEND = 'true';
    const r = await dispatchEmail({ campaignId: 'c1', entityId: 'e1', recipient: 'a@b.com', message: { subject: 'Hi', body: 'Hello' } });
    expect(r.dispatched).toBe(false);
    expect(r.dryRun).toBe(true);
    delete process.env.GTM_LIVE_SEND;
  });
});
