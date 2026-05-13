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

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const failures: string[] = [];

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

  throw new Error(`Unable to render PDF from HTML. ${failures.join(' | ')}`);
}
