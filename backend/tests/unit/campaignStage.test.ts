/**
 * Strategic Mix R2-P4 — Canonical Campaign Status Read Model.
 *
 * PART 1 — resolver matrix: deterministic interpretation of the existing
 * status axes (database unchanged; read layer only).
 *
 * PART 2 — WRITER GATE (source scan, fails CI): no Strategic Mix module
 * may interpret raw lifecycle fields directly or introduce new lifecycle
 * vocabulary; the resolver is the only approved read path.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  resolveCampaignStage,
  isFinalizedStage,
  isTerminalStage,
  CANONICAL_CAMPAIGN_STAGES,
} from '../../../lib/campaign/campaignStage';

describe('resolveCampaignStage — deterministic matrix over the existing axes', () => {
  it('draft campaigns (planner rows and plain drafts)', () => {
    expect(resolveCampaignStage({ status: 'draft', current_stage: 'planning', thread_id: 'planner_draft_1' }).stage).toBe('draft');
    expect(resolveCampaignStage({ status: 'draft' }).stage).toBe('draft');
  });

  it('planning / scheduling / ready from current_stage (finalize writes these)', () => {
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'planning' }).stage).toBe('planning');
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'campaign_week_plan' }).stage).toBe('scheduling');
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'blueprint_committed' }).stage).toBe('scheduling');
    // the exact row shape planner-finalize leaves behind
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'execution_ready', blueprint_status: 'ACTIVE' }).stage).toBe('ready');
  });

  it('executing / paused / completed / archived from the execution axes', () => {
    expect(resolveCampaignStage({ status: 'active', execution_status: 'ACTIVE' }).stage).toBe('executing');
    expect(resolveCampaignStage({ status: 'active', execution_status: 'PAUSED' })).toMatchObject({ stage: 'paused', paused: true });
    expect(resolveCampaignStage({ status: 'active', execution_status: 'COMPLETED' }).stage).toBe('completed');
    expect(resolveCampaignStage({ status: 'completed' }).stage).toBe('completed');
    expect(resolveCampaignStage({ status: 'archived', execution_status: 'ACTIVE' })).toMatchObject({ stage: 'archived', archived: true });
    // precedence: terminal beats executing; paused beats executing
    expect(resolveCampaignStage({ status: 'completed', execution_status: 'ACTIVE' }).stage).toBe('completed');
  });

  it('legacy campaigns: unknown free-text stages NEVER invent vocabulary', () => {
    const r = resolveCampaignStage({ status: 'active', current_stage: 'some_legacy_value' });
    expect(r.stage).toBe('planning'); // safe default, contained here
    expect(CANONICAL_CAMPAIGN_STAGES).toContain(r.stage);
    expect(resolveCampaignStage(null).stage).toBe('planning');
    expect(resolveCampaignStage({}).stage).toBe('planning');
    // null execution_status NEVER implies executing
    expect(resolveCampaignStage({ status: 'planning', execution_status: null }).stage).toBe('planning');
  });

  it('planning-space hints refine draft/planning into alignment/review only', () => {
    expect(resolveCampaignStage({ status: 'draft' }, { assignments_count: 3 }).stage).toBe('alignment');
    expect(resolveCampaignStage({ status: 'draft' }, { reviewing: true }).stage).toBe('review');
    // hints never override execution truth
    expect(resolveCampaignStage({ status: 'active', execution_status: 'ACTIVE' }, { assignments_count: 3 }).stage).toBe('executing');
    expect(resolveCampaignStage({ status: 'planning', current_stage: 'execution_ready' }, { reviewing: true }).stage).toBe('ready');
  });

  it('helpers: finalized / terminal classification', () => {
    expect(isFinalizedStage('ready')).toBe(true);
    expect(isFinalizedStage('executing')).toBe(true);
    expect(isFinalizedStage('alignment')).toBe(false);
    expect(isTerminalStage('completed')).toBe(true);
    expect(isTerminalStage('ready')).toBe(false);
  });

  it('pure + deterministic: same row, same result; sources exposed for diagnostics', () => {
    const row = { status: 'planning', current_stage: 'execution_ready', execution_status: '' };
    expect(resolveCampaignStage(row)).toEqual(resolveCampaignStage(row));
    expect(resolveCampaignStage(row).sources).toEqual({ status: 'planning', current_stage: 'execution_ready', execution_status: '' });
  });
});

/* ── PART 2 — WRITER GATE ──────────────────────────────────────────────── */

const ROOT = join(__dirname, '../../..');

/** The Strategic Mix surface set the gate governs. BOLT pipeline files are
 *  deliberately excluded — their `current_stage` is a different concept. */
const GOVERNED_DIRS = ['lib/campaign', 'components/planner'];
const GOVERNED_FILES = [
  'pages/campaign-planner.tsx',
  'pages/api/campaigns/planner-draft.ts',
  'pages/api/campaigns/planner-finalize.ts',
  'pages/api/campaigns/[id]/planner-draft-state.ts',
  'pages/api/campaigns/[id]/assignment-execution-events.ts',
];
/** The resolver itself is the ONE approved interpreter. */
const EXEMPT = ['lib/campaign/campaignStage.ts'];

function governedSources(): string[] {
  const out: string[] = [];
  for (const dir of GOVERNED_DIRS) {
    const abs = join(ROOT, dir);
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      if (statSync(p).isFile() && /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) {
        out.push(join(dir, name).replace(/\\/g, '/'));
      }
    }
  }
  return [...out, ...GOVERNED_FILES];
}

describe('WRITER GATE — the resolver is the only lifecycle interpreter in Strategic Mix', () => {
  const RAW_INTERPRETATION = /(current_stage|execution_status|blueprint_status)['"\]]?\s*(===|!==|==[^=]|!=[^=]|\.toUpperCase\(\)\s*===|\?\?\s*'')/;
  // Campaign-ONLY literals: values that never appear in the Assignment
  // lifecycle vocabulary (assignments are a separate entity with their own
  // closed set, governed by campaignAssignments.ts).
  const RAW_STATUS_COMPARISON = /\.status\s*(===|!==)\s*['"](planning|active|execution_ready|completed|paused)['"]/;

  it('no governed module interprets raw lifecycle fields outside the resolver', () => {
    const offenders: string[] = [];
    for (const rel of governedSources()) {
      if (EXEMPT.includes(rel)) continue;
      const source = readFileSync(join(ROOT, rel), 'utf8');
      for (const [i, line] of source.split('\n').entries()) {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
        if (RAW_INTERPRETATION.test(line) || RAW_STATUS_COMPARISON.test(line)) {
          offenders.push(`${rel}:${i + 1} → ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders).toEqual([]); // new offenders fail CI with exact locations
  });

  it('no governed module writes NEW lifecycle vocabulary (closed set, I-11)', () => {
    // Stage strings the pipeline legitimately writes today (physical values,
    // unchanged by this phase). Anything else appearing as a stage write in
    // Strategic Mix code is new vocabulary and requires a spec amendment.
    const ALLOWED_WRITES = new Set(['planning', 'campaign_week_plan', 'execution_ready', 'draft']);
    const STAGE_WRITE = /current_stage:\s*['"]([^'"]+)['"]/g;
    const offenders: string[] = [];
    for (const rel of governedSources()) {
      const source = readFileSync(join(ROOT, rel), 'utf8');
      for (const match of source.matchAll(STAGE_WRITE)) {
        if (!ALLOWED_WRITES.has(match[1])) offenders.push(`${rel} writes current_stage '${match[1]}'`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
