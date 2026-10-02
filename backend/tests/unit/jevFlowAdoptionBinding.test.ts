/**
 * gov adoption Track A — adoption-baseline binding records.
 * Hermetic: GOV_HOME under os.tmpdir(); no git, no network, no transcripts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  adoptionOf,
  bindSession,
  findBySession,
  latestForStory,
  readBindings,
  type BindInput,
} from '../../../scripts/jev-flow/binding';
import {
  ADOPTION_CLASSIFICATION,
  BINDING_SCHEMA,
  GOVERNANCE_VERSION,
  canonicalHash,
  govLayout,
  type GovLayout,
  type SessionFileFingerprint,
} from '../../../scripts/jev-flow/types';

const SID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SID2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);
const PKT = canonicalHash({ packet: 'adopt' });
const FIXED_NOW = () => new Date('2026-10-01T12:00:00.000Z');

const FP: SessionFileFingerprint = {
  path: 'C:/fake/projects/x/session.jsonl',
  sha256: canonicalHash({ transcript: 1 }),
  bytes: 123,
  cwd: 'C:/tmp/gov-omni-9',
  git_branch: 'gov/OMNI-9',
};

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});
function govFor(): GovLayout {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-adopt-home-'));
  tmpDirs.push(d);
  return govLayout({ GOV_HOME: path.join(d, 'gov') });
}

function attachInput(over: Partial<BindInput> = {}): BindInput {
  return {
    story_key: 'OMNI-9',
    packet_hash: PKT,
    session_id: SID,
    mode: 'attach',
    worktree: 'C:/tmp/gov-omni-9',
    branch: 'gov/OMNI-9',
    base_commit: BASE,
    session_file: FP,
    adoption: { baseline_commit: BASE, classification: ADOPTION_CLASSIFICATION },
    ...over,
  };
}

function ledgerText(layout: GovLayout): string | null {
  try {
    return fs.readFileSync(layout.bindingsFile, 'utf8');
  } catch {
    return null;
  }
}

describe('adoption binding', () => {
  it('records the classification and the baseline commit', () => {
    const layout = govFor();
    const res = bindSession(layout, attachInput(), FIXED_NOW);
    expect(res.status).toBe('BOUND');
    expect(res.binding.adoption).toEqual({ baseline_commit: BASE, classification: 'PRE_GOVERNANCE_ADOPTION_BASELINE' });
    expect(res.binding.base_commit).toBe(BASE);
    const [rec] = readBindings(layout);
    expect(rec.schema).toBe(BINDING_SCHEMA);
    expect(rec.governance_version).toBe(GOVERNANCE_VERSION);
    expect(adoptionOf(rec)).toEqual({ baseline_commit: BASE, classification: ADOPTION_CLASSIFICATION });
    expect(Object.keys(JSON.parse(ledgerText(layout).trim()))).toContain('adoption');
  });

  it('requires baseline_commit === base_commit', () => {
    const layout = govFor();
    const res = bindSession(
      layout,
      attachInput({ adoption: { baseline_commit: OTHER, classification: ADOPTION_CLASSIFICATION } }),
      FIXED_NOW,
    );
    expect(res.status).toBe('REFUSED');
    expect(res.message).toMatch(/base_commit/);
    expect(ledgerText(layout)).toBeNull();
  });

  it('refuses invalid adoption shapes and leaves the ledger untouched', () => {
    const layout = govFor();
    const bad: unknown[] = [
      { baseline_commit: 'bbbbbbb', classification: ADOPTION_CLASSIFICATION },
      { baseline_commit: BASE.toUpperCase(), classification: ADOPTION_CLASSIFICATION },
      { baseline_commit: BASE, classification: 'ADOPTED' },
      { baseline_commit: BASE },
      { classification: ADOPTION_CLASSIFICATION },
      { baseline_commit: BASE, classification: ADOPTION_CLASSIFICATION, extra: true },
      [BASE, ADOPTION_CLASSIFICATION],
      BASE,
      true,
      0,
    ];
    for (const a of bad) {
      const res = bindSession(layout, attachInput({ adoption: a as BindInput['adoption'] }), FIXED_NOW);
      expect(res.status).toBe('REFUSED');
      expect(res.binding).toBeNull();
    }
    expect(ledgerText(layout)).toBeNull();

    bindSession(layout, attachInput({ adoption: null }), FIXED_NOW);
    const before = ledgerText(layout);
    for (const a of bad) {
      expect(bindSession(layout, attachInput({ session_id: SID2, adoption: a as BindInput['adoption'] }), FIXED_NOW).status).toBe('REFUSED');
    }
    expect(ledgerText(layout)).toBe(before);
  });

  it('refuses adoption on mode=new', () => {
    const layout = govFor();
    const res = bindSession(layout, attachInput({ mode: 'new', session_file: null }), FIXED_NOW);
    expect(res.status).toBe('REFUSED');
    expect(res.message).toMatch(/attach/);
    expect(ledgerText(layout)).toBeNull();
  });

  it('is idempotent on re-attach with the same adoption', () => {
    const layout = govFor();
    expect(bindSession(layout, attachInput(), FIXED_NOW).status).toBe('BOUND');
    const again = bindSession(layout, attachInput(), () => new Date('2026-10-02T00:00:00.000Z'));
    expect(again.status).toBe('ALREADY_BOUND');
    expect(again.binding.bound_at).toBe('2026-10-01T12:00:00.000Z');
    expect(ledgerText(layout).trim().split('\n')).toHaveLength(1);
  });

  it('treats a different adoption baseline as a new record (append)', () => {
    const layout = govFor();
    expect(bindSession(layout, attachInput({ adoption: null }), FIXED_NOW).status).toBe('BOUND');
    const res = bindSession(layout, attachInput(), FIXED_NOW);
    expect(res.status).toBe('BOUND');
    expect(readBindings(layout)).toHaveLength(2);
    // absent and null adoption are equal for idempotency
    const absent = attachInput();
    delete absent.adoption;
    expect(bindSession(layout, absent, FIXED_NOW).status).toBe('ALREADY_BOUND');
  });

  it('still refuses a session bound to a different Story', () => {
    const layout = govFor();
    bindSession(layout, attachInput(), FIXED_NOW);
    const res = bindSession(layout, attachInput({ story_key: 'OMNI-10' }), FIXED_NOW);
    expect(res.status).toBe('REFUSED');
    expect(res.message).toMatch(/already bound to OMNI-9/);
    expect(readBindings(layout)).toHaveLength(1);
  });
});

describe('ordinary bindings stay byte-identical', () => {
  it('writes no adoption key for absent or null adoption', () => {
    for (const adoption of [undefined, null]) {
      const layout = govFor();
      const inp = attachInput({ adoption });
      if (adoption === undefined) delete inp.adoption;
      bindSession(layout, inp, FIXED_NOW);
      const expected =
        JSON.stringify({
          schema: BINDING_SCHEMA,
          governance_version: GOVERNANCE_VERSION,
          story_key: 'OMNI-9',
          packet_hash: PKT,
          session_id: SID,
          mode: 'attach',
          worktree: 'C:/tmp/gov-omni-9',
          branch: 'gov/OMNI-9',
          base_commit: BASE,
          bound_at: '2026-10-01T12:00:00.000Z',
          session_file: FP,
        }) + '\n';
      const text = ledgerText(layout);
      expect(text).toBe(expected);
      expect(text).not.toContain('adoption');
    }
  });

  it('reads old-format ledger lines and adoptionOf returns null', () => {
    const layout = govFor();
    const old = {
      schema: BINDING_SCHEMA,
      governance_version: GOVERNANCE_VERSION,
      story_key: 'OMNI-9',
      packet_hash: PKT,
      session_id: SID2,
      mode: 'new',
      worktree: 'C:/tmp/gov-omni-9',
      branch: 'gov/OMNI-9',
      base_commit: OTHER,
      bound_at: '2026-09-30T00:00:00.000Z',
      session_file: null,
    };
    fs.mkdirSync(path.dirname(layout.bindingsFile), { recursive: true });
    fs.writeFileSync(layout.bindingsFile, JSON.stringify(old) + '\n');
    const rec = findBySession(layout, SID2);
    expect(rec).toEqual(old);
    expect(adoptionOf(rec)).toBeNull();
    expect(adoptionOf(null)).toBeNull();
    expect(adoptionOf({ ...rec, adoption: null } as typeof rec)).toBeNull();
  });
});

describe('lookups return the adoption record', () => {
  it('findBySession and latestForStory', () => {
    const layout = govFor();
    bindSession(layout, attachInput({ session_id: SID2, adoption: null }), FIXED_NOW);
    bindSession(layout, attachInput(), () => new Date('2026-10-01T13:00:00.000Z'));
    const bySession = findBySession(layout, SID);
    const latest = latestForStory(layout, 'OMNI-9');
    expect(adoptionOf(bySession)).toEqual({ baseline_commit: BASE, classification: ADOPTION_CLASSIFICATION });
    expect(latest).toEqual(bySession);
    expect(adoptionOf(findBySession(layout, SID2))).toBeNull();
  });
});
