/**
 * Dossier v2 consistency check over a rendered report artifact.
 *
 * Re-builds the evidence ledger from the stored report row (and research pack) the artifact was
 * rendered from, then runs the report-wide contradiction validator over the artifact's own HTML.
 * Exits 1 on any blocking contradiction, so a release or CI step can gate on it.
 *
 *   npx tsx scripts/check-dossier-consistency.ts <report-row.json> <report.html> [--research <pack.json>]
 *
 * Offline and read-only: no database, network or provider call.
 */
import { readFile } from 'fs/promises';

process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-check-placeholder';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-check-placeholder';
process.env.REDIS_URL = 'redis://127.0.0.1:1/15';
process.env.OPENAI_API_KEY = 'offline-check-placeholder';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--research');
  const researchPath = at >= 0 ? argv[at + 1] : null;
  const [rowPath, htmlPath] = argv.filter((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
  if (!rowPath || !htmlPath) throw new Error('usage: check-dossier-consistency.ts <report-row.json> <report.html> [--research <pack.json>]');

  const row = JSON.parse(await readFile(rowPath, 'utf8'));
  const html = await readFile(htmlPath, 'utf8');
  const research = researchPath ? JSON.parse(await readFile(researchPath, 'utf8')) : row.data?.public_research ?? null;
  if (!html.includes('data-dossier="v2"')) throw new Error(`${htmlPath} is not a dossier v2 report`);

  const { mapComposedReport } = await import('../pages/api/reports/reportComposedMapper');
  const { sanitizeReportViewPayload } = await import('../backend/services/reportContentSanitizationService');
  const { validateCanonicalDossierHtml } = await import('../backend/services/export/canonicalReportPipeline');
  const generatedDate = new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const payload = mapComposedReport(row.data.composed_report, 'snapshot', row.id, row.company_id, row.domain, generatedDate,
    row.created_at, false, row.data?.engine_version ?? 'v1');
  if (!payload) throw new Error('mapComposedReport returned null');
  const result = validateCanonicalDossierHtml(sanitizeReportViewPayload(payload as never) as never, html, { research });
  if (!result) throw new Error('the stored report has no canonical payload');

  console.log(`checks run: ${result.checks.length}`);
  for (const i of result.issues) console.log(`${i.blocking ? 'BLOCKING' : 'advisory'}  ${i.rule}: ${i.detail}`);
  console.log(result.passed ? 'RESULT: PASS — no blocking contradiction.' : `RESULT: FAIL — ${result.issues.filter((i) => i.blocking).length} blocking contradiction(s).`);
  return result.passed ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(2); });
