/**
 * Every PRODUCTION createLead call site asserts an explicit provenance_mode that
 * is a member of INBOUND_LEAD_PROFILES.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT: it proves that no production CALL SITE
 * reaches classifyInboundLead's no-signal branch (now null/unknown). It does NOT
 * prove that branch is dead in general. That is a property of the callers, so
 * deleting or weakening this test reopens the question (virality-05, 2026-11-11).
 *
 * The rules, each with a watched negative control:
 *   1. CALL SITES, not files: every `createLead(` occurrence is one entry, so a
 *      second call inside an already-listed file changes the list and fails.
 *   2. The list is asserted BY NAME (file per call site), so a call that moves,
 *      disappears or appears anywhere fails.
 *   3. Each call passes a LITERAL mode (`provenance_mode: '<mode>'`) that is a
 *      key of INBOUND_LEAD_PROFILES, and each mode appears exactly once.
 *   4. No aliased import (`createLead as x`), which would hide a call from rule 1.
 *
 * Scope: the WHOLE repository (scripts/, tools/, supabase/ ...) except
 * node_modules, build output and tests, so a CLI or batch importer is caught.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { INBOUND_LEAD_PROFILES } from '../../services/prospectProvenance/ingestion/sourceProfiles';

const ROOT = join(__dirname, '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', 'dist', 'build', 'out', 'tests', '__tests__', '__mocks__']);
const MODES = Object.keys(INBOUND_LEAD_PROFILES);

function* files(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(e) && !/\.d\.ts$/.test(e)) yield p;
  }
}

const SOURCES: Array<{ file: string; src: string }> = [];
for (const f of files(ROOT)) {
  const src = readFileSync(f, 'utf8');
  if (src.includes('createLead')) SOURCES.push({ file: relative(ROOT, f).split(sep).join('/'), src });
}

/** One entry per `createLead(` CALL (balanced parens), with its file. */
function callSites(): Array<{ file: string; args: string }> {
  const out: Array<{ file: string; args: string }> = [];
  for (const { file, src } of SOURCES) {
    const re = /(?<![\w.$])createLead\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(before)) continue; // the definition, not a call
      let depth = 0;
      let i = m.index + m[0].length - 1;
      const start = i;
      for (; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out.push({ file, args: src.slice(start, i + 1) });
    }
  }
  return out;
}

describe('createLead production call sites assert provenance_mode', () => {
  const sites = callSites();

  it('the call sites (one entry per CALL, not per file) are exactly the four known entry points, by name', () => {
    expect(sites.map((s) => s.file).sort()).toEqual([
      'backend/services/leadCaptureService.ts',
      'pages/api/leads/index.ts',
      'pages/api/leads/index.ts',
      'pages/api/leads/index.ts',
    ]);
  });

  it('every call site passes a LITERAL provenance_mode that is a known inbound mode, each mode exactly once', () => {
    const asserted = sites.map((s) => {
      const m = /provenance_mode\s*:\s*'([a-z_]+)'/.exec(s.args);
      return { file: s.file, mode: m ? m[1] : null };
    });
    for (const a of asserted) {
      expect(a.mode).not.toBeNull();
      expect(MODES).toContain(a.mode);
    }
    expect(asserted.map((a) => a.mode).sort()).toEqual(['inbound_form', 'inbound_webhook', 'manual', 'website']);
  });

  it('no aliased import of createLead hides a call site', () => {
    const aliased = SOURCES.filter(({ src }) => /\bcreateLead\s+as\s+\w+/.test(src)).map((s) => s.file);
    expect(aliased).toEqual([]);
  });
});
