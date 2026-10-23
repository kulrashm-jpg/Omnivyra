/**
 * CA — the canonical attribute writer is the ONLY canonical attribute writer.
 *
 * `ingestionBoundary.ts` has claimed to be the sole canonical writer since LI-2,
 * and nothing enforced it. A header comment is not an invariant, and an
 * unenforced one drifts: any service could add a `.update({ job_title })` on
 * `unified_persons` and no test would notice, which would put a canonical value
 * in the database with no assertion behind it and no decision row explaining it
 * — exactly the class of defect the atomicity work exists to close.
 *
 * So this file walks the tree and asserts it, and then — because a scanner that
 * silently matches nothing is worse than no scanner at all — runs the same
 * detectors over synthetic violations and asserts they are caught.
 *
 * WHY COMMENTS ARE STRIPPED FIRST: the modules under test legitimately NAME
 * these tables and columns in their own explanatory headers. A scan over raw
 * text matches that prose and "passes" for the wrong reason, or fails for it.
 * String literals are deliberately NOT stripped, because the table name inside
 * `ownedDbTable('canonical_attribute_decisions')` is the very thing being
 * detected — so the detectors match the CALL form, never a bare mention.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['backend', 'pages'];

/** Remove line and block comments, so a module's own prose cannot match. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name === '.next') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES: Array<{ rel: string; code: string }> = SCAN_DIRS
  .map((d) => path.join(ROOT, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => walk(d))
  .map((full) => ({
    rel: path.relative(ROOT, full).replace(/\\/g, '/'),
    code: stripComments(fs.readFileSync(full, 'utf8')),
  }));

// ---------------------------------------------------------------------------
// The detectors. Exercised against the real tree AND against synthetic
// violations below, so a detector that matches nothing cannot pass unnoticed.
// ---------------------------------------------------------------------------

/** A write seam opened on a named table: `ownedDbTable('t')` or `.from('t')`. */
function opensTable(code: string, table: string): boolean {
  return new RegExp(`(?:ownedDbTable|from)\\(\\s*['"\`]${table}['"\`]\\s*\\)`).test(code);
}

/**
 * Builds a canonical provenance patch — the signature of an arbitrated write.
 *
 * Matching the key alone is not enough, and the first version of this detector
 * proved it by flagging `accountIntelligence.ts`, which only READS the column:
 * `readonly attributes_source: string | null` is an interface FIELD and
 * `['attributes_source', ...]` is an exclusion list. Neither is a write.
 *
 * A single regex could not separate them reliably — `\s*` happily matches zero
 * characters, so a negative lookahead for the type keyword slips past the space
 * and matches anyway. So the check is line-oriented and the exclusions are
 * explicit, which is both correct and legible. Tests 10b and 8 pin both
 * directions.
 */
function writesProvenanceStamp(code: string): boolean {
  return code.split('\n').some((line) => {
    if (!/attributes_source\s*:/.test(line)) return false;
    // A DECLARATION, not an assignment.
    if (/\b(?:readonly|interface|type)\b/.test(line)) return false;
    if (/attributes_source\s*:\s*(?:string|number|boolean|Date|unknown|any|null|undefined)\b/
      .test(line)) return false;
    return true;
  });
}

/** Invokes the atomic canonical write function. */
function callsCanonicalRpc(code: string): boolean {
  return /['"`]pi_apply_canonical_decisions['"`]/.test(code);
}

const filesWhere = (pred: (code: string) => boolean): string[] =>
  SOURCES.filter((s) => pred(s.code)).map((s) => s.rel).sort();

describe('CA — the scan actually sees the codebase', () => {
  it('1. walked a plausible number of source files', () => {
    // A scanner over an empty file list asserts nothing while reporting green.
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(SOURCES.some((s) => s.rel === 'backend/services/prospectIdentity/ingestionBoundary.ts'))
      .toBe(true);
  });
});

describe('CA — sole-writer enforcement over the real tree', () => {
  it('2. the atomic canonical write is invoked from exactly ONE module', () => {
    expect(callsCanonicalRpc).toBeDefined();
    expect(filesWhere(callsCanonicalRpc)).toEqual([
      'backend/services/prospectIdentity/ingestionBoundary.ts',
    ]);
  });

  it('3. the decision log has exactly ONE remaining TypeScript writer', () => {
    // Person and account decisions are written inside
    // `pi_apply_canonical_decisions` now, so the only module still opening this
    // table directly is the RELATIONSHIP producer — which has its own
    // atomicity remediation scope and is deliberately untouched here.
    //
    // If this list ever grows, a second code path is appending to the canonical
    // decision history, and that history is the audit record of why every
    // canonical value is what it is.
    expect(filesWhere((c) => opensTable(c, 'canonical_attribute_decisions'))).toEqual([
      'backend/services/prospectIdentity/relationshipAttributeIngestion.ts',
    ]);
  });

  it('4. only the relationship producer still builds a provenance patch in TypeScript', () => {
    // `attributes_source` + `attributes_updated_at` are the pair that marks a
    // row as having been written by arbitration. For person and account that
    // patch is now built in SQL, so no other module should construct one.
    const offenders = filesWhere(writesProvenanceStamp)
      .filter((f) => f !== 'backend/services/prospectIdentity/relationshipAttributeIngestion.ts');
    expect(offenders).toEqual([]);
  });

  it('5. no module outside the identity boundary opens a write on the person spine with an arbitrated column', () => {
    // Narrow and deliberate: this catches a module that both opens the
    // canonical table AND names an arbitrated attribute in an object literal.
    // Reads are untouched — many services legitimately select these columns.
    const ARBITRATED = ['job_title', 'seniority', 'employee_band', 'industry', 'buying_role'];
    const ALLOWED = [
      'backend/services/prospectIdentity/ingestionBoundary.ts',
      'backend/services/prospectIdentity/relationshipAttributeIngestion.ts',
      'backend/services/prospectIdentity/attributes.ts',
    ];
    const offenders = SOURCES.filter((s) => {
      if (ALLOWED.indexOf(s.rel) !== -1) return false;
      const opens = opensTable(s.code, 'unified_persons') || opensTable(s.code, 'prospect_accounts');
      if (!opens) return false;
      return ARBITRATED.some((col) => new RegExp(`${col}\\s*:`).test(s.code));
    }).map((s) => s.rel).sort();
    expect(offenders).toEqual([]);
  });
});

describe('CA — negative controls: the detectors catch a planted violation', () => {
  // Without these, every assertion above could be passing because the regexes
  // match nothing at all.

  it('6. a second decision-log writer would be detected', () => {
    const planted = `
      export async function sneak() {
        await ownedDbTable('canonical_attribute_decisions').insert({ attribute: 'job_title' });
      }`;
    expect(opensTable(stripComments(planted), 'canonical_attribute_decisions')).toBe(true);
  });

  it('7. a second caller of the atomic function would be detected', () => {
    const planted = `await ownedDbRpc('pi_apply_canonical_decisions', { p_target_id: id });`;
    expect(callsCanonicalRpc(stripComments(planted))).toBe(true);
  });

  it('8. a hand-rolled provenance patch would be detected', () => {
    const planted = `const patch = { attributes_source: provider, attributes_updated_at: now };`;
    expect(writesProvenanceStamp(stripComments(planted))).toBe(true);
  });

  it('9. an arbitrated-column write on the person spine would be detected', () => {
    const planted = `
      await ownedDbTable('unified_persons').update({ job_title: 'VP Sales' }).eq('id', id);`;
    const code = stripComments(planted);
    expect(opensTable(code, 'unified_persons')).toBe(true);
    expect(/job_title\s*:/.test(code)).toBe(true);
  });

  it('10. the detectors do NOT fire on prose, which is why comments are stripped', () => {
    const prose = `
      /**
       * Reads ownedDbTable('canonical_attribute_decisions') and builds
       * { attributes_source: provider }, calling 'pi_apply_canonical_decisions'.
       */
      // also ownedDbTable('unified_persons').update({ job_title: x })
      export const nothing = 1;`;
    const code = stripComments(prose);
    expect(opensTable(code, 'canonical_attribute_decisions')).toBe(false);
    expect(writesProvenanceStamp(code)).toBe(false);
    expect(callsCanonicalRpc(code)).toBe(false);
    expect(opensTable(code, 'unified_persons')).toBe(false);
  });

  it('10b. a TYPE declaration of the column is not mistaken for a write', () => {
    // This is the false positive that the first version of this detector
    // produced: `accountIntelligence.ts` declares the column on a read model
    // and excludes it from enrichment, and neither is an arbitrated write.
    expect(writesProvenanceStamp('readonly attributes_source: string | null;')).toBe(false);
    expect(writesProvenanceStamp("new Set(['attributes_source', 'attributes_updated_at'])")).toBe(false);
    // ...while a real assignment still is one.
    expect(writesProvenanceStamp('{ attributes_source: input.provider }')).toBe(true);
  });

  it('11. a bare mention of the table name is not mistaken for a write seam', () => {
    // `.eq('table', 'canonical_attribute_decisions')` style references, and
    // migration-name strings, must not count as opening a write.
    const mention = `const AUDITED = ['canonical_attribute_decisions', 'source_assertions'];`;
    expect(opensTable(stripComments(mention), 'canonical_attribute_decisions')).toBe(false);
  });
});
