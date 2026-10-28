/**
 * NEGATIVE tests for the SQL ⇄ TypeScript channel vocabulary check
 * (helpers/publishChannelVocabulary.ts, used by orchestrationTargetingContract.test.ts)
 * and for the 032 channel vocabulary, after c21771d4 widened both for `social_post`.
 *
 * Each case starts from the REAL migration set and changes exactly one thing,
 * proving the revised checks still reject it. Reads files only.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  CHANNEL_NAME,
  FIRST_PUBLISH_DEFINER,
  checkPublishChannelVocabulary,
  parseSqlChannelList,
  publishFunctionDefiners,
  type MigrationText,
} from './helpers/publishChannelVocabulary';
import { WORKFLOW_STEP_CHANNELS, WorkflowError, validateWorkflowDefinition } from '../../services/workflows/workflowStore';

const MIG_DIR = path.join(process.cwd(), 'supabase/migrations');
const LATEST = '20261231000004_social_publish_step_channel.sql';
const RATIFIED = [
  'email', 'linkedin', 'phone', 'whatsapp', 'sms',
  'github', 'discord', 'slack', 'community', 'content', 'internal', 'social_post',
] as const;

const real: MigrationText[] = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(MIG_DIR, name), 'utf8') }));

const REAL_LIST_TAIL = "'content', 'internal',\n             'social_post')";

/** The real set with LATEST's channel list tail replaced. */
function withLatestTail(tail: string): MigrationText[] {
  return real.map((f) => {
    if (f.name !== LATEST) return f;
    const sql = f.sql.replace(/\r/g, '');
    expect(sql).toContain(REAL_LIST_TAIL);   // the mutation must actually apply
    return { name: f.name, sql: sql.replace(REAL_LIST_TAIL, tail) };
  });
}

const problemsOf = (files: readonly MigrationText[], ts: readonly string[] = WORKFLOW_STEP_CHANNELS, ratified: readonly string[] | undefined = RATIFIED): string[] => {
  const r = checkPublishChannelVocabulary(files, ts, ratified);
  return r.ok === false ? r.problems : [];
};

const HEAD = 'CREATE OR REPLACE FUNCTION public.publish_workflow_version(';
/** The real 20261227000000 function, re-emitted by a later migration with a mutation. */
function laterRedefinition(name: string, mutate: (fn: string) => string): MigrationText {
  const original = (real.find((f) => f.name === FIRST_PUBLISH_DEFINER) as MigrationText).sql.replace(/\r/g, '');
  const start = original.indexOf(HEAD);
  const end = original.indexOf('\n$$;', start) + '\n$$;'.length;
  return { name, sql: `-- later migration\n${mutate(original.slice(start, end))}\n` };
}

describe('the real migration set passes (baseline for every negative case)', () => {
  it('passes, with exactly two definers, the first being 20261227000000', () => {
    expect(checkPublishChannelVocabulary(real, WORKFLOW_STEP_CHANNELS, RATIFIED)).toEqual({
      ok: true, latestDefiner: LATEST, channels: [...RATIFIED].sort(),
    });
    expect(publishFunctionDefiners(real)).toEqual([FIRST_PUBLISH_DEFINER, LATEST]);
  });

  it('the first definer still carries the original 11 channels (social_post is additive only)', () => {
    const first = real.find((f) => f.name === FIRST_PUBLISH_DEFINER) as MigrationText;
    const parsed = parseSqlChannelList(first.sql.replace(/\r/g, ''));
    expect(parsed).toEqual({ ok: true, channels: RATIFIED.filter((c) => c !== 'social_post') });
  });
});

describe('an invalid channel name in the SQL list is a failure, never skipped', () => {
  // The c21771d4 regex /'([a-z_]+)'/ (and the /'([a-z]+)'/ before it) silently dropped
  // every one of these, so SQL could accept a channel the test never saw.
  it.each([
    ['uppercase', "'SOCIAL_POST'"],
    ['mixed case', "'Social_post'"],
    ['hyphen', "'social-post'"],
    ['space', "'social post'"],
    ['digit-leading', "'1social'"],
    ['digit inside', "'social2'"],
    ['leading underscore', "'_social'"],
    ['trailing underscore', "'social_'"],
    ['double underscore', "'social__post'"],
    ['empty literal', "''"],
    ['unquoted identifier', 'social_post'],
    ['double-quoted', '"social_post"'],
  ])('%s (%s) appended to the list → rejected', (_l, extra) => {
    const p = problemsOf(withLatestTail(`'content', 'internal',\n             'social_post', ${extra})`));
    expect(p.length).toBeGreaterThan(0);
    expect(p.join('\n')).toMatch(/invalid channel name|not a string literal/);
  });

  it('WHY HARDENED: the c21771d4 extraction would have PASSED an invalid extra channel', () => {
    const mutated = withLatestTail("'content', 'internal',\n             'social_post', 'Social-Post')")
      .find((f) => f.name === LATEST) as MigrationText;
    const m = /\(s\.value ->> 'channel'\) NOT IN \(([^)]*)\)/.exec(mutated.sql) as RegExpExecArray;
    const c21771d4 = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(c21771d4).toEqual([...WORKFLOW_STEP_CHANNELS].sort());          // the old check: silently equal
    expect(problemsOf([...real.filter((f) => f.name !== LATEST), mutated]))  // the hardened check: refused
      .toContain('20261231000004_social_publish_step_channel.sql: invalid channel name: "Social-Post"');
  });

  it.each(['SOCIAL_POST', 'social-post', 'social post', '1abc', '_x', 'x_', 'a__b', '', 'Email'])(
    'CHANNEL_NAME refuses %j', (name) => { expect(CHANNEL_NAME.test(name)).toBe(false); });

  it.each([...RATIFIED])('CHANNEL_NAME accepts the ratified %s', (name) => { expect(CHANNEL_NAME.test(name)).toBe(true); });

  it('a duplicated channel is rejected', () => {
    expect(problemsOf(withLatestTail("'content', 'internal',\n             'social_post', 'email')")).join('\n'))
      .toMatch(/duplicate channel: email/);
  });
});

describe('SQL and TypeScript must agree in both directions', () => {
  it('a channel in SQL but not in TypeScript → rejected', () => {
    const p = problemsOf(withLatestTail("'content', 'internal',\n             'social_post', 'twitter')"));
    expect(p).toContain('in SQL, not in TypeScript: twitter');
  });

  it('a channel in TypeScript but not in SQL → rejected', () => {
    const p = problemsOf(withLatestTail("'content', 'internal')"));
    expect(p).toContain('in TypeScript, not in SQL: social_post');
  });

  it('an invalid TypeScript channel name → rejected even if SQL had it skipped', () => {
    const p = problemsOf(real, [...WORKFLOW_STEP_CHANNELS, 'Social-Post'], undefined);
    expect(p).toContain('invalid TypeScript channel name: "Social-Post"');
  });

  it('an unexpected 13th channel on BOTH sides is still rejected by the ratified pin', () => {
    const files = withLatestTail("'content', 'internal',\n             'social_post', 'twitter')");
    const ts = [...WORKFLOW_STEP_CHANNELS, 'twitter'];
    // Without the independent pin the two sides agree…
    expect(checkPublishChannelVocabulary(files, ts).ok).toBe(true);
    // …with it, the 13th channel is refused until the ratified contract changes.
    expect(problemsOf(files, ts)).toEqual(['not ratified: twitter']);
  });
});

describe('the definer chain', () => {
  it('a later migration that redefines the function WITHOUT social_post → rejected (it becomes the latest)', () => {
    const files = [...real, laterRedefinition('20270101000000_regress.sql', (fn) => fn)];
    const r = checkPublishChannelVocabulary(files, WORKFLOW_STEP_CHANNELS, RATIFIED);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.problems).toContain('in TypeScript, not in SQL: social_post');
  });

  it('a later redefinition with NO channel list at all → rejected', () => {
    const files = [...real, laterRedefinition('20270101000000_regress.sql',
      (fn) => fn.replace(/OR \(s\.value ->> 'channel'\) NOT IN \([^)]*\)/, ''))];
    expect(problemsOf(files).join('\n')).toMatch(/20270101000000_regress\.sql: no channel list/);
  });

  it.each([
    ['lowercase', (fn: string) => fn.replace(HEAD, 'create or replace function public.publish_workflow_version(')],
    ['extra whitespace', (fn: string) => fn.replace(HEAD, 'CREATE  OR\n REPLACE FUNCTION  public.publish_workflow_version (')],
    ['no schema', (fn: string) => fn.replace(HEAD, 'CREATE OR REPLACE FUNCTION publish_workflow_version(')],
    ['quoted', (fn: string) => fn.replace(HEAD, 'CREATE OR REPLACE FUNCTION "public"."publish_workflow_version"(')],
    ['plain CREATE (after a DROP)', (fn: string) => `DROP FUNCTION public.publish_workflow_version(uuid, uuid, uuid);\n${fn.replace(HEAD, 'CREATE FUNCTION public.publish_workflow_version(')}`],
  ])('a stale-vocabulary redefinition spelled %s is still found and rejected', (_l, mutate) => {
    const files = [...real, laterRedefinition('20270101000000_regress.sql', mutate)];
    expect(publishFunctionDefiners(files)).toEqual([FIRST_PUBLISH_DEFINER, LATEST, '20270101000000_regress.sql']);
    expect(problemsOf(files)).toContain('in TypeScript, not in SQL: social_post');
  });

  it('a definition that appears only in a SQL comment is NOT a definer', () => {
    const files = [...real, { name: '20270101000000_note.sql', sql: `-- ${HEAD}uuid, uuid, uuid) is defined elsewhere\nSELECT 1;\n` }];
    expect(publishFunctionDefiners(files)).toEqual([FIRST_PUBLISH_DEFINER, LATEST]);
  });

  it('the first definer not being 20261227000000 → rejected', () => {
    const files = [laterRedefinition('20261201000000_earlier.sql', (fn) => fn.replace(
      "'content', 'internal')", "'content', 'internal', 'social_post')")), ...real];
    expect(problemsOf(files)).toContain(`first definer is 20261201000000_earlier.sql, expected ${FIRST_PUBLISH_DEFINER}`);
    // …and with 20261227000000 absent entirely.
    expect(problemsOf(real.filter((f) => f.name !== FIRST_PUBLISH_DEFINER)))
      .toContain(`first definer is ${LATEST}, expected ${FIRST_PUBLISH_DEFINER}`);
  });

  it('two channel lists in one definition are ambiguous → rejected', () => {
    const files = [...real, laterRedefinition('20270101000000_two.sql', (fn) => fn.replace(
      /(OR \(s\.value ->> 'channel'\) NOT IN \([^)]*\))/, "$1\n        OR (s.value ->> 'channel') NOT IN ('email')"))];
    expect(problemsOf(files).join('\n')).toMatch(/2 channel lists in one definition/);
  });

  it('no definer at all → rejected', () => {
    expect(problemsOf(real.filter((f) => f.name !== FIRST_PUBLISH_DEFINER && f.name !== LATEST)))
      .toEqual(['no migration defines publish_workflow_version']);
  });
});

describe('the application validator (032 vocabulary) still refuses invalid channels', () => {
  const refuses = (channel: unknown): void => {
    let err: unknown;
    try {
      validateWorkflowDefinition({ steps: [{ key: 'a', channel, delay_after_previous_hours: 0, execution_mode: 'assisted' }] });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(WorkflowError);
    expect((err as WorkflowError).code).toBe('invalid_step_channel');
  };

  it.each(['SOCIAL_POST', 'Social_Post', 'social-post', 'social post', '1social', 'socialpost', 'social_post_now', 'twitter', 'publish', 'Content', 'CONTENT'])(
    'refuses %j', (c) => refuses(c));

  it('the vocabulary is exactly the 12 ratified channels, in order, all well-formed and distinct', () => {
    expect([...WORKFLOW_STEP_CHANNELS]).toEqual([...RATIFIED]);
    expect(new Set(WORKFLOW_STEP_CHANNELS).size).toBe(12);
    for (const c of WORKFLOW_STEP_CHANNELS) expect(CHANNEL_NAME.test(c)).toBe(true);
  });
});
