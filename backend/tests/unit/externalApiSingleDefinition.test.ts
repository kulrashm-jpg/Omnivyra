/**
 * 05 (2026-11-14): savePlatformConfig (and its siblings saveTenantPlatformConfig / getPlatformConfigs) were defined
 * TWICE - backend/services/externalApi/dbHelpers.ts (dead: its only importer, the externalApiService barrel, never
 * named them) and platformConfig.ts (live, via the barrel). Two copies of the writer that sets a mixed table's ROW
 * CLASS (company_id ?? null) on a table of per-tenant credentials means a fix to one silently misses the other, and a
 * barrel re-point could swap which is live. The dead copies are deleted; this pins EXACTLY ONE exported definition of
 * each, repo-wide.
 */
import { execFileSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const NAMES = ['savePlatformConfig', 'saveTenantPlatformConfig', 'getPlatformConfigs'];

export function definitionsOf(name: string, grepOutput: string): string[] {
  const re = new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`);
  return grepOutput.split('\n').filter((l) => l && re.test(l)).map((l) => l.split(':').slice(0, 2).join(':'));
}

describe('exactly one exported definition, repo-wide', () => {
  it.each(NAMES)('%s', (name) => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-n', '-E', `export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+${name}([^A-Za-z0-9_]|$)|export[[:space:]]+const[[:space:]]+${name}([^A-Za-z0-9_]|$)`,
        '--', 'backend', 'pages', 'lib', 'components', 'hooks', ':!backend/tests'], { cwd: ROOT, encoding: 'utf8' });
    } catch { out = ''; }
    const defs = definitionsOf(name, out);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatch(/^backend\/services\/externalApi\/platformConfig\.ts:/);
  });
  it('POSITIVE CONTROL: a second definition is counted', () => {
    const fake = 'a.ts:1:export async function savePlatformConfig(x) {\nb.ts:9:export async function savePlatformConfig(y) {';
    expect(definitionsOf('savePlatformConfig', fake)).toEqual(['a.ts:1', 'b.ts:9']);
  });
});
