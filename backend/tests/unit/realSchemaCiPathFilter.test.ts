/**
 * REALSCHEMA-PATHS-001 — regression test for the path filters of
 * .github/workflows/real-schema-ci.yml.
 *
 * The real-schema job is the only gate that replays migrations against a real
 * PostgreSQL server, and it runs ONLY when a changed file matches its `paths:`
 * filter. A filter that silently misses the prospect-list / campaign /
 * orchestration / execution-store surface means a schema-breaking change there
 * never replays. This test parses the workflow with js-yaml and evaluates
 * GitHub's filter semantics (glob patterns, `**` crosses `/`, `*` does not,
 * later `!` patterns exclude, last match wins) with picomatch, for both the
 * `pull_request` and the `push` filter.
 *
 * js-yaml and picomatch are transitive dependencies pinned in package-lock.json
 * (node_modules/js-yaml 4.1.1, node_modules/picomatch 2.3.2), so `npm ci`
 * installs them in CI.
 */
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load: (s: string) => unknown };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const picomatch = require('picomatch') as (glob: string, opts?: Record<string, unknown>) => (p: string) => boolean;

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'real-schema-ci.yml');

type Workflow = {
  on: {
    pull_request?: { paths?: string[] };
    push?: { branches?: string[]; paths?: string[] };
  };
};

const wf = yaml.load(fs.readFileSync(WORKFLOW, 'utf8')) as Workflow;

/** GitHub `paths:` semantics: ordered patterns, `!` excludes, last match wins. */
function triggers(patterns: string[], changedFiles: string[]): boolean {
  const compiled = patterns.map((p) => {
    const negated = p.startsWith('!');
    return { negated, match: picomatch(negated ? p.slice(1) : p, { dot: true }) };
  });
  return changedFiles.some((file) => {
    let included = false;
    for (const c of compiled) if (c.match(file)) included = !c.negated;
    return included;
  });
}

/** The surface this filter must cover, with a representative file per path. */
const STACK_SURFACE: Array<[pattern: string, representative: string]> = [
  ['backend/services/prospectLists/**', 'backend/services/prospectLists/store.ts'],
  ['backend/services/prospectCampaigns/**', 'backend/services/prospectCampaigns/campaignTargetStore.ts'],
  ['backend/services/orchestration/**', 'backend/services/orchestration/communityJourneyLinkStore.ts'],
  ['backend/services/executionInstances/**', 'backend/services/executionInstances/executionInstanceStore.ts'],
  ['backend/services/executionPlans/**', 'backend/services/executionPlans/executionPlanStore.ts'],
  ['backend/services/executionSubject/**', 'backend/services/executionSubject/subjectRef.ts'],
  ['backend/services/workflows/**', 'backend/services/workflows/workflowStore.ts'],
  ['backend/services/workflowExecution/**', 'backend/services/workflowExecution/stepProgressionStore.ts'],
  ['backend/services/outreachBridge/**', 'backend/services/outreachBridge/outreachBridgeStore.ts'],
  ['backend/services/identityVerification/**', 'backend/services/identityVerification/attestationStore.ts'],
  ['pages/api/prospect-lists/**', 'pages/api/prospect-lists/members.ts'],
  ['pages/api/prospect-campaigns/**', 'pages/api/prospect-campaigns/[id]/enroll.ts'],
  ['pages/api/execution-instances/**', 'pages/api/execution-instances/[id]/community-link.ts'],
  ['supabase/migrations/**', 'supabase/migrations/20270111100010_community_journey_link.sql'],
  ['backend/tests/realschema/**', 'backend/tests/realschema/orch_campaign_targets.test.ts'],
];

/** Files that must NOT start the real-schema job. */
const UNRELATED = [
  'components/ui/Button.tsx',
  'pages/index.tsx',
  'pages/api/prospect-listsX.ts',
  'backend/services/prospectListsLegacy.ts',
  'docs/orchestration/README.md',
  'backend/tests/unit/orchestrationEngineContract.test.ts',
];

describe('real-schema-ci.yml path filters', () => {
  const filters: Array<[string, string[]]> = [
    ['pull_request', wf.on.pull_request?.paths ?? []],
    ['push', wf.on.push?.paths ?? []],
  ];

  it('both filters exist, push stays on main, and patterns are unique', () => {
    expect(wf.on.push?.branches).toEqual(['main']);
    for (const [, paths] of filters) {
      expect(paths.length).toBeGreaterThan(0);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it('keeps every pre-existing pull_request path', () => {
    const pr = wf.on.pull_request?.paths ?? [];
    for (const p of [
      'supabase/migrations/**', 'supabase/_schema/**', 'scripts/ci/**', 'backend/tests/realschema/**',
      'backend/db/**', 'backend/services/prospectIdentity/**', 'backend/services/prospectLifecycle/**',
      'backend/services/prospectOutcomes/**', 'backend/services/prospectIcp/**', 'backend/services/enrichment/**',
      'backend/services/leadOutreachExecution/**', 'pages/api/prospects/**', 'pages/api/outreach/**',
      'backend/services/identityResolutionService.ts', 'backend/queue/jobProcessors/whatsappWebhookProcessor.ts',
      'jest.realschema.config.js', '.github/workflows/real-schema-ci.yml',
    ]) expect(pr).toContain(p);
  });

  it('every stack path is listed in both filters and points at a directory that exists', () => {
    for (const [pattern, representative] of STACK_SURFACE) {
      expect(fs.existsSync(path.join(ROOT, pattern.replace(/\/\*\*$/, '')))).toBe(true);
      expect(fs.existsSync(path.join(ROOT, representative))).toBe(true);
      for (const [, paths] of filters) expect(paths).toContain(pattern);
    }
  });

  it.each(['pull_request', 'push'])('%s: a lists/campaign/orchestration/migration change triggers', (event) => {
    const paths = filters.find(([e]) => e === event)![1];
    for (const [, representative] of STACK_SURFACE) {
      expect(triggers(paths, [representative])).toBe(true);
    }
    // Rollbacks live under supabase/migrations/rollbacks/ and are covered by `**`.
    expect(triggers(paths, ['supabase/migrations/rollbacks/community_journey_link_rollback.sql'])).toBe(true);
    // A mixed change set triggers if any one file matches.
    expect(triggers(paths, ['components/ui/Button.tsx', 'backend/services/prospectLists/audience.ts'])).toBe(true);
  });

  it.each(['pull_request', 'push'])('%s: an unrelated change does not trigger', (event) => {
    const paths = filters.find(([e]) => e === event)![1];
    for (const file of UNRELATED) expect(triggers(paths, [file])).toBe(false);
    expect(triggers(paths, UNRELATED)).toBe(false);
  });

  it('the matcher follows GitHub semantics: `*` stops at `/`, `**` crosses it, `!` excludes', () => {
    expect(triggers(['a/*'], ['a/b/c.ts'])).toBe(false);
    expect(triggers(['a/**'], ['a/b/c.ts'])).toBe(true);
    expect(triggers(['a/**', '!a/b/**'], ['a/b/c.ts'])).toBe(false);
    expect(triggers(['a/**', '!a/b/**', 'a/b/c.ts'], ['a/b/c.ts'])).toBe(true);
  });
});
