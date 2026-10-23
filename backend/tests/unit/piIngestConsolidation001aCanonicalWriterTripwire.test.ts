/**
 * PI-INGEST-CONSOLIDATION-001-A — the canonical-writer tripwire.
 *
 * Who may write a canonical prospect row is a rule the repository states in prose
 * and, until now, nothing enforced across the whole tree. `ingestionBoundary`
 * declares itself "THE ONLY PLACE CANONICAL ATTRIBUTES MAY BE WRITTEN FROM SOURCE
 * DATA", and `prospectIdentityIngestionBoundary.test.ts` enforces that for LI-1
 * ATTRIBUTE columns. This test is the complementary, coarser guard: it pins the
 * exact set of files that write these tables at all.
 *
 * ─── IT ENCODES REALITY, NOT THE IDEAL ────────────────────────────────────
 * The allow-lists below were produced by scanning the tree, and two entries are
 * NOT what the architecture documents would predict — `lib/identity/identityGateway.ts`
 * inserts `unified_persons`, and `ga4IngestionService.ts` writes `canonical_users`.
 * They are listed because they exist today, each with a comment recording that it
 * is an open question rather than a blessing. A tripwire that encoded the ideal
 * would fail immediately and be deleted; one that encodes reality fails only when
 * reality changes, which is the point.
 *
 * So a failure here means one of two things, and the message says which:
 *   - a NEW writer appeared  → justify it or route through the sanctioned owner
 *   - a writer DISAPPEARED   → the consolidation this test was built for happened;
 *                              update the list deliberately in that commit
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['backend', 'pages', 'lib'];
const WRITE_VERBS = ['insert', 'update', 'upsert', 'delete'] as const;

/**
 * The tables whose rows ARE the canonical prospect spine, plus the two legacy
 * tables the CRM path still writes. `leads` is included deliberately: 15 modules
 * read it, so a change of writer there is a change of contract.
 */
const GOVERNED_TABLES = [
  'canonical_leads',
  'unified_persons',
  'prospect_accounts',
  'canonical_users',
  'leads',
  'canonical_revenue_events',
] as const;

/** Observed writers, as of the release this test was written against (7febdb28). */
const SANCTIONED: Record<string, readonly string[]> = {
  canonical_leads: [
    'backend/services/crmIngestionService.ts',            // legacy CRM path — the subject of PI-INGEST-CONSOLIDATION-001
    'backend/services/prospectIdentity/prospectResolution.ts', // WS-1, the canonical owner
  ],
  unified_persons: [
    'backend/services/identityResolutionService.ts',      // W1, the sole resolve-or-create authority
    'backend/services/prospectIdentity/accountResolution.ts', // W4 back-link only
    'backend/services/prospectIdentity/personErasure.ts', // erasure, by design
    'lib/identity/identityGateway.ts',                    // OPEN QUESTION: a writer outside prospectIdentity/*
  ],
  prospect_accounts: [
    'backend/services/prospectIdentity/accountResolution.ts',
  ],
  canonical_users: [
    'backend/services/crmIngestionService.ts',
    'backend/services/ga4IngestionService.ts',            // OPEN QUESTION: analytics writing a canonical identity table
    'backend/services/prospectIdentity/prospectResolution.ts',
  ],
  leads: [
    // 003-B-R1 removed `crmIngestionService` from this list: the CRM path no
    // longer writes the legacy web-form table. `leadService` remains the single
    // writer, from website capture and inbound webhooks.
    'backend/services/leadService.ts',
  ],
  canonical_revenue_events: [
    'backend/services/crmIngestionService.ts',
  ],
};

function collect(dir: string, out: string[]): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (/node_modules|\.next|\.git|__snapshots__/.test(p)) continue;
      collect(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Files that write `table`, expressed as repo-relative POSIX paths. */
function writersOf(table: string): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) collect(join(ROOT, d), files);
  const found = new Set<string>();
  // A write is the table named in a from()/ownedDbTable() call whose chain
  // reaches a write verb. The window is generous so a formatted multi-line
  // chain is not missed; a stray match would only ever ADD a writer, which
  // surfaces as a failure to investigate rather than a silent pass.
  const re = new RegExp(`(?:ownedDbTable|from)\\(\\s*['"]${table}['"]\\s*\\)([\\s\\S]{0,600})`, 'g');
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/');
    if (/(^|\/)tests?\//.test(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const src = readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      if (WRITE_VERBS.some((v) => new RegExp(`\\.${v}\\(`).test(m![1]))) { found.add(rel); break; }
    }
  }
  return Array.from(found).sort();
}

describe('canonical prospect writers are fenced', () => {
  for (const table of GOVERNED_TABLES) {
    it(`only the sanctioned files write ${table}`, () => {
      const actual = writersOf(table);
      const expected = [...(SANCTIONED[table] ?? [])].sort();
      const added = actual.filter((f) => !expected.includes(f));
      const removed = expected.filter((f) => !actual.includes(f));
      expect({ table, added, removed }).toEqual({ table, added: [], removed: [] });
    });
  }
});

describe('the boundary rules the tripwire protects', () => {
  it('prospect_accounts has exactly one writer — W4', () => {
    expect(writersOf('prospect_accounts')).toEqual(['backend/services/prospectIdentity/accountResolution.ts']);
  });

  it('the LI-4D orchestrator writes no canonical table directly', () => {
    // Its whole contract is delegation: it owns the ORDER, not the rules. A
    // direct write appearing here would mean a second prospect writer.
    const orchestrator = readFileSync(join(ROOT, 'backend/services/leadIngestion/orchestrator.ts'), 'utf8');
    for (const t of GOVERNED_TABLES) {
      expect(orchestrator).not.toContain(`ownedDbTable('${t}')`);
    }
  });

  it('WS-1 creates a prospect by INSERT, never by upsert', () => {
    const ws1 = readFileSync(join(ROOT, 'backend/services/prospectIdentity/prospectResolution.ts'), 'utf8');
    expect(ws1).toContain("ownedDbTable('canonical_leads').insert(");
    expect(ws1).not.toContain("ownedDbTable('canonical_leads').upsert(");
  });

  it('the legacy CRM path reaches canonical_leads by select-then-update, which WS-1 does not', () => {
    // Recorded so consolidation cannot lose the difference silently: the legacy
    // path mutates an existing row keyed on the source's own external key.
    const legacy = readFileSync(join(ROOT, 'backend/services/crmIngestionService.ts'), 'utf8');
    expect(legacy).toContain("ownedDbTable('canonical_leads')");
    expect(legacy).toContain("eq('external_lead_key'");
  });
});
