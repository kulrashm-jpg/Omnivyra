/**
 * Every PRODUCTION createLead call site asserts an explicit provenance_mode that
 * is a member of INBOUND_LEAD_PROFILES. This ENFORCES that classifyInboundLead's
 * structural fallback (`return 'manual'`) is unreachable from production callers,
 * which is the precondition for later changing that fallback to null (virality-05,
 * 2026-11-11). A fifth caller that forgets to assert a mode fails here.
 *
 * Static scan of the source text; the call sites are asserted BY NAME, so a call
 * that moves or disappears fails as loudly as a call that lacks a mode.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { INBOUND_LEAD_PROFILES } from '../../services/prospectProvenance/ingestion/sourceProfiles';

const ROOT = join(__dirname, '..', '..', '..');
const SCAN = ['backend', 'pages', 'lib', 'components', 'hooks'];
const MODES = Object.keys(INBOUND_LEAD_PROFILES);

function* files(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'tests' || e === '__tests__' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e)) yield p;
  }
}

/** The argument text of each `createLead(` call (balanced parens), with its file. */
function callSites(): Array<{ file: string; args: string }> {
  const out: Array<{ file: string; args: string }> = [];
  for (const top of SCAN) {
    for (const f of files(join(ROOT, top))) {
      const src = readFileSync(f, 'utf8');
      const re = /(?<![\w.])createLead\s*\(/g;
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
        out.push({ file: relative(ROOT, f).split(sep).join('/'), args: src.slice(start, i + 1) });
      }
    }
  }
  return out;
}

describe('createLead production callers assert provenance_mode', () => {
  const sites = callSites();

  it('the call sites are exactly the four known entry points (by name)', () => {
    expect(sites.map((s) => s.file).sort()).toEqual([
      'backend/services/leadCaptureService.ts',
      'pages/api/leads/index.ts',
      'pages/api/leads/index.ts',
      'pages/api/leads/index.ts',
    ]);
  });

  it('every call site passes a literal provenance_mode that is a known inbound mode', () => {
    const asserted = sites.map((s) => {
      const m = /provenance_mode\s*:\s*'([a-z_]+)'/.exec(s.args);
      return { file: s.file, mode: m ? m[1] : null };
    });
    for (const a of asserted) {
      expect(a.mode).not.toBeNull();
      expect(MODES).toContain(a.mode);
    }
    // Each entry point asserts its OWN mode.
    expect(asserted.map((a) => a.mode).sort()).toEqual(['inbound_form', 'inbound_webhook', 'manual', 'website']);
  });
});
