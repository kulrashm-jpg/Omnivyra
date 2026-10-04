/**
 * Regression lock for Report 1 PDF font resolution on the Vercel Lambda.
 *
 * WP-14: report 3a0c23b3-2648-4159-a399-6b83b2a24aaf exported a 19-page PDF with
 * ZERO extractable text. Chromium launched, the HTML was correct and print CSS
 * worked (backgrounds and cards painted) -- but no glyphs were drawn, because
 * the Lambda ships no system fonts, @sparticuz/chromium supplies Open Sans
 * alone, and the canonical export asks for Inter / Source Serif 4 / Segoe UI.
 *
 * The fix hands the Chromium CHILD an explicit fontconfig pointing at the
 * vendored assets/fonts/. It is passed as `env` on launch rather than written to
 * process.env, because process.env is global, writable since the enforcer
 * set-trap fix, and shared across warm invocations -- a creator render and a PDF
 * export on one container must not be able to decide each other's fonts.
 *
 * These tests assert the font environment is established BEFORE launch, which is
 * the property that actually governs whether glyphs appear.
 */
import fs from 'fs';
import path from 'path';

const launchMock = jest.fn();
const executablePathMock = jest.fn(async () => '/tmp/chromium');

jest.mock('@sparticuz/chromium', () => ({
  __esModule: true,
  default: {
    args: ['--mock-chromium-arg'],
    executablePath: (...args: unknown[]) => executablePathMock(...(args as [])),
    setGraphicsMode: true,
  },
}));

jest.mock('puppeteer-core', () => ({
  __esModule: true,
  default: { launch: (...args: unknown[]) => launchMock(...(args as [])) },
}));

import { renderPdfFromHtml } from '../../services/export/htmlToPdfRenderer';
import { ensureRenderFonts, __resetRenderFontsCacheForTest } from '../../services/creatorRenderFonts';

const PDF_BYTES = Buffer.from('%PDF-1.4 mock');

function mockBrowser() {
  const page = {
    setViewport: jest.fn(async () => undefined),
    setContent: jest.fn(async () => undefined),
    emulateMediaType: jest.fn(async () => undefined),
    pdf: jest.fn(async () => PDF_BYTES),
  };
  return {
    newPage: jest.fn(async () => page),
    close: jest.fn(async () => undefined),
    __page: page,
  };
}

describe('Report 1 PDF font environment (serverless)', () => {
  const savedVercel = process.env.VERCEL;
  const savedFile = process.env.FONTCONFIG_FILE;
  const savedPath = process.env.FONTCONFIG_PATH;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetRenderFontsCacheForTest();
    process.env.VERCEL = '1'; // force isServerlessRuntime()
    launchMock.mockImplementation(async () => mockBrowser());
  });

  afterAll(() => {
    if (savedVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = savedVercel;
    if (savedFile === undefined) delete process.env.FONTCONFIG_FILE; else process.env.FONTCONFIG_FILE = savedFile;
    if (savedPath === undefined) delete process.env.FONTCONFIG_PATH; else process.env.FONTCONFIG_PATH = savedPath;
    __resetRenderFontsCacheForTest();
  });

  it('vendors the fonts the canonical export actually asks for', () => {
    const diag = ensureRenderFonts();
    expect(diag.resolvedFontDir).not.toBeNull();
    expect(diag.fontCount).toBeGreaterThan(0);
    const families = fs.readdirSync(diag.resolvedFontDir as string);
    expect(families.some((f) => f.startsWith('Inter-'))).toBe(true);
  });

  it('passes an explicit font environment to the Chromium child', async () => {
    await renderPdfFromHtml('<html><body><p>report text</p></body></html>');

    expect(launchMock).toHaveBeenCalledTimes(1);
    const options = launchMock.mock.calls[0][0] as { env?: Record<string, string | undefined> };
    expect(options.env).toBeDefined();
    expect(options.env!.FONTCONFIG_FILE).toBe(ensureRenderFonts().configPath);
    expect(options.env!.FONTCONFIG_PATH).toBe(path.dirname(ensureRenderFonts().configPath));
  });

  it('points the child at a config that resolves the export font chain to the vendored family', async () => {
    await renderPdfFromHtml('<html><body><p>report text</p></body></html>');

    const options = launchMock.mock.calls[0][0] as { env?: Record<string, string | undefined> };
    const configPath = options.env!.FONTCONFIG_FILE as string;
    expect(fs.existsSync(configPath)).toBe(true);

    const conf = fs.readFileSync(configPath, 'utf8');
    const diag = ensureRenderFonts();
    // The vendored directory must be a search path, or Chromium has no glyphs at all.
    expect(conf).toContain((diag.resolvedFontDir as string).replace(/\\/g, '/'));
    // sans-serif is what the export's 106 font-family declarations fall through to.
    expect(conf).toContain('sans-serif');
    expect(conf).toContain('Inter');
  });

  it('establishes the font environment BEFORE Chromium launches, not after', async () => {
    const order: string[] = [];
    executablePathMock.mockImplementation(async () => {
      order.push('executablePath');
      return '/tmp/chromium';
    });
    launchMock.mockImplementation(async (opts: unknown) => {
      const env = (opts as { env?: Record<string, string | undefined> }).env;
      order.push(env?.FONTCONFIG_FILE ? 'launch:with-fonts' : 'launch:no-fonts');
      return mockBrowser();
    });

    await renderPdfFromHtml('<html><body><p>report text</p></body></html>');

    expect(order).toContain('launch:with-fonts');
    expect(order).not.toContain('launch:no-fonts');
  });

  it('does not depend on ambient process.env font state leaking from another renderer', async () => {
    // Simulate a creator render having run first on the same warm container and
    // left a different fontconfig behind. The PDF child must still get its own.
    process.env.FONTCONFIG_FILE = '/tmp/some-other-renderer.conf';
    process.env.FONTCONFIG_PATH = '/tmp/somewhere-else';

    await renderPdfFromHtml('<html><body><p>report text</p></body></html>');

    const options = launchMock.mock.calls[0][0] as { env?: Record<string, string | undefined> };
    expect(options.env!.FONTCONFIG_FILE).not.toBe('/tmp/some-other-renderer.conf');
    expect(options.env!.FONTCONFIG_FILE).toBe(ensureRenderFonts().configPath);
  });
});

describe('Report 1 PDF function file tracing', () => {
  it('traces the vendored fonts into the report route Lambda', () => {
    const configSource = fs.readFileSync(path.join(process.cwd(), 'next.config.js'), 'utf8');
    const entry = configSource
      .split('\n')
      .find((line) => line.includes("'/api/reports/[reportId]':"));
    expect(entry).toBeDefined();
    // Without this the Lambda has the Chromium binary but nothing to render text with.
    expect(entry).toContain('./assets/fonts/**');
    // The Chromium binary include must survive alongside it.
    expect(entry).toContain('@sparticuz/chromium/bin/**');
  });
});
