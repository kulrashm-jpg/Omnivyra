/**
 * Offline re-render of a stored snapshot report.
 *
 * Reads a `reports` row exported to JSON (the same shape the API route reads)
 * and runs the exact view-payload → HTML/PDF chain from
 * pages/api/reports/[reportId].ts — without the database, collection or any
 * provider call. Used to compare report output before and after renderer
 * changes against real stored data.
 *
 *   npx tsx scripts/render-snapshot-offline.ts <report-row.json> <outDir> [--no-pdf] [--v2]
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

// Placeholders so modules that construct clients at import time load; nothing
// here is ever called (the chain below is pure over the stored row).
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-render-placeholder';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-render-placeholder';
process.env.REDIS_URL = 'redis://127.0.0.1:1/15';
process.env.OPENAI_API_KEY = 'offline-render-placeholder';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function main() {
  const [rowPath, outDir = 'tmp/snapshot-render'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const wantPdf = !process.argv.includes('--no-pdf');
  if (process.argv.includes('--v2')) process.env.REPORT_DOSSIER_LAYOUT = 'v2';
  if (!rowPath) throw new Error('usage: render-snapshot-offline.ts <report-row.json> <outDir> [--no-pdf] [--v2]');

  const row = JSON.parse(await readFile(rowPath, 'utf8')) as {
    id: string; company_id: string; domain: string; created_at: string;
    data?: { composed_report?: unknown; engine_version?: string };
  };
  const composed = row.data?.composed_report;
  if (!composed) throw new Error('row has no data.composed_report');

  const { mapComposedReport } = await import('../pages/api/reports/reportComposedMapper');
  const { sanitizeReportViewPayload } = await import('../backend/services/reportContentSanitizationService');
  const { renderCanonicalReportHtml, renderCanonicalReportPdf } = await import('../backend/services/export/canonicalReportPipeline');

  const generatedDate = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const payload = mapComposedReport(
    composed as never, 'snapshot', row.id, row.company_id, row.domain, generatedDate,
    row.created_at, false, row.data?.engine_version ?? 'v1',
  );
  if (!payload) throw new Error('mapComposedReport returned null');
  const sanitized = sanitizeReportViewPayload(payload as never);

  await mkdir(outDir, { recursive: true });
  const html = renderCanonicalReportHtml(sanitized);
  await writeFile(path.join(outDir, 'report.html'), html);
  console.log('html', path.join(outDir, 'report.html'), html.length, 'chars');
  if (wantPdf) {
    const pdf = await renderCanonicalReportPdf(sanitized);
    await writeFile(path.join(outDir, 'report.pdf'), pdf);
    console.log('pdf', path.join(outDir, 'report.pdf'), pdf.length, 'bytes');
  }
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
