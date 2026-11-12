/**
 * e9 ruling (2026-11-13): creator_render_jobs, creator_render_job_events and creator_render_validation_manifests
 * are GLOBAL "ops mirror" tables. Their rows carry tenant data only inside payload JSON, so they must NEVER be
 * read by a tenant-facing route (tenant reads go through creator_render_job, a DIRECT tenant table). This pins
 * that: no file under pages/api references them. A route that needs render state must use the tenant-scoped
 * domain tables instead (or this classification must be revisited).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const MIRROR = ['creator_render_jobs', 'creator_render_job_events', 'creator_render_validation_manifests'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('render ops-mirror tables are not tenant-facing (e9 ruling)', () => {
  it('no pages/api file references creator_render_jobs / _job_events / _validation_manifests', () => {
    const files = walk(path.join(ROOT, 'pages', 'api'));
    expect(files.length).toBeGreaterThan(100); // the walk really scanned the routes
    const hits: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const t of MIRROR) {
        // A quoted table literal (\b also stops creator_render_jobs matching inside creator_render_job_events).
        if (new RegExp(`['"\`]${t}['"\`]`).test(src)) hits.push(`${path.relative(ROOT, f)}: ${t}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('CONTROL: the scan does find these literals where they ARE used (the worker persistence module)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend/services/creatorRenderPersistence.ts'), 'utf8');
    expect(/['"`]creator_render_jobs['"`]/.test(src)).toBe(true);
  });
});
