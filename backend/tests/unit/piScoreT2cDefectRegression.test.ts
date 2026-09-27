/**
 * PI-SCORE-PROVENANCE-001-T2C — regression lock for the two defects that real
 * transport certification exposed.
 *
 * Both were invisible to the existing seam tests, and for the same reason: those
 * tests inject the ports whose SQL was wrong. A port that is always replaced is
 * never executed, so no assertion about it can fail. These tests therefore read
 * the SOURCE of the production queries rather than calling through an injected
 * double — the only level at which a wrong column name is observable without a
 * live database.
 *
 * This is a deliberately narrow technique, used because the alternative is a
 * defect class that ships silently: a query naming a column the schema does not
 * have fails at PostgREST, the error is caught, and an hourly job reports a
 * clean cycle having done nothing at all.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const JOB = readFileSync(join(ROOT, 'backend/jobs/prospectScoreEvaluationJob.ts'), 'utf8');
const STORE = readFileSync(join(ROOT, 'backend/services/leadUnderstanding/scoreEvaluationStore.ts'), 'utf8');

/** Executable statements only — a column named in a comment proves nothing. */
const code = (src: string): string =>
  src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('T2C defect 1 — due-prospect discovery names a column that exists', () => {
  it('orders canonical_leads by created_at', () => {
    expect(code(JOB)).toContain(".order('created_at'");
  });

  it('never orders canonical_leads by updated_at — that column does not exist', () => {
    // The schema has: id, company_id, user_id, source, created_at,
    // qualification_score, external_lead_key, lead_status, lead_metadata,
    // unified_person_id. There is no updated_at, and ordering by it yields 42703.
    expect(code(JOB)).not.toContain(".order('updated_at'");
  });

  it('reports a failed discovery query instead of returning a silent empty list', () => {
    // The defect survived because `if (error || !Array.isArray(data)) return []`
    // made "the query broke" and "this tenant has no work" the same observation.
    expect(code(JOB)).toContain('prospect_score_due_query_failed');
  });
});

describe('T2C defect 2 — latest evaluation selection is deterministic', () => {
  it('orders by scored_at first', () => {
    expect(code(STORE)).toContain(".order('scored_at', { ascending: false })");
  });

  it('breaks ties on evaluated_at, so equal scored_at cannot be ambiguous', () => {
    expect(code(STORE)).toContain(".order('evaluated_at', { ascending: false })");
  });

  it('applies the tiebreaker AFTER the primary sort', () => {
    const c = code(STORE);
    expect(c.indexOf(".order('scored_at'")).toBeLessThan(c.indexOf(".order('evaluated_at'"));
  });
});

describe('T2C — the fixes are query corrections, not scoring changes', () => {
  it('neither file computes a score, a weight or a threshold', () => {
    for (const src of [code(JOB), code(STORE)]) {
      expect(src).not.toMatch(/\bweight\s*[:=]/i);
      expect(src).not.toMatch(/\bthreshold\s*[:=]/i);
    }
  });

  it('the store still records the rules version rather than deriving one', () => {
    expect(code(STORE)).toContain('SCORING_RULES_VERSION');
  });
});
