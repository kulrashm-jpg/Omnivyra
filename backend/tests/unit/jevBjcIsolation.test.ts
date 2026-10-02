/**
 * JEV BJC — explicit-invocation boundary, isolation from Claude Code,
 * provider hardening, redaction, audit and CLI. No real network calls.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeInputHash } from '../../../scripts/jev-bjc/canonical';
import { FileAuditSink, MemoryAuditSink } from '../../../scripts/jev-bjc/audit';
import { TYPESAFE_SYSTEMONE_URL, createTypeSafeTransport, resolveApiKey } from '../../../scripts/jev-bjc/provider';
import { judge } from '../../../scripts/jev-bjc/judge';
import { runCli } from '../../../scripts/jev-bjc/cli';
import type { BjcRequest } from '../../../scripts/jev-bjc/contract';

const REPO = path.resolve(__dirname, '../../..');
const BJC_DIR = path.join(REPO, 'scripts', 'jev-bjc');
const bjcSources = () => fs.readdirSync(BJC_DIR).filter((f) => f.endsWith('.ts')).map((f) => path.join(BJC_DIR, f));
// Built at runtime so no credential-shaped literal exists in the source.
const FAKE_KEY = ['sk', 'Q'.repeat(30)].join('-');

function request(over: Record<string, unknown> = {}): BjcRequest {
  const d = {
    schema: 'bjc/1',
    request_id: 'req-iso',
    work_item: 'OMNI-2',
    invoked_by: 'claude-code:session-1',
    acceptance_criterion: { id: 'AC-1', statement: 'Typecheck is clean', kind: 'OBJECTIVE', required_evidence: ['typecheck'] },
    invariants: [],
    deterministic_summary: 'tsc --noEmit',
    evidence: [
      { id: 'EV-1', kind: 'typecheck', ref: 'tsc@3d643f5c', sha256: 'b'.repeat(64), produced_by: 'tsc@5', result: 'PASS', captured_at: '2026-10-01T10:00:00Z', ac_ids: ['AC-1'] },
    ],
    model: 'jev-test-1',
    ...over,
  };
  return { ...d, input_hash: computeInputHash(d as never) } as BjcRequest;
}

const okReply = { answers: { ac: { choice: 'SUPPORTS', confidence: 0.9 }, bundle_consistency: { noul: 0.9 } } };

describe('12. explicit invocation only', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be touched'));
  });
  afterEach(() => fetchSpy.mockRestore());

  it('loading every BJC module (including the CLI) performs no network call and no work', () => {
    jest.isolateModules(() => {
      for (const file of bjcSources()) require(file);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creating a transport does not call the provider; only send() does', async () => {
    const fetchImpl = jest.fn();
    createTypeSafeTransport({ apiKey: FAKE_KEY, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('without a key, judge() fails visibly and never reaches the network', async () => {
    const res = await judge(request(), { transport: null, audit: new MemoryAuditSink() });
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, error: { code: 'MISSING_API_KEY' } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the key comes only from TYPESAFE_API_KEY', () => {
    expect(resolveApiKey({})).toBeNull();
    expect(resolveApiKey({ OPENROUTER_API_KEY: FAKE_KEY, CLAUDE_PLUGIN_OPTION_TYPESAFEAPIKEY: FAKE_KEY })).toBeNull();
    expect(resolveApiKey({ TYPESAFE_API_KEY: ` ${FAKE_KEY} ` })).toBe(FAKE_KEY);
  });
});

describe('provider boundary hardening', () => {
  function capture(response: Response | Error) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it('posts only the bounded body to the fixed endpoint, refusing redirects, ignoring any base-URL override', async () => {
    process.env.JEV_BASE_URL = 'https://evil.example/collect';
    try {
      const { calls, fetchImpl } = capture(new Response(JSON.stringify(okReply), { status: 200 }));
      const res = await judge(request(), { transport: createTypeSafeTransport({ apiKey: FAKE_KEY, fetchImpl }), audit: new MemoryAuditSink() });
      expect(res.status).toBe('COMPLETED');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(TYPESAFE_SYSTEMONE_URL);
      expect(calls[0].init).toMatchObject({ method: 'POST', redirect: 'error' });
      expect(Object.keys(JSON.parse(String(calls[0].init.body))).sort()).toEqual(['model', 'questions', 'state']);
    } finally {
      delete process.env.JEV_BASE_URL;
    }
  });

  it('maps a real abort-on-timeout to TIMEOUT', async () => {
    const fetchImpl = ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
      })) as unknown as typeof fetch;
    const res = await judge(request(), {
      transport: createTypeSafeTransport({ apiKey: FAKE_KEY, fetchImpl }),
      audit: new MemoryAuditSink(),
      timeoutMs: 20,
    });
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, error: { code: 'TIMEOUT' } });
  });

  it('maps a non-JSON body to MALFORMED_RESPONSE and an HTTP error to its status only', async () => {
    const bad = capture(new Response('<html>oops</html>', { status: 200 }));
    const r1 = await judge(request(), { transport: createTypeSafeTransport({ apiKey: FAKE_KEY, fetchImpl: bad.fetchImpl }), audit: new MemoryAuditSink() });
    expect(r1.error?.code).toBe('MALFORMED_RESPONSE');

    const denied = capture(new Response(`denied for key ${FAKE_KEY}`, { status: 403 }));
    const r2 = await judge(request(), { transport: createTypeSafeTransport({ apiKey: FAKE_KEY, fetchImpl: denied.fetchImpl }), audit: new MemoryAuditSink() });
    expect(r2.error).toEqual({ code: 'PROVIDER_HTTP_ERROR', message: 'provider returned HTTP 403 (attempt 1)' });
    expect(JSON.stringify(r2)).not.toContain(FAKE_KEY);
  });
});

describe('redaction gate', () => {
  it('blocks credential-shaped evidence: nothing is sent, the audit has no value', async () => {
    const audit = new MemoryAuditSink();
    const send = jest.fn();
    const ev = { ...request().evidence[0], excerpt: `config: api_key=${FAKE_KEY}` };
    const res = await judge(request({ evidence: [ev] }), { transport: { send }, audit });
    expect(send).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', verdict: null, error: { code: 'REDACTION_BLOCK' } });
    expect(audit.records[0].redaction.blocked).toBe(true);
    expect(JSON.stringify(audit.records)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(res)).not.toContain(FAKE_KEY);
  });

  it('rejects oversize state instead of truncating it', async () => {
    const evidence = Array.from({ length: 50 }, (_, i) => ({
      ...request().evidence[0],
      id: `EV-${i + 1}`,
      ref: `r${i}-${'x'.repeat(490)}`,
      excerpt: 'y '.repeat(750),
    }));
    const send = jest.fn();
    const res = await judge(request({ evidence }), { transport: { send }, audit: new MemoryAuditSink() });
    expect(send).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'REQUEST_REJECTED', error: { code: 'OVERSIZE' } });
  });
});

describe('audit records', () => {
  it('hold metadata only — no statements, excerpts or evidence refs', async () => {
    const audit = new MemoryAuditSink();
    const ev = { ...request().evidence[0], excerpt: 'SENSITIVE-EXCERPT-TEXT' };
    await judge(request({ evidence: [ev] }), { transport: { send: async () => okReply }, audit });
    const text = JSON.stringify(audit.records[0]);
    expect(text).not.toContain('Typecheck is clean');
    expect(text).not.toContain('SENSITIVE-EXCERPT-TEXT');
    expect(text).not.toContain('tsc@3d643f5c');
    expect(audit.records[0]).toMatchObject({ request_id: 'req-iso', status: 'COMPLETED', verdict: 'PASS_CORROBORATED', evidence: [{ id: 'EV-1', sha256: 'b'.repeat(64) }] });
  });

  it('an audit write failure is visible on the response', async () => {
    const res = await judge(request(), {
      transport: { send: async () => okReply },
      audit: { append: async () => { throw new Error('disk full'); } },
    });
    expect(res.audit).toEqual({ record_id: expect.any(String), written: false, error: 'audit write failed: disk full' });
  });

  it('FileAuditSink refuses a directory inside a git work tree and appends JSONL elsewhere', async () => {
    expect(() => new FileAuditSink(path.join(REPO, 'tmp-bjc-audit'))).toThrow(/outside any git work tree/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-audit-'));
    try {
      await judge(request(), { transport: null, audit: new FileAuditSink(dir), now: () => new Date('2026-10-01T09:00:00Z') });
      const lines = fs.readFileSync(path.join(dir, 'bjc-audit-2026-10-01.jsonl'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', error: { code: 'MISSING_API_KEY' } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
  };

  it('prints usage and exits 64 without a command', async () => {
    const c = io();
    expect(await runCli([], {}, c.io)).toBe(64);
  });

  it('hash prints the canonical input hash; judge without a key exits 2 and is audited', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bjc-cli-'));
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    try {
      const reqFile = path.join(dir, 'req.json');
      const req = request();
      fs.writeFileSync(reqFile, JSON.stringify(req));
      const h = io();
      expect(await runCli(['hash', '--request', reqFile], {}, h.io)).toBe(0);
      expect(h.out).toEqual([req.input_hash]);

      const j = io();
      const auditDir = path.join(dir, 'audit');
      expect(await runCli(['judge', '--request', reqFile, '--audit-dir', auditDir], {}, j.io)).toBe(2);
      expect(JSON.parse(j.out[0])).toMatchObject({ status: 'JUDGMENT_UNAVAILABLE', error: { code: 'MISSING_API_KEY' }, audit: { written: true } });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('13. normal Claude Code execution does not invoke JEV', () => {
  it('no repo Claude setting registers hooks or enables the claude-jev plugin', () => {
    for (const name of ['settings.json', 'settings.local.json']) {
      const file = path.join(REPO, '.claude', name);
      if (!fs.existsSync(file)) continue;
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(JSON.stringify(settings.hooks ?? {})).not.toMatch(/jev|bjc|typesafe/i);
      expect(settings.enabledPlugins?.['claude-jev@claude-jev']).not.toBe(true);
    }
  });

  it('no npm lifecycle script runs BJC', () => {
    const scripts: Record<string, string> = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts ?? {};
    const lifecycle = Object.entries(scripts).filter(([k]) => /^(pre|post)|^(prepare|install)$/.test(k));
    for (const [, cmd] of lifecycle) expect(cmd).not.toMatch(/jev|bjc/i);
  });

  it('no product code imports BJC', () => {
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-l', '-E', 'jev-bjc', '--', 'backend', 'pages', 'lib', 'components', 'hooks', ':!backend/tests'], {
        cwd: REPO,
        encoding: 'utf8',
      });
    } catch (err) {
      if ((err as { status?: number }).status !== 1) throw err; // 1 = no match
    }
    expect(hits.trim()).toBe('');
  });
});

describe('14. no prompt/subagent router has been reintroduced', () => {
  const FORBIDDEN = [
    'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'SessionStart',
    'hookSpecificOutput', 'permissionDecision', 'updatedInput', 'additionalContext',
    'transcript_path', 'subagent_type', 'CLAUDE_PLUGIN_OPTION', 'JEV_BASE_URL', 'OPENROUTER',
  ];

  it.each(FORBIDDEN)('BJC sources never reference %s', (token) => {
    for (const file of bjcSources()) expect(fs.readFileSync(file, 'utf8')).not.toContain(token);
  });

  it('BJC exports no hook registration surface', () => {
    jest.isolateModules(() => {
      for (const file of bjcSources()) {
        const mod = require(file);
        expect(Object.keys(mod).filter((k) => /^(register|on[A-Z]|hook)/i.test(k))).toEqual([]);
      }
    });
  });
});
