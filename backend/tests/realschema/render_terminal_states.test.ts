/**
 * RENDER_TERMINAL_STATES (renderTerminalStates.ts) is a hand copy of guard_render_state_monotonic's
 * v_terminal. Nothing else fails if the SQL set gains a state, and the sync executor would then read a
 * new terminal state as "in progress, retryable" and loop (05 nit on eebd5e261). This pins the two BY
 * NAME against the function body in the replayed schema, in both directions, and against the
 * current_state CHECK (every terminal state must be a legal state).
 *
 * A green run concerns a disposable database built from the committed baseline plus replayed
 * migrations. It is NOT evidence about production.
 */
import { db } from './setup';
import { RENDER_TERMINAL_STATES } from '../../services/creator/rendering/renderTerminalStates';

async function sqlTerminalSet(): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'guard_render_state_monotonic'`,
  );
  expect(rows).toHaveLength(1);
  const src: string = rows[0].prosrc;
  const m = /v_terminal\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\s*\[([\s\S]*?)\]/i.exec(src);
  expect(m).not.toBeNull();
  const names = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

describe('RENDER_TERMINAL_STATES matches guard_render_state_monotonic by name', () => {
  it('every SQL terminal state is in the TypeScript set, and nothing extra', async () => {
    const sql = await sqlTerminalSet();
    expect([...new Set(sql)].sort()).toEqual([...RENDER_TERMINAL_STATES].sort());
  });

  it('every terminal state is a legal current_state (the CHECK admits it)', async () => {
    const { rows } = await db.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
        WHERE c.conrelid = 'public.creator_render_job_state'::regclass AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%current_state%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const def = rows.map((r: { def: string }) => r.def).join(' ');
    for (const s of RENDER_TERMINAL_STATES) expect(def).toContain(`'${s}'`);
  });

  it('CONTROL: the extractor is not vacuous (it would see a state missing from the TypeScript set)', async () => {
    const sql = await sqlTerminalSet();
    const shrunk = new Set([...RENDER_TERMINAL_STATES].filter((s) => s !== sql[0]));
    expect([...new Set(sql)].sort()).not.toEqual([...shrunk].sort());
  });
});
