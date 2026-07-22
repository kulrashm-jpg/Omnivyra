// Shared repository discovery + parse-once model for the governance runtimes.
//
// This is THE single discovery/traversal implementation. Both the Documentation Validation
// Runtime (WP-02, GOV-AUTO-001) and the Constitutional Census Runtime (WP-03, GOV-AUTO-002)
// import buildModel() from here so the constitutional documentation tree is walked and parsed
// exactly ONCE per concern — no duplicated traversal, no second parser (single-runtime doctrine,
// reuse-first). It is dependency-free (Node built-ins only) and pure/read-only over the tree.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// Deterministic recursive file discovery (sorted at every level).
export function walk(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const LINK_RE = /\]\(([^)]+)\)/g;

// Parse the tree rooted at `root` once into a shared model consumed by all validators/census.
// Returns { root, docs: Map<relPath, doc>, mdRelPaths: string[], fileCount: number }.
export function buildModel(root) {
  const files = walk(root).sort();
  const docs = new Map();
  const mdRelPaths = [];
  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const isMd = rel.toLowerCase().endsWith('.md');
    const raw = readFileSync(abs, 'utf8');
    const lines = raw.split(/\r?\n/);
    const headings = lines
      .map((l, i) => ({ i, l }))
      .filter(({ l }) => /^#{1,6}\s/.test(l))
      .map(({ i, l }) => ({ line: i + 1, level: l.match(/^#+/)[0].length, text: l.replace(/^#+\s/, '').trim() }));
    const links = [];
    if (isMd) {
      LINK_RE.lastIndex = 0;
      let m;
      while ((m = LINK_RE.exec(raw)) !== null) {
        const target = m[1].trim();
        const line = raw.slice(0, m.index).split(/\r?\n/).length;
        links.push({ target, line });
      }
    }
    const footerLine = lines.find((l) => l.startsWith('**Related:**')) || null;
    const doc = {
      abs, rel,
      dir: path.dirname(abs),
      isMd,
      raw, lines,
      headings,
      h1: headings.find((h) => h.level === 1) || null,
      links,
      footer: footerLine,
      inbound: 0,
    };
    docs.set(rel, doc);
    if (isMd) mdRelPaths.push(rel);
  }

  // Resolve relative links to on-disk targets; accumulate md->md inbound reference counts.
  for (const rel of mdRelPaths) {
    const doc = docs.get(rel);
    for (const link of doc.links) {
      const t = link.target;
      if (/^(https?:)?\/\//i.test(t) || t.startsWith('#') || t.startsWith('mailto:')) { link.kind = 'external'; continue; }
      const bare = t.split('#')[0];
      if (!bare) { link.kind = 'anchor'; continue; }
      const absTarget = path.resolve(doc.dir, bare);
      link.resolvedAbs = absTarget;
      link.exists = existsSync(absTarget);
      link.kind = 'relative';
      if (link.exists && statSync(absTarget).isFile()) {
        const targetRel = path.relative(root, absTarget).split(path.sep).join('/');
        link.targetRel = targetRel;
        const td = docs.get(targetRel);
        if (td && td.isMd && targetRel !== rel) td.inbound += 1;
      } else if (link.exists && statSync(absTarget).isDirectory()) {
        const idx = path.join(absTarget, 'README.md');
        if (existsSync(idx)) {
          const idxRel = path.relative(root, idx).split(path.sep).join('/');
          const td = docs.get(idxRel);
          if (td && idxRel !== rel) td.inbound += 1;
          link.targetRel = idxRel;
        }
      }
    }
  }

  return { root, docs, mdRelPaths, fileCount: files.length };
}
