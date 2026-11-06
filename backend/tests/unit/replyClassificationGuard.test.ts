/**
 * Prompt 5 — classifier wiring is SWITCHED OFF, and stays harmless when switched on.
 *
 * The Outreach conditions (2026-11-06): read-only and deterministic; no AI Gateway call and
 * no injected classifier; no message content persisted or logged; the flag defaults OFF;
 * with it off no label reaches a journey consequence; with it on a label can never end a
 * journey or override STOP, complaint, unsubscribe or a bounce. Turning it on needs SC7-R.
 */
const mockDbTouched: string[] = [];
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => { mockDbTouched.push(t); throw new Error('the adapter reads and writes nothing'); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => { mockDbTouched.push(t); throw new Error('no db'); }, rpc: () => { throw new Error('no db'); } } }));
const mockLog = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../services/logger', () => ({ logger: mockLog }));
const mockClassify = jest.fn();
jest.mock('../../services/engagementClassification/classifyMessage', () => {
  const actual = jest.requireActual('../../services/engagementClassification/classifyMessage');
  return { ...actual, classifyMessage: (...a: unknown[]) => { mockClassify(...a); return actual.classifyMessage(...a); } };
});

import * as fs from 'fs';
import * as path from 'path';
import { classifyReplyConsequence } from '../../services/orchestration/replyClassificationAdapter';
import { REPLY_CLASSIFICATION_FLAG, isReplyClassificationEnabled } from '../../services/orchestration/replyClassificationFlag';

const ROOT = path.resolve(__dirname, '../../..');
const ON = { [REPLY_CLASSIFICATION_FLAG]: 'true' };
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['tests', 'node_modules', '.next'].includes(e.name)) walk(p, out); } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const SAMPLES = [
  'Yes, I am interested, tell me more',
  'Can we book a call next week?',
  'Not interested, thanks',
  'I am out of the office until Monday',
  'How much does it cost?',
  'STOP',
  'unsubscribe me',
  'This is spam. How did you get my email?',
  'asdf',
];
let fetchCalls = 0;

beforeAll(() => { (global as unknown as { fetch: unknown }).fetch = async () => { fetchCalls += 1; throw new Error('no network'); }; });
beforeEach(() => { mockClassify.mockClear(); });
afterAll(() => {
  expect(fetchCalls).toBe(0);
  expect(mockDbTouched).toEqual([]);
});

describe('the flag defaults OFF', () => {
  it('unset, empty, and anything but exactly "true" are OFF', () => {
    expect(isReplyClassificationEnabled({})).toBe(false);
    for (const v of ['', 'false', '1', 'TRUE', ' true', 'yes', 'on']) expect(isReplyClassificationEnabled({ [REPLY_CLASSIFICATION_FLAG]: v })).toBe(false);
    expect(isReplyClassificationEnabled(ON)).toBe(true);
  });

  it('the process default is OFF, and no source file sets the flag', () => {
    expect(isReplyClassificationEnabled()).toBe(false);
    const setters = [...walk(path.join(ROOT, 'backend')), ...walk(path.join(ROOT, 'pages')), ...walk(path.join(ROOT, 'lib'))]
      .filter((f) => !f.endsWith('replyClassificationFlag.ts'))
      .filter((f) => /ORCHESTRATION_REPLY_CLASSIFICATION_ENABLED/.test(fs.readFileSync(f, 'utf8')));
    expect(setters.map(rel)).toEqual([]);
  });

  it('the flag module says turning it on requires SC7-R', () => {
    expect(read('backend/services/orchestration/replyClassificationFlag.ts')).toMatch(/requires the owner's[\s*]+SC7-R ratification/);
  });

  it('OFF: the classifier is never called, and every reply is the R1 suspension', async () => {
    for (const text of SAMPLES) {
      const r = await classifyReplyConsequence({ text, channel: 'whatsapp', restrictions: [], controlRefusal: null }, {});
      expect(r).toMatchObject({ classified: false, codes: [], consequence: { consequence: 'suspend', policy: 'abstain.classification_disabled', businessOutcome: null } });
    }
    expect(mockClassify).not.toHaveBeenCalled();
  });
});

describe('nothing in the sweeper or the journey modules imports or acts on the adapter', () => {
  const NAMES = /replyClassificationAdapter|replyClassificationFlag|replyConsequence|classifyReplyConsequence/;
  it('the only importer of the matrix and the flag is the adapter; nothing imports the adapter', () => {
    const files = [...walk(path.join(ROOT, 'backend')), ...walk(path.join(ROOT, 'pages')), ...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'shared'))];
    const importers = files.filter((f) => NAMES.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
    expect(importers).toEqual([
      'backend/services/orchestration/replyClassificationAdapter.ts',
      'backend/services/orchestration/replyClassificationFlag.ts',
      'backend/services/orchestration/replyConsequence.ts',
    ]);
  });

  it('the sweeper, the journey modules, the engines and the run routes never name it (not vacuous)', () => {
    const watched = [
      'backend/services/workflowExecution/workflowProgressionSweeper.ts',
      ...fs.readdirSync(path.join(ROOT, 'backend/services/orchestration')).filter((f) => /^journey.*\.ts$|EngineAdapter\.ts$|^engineAdapters\.ts$/.test(f))
        .map((f) => `backend/services/orchestration/${f}`),
      'pages/api/execution-instances/[id].ts',
    ];
    expect(watched.length).toBeGreaterThan(10);
    for (const f of watched) expect({ f, hit: NAMES.test(read(f)) }).toEqual({ f, hit: false });
  });

  it('the adapter injects no classifier, makes no AI or network call, and persists or logs nothing', () => {
    const src = read('backend/services/orchestration/replyClassificationAdapter.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).toMatch(/classifyMessage\(\{[^}]*\}\)/);              // one argument: no deps
    for (const banned of [/classifiers\s*:/, /aiGateway|AiGateway|openai|fetch\(|axios/i, /ownedDbTable|supabase|\.insert\(|\.update\(/, /logger|console\./]) {
      expect(src).not.toMatch(banned);
    }
  });
});

describe('ON: a label still cannot end a journey or override governance', () => {
  it('no sample text ever exits without a restriction, and none continues', async () => {
    for (const text of SAMPLES) {
      for (const channel of ['whatsapp', 'email']) {
        const r = await classifyReplyConsequence({ text, channel, restrictions: [], controlRefusal: null }, ON);
        expect(r.classified).toBe(true);
        expect({ text, c: r.consequence.consequence }).not.toEqual({ text, c: 'exit' });
        expect(r.consequence.consequence).not.toBe('continue');
        expect(r.consequence.endedBy).toBeNull();
        expect([null, 'replied']).toContain(r.consequence.businessOutcome);
      }
    }
    expect(mockClassify).toHaveBeenCalled();
    for (const call of mockClassify.mock.calls) expect(call).toHaveLength(1);   // no injected classifier
  });

  it('STOP / unsubscribe / complaint text routes to a person, never continues or retimes', async () => {
    for (const text of ['STOP', 'unsubscribe me', 'This is spam. How did you get my email?']) {
      const r = await classifyReplyConsequence({ text, channel: 'whatsapp', restrictions: [], controlRefusal: null }, ON);
      expect(r.consequence).toMatchObject({ consequence: 'route_to_human', humanAction: 'governance_review' });
      expect(r.consequence.policy).toMatch(/^sc7\.governance_detected\./);
    }
  });

  it('a recorded complaint / unsubscribe ends the run by governance whatever the text says; a bounce holds it', async () => {
    for (const text of SAMPLES) {
      const c = await classifyReplyConsequence({ text, channel: 'email', restrictions: ['complaint'], controlRefusal: null }, ON);
      expect(c.consequence).toMatchObject({ consequence: 'exit', endedBy: 'governance', exitOutcome: 'complained' });
      const u = await classifyReplyConsequence({ text, channel: 'whatsapp', restrictions: ['unsubscribe'], controlRefusal: null }, ON);
      expect(u.consequence).toMatchObject({ consequence: 'exit', endedBy: 'governance', exitOutcome: 'unsubscribed' });
      const b = await classifyReplyConsequence({ text, channel: 'email', restrictions: ['bounce_hard'], controlRefusal: null }, ON);
      expect(b.consequence).toMatchObject({ consequence: 'suspend', policy: 'governance.restriction.bounce_hard' });
    }
  });

  it('a negative reply is never `rejected`, a meeting request never `meeting_booked`', async () => {
    const neg = await classifyReplyConsequence({ text: 'Not interested, thanks', channel: 'email', restrictions: [], controlRefusal: null }, ON);
    expect(neg.consequence.businessOutcome).not.toBe('rejected');
    const meet = await classifyReplyConsequence({ text: 'Can we book a call next week?', channel: 'email', restrictions: [], controlRefusal: null }, ON);
    expect(meet.consequence.businessOutcome).not.toBe('meeting_booked');
  });

  it('the result carries codes, never the text, and nothing was logged', async () => {
    const text = 'A distinctive sentence 7f3a9 about pricing please';
    const r = await classifyReplyConsequence({ text, channel: 'email', restrictions: [], controlRefusal: null }, ON);
    expect(JSON.stringify(r)).not.toContain('7f3a9');
    for (const fn of Object.values(mockLog)) expect(fn).not.toHaveBeenCalled();
  });

  it('empty content abstains: suspend', async () => {
    for (const text of [null, undefined, '', '   ']) {
      const r = await classifyReplyConsequence({ text, channel: 'email', restrictions: [], controlRefusal: null }, ON);
      expect(r.consequence).toMatchObject({ consequence: 'suspend', policy: 'abstain.no_content' });
    }
  });
});
