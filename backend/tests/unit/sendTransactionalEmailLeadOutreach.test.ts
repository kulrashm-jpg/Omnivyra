/**
 * PI-041-A-O — the `lead_outreach` pass-through provider template.
 *
 * `index.ts` imports `npm:@aws-sdk/client-ses` and `./escape.ts` with a Deno
 * extension, so jest cannot load it — the same constraint the existing
 * sendTransactionalEmailEscape suite records. So this suite splits the proof:
 *
 *   EXECUTED — `escapeHtmlBlock`, the one new transformation, imported from
 *              escape.ts and run against real input.
 *   PINNED   — everything inside index.ts, asserted at source level, including a
 *              per-branch content hash for each of the seven pre-existing
 *              templates so any change to one of them fails this suite.
 *
 * No email is sent, no SES client is constructed, and the production Edge
 * Function is never invoked.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  escapeHtml, escapeHtmlBlock,
} from '../../../supabase/functions/send-transactional-email/escape';

const FN_DIR = path.join(process.cwd(), 'supabase', 'functions', 'send-transactional-email');
const indexSrc = fs.readFileSync(path.join(FN_DIR, 'index.ts'), 'utf8');

/** The `render()` body, where every template branch lives. */
const renderSrc = indexSrc.slice(indexSrc.indexOf('function render(t: Template): Envelope {'));

/** One template's `case` branch, exactly as written. */
function branch(type: string): string {
  const at = renderSrc.indexOf(`case "${type}":`);
  if (at < 0) throw new Error(`no render branch for ${type}`);
  const rest = renderSrc.slice(at + 1);
  const next = rest.search(/\n    case "|\n  \}\n\}/);
  return renderSrc.slice(at, at + 1 + (next < 0 ? rest.length : next));
}
const branchHash = (type: string): string =>
  crypto.createHash('sha256').update(branch(type)).digest('hex').slice(0, 16);

// ── 1. The new transformation, executed ────────────────────────────────────

describe('041-A-O — escapeHtmlBlock renders authored text safely', () => {
  it('ESCAPES THE HTML-SIGNIFICANT CHARACTERS', () => {
    expect(escapeHtmlBlock('a < b > c & d " e \' f'))
      .toBe('a &lt; b &gt; c &amp; d &quot; e &#39; f');
  });

  it('NEUTRALISES MARKUP IN AUTHORED CONTENT', () => {
    const hostile = '<script>alert("x")</script><img src=x onerror=alert(1)>';
    const out = escapeHtmlBlock(hostile);

    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;script&gt;');
    // The real invariant, and the only one worth asserting: the ONLY `<` left in
    // the output is the one this function inserts. The words `onerror=alert(1)`
    // survive as inert TEXT, which is correct — they are harmless once the tag that
    // would have carried them is encoded, and banning the substring would be
    // asserting something false about why this is safe.
    expect(out.replace(/<br>/g, '')).not.toContain('<');
    expect(out.replace(/<br>/g, '')).not.toContain('>');
  });

  it('ESCAPES FIRST, SO A BODY CONTAINING `<br>` STAYS TEXT', () => {
    // The ordering guarantee: an authored `<br>` must appear as text, while a real
    // newline becomes the only genuine break. Escaping after inserting tags would
    // destroy the tags; inserting before escaping would honour the authored one.
    const out = escapeHtmlBlock('literal <br> tag\nreal break');
    expect(out).toBe('literal &lt;br&gt; tag<br>real break');
    expect((out.match(/<br>/g) || [])).toHaveLength(1);
  });

  it('PRESERVES NEWLINES AS LINE BREAKS', () => {
    expect(escapeHtmlBlock('one\ntwo\n\nthree'))
      .toBe('one<br>two<br><br>three');
  });

  it('collapses CRLF to a single break, so Windows text does not double-space', () => {
    expect(escapeHtmlBlock('one\r\ntwo')).toBe('one<br>two');
    expect(escapeHtmlBlock('one\rtwo')).toBe('one<br>two');
  });

  it('changes nothing else about the text', () => {
    const body = 'Hi Ada, about your Series B. 50% faster — naïve café 東京 🚀';
    expect(escapeHtmlBlock(body)).toBe(escapeHtml(body));
  });

  it('is exactly escapeHtml plus line breaks — not a second escaper', () => {
    const body = 'a<b\nc&d';
    expect(escapeHtmlBlock(body)).toBe(escapeHtml(body).replace(/\n/g, '<br>'));
    const escapeSrc = fs.readFileSync(path.join(FN_DIR, 'escape.ts'), 'utf8');
    // It delegates; it does not re-implement the entity table.
    expect(escapeSrc).toMatch(/export function escapeHtmlBlock[\s\S]*?escapeHtml\(value\)/);
    expect((escapeSrc.match(/&amp;/g) || [])).toHaveLength(1);   // one entity table
  });

  it('coerces absent content to the empty string rather than "undefined"', () => {
    expect(escapeHtmlBlock(null)).toBe('');
    expect(escapeHtmlBlock(undefined)).toBe('');
  });
});

// ── 2. lead_outreach is accepted and passes content through ────────────────

describe('041-A-O — the provider accepts lead_outreach', () => {
  it('IS IN THE TEMPLATE UNION AND IN KNOWN_TYPES — the two stay in sync', () => {
    expect(indexSrc).toMatch(/type: "lead_outreach";/);
    expect(indexSrc).toMatch(/"lead_outreach",/);

    // The allowlist is what produced EMAIL_TEMPLATE_NOT_FOUND. Every union member
    // must appear in it, or a declared template is still rejected at the door.
    const union = [...indexSrc.matchAll(/type: "([a-z_]+)";/g)].map((m) => m[1]);
    const known = indexSrc
      .slice(indexSrc.indexOf('const KNOWN_TYPES'), indexSrc.indexOf('const requestedType'));
    for (const t of union) expect(known).toContain(`"${t}"`);
    expect(union).toContain('lead_outreach');
  });

  it('declares exactly the three ratified fields and nothing that could reinterpret content', () => {
    const variant = indexSrc.slice(
      indexSrc.indexOf('type: "lead_outreach";'),
      indexSrc.indexOf('type Envelope'),
    );
    expect(variant).toMatch(/recipientEmail: string;/);
    expect(variant).toMatch(/subject: string;/);
    expect(variant).toMatch(/body: string;/);
    // No personalization, no template id, no layout switch, no CTA.
    for (const ban of [/personalization/i, /templateId/i, /ctaUrl/i, /companyName/i, /layout/i]) {
      expect(variant).not.toMatch(ban);
    }
  });

  it('PASSES RECIPIENT, SUBJECT AND BODY THROUGH UNCHANGED', () => {
    const b = branch('lead_outreach');
    expect(b).toMatch(/to: t\.recipientEmail,/);
    // The subject is the Engine's, verbatim: no template literal, no prefix.
    expect(b).toMatch(/subject: t\.subject,/);
    expect(b).not.toMatch(/subject: `/);
    // The body is escaped for HTML and carried raw in the text part.
    expect(b).toMatch(/html: escapeHtmlBlock\(t\.body\),/);
    expect(b).toMatch(/text: t\.body,/);
  });

  it('DOES NOT WRAP OUTREACH IN A LAYOUT — that would add unauthored content', () => {
    const b = branch('lead_outreach');
    expect(b).not.toMatch(/actionLayout|baseLayout|safeHref/);
    // And it invents nothing when a field is absent: no fallback expressions.
    expect(b).not.toMatch(/\?\?|\|\||t\.subject \?/);
  });

  it('MALFORMED INPUT FAILS CLOSED — nothing is manufactured', () => {
    // The branch has no defaulting, so a missing subject or body cannot become a
    // plausible-looking message. SES itself refuses an empty Destination/Subject,
    // and `render` returns `undefined` for an unknown type, which the allowlist
    // already blocks before this point.
    const b = branch('lead_outreach');
    expect(b).not.toMatch(/'Following up'|"Following up"|placeholder|fallback/i);
    expect(indexSrc).toMatch(/EMAIL_TEMPLATE_NOT_FOUND/);
    expect(indexSrc).toMatch(/if \(!requestedType \|\| !KNOWN_TYPES\.has\(requestedType\)\)/);
  });
});

// ── 3. The SES request ────────────────────────────────────────────────────

describe('041-A-O — the SES request', () => {
  const ses = indexSrc.slice(indexSrc.indexOf('const command = new SendEmailCommand({'));

  it('CARRIES THE PLAIN-TEXT PART, CONDITIONALLY', () => {
    expect(ses).toMatch(/Html: \{ Charset: "UTF-8", Data: envelope\.html \}/);
    expect(ses).toMatch(/envelope\.text === undefined/);
    expect(ses).toMatch(/Text: \{ Charset: "UTF-8", Data: envelope\.text \}/);
  });

  it('IS ADDITIVE — the seven composed templates set no `text`', () => {
    // Each existing branch returns only to/subject/html, so for them the spread
    // contributes nothing and `Body` keeps the shape it had before this change.
    for (const t of ['team_invite', 'team_invite_credentials', 'company_referral',
      'inbound_signup_notice', 'domain_verification_reminder', 'activation_outreach',
      'credit_alert']) {
      expect(branch(t)).not.toMatch(/text:/);
    }
    expect(branch('lead_outreach')).toMatch(/text: t\.body,/);
  });

  it('RETURNS THE SES MessageId WITHOUT INVENTING ONE', () => {
    expect(indexSrc).toMatch(/async function sendViaSES\(envelope: Envelope\): Promise<string \| null>/);
    expect(indexSrc).toMatch(/typeof result\?\.MessageId === "string" \? result\.MessageId : null/);
    expect(indexSrc).toMatch(/JSON\.stringify\(\{ ok: true, messageId \}\)/);
    // `ok` keeps its meaning, so callers that read only `ok` are unaffected.
    expect(indexSrc).not.toMatch(/ok: false/);
  });

  it('the sender remains the single platform-owned SES identity', () => {
    expect(ses).toMatch(/Source: from,/);
    // No per-tenant sender, no sender name, no Reply-To — all out of scope.
    expect(indexSrc).not.toMatch(/ReplyTo|ReturnPath|SourceArn/);
    expect(indexSrc).toMatch(/Deno\.env\.get\("EMAIL_FROM"\)/);
  });
});

// ── 4. The seven existing templates, pinned ───────────────────────────────

describe('041-A-O — every pre-existing template is unchanged', () => {
  // A content hash per render branch. This fails if a subject, a layout call, an
  // interpolation or a single character of an existing template changes — which is
  // the regression that matters, since this function serves seven live emails.
  it.each([
    ['team_invite', 'ea92f06ac61db535'],
    ['team_invite_credentials', 'd63eb8130039aeaf'],
    ['company_referral', '285fcc44dfd92949'],
    ['inbound_signup_notice', '337e1747e81bdcfd'],
    ['domain_verification_reminder', '2c53b92fbc14558b'],
    ['activation_outreach', '2f3a82d6f0d8b239'],
    ['credit_alert', '622246fdc02e239f'],
  ])('%s renders byte-identically', (type, expected) => {
    expect(branchHash(type)).toBe(expected);
  });

  it('the pass-through branch is pinned too', () => {
    expect(branchHash('lead_outreach')).toBe('7e066d3401e98616');
  });

  it('EXACTLY EIGHT TEMPLATES EXIST — one was added, none replaced', () => {
    const cases = [...renderSrc.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]);
    // In the order the switch declares them, so a reordering is also caught.
    expect(cases).toEqual([
      'team_invite', 'company_referral', 'inbound_signup_notice',
      'team_invite_credentials', 'domain_verification_reminder', 'activation_outreach',
      'credit_alert', 'lead_outreach',
    ]);
  });

  it('the shared layout helpers are untouched', () => {
    const helpers = indexSrc.slice(0, indexSrc.indexOf('function render(t: Template)'));
    expect(crypto.createHash('sha256').update(helpers).digest('hex').slice(0, 16))
      .toBe('af40a6ec8842c0ea');
  });
});

// ── 5. Security posture ───────────────────────────────────────────────────

describe('041-A-O — authentication and tenancy are untouched', () => {
  it('the secret-key gate is unchanged and not weakened', () => {
    expect(indexSrc).toMatch(/authorizeServiceCaller/);
    const auth = fs.readFileSync(path.join(FN_DIR, 'auth.ts'), 'utf8');
    expect(crypto.createHash('sha256').update(auth).digest('hex').slice(0, 16))
      .toBe('a54502c49da80106');
  });

  it('NO PROVIDER-SIDE IDEMPOTENCY WAS ADDED, and none is claimed', () => {
    // A-N corrected the record: the key is sent by the transport and discarded
    // here. This workstream did not change that, and must not pretend otherwise.
    expect(indexSrc).not.toMatch(/idempotency/i);
    expect(indexSrc).not.toMatch(/duplicate/i);
  });

  it('no tenant field is consulted for rendering', () => {
    // `companyId` arrives in the payload and is deliberately unused here: tenancy
    // is enforced upstream, where the recipient and the evidence are tenant-bound.
    expect(renderSrc).not.toMatch(/companyId/);
  });

  it('the transport and dispatch side of the contract was NOT modified', () => {
    // Only the provider side of PI-041-A-O was adopted. The Email Engine, and the
    // transport hooks that compose it, depend on tables that are not on main, so
    // the transport and dispatch stay byte-identical to main.
    const sha = (rel: string): string => crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(process.cwd(), rel))).digest('hex').slice(0, 16);
    expect(sha('backend/services/leadOutreachExecution/emailTransport.ts')).toBe('8eae66392cff86a6');
    expect(sha('backend/services/leadOutreachExecution/dispatch.ts')).toBe('3c366bcc862b7bd4');
  });

  it('THE TRANSPORT PAYLOAD MATCHES WHAT THE FUNCTION NOW ACCEPTS', () => {
    // The contract, end to end: what the transport posts is exactly what the
    // pass-through template declares. This is the mismatch A-N identified.
    const transport = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/leadOutreachExecution/emailTransport.ts'), 'utf8');
    expect(transport).toMatch(/type: 'lead_outreach'/);
    expect(transport).toMatch(/recipientEmail: request\.to/);
    expect(transport).toMatch(/subject,/);
    expect(transport).toMatch(/body,/);
  });

  it('the email egress flag is untouched and still OFF by default', () => {
    const t = fs.readFileSync(
      path.join(process.cwd(), 'backend/services/leadOutreachExecution/emailTransport.ts'), 'utf8');
    // Anything other than an explicit `true` keeps the transport inert.
    expect(t).toMatch(/String\(process\.env\[EMAIL_ENABLED_ENV\] \?\? ''\)\.toLowerCase\(\) === 'true'/);
    expect(indexSrc).not.toMatch(/LEAD_OUTREACH_EMAIL_ENABLED/);
  });
});
