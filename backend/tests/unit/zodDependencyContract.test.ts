/**
 * security/zod4 dependency contract (GHSA-mrhx-c7xc-m3w5, zod < 4.6.6).
 *
 *  - the root zod is a fixed zod 4 (package.json range and installed copy);
 *  - no source file imports zod through a version subpath (`zod/v3`, `zod/v4`,
 *    `zod/mini`…): every importer uses the root entry, so there is exactly one
 *    zod API in the app;
 *  - nothing imports `openai/helpers/zod`. openai 5.x declares an OPTIONAL peer
 *    `zod ^3.23.8` that is used only by that helper (its vendored
 *    zod-to-json-schema). With zod 4 at the root that peer is unmet, which is
 *    inert exactly as long as the helper is unused.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8'));
const semver = (v: string) => v.replace(/^[^\d]*/, '').split(/[.-]/).slice(0, 3).map(Number);
const gte = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) >= 0;
};

const SOURCE_DIRS = [
  'backend', 'pages', 'lib', 'components', 'hooks', 'config', 'modules', 'scripts', 'middleware',
  'shared', 'features', 'platform', 'store', 'utils', 'types', 'community-ai', 'db-utils', 'db-utility',
];
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of SOURCE_DIRS) walk(path.join(REPO, d));
  return out;
}

describe('zod dependency contract', () => {
  const files = sourceFiles();
  const text = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')] as const));
  const importers = files.filter((f) => /from\s+['"]zod(\/[^'"]*)?['"]|require\(\s*['"]zod/.test(text.get(f)!));

  it('root zod is >= 4.6.6 in package.json and node_modules', () => {
    const pkg = readJson('package.json');
    expect(pkg.dependencies.zod).toMatch(/^\^?4\./);
    expect(gte(pkg.dependencies.zod, '4.6.6')).toBe(true);
    expect(gte(readJson('node_modules/zod/package.json').version, '4.6.6')).toBe(true);
  });

  it('every zod importer uses the root entry (no zod/v3, zod/v4, zod/mini subpaths)', () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(importers.length).toBeGreaterThanOrEqual(14);
    const subpath = importers.filter((f) =>
      /(from\s+|require\(\s*|import\(\s*)['"]zod\/(?!package\.json['"])[^'"]+['"]/.test(text.get(f)!),
    );
    expect(subpath.map((f) => path.relative(REPO, f))).toEqual([]);
  });

  it('nothing imports openai/helpers/zod (openai 5 optional peer is zod ^3)', () => {
    const offenders = files.filter((f) => f !== __filename && /openai\/helpers\/zod/.test(text.get(f)!));
    expect(offenders.map((f) => path.relative(REPO, f))).toEqual([]);
  });
});
