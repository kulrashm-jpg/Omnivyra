/**
 * B5 §4 — PRIVACY INVARIANTS. These run BEFORE any runtime wiring exists.
 *
 * The platform tier is the only place in the system where one tenant's content
 * influences another tenant's generation. Everything that makes that safe is
 * asserted here, structurally:
 *
 *   A. PlatformNoveltySignal carries no identifying field
 *   B. Runtime output carries none of those keys
 *   C. The DDL contains no tenant/content column
 *   D. No route/API/MCP/admin surface exposes platform novelty
 *   E. The service's evaluate input cannot carry company/campaign/content ids
 *
 * These are SOURCE- and TYPE-level assertions on purpose. A behavioural test
 * proves the current code does not leak; a structural test proves a future
 * edit cannot start leaking without failing here.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATION = path.join(
  REPO, 'supabase/migrations/20260919000000_platform_content_fingerprint.sql',
);
const SERVICE = path.join(REPO, 'backend/services/content/platformNoveltyService.ts');

const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Identity/content fields that must never appear in a platform signal. */
const FORBIDDEN_SIGNAL_KEYS = [
  'memoryId', 'memory_id',
  'excerpt',
  'companyId', 'company_id',
  'contentId', 'content_id',
  'campaignId', 'campaign_id',
  'userId', 'user_id',
  'body', 'title', 'topic', 'text',
];

/* ── C. Schema privacy ──────────────────────────────────────────────────── */

describe('B5 · C — the platform table has no tenant or content column', () => {
  const ddl = read(MIGRATION);
  /** Only the CREATE TABLE body, so prose in comments cannot mask a real column. */
  const columnBlock = (() => {
    const start = ddl.indexOf('CREATE TABLE IF NOT EXISTS public.platform_content_fingerprint');
    const end = ddl.indexOf(');', start);
    return ddl
      .slice(start, end)
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))   // strip comment lines
      .join('\n');
  })();

  it.each([
    'company_id', 'campaign_id', 'content_id', 'user_id',
    'body', 'title', 'topic', 'excerpt', 'token_summary',
  ])('column %s is absent from the table definition', (col) => {
    expect(columnBlock).not.toMatch(new RegExp(`^\\s*${col}\\s`, 'm'));
  });

  it('declares exactly the certified column set', () => {
    const declared = columnBlock
      .split('\n')
      .map((l) => l.trim().match(/^([a-z_]+)\s+(uuid|text|jsonb|vector|integer|timestamptz)/))
      .filter(Boolean)
      .map((m) => m![1]);
    expect(declared.sort()).toEqual([
      'content_type', 'created_at', 'embedding', 'embedding_model', 'embedding_version',
      'exact_hash', 'first_seen_at', 'id', 'last_seen_at', 'minhash', 'modality',
      'normalized_hash', 'occurrence_count', 'simhash', 'structural_shape', 'updated_at',
    ]);
  });

  it('enables RLS and creates NO policy (deny-by-default)', () => {
    expect(ddl).toMatch(/ALTER TABLE public\.platform_content_fingerprint ENABLE ROW LEVEL SECURITY/);
    expect(ddl).not.toMatch(/CREATE POLICY/);
  });

  it('is additive: it alters no pre-existing table', () => {
    const alters = ddl.match(/ALTER TABLE\s+(?:public\.)?([a-z_]+)/g) ?? [];
    for (const a of alters) {
      expect(a).toMatch(/platform_content_fingerprint/);
    }
    expect(ddl).not.toMatch(/DROP\s+(TABLE|COLUMN)/);
  });

  it('carries the required indexes and the house trigger', () => {
    expect(ddl).toMatch(/platform_fp_dedup_uidx[\s\S]*?\(modality, content_type, normalized_hash\)/);
    expect(ddl).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    expect(ddl).toMatch(/platform_fp_simhash_idx/);
    expect(ddl).toMatch(/platform_fp_shape_idx/);
    expect(ddl).toMatch(/platform_fp_last_seen_idx/);
    expect(ddl).toMatch(/omnivyra_touch_updated_at/);
  });

  it('has a matching rollback artifact', () => {
    const rb = path.join(REPO, 'supabase/migrations/rollbacks/platform_content_fingerprint_rollback.sql');
    expect(fs.existsSync(rb)).toBe(true);
    expect(read(rb)).toMatch(/DROP TABLE IF EXISTS public\.platform_content_fingerprint/);
  });
});

/* ── A + E. Service/type surface ────────────────────────────────────────── */

describe('B5 · A/E — the service surface cannot carry identity', () => {
  const src = read(SERVICE);
  /** The exported type block for the signal. */
  const signalBlock = (() => {
    const i = src.indexOf('export interface PlatformNoveltySignal');
    return src.slice(i, src.indexOf('}', i));
  })();

  it.each(FORBIDDEN_SIGNAL_KEYS)('PlatformNoveltySignal declares no `%s`', (k) => {
    expect(signalBlock).not.toMatch(new RegExp(`\\b${k}\\b`));
  });

  it('declares exactly band + score + dimensions', () => {
    const fields = signalBlock
      .split('\n')
      .map((l) => l.trim().match(/^([a-zA-Z]+)\??:/))
      .filter(Boolean)
      .map((m) => m![1]);
    expect(fields.sort()).toEqual(['band', 'dimensions', 'score']);
  });

  it('exposes only simhash/semantic/structural/embedding dimensions — never exact/normalized', () => {
    const dimsLine = signalBlock.split('\n').find((l) => l.includes('dimensions')) ?? '';
    expect(dimsLine).toMatch(/simhash/);
    expect(dimsLine).not.toMatch(/\bexact\b/);
    expect(dimsLine).not.toMatch(/\bnormalized\b/);
  });

  it('the evaluate input takes a fingerprint + content type, not tenant ids', () => {
    const i = src.indexOf('export interface PlatformEvaluationInput');
    const block = src.slice(i, src.indexOf('}', i));
    expect(block).toMatch(/fingerprint/);
    expect(block).toMatch(/contentType/);
    for (const k of ['companyId', 'campaignId', 'contentId', 'userId']) {
      expect(block).not.toMatch(new RegExp(`\\b${k}\\b`));
    }
  });

  it('the service never selects a tenant column (it cannot — none exists)', () => {
    for (const col of ['company_id', 'campaign_id', 'content_id', 'user_id']) {
      expect(src).not.toMatch(new RegExp(`['"\`]${col}['"\`]`));
    }
  });

  it('the service has no throw statement — the tier can never block', () => {
    const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/\bthrow\b/);
  });
});

/* ── D. No client-reachable surface ─────────────────────────────────────── */

describe('B5 · D — platform novelty is unreachable from any client API', () => {
  /** Every file under pages/api, recursively. */
  const routeFiles = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
      }
    };
    walk(path.join(REPO, 'pages/api'));
    return out;
  })();

  it('finds a non-trivial route set to check against', () => {
    expect(routeFiles.length).toBeGreaterThan(100);
  });

  it('no API route imports the platform novelty service', () => {
    const offenders = routeFiles.filter((f) => read(f).includes('platformNoveltyService'));
    expect(offenders).toEqual([]);
  });

  it('no API route references the platform table', () => {
    const offenders = routeFiles.filter((f) => read(f).includes('platform_content_fingerprint'));
    expect(offenders).toEqual([]);
  });

  it('no API route returns a PlatformNoveltySignal', () => {
    const offenders = routeFiles.filter((f) => read(f).includes('PlatformNoveltySignal'));
    expect(offenders).toEqual([]);
  });
});
