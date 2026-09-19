// Tooling aggregate (CPG_U1_PROTOCOL_003 §4): sha256 of the UTF-8 text with one line
// "<sha256>  <path>" per file, sorted by path, LF-terminated — the CPG-037A definition,
// applied to every file of the tooling tree, vendored dependencies included.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './canonical.mjs';

export function toolingManifest(root) {
  const files = [];
  const walk = (dir, rel) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) throw new Error(`tooling tree contains a link (${r}) — links are not permitted`);
      if (d.isDirectory()) walk(join(dir, d.name), r);
      else if (d.isFile()) files.push({ path: r, sha256: sha256(readFileSync(join(dir, d.name))) });
      else throw new Error(`tooling tree contains a non-regular entry (${r})`);
    }
  };
  walk(root, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const text = files.map((f) => `${f.sha256}  ${f.path}\n`).join('');
  return { files, text, aggregate: sha256(text) };
}
