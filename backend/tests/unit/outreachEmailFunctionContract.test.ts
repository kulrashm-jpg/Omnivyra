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
import { verifyOutreachUnsubscribeToken } from '../../security/outreachUnsubscribeToken';
import {
  MAX_HEADER_VALUE_LENGTH,
  listUnsubscribeHeaders,
  unsubscribeTextFooter,
  validateUnsubscribeUrl,
} from '../../../supabase/functions/send-transactional-email/unsubscribe';

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

/** A provider request as the transport builds it (WP3: with its unsubscribe link). */
const PROVIDER_REQUEST = {
  to: 'person@example.test', idempotencyKey: 'k', companyId: 'co-a', subject: 's', body: 'b',
  unsubscribeUrl: 'https://app.example.test/api/outreach/unsubscribe?t=u1.k1.AAAA.BBBB',
};

const request = {
  task, attemptId: 'att-1', attemptNumber: 1, idempotencyKey: 'ws3-key',
  recipient: 'person@example.test', at: '2026-10-20T00:00:00.000Z',
};

// WP3 / L5 — the transport mints a signed unsubscribe link per attempt; it
// refuses to send without a key and an https origin. Restored after the suite:
// suites share one process.env under --runInBand.
const priorEnv = { keys: process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS, appUrl: process.env.NEXT_PUBLIC_APP_URL };
const restore = (name: string, value: string | undefined) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

beforeEach(() => {
  invocations.length = 0;
  functionResponse = { data: { ok: true, messageId: 'ses-msg-1' }, error: undefined };
  process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS = `c1:${'c'.repeat(40)}`;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
});

afterAll(() => {
  restore('OUTREACH_UNSUBSCRIBE_TOKEN_KEYS', priorEnv.keys);
  restore('NEXT_PUBLIC_APP_URL', priorEnv.appUrl);
});

describe('WP1 — what the real outreach provider posts is what the real function accepts', () => {
  it('invokes the send-transactional-email function', async () => {
    await supabaseEdgeEmailProvider.send(PROVIDER_REQUEST);
    expect(invocations).toHaveLength(1);
    expect(invocations[0].fn).toBe('send-transactional-email');
  });

  it('THE POSTED TYPE IS IN KNOWN_TYPES — else the function answers EMAIL_TEMPLATE_NOT_FOUND', async () => {
    await supabaseEdgeEmailProvider.send(PROVIDER_REQUEST);
    const posted = String(invocations[0].body.type);
    expect(knownTypes()).toContain(posted);
  });

  it('the posted type is a declared Template variant with its own render branch', async () => {
    await supabaseEdgeEmailProvider.send(PROVIDER_REQUEST);
    const posted = String(invocations[0].body.type);
    expect(unionTypes()).toContain(posted);
    expect(renderSrc).toContain(`case "${posted}":`);
  });

  it('every field the variant declares is supplied by the transport', async () => {
    // Through the REAL transport, so the fields it builds (WP3: the unsubscribe
    // link) are the ones checked — not a hand-written request.
    await createEmailTransport(undefined, { enabled: () => true }).send(request);
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
    const res = await supabaseEdgeEmailProvider.send(PROVIDER_REQUEST);
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

// ── WP3 / L5 — unsubscribe link and headers ────────────────────────────────

describe('WP3/L5 — the link the transport mints is the link the function accepts', () => {
  const FN_URL = 'https://app.example.test';

  it("the transport posts a signed unsubscribe URL that passes the FUNCTION's own validator", async () => {
    await createEmailTransport(undefined, { enabled: () => true }).send(request);
    const posted = String(invocations[0].body.unsubscribeUrl);
    // Executed, not pattern-matched: the Edge Function's real allow-list.
    expect(validateUnsubscribeUrl(posted, FN_URL)).toBe(posted);
    // The address is not in the URL in any form.
    expect(posted).not.toMatch(/person|%40|@/);
  });

  it('the token in that URL verifies and names this attempt, tenant and recipient', async () => {
    await createEmailTransport(undefined, { enabled: () => true }).send(request);
    const token = new URL(String(invocations[0].body.unsubscribeUrl)).searchParams.get('t');
    expect(verifyOutreachUnsubscribeToken(token).payload).toMatchObject({
      organizationId: 'co-a', attemptId: 'att-1', recipient: 'person@example.test', scope: '*',
    });
  });

  it.each([
    ['no key configured', () => { delete process.env.OUTREACH_UNSUBSCRIBE_TOKEN_KEYS; }, request],
    ['a non-https public origin', () => { process.env.NEXT_PUBLIC_APP_URL = 'http://app.example.test'; }, request],
    ['no attempt to bind the link to', () => {}, { ...request, attemptId: null }],
  ])('REFUSES to send with %s — the function is never invoked', async (_label, arrange, req) => {
    (arrange as () => void)();
    const result = await createEmailTransport(undefined, { enabled: () => true }).send(req as never);
    expect(result.outcome).toBe('rejected');
    expect(result.response).toMatchObject({ reason: 'unsubscribe_link_unavailable' });
    expect(invocations).toHaveLength(0);
  });
});

describe('WP3/L5 — the function allow-lists the link (executed)', () => {
  const APP = 'https://app.omnivyra.com';
  const good = `${APP}/api/outreach/unsubscribe?t=u1.k1.AbC-_9.XyZ`;

  it('accepts exactly the expected shape', () => {
    expect(validateUnsubscribeUrl(good, APP)).toBe(good);
  });

  it.each([
    ['another origin', 'https://evil.example/api/outreach/unsubscribe?t=u1.k1.A.B'],
    ['http', 'http://app.omnivyra.com/api/outreach/unsubscribe?t=u1.k1.A.B'],
    ['another path', `${APP}/api/other?t=u1.k1.A.B`],
    ['an extra parameter', `${APP}/api/outreach/unsubscribe?t=u1.k1.A.B&redirect=x`],
    ['no token', `${APP}/api/outreach/unsubscribe`],
    ['token with illegal characters', `${APP}/api/outreach/unsubscribe?t=a%0d%0aBcc:x`],
    ['credentials', 'https://u:p@app.omnivyra.com/api/outreach/unsubscribe?t=u1.k1.A.B'],
    ['a fragment', `${good}#x`],
    ['too long for the header', `${APP}/api/outreach/unsubscribe?t=${'A'.repeat(990)}`],
    ['not a string', 42],
  ])('refuses %s', (_label, value) => {
    expect(validateUnsubscribeUrl(value, APP)).toBeNull();
  });

  it('builds RFC 2369 + RFC 8058 headers within SES limits', () => {
    const headers = listUnsubscribeHeaders(good);
    expect(headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<${good}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ]);
    for (const h of headers) {
      expect(h.Name).toMatch(/^[!-9;-@A-~]+$/);         // SES MessageHeader.Name pattern
      expect(h.Value).toMatch(/^[ -~]*$/);              // printable ASCII
      expect(h.Value.length).toBeLessThanOrEqual(MAX_HEADER_VALUE_LENGTH);
      expect(h.Name.length + h.Value.length).toBeLessThanOrEqual(996);
    }
  });

  it('the text footer comes AFTER the body and names the link', () => {
    const footer = unsubscribeTextFooter(good);
    expect(footer.startsWith('\n\n')).toBe(true);
    expect(footer).toContain(good);
  });
});

describe('WP3/L5 — the send path (source contract)', () => {
  const v2 = indexSrc.slice(indexSrc.indexOf('async function sendOutreachViaSESv2'));

  it('lead_outreach goes through SES v2 with headers and a REQUIRED configuration set', () => {
    expect(indexSrc).toMatch(/import \{ SESv2Client, SendEmailCommand as SendEmailV2Command \} from "npm:@aws-sdk\/client-sesv2@3\.658\.1";/);
    expect(v2).toMatch(/ConfigurationSetName: configurationSet,/);
    expect(v2).toMatch(/Headers: envelope\.headers,/);
    expect(v2).toMatch(/if \(!configurationSet\) throw new Error\("SES_CONFIGURATION_SET_MISSING"\);/);
  });

  it('only lead_outreach is routed to v2; the seven composed templates keep the v1 path', () => {
    expect(indexSrc).toMatch(/requestedType === "lead_outreach"\s*\n\s*\? await sendOutreachViaSESv2\(envelope\)\s*\n\s*: await sendViaSES\(envelope\);/);
  });

  it('the link is validated BEFORE render and before SES', () => {
    const validateAt = indexSrc.indexOf('invalidLeadOutreach(body');
    const renderAt = indexSrc.indexOf('render(body)');
    expect(validateAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(validateAt);
    expect(indexSrc).toMatch(/validateUnsubscribeUrl\(t\.unsubscribeUrl, getAppUrl\(\)\)/);
  });
});
