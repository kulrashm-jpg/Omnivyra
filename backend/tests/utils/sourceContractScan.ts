/**
 * Shared machinery for the source CONTRACT scans (financial writes / financial + authorization reads): comment
 * stripping that keeps string literals intact, statement starts, function / method declarations (so a site is keyed by
 * its enclosing function, not a line number), and the source-file walk. One implementation, used by both contracts.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Removes line and block comments, leaving string / template literals intact (offsets preserved for block comments). */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      const q = ch; out += ch; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; } out += src[i]; i++; }
      if (i < src.length) { out += src[i]; i++; }
      continue;
    }
    out += ch; i++;
  }
  return out;
}

/** Start of the statement containing offset i. '=>' is kept IN the statement (an arrow body is a returned value). */
export function statementStart(s: string, i: number): number {
  return Math.max(s.lastIndexOf(';', i) + 1, s.lastIndexOf('{\n', i) + 1, s.lastIndexOf('}\n', i) + 1, s.lastIndexOf('=>', i), s.lastIndexOf(',\n', i) + 1);
}

const NOT_FN = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'function', 'typeof', 'new', 'with']);
/** Function / method declarations (name, offset), so a site is keyed by its enclosing function (e1). */
export function declarations(s: string): Array<{ name: string; at: number }> {
  const out: Array<{ name: string; at: number }> = [];
  const re = /\bfunction\s+(\w+)\s*[<(]|\b(\w+)\s*[:=]\s*(?:async\s*)?(?:function\b[^(]*)?\([^()]*\)\s*(?::[^={]+)?=>|\b(?:async\s+)?(\w+)\s*\([^()]*\)\s*(?::\s*[^={;]+)?\{/g;
  for (const m of s.matchAll(re)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (name && !NOT_FN.has(name)) out.push({ name, at: m.index! });
  }
  return out;
}

/** Non-test .ts / .tsx source files under dir (node_modules, tests, dot-dirs and .d.ts excluded). */
export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'tests', '__tests__'].includes(e.name) || e.name.startsWith('.')) continue;
      sourceFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
