/**
 * Migration verification (static-analysis style).
 *
 * These tests assert that the migrations adding:
 *   - scheduled_post_id FK column + backfill + partial index
 *   - advisory-lock RPCs (try_scheduled_post_lock / release_*)
 *   - resumable_session_started_at column + index
 *
 * are PRESENT in the migration files. A real "apply against a fixture
 * DB" test would require docker-compose / pg / etc. — out of scope for
 * the unit-test runner. This guards against accidental migration
 * deletion / drift while a true integration test is queued for CI.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function loadMigration(name: string): string {
  return readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', name), 'utf-8');
}

describe('creator attachment workflow migrations', () => {
  describe('20260656_creator_attachment_scheduled_post_fk.sql', () => {
    const sql = loadMigration('20260656_creator_attachment_scheduled_post_fk.sql');

    test('adds scheduled_post_id column to daily_content_plans', () => {
      expect(sql).toMatch(/ADD COLUMN scheduled_post_id UUID/i);
      expect(sql).toMatch(/table_name = 'daily_content_plans'/);
      expect(sql).toMatch(/column_name = 'scheduled_post_id'/);
    });

    test('declares FK constraint with ON DELETE SET NULL', () => {
      expect(sql).toMatch(/FOREIGN KEY \(scheduled_post_id\)/i);
      expect(sql).toMatch(/REFERENCES public\.scheduled_posts\(id\)/i);
      expect(sql).toMatch(/ON DELETE SET NULL/i);
    });

    test('backfills from content->>scheduled_post_id with UUID validation', () => {
      expect(sql).toMatch(/dcp\.content->>'scheduled_post_id'/);
      // UUID regex pattern in the migration
      expect(sql).toMatch(/\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/);
    });

    test('handles orphan IDs (nulls them) before retrying FK creation', () => {
      expect(sql).toMatch(/UPDATE public\.daily_content_plans dcp[\s\S]*SET scheduled_post_id = NULL/);
      expect(sql).toMatch(/EXCEPTION WHEN OTHERS/);
    });

    test('creates partial index on (scheduled_post_id) WHERE NOT NULL', () => {
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_daily_content_plans_scheduled_post_id/);
      expect(sql).toMatch(/WHERE scheduled_post_id IS NOT NULL/i);
    });

    test('is idempotent (IF NOT EXISTS guards)', () => {
      expect(sql).toMatch(/IF NOT EXISTS/);
      // No accidental DROP TABLE / TRUNCATE
      expect(sql).not.toMatch(/DROP\s+TABLE/i);
      expect(sql).not.toMatch(/TRUNCATE/i);
    });
  });

  describe('20260657_creator_attachment_queue_lock_and_janitor.sql', () => {
    const sql = loadMigration('20260657_creator_attachment_queue_lock_and_janitor.sql');

    test('declares try_scheduled_post_lock(uuid) function returning boolean', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.try_scheduled_post_lock\(p_scheduled_post_id UUID\)/i);
      expect(sql).toMatch(/RETURNS boolean/i);
      expect(sql).toMatch(/pg_try_advisory_lock\(v_high, v_low\)/);
    });

    test('declares release_scheduled_post_lock(uuid) paired function', () => {
      expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.release_scheduled_post_lock\(p_scheduled_post_id UUID\)/i);
      expect(sql).toMatch(/pg_advisory_unlock\(v_high, v_low\)/);
    });

    test('adds resumable_session_started_at TIMESTAMPTZ column', () => {
      expect(sql).toMatch(/ADD COLUMN resumable_session_started_at TIMESTAMPTZ/i);
      expect(sql).toMatch(/column_name = 'resumable_session_started_at'/);
    });

    test('creates janitor lookup index keyed on session start + content_status', () => {
      expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_daily_content_plans_resumable_session/);
      expect(sql).toMatch(/WHERE resumable_session_started_at IS NOT NULL/i);
    });

    test('functions use pg_try_advisory_lock (NOT pg_advisory_xact_lock which blocks)', () => {
      // Critical: the lock must be non-blocking so the API doesn't stall
      // on contention. We assert the explicit try-variant is used.
      expect(sql).toMatch(/pg_try_advisory_lock/);
      expect(sql).not.toMatch(/pg_advisory_xact_lock/);
    });
  });
});
