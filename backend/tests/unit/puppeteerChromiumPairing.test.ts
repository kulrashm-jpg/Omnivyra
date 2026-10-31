/**
 * SECURITY/A2 (puppeteer-core + @sparticuz/chromium upgrade): pairing contract.
 *
 * Report PDF export on Vercel runs `renderPdfWithServerlessChromium`
 * (backend/services/export/htmlToPdfRenderer.ts): puppeteer-core drives the
 * Lambda Chromium that @sparticuz/chromium extracts at runtime. The two
 * packages are versioned independently, so this suite pins what the upgrade
 * relies on and fails if a later bump silently breaks it:
 *
 *  - both packages are pinned EXACTLY in package.json and match node_modules
 *    (a caret on puppeteer-core would float past the reviewed version);
 *  - puppeteer-core is at/above 25.13.0, the first release whose chromium-bidi
 *    nests zod >= 4.6.6 (GHSA-mrhx-c7xc-m3w5), and that nested zod is fixed;
 *  - the Chrome major puppeteer-core targets stays within 2 majors of the
 *    Chromium major @sparticuz ships (the reviewed gap: 155 vs 153);
 *  - the Lambda binary archives exist and next.config.js still traces them
 *    into the PDF route and keeps both packages external;
 *  - the renderer still uses the launch/setContent/pdf/close sequence the
 *    local smoke test exercised (source pin).
 *
 * Static only: @sparticuz/chromium is an ESM, Linux-only runtime and is NOT
 * executed here. The real-binary check is the owner-run Vercel preview smoke.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'));
const semver = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
const gte = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) >= 0;
};

const pkg = readJson('package.json');
const pptr = readJson('node_modules/puppeteer-core/package.json');
const spz = readJson('node_modules/@sparticuz/chromium/package.json');

describe('puppeteer-core / @sparticuz/chromium pairing', () => {
  it('both are pinned exactly in package.json and match the installed versions', () => {
    expect(pkg.dependencies['puppeteer-core']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['@sparticuz/chromium']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pptr.version).toBe(pkg.dependencies['puppeteer-core']);
    expect(spz.version).toBe(pkg.dependencies['@sparticuz/chromium']);
  });

  it('puppeteer-core is at or above the advisory floor 25.13.0', () => {
    expect(gte(pptr.version, '25.13.0')).toBe(true);
  });

  it('the zod nested under chromium-bidi is >= 4.6.6 (GHSA-mrhx-c7xc-m3w5)', () => {
    const candidates = [
      'node_modules/chromium-bidi/node_modules/zod/package.json',
      'node_modules/puppeteer-core/node_modules/chromium-bidi/node_modules/zod/package.json',
    ].filter((p) => fs.existsSync(path.join(REPO, p)));
    expect(candidates.length).toBeGreaterThan(0);
    for (const p of candidates) expect(gte(readJson(p).version, '4.6.6')).toBe(true);
  });

  it('puppeteer target Chrome major is within 2 majors of the @sparticuz Chromium major', () => {
    const revisions = fs.readFileSync(path.join(REPO, 'node_modules/puppeteer-core/lib/puppeteer/revisions.js'), 'utf8');
    const m = revisions.match(/chrome:\s*'(\d+)\./);
    expect(m).not.toBeNull();
    const chromeMajor = Number(m![1]);
    const spzMajor = semver(spz.version)[0];
    expect(chromeMajor).toBeGreaterThanOrEqual(spzMajor);
    expect(chromeMajor - spzMajor).toBeLessThanOrEqual(2);
  });

  it('engines of both packages admit the repo Node line (22.x)', () => {
    expect(pkg.engines?.node).toMatch(/^22/);
    expect(pptr.engines?.node).toBeDefined();
    expect(spz.engines?.node).toBeDefined();
    // puppeteer-core >=22.12.0 ; @sparticuz ^22.17.0 || >=24.0.0 -- 22.17+ satisfies both.
    expect(gte(process.versions.node, '22.17.0')).toBe(true);
  });
});

describe('Lambda binary packaging', () => {
  it('@sparticuz ships its brotli archives under bin/', () => {
    const bin = path.join(REPO, 'node_modules/@sparticuz/chromium/bin');
    const files = fs.readdirSync(bin);
    expect(files).toEqual(expect.arrayContaining(['chromium.br']));
    expect(files.some((f) => /\.tar\.br$/.test(f))).toBe(true);
  });

  it('next.config.js traces the bin into the PDF route and keeps both packages external', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(path.join(REPO, 'next.config.js'));
    expect(cfg.outputFileTracingIncludes['/api/reports/[reportId]']).toEqual(
      expect.arrayContaining(['./node_modules/@sparticuz/chromium/bin/**']),
    );
    expect(cfg.serverExternalPackages).toEqual(expect.arrayContaining(['@sparticuz/chromium', 'puppeteer-core']));
  });
});

describe('renderer call sequence (source pin)', () => {
  const src = fs.readFileSync(path.join(REPO, 'backend/services/export/htmlToPdfRenderer.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async function renderPdfWithServerlessChromium'), src.indexOf('export async function renderPdfFromHtml'));

  it('launches with the @sparticuz args and executablePath', () => {
    expect(fn).toMatch(/puppeteer\.launch\(\{/);
    expect(fn).toMatch(/args:\s*\[\.\.\.chromium\.args/);
    expect(fn).toMatch(/executablePath:\s*await chromium\.executablePath\(\)/);
    expect(fn).toMatch(/chromium\.setGraphicsMode = false/);
  });

  it('uses setContent(load) + emulateMediaType(print) + pdf(A4) and always closes the browser', () => {
    expect(fn).toMatch(/setContent\(html, \{ waitUntil: 'load', timeout: 60000 \}\)/);
    expect(fn).toMatch(/emulateMediaType\('print'\)/);
    expect(fn).toMatch(/format: 'A4'/);
    expect(fn).toMatch(/finally \{\s*await browser\.close\(\)/);
  });
});
