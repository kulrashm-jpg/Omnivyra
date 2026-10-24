/**
 * Next/Vercel read a route's `config` (maxDuration, api.responseLimit) only as
 * a static `export const config` in the route file itself. The 3fdab936
 * route-shell split (2026-07-09) moved the /api/reports/[reportId] config into
 * a helper module, where it was imported but never exported: the 60s duration
 * and the unlimited PDF response were silently dropped for months.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js)$/.test(name) ? [full] : [];
  });
}

/** `config` imported from anything other than the app config module (`@/config`). */
function importsRouteConfig(src: string): boolean {
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const names = m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]);
    const from = m[2];
    if (names.includes('config') && !/(^@\/config$|\/config(\/index)?$)/.test(from)) return true;
  }
  return false;
}

const exportsConfig = (src: string) => /^export const config\s*=/m.test(src);

describe('report API routes declare their Next route config in the route file', () => {
  const routes = walk(join(ROOT, 'pages', 'api', 'reports'));

  it('scans a non-empty set of report routes', () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it('no report route imports a route `config` without exporting one', () => {
    const offenders = routes
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return importsRouteConfig(src) && !exportsConfig(src);
      })
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('/api/reports/[reportId] (HTML + serverless-Chromium PDF) exports maxDuration and responseLimit', () => {
    const src = readFileSync(join(ROOT, 'pages', 'api', 'reports', '[reportId].ts'), 'utf8');
    const block = src.match(/^export const config\s*=\s*\{([\s\S]*?)^\};/m);
    expect(block).not.toBeNull();
    expect(block![1]).toMatch(/maxDuration:\s*60\b/);
    expect(block![1]).toMatch(/responseLimit:\s*false/);
  });

  it('no API handler module strands a route config where Next never reads it', () => {
    const stranded = walk(join(ROOT, 'backend', 'apiHandlers'))
      .filter((f) => exportsConfig(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(stranded).toEqual([]);
  });
});
