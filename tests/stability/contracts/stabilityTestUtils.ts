import fs from 'fs';
import path from 'path';

export const repoRoot = path.resolve(__dirname, '..', '..', '..');

export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

export function listRepoFiles(relativeDir: string, extensions: ReadonlyArray<string>): string[] {
  const root = path.join(repoRoot, relativeDir);
  const out: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  }

  walk(root);
  return out.sort();
}

export function expectContainsAll(source: string, tokens: ReadonlyArray<string>): void {
  for (const token of tokens) {
    expect(source).toContain(token);
  }
}

export function expectMatchesAll(source: string, patterns: ReadonlyArray<RegExp>): void {
  for (const pattern of patterns) {
    expect(source).toMatch(pattern);
  }
}
