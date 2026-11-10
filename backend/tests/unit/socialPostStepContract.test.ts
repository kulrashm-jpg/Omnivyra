/**
 * The `social_post` step contract: authoring validation, the unchanged `content`
 * channel, the status mapping, and the SQL ⇄ TypeScript vocabulary agreement of
 * 20261231000004 (static: reads files, reaches no database).
 */

import * as fs from 'fs';
import * as path from 'path';

import { validateWorkflowDefinition, WORKFLOW_STEP_CHANNELS, WorkflowError } from '../../services/workflows/workflowStore';
import { SOCIAL_POST_CHANNEL, parseSocialPostSettings } from '../../services/orchestration/socialPostStepContract';
import {
  SOCIAL_POST_OUTCOMES,
  SOCIAL_POST_TRIGGER_UNSUPPORTED,
  classifyScheduledPost,
  type ScheduledPostFacts,
} from '../../services/orchestration/socialPostPublicationStatus';

const ROOT = process.cwd();
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MIG = 'supabase/migrations/20270111100011_social_publish_step_channel.sql';
const ORIGINAL = 'supabase/migrations/20270111100001_pi_workflow_definitions.sql';
const ROLLBACK = 'supabase/migrations/rollbacks/social_publish_step_channel_rollback.sql';
const POST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const step = (over: Record<string, unknown> = {}) => ({
  key: 'launch', channel: 'social_post', delay_after_previous_hours: 0, execution_mode: 'assisted',
  social_post: { scheduled_post_id: POST }, ...over,
});

function refused(def: unknown, code: string): void {
  let err: unknown;
  try { validateWorkflowDefinition(def); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(WorkflowError);
  expect((err as WorkflowError).code).toBe(code);
}

describe('social_post — authoring', () => {
  it('is a new channel, appended; every existing channel keeps its place', () => {
    expect(SOCIAL_POST_CHANNEL).toBe('social_post');
    expect([...WORKFLOW_STEP_CHANNELS]).toEqual([
      'email', 'linkedin', 'phone', 'whatsapp', 'sms',
      'github', 'discord', 'slack', 'community', 'content', 'internal', 'social_post',
    ]);
  });

  it('accepts a step that references one released post by uuid (normalized)', () => {
    const d = validateWorkflowDefinition({ steps: [step({ social_post: { scheduled_post_id: ` ${POST.toUpperCase()} ` } })] });
    expect(d.steps[0]).toEqual({
      key: 'launch', channel: 'social_post', delay_after_previous_hours: 0, execution_mode: 'assisted',
      social_post: { scheduled_post_id: POST },
    });
  });

  it.each([
    ['no reference', { social_post: undefined }],
    ['null reference', { social_post: null }],
    ['array', { social_post: [POST] }],
    ['not a uuid', { social_post: { scheduled_post_id: 'latest' } }],
    ['copy smuggled in', { social_post: { scheduled_post_id: POST, text: 'Hello world' } }],
    ['account smuggled in', { social_post: { scheduled_post_id: POST, social_account_id: POST } }],
    ['time smuggled in', { social_post: { scheduled_post_id: POST, scheduled_for: '2026-11-01T00:00:00Z' } }],
    ['a trigger mode', { social_post: { scheduled_post_id: POST, mode: 'publish_now' } }],
  ])('refuses %s', (_l, over) => {
    refused({ steps: [step(over)] }, 'invalid_step_social_post');
  });

  it('refuses an instruction on a social_post step (it publishes nothing of its own)', () => {
    refused({ steps: [step({ instruction: 'Write a punchy post' })] }, 'invalid_step_instruction');
  });

  it('parseSocialPostSettings is structural only and names the step', () => {
    const r = parseSocialPostSettings({ scheduled_post_id: 'x' }, 'k1');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toContain('step "k1"');
  });
});

describe('content — UNCHANGED (share a resource with a prospect)', () => {
  it('is still authorable exactly as before, instruction included, with no reference', () => {
    const d = validateWorkflowDefinition({ steps: [step({ channel: 'content', social_post: undefined, instruction: 'Share the case study' })] });
    expect(d.steps[0]).toEqual({
      key: 'launch', channel: 'content', delay_after_previous_hours: 0, execution_mode: 'assisted',
      instruction: 'Share the case study',
    });
  });

  it('may not carry a social_post reference (no channel but social_post may)', () => {
    for (const channel of ['content', 'email', 'community', 'internal']) {
      refused({ steps: [step({ channel })] }, 'invalid_step_engine_settings');
    }
  });

  it('the planner and task generator meaning of content is untouched', () => {
    expect(read('backend/services/automationExecution/taskGenerator.ts')).toMatch(/step\.channel === 'content' \? 'content' : 'outreach'/);
    expect(read('backend/services/automationExecution/taskGenerator.ts')).not.toMatch(/social_post/);
    expect(read('backend/services/qualificationPlanning/planningConfig.ts')).not.toMatch(/social_post/);
  });
});

describe('social_post — status mapping (pure)', () => {
  const f = (over: Partial<ScheduledPostFacts> = {}): ScheduledPostFacts => ({
    id: POST, status: 'scheduled', platform_post_id: null, error_code: null, is_thread_start: false,
    has_content: true, campaign_id: null, ...over,
  });

  it.each([
    [{ platform_post_id: 'urn:1', status: 'published' }, 'published', 'completed'],
    [{ status: 'scheduled' }, 'awaiting_publication', 'wait'],
    [{ status: 'publishing' }, 'publishing', 'wait'],
    [{ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }, 'uncertain', 'needs_human'],
    [{ status: 'scheduled', error_code: 'PUBLISH_CALL_STARTED' }, 'uncertain', 'needs_human'],
    [{ status: 'published' }, 'uncertain', 'needs_human'],
    [{ status: 'failed', error_code: 'X' }, 'publish_failed', 'needs_human'],
    [{ status: 'cancelled' }, 'cancelled', 'skipped'],
    [{ status: 'draft' }, 'not_released', 'needs_human'],
    [{ status: null }, 'not_released', 'needs_human'],
    [{ status: 'blocked' }, 'blocked', 'needs_human'],
    [{ campaign_id: POST, campaign_status: 'completed' }, 'PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE', 'needs_human'],
    [{ has_content: false }, 'PUBLISH_BLOCKED_POST_NO_CONTENT', 'needs_human'],
    [{ is_thread_start: true, platform_post_id: 'urn:1' }, 'thread_unsupported', 'needs_human'],
  ])('%j → %s / %s', (over, outcome, disposition) => {
    const c = classifyScheduledPost(f(over as Partial<ScheduledPostFacts>));
    expect(c.outcome).toBe(outcome);
    expect(c.disposition).toBe(disposition);
    if (disposition !== 'completed') expect(c.reason).toBeTruthy();
  });

  it('never chooses failed, and every named outcome is in the vocabulary', () => {
    expect(SOCIAL_POST_OUTCOMES).toContain('uncertain');
    expect(SOCIAL_POST_TRIGGER_UNSUPPORTED).toMatch(/no per-task publish request/);
  });
});

describe('20261231000004 — SQL ⇄ TypeScript agreement', () => {
  const sql = read(MIG);
  const migrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort();

  it('is the LATEST definer of publish_workflow_version and accepts exactly WORKFLOW_STEP_CHANNELS', () => {
    const definers = migrations.filter((x) => /CREATE OR REPLACE FUNCTION public\.publish_workflow_version\(/.test(read(`supabase/migrations/${x}`)));
    expect(definers).toEqual(['20270111100001_pi_workflow_definitions.sql', '20270111100011_social_publish_step_channel.sql']);
    const m = /\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = [...(m as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...WORKFLOW_STEP_CHANNELS].sort());
  });

  it('changes the function ONLY by the channel list and the social_post rule', () => {
    const fn = (src: string) => src.slice(
      src.indexOf('CREATE OR REPLACE FUNCTION public.publish_workflow_version('),
      src.indexOf('\n$$;', src.indexOf('CREATE OR REPLACE FUNCTION public.publish_workflow_version(')),
    ).replace(/\r/g, '');
    const before = fn(read(ORIGINAL));
    const after = fn(sql);
    // Remove the two additions; what remains must be the original body verbatim.
    const stripped = after
      .replace(/\n {2}-- internal step could never be published\)\. `social_post` \(20261231000004\): a\n {2}-- public post that awaits one released scheduled post; never `content`\./, '\n  -- internal step could never be published).')
      .replace(/'content', 'internal',\n\s+'social_post'\)/, "'content', 'internal')")
      .replace(/\n {4}RAISE EXCEPTION 'wf_publish:invalid_step' USING ERRCODE = '23514';\n {2}END IF;\n\n {2}-- A social_post step[\s\S]*?\n {2}\) THEN\n/, '\n');
    expect(stripped).toBe(before);
    expect(after).toMatch(/s\.value \? 'social_post'/);
    expect(after).toMatch(/COALESCE\(/);
  });

  it('does not edit 20261227000000, touches no table, and has a guarded rollback', () => {
    // (The replaced function body itself UPDATEs workflow_versions, as before.)
    expect(sql).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE|DELETE FROM|INSERT INTO/i);
    expect(sql).toMatch(/to_regprocedure\('public\.publish_workflow_version\(uuid, uuid, uuid\)'\) IS NULL/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.publish_workflow_version\(uuid, uuid, uuid\) TO service_role/);
    expect(sql).toMatch(/rollbacks\/social_publish_step_channel_rollback\.sql/);
    const rb = read(ROLLBACK);
    expect(rb).toMatch(/\(s\.value ->> 'channel'\) = 'social_post'[\s\S]*RAISE EXCEPTION 'rollback refused/);
    // The rollback restores the ORIGINAL function verbatim.
    const HEAD = 'CREATE OR REPLACE FUNCTION public.publish_workflow_version(';
    const fnOf = (src: string) => src.slice(src.indexOf(HEAD), src.indexOf('\n$$;', src.indexOf(HEAD))).replace(/\r/g, '');
    expect(fnOf(rb).length).toBeGreaterThan(1000);
    expect(fnOf(rb)).toBe(fnOf(read(ORIGINAL)));
  });
});
