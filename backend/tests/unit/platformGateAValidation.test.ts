/**
 * W0-5 — Gate A metrics-export validation.
 *
 * Locks the scrape contract the alerting stack points at:
 *   1. the canonical HARDEN-001 series render under their sanitized
 *      Prometheus names (api/db/ai/queue latency series),
 *   2. the scrape endpoint is dark by default and token-guarded (source
 *      contract — the endpoint needs live req/res, the wiring is asserted
 *      at source level like the repo's other enforcement scans),
 *   3. Web Vitals collection is default-ON with the explicit kill switch
 *      (W0-4) and the ingest endpoint exists,
 *   4. route-factory adoption holds repository-wide (W0-1/W0-2): every
 *      pages/api route with a default export goes through createApiRoute /
 *      withContract, minus the recorded skip-list.
 */
import fs from 'fs';
import path from 'path';
import { registry } from '../../observability/registry';
import { M, recordApi } from '../../observability/metrics';
import { renderPrometheusText } from '../../observability/promExporter';

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('W0-5 exporter ↔ alert compatibility', () => {
  test('canonical latency series render under stable Prometheus names', () => {
    recordApi({ route: '/api/gatea', method: 'GET', status: 200, durationMs: 42 });
    registry.observe(M.db.duration, 12, { table: 'gatea_table', op: 'select' });
    registry.observe(M.ai.duration, 900, { operation: 'gateaOp', provider: 'test' });
    registry.observe(M.queue.wait, 5, { queue: 'gatea-queue' });

    const text = renderPrometheusText();
    // These four names are the alerting contract — renaming any of them is
    // a breaking change for every dashboard/alert built during Gate A.
    expect(text).toContain('# TYPE api_request_duration_ms summary');
    expect(text).toContain('# TYPE db_query_duration_ms summary');
    expect(text).toContain('# TYPE ai_provider_duration_ms summary');
    expect(text).toContain('# TYPE queue_job_wait_ms summary');
    expect(text).toMatch(/api_request_duration_ms_sum\{method="GET",route="\/api\/gatea"\}/);
    expect(text).toMatch(/api_request_duration_ms\{method="GET",quantile="0\.95",route="\/api\/gatea"\}|api_request_duration_ms\{method="GET",route="\/api\/gatea",quantile="0\.95"\}/);
    expect(text).toContain('api_request_count');
  });

  test('scrape endpoint: dark by default, bearer/x-metrics-secret guarded, no-store', () => {
    const src = read('pages/api/observability/metrics.ts');
    expect(src).toContain('OBSERVABILITY_EXPORT_TOKEN');
    expect(src).toMatch(/if \(!expected\) \{[\s\S]{0,120}?status\(404\)/);
    expect(src).toContain("res.setHeader('Cache-Control', 'no-store')");
    expect(src).toContain('PROMETHEUS_CONTENT_TYPE');
  });
});

describe('W0-4 web vitals wiring', () => {
  test('collection defaults ON with explicit kill switch; ingest endpoint present', () => {
    const perf = read('lib/observability/clientPerf.ts');
    expect(perf).toContain("process.env.NEXT_PUBLIC_OBSERVABILITY_CLIENT ?? '1'");
    expect(fs.existsSync(path.join(ROOT, 'pages/api/observability/client.ts'))).toBe(true);
    const app = read('pages/_app.tsx');
    expect(app).toContain('initClientPerf');
  });
});

describe('W0-1/W0-2 route-factory adoption holds repository-wide', () => {
  test('every default-exporting API route is factory-wrapped (skip-list excepted)', () => {
    const apiRoot = path.join(ROOT, 'pages', 'api');
    const unwrapped: string[] = [];
    const report = JSON.parse(read('scripts/.route-factory-adoption-report.json'));
    const skipList = new Set(report.skipped.map((s: { file: string }) => s.file.replace(/\\/g, '/')));

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.ts$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
        const rel = path.relative(ROOT, full).replace(/\\/g, '/');
        const src = fs.readFileSync(full, 'utf8');
        if (!/^export default /m.test(src)) continue;              // helper module
        if (skipList.has(rel)) continue;                            // recorded residue
        if (src.includes('createApiRoute') || src.includes('withContract(')) continue;
        unwrapped.push(rel);
      }
    };
    walk(apiRoot);
    // New routes must adopt the factory (or extend the recorded skip-list
    // with justification) — this is the Gate A coverage ratchet.
    expect(unwrapped).toEqual([]);
  });
});
