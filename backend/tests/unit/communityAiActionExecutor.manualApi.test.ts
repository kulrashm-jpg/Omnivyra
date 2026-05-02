/**
 * communityAiActionExecutor — manual-source + api-mode path.
 *
 * Verifies the narrow hardening change: human-initiated sends
 * (`options.source === 'manual'`) may use `execution_mode: 'api'`
 * without declaring a playbook (the human is the guardrail). Automated
 * callers still need a playbook when mode !== 'manual'.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve({ error: null })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                gte: jest.fn(() => Promise.resolve({ data: [] })),
              })),
            })),
          })),
        })),
      })),
    })),
  },
}));

jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  getCommunityAiPlatformPolicy: jest.fn(async () => ({
    execution_enabled: true,
    require_human_approval: false,
  })),
}));

jest.mock('../../services/usageEnforcementService', () => ({
  checkUsageBeforeExecution: jest.fn(async () => ({ allowed: true })),
}));

jest.mock('../../services/communityAiNotificationService', () => ({
  notifyCommunityAi: jest.fn(async () => undefined),
}));

jest.mock('../../services/communityAiWebhookService', () => ({
  sendCommunityAiWebhooks: jest.fn(async () => undefined),
}));

jest.mock('../../services/communityAiActionLogService', () => ({
  logCommunityAiActionEvent: jest.fn(async () => undefined),
}));

jest.mock('../../services/usageLedgerService', () => ({
  logUsageEvent: jest.fn(async () => undefined),
}));

jest.mock('../../services/usageMeterService', () => ({
  incrementUsageMeter: jest.fn(async () => undefined),
}));

jest.mock('../../services/platformTokenService', () => ({
  getToken: jest.fn(async () => ({ access_token: 'test-token' })),
}));

jest.mock('../../services/rpaWorker/rpaWorkerService', () => ({
  executeRpaTask: jest.fn(async () => ({ success: true })),
}));

// Connector mock — we want to observe that the real connector is called on
// the api-mode path (not silently simulated).
const mockLinkedInExecuteAction = jest.fn(async () => ({
  success: true,
  platform_id: 'urn:li:comment:(123,456)',
  platform_response: { data: { id: 'urn:li:comment:(123,456)' } },
}));

jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...args: unknown[]) => mockLinkedInExecuteAction(...args as [any, any]),
}));

import { executeAction } from '../../services/communityAiActionExecutor';

const baseAction = () => ({
  id: 'action-1',
  tenant_id: 'tenant-1',
  organization_id: 'org-1',
  platform: 'linkedin',
  action_type: 'reply' as const,
  target_id: 'urn:li:share:post-1',
  suggested_text: 'thanks!',
  playbook_id: null,
});

describe('communityAiActionExecutor — manual api-mode', () => {
  beforeEach(() => {
    mockLinkedInExecuteAction.mockClear();
  });

  it('allows execution_mode: "api" without a playbook when source is "manual"', async () => {
    const result = await executeAction(
      { ...baseAction(), execution_mode: 'api' },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe('executed');
    expect(result.platform_id).toBe('urn:li:comment:(123,456)');
    expect(mockLinkedInExecuteAction).toHaveBeenCalledTimes(1);
  });

  it('rejects execution_mode: "api" without a playbook when source is NOT manual', async () => {
    const result = await executeAction(
      { ...baseAction(), execution_mode: 'api' },
      true,
      { source: 'auto', notify: false, webhook: false },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('PLAYBOOK_REQUIRED');
    expect(mockLinkedInExecuteAction).not.toHaveBeenCalled();
  });

  it('surfaces platform_id at the top level when the connector returns one', async () => {
    const result = await executeAction(
      { ...baseAction(), execution_mode: 'api' },
      true,
      { source: 'manual', notify: false, webhook: false },
    );
    expect(result.platform_id).toBe('urn:li:comment:(123,456)');
  });

  it('falls back API → browser (not simulated success) when the connector reports failure', async () => {
    // Phase 2 contract: a failed API call is not silently recorded as
    // executed. Instead the executor falls back to a browser dispatch so
    // the extension can attempt the action. The row is queued via
    // status='dispatched' + execution_mode='browser' and the original API
    // error is preserved under response.api_error.
    mockLinkedInExecuteAction.mockResolvedValueOnce({
      success: false,
      error: 'LINKEDIN_RATE_LIMIT',
    } as any);

    const result = await executeAction(
      { ...baseAction(), execution_mode: 'api' },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.status).toBe('dispatched');
    expect(result.execution_mode).toBe('browser');
    expect(result.response?.fallback_from).toBe('api');
    expect(result.response?.api_error).toBe('LINKEDIN_RATE_LIMIT');
  });

  it('queues LinkedIn DM triage as continue_thread, not start_new_dm', async () => {
    const result = await executeAction(
      {
        ...baseAction(),
        action_type: 'dm',
        target_id: 'Rajesh Singh',
        suggested_text: 'Thanks Rajesh, I will check and get back to you.',
        execution_mode: 'browser',
      },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.status).toBe('dispatched');
    expect(result.execution_mode).toBe('browser');
    expect((result as any).command_chain).toEqual([
      {
        action_type: 'continue_thread',
        payload: {
          text: 'Thanks Rajesh, I will check and get back to you.',
          autoSubmit: true,
        },
      },
    ]);
  });

  it('opens visible LinkedIn DM rows by participant name when no verified thread URL exists', async () => {
    const result = await executeAction(
      {
        ...baseAction(),
        action_type: 'dm',
        target_id: 'Rajesh Singh',
        suggested_text: 'Thanks Rajesh, I will check and get back to you.',
        execution_mode: 'browser',
        metadata: {
          dm_thread_ready: true,
          dm_participant_name: 'Rajesh Singh',
          dm_last_message_preview: 'Rajesh: Hi Kuldeep, hope you are doing well!',
        },
      },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.status).toBe('dispatched');
    expect(result.execution_mode).toBe('browser');
    expect((result as any).command_chain).toEqual([
      {
        action_type: 'open_thread',
        payload: {
          participantName: 'Rajesh Singh',
          lastMessagePreview: 'Rajesh: Hi Kuldeep, hope you are doing well!',
        },
      },
      {
        action_type: 'continue_thread',
        payload: {
          text: 'Thanks Rajesh, I will check and get back to you.',
          autoSubmit: true,
          participantName: 'Rajesh Singh',
          lastMessagePreview: 'Rajesh: Hi Kuldeep, hope you are doing well!',
        },
      },
    ]);
  });

  it('targets resolved LinkedIn DM threads before continuing the conversation', async () => {
    const result = await executeAction(
      {
        ...baseAction(),
        action_type: 'dm',
        target_id: 'https://www.linkedin.com/messaging/thread/2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA/',
        suggested_text: 'Thanks Rajesh, I will check and get back to you.',
        execution_mode: 'browser',
        metadata: {
          dm_thread_ready: true,
          dm_thread_id: '2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA',
          dm_thread_url: 'https://www.linkedin.com/messaging/thread/2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA/',
        },
      },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.status).toBe('dispatched');
    expect(result.execution_mode).toBe('browser');
    expect((result as any).command_chain).toEqual([
      {
        action_type: 'open_thread',
        payload: {
          threadUrl: 'https://www.linkedin.com/messaging/thread/2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA/',
        },
      },
      {
        action_type: 'continue_thread',
        payload: {
          text: 'Thanks Rajesh, I will check and get back to you.',
          autoSubmit: true,
          threadUrl: 'https://www.linkedin.com/messaging/thread/2-MTc1MjQ5MzE5OTA1OGI0MjI1My0xMDA/',
        },
      },
    ]);
  });

  it('does NOT fabricate a platform_id when the connector omits one', async () => {
    // The "confirmed" UI state depends on a truthy platform_id. If a
    // connector returns success without an id, the executor must surface
    // null — never invent one — so the UI downgrades to "sent, awaiting
    // confirmation" instead of saying "confirmed".
    mockLinkedInExecuteAction.mockResolvedValueOnce({
      success: true,
      // no platform_id
      platform_response: { data: { ack: true } },
    } as any);

    const result = await executeAction(
      { ...baseAction(), execution_mode: 'api' },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe('executed');
    expect(result.platform_id).toBeNull();
  });
});
