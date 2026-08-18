/**
 * P1.9A — guards on the automated performance harness.
 *
 * The harness drives the real deployed application, so the assertions that
 * matter are about what it must NEVER do: bypass authentication, fabricate a
 * session, or invent a timing. Timings themselves are only meaningful from a
 * real run and are not asserted here.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const HARNESS = path.resolve(__dirname, '../../../scripts/perf/journey.ts');
const source = () => fs.readFileSync(HARNESS, 'utf8');

describe('performance harness safety', () => {
  it('refuses to run without operator-supplied credentials', () => {
    const result = spawnSync('npx', ['tsx', HARNESS], {
      env: { ...process.env, PERF_E2E_EMAIL: '', PERF_E2E_PASSWORD: '' },
      encoding: 'utf8',
      shell: true,
      timeout: 120_000,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/PERF_E2E_EMAIL and PERF_E2E_PASSWORD/);
  }, 130_000);

  it('follows the repository convention for E2E credentials', () => {
    const src = source();
    expect(src).toContain('PERF_E2E_EMAIL');
    expect(src).toContain('PERF_E2E_PASSWORD');
    expect(src).toContain('E2E_BASE_URL');
  });

  it('authenticates through the ordinary login form, not a bypass', () => {
    const src = source();
    // Real form interaction.
    expect(src).toContain("page.fill('#email'");
    expect(src).toContain("page.fill('#password'");

    // Assert on CODE: the doc comment and the refusal message both legitimately
    // contain the word "bypass" while stating the opposite.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n');

    // No session forgery, cookie injection, service-role key or auth disabling.
    expect(code).not.toMatch(/addCookies|setCookie|service_role|SERVICE_ROLE|signInWithPassword/i);
    expect(code).not.toMatch(/DISABLE_AUTH|SKIP_AUTH|Bearer\s/i);
  });

  it('never hard-codes or defaults a timing value', () => {
    const src = source();
    // Every recorded number must come from a Date.now() delta.
    expect(src).toContain('const now = () => Date.now()');
    expect(src).toMatch(/since\(\w+Start\)/);
    // No fabricated fallbacks into the report.
    expect(src).not.toMatch(/timings\.\w+\s*=\s*\d+/);
  });

  it('makes the credit-consuming Accept step opt-in', () => {
    const src = source();
    expect(src).toContain("DO_ACCEPT = process.argv.includes('--accept')");
    // The generation call must sit behind that flag.
    expect(src).toMatch(/if \(DO_ACCEPT\)[\s\S]*\/api\/posts\/generate/);
  });

  it('carries the P1.9A targets exactly', () => {
    const src = source();
    for (const [key, value] of Object.entries({
      loginToShellMs: 2000,
      shellToCreditsMs: 1000,
      commandCenterReadyMs: 2000,
      contentReadyMs: 2000,
      recommendationsMs: 2000,
      suggestMs: 5000,
      reviseMs: 5000,
      acceptToGenerationMs: 1000,
    })) {
      expect(src).toContain(`${key}: ${value}`);
    }
    expect(src).toContain('generationResultMs: null');
  });

  it('emits a machine-readable baseline with the required keys', () => {
    const src = source();
    expect(src).toContain('writeFileSync(OUT');
    expect(src).toContain("'performance-baseline.json'");
    expect(src).toContain('slowestRequests');
    expect(src).toContain('allRequests');
  });
});

describe('credit pill instrumentation', () => {
  const nav = () =>
    fs.readFileSync(path.resolve(__dirname, '../../../components/layout/GlobalHeaderNav.tsx'), 'utf8');

  it('exposes every credit state so the harness can tell ready from placeholder', () => {
    const src = nav();
    for (const state of ['loading', 'error', 'unavailable', 'ready']) {
      expect(src).toContain(`data-credit-status="${state}"`);
    }
  });

  it('adds only attributes — no credit or billing logic changed', () => {
    const src = nav();
    // The status machine and its authority comment are intact.
    expect(src).toContain("const effective: CreditsStatus = status ?? 'ready'");
    expect(src).toContain('// READY — verified valid balance; 0 here is a REAL zero.');
  });
});
