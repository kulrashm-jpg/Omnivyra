/**
 * ENG-004 — engagement_messages tenant hardening (G-04).
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE, STATED UP FRONT.
 *
 * The hardening has two halves. The APPLICATION half — every message lookup
 * carries `organization_id` — is proven here: §A exercises a faithful in-memory
 * query builder to show that the predicate is what makes another tenant's row
 * invisible, and §B pins the predicate at each hardened call site so removing one
 * fails a test rather than passing silently.
 *
 * The DATABASE half — the NOT NULL column, the two composite foreign keys, the
 * write-time trigger — is NOT proven here. Proving it needs a real PostgreSQL, and
 * this machine has none available to this gate (Docker is down and starting it
 * auto-starts a production-connected worker). §C therefore asserts the migration's
 * CONTENT, which is a weaker claim than executing it, and the ENG-004 report
 * records the DB half as BLOCKED rather than verified. A reader should not take
 * §C as evidence that the migration applies.
 */

import fs from 'fs';
import path from 'path';

const read = (p: string): string => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Source with comments stripped, so no guard can be satisfied by its own prose. */
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const ORG_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const THREAD_A = '11111111-0000-4000-8000-00000000001a';
const THREAD_B = '22222222-0000-4000-8000-00000000002b';
const MSG_A = 'aaaa1111-0000-4000-8000-00000000001a';
const MSG_B = 'bbbb2222-0000-4000-8000-00000000002b';

// ---------------------------------------------------------------------------
// §A — the predicate is what provides the isolation
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  organization_id: string;
  thread_id: string;
  parent_message_id: string | null;
  platform: string;
  platform_message_id: string | null;
  content: string;
}

const ROWS: readonly Row[] = [
  {
    id: MSG_A, organization_id: ORG_A, thread_id: THREAD_A, parent_message_id: null,
    platform: 'linkedin', platform_message_id: 'urn:li:comment:A', content: 'tenant A message',
  },
  {
    id: MSG_B, organization_id: ORG_B, thread_id: THREAD_B, parent_message_id: MSG_A,
    platform: 'linkedin', platform_message_id: 'urn:li:comment:B', content: 'tenant B SECRET',
  },
];

/**
 * A query builder that applies filters faithfully. Deliberately NOT a stub that
 * returns a canned row: the whole point is that dropping a predicate changes the
 * result set, which is what makes the §D probes meaningful.
 */
function table(rows: readonly Row[]) {
  const eq: Array<[string, unknown]> = [];
  const inList: Array<[string, readonly unknown[]]> = [];
  const api = {
    select: () => api,
    eq: (col: string, val: unknown) => { eq.push([col, val]); return api; },
    in: (col: string, vals: readonly unknown[]) => { inList.push([col, vals]); return api; },
    rows: (): Row[] =>
      rows.filter((r) => {
        const rec = r as unknown as Record<string, unknown>;
        return eq.every(([c, v]) => rec[c] === v) && inList.every(([c, v]) => v.includes(rec[c]));
      }),
    maybeSingle: () => {
      const found = api.rows();
      return { data: found[0] ?? null, error: null };
    },
  };
  return api;
}

describe('ENG-004 §A — a tenant predicate is what hides another tenant row', () => {
  it('POSITIVE: tenant A resolves its own message by id', () => {
    const got = table(ROWS).select().eq('organization_id', ORG_A).eq('id', MSG_A).maybeSingle();
    expect(got.data).not.toBeNull();
    expect(got.data?.content).toBe('tenant A message');
  });

  it('NEGATIVE: tenant A cannot resolve tenant B message by id', () => {
    const got = table(ROWS).select().eq('organization_id', ORG_A).eq('id', MSG_B).maybeSingle();
    expect(got.data).toBeNull();
  });

  it('demonstrates the counterfactual: WITHOUT the tenant predicate, B is returned', () => {
    const got = table(ROWS).select().eq('id', MSG_B).maybeSingle();
    expect(got.data).not.toBeNull();
    expect(got.data?.content).toBe('tenant B SECRET');
    // This is exactly the leak the hardening removes, and it is asserted rather
    // than described so the harness itself cannot be silently broken.
  });

  it('POSITIVE/NEGATIVE: parent lookup is tenant-bounded', () => {
    // B's message names A's message as its parent — representable today, which is
    // why the migration adds a composite parent FK as well as the predicate.
    expect(table(ROWS).select().eq('organization_id', ORG_A).eq('id', MSG_A).maybeSingle().data).not.toBeNull();
    expect(table(ROWS).select().eq('organization_id', ORG_B).eq('id', MSG_A).maybeSingle().data).toBeNull();
  });

  it('POSITIVE/NEGATIVE: platform_message_id is not a cross-tenant key', () => {
    const a = table(ROWS).select()
      .eq('organization_id', ORG_A).eq('platform', 'linkedin')
      .eq('platform_message_id', 'urn:li:comment:A').maybeSingle();
    expect(a.data?.id).toBe(MSG_A);

    const crossed = table(ROWS).select()
      .eq('organization_id', ORG_A).eq('platform', 'linkedin')
      .eq('platform_message_id', 'urn:li:comment:B').maybeSingle();
    expect(crossed.data).toBeNull();
  });

  it('POSITIVE/NEGATIVE: an in() parent sweep is bounded by the tenant list', () => {
    const scoped = table(ROWS).select()
      .in('organization_id', [ORG_A]).in('parent_message_id', [MSG_A]).rows();
    // B's reply names A's parent but belongs to B, so a tenant-bounded sweep
    // must not see it.
    expect(scoped).toHaveLength(0);

    const unscoped = table(ROWS).select().in('parent_message_id', [MSG_A]).rows();
    expect(unscoped.map((r) => r.id)).toEqual([MSG_B]);
  });
});

// ---------------------------------------------------------------------------
// §B — the predicate is present at each hardened call site
// ---------------------------------------------------------------------------

/** Extract the chained predicates of the Nth engagement_messages access in a file. */
function chainAt(file: string, occurrence: number): string {
  const src = code(file);
  const re = /(?:ownedDbTable|from)\(\s*'engagement_messages'\s*\)/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src)) !== null) {
    if (i === occurrence) {
      const rest = src.slice(m.index + m[0].length);
      const end = rest.indexOf(';');
      return rest.slice(0, end === -1 ? 400 : end);
    }
    i += 1;
  }
  throw new Error(`no engagement_messages access #${occurrence} in ${file}`);
}

const HARDENED: ReadonlyArray<{ file: string; occurrence: number; what: string }> = [
  // ENG-004
  { file: 'backend/services/engagementAiAssistantService.ts', occurrence: 0, what: 'direct id lookup' },
  { file: 'backend/services/engagementAiAssistantService.ts', occurrence: 1, what: 'parent_message_id lookup' },
  { file: 'backend/services/bulkEngagementService.ts', occurrence: 0, what: 'direct id lookup' },
  { file: 'pages/api/extension/events/comments.ts', occurrence: 0, what: 'scraped parent platform-id lookup' },
  { file: 'backend/workers/replyIntelligenceAggregationWorker.ts', occurrence: 0, what: 'parent sweep' },
  // ENG-004-CLOSE — the remaining reachable isolation surface
  { file: 'backend/services/engagementAiAssistantService.ts', occurrence: 2, what: 'thread self-attribution sweep' },
  { file: 'backend/services/engagementConversationIntelligenceService.ts', occurrence: 0, what: 'analyzeMessage (tenant now required)' },
  { file: 'backend/services/insightIntelligenceService.ts', occurrence: 0, what: 'insight message sweep' },
  { file: 'backend/services/leadDetectionService.ts', occurrence: 0, what: 'lead detection sibling sweep' },
  { file: 'backend/services/leadDetectionService.ts', occurrence: 1, what: 'lead detection message read' },
  { file: 'backend/services/responseOrchestrator.ts', occurrence: 0, what: 'orchestrator message read' },
  { file: 'backend/workers/responseStrategyLearningWorker.ts', occurrence: 0, what: 'strategy learning sweep' },
  { file: 'pages/api/engagement/generate-response.ts', occurrence: 0, what: 'signal -> thread resolution' },
  { file: 'pages/api/engagement/inbox.ts', occurrence: 0, what: 'inbox latest-message sweep' },
  { file: 'pages/api/engagement/like.ts', occurrence: 0, what: 'like target read' },
  { file: 'pages/api/engagement/message/bulk-like.ts', occurrence: 0, what: 'bulk-like id sweep' },
  { file: 'pages/api/engagement/message/bulk-like.ts', occurrence: 1, what: 'bulk-like thread sweep' },
  { file: 'pages/api/engagement/message/bulk-like.ts', occurrence: 2, what: 'bulk-like detail sweep' },
  { file: 'pages/api/engagement/message/mark-self.ts', occurrence: 0, what: 'mark-self read' },
  { file: 'pages/api/engagement/message/mark-self.ts', occurrence: 1, what: 'mark-self UPDATE' },
  { file: 'pages/api/engagement/backfill-self-signals.ts', occurrence: 1, what: 'backfill UPDATE' },
  { file: 'pages/api/engagement/reply.ts', occurrence: 0, what: 'signal source read' },
  { file: 'pages/api/engagement/reply.ts', occurrence: 1, what: 'reply target read' },
  { file: 'pages/api/engagement/suggestions.ts', occurrence: 0, what: 'suggestion target read' },
  { file: 'pages/api/engagement/thread/bulk-pattern-reply.ts', occurrence: 0, what: 'pattern reply read' },
  { file: 'pages/api/response/generate.ts', occurrence: 0, what: 'response generate read' },
];

describe('ENG-004 §B — every hardened site carries the tenant predicate', () => {
  it('the hardened set is non-empty and fully enumerated', () => {
    expect(HARDENED).toHaveLength(26);
  });

  for (const { file, occurrence, what } of HARDENED) {
    it(`${file} #${occurrence} (${what}) filters organization_id`, () => {
      const chain = chainAt(file, occurrence);
      expect(chain).toMatch(/\.(eq|in)\('organization_id'/);
    });
  }

  it('the AI assistant parent lookup is scoped by the CALLER tenant, not the message tenant', () => {
    const chain = chainAt('backend/services/engagementAiAssistantService.ts', 1);
    // `organization_id` is the function parameter — the authorized caller's tenant.
    // Taking it from the loaded message would be circular and would not isolate.
    expect(chain).toContain(".eq('organization_id', organization_id)");
    expect(chain).toContain(".eq('id', message.parent_message_id)");
  });

  it('the extension update path is tenant-scoped (§13)', () => {
    const src = code('pages/api/extension/events/comments.ts');
    const upd = src.slice(src.indexOf('.update(row)'));
    expect(upd.slice(0, 300)).toContain(".eq('organization_id', organizationId)");
  });

  it('the extension tenant comes from the session, never a request field', () => {
    const src = code('pages/api/extension/events/comments.ts');
    expect(src).toContain('const organizationId = session.orgId');
    expect(src).not.toMatch(/organizationId\s*=\s*(req\.body|body)\./);
  });
});

// ---------------------------------------------------------------------------
// §C — migration CONTENT (not execution; see the header)
// ---------------------------------------------------------------------------

describe('ENG-004 §C — migration content', () => {
  const MIG = 'supabase/migrations/20261221000000_eng004_engagement_message_tenant.sql';
  const sql = (): string => read(MIG);

  it('adds the column, backfills from the thread and only then sets NOT NULL', () => {
    const s = sql();
    const add = s.indexOf('ADD COLUMN IF NOT EXISTS organization_id');
    const backfill = s.indexOf('UPDATE public.engagement_messages');
    const validate = s.indexOf('RAISE EXCEPTION');
    const notNull = s.indexOf('SET NOT NULL');
    expect(add).toBeGreaterThan(0);
    expect(backfill).toBeGreaterThan(add);
    expect(validate).toBeGreaterThan(backfill);
    expect(notNull).toBeGreaterThan(validate);
  });

  it('ABORTS on orphans, untenanted rows or mismatches instead of repairing them', () => {
    const s = sql();
    expect(s).toMatch(/orphan_count\s+bigint/);
    expect(s).toMatch(/null_org_count\s+bigint/);
    expect(s).toMatch(/mismatch_count\s+bigint/);
    expect(s).toMatch(/RAISE EXCEPTION[\s\S]*ENG-004 ABORTED/);
    // No silent repair, no deletion.
    expect(s).not.toMatch(/DELETE FROM public\.engagement_messages/i);
    expect(s).not.toMatch(/DROP TABLE/i);
  });

  it('declares both composite tenant foreign keys', () => {
    const s = sql();
    expect(s).toMatch(/FOREIGN KEY \(thread_id, organization_id\)\s*REFERENCES public\.engagement_threads \(id, organization_id\)/);
    expect(s).toMatch(/FOREIGN KEY \(parent_message_id, organization_id\)\s*REFERENCES public\.engagement_messages \(id, organization_id\)/);
  });

  it('adds the two supporting UNIQUE constraints the FKs require', () => {
    const s = sql();
    expect(s).toContain('engagement_threads_id_org_unique UNIQUE (id, organization_id)');
    expect(s).toContain('engagement_messages_id_org_unique UNIQUE (id, organization_id)');
  });

  it('confines the parent FK ON DELETE SET NULL to the pointer column', () => {
    // A bare `ON DELETE SET NULL` on a composite FK nulls every referencing
    // column, including the NOT NULL organization_id, and the parent delete would
    // fail. The column list is load-bearing, so it is pinned.
    expect(sql()).toContain('ON DELETE SET NULL (parent_message_id)');
  });

  it('installs a trigger that derives the tenant and RAISES on a mismatch', () => {
    const s = sql();
    expect(s).toContain('CREATE OR REPLACE FUNCTION public.engagement_messages_tenant_from_thread()');
    expect(s).toMatch(/BEFORE INSERT OR UPDATE OF thread_id, organization_id/);
    // Fill when absent …
    expect(s).toContain('NEW.organization_id := thread_org');
    // … but RAISE when explicitly wrong. Without this the composite FK could
    // never be violated and any cross-tenant insert test would pass vacuously.
    expect(s).toMatch(/ELSIF NEW\.organization_id <> thread_org THEN[\s\S]*RAISE EXCEPTION/);
  });

  it('touches nothing outside the two engagement tables', () => {
    const s = sql();
    for (const forbidden of [
      'outreach_tasks', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes',
      'outreach_suppressions', 'prospect_lifecycle_transitions', 'execution_tasks',
      'execution_plan_steps', 'workflow_versions', 'email_outreach_content_evidence',
    ]) {
      expect(s).not.toContain(forbidden);
    }
    expect(s).not.toMatch(/CREATE TABLE/i);
  });

  it('ENG-004 and its closure add exactly two migrations', () => {
    const dir = path.join(process.cwd(), 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    // Re-derived on consolidation: keyed on the ENG-004 name rather than on a
    // timestamp window and a whole-directory count, both of which other lanes move.
    expect(files.filter((f) => /_eng004_/.test(f)))
      .toEqual([
        '20261221000000_eng004_engagement_message_tenant.sql',
        '20261221000001_eng004_close_platform_message_tenant_scope.sql',
      ]);
  });
});

describe('ENG-004-CLOSE §B2 — the residual unscoped sites are exactly the classified four', () => {
  /**
   * Every OTHER engagement_messages access that touches an identity column now
   * carries a tenant predicate. These four do not, and each has a reason that is
   * asserted here rather than left in a report:
   *
   *   engagementNormalization    SAFE TRANSITIVELY — (thread_id,
   *                                          platform_message_id); thread-scoped,
   *                                          and structurally tenant-safe via the
   *                                          composite FK
   *   backfill_lead_signals      PLATFORM-GLOBAL — operator script, cross-tenant by
   *                                          design
   *
   * If a FIFTH appears, this test fails — which is the point.
   */
  // ENG-004-G19: autoReplyService was REMOVED, so the residual set is two.
  const EXPECTED_UNSCOPED = [
    'backend/services/engagementNormalizationService.ts',
    'scripts/operator/db/backfill_lead_signals.ts',
  ];

  const IDENTITY_COLS = ['id', 'parent_message_id', 'platform_message_id', 'message_id'];

  function unscopedIdentitySites(): string[] {
    const files = [
      'backend/services/engagementNormalizationService.ts',
      'scripts/operator/db/backfill_lead_signals.ts',
      'backend/services/engagementAiAssistantService.ts',
      'backend/services/bulkEngagementService.ts',
      'backend/services/engagementConversationIntelligenceService.ts',
      'backend/services/insightIntelligenceService.ts',
      'backend/services/leadDetectionService.ts',
      'backend/services/responseOrchestrator.ts',
      'backend/workers/responseStrategyLearningWorker.ts',
      'backend/workers/replyIntelligenceAggregationWorker.ts',
      'pages/api/engagement/generate-response.ts',
      'pages/api/engagement/inbox.ts',
      'pages/api/engagement/like.ts',
      'pages/api/engagement/message/bulk-like.ts',
      'pages/api/engagement/message/mark-self.ts',
      'pages/api/engagement/backfill-self-signals.ts',
      'pages/api/engagement/reply.ts',
      'pages/api/engagement/suggestions.ts',
      'pages/api/engagement/thread/bulk-pattern-reply.ts',
      'pages/api/response/generate.ts',
      'pages/api/extension/events/comments.ts',
    ];
    const out = new Set<string>();
    for (const f of files) {
      const src = code(f);
      const re = /(?:ownedDbTable|from)\(\s*'engagement_messages'\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const rest = src.slice(m.index + m[0].length);
        const end = rest.indexOf(';');
        const chain = rest.slice(0, end === -1 ? 400 : end);
        const touchesIdentity = IDENTITY_COLS.some((c) =>
          chain.includes(`.eq('${c}'`) || chain.includes(`.in('${c}'`));
        if (!touchesIdentity) continue;
        if (!/\.(eq|in)\('organization_id'/.test(chain)) out.add(f);
      }
    }
    return [...out].sort();
  }

  it('finds exactly the three classified files and no others', () => {
    const found = unscopedIdentitySites();
    // Non-empty by construction: if the scanner broke and found nothing, this
    // would fail rather than silently declaring victory.
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual(EXPECTED_UNSCOPED);
  });
});

describe('ENG-004-CLOSE §C2 — G-23 platform message identity is tenant-scoped', () => {
  const MIG = 'supabase/migrations/20261221000001_eng004_close_platform_message_tenant_scope.sql';

  it('creates the tenant-scoped unique index BEFORE dropping the global one', () => {
    const sql = read(MIG);
    const create = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_messages_org_platform_message_unique');
    const drop = sql.indexOf('DROP INDEX IF EXISTS public.idx_engagement_messages_platform_message_global');
    expect(create).toBeGreaterThan(0);
    expect(drop).toBeGreaterThan(create);
  });

  it('keys the new index on (organization_id, platform, platform_message_id)', () => {
    expect(read(MIG)).toMatch(
      /ON public\.engagement_messages \(organization_id, platform, platform_message_id\)/,
    );
  });

  it('refuses to run before the tenant column exists', () => {
    expect(read(MIG)).toMatch(/RAISE EXCEPTION[\s\S]*apply 20261221000000 first/);
  });

  it('leaves the THREAD-scoped unique index alone — every upsert conflicts on it', () => {
    const sql = read(MIG);
    expect(sql).not.toMatch(/DROP INDEX[^;]*idx_engagement_messages_platform_thread/);
    // And no write path was retargeted onto the new index.
    for (const f of [
      'backend/queue/jobProcessors/whatsappWebhookProcessor.ts',
      'backend/services/bulkEngagementService.ts',
      'backend/services/engagementNormalizationService.ts',
      'backend/services/engagementOutboundMirrorService.ts',
      'pages/api/engagement/reply.ts',
    ]) {
      expect(code(f)).toContain("onConflict: 'thread_id,platform_message_id'");
    }
  });
});

// ---------------------------------------------------------------------------
// §D — scope: nothing from a later gate leaked in
// ---------------------------------------------------------------------------

describe('ENG-004 §D — the gate stayed in scope', () => {
  it('no inbound email, MX, SES-inbound or reply ingestion was added', () => {
    // TypeScript only. The migration is deliberately NOT in this list: `code()`
    // strips `/* */` and `//` comments, not SQL `--` ones, so the migration's own
    // prose explaining WHY the parent FK matters (it names In-Reply-To) would
    // satisfy this guard without any inbound code existing. Writing a regex
    // stripper for SQL comments is the wrong fix — it needs a scanner to survive
    // literals. The migration's scope is pinned by the forbidden-table list and
    // the no-CREATE-TABLE assertion in the migration-content section instead.
    // autoReplyService is absent from this list because ENG-004-G19 removed it.
    const touched = [
      'backend/services/engagementAiAssistantService.ts',
      'backend/services/bulkEngagementService.ts',
      'backend/workers/replyIntelligenceAggregationWorker.ts',
      'pages/api/extension/events/comments.ts',
    ];
    expect(touched).toHaveLength(4);
    for (const f of touched) {
      const s = code(f);
      for (const forbidden of ['In-Reply-To', 'ReceiptRule', 'MX record', 'inbound_email', "platform: 'email'"]) {
        expect(s).not.toContain(forbidden);
      }
    }
  });

  it('created no channel-specific conversation model', () => {
    const dir = path.join(process.cwd(), 'supabase/migrations');
    const sql = fs.readFileSync(
      path.join(dir, '20261221000000_eng004_engagement_message_tenant.sql'), 'utf8',
    );
    for (const forbidden of ['email_threads', 'email_messages', 'email_conversations',
      'whatsapp_conversations', 'sms_conversations']) {
      expect(sql).not.toContain(forbidden);
    }
  });

  // ENG-004-G19 — RETIRED under narrow authorization. The earlier assertion here
  // was that the module still existed and was orphaned; it is now the opposite.
  // Negative assertions only prove a deletion if they would fail while the thing
  // existed, so each is paired with a positive control below.
  it('G-19: autoReplyService is GONE', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'backend/services/autoReplyService.ts'))).toBe(false);
  });

  it('G-19: no import, call or module reference to the legacy auto-reply path remains', () => {
    const roots = ['backend', 'pages', 'lib', 'scripts'];
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.next') continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const rel = path.relative(process.cwd(), full).split(path.sep).join('/');
        // This suite names the symbols in its own prose; exclude only itself.
        if (rel === 'backend/tests/unit/eng004EngagementMessageTenant.test.ts') continue;
        const src = fs.readFileSync(full, 'utf8');
        if (/autoReplyService|attemptAutoReply/.test(src)) offenders.push(rel);
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));

    expect(offenders).toEqual([]);
  });

  it('G-19 positive control: the SHARED collaborators it used are untouched and still reachable', () => {
    // If the retirement had over-reached, these would be gone. `orchestrateResponse`
    // is still called by /api/response/generate, `executeAction` by four services,
    // and `getControls` by three workers — none of which was G-19's to remove.
    expect(code('backend/services/responseOrchestrator.ts')).toContain('export async function orchestrateResponse');
    expect(code('pages/api/response/generate.ts')).toContain('orchestrateResponse');
    expect(code('backend/services/responsePolicyEngine.ts')).toContain('resolveResponsePolicy');
    expect(code('backend/services/engagementGovernanceService.ts')).toContain('getControls');
    expect(code('backend/services/communityAiActionExecutorRuntime.ts')).toContain('executeAction');
  });

  it('G-19: no replacement auto-reply service was introduced', () => {
    const svc = fs.readdirSync(path.join(process.cwd(), 'backend/services'));
    expect(svc.filter((f) => /autoreply|auto_reply|autoResponder/i.test(f))).toEqual([]);
  });
});
