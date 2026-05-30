/**
 * Daily-row policy wiring tests (closure-pass follow-up Part 1).
 *
 * Exercises the SKIP-AND-RECORD + ABORT-ALL-REJECTED policy at the
 * row-validation boundary by re-running the same decision logic in
 * isolation. The boundary lives inside generate-weekly-structure
 * (where running the full handler would require a live planner +
 * Supabase), so we extract the logic into a tiny harness and assert
 * the policy contracts the spec calls out:
 *
 *   - Valid rows pass through untouched.
 *   - CTA-only failures keep the row (warning-class).
 *   - Hard failures drop the row + emit a diagnostic record.
 *   - When every row is rejected we throw DAILY_PLAN_ROW_INVALID.
 *   - When no boltRunId is present we still drop bad rows but skip
 *     the diagnostic write (non-BOLT callers don't pollute the table).
 */

import { validateDailyPlanRow } from '../../../lib/shared/bolt/validateDailyPlanRow';
import {
  BoltError,
  BOLT_ERROR_CODES,
} from '../../../lib/shared/bolt/boltErrorCodes';

type Row = Record<string, unknown>;

interface DiagRecord {
  runId: string;
  code: string;
}

interface ApplyResult {
  validatedRows: Row[];
  diagnostics: DiagRecord[];
}

/** Mirrors the boundary in generate-weekly-structure.ts so we can
 *  unit-test the policy without standing up the full handler. */
function applyDailyRowPolicy(rows: Row[], boltRunId: string | null): ApplyResult {
  const diagnostics: DiagRecord[] = [];
  const validated: Row[] = [];
  for (const row of rows) {
    const r = validateDailyPlanRow(row as any);
    if (r.ok) { validated.push(row); continue; }
    const hardErrors = r.errors.filter((e) => e.code !== BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA);
    const shouldKeep = hardErrors.length === 0;
    if (shouldKeep) validated.push(row);
    if (boltRunId) {
      for (const e of r.errors) {
        diagnostics.push({ runId: boltRunId, code: e.code });
      }
    }
  }
  if (validated.length === 0 && rows.length > 0) {
    throw new BoltError(
      BOLT_ERROR_CODES.DAILY_PLAN_ROW_INVALID,
      `All ${rows.length} generated rows failed validation.`,
      { details: { rejected_count: rows.length, sample_run_id: boltRunId } }
    );
  }
  return { validatedRows: validated, diagnostics };
}

const valid = () => ({
  week_number: 1,
  platform: 'linkedin',
  content_type: 'post',
  cta: 'visit site',
});

describe('Daily-row policy — SKIP-AND-RECORD', () => {
  test('all valid rows pass through with zero diagnostics', () => {
    const out = applyDailyRowPolicy([valid(), valid()], 'run-1');
    expect(out.validatedRows).toHaveLength(2);
    expect(out.diagnostics).toEqual([]);
  });

  test('CTA-only failure keeps the row (warning-class)', () => {
    const out = applyDailyRowPolicy([{ ...valid(), cta: '' }], 'run-1');
    expect(out.validatedRows).toHaveLength(1);
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics[0].code).toBe(BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CTA);
  });

  test('hard failure drops the row + emits diagnostic', () => {
    const out = applyDailyRowPolicy([{ ...valid(), platform: '' }, valid()], 'run-1');
    expect(out.validatedRows).toHaveLength(1);
    expect(out.diagnostics.some((d) => d.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM)).toBe(true);
  });

  test('multiple distinct codes per row are all recorded', () => {
    // Include a sibling valid row so the all-rejected abort path
    // doesn't fire — this test is about per-row diagnostic coverage.
    const out = applyDailyRowPolicy(
      [{ ...valid(), platform: '', content_type: 'webinar' }, valid()],
      'run-1'
    );
    expect(out.diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(out.diagnostics.some((d) => d.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_PLATFORM)).toBe(true);
    expect(out.diagnostics.some((d) => d.code === BOLT_ERROR_CODES.DAILY_PLAN_INVALID_CONTENT_TYPE)).toBe(true);
  });
});

describe('Daily-row policy — ABORT-ALL-REJECTED', () => {
  test('throws DAILY_PLAN_ROW_INVALID when every row is hard-rejected', () => {
    try {
      applyDailyRowPolicy([{ ...valid(), platform: '' }, { ...valid(), content_type: 'webinar' }], 'run-1');
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BoltError);
      expect((e as BoltError).code).toBe(BOLT_ERROR_CODES.DAILY_PLAN_ROW_INVALID);
      expect((e as BoltError).details?.rejected_count).toBe(2);
    }
  });

  test('does NOT throw when at least one row passes', () => {
    expect(() => applyDailyRowPolicy([{ ...valid(), platform: '' }, valid()], 'run-1')).not.toThrow();
  });
});

describe('Daily-row policy — non-BOLT caller', () => {
  test('no runId still drops bad rows but skips diagnostics writes', () => {
    const out = applyDailyRowPolicy([{ ...valid(), platform: '' }, valid()], null);
    expect(out.validatedRows).toHaveLength(1);
    expect(out.diagnostics).toEqual([]);
  });
});
