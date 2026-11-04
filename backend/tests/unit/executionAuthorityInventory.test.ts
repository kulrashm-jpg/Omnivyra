/**
 * EXECUTION-AUTHORITY INVENTORY (Outreach foundation, Agent C).
 *
 * An executable inventory of every entry point in the repository — route, cron
 * route, worker, job, queue processor, scheduler, operator script — that can
 * cause an external COMMUNITY, BROWSER, SOCIAL, WHATSAPP or outreach EMAIL
 * action, and a static proof, read from source, that each one reaches the action
 * only through the canonical gate of its channel:
 *
 *   community  communityAiActionExecutorRuntime.executeAction — D-01 persisted
 *              human approval, L-3 recipient/opt-out recheck, the atomic
 *              single-execution claim. The raw senders (API connectors, RPA,
 *              browser dispatch preparation) have no other consumer.
 *   browser    the extension's command egress, pages/api/extension/commands.ts —
 *              the approval-requiring claim RPC (P-A) and the L-3 recheck.
 *   social     a path that evaluates lib/campaign/publishAuthorization
 *              .authorizePostPublish before backend/adapters/platformAdapter
 *              .publishToPlatform, the only importer of the platform adapters.
 *   whatsapp   whatsappBroadcastService.processBatch — contact governance read
 *              fail-closed, per-recipient mayContact, compare-and-set claim, all
 *              before the Meta send. Enqueuers are gated by that consumer.
 *   email_ws3  leadOutreachExecution/dispatch — evaluateTaskGovernance before the
 *              only transport.send.
 *
 * Account/transactional email (invitations, credit alerts, reminders) is NOT
 * outreach and has no contact gate; whether it needs one is an open owner/legal
 * question. Its invokers are pinned by w2c5bEmailGovernanceBoundary.test.ts and
 * are deliberately not re-inventoried here (a credit-warning email is reachable
 * from every LLM-billed route, ~50 entries that carry no outreach decision).
 *
 * HOW IT WORKS (the shape of scripts/route-auth-allowlist.json + check-route-auth.js):
 * the entry set is COMPUTED (backend/tests/helpers/executionAuthorityGraph.ts —
 * declaration-level reachability from each channel's sinks) and compared with the
 * REGISTER below, exactly:
 *   - an entry that reaches a sink and is not registered            -> FAIL
 *   - a registered entry that no longer reaches that channel        -> FAIL (stale)
 *   - a registered status that differs from the computed one        -> FAIL
 *     (a gap that gets fixed must move to compliant, and vice versa)
 *   - every `gap` has a KNOWN_GAPS row with an owner, and only gaps do
 *   - a reached symbol with no consumer outside a recognised entry  -> FAIL unless
 *     in DORMANT (dead code, or an entry kind the engine does not recognise)
 * Gate EVIDENCE is re-read from each gate's source on every run, so a gate that is
 * weakened stops counting as one.
 *
 * WHAT IT DOES NOT PROVE: runtime behaviour (each gate's own suite does that), or
 * that no external call exists outside the curated sinks. The "direct platform
 * write" scan is a heuristic net for the obvious bypass shape — a mutating fetch to
 * a platform write endpoint — and every file it catches must be classified.
 */
import { SourceGraph, type Seed, type GateSymbol } from '../helpers/executionAuthorityGraph';

type Channel = 'community' | 'browser' | 'social' | 'whatsapp' | 'email_ws3';
type Status = 'compliant' | 'gap';

// ─── Entry classification ───────────────────────────────────────────────────
const isEntry = (f: string, code: string): boolean =>
  (/^pages\/api\//.test(f) && /export\s+default\b|export\s*\{[^}]*\bdefault\b/.test(code))
  || /^backend\/(workers|jobs|schedulers|queue\/jobProcessors|queue\/workers)\//.test(f)
  || f === 'backend/scheduler/cron.ts'
  || f === 'backend/queue/startWorkers.ts'
  || f === 'backend/queue/workerTopology.ts'
  || /^scripts\//.test(f)
  || /^backend\/scripts\//.test(f);

const RUNTIME = 'backend/services/communityAiActionExecutorRuntime.ts';
const CONTRACTS = 'backend/services/communityAiActionExecutorContracts.ts';
const RPA = 'backend/services/rpaWorker/rpaWorkerService.ts';
const PLATFORM_ADAPTER = 'backend/adapters/platformAdapter.ts';
const WA = 'backend/services/whatsappBroadcastService.ts';
const WA_PROCESSOR = 'backend/queue/jobProcessors/whatsappBroadcastProcessor.ts';
const DISPATCH = 'backend/services/leadOutreachExecution/dispatch.ts';
const EMAIL_TRANSPORT = 'backend/services/leadOutreachExecution/emailTransport.ts';
const EXT_COMMANDS = 'pages/api/extension/commands.ts';
const AUTOMATION = 'backend/services/automation/automationService.ts';

// ─── Channel definitions: sinks, gates, gate evidence ───────────────────────
type ChannelDef = {
  seeds: Seed[];
  gates?: GateSymbol[];
  /** A path is gated once it crosses a file whose code matches this (a caller-evaluated predicate). */
  gateFileRe?: RegExp;
  /** [file, regexes that must ALL match its comment-stripped code] */
  evidence: Array<[string, RegExp[]]>;
};

const CHANNELS: Record<Channel, ChannelDef> = {
  community: {
    seeds: [
      { file: CONTRACTS, name: 'runApiExecution' },
      { file: CONTRACTS, name: 'runRpaExecution' },
      { file: CONTRACTS, name: 'prepareBrowserDispatch' },
      { file: RPA, name: 'executeRpaTask' },
    ],
    gates: [{ file: RUNTIME, name: 'executeAction' }],
    evidence: [[RUNTIME, [
      /if\s*\(\s*!action\.approved_at\s*\)/,                // D-01
      /ad_hoc_action_has_no_human_approval/,                  // D-01 for synthesized action ids
      /recheckCommunityRecipient\(/,                          // L-3
      /claimCommunityActionForExecution\(/,                   // single-execution claim
      /\.not\(\s*'approved_at'\s*,\s*'is'\s*,\s*null\s*\)/,   // the claim takes only approved rows
    ]]],
  },
  browser: {
    seeds: [
      { file: EXT_COMMANDS, name: 'default', gated: true },
      // Re-arms a DM command chain to 'pending' for the extension to claim. The claim
      // RPC still requires approval, so it is gated there; it has no caller (DORMANT).
      { file: RUNTIME, name: 'advanceCommandChain', gated: true },
    ],
    evidence: [[EXT_COMMANDS, [
      /rpc\(\s*'claim_community_ai_browser_command'/,          // P-A: approval-requiring claim
      /recheckCommunityRecipient\(/,                           // L-3
    ]]],
  },
  social: {
    seeds: [{ file: PLATFORM_ADAPTER, name: 'publishToPlatform' }],
    gateFileRe: /\bauthorizePostPublish\s*\(/,
    evidence: [['lib/campaign/publishAuthorization.ts', [/export\s+function\s+authorizePostPublish\b/]]],
  },
  whatsapp: {
    seeds: [
      { file: WA, name: 'processBatch', gated: true },
      { file: WA, name: 'enqueueBroadcast', gated: true },
      { file: WA, name: 'retryFailed', gated: true },
    ],
    evidence: [
      [WA, [
        /loadTenantGovernanceRecords\(/,
        /mayContact\(/,
        /\.update\(\{\s*status:\s*'sending'\s*\}\)\s*\.eq\('id',\s*recipient\.id\)\s*\.eq\('status',\s*'pending'\)/,
      ]],
      // The queue consumer of every enqueued batch is processBatch.
      [WA_PROCESSOR, [/await\s+processBatch\(/]],
    ],
  },
  email_ws3: {
    seeds: [
      { file: DISPATCH, name: 'dispatchInternalOutreachTask', gated: true },
      { file: DISPATCH, name: 'dispatchInternalBatch', gated: true },
    ],
    evidence: [[DISPATCH, [/evaluateTaskGovernance\(/, /\btransport\.send\(/]]],
  },
};

// ─── THE REGISTER ───────────────────────────────────────────────────────────
// Every entry point that can reach an external action. `compliant`: EVERY computed
// path passes the channel gate. `gap`: at least one does not (see KNOWN_GAPS).
const REGISTER: Record<string, Partial<Record<Channel, Status>>> = {
  // ── HTTP routes ──
  'pages/api/community-ai/actions/execute.ts': { community: 'compliant' },        // manual execute of an approved action
  'pages/api/community-ai/dashboard.ts': { community: 'compliant' },             // evaluateEngagement -> auto rules -> executor (D-01 refuses)
  'pages/api/community-ai/platform/[platform].ts': { community: 'compliant' },   // same auto-rule path
  'pages/api/community-ai/post/[platform]/[postId].ts': { community: 'compliant' }, // same auto-rule path
  'pages/api/engagement/like.ts': { community: 'compliant' },
  'pages/api/engagement/message/bulk-like.ts': { community: 'compliant' },
  'pages/api/engagement/reply.ts': { community: 'compliant' },                   // inbox reply; approval binding is D-02 (Orchestration)
  'pages/api/engagement/thread/bulk-ai-reply.ts': { community: 'compliant' },
  'pages/api/engagement/thread/bulk-pattern-reply.ts': { community: 'compliant' },
  'pages/api/engagement/linkedin/sync.ts': { community: 'compliant' },           // ingestion -> auto rules -> executor
  'pages/api/execution-instances/[id]/community-link.ts': { community: 'compliant' },
  'pages/api/response/generate.ts': {},                                          // generation never executes: reaches NO sink (asserted below)
  'pages/api/social/comments.ts': { community: 'gap' },                          // fetch: auto-rule path (gated); reply: DIRECT platform POST
  'pages/api/extension/commands.ts': { browser: 'compliant' },
  'pages/api/social/publish.ts': { social: 'compliant' },
  'pages/api/super-admin/threads/[threadId]/resume.ts': { social: 'gap' },
  'pages/api/whatsapp/broadcasts/index.ts': { whatsapp: 'compliant' },
  'pages/api/whatsapp/broadcasts/[id].ts': { whatsapp: 'compliant' },
  'pages/api/super-admin/outreach/activate.ts': { email_ws3: 'compliant' },
  // ── cron routes ──
  'pages/api/cron/process-scheduled-posts.ts': { social: 'compliant' },
  'pages/api/cron/workflow-execution-progression.ts': { community: 'compliant', whatsapp: 'compliant', email_ws3: 'compliant' },
  'pages/api/cron/outreach-dispatch-recovery.ts': { email_ws3: 'compliant' },
  // ── schedulers, workers, queue processors ──
  'backend/scheduler/cron.ts': { community: 'compliant' },                       // RPA retry flush -> executor with claim
  'backend/queue/startWorkers.ts': { community: 'compliant', social: 'compliant', whatsapp: 'compliant' },
  'backend/queue/workerTopology.ts': { whatsapp: 'compliant' },
  'backend/workers/main.ts': { community: 'compliant', social: 'compliant', whatsapp: 'compliant' },
  'backend/queue/jobProcessors/engagementPollingProcessor.ts': { community: 'compliant' },
  'backend/queue/workers/engagementPollingWorker.ts': { community: 'compliant' },
  'backend/queue/jobProcessors/publishProcessor.ts': { social: 'compliant' },
  'backend/queue/workers/publishWorker.ts': { social: 'compliant' },
  'backend/queue/jobProcessors/whatsappBroadcastProcessor.ts': { whatsapp: 'compliant' },
  // ── operator scripts ──
  'scripts/communityAiScheduler.ts': { community: 'compliant' },
  'scripts/cert/publish-worker-cert.ts': { social: 'compliant' },
  'scripts/ws3-m6-capacity-validation.ts': { email_ws3: 'compliant' },
  'scripts/ws3-m8/infrastructure.ts': { email_ws3: 'compliant' },
  'scripts/ws3-m8/observability.ts': { email_ws3: 'compliant' },
  'scripts/ws3-m8/pipeline.ts': { email_ws3: 'compliant' },
  'scripts/ws3-m8/resilience.ts': { email_ws3: 'compliant' },
};

// ─── KNOWN GAPS — non-compliant TODAY. Listed, owned, never silently allowed. ─
const KNOWN_GAPS: Array<{ entry: string; channel: Channel; owner: string; why: string }> = [
  {
    entry: 'pages/api/super-admin/threads/[threadId]/resume.ts',
    channel: 'social',
    owner: 'Social publishing engine',
    why: 'threadPublishOrchestrator.resumeThreadPublish re-invokes publishThread -> publishToPlatform '
      + 'without re-evaluating authorizePostPublish: a thread whose campaign was paused or cancelled after '
      + 'the first node published can be resumed by a super-admin. Needs the predicate (or a recorded '
      + 'operator-override ruling) before publishThread.',
  },
  {
    entry: 'pages/api/social/comments.ts',
    channel: 'community',
    owner: 'Engagement / Community track',
    why: 'action=reply POSTs directly to api.linkedin.com/v2/comments and api.twitter.com/2/tweets from '
      + 'the route, with a placeholder token (`mock_token_<accountId>`): no D-01 approval, no L-3 '
      + 'recheck, no claim. The placeholder token means the platform rejects it today; the shape is still '
      + 'a bypass. Recommended: remove the reply action (replies go through /api/engagement/reply).',
  },
];

// ─── DORMANT — reached symbols with NO consumer. If one gains a caller, the
// inventory must be re-reviewed (that is the point of listing them). ─────────
const DORMANT: Record<string, string> = {
  'backend/services/communityAiActionExecutor.ts#runApiExecution': 'raw sender re-exported by the barrel; no consumer',
  'backend/services/communityAiActionExecutor.ts#runRpaExecution': 'raw sender re-exported by the barrel; no consumer',
  'backend/services/communityAiActionExecutor.ts#prepareBrowserDispatch': 'raw sender re-exported by the barrel; no consumer',
  'backend/services/automation/automationService.ts#runAutoExecution':
    'Mode 3 (autonomous response) executor hand-off: NO caller. Even if wired, the executor refuses an ad-hoc action (D-01).',
  'backend/services/orchestration/communityJourneyLinkStore.ts#getLinkForTask':
    'over-approximation: references defaultCommunityDeps (which bundles executeAction) for reads; no caller',
  'backend/services/communityAiActionExecutor.ts#advanceCommandChain':
    'Orchestration follow-up: Runtime.advanceCommandChain (re-exported here) has no caller; it re-arms a chain to pending with no organization filter on the UPDATE',
  'backend/services/leadOutreachExecution/index.ts#dispatchInternalBatch': 'barrel re-export; no consumer',
};

// ─── Recorded follow-ups that the static graph cannot see (documentation). ───
// Owned elsewhere; listed so the inventory is the one place they are enumerated.
export const RECORDED_FOLLOW_UPS = [
  'Orchestration: opt-out-to-claim window — an opt-out recorded after the L-3 recheck and before the claim is not re-read.',
  'Orchestration: claim-loss metric — a lost single-execution claim is not counted.',
  'Orchestration: advanceCommandChain (DORMANT above).',
  'Orchestration (D-02): inbox reply approval binding + passkey for /api/engagement/reply. Today the route builds an '
    + 'ad-hoc action and calls executeAction, which D-01 refuses unless a persisted approval exists.',
  'Owner/legal: contact governance for account/transactional email (w2c5bEmailGovernanceBoundary.test.ts).',
  'Community: communityAiAutoRuleService.evaluateAutoRules calls executeAction directly, not through '
    + 'automationService. D-01 refuses it (an auto rule never approves); it is a second autonomous path to retire '
    + 'or route through the automation gate.',
];

// ─── Direct platform-write scan (heuristic net for the bypass shape) ────────
const PLATFORM_WRITE_URL = new RegExp([
  String.raw`api\.linkedin\.com/(v2|rest)/(comments|ugcPosts|shares|socialActions|messages|posts|reactions)`,
  String.raw`(api\.twitter\.com|api\.x\.com)/[12](\.1)?/(tweets|dm_conversations|statuses|direct_messages)`,
  String.raw`graph\.facebook\.com[^'"\x60]*/(comments|feed|messages|media_publish|likes|photos|videos)`,
  String.raw`oauth\.reddit\.com/api/(comment|submit|vote)`,
  String.raw`/messages\x60`,
  String.raw`youtube/v3/(commentThreads|comments|videos)`,
  String.raw`open\.tiktokapis\.com/v2/post/`,
  String.raw`api\.pinterest\.com/v5/pins`,
  String.raw`hooks\.slack\.com|chat\.postMessage|discord\.com/api/[^'"\x60]*/messages`,
].join('|'));
// Only the fetch-style literal: adapters that use axios/SDK verbs are covered instead by
// the importer assertions on backend/adapters and platformConnectors.
const MUTATING_METHOD = /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/;
type WriteClass = 'social_sink_internal' | 'community_sink_internal' | 'whatsapp_gate' | 'dormant_module' | 'read_via_post' | 'gap';
const DIRECT_WRITE_CLASSIFIED: Record<string, { cls: WriteClass; note: string }> = {
  'backend/adapters/linkedinAdapter.ts': { cls: 'social_sink_internal', note: 'imported only by platformAdapter.ts' },
  'backend/services/platformConnectors/youtubeConnector.ts': { cls: 'community_sink_internal', note: 'loaded only by the executor contracts' },
  'backend/services/whatsappBroadcastService.ts': { cls: 'whatsapp_gate', note: 'processBatch: governance + claim before fetch' },
  'backend/services/platformAdapters/whatsappAdapter.ts': { cls: 'dormant_module', note: 'publishContent/replyToComment/likeComment have no caller' },
  'backend/services/socialPlatformPublisher.ts': { cls: 'dormant_module', note: 'deprecated; no importer' },
  'backend/services/platformAnalyticsIngester.ts': { cls: 'read_via_post', note: 'URL match is a read (YouTube videos GET); its only mutating method is the TikTok video/list POST, a read' },
  'pages/api/social/comments.ts': { cls: 'gap', note: 'see KNOWN_GAPS' },
};

// ─── Compute ────────────────────────────────────────────────────────────────
const graph = new SourceGraph(isEntry);
const computed = new Map<string, Map<Channel, Status>>();
const pathsFor = new Map<string, string[]>();
const deadEnds = new Map<string, Channel>();
const directWriteFiles = graph.files.filter((f) => {
  const c = graph.code(f);
  return PLATFORM_WRITE_URL.test(c) && MUTATING_METHOD.test(c);
}).sort();

for (const [ch, def] of Object.entries(CHANNELS) as Array<[Channel, ChannelDef]>) {
  const { hits, deadEnds: dead } = graph.propagate(def.seeds, def.gates, def.gateFileRe);
  for (const [f, h] of hits) {
    if (!computed.has(f)) computed.set(f, new Map());
    computed.get(f)!.set(ch, h.gated.has(false) ? 'gap' : 'compliant');
    pathsFor.set(`${f}|${ch}`, h.paths);
  }
  for (const d of dead) deadEnds.set(d, ch);
}
// A direct-write GAP that is itself an entry is an ungated community entry.
for (const [f, c] of Object.entries(DIRECT_WRITE_CLASSIFIED)) {
  if (c.cls !== 'gap' || !graph.entry(f)) continue;
  if (!computed.has(f)) computed.set(f, new Map());
  computed.get(f)!.set('community', 'gap');
}

if (process.env.EXEC_AUTH_DUMP) {
  const out: Record<string, unknown> = {};
  for (const [f, m] of [...computed].sort()) out[f] = Object.fromEntries(m);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ entries: out, deadEnds: Object.fromEntries(deadEnds), directWriteFiles, paths: Object.fromEntries(pathsFor) }, null, 1));
}

const fmt = (m: Map<Channel, Status> | Partial<Record<Channel, Status>> | undefined) =>
  JSON.stringify(m instanceof Map ? Object.fromEntries([...m].sort()) : Object.fromEntries(Object.entries(m ?? {}).sort()));

// ─── Tests ──────────────────────────────────────────────────────────────────
describe('execution-authority inventory — the engine sees what it must (non-vacuity)', () => {
  it('scans the production trees and recognises entries of every kind', () => {
    expect(graph.files.length).toBeGreaterThan(1000);
    const kinds = [...computed.keys()].map((f) =>
      f.startsWith('pages/api/cron/') ? 'cron' : f.startsWith('pages/api/') ? 'route' : f.startsWith('scripts/') ? 'script' : 'worker');
    for (const k of ['route', 'cron', 'worker', 'script']) expect(kinds).toContain(k);
  });

  it.each(Object.keys(CHANNELS) as Channel[])('channel %s reaches at least one entry', (ch) => {
    expect([...computed.values()].some((m) => m.has(ch))).toBe(true);
  });

  it('positive controls: known send paths are found through the expected hops', () => {
    const p = (f: string, ch: Channel) => (pathsFor.get(`${f}|${ch}`) ?? []).join('\n');
    expect(p('pages/api/engagement/reply.ts', 'community')).toContain(`${RUNTIME}#executeAction`);
    expect(p('backend/scheduler/cron.ts', 'community')).toContain(`${RPA}#rpaSchedulerHooks`);       // dynamic import hop
    expect(p('pages/api/whatsapp/broadcasts/index.ts', 'whatsapp')).toContain(`${WA}#enqueueBroadcast`);
    expect(p('pages/api/social/publish.ts', 'social')).toContain('backend/services/publishNowService.ts#publishNow');
    expect(p('pages/api/cron/outreach-dispatch-recovery.ts', 'email_ws3')).toContain(DISPATCH);
  });

  it('negative control: an ungated path IS reported as a gap (the gate check can fail)', () => {
    const { hits } = graph.propagate([{ file: PLATFORM_ADAPTER, name: 'publishToPlatform' }]); // no gate given
    expect(hits.get('pages/api/social/publish.ts')?.gated.has(false)).toBe(true);
  });
});

describe('execution-authority inventory — gate evidence (re-read every run)', () => {
  for (const [ch, def] of Object.entries(CHANNELS) as Array<[Channel, ChannelDef]>) {
    for (const [file, res] of def.evidence) {
      it.each(res.map((r) => [r.source]))(`${ch}: ${file} still contains %s`, (src) => {
        expect(graph.has(file)).toBe(true);
        expect(graph.code(file)).toMatch(new RegExp(src));
      });
    }
  }

  it('email_ws3: governance is evaluated BEFORE the only transport.send', () => {
    const c = graph.code(DISPATCH);
    const gov = c.indexOf('evaluateTaskGovernance(');
    const send = c.indexOf('transport.send(');
    expect(gov).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(gov);
    expect(c.indexOf('transport.send(', send + 1)).toBe(-1);
    // backend only: scripts/jev-bjc has an unrelated `transport` (the JEV judge provider).
    const others = graph.files.filter((f) => f.startsWith('backend/') && f !== DISPATCH && /\btransport\.send\(/.test(graph.code(f)));
    expect(others).toEqual([]);
  });

  it('email_ws3: the SES transport is constructed only by the transport registry (and a stub-provider validation script)', () => {
    // The transport is registered and resolved by channel inside dispatch, so the
    // only way to reach its provider is dispatch's transport.send (asserted above).
    const constructors = graph.files.filter((f) => f !== EMAIL_TRANSPORT && /\bcreateEmailTransport\s*\(/.test(graph.code(f))).sort();
    expect(constructors).toEqual(['backend/services/leadOutreachExecution/transportRegistry.ts', 'scripts/ws3-m8/resilience.ts']);
    expect(graph.code('scripts/ws3-m8/resilience.ts')).toMatch(/createEmailTransport\(\s*stubProvider\b/);
  });

  it('browser: L-3 recheck precedes the approval-requiring claim, and only this route claims', () => {
    const c = graph.code(EXT_COMMANDS);
    expect(c.indexOf('recheckCommunityRecipient(')).toBeGreaterThan(-1);
    expect(c.indexOf("rpc('claim_community_ai_browser_command'")).toBeGreaterThan(c.indexOf('recheckCommunityRecipient('));
    const claimers = graph.files.filter((f) => /rpc\(\s*'claim_community_ai_browser_command'/.test(graph.code(f)));
    expect(claimers).toEqual([EXT_COMMANDS]);
  });

  it('community: raw senders are called only inside the executor modules', () => {
    const raw = /\b(runApiExecution|runRpaExecution|prepareBrowserDispatch|executeRpaTask|loadConnector)\s*\(/;
    const callers = graph.files.filter((f) => raw.test(graph.code(f))).sort();
    expect(callers).toEqual([CONTRACTS, RUNTIME].sort());
  });

  it('community: platform connectors are loaded only by the executor contracts', () => {
    const connectors = graph.files.filter((f) => /^backend\/services\/platformConnectors\/(?!baseConnector)\w+\.ts$/.test(f));
    expect(connectors.length).toBeGreaterThan(0);
    for (const c of connectors) {
      const importers = graph.valueImportersOf(c).filter((f) => !f.startsWith('backend/services/platformConnectors/'));
      expect({ c, importers }).toEqual({ c, importers: [CONTRACTS] });
    }
  });

  it('social: the platform publish adapters are imported only by platformAdapter.ts (and the X media helper)', () => {
    const adapters = graph.files.filter((f) => /^backend\/adapters\/\w+Adapter\.ts$/.test(f) && f !== PLATFORM_ADAPTER && !/platformAdapterTypes/.test(f));
    expect(adapters.length).toBeGreaterThan(5);
    for (const a of adapters) {
      const importers = graph.valueImportersOf(a).filter((f) => f !== PLATFORM_ADAPTER && f !== 'backend/adapters/xMedia.ts');
      expect({ a, importers }).toEqual({ a, importers: [] });
    }
  });

  it('whatsapp: the platformAdapters write methods have no production caller', () => {
    const callers = graph.files.filter((f) => /\.(publishContent|replyToComment|likeComment)\s*\(/.test(graph.code(f)));
    expect(callers).toEqual([]);
  });
});

describe('execution-authority inventory — the register', () => {
  it('every computed entry is registered with exactly its computed channels and statuses', () => {
    const problems: string[] = [];
    for (const [f, m] of computed) {
      if (!(f in REGISTER)) problems.push(`UNREGISTERED ${f} ${fmt(m)}\n    ${(pathsFor.get(`${f}|${[...m.keys()][0]}`) ?? []).join('\n    ')}`);
      else if (fmt(m) !== fmt(REGISTER[f])) problems.push(`MISMATCH ${f} computed=${fmt(m)} registered=${fmt(REGISTER[f])}`);
    }
    for (const [f, r] of Object.entries(REGISTER)) {
      if (!computed.has(f) && Object.keys(r).length > 0) problems.push(`STALE ${f} registered=${fmt(r)} but reaches no sink`);
    }
    expect(problems).toEqual([]);
  });

  it('the response-generation route reaches NO sink (generation never executes)', () => {
    expect(computed.has('pages/api/response/generate.ts')).toBe(false);
    expect(REGISTER['pages/api/response/generate.ts']).toEqual({});
  });

  it('every gap has exactly one KNOWN_GAPS row with an owner, and only gaps do', () => {
    const gaps = Object.entries(REGISTER).flatMap(([f, r]) =>
      (Object.entries(r) as Array<[Channel, Status]>).filter(([, s]) => s === 'gap').map(([ch]) => `${f}|${ch}`)).sort();
    expect(gaps.length).toBeGreaterThan(0);
    expect(KNOWN_GAPS.map((g) => `${g.entry}|${g.channel}`).sort()).toEqual(gaps);
    for (const g of KNOWN_GAPS) { expect(g.owner.trim()).not.toBe(''); expect(g.why.length).toBeGreaterThan(40); }
  });

  it('every reached symbol with no consumer is a recorded DORMANT symbol, and every DORMANT one is still dead', () => {
    expect([...deadEnds.keys()].sort()).toEqual(Object.keys(DORMANT).sort());
  });

  it('every file performing a direct platform write is classified, and the classification still holds', () => {
    expect(directWriteFiles).toEqual(Object.keys(DIRECT_WRITE_CLASSIFIED).sort());
    for (const [f, c] of Object.entries(DIRECT_WRITE_CLASSIFIED)) {
      if (c.cls === 'dormant_module' && f !== 'backend/services/platformAdapters/whatsappAdapter.ts') {
        expect({ f, importers: graph.valueImportersOf(f) }).toEqual({ f, importers: [] });
      }
      if (c.cls === 'gap') expect(KNOWN_GAPS.some((g) => g.entry === f)).toBe(true);
    }
  });
});

describe('auto reply — one switch (automation_config via automationService)', () => {
  it('runAutoExecution evaluates shouldAutoExecute before handing the action to the executor', () => {
    const seg = graph.segments(AUTOMATION).find((s) => s.name === 'runAutoExecution');
    expect(seg).toBeDefined();
    const t = seg!.text;
    expect(t.indexOf('shouldAutoExecute(')).toBeGreaterThan(-1);
    expect(t.indexOf('if (!decision.allowed)')).toBeGreaterThan(t.indexOf('shouldAutoExecute('));
    expect(t.indexOf('executeAction(')).toBeGreaterThan(t.indexOf('if (!decision.allowed)'));
  });

  it('no gate reads engagement_system_controls.auto_reply_enabled, and response_rules.auto_reply authorizes no send', () => {
    // Readers of the engagement-controls value are the controls API/page only.
    const readers = graph.files.filter((f) => /\.auto_reply_enabled\b/.test(graph.code(f))
      && !/automation/.test(f) && f !== 'backend/services/engagementGovernanceService.ts').sort();
    expect(readers).toEqual(['pages/api/system/engagement-controls.ts', 'pages/system/engagement-controls.tsx']);
    // The response generator reports the rule and imports no executor.
    expect(graph.valueImportersOf(RUNTIME)).not.toContain('backend/services/responseOrchestrator.ts');
    expect(graph.valueImportersOf('backend/services/communityAiActionExecutor.ts')).not.toContain('backend/services/responseOrchestrator.ts');
  });
});
