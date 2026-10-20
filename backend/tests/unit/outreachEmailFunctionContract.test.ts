/**
 * WP1 — the outreach transport ↔ `send-transactional-email` contract.
 *
 * Every other suite on this path injects a fake `EmailProviderPort`, so none of
 * them could see that the REAL default provider posted a template type the REAL
 * Edge Function rejected with EMAIL_TEMPLATE_NOT_FOUND. This suite closes that:
 *
 *   EXECUTED — the real `supabaseEdgeEmailProvider` and `createEmailTransport`,
 *              with only the Supabase client stubbed, so the payload asserted
 *              below is the payload production would post.
 *   PARSED   — the Edge Function's own `KNOWN_TYPES`, `Template` union, render
 *              branches and success response, read from index.ts (jest cannot
 *              load it: it imports `npm:` specifiers and calls `Deno.serve`).
 *
 * If the allowlist and the transport diverge in either direction — a type the
 * function does not accept, a field the variant does not declare, or a response
 * key the callers do not read — this suite fails. No email is sent and the
 * production function is never invoked.
 */
import fs from 'fs';
import path from 'path';

const invocations: Array<{ fn: string; body: Record<string, unknown> }> = [];
let functionResponse: { data?: unknown; error?: { message?: string } } = {};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    functions: {
      invoke: async (fn: string, opts: { body: Record<string, unknown> }) => {
        invocations.push({ fn, body: opts.body });
        return functionResponse;
      },
    },
  },
}));

import {
  createEmailTransport,
  supabaseEdgeEmailProvider,
} from '../../services/leadOutreachExecution/emailTransport';

const ROOT = process.cwd();
const indexSrc = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'send-transactional-email', 'index.ts'), 'utf8');

/** The literal entries of the function's `KNOWN_TYPES` allowlist. */
const knownTypes = (): string[] => {
  const start = indexSrc.indexOf('const KNOWN_TYPES');
  const end = indexSrc.indexOf('const requestedType', start);
  if (start < 0 || end < 0) throw new Error('KNOWN_TYPES allowlist not found in index.ts');
  return [...indexSrc.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
};

/** The `type:` discriminants of the function's `Template` union. */
const unionTypes = (): string[] => {
  const union = indexSrc.slice(indexSrc.indexOf('type Template ='), indexSrc.indexOf('type Envelope'));
  return [...union.matchAll(/type: "([a-z_]+)";/g)].map((m) => m[1]);
};

/** The declared fields of one `Template` variant, excluding `type`. */
const variantFields = (type: string): string[] => {
  const union = indexSrc.slice(indexSrc.indexOf('type Template ='), indexSrc.indexOf('type Envelope'));
  const at = union.indexOf(`type: "${type}";`);
  if (at < 0) return [];
  const close = union.indexOf('}', at);
  return [...union.slice(at, close).matchAll(/^\s+([a-zA-Z]+):/gm)]
    .map((m) => m[1]).filter((f) => f !== 'type');
};

const renderSrc = indexSrc.slice(indexSrc.indexOf('function render(t: Template): Envelope {'));

const task = {
  id: 'task-1', companyId: 'co-a', leadId: 'L1', channel: 'email',
  action: 'Intro', explanation: 'Hello there',
} as never;

const request = {
  task, attemptId: 'att-1', attemptNumber: 1, idempotencyKey: 'ws3-key',
  recipient: 'person@example.test', at: '2026-10-20T00:00:00.000Z',
};

beforeEach(() => {
  invocations.length = 0;
  functionResponse = { data: { ok: true, messageId: 'ses-msg-1' }, error: undefined };
});

describe('WP1 — what the real outreach provider posts is what the real function accepts', () => {
  it('invokes the send-transactional-email function', async () => {
    await supabaseEdgeEmailProvider.send({
      to: 'person@example.test', idempotencyKey: 'k', companyId: 'co-a', subject: 's', body: 'b',
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0].fn).toBe('send-transactional-email');
  });

  it('THE POSTED TYPE IS IN KNOWN_TYPES — else the function answers EMAIL_TEMPLATE_NOT_FOUND', async () => {
    await supabaseEdgeEmailProvider.send({
      to: 'person@example.test', idempotencyKey: 'k', companyId: 'co-a', subject: 's', body: 'b',
    });
    const posted = String(invocations[0].body.type);
    expect(knownTypes()).toContain(posted);
  });

  it('the posted type is a declared Template variant with its own render branch', async () => {
    await supabaseEdgeEmailProvider.send({
      to: 'person@example.test', idempotencyKey: 'k', companyId: 'co-a', subject: 's', body: 'b',
    });
    const posted = String(invocations[0].body.type);
    expect(unionTypes()).toContain(posted);
    expect(renderSrc).toContain(`case "${posted}":`);
  });

  it('every field the variant declares is supplied by the transport', async () => {
    await supabaseEdgeEmailProvider.send({
      to: 'person@example.test', idempotencyKey: 'k', companyId: 'co-a', subject: 's', body: 'b',
    });
    const body = invocations[0].body;
    const fields = variantFields(String(body.type));
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(typeof body[f]).toBe('string');
      expect(String(body[f]).length).toBeGreaterThan(0);
    }
  });

  it('the allowlist and the union stay in sync in both directions', () => {
    expect([...knownTypes()].sort()).toEqual([...unionTypes()].sort());
  });
});

describe('WP1 — the SES message id survives the round trip', () => {
  it('the function emits the id under the key the outreach provider reads', () => {
    expect(indexSrc).toMatch(/JSON\.stringify\(\{ ok: true, messageId \}\)/);
  });

  it('the provider returns the id the function sent back', async () => {
    const res = await supabaseEdgeEmailProvider.send({
      to: 'person@example.test', idempotencyKey: 'k', companyId: 'co-a', subject: 's', body: 'b',
    });
    expect(res).toMatchObject({ accepted: true, messageId: 'ses-msg-1' });
  });

  it('the transport carries it to providerMessageId, which dispatch persists', async () => {
    const transport = createEmailTransport(undefined, { enabled: () => true });
    const result = await transport.send(request);
    expect(result.outcome).toBe('accepted');
    expect(result.providerMessageId).toBe('ses-msg-1');
    expect(result.deliveryStatus).toBe('sent_unverified');
  });

  it('a null id from SES stays null — nothing is manufactured', async () => {
    functionResponse = { data: { ok: true, messageId: null }, error: undefined };
    const transport = createEmailTransport(undefined, { enabled: () => true });
    const result = await transport.send(request);
    expect(result.providerMessageId).toBeNull();
  });

  it('the email_jobs cron reads the same key, not the old message_id', () => {
    const cron = fs.readFileSync(path.join(ROOT, 'pages', 'api', 'cron', 'email-jobs.ts'), 'utf8');
    expect(cron).toMatch(/\)\.messageId/);
    // A property READ of the snake_case key; `p_provider_message_id` (the RPC
    // parameter the id is persisted through) is correct and stays.
    expect(cron).not.toMatch(/\.message_id\b|'message_id' in/);
  });
});

describe('WP1 — the send-disable control is untouched', () => {
  it('with LEAD_OUTREACH_EMAIL_ENABLED unset, the real transport never invokes the function', async () => {
    const prior = process.env.LEAD_OUTREACH_EMAIL_ENABLED;
    delete process.env.LEAD_OUTREACH_EMAIL_ENABLED;
    try {
      const result = await createEmailTransport().send(request);
      expect(result.outcome).toBe('disabled');
      expect(invocations).toHaveLength(0);
    } finally {
      if (prior !== undefined) process.env.LEAD_OUTREACH_EMAIL_ENABLED = prior;
    }
  });
});
