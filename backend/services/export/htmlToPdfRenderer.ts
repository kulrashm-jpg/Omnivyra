import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function resolveChromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Chrome executable not found for HTML-to-PDF rendering');
}

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const chromePath = resolveChromePath();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'virality-html-pdf-'));
  const htmlPath = path.join(tempDir, 'report.html');
  const pdfPath = path.join(tempDir, 'report.pdf');

  fs.writeFileSync(htmlPath, html, 'utf8');

  try {
    await execFileAsync(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--allow-file-access-from-files',
      `--print-to-pdf=${pdfPath}`,
      '--no-pdf-header-footer',
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

