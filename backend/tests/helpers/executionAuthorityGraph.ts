/**
 * Static reachability engine for the execution-authority inventory
 * (backend/tests/unit/executionAuthorityInventory.test.ts).
 *
 * It answers one question by reading source, never by running it: which entry
 * points (routes, crons, workers, jobs, queue processors, schedulers, operator
 * scripts) can reach a function that causes an external action, and does EVERY
 * path from that entry pass through the channel's canonical gate?
 *
 * Granularity is the TOP-LEVEL DECLARATION, not the module: a module-level
 * import graph reaches ~1,400 entry points from the community executor alone,
 * because shared services import each other widely. Propagation follows a named
 * binding from the declaration that defines it to the top-level declarations that
 * reference it, through:
 *   - static named / default / namespace imports (value imports only — `import type`
 *     and `{ type X }` carry nothing at runtime);
 *   - `const { a } = await import('…')`, `(await import('…')).a`, `require('…')`;
 *   - barrel re-exports (`export * from`, `export { a as b } from`);
 *   - same-file references (a non-exported helper reached by an exported one).
 *
 * KNOWN LIMITS — each is a reason the inventory can under-report, never over-report:
 *   - dispatch by data (queue names, registries, string-keyed maps) is invisible;
 *     the inventory seeds each such hop explicitly (e.g. a queue consumer);
 *   - a binding passed through an object or a parameter is followed only when the
 *     receiving declaration names it lexically;
 *   - top-level declarations are found by column-0 keywords, the style of this repo.
 */
import * as fs from 'fs';
import * as path from 'path';

export const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/** Trees whose files can run in production or be run by an operator. */
const SOURCE_DIRS = ['backend', 'lib', 'pages', 'scripts'];
/** Path SEGMENTS excluded (never substrings). */
const EXCLUDED_SEGMENTS = new Set(['node_modules', '.next', 'tests', '__tests__', '__mocks__', 'archive']);

export type Seed = { file: string; name: string; gated?: boolean };
export type GateSymbol = { file: string; name: string };
export type Hit = { gated: Set<boolean>; paths: string[] };
export type Reach = { hits: Map<string, Hit>; deadEnds: Set<string> };

type Binding = { file: string; local: string };
type Segment = { name: string; exported: boolean; isDefault: boolean; exportAs: string[]; text: string };

const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

function parseSpecList(list: string): Array<[string, string]> {
  return list
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !x.startsWith('type '))
    .map((x) => {
      const parts = x.split(/\s+as\s+|\s*:\s*/);
      return [parts[0].trim(), (parts[1] || parts[0]).trim()] as [string, string];
    });
}

const RE_STATIC = /\b(import|export)\s+(type\s+)?([^;'"`]*?)\s*\bfrom\s*['"]([^'"\n]+)['"]/g;
const RE_DYN_DESTR = /\{([^{}]*)\}\s*=\s*(?:await\s+)?import\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const RE_REQ_DESTR = /\{([^{}]*)\}\s*=\s*require\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const RE_DYN_ANY = /\b(?:import|require)\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const RE_DYN_PROP = /\(\s*await\s+import\(\s*['"]([^'"\n]+)['"]\s*\)\s*\)\s*\.\s*([\w$]+)/g;
const DECL = /^(export\s+)?(default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|const|let|var|class|enum|interface|type)\s+([\w$]+)/;
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?\s*$/;

export class SourceGraph {
  readonly files: string[] = [];
  private readonly fileSet = new Set<string>();
  private readonly src = new Map<string, string>();
  private readonly importers = new Map<string, Binding[]>();
  private readonly nsImporters = new Map<string, Binding[]>();
  /** Bare `import('…')` / `require('…')` of a module: a value dependency whose bindings are not named. */
  private readonly dynModuleImporters = new Map<string, string[]>();
  private readonly reexports = new Map<string, Array<{ file: string; name: string; as: string }>>();
  private readonly segCache = new Map<string, Segment[]>();

  constructor(private readonly isEntry: (file: string, code: string) => boolean) {
    for (const d of SOURCE_DIRS) this.walk(d);
    for (const f of this.files) this.index(f);
  }

  private walk(rel: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (EXCLUDED_SEGMENTS.has(e.name)) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) this.walk(child);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && !e.name.endsWith('.d.ts')) {
        this.files.push(child);
        this.fileSet.add(child);
      }
    }
  }

  code(file: string): string {
    let c = this.src.get(file);
    if (c === undefined) {
      c = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
      this.src.set(file, c);
    }
    return c;
  }

  has(file: string): boolean { return this.fileSet.has(file); }

  entry(file: string): boolean { return this.isEntry(file, this.code(file)); }

  resolve(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`]) {
      if (this.fileSet.has(c)) return c;
    }
    return null;
  }

  private add<T>(m: Map<string, T[]>, k: string, v: T): void {
    const l = m.get(k);
    if (l) l.push(v); else m.set(k, [v]);
  }

  private index(f: string): void {
    const c = this.code(f);
    if (!/\bfrom\b|import\(|require\(/.test(c)) return;
    let m: RegExpExecArray | null;
    RE_STATIC.lastIndex = 0;
    while ((m = RE_STATIC.exec(c))) {
      if (m[2]) continue;
      const r = this.resolve(f, m[4]);
      if (!r) continue;
      const clause = m[3].trim();
      if (m[1] === 'export') {
        if (clause === '*') this.add(this.reexports, r, { file: f, name: '*', as: '*' });
        else if (!/^\*\s+as\s+/.test(clause)) {
          for (const [a, b] of parseSpecList(clause.replace(/^\{|\}$/g, ''))) this.add(this.reexports, r, { file: f, name: a, as: b });
        }
        continue;
      }
      const ns = clause.match(/\*\s+as\s+([\w$]+)/);
      if (ns) this.add(this.nsImporters, r, { file: f, local: ns[1] });
      const named = clause.match(/\{([^}]*)\}/);
      if (named) for (const [a, b] of parseSpecList(named[1])) this.add(this.importers, `${r}#${a}`, { file: f, local: b });
      const def = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').split(',')[0].trim();
      if (def && /^[\w$]+$/.test(def)) this.add(this.importers, `${r}#default`, { file: f, local: def });
    }
    for (const re of [RE_DYN_DESTR, RE_REQ_DESTR]) {
      re.lastIndex = 0;
      while ((m = re.exec(c))) {
        const r = this.resolve(f, m[2]);
        if (r) for (const [a, b] of parseSpecList(m[1])) this.add(this.importers, `${r}#${a}`, { file: f, local: b });
      }
    }
    RE_DYN_ANY.lastIndex = 0;
    while ((m = RE_DYN_ANY.exec(c))) {
      const r = this.resolve(f, m[1]);
      if (r) this.add(this.dynModuleImporters, r, f);
    }
    RE_DYN_PROP.lastIndex = 0;
    while ((m = RE_DYN_PROP.exec(c))) {
      const r = this.resolve(f, m[1]);
      if (r) this.add(this.importers, `${r}#${m[2]}`, { file: f, local: `__dynprop_${m[2]}` });
    }
  }

  /** Every file that imports (as a value, statically or dynamically) from `target`. */
  valueImportersOf(target: string): string[] {
    const out = new Set<string>();
    for (const [k, l] of this.importers) if (k.startsWith(`${target}#`)) l.forEach((b) => out.add(b.file));
    (this.nsImporters.get(target) || []).forEach((b) => out.add(b.file));
    (this.reexports.get(target) || []).forEach((b) => out.add(b.file));
    (this.dynModuleImporters.get(target) || []).forEach((f) => out.add(f));
    return [...out].sort();
  }

  segments(f: string): Segment[] {
    const hit = this.segCache.get(f);
    if (hit) return hit;
    const segs: Segment[] = [];
    let cur: Segment & { lines: string[] } = { name: '__module', exported: false, isDefault: false, exportAs: [], text: '', lines: [] };
    const listed: Array<[string, string]> = [];
    for (const ln of this.code(f).split('\n')) {
      const lm = ln.match(EXPORT_LIST);
      if (lm) listed.push(...parseSpecList(lm[1]));
      const dm = ln.match(DECL);
      const defaultExpr = !dm && /^export\s+default\b/.test(ln);
      if (dm || defaultExpr) {
        cur.text = cur.lines.join('\n');
        segs.push(cur);
        cur = dm
          ? { name: dm[4], exported: !!dm[1], isDefault: !!dm[2], exportAs: [], text: '', lines: [ln] }
          : { name: 'default', exported: true, isDefault: true, exportAs: [], text: '', lines: [ln] };
        continue;
      }
      cur.lines.push(ln);
    }
    cur.text = cur.lines.join('\n');
    segs.push(cur);
    for (const [a, b] of listed) for (const sg of segs) if (sg.name === a) { sg.exported = true; sg.exportAs.push(b); }
    const out = segs.map(({ name, exported, isDefault, exportAs, text }) => ({ name, exported, isDefault, exportAs, text }));
    this.segCache.set(f, out);
    return out;
  }

  /** Every top-level declaration of `file` whose text contains `re`. */
  segmentsMatching(file: string, re: RegExp): Segment[] {
    return this.segments(file).filter((s) => re.test(s.text));
  }

  private static exportNames(sg: Segment): string[] {
    const out: string[] = [];
    if (sg.exported) out.push(sg.isDefault ? 'default' : sg.name);
    out.push(...sg.exportAs);
    return out;
  }

  private referencing(f: string, local: string, excludeName?: string): Segment[] {
    if (local.startsWith('__dynprop_')) {
      const rx = new RegExp(`import\\([^)]*\\)\\s*\\)\\s*\\.\\s*${local.slice(10)}\\b`);
      return this.segments(f).filter((sg) => rx.test(sg.text));
    }
    if (local.includes('.')) {
      const [a, b] = local.split('.');
      const rx = new RegExp(`\\b${a}\\s*\\.\\s*${b}\\b`);
      return this.segments(f).filter((sg) => rx.test(sg.text));
    }
    const rx = new RegExp(`(^|[^\\w$.])${local.replace(/\$/g, '\\$')}\\b`);
    return this.segments(f).filter(
      (sg) => sg.name !== excludeName && rx.test(sg.text.replace(/^\s*import\b[^;]*;?/gm, '')),
    );
  }

  /**
   * Propagate from `seeds` to every entry point. A path is GATED once it passes a
   * `gateSymbols` declaration, or a file whose code matches `gateFileRe` (used for
   * a predicate the caller evaluates, e.g. authorizePostPublish). `deadEnds` are
   * reached symbols with no consumer that are not in an entry file: dormant code
   * or an entry kind this engine does not recognise.
   */
  propagate(seeds: Seed[], gateSymbols: GateSymbol[] = [], gateFileRe?: RegExp): Reach {
    const isGate = (f: string, n: string) => gateSymbols.some((g) => g.file === f && g.name === n);
    const hits = new Map<string, Hit>();
    const deadEnds = new Set<string>();
    const seen = new Set<string>();
    type Item = { file: string; name: string; gated: boolean; path: string[] };
    const q: Item[] = seeds.map((s) => ({ file: s.file, name: s.name, gated: !!s.gated || isGate(s.file, s.name), path: [`${s.file}#${s.name}`] }));
    const record = (f: string, gated: boolean, p: string[]) => {
      let h = hits.get(f);
      if (!h) { h = { gated: new Set(), paths: [] }; hits.set(f, h); }
      h.gated.add(gated);
      if (h.paths.length < 4 && !(gated && h.paths.length > 0 && h.gated.has(false))) h.paths.push(p.join(' <- '));
    };
    for (const s of q) if (this.entry(s.file)) record(s.file, s.gated, s.path);

    while (q.length) {
      const it = q.shift() as Item;
      const key = `${it.file}#${it.name}#${it.gated}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let produced = false;
      const consumers: Array<Binding & { exclude?: string }> = [];
      const own = this.segments(it.file).find((sg) => SourceGraph.exportNames(sg).includes(it.name) || sg.name === it.name);
      if (own) consumers.push({ file: it.file, local: own.name, exclude: own.name });
      for (const b of this.importers.get(`${it.file}#${it.name}`) || []) consumers.push(b);
      for (const b of this.nsImporters.get(it.file) || []) consumers.push({ file: b.file, local: `${b.local}.${it.name}` });
      for (const re of this.reexports.get(it.file) || []) {
        if (re.name === '*' || re.name === it.name) {
          produced = true;
          q.push({ file: re.file, name: re.name === '*' ? it.name : re.as, gated: it.gated, path: [...it.path, `${re.file}(re-export)`] });
        }
      }
      for (const c of consumers) {
        const stack = this.referencing(c.file, c.local, c.exclude);
        const visited = new Set<Segment>();
        while (stack.length) {
          const sg = stack.pop() as Segment;
          if (visited.has(sg)) continue;
          visited.add(sg);
          produced = true;
          const g2 = it.gated || (gateFileRe ? gateFileRe.test(this.code(c.file)) : false);
          const p2 = [...it.path, `${c.file}#${sg.name}`];
          if (this.entry(c.file)) record(c.file, g2, p2);
          for (const n of SourceGraph.exportNames(sg)) q.push({ file: c.file, name: n, gated: g2 || isGate(c.file, n), path: p2 });
          if (sg.name !== '__module' && sg.name !== 'default') stack.push(...this.referencing(c.file, sg.name, sg.name));
        }
      }
      if (!produced && !this.entry(it.file)) deadEnds.add(`${it.file}#${it.name}`);
    }
    return { hits, deadEnds };
  }
}
