/**
 * STEP 3AH-91 (SEC-F, F3) — outbound-SSRF scanner coverage.
 *
 * Before: only backend/** and pages/api/** were scanned; only a bare variable
 * as the first fetch/axios argument was flagged; EVERY template literal was
 * exempt, and so was any `const u = \`https:…\`` (even `https://${host}`).
 * After: lib/** server modules are scanned too (browser-only modules skipped),
 * a template literal whose HOST is dynamic is flagged, and a const only
 * exempts a variable when its value fixes the host.
 */
import path from 'path';
import { execFileSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scanSource, templateHostIsFixed, isBrowserOnly } = require('../../../scripts/check-outbound-ssrf.js') as {
  scanSource: (src: string) => Array<{ line: number; call: string; arg: string }>;
  templateHostIsFixed: (tpl: string, vars: Set<string>) => boolean;
  isBrowserOnly: (rel: string, src: string) => boolean;
};

const REPO = path.resolve(__dirname, '../../..');

describe('template literals with a dynamic host are flagged', () => {
  it('fetch(`https://${host}/x`)', () => {
    expect(scanSource('const r = await fetch(`https://${host}/v1/items`);')).toHaveLength(1);
  });
  it('fetch(`${baseUrl}/x`) with a lowercase (request/DB-derived) base', () => {
    expect(scanSource('const r = await fetch(`${input.baseUrl}/v1/items`, { method: "POST" });')).toHaveLength(1);
    expect(scanSource('return fetch(`${origin}/api/campaigns/${id}/advice`, { headers });')).toHaveLength(1);
  });
  it('axios / http(s) with a dynamic-host template', () => {
    expect(scanSource('const r = await axios.get(`${target}/status`);')).toHaveLength(1);
    expect(scanSource('const r = https.get(`https://${host}:443/`, cb);')).toHaveLength(1);
  });
  it('a literal host glued to an interpolation (`https://api.x.com${p}`) is dynamic (p may be ".evil.com")', () => {
    expect(scanSource('const r = await fetch(`https://api.example.com${suffix}`);')).toHaveLength(1);
  });
});

describe('fixed-host templates stay allowed', () => {
  it('literal scheme://host with interpolated path/query', () => {
    expect(scanSource('const r = await fetch(`https://graph.facebook.com/v22.0/${id}?fields=${f}`);')).toHaveLength(0);
  });
  it('same-origin relative paths', () => {
    expect(scanSource('const r = await fetch(`/api/campaigns/${id}`);')).toHaveLength(0);
  });
  it('an UPPER_SNAKE constant or env base', () => {
    expect(scanSource('const r = await fetch(`${GRAPH_API}/me/threads`);')).toHaveLength(0);
    expect(scanSource('const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/x`);')).toHaveLength(0);
    expect(scanSource("const r = await fetch(`${process.env.API_BASE || 'https://api.x.com'}/v1`);")).toHaveLength(0);
  });
  it('a same-file const with a literal host, or a zero-arg function returning constants', () => {
    expect(scanSource("const base = 'https://api.cashfree.com/pg';\nconst r = await fetch(`${base}/orders`);")).toHaveLength(0);
    expect(scanSource("const PROD = 'https://a.com';\nconst SANDBOX = 'https://b.com';\nfunction baseUrl() { return live ? PROD : SANDBOX; }\nconst r = await fetch(`${baseUrl()}/orders`);")).toHaveLength(0);
  });
  it('templateHostIsFixed unit cases', () => {
    const none = new Set<string>();
    expect(templateHostIsFixed('https://api.x.com/${p}`', none)).toBe(true);
    expect(templateHostIsFixed('https://${h}/p`', none)).toBe(false);
    expect(templateHostIsFixed('${u}/p`', none)).toBe(false);
    expect(templateHostIsFixed('${u}/p`', new Set(['u']))).toBe(true);
    expect(templateHostIsFixed('/api/x/${id}`', none)).toBe(true);
  });
});

describe('a const only exempts a variable when its value fixes the host', () => {
  it('`const u = \\`https://${host}/x\\`` no longer exempts fetch(u)', () => {
    expect(scanSource('const u = `https://${host}/x`;\nconst r = await fetch(u);')).toHaveLength(1);
  });
  it("`const u = 'https://' + host` no longer exempts fetch(u)", () => {
    expect(scanSource("const u = 'https://' + host;\nconst r = await fetch(u);")).toHaveLength(1);
  });
  it('`let` can be reassigned, so it never exempts', () => {
    expect(scanSource("let u = 'https://api.x.com/v1';\nu = req.body.url;\nconst r = await fetch(u);")).toHaveLength(1);
  });
  it("a literal host + '/' + path still exempts", () => {
    expect(scanSource("const u = 'https://api.x.com/' + path;\nconst r = await fetch(u);")).toHaveLength(0);
    expect(scanSource('const apiUrl = `https://graph.facebook.com/${id}/media`;\nconst r = await axios.post(apiUrl, body);')).toHaveLength(0);
  });
});

describe('lib/** scope: server modules scanned, browser-only modules skipped', () => {
  it('classifies browser-only lib modules', () => {
    expect(isBrowserOnly('lib/client/dataKit.ts', 'export const x = 1;')).toBe(true);
    expect(isBrowserOnly('lib/x.ts', "'use client';\nexport const x = 1;")).toBe(true);
    expect(isBrowserOnly('lib/x.ts', "import { useState } from 'react';")).toBe(true);
    expect(isBrowserOnly('lib/apiFetch.ts', "import { getSupabaseBrowser } from './supabaseBrowser';")).toBe(true);
  });
  it('a plain lib module is server-reachable and scanned', () => {
    expect(isBrowserOnly('lib/anomaly/notificationService.ts', "import { x } from '../../backend/db/supabaseClient';")).toBe(false);
    expect(isBrowserOnly('backend/services/x.ts', "'use client';")).toBe(false);
  });
});

describe('the repository itself', () => {
  it('the guard passes across backend/**, pages/api/** and lib/** with no open findings left', () => {
    // STEP 3AH-91 integration: SEC-E removed propose-frequency-rebalance's outbound
    // fetch to the caller-supplied Origin, so no KNOWN OPEN entry remains, and no
    // stale-entry warning may appear.
    const out = execFileSync('node', [path.join(REPO, 'scripts/check-outbound-ssrf.js')], { cwd: REPO, encoding: 'utf8' });
    expect(out).toContain('lib/**');
    expect(out).toContain('RESULT: PASS');
    expect(out).not.toMatch(/KNOWN OPEN|known-open entry no longer matches/);
  });
});
