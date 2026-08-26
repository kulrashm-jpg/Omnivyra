/**
 * PLANNER CONTROL HONESTY CONTRACT — P0 (Campaign Operating System audit,
 * findings 1 and 2).
 *
 * A planner control may not present a completed-action state that no
 * persisted action produced. Two defects motivated this contract:
 *
 *   1. ActivityWorkspaceDrawer's "Schedule All Platforms" rendered "Queued!"
 *      from a setTimeout with no network call, no scheduled_posts row, and no
 *      campaign status change. Strategic Mix has no scheduling seam yet
 *      (that is P1); until it does, no control may claim scheduling.
 *   2. The same drawer called the BILLED generation endpoint and held the
 *      result — plus any manual edit — in React state only, discarding it on
 *      close. Generation must reach the canonical persistence path or the
 *      duplicate control must not exist.
 *
 * Source-scan style (same pattern as strategicMixIdentity.test.ts): these are
 * structural facts about which surface owns which capability, not runtime
 * behavior — no rendering needed.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../../../');
const PLANNER_DIR = join(REPO_ROOT, 'components/planner');

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/**
 * Source with comments removed. The scan asserts facts about CODE — a
 * docblock that explains a removed control (as this file's own header does)
 * must not read as the control still existing. Block comments and whole-line
 * `//` comments only, so URLs inside string literals stay intact.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const DRAWER = 'components/planner/ActivityWorkspaceDrawer.tsx';
const THEME_CARDS = 'components/planner/StrategicThemeCards.tsx';
const CONTENT_WORKSPACE = 'components/planner/ContentWorkspace.tsx';

/** The one endpoint that generates campaign copy. */
const GENERATION_ENDPOINT = '/api/planner/generate-workspace-content';

/** Every planner component, so a new offender is caught wherever it lands. */
function plannerComponentFiles(): string[] {
  return readdirSync(PLANNER_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `components/planner/${f}`);
}

describe('no planner control fabricates a completed-action state', () => {
  /**
   * Words that assert an action REACHED THE SYSTEM. A control may say
   * "Schedule" (an intent) but not "Queued" / "Scheduled!" (a result) unless
   * something was actually persisted. Deliberately narrow: these are result
   * claims, not verbs.
   */
  const FABRICATED_RESULT_CLAIMS = [
    'Queued!',
    'Queued.',
    "'Queued'",
    '"Queued"',
    'Scheduled!',
    'Published!',
    'Saved!',
  ];

  it.each(plannerComponentFiles())('%s makes no un-backed result claim', (rel) => {
    const src = readCode(rel);
    const offenders = FABRICATED_RESULT_CLAIMS.filter((claim) => src.includes(claim));
    expect(offenders).toEqual([]);
  });

  it('the activity preview drawer has no scheduling handler at all', () => {
    const src = readCode(DRAWER);
    expect(src).not.toMatch(/handleScheduleAll/);
    expect(src).not.toMatch(/Schedule All Platforms/);
    // No scheduling endpoint may be reachable from planning surfaces in P0.
    expect(src).not.toMatch(/schedule-structured-plan/);
    expect(src).not.toMatch(/activity-workspace\/schedule/);
    expect(src).not.toMatch(/bolt\/execute/);
  });

  it('no planner component calls a scheduling or execution endpoint (P1 not implemented)', () => {
    const EXECUTION_ENDPOINTS = [
      'schedule-structured-plan',
      '/api/bolt/execute',
      '/api/activity-workspace/schedule',
    ];
    const offenders: string[] = [];
    for (const rel of plannerComponentFiles()) {
      const src = readCode(rel);
      for (const endpoint of EXECUTION_ENDPOINTS) {
        if (src.includes(endpoint)) offenders.push(`${rel} → ${endpoint}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('AI generation reaches the canonical persistence path, or does not exist', () => {
  it('the drawer no longer calls the billed generation endpoint', () => {
    const src = readCode(DRAWER);
    expect(src).not.toContain(GENERATION_ENDPOINT);
    // …and therefore needs no authenticated fetch at all.
    expect(src).not.toMatch(/fetchWithAuth/);
  });

  it('the drawer holds no editable content state that could be discarded', () => {
    const src = readCode(DRAWER);
    // The discarded-output defect was a useState variant map plus textareas.
    expect(src).not.toMatch(/setVariants/);
    expect(src).not.toMatch(/<textarea/);
  });

  it('the Content Workspace remains the canonical generation surface', () => {
    const src = readCode(CONTENT_WORKSPACE);
    expect(src).toContain(GENERATION_ENDPOINT);
    // Generated output is applied through the pure content model and committed
    // to planner state — this is what makes it durable.
    expect(src).toMatch(/applyGeneratedContent/);
    expect(src).toMatch(/commitPlan/);
  });

  it('exactly ONE planner component calls the generation endpoint', () => {
    const callers = plannerComponentFiles().filter((rel) => readCode(rel).includes(GENERATION_ENDPOINT));
    expect(callers).toEqual([CONTENT_WORKSPACE]);
  });
});

describe('the preview drawer is a read path onto persisted state', () => {
  it('renders content supplied by the caller rather than fetching or generating it', () => {
    const src = readCode(DRAWER);
    expect(src).toMatch(/existingContent/);
  });

  it('theme cards lift persisted draft content onto the group they hand over', () => {
    const src = readCode(THEME_CARDS);
    expect(src).toMatch(/existingContent/);
    expect(src).toMatch(/draft_content/);
    expect(src).toMatch(/content_planning_status/);
  });

  it('uses the existing draft/review/approved vocabulary — no new status words', () => {
    const src = readCode(DRAWER);
    const statusBlock = src.slice(src.indexOf('STATUS_STYLE'), src.indexOf('GroupPlatformContent'));
    for (const status of ['draft', 'review', 'approved']) {
      expect(statusBlock).toContain(status);
    }
    // Guard against a parallel vocabulary creeping in.
    for (const invented of ['pending_review', 'ready_to_publish', 'queued', 'finalized']) {
      expect(statusBlock).not.toContain(invented);
    }
  });

  it('offers the Content Workspace handoff instead of an in-drawer editor', () => {
    const drawer = readCode(DRAWER);
    expect(drawer).toMatch(/onOpenContentWorkspace/);
    expect(drawer).toContain('Open in Content Workspace');

    // The handoff is actually wired end-to-end: page → theme cards → drawer.
    expect(readCode(THEME_CARDS)).toMatch(/onOpenContentWorkspace=\{onOpenContentWorkspace\}/);
    expect(readCode('pages/campaign-planner.tsx')).toMatch(/onOpenContentWorkspace=\{\(week\)/);
  });
});
