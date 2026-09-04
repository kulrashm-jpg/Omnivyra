/**
 * B7.1 §17 — STRUCTURAL PRIVACY, asserted before any functional test.
 *
 * These are SOURCE-level assertions over the migration DDL. They prove that a
 * future edit cannot start leaking without failing here — a behavioural test
 * only proves today's code is clean.
 *
 * Behavioural RLS proof (a real non-superuser role reading real rows) is NOT
 * attempted here and cannot be: it requires PostgreSQL. It is performed in the
 * isolated pgvector rehearsal and reported separately as DATABASE PROOF.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATION = path.join(
  REPO, 'supabase/migrations/20260922000000_content_knowledge_graph_foundation.sql',
);
const ROLLBACK = path.join(
  REPO, 'supabase/migrations/rollbacks/content_knowledge_graph_foundation_rollback.sql',
);

const ddl = fs.readFileSync(MIGRATION, 'utf8');
const rollback = fs.readFileSync(ROLLBACK, 'utf8');

/** The CREATE TABLE body for `table`, with comment lines stripped so prose in
 *  the (heavily commented) migration cannot mask or fake a column. */
function columnBlock(table: string): string {
  const start = ddl.indexOf(`CREATE TABLE IF NOT EXISTS public.${table} (`);
  expect(start).toBeGreaterThan(-1);
  const end = ddl.indexOf('\n);', start);
  return ddl
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

/** Column names declared in a table body. */
function declaredColumns(table: string): string[] {
  return columnBlock(table)
    .split('\n')
    .map((l) => l.trim().match(/^([a-z_]+)\s+(uuid|text|jsonb|vector|integer|timestamptz)\b/))
    .filter(Boolean)
    .map((m) => m![1]);
}

/* ── §9.1-9.5 — the platform table carries no tenant or content column ───── */

describe('B7.1 · platform_topic_node has no tenant or private-content column', () => {
  const block = columnBlock('platform_topic_node');

  it.each(['company_id', 'campaign_id', 'content_id', 'user_id', 'customer_id', 'organization_id'])(
    'tenant column %s is absent',
    (col) => {
      expect(block).not.toMatch(new RegExp(`^\\s*${col}\\s`, 'm'));
    },
  );

  it.each(['body', 'title', 'topic', 'excerpt', 'text_excerpt', 'token_summary', 'source_url', 'raw_payload'])(
    'private-content column %s is absent',
    (col) => {
      expect(block).not.toMatch(new RegExp(`^\\s*${col}\\s`, 'm'));
    },
  );

  it('declares exactly the B7.0-certified column set', () => {
    expect(declaredColumns('platform_topic_node').sort()).toEqual([
      'canonical_label', 'canonical_topic_id', 'confidence', 'created_at',
      'embedding', 'embedding_model', 'embedding_version', 'first_seen_at', 'id',
      'last_seen_at', 'normalized_label', 'occurrence_count', 'parent_topic_id',
      'source', 'state', 'updated_at',
    ]);
  });
});

/* ── §9.6-9.8 — RLS posture ─────────────────────────────────────────────── */

describe('B7.1 · RLS posture', () => {
  it('enables RLS on both tables', () => {
    expect(ddl).toMatch(/ALTER TABLE public\.platform_topic_node ENABLE ROW LEVEL SECURITY/);
    expect(ddl).toMatch(/ALTER TABLE public\.company_topic_coverage ENABLE ROW LEVEL SECURITY/);
  });

  it('creates ZERO policies on the platform table', () => {
    // Exactly one CREATE POLICY exists in the file, and it targets coverage.
    const policies = ddl.match(/CREATE POLICY\s+(\w+)\s+ON\s+public\.(\w+)/g) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/ON public\.company_topic_coverage/);
    expect(ddl).not.toMatch(/CREATE POLICY[\s\S]{0,120}ON public\.platform_topic_node/);
  });

  it('scopes coverage through active user_company_roles membership — the Phase A pattern', () => {
    expect(ddl).toMatch(
      /company_id IN \(SELECT company_id FROM public\.user_company_roles\s+WHERE user_id = auth\.uid\(\) AND status = 'active'\)/,
    );
  });

  it('applies the membership check to writes as well as reads', () => {
    const policy = ddl.slice(ddl.indexOf('CREATE POLICY company_topic_coverage_company_rw'));
    expect(policy).toMatch(/USING \(/);
    expect(policy).toMatch(/WITH CHECK \(/);
  });

  it('invents no alternative authorization mechanism', () => {
    // Comment lines stripped: the migration DISCUSSES GRANTs in prose (explaining
    // that RLS denies even when they are present) but must issue none.
    const sql = ddl
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith('--'))
      .join(String.fromCharCode(10));
    expect(sql).not.toMatch(/CREATE ROLE|GRANT|SECURITY DEFINER|bypassrls/i);
  });
});

/* ── §15 — additive only ────────────────────────────────────────────────── */

describe('B7.1 · the migration is additive only', () => {
  it('creates exactly two tables', () => {
    const created = ddl.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g) ?? [];
    expect(created).toHaveLength(2);
    expect(created.join()).toContain('platform_topic_node');
    expect(created.join()).toContain('company_topic_coverage');
  });

  it('ALTERs only its own tables', () => {
    for (const a of ddl.match(/ALTER TABLE\s+(?:public\.)?(\w+)/g) ?? []) {
      expect(a).toMatch(/platform_topic_node|company_topic_coverage/);
    }
  });

  it('drops nothing and mutates no existing data', () => {
    expect(ddl).not.toMatch(/\bDROP\b/);
    expect(ddl).not.toMatch(/\bUPDATE\s+public\./);
    expect(ddl).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(ddl).not.toMatch(/\bINSERT\s+INTO\b/);
  });

  it('is transactional', () => {
    expect(ddl).toMatch(/^BEGIN;/m);
    expect(ddl.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('reuses existing infrastructure rather than creating a second one', () => {
    expect(ddl).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);   // idempotent no-op
    expect(ddl).toMatch(/omnivyra_touch_updated_at/);               // house trigger fn
    expect(ddl).not.toMatch(/CREATE OR REPLACE FUNCTION/);          // no second fn
  });
});

/* ── §3, §5, §6, §7 — the schema shape B7.0 locked ──────────────────────── */

describe('B7.1 · schema matches the B7.0 decision', () => {
  it('creates no third graph table — no alias, adjacency or relationship table', () => {
    const created = (ddl.match(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g) ?? []).join();
    for (const forbidden of ['alias', 'adjacen', 'edge', 'relationship', 'similarity']) {
      expect(created.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('models aliases as a self-reference, not an array or second table', () => {
    expect(columnBlock('platform_topic_node')).toMatch(
      /canonical_topic_id\s+uuid REFERENCES public\.platform_topic_node\(id\)/,
    );
    expect(ddl).not.toMatch(/aliases\s+text\[\]/);
  });

  it('models hierarchy as parent_topic_id with no edge table', () => {
    expect(columnBlock('platform_topic_node')).toMatch(
      /parent_topic_id\s+uuid REFERENCES public\.platform_topic_node\(id\)/,
    );
  });

  it('persists NO adjacency — it is derived from embedding proximity', () => {
    expect(ddl).not.toMatch(/adjacent/i);
    expect(ddl).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
  });

  it('duplicates no originality relationship (content_originality stays authoritative)', () => {
    for (const forbidden of ['near_duplicate', 'duplicates', 'semantically_overlaps', 'nearest_match']) {
      expect(ddl.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('rejects invalid self-references at the database level', () => {
    expect(ddl).toMatch(/CHECK \(canonical_topic_id IS NULL OR canonical_topic_id <> id\)/);
    expect(ddl).toMatch(/CHECK \(parent_topic_id\s+IS NULL OR parent_topic_id\s+<> id\)/);
  });

  it('constrains state and confidence to the existing KnowledgeState vocabulary', () => {
    expect(ddl).toMatch(/state IN \('unknown','observed','inferred','confirmed','corrected'\)/);
    expect(ddl).toMatch(/confidence IN \('none','low','medium','high'\)/);
  });

  it('uses vector(1536), matching the production convention', () => {
    expect(columnBlock('platform_topic_node')).toMatch(/embedding\s+vector\(1536\)/);
  });
});

describe('B7.1 · company_topic_coverage contract', () => {
  it('declares exactly the certified column set', () => {
    expect(declaredColumns('company_topic_coverage').sort()).toEqual([
      'angle_label', 'campaign_id', 'company_id', 'confidence', 'content_id',
      'coverage_count', 'created_at', 'first_covered_at', 'id', 'last_covered_at',
      'source', 'state', 'topic_id', 'updated_at',
    ]);
  });

  it('uses SOFT references — no FK to content, campaigns or the topic table', () => {
    const block = columnBlock('company_topic_coverage');
    expect(block).not.toMatch(/REFERENCES/);
  });

  it('enforces idempotent expansion on (company_id, topic_id, angle_label)', () => {
    expect(ddl).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS company_topic_coverage_uidx[\s\S]{0,140}\(company_id, topic_id, angle_label\) NULLS NOT DISTINCT/,
    );
  });

  it('indexes recency and topic lookup', () => {
    expect(ddl).toMatch(/\(company_id, last_covered_at DESC\)/);
    expect(ddl).toMatch(/company_topic_coverage_topic_idx[\s\S]{0,80}\(topic_id\)/);
  });
});

/* ── §12, §13 — write ownership and rebuildability are documented ───────── */

describe('B7.1 · documented contracts', () => {
  it('records that the platform table is authoritative and NOT derivable', () => {
    expect(ddl).toMatch(/AUTHORITATIVE, NOT[\s\S]{0,40}derivable/);
  });

  it('records that coverage is derived and fully rebuildable', () => {
    expect(ddl).toMatch(/DERIVED and fully rebuildable/);
  });

  it('documents the rebuild operation without creating a second resolver in SQL', () => {
    expect(ddl).toMatch(/REBUILD CONTRACT/);
    expect(ddl).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.rebuild/i);
  });
});

/* ── §15, §19 — rollback ────────────────────────────────────────────────── */

describe('B7.1 · rollback', () => {
  it('drops exactly the two new tables', () => {
    const drops = rollback.match(/DROP TABLE IF EXISTS public\.(\w+)/g) ?? [];
    expect(drops).toHaveLength(2);
    expect(drops.join()).toContain('platform_topic_node');
    expect(drops.join()).toContain('company_topic_coverage');
  });

  it('guards against destroying data (the Phase A convention)', () => {
    expect(rollback).toMatch(/ROLLBACK ABORTED[\s\S]{0,200}contains % row\(s\)/);
  });

  it('verifies completion', () => {
    expect(rollback).toMatch(/ROLLBACK INCOMPLETE/);
  });

  it('preserves the shared extension and trigger function', () => {
    expect(rollback).not.toMatch(/DROP EXTENSION/);
    expect(rollback).not.toMatch(/DROP FUNCTION/);
  });

  it('touches no pre-existing table', () => {
    for (const d of rollback.match(/DROP TABLE IF EXISTS public\.(\w+)/g) ?? []) {
      expect(d).toMatch(/platform_topic_node|company_topic_coverage/);
    }
  });
});

/* ── §2 — B7.1 wires nothing into the application ───────────────────────── */

describe('B7.2 · only the knowledgeGraph services touch the tables', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name) && !p.includes('tests')) out.push(p);
    }
    return out;
  };
  const appFiles = [
    ...walk(path.join(REPO, 'backend/services')),
    ...walk(path.join(REPO, 'pages/api')),
    ...walk(path.join(REPO, 'lib')),
  ];

  it('scans a non-trivial application surface', () => {
    expect(appFiles.length).toBeGreaterThan(500);
  });

  // B7.1 asserted NO file referenced these tables. B7.2 introduces exactly two
  // accessors, so the invariant tightens rather than relaxes: only the
  // knowledgeGraph services may name them, and no API route ever may.
  it.each(['platform_topic_node', 'company_topic_coverage'])(
    'only knowledgeGraph services reference %s',
    (table) => {
      // Match the table name in CODE only. The services name it via a
      // `const TABLE = '…'` constant, so a `.from('literal')` regex would miss
      // them; conversely a route that merely explains the table in a doc
      // comment is not an accessor. Stripping comments separates the two.
      const codeOf = (f: string) => fs.readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      const accessRe = new RegExp(table);
      const refs = appFiles.filter((f) => accessRe.test(codeOf(f)));
      // Path separator differs by platform, so compare on the directory name.
      for (const f of refs) expect(f.split(path.sep)).toContain('knowledgeGraph');
      expect(refs.length).toBeGreaterThan(0);
    },
  );

  it.each(['platform_topic_node', 'company_topic_coverage'])(
    'no API route references %s',
    (table) => {
      // Match the table name in CODE only. The services name it via a
      // `const TABLE = '…'` constant, so a `.from('literal')` regex would miss
      // them; conversely a route that merely explains the table in a doc
      // comment is not an accessor. Stripping comments separates the two.
      const codeOf = (f: string) => fs.readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      const accessRe = new RegExp(table);
      const routes = appFiles.filter((f) => f.includes('pages' + path.sep + 'api'));
      // A doc comment naming the table is fine; ACCESSING it from a route is not.
      expect(routes.filter((f) => accessRe.test(codeOf(f)))).toEqual([]);
    },
  );

  it('the knowledgeGraph directory contains exactly the certified services', () => {
    const dir = path.join(REPO, 'backend/services/content/knowledgeGraph');
    expect(fs.existsSync(dir)).toBe(true);
    // B7.2 shipped two; B7.5 adds the deterministic curation writer.
    expect(fs.readdirSync(dir).sort()).toEqual(['coverageService.ts', 'topicCurationService.ts', 'topicResolutionService.ts', 'topicReviewService.ts'].concat(['topicCandidateService.ts', 'topicEmbeddingTrigger.ts']).sort());
  });
});
