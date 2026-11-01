/**
 * PI-041-A — EMAIL SEND BOUNDARY, T1 BEHAVIOURAL.
 *
 * The companion to the source-text suite. Here the extended transport is actually
 * RUN against a recording fake provider, so the ordering, the refusals and the
 * byte-for-byte correspondence between evidence and payload are observed rather
 * than read off the file. No network, no provider SDK, no SES, no Edge Function:
 * the provider is the injectable port the transport has always taken.
 */
process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `k1:${'s'.repeat(64)}`; // main's WP3 refuses a send with no unsubscribe link
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
import { createEmailTransport, EMAIL_ENABLED_ENV, type EmailProviderRequest, type EmailProviderResponse, type EmailProviderPort } from '../../services/leadOutreachExecution/emailTransport';
import type { TransportRequest } from '../../services/leadOutreachExecution/transport';
import type { OutreachTask } from '../../services/leadOutreachExecution/types';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ATTEMPT = '00000000-0000-4000-8000-0000000000bb';

const task = (over: Partial<OutreachTask> = {}): OutreachTask => ({
  id: '00000000-0000-4000-8000-0000000000cc',
  companyId: ORG,
  leadId: 'lead-key-1',
  planTaskId: 'task-1-intro',
  personId: '00000000-0000-4000-8000-0000000000dd',
  taskOrder: 1,
  kind: 'outreach',
  action: 'PLACEHOLDER ACTION',
  channel: 'email',
  dependsOnPlanTaskId: null,
  estimatedDelayHours: 0,
  confidence: null,
  explanation: 'PLACEHOLDER EXPLANATION',
  status: 'pending',
  deliveryStatus: null,
  requiresApproval: false,
  plannerVersion: 'p', translationVersion: 't', governanceVersion: 'g',
  executionRuntimeVersion: 'r', materializedAt: '2026-10-04T00:00:00.000Z',
  createdAt: null, updatedAt: null,
  ...over,
} as OutreachTask);

const req = (over: Partial<TransportRequest> = {}): TransportRequest => ({
  task: task(),
  attemptId: ATTEMPT,
  attemptNumber: 1,
  idempotencyKey: 'idem-1',
  recipient: 'ada@example.com',
  at: '2026-10-04T00:00:00.000Z',
  ...over,
});

/** Records what it was handed, and in what order relative to the evidence. */
const recordingProvider = (
  log: string[],
  response: Partial<EmailProviderResponse> = {},
): EmailProviderPort & { seen: EmailProviderRequest[] } => {
  const seen: EmailProviderRequest[] = [];
  return {
    name: 'fake_provider',
    seen,
    async send(r: EmailProviderRequest): Promise<EmailProviderResponse> {
      log.push('provider');
      seen.push(r);
      return { accepted: true, messageId: 'pm-1', ...response };
    },
  };
};

const CONTENT = {
  subject: 'About your Series B',
  body: 'Hi Ada, about your Series B.\n\nWorth a conversation?',
  personalizationInputs: { first_name: 'Ada' },
  contentSource: 'workflow_instruction:email-deterministic-1.0.0',
};

const enabled = () => true;

describe('041-A behavioural — authored content reaches the provider', () => {
  it('HANDS THE PROVIDER EXACTLY THE RENDERED STRINGS, not the placeholders', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled, content: async () => CONTENT, recordContent: async () => { log.push('evidence'); },
    });

    const result = await transport.send(req());

    expect(result.outcome).toBe('accepted');
    expect(provider.seen).toHaveLength(1);
    expect(provider.seen[0].subject).toBe(CONTENT.subject);
    expect(provider.seen[0].body).toBe(CONTENT.body);
    // The placeholder derivation is gone, not merely supplemented.
    expect(provider.seen[0].subject).not.toContain('PLACEHOLDER');
    expect(provider.seen[0].body).not.toContain('PLACEHOLDER');
  });

  it('RECORDS THE EVIDENCE BEFORE CALLING THE PROVIDER', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled, content: async () => { log.push('render'); return CONTENT; },
      recordContent: async () => { log.push('evidence'); },
    });

    await transport.send(req());

    expect(log).toEqual(['render', 'evidence', 'provider']);
  });

  it('the evidence it records IS the payload, field for field', async () => {
    const seenEvidence: Array<Record<string, unknown>> = [];
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled,
      content: async () => CONTENT,
      recordContent: async (e) => { seenEvidence.push(e as unknown as Record<string, unknown>); },
    });

    await transport.send(req());

    expect(seenEvidence).toHaveLength(1);
    expect(seenEvidence[0]).toEqual({
      organizationId: ORG,
      outreachAttemptId: ATTEMPT,
      renderedSubject: CONTENT.subject,
      renderedBody: CONTENT.body,
      personalizationInputs: CONTENT.personalizationInputs,
      contentSource: CONTENT.contentSource,
    });
    expect(provider.seen[0].subject).toBe(seenEvidence[0].renderedSubject);
    expect(provider.seen[0].body).toBe(seenEvidence[0].renderedBody);
  });
});

describe('041-A behavioural — the refusals', () => {
  it('AN UNRENDERABLE TASK IS NEVER SENT, and never placeheld', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled,
      content: async () => { throw new Error('this workflow step authored no email instruction'); },
      recordContent: async () => { log.push('evidence'); },
    });

    const result = await transport.send(req());

    expect(result.outcome).toBe('rejected');
    expect(result.response).toEqual({ reason: 'content_unavailable' });
    expect(result.error).toContain('authored no email instruction');
    // The provider was never reached, and nothing was recorded as sent.
    expect(log).toEqual([]);
    expect(provider.seen).toEqual([]);
  });

  it('AN UNRECORDABLE SEND IS NEVER SENT', async () => {
    // Losing a send is recoverable. An email a real person received that the
    // platform cannot describe is not.
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled, content: async () => CONTENT,
      recordContent: async () => { throw new Error('that attempt already has content evidence'); },
    });

    const result = await transport.send(req());

    expect(result.outcome).toBe('rejected');
    expect(result.response).toEqual({ reason: 'content_evidence_unrecorded' });
    expect(result.error).toContain('content evidence could not be recorded');
    expect(provider.seen).toEqual([]);
    expect(log).toEqual([]);
  });

  it('the flag gate still precedes EVERYTHING, hooks included', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled: () => false,
      content: async () => { log.push('render'); return CONTENT; },
      recordContent: async () => { log.push('evidence'); },
    });

    const result = await transport.send(req());

    expect(result.outcome).toBe('disabled');
    expect(result.error).toContain(EMAIL_ENABLED_ENV);
    // No render, no evidence, no provider: a disabled transport does nothing.
    expect(log).toEqual([]);
    expect(provider.seen).toEqual([]);
  });

  it('an unusable recipient refuses BEFORE rendering', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled, content: async () => { log.push('render'); return CONTENT; },
      recordContent: async () => { log.push('evidence'); },
    });

    for (const recipient of [null, '', 'not-an-address']) {
      const result = await transport.send(req({ recipient }));
      expect(result.outcome).toBe('rejected');
      expect(result.response).toEqual({ reason: 'invalid_recipient' });
    }
    expect(log).toEqual([]);
    expect(provider.seen).toEqual([]);
  });

  it('NO ATTEMPT MEANS NO SEND — the unsubscribe link is minted per attempt (main WP3 / L5)', async () => {
    // Ported note: the parked transport still sent here. Main's unsubscribe requirement
    // is newer and stricter, so nothing reaches the provider and nothing is recorded.
    const log: string[] = [];
    const provider = recordingProvider(log);
    const transport = createEmailTransport(provider, {
      enabled, content: async () => CONTENT,
      recordContent: async () => { log.push('evidence'); },
    });

    const result = await transport.send(req({ attemptId: null }));

    expect(result.outcome).toBe('rejected');
    expect(log).toEqual([]);
  });

  it('every refusal obeys the contract: it RETURNS, it does not throw', async () => {
    const log: string[] = [];
    const transport = createEmailTransport(recordingProvider(log), {
      enabled,
      content: async () => { throw new Error('boom'); },
    });
    await expect(transport.send(req())).resolves.toMatchObject({ outcome: 'rejected' });
  });
});

describe('041-A behavioural — pre-041-A behaviour is preserved exactly', () => {
  it('WITHOUT HOOKS the placeholder derivation is unchanged', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const result = await createEmailTransport(provider, { enabled }).send(req());

    expect(result.outcome).toBe('accepted');
    expect(result.deliveryStatus).toBe('sent_unverified');   // acceptance is not delivery
    expect(provider.seen[0].subject).toBe('PLACEHOLDER ACTION');
    expect(provider.seen[0].body).toBe('PLACEHOLDER EXPLANATION');
  });

  it('without hooks, an actionless task still falls back as it always did', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    await createEmailTransport(provider, { enabled })
      .send(req({ task: task({ action: null, explanation: null }) }));
    expect(provider.seen[0].subject).toBe('Following up');
    expect(provider.seen[0].body).toBe('Following up');
  });

  it('WITH a content hook but no recorder, nothing is recorded and the send proceeds', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    const result = await createEmailTransport(provider, { enabled, content: async () => CONTENT })
      .send(req());
    expect(result.outcome).toBe('accepted');
    expect(provider.seen[0].subject).toBe(CONTENT.subject);
  });

  it('provider rejection, timeout and error are classified as before', async () => {
    const log: string[] = [];

    const rejected = await createEmailTransport(
      { name: 'fake', async send() { return { accepted: false, messageId: null, rejectionReason: 'suppressed by provider' }; } },
      { enabled, content: async () => CONTENT, recordContent: async () => undefined },
    ).send(req());
    expect(rejected.outcome).toBe('rejected');
    expect(rejected.error).toBe('suppressed by provider');

    const errored = await createEmailTransport(
      { name: 'fake', async send() { throw new Error('socket hang up'); } },
      { enabled, content: async () => CONTENT, recordContent: async () => undefined },
    ).send(req());
    expect(errored.outcome).toBe('provider_error');
    expect(errored.error).toContain('socket hang up');

    const timed = await createEmailTransport(
      { name: 'fake', send: () => new Promise<EmailProviderResponse>(() => undefined) },
      { enabled, timeoutMs: 20, content: async () => CONTENT, recordContent: async () => undefined },
    ).send(req());
    expect(timed.outcome).toBe('timeout');
    expect(timed.response).toMatchObject({ reason: 'provider_timeout' });

    expect(log).toEqual([]);
  });

  it('a provider-recognised duplicate is still reported as one', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log, { duplicate: true });
    const result = await createEmailTransport(provider, {
      enabled, content: async () => CONTENT, recordContent: async () => undefined,
    }).send(req());
    expect(result.duplicate).toBe(true);
    // The key came from the request; this transport never minted one.
    expect(provider.seen[0].idempotencyKey).toBe('idem-1');
  });
});

describe('041-A behavioural — content never leaks into the response', () => {
  it('the recorded transport response carries NO subject or body', async () => {
    const log: string[] = [];
    const provider = recordingProvider(log, { raw: { messageId: 'pm-1' } });
    const result = await createEmailTransport(provider, {
      enabled, content: async () => CONTENT, recordContent: async () => undefined,
    }).send(req());

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CONTENT.subject);
    expect(serialized).not.toContain('Hi Ada');
    expect(serialized).not.toContain('Ada');
    // Which is the whole point of the content-free `response` contract.
    expect(result.response).toEqual({ accepted: true, messageId: 'pm-1' });
  });
});
