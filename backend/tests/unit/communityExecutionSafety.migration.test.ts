/**
 * Static contract for 20261231000002_community_execution_safety.sql and its
 * rollback. No database is started here; the integration owner verifies the
 * pair on a disposable PostgreSQL. These checks pin the properties that must
 * not regress: guarded, idempotent, widening-only, explicit vocabulary that
 * matches the code, refusing rollback.
 */
import fs from 'fs';
import path from 'path';
import { COMMUNITY_STATUS_VOCABULARY } from './helpers/communityExecutionFakeDb';

const root = path.resolve(__dirname, '../../..');
const MIG = fs.readFileSync(path.join(root, 'supabase/migrations/20261231000002_community_execution_safety.sql'), 'utf8');
const RB = fs.readFileSync(path.join(root, 'supabase/migrations/rollbacks/community_execution_safety_rollback.sql'), 'utf8');
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const vocabFrom = (sql: string): string[][] =>
  Array.from(sql.matchAll(/v_vocab text\[\] := ARRAY\[([^\]]+)\]/g)).map((m) =>
    Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]));

describe('community execution safety migration (static contract)', () => {
  it('has no CR or control bytes', () => {
    for (const s of [MIG, RB]) expect(/[\r\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)).toBe(false);
  });

  it('declares the explicit vocabulary identically in body and postcondition', () => {
    const v = vocabFrom(MIG);
    expect(v).toHaveLength(2);
    expect(v[0]).toEqual(v[1]);
    expect(new Set(v[0])).toEqual(COMMUNITY_STATUS_VOCABULARY);
  });

  it('vocabulary covers every status the engine code writes', () => {
    const vocab = vocabFrom(MIG)[0];
    for (const s of ['executing', 'uncertain', 'approved', 'pending', 'executed', 'sent_unverified', 'failed', 'skipped', 'blocked']) {
      expect(vocab).toContain(s);
    }
    // Agent B contract: pending | approved | executing | executed | failed | skipped | uncertain
    for (const s of ['pending', 'approved', 'executing', 'executed', 'failed', 'skipped', 'uncertain']) {
      expect(vocab).toContain(s);
    }
    const runtime = code('backend/services/communityAiActionExecutorRuntime.ts');
    expect(runtime).toMatch(/status: 'executing'/);
    expect(runtime).toMatch(/'deferred' \? 'approved'/);
  });

  it('is guarded: preconditions, widening-only refusal, postconditions', () => {
    expect(MIG).toMatch(/to_regclass\('public\.community_ai_actions'\) IS NULL/);
    expect(MIG).toMatch(/to_regclass\('public\.rpa_retry_queue'\) IS NULL/);
    expect(MIG).toMatch(/unexpected status CHECK shape/);
    expect(MIG).toMatch(/which the new vocabulary lacks/);
    expect(MIG).toMatch(/rows hold a status outside the vocabulary/);
    expect(MIG).toMatch(/postcondition: status CHECK is/);
    expect(MIG).toMatch(/postcondition: rpa_retry_queue claim is incomplete/);
  });

  it('is idempotent', () => {
    expect(MIG).toMatch(/already is the complete vocabulary/);
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS claim_token text/);
    expect(MIG).toMatch(/ADD COLUMN IF NOT EXISTS claimed_at timestamptz/);
    expect(MIG).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint[\s\S]*rpa_retry_queue_claim_pair/);
    expect((MIG.match(/CREATE INDEX IF NOT EXISTS/g) || []).length).toBe(2);
    expect(MIG).not.toMatch(/CREATE INDEX (?!IF NOT EXISTS)/);
  });

  it('records the prior CHECK definition for the rollback', () => {
    expect(MIG).toMatch(/COMMENT ON CONSTRAINT community_ai_actions_status_check[\s\S]*prior_definition: /);
    expect(RB).toMatch(/community_execution_safety prior_definition: /);
  });

  it('touches only its own objects (no reaper, no other tables, no data rewrite)', () => {
    expect(MIG).not.toMatch(/CREATE OR REPLACE FUNCTION/i);
    expect(MIG).not.toMatch(/^\s*UPDATE\s/im);
    expect(MIG).not.toMatch(/^\s*DELETE\s/im);
    const tables = new Set(Array.from(MIG.matchAll(/ALTER TABLE public\.(\w+)/g)).map((m) => m[1]));
    expect(Array.from(tables).sort()).toEqual(['community_ai_actions', 'rpa_retry_queue']);
  });

  it('claim columns match the code', () => {
    const q = code('backend/services/rpaWorker/rpaRetryQueue.ts');
    expect(q).toMatch(/\.is\('claim_token', null\)/);
    expect(q).toMatch(/claim_token: input\.claimToken, claimed_at: input\.nowIso/);
    expect(q).toMatch(/claim_token: null,\s*claimed_at: null/);
  });

  it('rollback refuses when it would lose data or safety information', () => {
    expect(RB).toMatch(/prior status CHECK definition not recorded; refusing/);
    expect(RB).toMatch(/rows hold a status the prior CHECK forbids/);
    expect(RB).toMatch(/rpa_retry_queue rows are claimed \(possibly executed\)/);
    // refusals precede every destructive statement
    const firstDrop = RB.search(/DROP (CONSTRAINT|INDEX|COLUMN)/);
    expect(RB.indexOf('refusing')).toBeLessThan(firstDrop);
    expect(RB.indexOf('possibly executed')).toBeLessThan(firstDrop);
    expect(RB).toMatch(/rollback postcondition/);
  });

  it('slot and rollback name follow the repo convention', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/20261231000002_community_execution_safety.sql'))).toBe(true);
    expect(MIG).toMatch(/rollbacks\/community_execution_safety_rollback\.sql/);
  });
});
