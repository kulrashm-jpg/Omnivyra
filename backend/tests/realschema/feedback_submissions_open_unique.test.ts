/**
 * 20270217000002_feedback_submissions_open_unique - COMMITTED real-schema evidence
 * (05 / e9 rule, 2026-11-12: sandbox-only evidence does not close a unit).
 * The CI replay installs the index. Each case runs in a rolled-back transaction.
 */
import { attempt, db, inRollback } from './setup';

const U = '00000000-0000-4000-8000-0000000002a1';
const U2 = '00000000-0000-4000-8000-0000000002a2';
const ORG = '00000000-0000-4000-8000-0000000002c0';
type Step = readonly [string, unknown[]];
const ins = (u: string, status: string): Step =>
  [`INSERT INTO public.feedback_submissions (user_id, organization_id, feedback_text, status) VALUES ($1, $2, 't', $3)`, [u, ORG, status]];

beforeAll(async () => {
  const r = (await db.query(
    `SELECT i.indisunique AND i.indisvalid AS ok, pg_get_expr(i.indpred, i.indrelid) AS pred
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'feedback_submissions_one_open_per_user'`)).rows[0];
  if (!r) throw new Error('20270217000002 is NOT installed - refusing to pass vacuously');
  expect(r.ok).toBe(true);
  expect(r.pred).toMatch(/pending/);
  expect(r.pred).toMatch(/approved/);
});

const seq = (steps: Array<readonly [string, unknown[]]>) => inRollback(async () => {
  const out: string[] = [];
  for (const [sql, params] of steps) out.push(await attempt(sql, params));
  return out;
});
// attempt() rolls each statement back to its savepoint, so a state that must
// PERSIST across steps is applied with db.query inside the same rollback block.
const persist = (steps: Array<readonly [string, unknown[]]>, probe: readonly [string, unknown[]]) => inRollback(async () => {
  for (const [sql, params] of steps) await db.query(sql, params);
  return attempt(probe[0], probe[1]);
});

it('a second PENDING submission by the same user is refused (23505)', async () => {
  expect(await persist([ins(U, 'pending')], ins(U, 'pending'))).toBe('23505');
});
it('pending + approved for the same user cannot coexist (23505)', async () => {
  expect(await persist([ins(U, 'approved')], ins(U, 'pending'))).toBe('23505');
});
it('approval is PERMANENT: a new submission after an approved one is refused', async () => {
  expect(await persist([ins(U, 'approved')], ins(U, 'pending'))).toBe('23505');
});
it('resubmission after a REJECTED one is allowed', async () => {
  expect(await persist([ins(U, 'rejected')], ins(U, 'pending'))).toBe('ok');
});
it('rejected rows never collide with each other', async () => {
  expect(await persist([ins(U, 'rejected'), ins(U, 'rejected')], ins(U, 'rejected'))).toBe('ok');
});
it('a different user is unaffected', async () => {
  expect(await persist([ins(U, 'pending')], ins(U2, 'pending'))).toBe('ok');
});
it('control: a single pending submission succeeds', async () => {
  expect(await seq([ins(U, 'pending')])).toEqual(['ok']);
});
