/**
 * PHASE A1.3 — Canonical Persistence Policy contract tests.
 *
 * Proves the activation boundary that lets the Phase A foundation schema be
 * introduced while every canonical write stays inert BY POLICY rather than
 * merely because the tables are absent.
 *
 * Test IDs map to the phase brief §15 (A–H) and the §12 state matrix.
 *
 * The canonical writers are exercised against a MOCKED supabase client, so a
 * denied write is proven by the client never being touched — no live database,
 * no AI, no network.
 */

// Mock the DB so "no write attempted" is directly observable.
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
// Moderation is called inside createContent AFTER the policy gate; stub it so a
// denied call can be proven to never reach it.
jest.mock('../../services/ai/safety', () => ({
  moderateBeforePersist: jest.fn(async () => ({ allow: true, categories: [], auditId: 'a' })),
  AiError: class AiError extends Error {},
}));

import { supabase } from '../../db/supabaseClient';
import { moderateBeforePersist } from '../../services/ai/safety';
import {
  evaluateCanonicalPersistence,
  isCanonicalPersistenceEnabled,
  assertCanonicalPersistenceAllowed,
  CanonicalPersistenceDisabledError,
  CANONICAL_PERSISTENCE_ENV,
} from '../../services/content/canonicalPersistencePolicy';
import {
  createContent,
  updateContent,
  setLifecycleStatus,
  upsertVariant,
  associateAsset,
} from '../../services/content/contentService';

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockModerate = moderateBeforePersist as jest.MockedFunction<typeof moderateBeforePersist>;

const PRIOR = process.env[CANONICAL_PERSISTENCE_ENV];

function setEnv(value: string | undefined): void {
  if (value === undefined) delete process.env[CANONICAL_PERSISTENCE_ENV];
  else process.env[CANONICAL_PERSISTENCE_ENV] = value;
}

beforeEach(() => {
  jest.clearAllMocks();
  setEnv(undefined);
});

afterAll(() => setEnv(PRIOR));

describe('EC-A1.3 · A — default DENY', () => {
  it('denies when the variable is unset', () => {
    setEnv(undefined);
    expect(isCanonicalPersistenceEnabled()).toBe(false);
    expect(evaluateCanonicalPersistence()).toEqual({ allowed: false, reason: 'policy_disabled' });
  });

  it('denies when the variable is empty or whitespace', () => {
    for (const v of ['', '   ']) {
      setEnv(v);
      expect(isCanonicalPersistenceEnabled()).toBe(false);
    }
  });
});

describe('EC-A1.3 · B — explicit enable', () => {
  it('allows only the house affirmative tokens', () => {
    for (const v of ['true', 'TRUE', '1', 'on', 'yes', ' true ', 'Yes']) {
      setEnv(v);
      expect(isCanonicalPersistenceEnabled()).toBe(true);
      expect(evaluateCanonicalPersistence()).toEqual({ allowed: true, reason: 'allowed' });
    }
  });
});

describe('EC-A1.3 · C — explicit disable', () => {
  it('denies the negative tokens', () => {
    for (const v of ['false', 'FALSE', '0', 'off', 'no']) {
      setEnv(v);
      expect(isCanonicalPersistenceEnabled()).toBe(false);
    }
  });
});

describe('EC-A1.3 · D — malformed configuration never enables', () => {
  it('denies arbitrary / truthy-looking strings', () => {
    // These are exactly the values a `Boolean(process.env.X)` implementation
    // would wrongly treat as enabled.
    for (const v of ['maybe', 'TRUE!', 'enabled', 'y', 't', '2', '-1', 'null', 'undefined', 'on ]']) {
      setEnv(v);
      expect(isCanonicalPersistenceEnabled()).toBe(false);
      expect(evaluateCanonicalPersistence().reason).toBe('policy_disabled');
    }
  });

  it('is deterministic and side-effect free', () => {
    setEnv('true');
    const a = evaluateCanonicalPersistence({ operation: 'createContent' });
    const b = evaluateCanonicalPersistence({ operation: 'upsertVariant' });
    expect(a).toEqual(b); // decision never varies by context
  });
});

describe('EC-A1.3 · D2 — the guard throws a typed, API-mappable refusal', () => {
  it('carries status 503 + a machine-readable code', () => {
    setEnv(undefined);
    try {
      assertCanonicalPersistenceAllowed('createContent');
      throw new Error('expected a refusal');
    } catch (err) {
      expect(err).toBeInstanceOf(CanonicalPersistenceDisabledError);
      const e = err as CanonicalPersistenceDisabledError;
      // respondServiceError() maps `status` + `code` directly — no API change.
      expect(e.status).toBe(503);
      expect(e.code).toBe('CANONICAL_PERSISTENCE_DISABLED');
      expect(e.reason).toBe('policy_disabled');
      expect(e.message).toContain('createContent');
    }
  });

  it('does not throw when allowed', () => {
    setEnv('true');
    expect(() => assertCanonicalPersistenceAllowed('createContent')).not.toThrow();
  });
});

describe('EC-A1.3 · E — writer enforcement (policy OFF ⇒ no write attempted)', () => {
  beforeEach(() => setEnv(undefined));

  it('createContent refuses before touching the database OR moderation', async () => {
    await expect(
      createContent({ companyId: 'co-1', contentType: 'post', body: 'x' }),
    ).rejects.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockFrom).not.toHaveBeenCalled();
    // Proves the gate sits before the (potentially chargeable) moderation call.
    expect(mockModerate).not.toHaveBeenCalled();
  });

  it('updateContent refuses without a database call', async () => {
    await expect(
      updateContent('c-1', 'co-1', { body: 'y' }, { revisionType: 'manual' }),
    ).rejects.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('setLifecycleStatus refuses without a database call', async () => {
    await expect(
      setLifecycleStatus('c-1', 'co-1', 'approved'),
    ).rejects.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('upsertVariant refuses without a database call', async () => {
    await expect(
      upsertVariant('c-1', 'co-1', 'linkedin', { generatedContent: 'z' }),
    ).rejects.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('associateAsset refuses without a database call', async () => {
    await expect(
      associateAsset('c-1', 'co-1', { assetId: 'asset-abc' }),
    ).rejects.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('EC-A1.3 · E2 — writer enforcement (policy ON ⇒ existing path invoked)', () => {
  beforeEach(() => setEnv('true'));

  it('createContent proceeds past the gate into the existing write path', async () => {
    // The gate must NOT be what stops it. Reaching moderation + supabase proves
    // the policy allowed the operation; the write itself then fails on the
    // deliberately-unconfigured mock, which is fine — coverage of the happy
    // write path belongs to contentService's own suite.
    mockFrom.mockImplementation(() => {
      throw new Error('MOCK_DB_REACHED');
    });
    await expect(
      createContent({ companyId: 'co-1', contentType: 'post', body: 'x' }),
    ).rejects.not.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockModerate).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalled();
  });

  it('upsertVariant proceeds past the gate', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('MOCK_DB_REACHED');
    });
    await expect(
      upsertVariant('c-1', 'co-1', 'linkedin', { generatedContent: 'z' }),
    ).rejects.not.toBeInstanceOf(CanonicalPersistenceDisabledError);
    expect(mockFrom).toHaveBeenCalled();
  });
});

describe('EC-A1.3 · F — independence from ORIGINALITY_GATE_ENABLED', () => {
  const PRIOR_ORIG = process.env.ORIGINALITY_GATE_ENABLED;
  afterAll(() => {
    if (PRIOR_ORIG === undefined) delete process.env.ORIGINALITY_GATE_ENABLED;
    else process.env.ORIGINALITY_GATE_ENABLED = PRIOR_ORIG;
  });

  it('originality ON does not enable persistence', () => {
    process.env.ORIGINALITY_GATE_ENABLED = 'true';
    setEnv(undefined);
    expect(isCanonicalPersistenceEnabled()).toBe(false);
  });

  it('originality OFF does not disable persistence', () => {
    process.env.ORIGINALITY_GATE_ENABLED = 'false';
    setEnv('true');
    expect(isCanonicalPersistenceEnabled()).toBe(true);
  });

  it('the policy never reads the originality variable', () => {
    // Full state matrix: persistence is a pure function of its OWN variable.
    for (const orig of [undefined, 'true', 'false']) {
      if (orig === undefined) delete process.env.ORIGINALITY_GATE_ENABLED;
      else process.env.ORIGINALITY_GATE_ENABLED = orig;
      setEnv('true');
      expect(isCanonicalPersistenceEnabled()).toBe(true);
      setEnv('false');
      expect(isCanonicalPersistenceEnabled()).toBe(false);
    }
  });
});

describe('EC-A1.3 · G — legacy production tables are NOT gated', () => {
  it('the policy module references no legacy table or service', () => {
    // The Phase A boundary must not disable content_assets (PLURAL — the live
    // campaign asset flow), creator_assets, blogs, daily_content_plans or
    // scheduled_posts. A regression here would break shipping features.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const source = require('fs').readFileSync(
      require('path').join(process.cwd(), 'backend/services/content/canonicalPersistencePolicy.ts'),
      'utf8',
    );
    // Strip comments — the rationale prose legitimately names these tables.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const legacy of ['content_assets', 'creator_assets', 'blogs', 'daily_content_plans', 'scheduled_posts']) {
      expect(code).not.toContain(legacy);
    }
    // And it performs no database access at all.
    expect(code).not.toContain('supabase');
  });

  it('the policy is tenant-neutral — no company/campaign input', () => {
    setEnv('true');
    const decision = evaluateCanonicalPersistence({ operation: 'createContent' });
    expect(Object.keys(decision).sort()).toEqual(['allowed', 'reason']);
  });
});

describe('EC-A1.3 · §17 — FOUNDATION INERT BY POLICY', () => {
  it('with persistence denied, no Phase A canonical table is written', async () => {
    setEnv(undefined);
    // content + content_revision
    await expect(createContent({ companyId: 'co-1', contentType: 'post', body: 'a' })).rejects.toThrow();
    await expect(updateContent('c', 'co-1', { body: 'b' }, { revisionType: 'manual' })).rejects.toThrow();
    // content (lifecycle)
    await expect(setLifecycleStatus('c', 'co-1', 'approved')).rejects.toThrow();
    // content_variant
    await expect(upsertVariant('c', 'co-1', 'x', {})).rejects.toThrow();
    // content_asset
    await expect(associateAsset('c', 'co-1', { assetId: 'a' })).rejects.toThrow();

    // The single assertion that matters: the database was never reached for ANY
    // of them. Inert by POLICY — this holds whether or not the tables exist.
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
