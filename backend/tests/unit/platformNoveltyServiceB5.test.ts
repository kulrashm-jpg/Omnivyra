/**
 * B5 — platform novelty service behaviour (§16 A, C, E–J, N, O; §7 never-block).
 *
 * Evaluation is exercised through dependency injection, so every case here is
 * a UNIT proof with no database. The isolated-PostgreSQL proofs (RLS denial,
 * real HNSW, cross-tenant simulation, row deltas) are separate and are reported
 * as such — a mock cannot establish them.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  evaluatePlatformNovelty,
  computePlatformDimensions,
  classifyBand,
  scoreFromDimensions,
  novelSignal,
  resolvePlatformConfig,
  isPlatformUniquenessEnabled,
  recordPlatformFingerprint,
  DEFAULT_MAX_CANDIDATES,
  type PlatformNeighbour,
  type PlatformEvaluationInput,
} from '../../services/content/platformNoveltyService';
import { computeFingerprint } from '../../../lib/content/originality/fingerprint';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const ENV_KEYS = [
  'PLATFORM_UNIQUENESS_ENABLED',
  'PLATFORM_UNIQUENESS_COLLISION_THRESHOLD',
  'PLATFORM_UNIQUENESS_ADJACENT_THRESHOLD',
];
const PRIOR: Record<string, string | undefined> = {};

beforeAll(() => { for (const k of ENV_KEYS) PRIOR[k] = process.env[k]; });
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (PRIOR[k] === undefined) delete process.env[k];
    else process.env[k] = PRIOR[k] as string;
  }
});
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

const TEXT_A = 'Three signals tell you a pipeline is stalling before revenue does. First, reply latency. Second, stage dwell time. Third, the ratio of new to reopened threads.';
const TEXT_NEAR = 'Three signals tell you a pipeline is stalling before revenue does! First: reply latency. Second: stage dwell time. Third: the ratio of new to reopened threads.';
const TEXT_UNRELATED = 'Sourdough starter needs a warm shelf, a scale, and patience. Feed it twice a day and discard half each time or it will outgrow the jar.';

const fpA = computeFingerprint(TEXT_A);
const fpNear = computeFingerprint(TEXT_NEAR);
const fpUnrelated = computeFingerprint(TEXT_UNRELATED);

const neighbourOf = (text: string, extra: Partial<PlatformNeighbour> = {}): PlatformNeighbour => {
  const fp = computeFingerprint(text);
  return {
    simhash: fp.simhash,
    minhash: fp.minhash,
    structuralShape: fp.structuralShape,
    embedding: null,
    embeddingModel: null,
    embeddingVersion: null,
    ...extra,
  };
};

const input = (fp = fpA, extra: Partial<PlatformEvaluationInput> = {}): PlatformEvaluationInput => ({
  fingerprint: fp, contentType: 'post', ...extra,
});

/* ── §7.7 / §16 C — flag OFF ───────────────────────────────────────────── */

describe('B5 · C — the flag defaults OFF', () => {
  it('unset ⇒ disabled', () => {
    expect(isPlatformUniquenessEnabled()).toBe(false);
  });

  it.each(['false', '0', 'off', 'no', '', '   ', 'maybe'])('%s ⇒ disabled', (v) => {
    process.env.PLATFORM_UNIQUENESS_ENABLED = v;
    expect(isPlatformUniquenessEnabled()).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' On '])('%s ⇒ enabled', (v) => {
    process.env.PLATFORM_UNIQUENESS_ENABLED = v;
    expect(isPlatformUniquenessEnabled()).toBe(true);
  });
});

/* ── §6 — calibration is unset, not invented ───────────────────────────── */

describe('B5 · calibration is deliberately unset', () => {
  it('no env ⇒ inert config, and 0.82 is NOT inherited from campaign scope', () => {
    const cfg = resolvePlatformConfig();
    expect(cfg.collisionThreshold).toBeUndefined();
    expect(cfg.adjacentThreshold).toBeUndefined();
  });

  it('an inert config classifies EVERYTHING as novel, even a perfect collision', () => {
    expect(classifyBand(0, {})).toBe('novel');
    expect(classifyBand(0.5, {})).toBe('novel');
    expect(classifyBand(1, {})).toBe('novel');
  });

  it('a provisional simulation threshold classifies as specified', () => {
    const cfg = { collisionThreshold: 0.2, adjacentThreshold: 0.5 };
    expect(classifyBand(0.1, cfg)).toBe('saturated');
    expect(classifyBand(0.4, cfg)).toBe('adjacent');
    expect(classifyBand(0.9, cfg)).toBe('novel');
  });

  it('rejects out-of-range or non-numeric env values rather than guessing', () => {
    process.env.PLATFORM_UNIQUENESS_COLLISION_THRESHOLD = 'abc';
    expect(resolvePlatformConfig().collisionThreshold).toBeUndefined();
    process.env.PLATFORM_UNIQUENESS_COLLISION_THRESHOLD = '1.7';
    expect(resolvePlatformConfig().collisionThreshold).toBeUndefined();
    process.env.PLATFORM_UNIQUENESS_COLLISION_THRESHOLD = '0.25';
    expect(resolvePlatformConfig().collisionThreshold).toBe(0.25);
  });
});

/* ── §7 / §16 E–G, J — never-block ─────────────────────────────────────── */

describe('B5 · E — store unavailable ⇒ novel, generation continues', () => {
  it('a retriever that throws degrades to novel', async () => {
    const sig = await evaluatePlatformNovelty(input(), {
      retrieve: async () => { throw new Error('store down'); },
    });
    expect(sig).toEqual(novelSignal());
  });

  it('an empty corpus is novel', async () => {
    const sig = await evaluatePlatformNovelty(input(), { retrieve: async () => [] });
    expect(sig.band).toBe('novel');
    expect(sig.score).toBe(1);
  });

  it('a malformed neighbour cannot throw', async () => {
    const sig = await evaluatePlatformNovelty(input(), {
      retrieve: async () => ([{ } as unknown as PlatformNeighbour]),
    });
    expect(sig.band).toBe('novel');
  });
});

describe('B5 · F — embedding unavailable ⇒ degrade, do not block', () => {
  it('no candidate embedding ⇒ no embedding dimension, simhash still scored', async () => {
    const sig = await evaluatePlatformNovelty(input(fpA), {
      retrieve: async () => [neighbourOf(TEXT_NEAR)],
      config: { collisionThreshold: 0.2 },
    });
    expect(sig.dimensions.embedding).toBeUndefined();
    expect(sig.dimensions.simhash).toBeGreaterThan(0);
  });

  it('neighbour has an embedding but candidate does not ⇒ dimension skipped', async () => {
    const sig = await evaluatePlatformNovelty(input(fpA), {
      retrieve: async () => [neighbourOf(TEXT_NEAR, {
        embedding: [0.1, 0.2, 0.3], embeddingModel: 'm', embeddingVersion: 1,
      })],
    });
    expect(sig.dimensions.embedding).toBeUndefined();
  });
});

describe('B5 · G — model/version mismatch ⇒ embedding comparison skipped', () => {
  const emb = [0.1, 0.2, 0.3];

  it('matching model + version ⇒ compared', async () => {
    const sig = await evaluatePlatformNovelty(
      input(fpA, { embedding: emb, embeddingModel: 'm1', embeddingVersion: 2 }),
      { retrieve: async () => [neighbourOf(TEXT_NEAR, { embedding: emb, embeddingModel: 'm1', embeddingVersion: 2 })] },
    );
    expect(sig.dimensions.embedding).toBeCloseTo(1, 5);
  });

  it('different MODEL ⇒ skipped, not compared', async () => {
    const sig = await evaluatePlatformNovelty(
      input(fpA, { embedding: emb, embeddingModel: 'm1', embeddingVersion: 2 }),
      { retrieve: async () => [neighbourOf(TEXT_NEAR, { embedding: emb, embeddingModel: 'm2', embeddingVersion: 2 })] },
    );
    expect(sig.dimensions.embedding).toBeUndefined();
  });

  it('different VERSION ⇒ skipped', async () => {
    const sig = await evaluatePlatformNovelty(
      input(fpA, { embedding: emb, embeddingModel: 'm1', embeddingVersion: 2 }),
      { retrieve: async () => [neighbourOf(TEXT_NEAR, { embedding: emb, embeddingModel: 'm1', embeddingVersion: 3 })] },
    );
    expect(sig.dimensions.embedding).toBeUndefined();
  });

  it('dimension-length mismatch ⇒ skipped', async () => {
    const sig = await evaluatePlatformNovelty(
      input(fpA, { embedding: [0.1, 0.2], embeddingModel: 'm1', embeddingVersion: 2 }),
      { retrieve: async () => [neighbourOf(TEXT_NEAR, { embedding: emb, embeddingModel: 'm1', embeddingVersion: 2 })] },
    );
    expect(sig.dimensions.embedding).toBeUndefined();
  });
});

describe('B5 · §7 — there is no throwing path at platform scope', () => {
  it.each([
    ['retriever throws', async () => { throw new Error('x'); }],
    ['retriever returns null', async () => null as never],
    ['retriever returns a non-array', async () => ({} as never)],
  ])('%s ⇒ resolves, never rejects', async (_n, retrieve) => {
    await expect(
      evaluatePlatformNovelty(input(), { retrieve: retrieve as never }),
    ).resolves.toBeDefined();
  });

  it('even a perfect self-collision resolves rather than throwing', async () => {
    await expect(
      evaluatePlatformNovelty(input(fpA), {
        retrieve: async () => [neighbourOf(TEXT_A)],
        config: { collisionThreshold: 0.99 },
      }),
    ).resolves.toMatchObject({ band: 'saturated' });
  });
});

/* ── §16 O — no oracle ─────────────────────────────────────────────────── */

describe('B5 · O — exact/normalized hashes never reach the signal', () => {
  const cases: Array<[string, ReturnType<typeof computeFingerprint>]> = [
    ['identical', fpA],
    ['near-identical', fpNear],
    ['unrelated', fpUnrelated],
  ];

  it.each(cases)('%s candidate exposes only abstract dimensions', async (_n, fp) => {
    const sig = await evaluatePlatformNovelty(input(fp), {
      retrieve: async () => [neighbourOf(TEXT_A)],
      config: { collisionThreshold: 0.2, adjacentThreshold: 0.5 },
    });
    const keys = Object.keys(sig.dimensions);
    expect(keys).not.toContain('exact');
    expect(keys).not.toContain('normalized');
    for (const k of keys) {
      expect(['simhash', 'semantic', 'structural', 'embedding']).toContain(k);
    }
  });

  it('the signal object itself has exactly band/score/dimensions', async () => {
    const sig = await evaluatePlatformNovelty(input(), { retrieve: async () => [neighbourOf(TEXT_A)] });
    expect(Object.keys(sig).sort()).toEqual(['band', 'dimensions', 'score']);
  });

  it('a byte-identical candidate is not distinguishable by an exact-match flag', async () => {
    const identical = await evaluatePlatformNovelty(input(fpA), {
      retrieve: async () => [neighbourOf(TEXT_A)],
    });
    // No boolean, no 1.0-only marker beyond the ordinary similarity dimensions.
    expect(identical).not.toHaveProperty('exactMatch');
    expect(identical).not.toHaveProperty('collision');
    expect(Object.keys(identical.dimensions)).not.toContain('exact');
  });

  it('an unrelated candidate scores as more novel than a near-duplicate', async () => {
    const near = await evaluatePlatformNovelty(input(fpNear), { retrieve: async () => [neighbourOf(TEXT_A)] });
    const far = await evaluatePlatformNovelty(input(fpUnrelated), { retrieve: async () => [neighbourOf(TEXT_A)] });
    expect(far.score).toBeGreaterThan(near.score);
  });
});

/* ── §11 / §16 N — determinism ─────────────────────────────────────────── */

describe('B5 · N — deterministic', () => {
  it('same corpus + fingerprint + config ⇒ identical band, score and dimensions', async () => {
    const run = () => evaluatePlatformNovelty(input(fpNear), {
      retrieve: async () => [neighbourOf(TEXT_A), neighbourOf(TEXT_UNRELATED)],
      config: { collisionThreshold: 0.2, adjacentThreshold: 0.6 },
    });
    const a = await run();
    const b = await run();
    const c = await run();
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('neighbour ORDER does not change the result (max per dimension)', () => {
    const fwd = computePlatformDimensions(input(fpNear), [neighbourOf(TEXT_A), neighbourOf(TEXT_UNRELATED)]);
    const rev = computePlatformDimensions(input(fpNear), [neighbourOf(TEXT_UNRELATED), neighbourOf(TEXT_A)]);
    expect(fwd).toEqual(rev);
  });

  it('scoring is a pure function of the dimensions', () => {
    expect(scoreFromDimensions({ simhash: 0.9 })).toBeCloseTo(0.1, 6);
    expect(scoreFromDimensions({ simhash: 0.4, semantic: 0.8 })).toBeCloseTo(0.2, 6);
    expect(scoreFromDimensions({})).toBe(1);
  });
});

/* ── retrieval policy ──────────────────────────────────────────────────── */

describe('B5 · retrieval reuses the gate candidate cap', () => {
  it('DEFAULT_MAX_CANDIDATES is 50, matching originalityGate', () => {
    expect(DEFAULT_MAX_CANDIDATES).toBe(50);
  });
});

/* ── §16 J — fingerprint write failure is swallowed ────────────────────── */

describe('B5 · J — a fingerprint write failure never disturbs the accepted artifact', () => {
  it('a throwing client returns false rather than propagating', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(
      recordPlatformFingerprint({ fingerprint: fpA, contentType: 'post' }),
    ).resolves.toBe(false);
  });

  it('an insert error returns false rather than throwing', async () => {
    mockFrom.mockImplementation(((): unknown => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
      insert: async () => ({ error: { message: 'nope' } }),
    })) as never);
    await expect(
      recordPlatformFingerprint({ fingerprint: fpA, contentType: 'post' }),
    ).resolves.toBe(false);
  });
});
