/**
 * The Vercel service block must map a route to the application.
 *
 * PR #101 migrated this block from
 *     experimentalServices.web.routePrefix = "/"
 * to
 *     services.web.root = "."
 *
 * `root` names a filesystem directory; it is NOT a route mapping. The build
 * still succeeded — 283 static pages — so nothing failed loudly, and the first
 * deployment to carry it answered every request to the production domain with
 * `X-Vercel-Error: NOT_FOUND`. Production was served by an older deployment
 * until then, so the regression stayed invisible until a deploy happened.
 *
 * That is the failure mode this guards: a service block that builds perfectly
 * and serves nothing. The assertion is deliberately about the ROUTE mapping,
 * not about which property name is current — if the schema legitimately moves
 * on, this test should be updated together with evidence that the new shape
 * still routes '/' to the app.
 */

import fs from 'fs';
import path from 'path';

type ServiceBlock = { routePrefix?: string; root?: string; framework?: string };

const vercelConfig = (): Record<string, unknown> => {
  const raw = fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
};

describe('vercel.json — the web service must be routable', () => {
  test('the file is valid JSON', () => {
    expect(() => vercelConfig()).not.toThrow();
  });

  test('exactly one service block is declared', () => {
    const cfg = vercelConfig();
    const declared = ['services', 'experimentalServices'].filter((k) => cfg[k] !== undefined);
    // Two blocks would leave it ambiguous which one Vercel honours.
    expect(declared).toHaveLength(1);
  });

  test('the web service declares a ROUTE, not only a filesystem root', () => {
    const cfg = vercelConfig();
    const block = (cfg.services ?? cfg.experimentalServices) as Record<string, ServiceBlock>;
    const web = block?.web;

    expect(web).toBeDefined();
    expect(web.framework).toBe('nextjs');

    // The regression: `root: "."` alone builds fine and serves nothing.
    const routePrefix = web.routePrefix;
    expect(routePrefix).toBeDefined();
    expect(routePrefix).toBe('/');
  });

  test('the cron paths remain absolute application routes', () => {
    const cfg = vercelConfig();
    const crons = (cfg.crons ?? []) as Array<{ path?: string }>;
    expect(crons.length).toBeGreaterThan(0);
    for (const c of crons) {
      expect(typeof c.path).toBe('string');
      expect(c.path!.startsWith('/api/')).toBe(true);
    }
  });
});
