/**
 * communityAiActionExecutor — manual-source + api-mode path.
 *
 * Verifies the narrow hardening change: human-initiated sends
 * (`options.source === 'manual'`) may use `execution_mode: 'api'`
 * without declaring a playbook (the human is the guardrail). Automated
 * callers still need a playbook when mode !== 'manual'.
 */

// L-3: these tests exercise other mechanics with fixtures that carry no
// resolvable recipient; the recipient recheck itself is proven in
// communityL3RecipientRecheck / communityL3RecheckEnforcement /
// communityL3RecheckBrowserClaim. Here every recipient is treated as allowed.
jest.mock('../../services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
// Prompt 3: an in-memory database that stores (and returns) the action row with
// its approval of record, which the executor's evidence gate reads.
import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';
import { withApprovalEvidence } from '../helpers/communityApprovalEvidenceFixture';

let mockDb: FakeDb = createFakeDb();
jest.mock('../../db/supabaseClient', () => ({
  // The claim RPC and refusal recorder, emulated over the fake DB (helpers/communityClaimRpcEmulation).
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: (name: string, args: any) => require('./helpers/communityClaimRpcEmulation').communityRpcEmulation(() => mockDb).rpc(name, args),
  },
}));

jest.mock('../../services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  // Prompt 3: the legacy knobs below, read as the tenant execution decision.
  getCommunityExecutionPolicy: ((legacy: any) => jest.fn((..._a: any[]) =>
    require('../helpers/communityPolicyDecisionShim').asExecutionDecision(legacy())))(jest.fn(async () => ({
    execution_enabled: true,
    auto_rules_enabled: true,
    require_human_approval: false,
  }))),
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
type LinkedInExecuteArgs = Parameters<typeof import('../../services/platformConnectors/linkedinConnector')['executeAction']>;
const mockLinkedInExecuteAction = jest.fn(async (..._a: LinkedInExecuteArgs) => ({
  success: true,
  platform_id: 'urn:li:comment:(123,456)',
  platform_response: { data: { id: 'urn:li:comment:(123,456)' } },
}));

jest.mock('../../services/platformConnectors/linkedinConnector', () => ({
  executeAction: (...args: LinkedInExecuteArgs) => mockLinkedInExecuteAction(...args),
}));

import { executeAction as realExecuteAction } from '../../services/communityAiActionExecutor';

/** A person approved exactly this action (approve.ts): store it with its evidence, then execute it. */
const executeAction: typeof realExecuteAction = (action, ...rest) => {
  const stored = withApprovalEvidence({ ...(action as Record<string, any>), status: 'approved' } as never) as any;
  mockDb = createFakeDb({ community_ai_actions: [stored] });
  // SEC3-F3: an external mode needs a held claim; the executor takes it itself (persist: true).
  return realExecuteAction(stored, rest[0], { persist: true, ...(rest[1] || {}) });
};

const baseAction = () => ({
  id: 'action-1',
  tenant_id: 'tenant-1',
  organization_id: 'tenant-1',
  platform: 'linkedin',
  action_type: 'reply' as const,
  target_id: 'urn:li:share:post-1',
  suggested_text: 'thanks!',
  playbook_id: null,
  // D-01 / Prompt 3: every execution needs a persisted human approval of record;
  // executeAction below stores the row with it (withApprovalEvidence).
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

  it('does NOT fall back API → browser when the connector reports an unclassified failure (may have acted)', async () => {
    // Community execution safety contract (supersedes the Phase 2 fallback):
    // connectors fold transport errors and timeouts into `success:false`, so
    // an unclassified connector failure may have reached the platform. It is
    // recorded as 'uncertain' (human review) and never re-routed to the
    // browser, which could post a duplicate. Only a provably-not-acted
    // refusal falls back (see communityExecutionSafety.executor.test.ts).
    mockLinkedInExecuteAction.mockResolvedValueOnce({
      success: false,
      error: 'LINKEDIN_RATE_LIMIT',
    } as any);

    const result = await executeAction(
      { ...baseAction(), execution_mode: 'api' },
      true,
      { source: 'manual', notify: false, webhook: false },
    );

    expect(result.status).toBe('uncertain');
    expect(result.execution_mode).toBe('api');
    expect(result.error).toBe('LINKEDIN_RATE_LIMIT');
    expect(result.response?.fallback_from).toBeUndefined();
    expect((result as any).command_chain).toBeUndefined();
  });

  it('refuses a LinkedIn DM with no resolved thread or recipient (never types into the open thread)', async () => {
    // Previously emitted continue_thread {text, autoSubmit:true} with no
    // thread, sending the message into whatever conversation was open.
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

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('DM_TARGET_UNRESOLVED');
    expect((result as any).command_chain).toBeUndefined();
  });

  // Product decision (2026-10-28): DMs stay blocked without an AUTHORITATIVE
  // person -> thread mapping (backend/services/dmDispatchSafety). The executor
  // refuses BEFORE dispatch (provably not acted, no command chain persisted).
  // buildDmCommandChain is kept as the addressing-shape validator only, so the
  // chain shapes below stay pinned for when an authoritative mapping exists.
  const participantDm = () => ({
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
  });
  const threadUrlDm = () => ({
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
  });

  it.each([
    ['participant-name', participantDm],
    ['resolved thread URL', threadUrlDm],
  ])('a %s LinkedIn DM is REFUSED by the executor (no authoritative mapping) — not acted', async (_label, make) => {
    const result = await executeAction(make() as any, true, { source: 'manual', notify: false, webhook: false });
    expect(result).toMatchObject({
      ok: false, status: 'failed', error: 'DM_RECIPIENT_MAPPING_UNAVAILABLE', execution_mode: 'browser', may_have_acted: false,
    });
    expect((result as any).command_chain).toBeUndefined();
  });

  it('addressing shape (not dispatch authority): participant name -> open_thread + continue_thread', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildDmCommandChain } = require('../../services/communityAiActionExecutorContracts');
    expect(buildDmCommandChain(participantDm())).toEqual([
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

  it('addressing shape (not dispatch authority): thread URL -> open_thread + continue_thread', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildDmCommandChain } = require('../../services/communityAiActionExecutorContracts');
    expect(buildDmCommandChain(threadUrlDm())).toEqual([
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
