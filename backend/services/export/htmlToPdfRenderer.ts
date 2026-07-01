import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '@/config';

const execFileAsync = promisify(execFile);

function resolveChromePath(): string | null {
  const candidates = [
    config.CHROME_PATH,
    config.CHROMIUM_PATH,
    config.GOOGLE_CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function renderPdfWithPlaywright(html: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const launchArgs = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-software-rasterizer',
    '--no-sandbox',
  ];
  const chromePath = resolveChromePath();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: launchArgs,
    });
  } catch (error) {
    if (!chromePath) throw error;
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: launchArgs,
    });
  }

  try {
    const page = await browser.newPage({
      viewport: { width: 1240, height: 1754 },
    });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 60000 });
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function renderPdfWithChromeCli(html: string): Promise<Buffer> {
  const chromePath = resolveChromePath();
  if (!chromePath) {
    throw new Error('Chrome executable not found for HTML-to-PDF rendering');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'virality-html-pdf-'));
  const htmlPath = path.join(tempDir, 'report.html');
  const pdfPath = path.join(tempDir, 'report.pdf');

  fs.writeFileSync(htmlPath, html, 'utf8');

  try {
    await execFileAsync(chromePath, [
      '--headless',
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--allow-file-access-from-files',
      `--print-to-pdf=${pdfPath}`,
      '--no-pdf-header-footer',
      '--print-to-pdf-no-header',
      '--run-all-compositor-stages-before-draw',
      `file:///${htmlPath.replace(/\\/g, '/')}`,
    ], {
      windowsHide: true,
      timeout: 120000,
    });

    return fs.readFileSync(pdfPath);
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV,
  );
}

// Serverless (Vercel/Lambda) has no bundled Playwright browser and no system Chrome,
// so the previous renderer always failed there ("Failed to generate PDF export").
// @sparticuz/chromium ships a Lambda-packaged Chromium (extracted to /tmp at runtime)
// driven by puppeteer-core — this is the path that makes report PDF export work on Vercel.
async function renderPdfWithServerlessChromium(html: string): Promise<Buffer> {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;

  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1240, height: 1754 });
    // setContent (unlike goto) only supports load/domcontentloaded in puppeteer-core.
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const failures: string[] = [];
  const serverless = isServerlessRuntime();

  // On serverless, the bundled Chromium is the only browser available — try it first.
  if (serverless) {
    try {
      return await renderPdfWithServerlessChromium(html);
    } catch (error) {
      failures.push(
        `serverless-chromium: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    return await renderPdfWithPlaywright(html);
  } catch (error) {
    failures.push(
      `playwright: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return await renderPdfWithChromeCli(html);
  } catch (error) {
    failures.push(
      `chrome-cli: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Last resort for local/dev with no Playwright browser or system Chrome installed.
  if (!serverless) {
    try {
      return await renderPdfWithServerlessChromium(html);
    } catch (error) {
      failures.push(
        `serverless-chromium: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(`Unable to render PDF from HTML. ${failures.join(' | ')}`);
}
