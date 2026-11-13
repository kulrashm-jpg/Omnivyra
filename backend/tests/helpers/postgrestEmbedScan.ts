/**
 * Static scan of PostgREST resource EMBEDS in production `.select(...)` strings (e9 / 05, 2026-11-13).
 *
 * Why: on the service-role client (no RLS) an embed `table(cols)` follows its foreign key with NO tenant predicate,
 * and a filter on an embedded column (`.eq('table.col', v)`) WITHOUT `!inner` on that embed filters only the embedded
 * rows, never the top-level rows. Both shapes leaked tenant data (response/rules GET; the five community-ai
 * content_analytics reads). The hole is invisible at the call site, so it is guarded by a scan.
 *
 * Handles single-, double- and backtick-quoted (multi-line) select strings; aggregate calls like `count()` are not
 * embeds. Test files are excluded.
 */
import fs from 'fs';
import path from 'path';

export type EmbedHit = { file: string; line: number; embed: string; inner: boolean; select: string };
export type EmbedFilterHit = { file: string; line: number; embed: string; method: string; column: string };

const AGGREGATES = /^(count|sum|avg|min|max)$/i;
const FILTER_METHODS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'overlaps', 'filter', 'match'];

export function listProductionFiles(root: string, dirs = ['backend', 'pages', 'lib']): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      const rel = path.relative(root, p).replace(/\\/g, '/');
      if (e.isDirectory()) {
        if (/(^|\/)(tests?|__tests__|__mocks__)$/.test(rel)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        out.push(rel);
      }
    }
  };
  for (const d of dirs) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
  return out.sort();
}

/** Embeds inside every `.select(<string literal>)` of one source text. */
export function scanEmbeds(file: string, src: string): EmbedHit[] {
  const hits: EmbedHit[] = [];
  const selectRe = /\.select\(\s*(['"`])([\s\S]*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = selectRe.exec(src))) {
    const cols = m[2];
    const embedRe = /(?:^|[,\s(])(?:[A-Za-z_][A-Za-z0-9_]*\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)(![A-Za-z0-9_]+)?\s*\(/g;
    let e: RegExpExecArray | null;
    while ((e = embedRe.exec(cols))) {
      if (AGGREGATES.test(e[1])) continue;
      hits.push({
        file,
        line: src.slice(0, m.index).split('\n').length,
        embed: e[1] + (e[2] && e[2] !== '!inner' ? e[2] : ''),
        inner: e[2] === '!inner',
        select: cols.replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return hits;
}

/** Filters whose column is a dotted path `embed.col[.col]` (a filter on an embedded resource). */
export function scanEmbedFilters(file: string, src: string): EmbedFilterHit[] {
  const out: EmbedFilterHit[] = [];
  const re = new RegExp(`\\.(${FILTER_METHODS.join('|')})\\(\\s*['"\`]([A-Za-z_][A-Za-z0-9_]*)\\.([A-Za-z0-9_.]+)['"\`]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ file, line: src.slice(0, m.index).split('\n').length, embed: m[2], method: m[1], column: `${m[2]}.${m[3]}` });
  }
  return out;
}

/**
 * Rule 1: a filter on an embedded resource is only a top-level filter when that embed is `!inner`. Each dotted
 * filter on embed E is paired with the NEAREST PRECEDING select in the same file that embeds E (query chains are
 * often built across statements: `let q = db.from(..).select(..); q = q.eq('e.col', v)`); that embed must be !inner.
 * A dotted filter with no preceding select embedding E is not an embed filter (e.g. a JSON or table-qualified name)
 * and is ignored.
 */
export function embedFilterViolations(file: string, src: string): string[] {
  const embeds = scanEmbeds(file, src);
  const v: string[] = [];
  for (const f of scanEmbedFilters(file, src)) {
    const candidates = embeds.filter((e) => e.embed.split('!')[0] === f.embed && e.line <= f.line);
    if (candidates.length === 0) continue;
    const nearest = candidates.reduce((a, b) => (b.line >= a.line ? b : a));
    if (!nearest.inner) {
      v.push(`${file}:${f.line} .${f.method}('${f.column}') filters embed '${f.embed}' which is embedded WITHOUT !inner at :${nearest.line} - this filters only the embedded rows, never the top-level rows`);
    }
  }
  return v;
}
