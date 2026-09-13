/**
 * send-transactional-email — HTML output encoding (K4).
 *
 * The Edge Function renders caller-supplied JSON (company names, admin names,
 * e-mail addresses, domains, roles, temporary passwords, CTA URLs) into HTML
 * e-mail. Pins:
 *   1. escapeHtml encodes & < > " ' and coerces null/undefined/numbers safely.
 *   2. safeHref allow-lists https: (and mailto: only on request) and returns
 *      "#" for everything else — javascript:, data:, vbscript:, http:,
 *      relative, protocol-relative, mixed-case and whitespace/control-char
 *      disguised schemes — and encodes the result for a quoted attribute.
 *   3. index.ts routes every caller-supplied interpolation through the
 *      helpers (index.ts imports Deno/npm: modules, so wiring is asserted at
 *      source level; escape.ts itself is exercised directly).
 */
import fs from 'fs';
import path from 'path';

import {
  escapeHtml,
  safeHref,
  SAFE_HREF_FALLBACK,
} from '../../../supabase/functions/send-transactional-email/escape';

const FN_DIR = path.join(process.cwd(), 'supabase', 'functions', 'send-transactional-email');
const indexSrc = fs.readFileSync(path.join(FN_DIR, 'index.ts'), 'utf8');

describe('escapeHtml', () => {
  it('encodes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
  });

  it('encodes & first so existing entities cannot be smuggled through', () => {
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });

  it('cannot break out of a quoted attribute', () => {
    expect(escapeHtml('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
    expect(escapeHtml("' onclick='x")).toBe('&#39; onclick=&#39;x');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Acme Corp — admin@acme.com')).toBe('Acme Corp — admin@acme.com');
  });

  it('coerces null/undefined to the empty string and numbers via String()', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(87.5)).toBe('87.5');
    expect(escapeHtml(false)).toBe('false');
  });
});

describe('safeHref', () => {
  it('allows absolute https URLs and encodes them for a quoted attribute', () => {
    expect(safeHref('https://omnivyra.com/invite/abc')).toBe('https://omnivyra.com/invite/abc');
    expect(safeHref('https://omnivyra.com/login?email=a%40b.com&x=1')).toBe(
      'https://omnivyra.com/login?email=a%40b.com&amp;x=1',
    );
    expect(safeHref('https://omnivyra.com/?q="><script>')).toBe(
      'https://omnivyra.com/?q=&quot;&gt;&lt;script&gt;',
    );
  });

  it('accepts an upper/mixed-case https scheme and trims surrounding whitespace', () => {
    expect(safeHref('HTTPS://omnivyra.com/x')).toBe('HTTPS://omnivyra.com/x');
    expect(safeHref('  https://omnivyra.com/x  ')).toBe('https://omnivyra.com/x');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['mixed-case javascript:', 'JaVaScRiPt:alert(1)'],
    ['whitespace-prefixed javascript:', '  javascript:alert(1)'],
    ['newline-prefixed javascript:', '\njavascript:alert(1)'],
    ['tab inside the scheme', 'java\tscript:alert(1)'],
    ['NUL inside the scheme', 'java\u0000script:alert(1)'],
    ['entity-encoded scheme', '&#106;avascript:alert(1)'],
    ['data:', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['http:', 'http://omnivyra.com/invite/abc'],
    ['relative path', '/login'],
    ['protocol-relative', '//evil.example/phish'],
    ['bare host', 'omnivyra.com/invite'],
    ['https without a host', 'https://'],
    ['mailto: when not allowed', 'mailto:a@b.com'],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('rejects %s', (_label, url) => {
    expect(safeHref(url)).toBe(SAFE_HREF_FALLBACK);
  });

  it.each([[null], [undefined], [42], [{ href: 'https://x.com' }]])('rejects non-string %p', (value) => {
    expect(safeHref(value)).toBe(SAFE_HREF_FALLBACK);
  });

  it('allows mailto: only when asked, and encodes it', () => {
    expect(safeHref('mailto:support@omnivyra.com', { allowMailto: true })).toBe('mailto:support@omnivyra.com');
    expect(safeHref('MAILTO:support@omnivyra.com', { allowMailto: true })).toBe('MAILTO:support@omnivyra.com');
    expect(safeHref(`mailto:a@b.com"><script>`, { allowMailto: true })).toBe(
      'mailto:a@b.com&quot;&gt;&lt;script&gt;',
    );
  });

  it('still rejects non-allow-listed schemes when mailto is allowed', () => {
    expect(safeHref('javascript:alert(1)', { allowMailto: true })).toBe(SAFE_HREF_FALLBACK);
    expect(safeHref('data:text/html,x', { allowMailto: true })).toBe(SAFE_HREF_FALLBACK);
  });

  it('the fallback is itself inert', () => {
    expect(SAFE_HREF_FALLBACK).toBe('#');
  });
});

describe('escape.ts stays importable by both Deno and jest', () => {
  const escapeSrc = fs.readFileSync(path.join(FN_DIR, 'escape.ts'), 'utf8');

  it('uses no Deno globals and has no imports', () => {
    expect(escapeSrc).not.toMatch(/\bDeno\./);
    expect(escapeSrc).not.toMatch(/^\s*import\s/m);
  });

  it('contains no raw control bytes', () => {
    // eslint-disable-next-line no-control-regex
    expect(escapeSrc).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  });
});

describe('index.ts wiring — every caller value goes through the helpers', () => {
  it('imports the helpers with the Deno-required .ts extension', () => {
    expect(indexSrc).toContain('import { escapeHtml, safeHref } from "./escape.ts";');
  });

  it('leaves no raw ${t.<field>} interpolation outside plain-text subject lines', () => {
    const raw = indexSrc
      .split('\n')
      .filter((line) => /\$\{t\./.test(line))
      .filter((line) => !/^\s*subject:\s*`/.test(line));
    expect(raw).toEqual([]);
  });

  it.each([
    'companyName',
    'prospectEmail',
    'fullName',
    'role',
    'recipientEmail',
    'temporaryPassword',
    'finalDomain',
    'consumedPercent',
  ])('renders t.%s only through escapeHtml', (field) => {
    expect(indexSrc).toContain(`\${escapeHtml(t.${field})}`);
  });

  it('escapes the admin display name, milestones and localized numbers', () => {
    expect(indexSrc).toContain('<strong>${escapeHtml(who)}</strong>');
    expect(indexSrc).toContain('`&bull;&nbsp;${escapeHtml(m)}`');
    expect(indexSrc).toContain('${escapeHtml(t.remainingCredits.toLocaleString())}');
    expect(indexSrc).toContain('${escapeHtml(t.projectedRequiredCredits.toLocaleString())}');
  });

  it('routes the CTA href (inviteUrl/ctaUrl/dashboardUrl/loginUrl) through safeHref', () => {
    expect(indexSrc).toContain('<a href="${safeHref(ctaUrl)}"');
    expect(indexSrc).toContain('${escapeHtml(title)}');
    expect(indexSrc).toContain('${escapeHtml(ctaLabel)}');
  });

  it('routes every mailto: link through safeHref(..., { allowMailto: true }) and escapes its text', () => {
    expect(indexSrc).toContain(
      'safeHref(typeof address === "string" ? `mailto:${address}` : null, { allowMailto: true })',
    );
    expect(indexSrc).toContain('`<a href="${href}">${escapeHtml(address)}</a>`');
    expect(indexSrc).toContain('mailtoLink(t.admin.email)');
    expect(indexSrc.match(/mailtoLink\(t\.supportEmail\)/g)).toHaveLength(2);
    // The only mailto: construction is the one inside mailtoLink.
    expect(indexSrc.match(/mailto:\$\{/g)).toHaveLength(1);
  });

  it('every href attribute is produced by safeHref', () => {
    const hrefs = indexSrc.match(/href="[^"]*"/g) ?? [];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      expect(h === 'href="${safeHref(ctaUrl)}"' || h === 'href="${href}"').toBe(true);
    }
  });

  it('keeps the template markup and wording intact', () => {
    expect(indexSrc).toContain('subject: "You have been invited to Omnivyra"');
    expect(indexSrc).toContain('`Your sign-in details:<br/>`');
    expect(indexSrc).toContain('<code style="background:#f1f4f8;padding:4px 8px;border-radius:4px">');
    expect(indexSrc).toContain('subject: `Low credits — ${t.consumedPercent}% consumed`');
  });

  it('still authorizes the caller before rendering', () => {
    expect(indexSrc).toContain('import { authorizeServiceCaller } from "./auth.ts";');
    const authAt = indexSrc.indexOf('authorizeServiceCaller(req.headers');
    const renderAt = indexSrc.indexOf('render(body)');
    expect(authAt).toBeGreaterThan(-1);
    expect(renderAt).toBeGreaterThan(authAt);
  });
});
