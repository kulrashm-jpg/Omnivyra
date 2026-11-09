/**
 * Zod 3 -> 4 characterization (security/zod4, GHSA-mrhx-c7xc-m3w5).
 *
 * Every case below was first executed against zod 3.25.76 and its outcome was
 * written to `backend/tests/fixtures/zodCharacterization.v3.golden.json`
 * (capture mode: ZOD_CHAR_CAPTURE=1). The suite then asserts that the current
 * zod produces the SAME outcome for every case:
 *
 *   - success / failure is identical (nothing previously accepted is rejected,
 *     nothing previously rejected is accepted);
 *   - the parsed output (defaults, transforms, trimming, coercion, stripped
 *     unknown keys, key presence) is identical;
 *   - the issue paths are identical;
 *   - messages are identical wherever they are explicit (custom messages,
 *     refinement messages) or reach a client (extension controller 400 bodies,
 *     BJC judge error messages).
 *
 * The only permitted differences are listed in DELIBERATE_V4_DELTAS, each with
 * the exact zod 4 outcome it must have instead.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/intelligenceExecutionContext', () => ({
  assertApiReadContext: jest.fn(),
}));

import { runCompletionWithOperation } from '../../services/aiGateway';
import { supabase } from '../../db/supabaseClient';
import { ActionPayloadSchema, ReportExecuteResponseSchema, InstructionCodeSchema } from '../../contracts/actionApiContract';
import { DecisionObjectInputSchema } from '../../contracts/decisionObject';
import { campaignPlanResponseSchema } from '../../services/ai/planSchemas';
import { optimizedWeekSchema } from '../../services/campaignOptimizationService';
import {
  parseAiPlanToWeeks,
  parseAiRefinedDay,
  parseAiPlatformCustomization,
} from '../../services/campaignPlanParser';
import { buildExtractionWithDefaults } from '../../services/companyProfile/extractionSchema';
import { dayContentSchema } from '../../services/content/runtime/taskProfiles/dayContentProfile';
import { DecisionObjectWriteSchema } from '../../services/decisionObjectService';
import { assertDecisionArray, assertDecisionReportView } from '../../services/decisionRuntimeGuardService';
import { listMarketPulseView } from '../../services/insightViewService';
import { envSchema } from '../../../config/env.schema';
import {
  ExtensionEventRequestSchema,
  GetCommandsQuerySchema,
  CommandResultRequestSchema,
  LinkedinCommentEventDataSchema,
  ValidateSessionRequestSchema,
} from '../../../modules/extension/validators/extensionValidators';
import { ExtensionController } from '../../../modules/extension/controllers/extensionController';
import { bjcRequestSchema } from '../../../scripts/jev-bjc/contract';
import { computeInputHash } from '../../../scripts/jev-bjc/canonical';
import { judge } from '../../../scripts/jev-bjc/judge';
import { MemoryAuditSink } from '../../../scripts/jev-bjc/audit';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ZOD_VERSION: string = require('zod/package.json').version;
const ZOD_MAJOR = Number(ZOD_VERSION.split('.')[0]);
const GOLDEN = path.join(__dirname, '..', 'fixtures', 'zodCharacterization.v3.golden.json');
const CAPTURE = process.env.ZOD_CHAR_CAPTURE === '1';

// ─── canonical outcome encoding ──────────────────────────────────────────────

function canon(v: unknown): unknown {
  if (v === undefined) return { $undef: true };
  if (typeof v === 'number' && !Number.isFinite(v)) return { $num: String(v) };
  if (Array.isArray(v)) return v.map(canon);
  if (v instanceof Date) return { $date: v.toISOString() };
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object)) out[k] = canon((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

type Issue = { path: string; message: string; custom: boolean };
type Outcome = {
  success: boolean;
  data?: unknown;
  issues?: Issue[];
  threw?: string;
  value?: unknown;
};

function sp(schema: { safeParse: (i: unknown) => any }, input: unknown): Outcome {
  try {
    const r = schema.safeParse(input);
    if (r.success) return { success: true, data: canon(r.data) };
    return {
      success: false,
      issues: r.error.issues.map((i: any) => ({
        path: i.path.join('.'),
        message: i.message,
        custom: i.code === 'custom',
      })),
    };
  } catch (e) {
    return { success: false, threw: (e as Error).message };
  }
}

async function call(fn: () => unknown): Promise<Outcome> {
  try {
    return { success: true, value: canon(await fn()) };
  } catch (e) {
    return { success: false, threw: (e as Error).message };
  }
}

// ─── fixtures ────────────────────────────────────────────────────────────────

const U_V4 = '3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5f';
const U_NONRFC = '12345678-1234-1234-1234-123456789012'; // variant nibble '1' — not RFC 4122/9562
const U_V0 = '3f1c2b9a-7d4e-0c1a-9b2f-0a1b2c3d4e5f'; // version nibble 0
const U_NIL = '00000000-0000-0000-0000-000000000000';
const U_MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const U_UPPER = '3F1C2B9A-7D4E-4C1A-9B2F-0A1B2C3D4E5F';
const UUID_VARIANTS: Record<string, unknown> = {
  v4: U_V4,
  nonrfc: U_NONRFC,
  v0: U_V0,
  nil: U_NIL,
  max: U_MAX,
  upper: U_UPPER,
  nodash: '3f1c2b9a7d4e4c1a9b2f0a1b2c3d4e5f',
  braces: `{${U_V4}}`,
  short: '3f1c2b9a-7d4e-4c1a-9b2f-0a1b2c3d4e5',
  word: 'not-a-uuid',
  padded: ` ${U_V4} `,
  number: 42,
};

const URL_VARIANTS: Record<string, unknown> = {
  http_loopback: 'http://127.0.0.1:54321',
  https_host: 'https://abc.supabase.co',
  not_url: 'not a url',
  host_port_no_scheme: 'localhost:3000',
  mailto: 'mailto:a@b.co',
  padded: ' https://padded.example.com ',
  scheme_only: 'http://',
  space_in_host: 'https://exa mple.com',
  javascript: 'javascript:alert(1)',
  file: 'file:///etc/passwd',
  ipv6: 'http://[::1]:54321',
  upper: 'HTTP://UPPER.EXAMPLE.COM/Path',
  idn: 'https://例え.jp/x',
  empty: '',
  redis: 'redis://127.0.0.1:6379',
  relative: '/just/a/path',
};

const ENV_BASE = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'placeholder-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'placeholder-publishable',
  REDIS_URL: 'redis://127.0.0.1:6399',
  OPENAI_API_KEY: 'placeholder-openai',
  ENCRYPTION_KEY: '0'.repeat(64), // valid 64-hex, zero entropy: never secret-shaped (GITLEAKS-61 review)
};

function decisionInput(over: Record<string, unknown> = {}) {
  return {
    company_id: U_V4,
    report_tier: 'snapshot',
    source_service: '  seoService ',
    entity_type: 'page',
    entity_id: U_V4,
    issue_type: ' thin_content ',
    title: ' Title ',
    description: 'desc',
    evidence: { a: 1 },
    impact_traffic: 10,
    impact_conversion: 20,
    impact_revenue: 30,
    priority_score: 40,
    effort_score: 50,
    confidence_score: 0.5,
    recommendation: ' do it ',
    action_type: 'fix',
    action_payload: { k: 'v' },
    ...over,
  };
}

function persistedRow(over: Record<string, unknown> = {}) {
  return {
    ...decisionInput(),
    status: 'open',
    id: U_V4,
    execution_score: 3,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    resolved_at: null,
    ignored_at: null,
    ...over,
  };
}

function actionPayload(over: Record<string, unknown> = {}) {
  return {
    id: 'act_1',
    instruction_code: 'CTA_FIX',
    action_category: 'content',
    impact: 50,
    impact_explanation: 'because',
    priority_score: 7,
    expected_score_gain: { seo: 1 },
    confidence: 0.8,
    confidence_label: 'High',
    confidence_per_action: 0.7,
    title: 't',
    description: 'd',
    steps: ['s1'],
    owner: 'marketing',
    effort_level: 'low',
    timeline_days: 3,
    action_type: 'x',
    payload: { a: 1 },
    status_source: 'system',
    ...over,
  };
}

function apiReport(type: string) {
  return {
    company_id: 'c1',
    report_type: type,
    generated_at: '2026-01-01T00:00:00Z',
    diagnosis: {},
    narratives: [],
  };
}

function bjcDraft(over: Record<string, unknown> = {}) {
  return {
    schema: 'bjc/1',
    request_id: 'req-1',
    work_item: 'OMNI-1',
    invoked_by: 'human:tester',
    acceptance_criterion: { id: 'AC-1', statement: 'GET /api/health returns 200', kind: 'OBJECTIVE', required_evidence: ['test_run'] },
    invariants: [{ id: 'INV-1', statement: 'No route skips auth', source: 'invariants.md@abc123' }],
    deterministic_summary: 'jest health suite',
    evidence: [
      {
        id: 'EV-1',
        kind: 'test_run',
        ref: 'backend/tests/unit/health.test.ts@3d643f5c',
        sha256: 'a'.repeat(64),
        produced_by: 'jest@29',
        result: 'PASS',
        captured_at: '2026-10-01T10:00:00Z',
        ac_ids: ['AC-1'],
      },
    ],
    model: 'jev-test-1',
    ...over,
  };
}
function bjcRequest(over: Record<string, unknown> = {}) {
  const d = bjcDraft(over);
  return { ...d, input_hash: computeInputHash(d as any) };
}
function bjcEvidence(over: Record<string, unknown>) {
  return bjcRequest({ evidence: [{ ...bjcDraft().evidence[0], ...over }] });
}

// ─── extension controller harness ────────────────────────────────────────────

function fakeRes() {
  const r: any = { statusCode: 0, body: undefined };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b: unknown) => {
    r.body = b;
    return r;
  };
  return r;
}
const controller = new ExtensionController({} as any, {} as any, {} as any);
async function ctl(method: 'handlePostEvent' | 'handleGetCommands' | 'handleCommandResult', req: any): Promise<Outcome> {
  const res = fakeRes();
  await (controller as any)[method](req, res);
  return { success: res.statusCode < 400, value: { status: res.statusCode, error: res.body?.error ?? null } };
}

// ─── case table ──────────────────────────────────────────────────────────────

type Case = { id: string; exactMessages?: boolean; run: () => Outcome | Promise<Outcome> };
const cases: Case[] = [];
const add = (id: string, run: Case['run'], exactMessages = false) => cases.push({ id, run, exactMessages });

// actionApiContract
add('action.valid', () => sp(ActionPayloadSchema, actionPayload()));
add('action.explainability-default', () => sp(ActionPayloadSchema, actionPayload({ explainability: { reasoning: ' r ' } })));
add('action.unknown-keys-stripped', () => sp(ActionPayloadSchema, actionPayload({ extra: 1, expected_score_gain: { seo: 1, zzz: 2 } })));
add('action.instruction-free-text-trimmed', () => sp(InstructionCodeSchema, '  CUSTOM_CODE  '));
add('action.instruction-known', () => sp(InstructionCodeSchema, 'CTA_FIX'));
add('action.instruction-blank', () => sp(InstructionCodeSchema, '   '));
add('action.instruction-number', () => sp(InstructionCodeSchema, 5));
add('action.impact-over', () => sp(ActionPayloadSchema, actionPayload({ impact: 100.5 })));
add('action.timeline-float', () => sp(ActionPayloadSchema, actionPayload({ timeline_days: 1.5 })));
add('action.timeline-zero', () => sp(ActionPayloadSchema, actionPayload({ timeline_days: 0 })));
add('action.steps-empty', () => sp(ActionPayloadSchema, actionPayload({ steps: [] })));
add('action.steps-blank', () => sp(ActionPayloadSchema, actionPayload({ steps: ['  '] })));
add('action.payload-array', () => sp(ActionPayloadSchema, actionPayload({ payload: [1] })));
add('action.payload-null', () => sp(ActionPayloadSchema, actionPayload({ payload: null })));
add('action.confidence-label-bad', () => sp(ActionPayloadSchema, actionPayload({ confidence_label: 'high' })));
add('action.priority-infinity', () => sp(ActionPayloadSchema, actionPayload({ priority_score: Infinity })));
add('action.priority-nan', () => sp(ActionPayloadSchema, actionPayload({ priority_score: NaN })));
add('action.target-block-blank', () => sp(ActionPayloadSchema, actionPayload({ target_block_id: '' })));
add('action.status-undefined-key', () => sp(ActionPayloadSchema, actionPayload({ status: undefined })));
add('action.not-object', () => sp(ActionPayloadSchema, 'x'));
add('report.valid', () =>
  sp(ReportExecuteResponseSchema, {
    api_version: 'v1',
    company_id: 'c1',
    snapshot_report: apiReport('snapshot'),
    performance_report: apiReport('performance'),
    growth_report: apiReport('growth'),
    strategic_report: apiReport('strategic'),
    top_priorities: [actionPayload()],
    delta: { new_insights: [], resolved_issues: [], priority_shifts: [] },
  }),
);
add('report.bad-version-and-type', () =>
  sp(ReportExecuteResponseSchema, {
    api_version: 'v2',
    company_id: 'c1',
    snapshot_report: apiReport('weekly'),
    performance_report: apiReport('performance'),
    growth_report: apiReport('growth'),
    strategic_report: apiReport('strategic'),
    top_priorities: [],
    delta: { new_insights: [], resolved_issues: [], priority_shifts: [] },
  }),
);

// decisionObject contract (tenant id = company_id uuid)
for (const [k, v] of Object.entries(UUID_VARIANTS)) {
  add(`decision.contract.company_id.${k}`, () => sp(DecisionObjectInputSchema, decisionInput({ company_id: v })));
  add(`decision.write.company_id.${k}`, () => sp(DecisionObjectWriteSchema, decisionInput({ company_id: v })));
}
add('decision.contract.valid-trim-default', () => sp(DecisionObjectInputSchema, decisionInput()));
add('decision.contract.global-with-entity', () => sp(DecisionObjectInputSchema, decisionInput({ entity_type: 'global' })), true);
add('decision.contract.global-null-entity', () => sp(DecisionObjectInputSchema, decisionInput({ entity_type: 'global', entity_id: null })));
add('decision.contract.global-absent-entity', () => {
  const { entity_id: _e, ...rest } = decisionInput({ entity_type: 'global' });
  return sp(DecisionObjectInputSchema, rest);
});
add('decision.contract.page-no-entity', () => sp(DecisionObjectInputSchema, decisionInput({ entity_id: null })), true);
add('decision.contract.empty-payload', () => sp(DecisionObjectInputSchema, decisionInput({ action_payload: {} })), true);
add('decision.contract.evidence-array', () => sp(DecisionObjectInputSchema, decisionInput({ evidence: [{ a: 1 }, { b: 2 }] })));
add('decision.contract.evidence-string', () => sp(DecisionObjectInputSchema, decisionInput({ evidence: 'x' })));
add('decision.contract.evidence-array-of-scalars', () => sp(DecisionObjectInputSchema, decisionInput({ evidence: [1] })));
add('decision.contract.status-explicit', () => sp(DecisionObjectInputSchema, decisionInput({ status: 'resolved' })));
add('decision.contract.status-bad', () => sp(DecisionObjectInputSchema, decisionInput({ status: 'closed' })));
add('decision.contract.score-out-of-range', () => sp(DecisionObjectInputSchema, decisionInput({ impact_traffic: -1, confidence_score: 1.01 })));
add('decision.contract.score-infinity', () => sp(DecisionObjectInputSchema, decisionInput({ priority_score: Infinity })));
add('decision.contract.blank-title', () => sp(DecisionObjectInputSchema, decisionInput({ title: '   ' })));
add('decision.contract.dirty-field-plus-refine', () =>
  sp(DecisionObjectInputSchema, decisionInput({ company_id: 'bad', entity_type: 'global', action_payload: {} })),
);
add('decision.contract.type-error-plus-refine', () =>
  sp(DecisionObjectInputSchema, decisionInput({ title: 5, entity_type: 'global', action_payload: {} })),
);
add('decision.contract.unknown-keys', () => sp(DecisionObjectInputSchema, decisionInput({ tenant_id: 'x', __proto__x: 1 })));
add('decision.contract.not-object', () => sp(DecisionObjectInputSchema, null));
add('decision.write.valid-defaults', () => sp(DecisionObjectWriteSchema, decisionInput()));
add('decision.write.empty-evidence', () => sp(DecisionObjectWriteSchema, decisionInput({ evidence: [] })), true);
add('decision.write.empty-evidence-object', () => sp(DecisionObjectWriteSchema, decisionInput({ evidence: {} })), true);
add('decision.write.last-changed-by', () => sp(DecisionObjectWriteSchema, decisionInput({ last_changed_by: 'user' })));
add('decision.write.last-changed-by-bad', () => sp(DecisionObjectWriteSchema, decisionInput({ last_changed_by: 'admin' })));
add('decision.write.all-refines', () =>
  sp(DecisionObjectWriteSchema, decisionInput({ entity_type: 'global', evidence: [], action_payload: {} })),
  true,
);

// decisionRuntimeGuardService
for (const [k, v] of Object.entries(UUID_VARIANTS)) {
  add(`guard.array.id.${k}`, () => call(() => assertDecisionArray('svc', [persistedRow({ id: v })] as any).length));
}
add('guard.array.empty', () => call(() => assertDecisionArray('svc', [] as any).length));
add('guard.array.extra-keys', () => call(() => assertDecisionArray('svc', [persistedRow({ more: 1 })] as any).length));
add('guard.array.missing-field', () => call(() => assertDecisionArray('svc', [persistedRow({ execution_score: undefined })] as any).length));
add('guard.array.score-infinity', () => call(() => assertDecisionArray('svc', [persistedRow({ execution_score: Infinity })] as any).length));
add('guard.array.not-array', () => call(() => assertDecisionArray('svc', {} as any)));
const reportView = (over: Record<string, unknown> = {}) => ({
  company_id: U_V4,
  report_tier: 'deep',
  entity_scope: { entity_type: 'global', entity_id: null },
  summary: { total: 1, open: 1, resolved: 0, ignored: 0, avg_confidence: 0.5, top_issue_types: [], top_action_types: [] },
  decisions: [persistedRow()],
  ...over,
});
add('guard.view.valid', () => call(() => Object.keys(assertDecisionReportView('svc', reportView() as any))));
add('guard.view.nonrfc-company', () => call(() => Object.keys(assertDecisionReportView('svc', reportView({ company_id: U_NONRFC }) as any))));
add('guard.view.bad-tier', () => call(() => assertDecisionReportView('svc', reportView({ report_tier: 'x' }) as any)));

// insightViewService (z.coerce.number)
const pulseRow = (over: Record<string, unknown> = {}) => ({
  company_id: U_V4,
  pulse_key: 'k',
  issue_type: 'i',
  action_type: 'a',
  decision_count: '3',
  avg_impact_traffic: 1.5,
  avg_impact_conversion: '2.25',
  avg_impact_revenue: null,
  avg_confidence_score: '',
  max_execution_score: true,
  latest_decision_at: '2026-01-01',
  ...over,
});
function mockPulse(rows: unknown) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => Promise.resolve({ data: rows, error: null });
  (supabase.from as jest.Mock).mockReturnValue(chain);
}
const pulse = (rows: unknown) => () => call(async () => {
  mockPulse(rows);
  return listMarketPulseView({ companyId: U_V4 });
});
add('pulse.coerce-mixed', pulse([pulseRow()]));
add('pulse.coerce-nan', pulse([pulseRow({ decision_count: 'abc' })]));
add('pulse.coerce-infinity', pulse([pulseRow({ decision_count: 'Infinity' })]));
add('pulse.coerce-array', pulse([pulseRow({ decision_count: [7] })]));
add('pulse.coerce-undefined', pulse([pulseRow({ decision_count: undefined })]));
add('pulse.coerce-bigint-string', pulse([pulseRow({ decision_count: '12345678901234567890' })]));
add('pulse.nonrfc-company', pulse([pulseRow({ company_id: U_NONRFC })]));
add('pulse.bad-company', pulse([pulseRow({ company_id: 'c1' })]));
add('pulse.null-data', pulse(null));

// planSchemas
const planResp = (platforms: unknown) => ({
  mode: 'generate_plan',
  snapshot_hash: 'h',
  omnivyre_decision: { status: 'ok', raw: { anything: true }, extra: 1 },
  plan: { weeks: [{ week: 1, theme: 't', daily: [{ day: 'Mon', objective: 'o', content: 'c', platforms }] }] },
});
add('plan.valid', () => sp(campaignPlanResponseSchema, planResp({ linkedin: 'post' })));
add('plan.platform-non-string', () => sp(campaignPlanResponseSchema, planResp({ linkedin: 3 })));
add('plan.platforms-array', () => sp(campaignPlanResponseSchema, planResp(['a'])));
add('plan.platforms-empty', () => sp(campaignPlanResponseSchema, planResp({})));
add('plan.decision-error', () =>
  sp(campaignPlanResponseSchema, { ...planResp({}), omnivyre_decision: { status: 'error', error: { message: 'm', status: 'x' } } }),
);

// campaignOptimizationService.optimizedWeekSchema
add('optimize.valid', () =>
  sp(optimizedWeekSchema, {
    optimized_week_plan: { theme: 't', content_types: { li: ['post'] }, frequency_per_platform: { li: 3 }, junk: 1 },
    change_summary: 's',
    confidence: 0.4,
  }),
);
add('optimize.empty-plan', () => sp(optimizedWeekSchema, { optimized_week_plan: {}, change_summary: 's', confidence: 1 }));
add('optimize.bad-record-values', () =>
  sp(optimizedWeekSchema, { optimized_week_plan: { content_types: { li: 'post' }, frequency_per_platform: { li: '3' } }, change_summary: 's', confidence: 1 }),
);
add('optimize.missing-all', () => sp(optimizedWeekSchema, {}));

// campaignPlanParser (AI output parsing; gateway mocked)
const ai = (output: unknown) =>
  (runCompletionWithOperation as jest.Mock).mockResolvedValue({ output: typeof output === 'string' ? output : JSON.stringify(output) });
const bpWeek = (over: Record<string, unknown> = {}) => ({
  week: 1,
  phase_label: 'p',
  primary_objective: 'o',
  platform_allocation: { linkedin: 2 },
  content_type_mix: ['post'],
  cta_type: 'Soft CTA',
  total_weekly_content_count: 2,
  weekly_kpi_focus: 'Bookings',
  ...over,
});
const parsePlan = (out: unknown) => () => call(async () => {
  ai(out);
  return parseAiPlanToWeeks('plan text');
});
add('parser.blueprint-valid', parsePlan({ weeks: [bpWeek({ platform_content_breakdown: { linkedin: [{ type: 'post', count: 2 }] } })] }));
add('parser.blueprint-strict-extra-key', parsePlan({ weeks: [bpWeek({ surprise: 1 })] }));
add('parser.blueprint-strict-top-extra', parsePlan({ weeks: [bpWeek()], note: 'x' }));
add('parser.blueprint-bad-cta', parsePlan({ weeks: [bpWeek({ cta_type: 'Hard CTA' })] }));
add('parser.blueprint-allocation-string', parsePlan({ weeks: [bpWeek({ platform_allocation: { linkedin: '2' } })] }));
add('parser.legacy-valid', parsePlan({ weeks: [{ week: 1, theme: 't', daily: [{ day: 'Mon', objective: 'o', content: 'c', platforms: { x: 'y' } }] }] }));
add('parser.neither', parsePlan({ weeks: [{ week: 'one' }] }));
add('parser.not-json', parsePlan('nonsense'));
add('parser.huge-number', parsePlan('{"weeks":[{"week":1e999,"phase_label":"p","primary_objective":"o","platform_allocation":{},"content_type_mix":[],"cta_type":"None","total_weekly_content_count":0,"weekly_kpi_focus":"Bookings"}]}'));
const refined = (out: unknown) => () => call(async () => {
  ai(out);
  return parseAiRefinedDay('day text');
});
add('parser.refined-valid', refined({ week: 1, day: 'Mon', objective: 'o', content: 'c', platforms: { li: 'x' }, extra: 1 }));
add('parser.refined-bad-platform', refined({ week: 1, day: 'Mon', objective: 'o', content: 'c', platforms: { li: 1 } }));
const custom = (out: unknown) => () => call(async () => {
  ai(out);
  return parseAiPlatformCustomization('c');
});
add('parser.custom-valid', custom({ day: 'Mon', platforms: { li: 'x' } }));
add('parser.custom-bad', custom({ day: 'Mon', platforms: 'x' }));

// extractionSchema
add('extraction.mixed', () =>
  call(() =>
    buildExtractionWithDefaults({
      company_name: { value: 'Acme', source: 'website', confidence: 'High' },
      industry: { values: ['a', '', null, 'b'], source: 'Website (about)', confidence: 'Medium' },
      category: { value: [], source: 'inferred', confidence: 'Low' },
      website_url: { value: 5, source: 'user', confidence: 'High' },
      geography: { value: 'x', source: 'user', confidence: 'high' },
      goals: { source: 'social', confidence: 'Low' },
      competitors: 'not-an-object',
      social_profiles: { linkedin: { value: 'u', values: 'v', source: 'social', confidence: 'High', extra: 1 } },
      missing_fields: ['a'],
    }),
  ),
);
add('extraction.null', () => call(() => buildExtractionWithDefaults(null)));

// dayContentProfile
const day = (over: Record<string, unknown> = {}) => ({
  headline: 'h',
  caption: 'c',
  hook: 'k',
  callToAction: 'cta',
  hashtags: ['#a'],
  tone: 't',
  reasoning: 'r',
  ...over,
});
add('day.valid', () => sp(dayContentSchema, day({ extra: 1 })));
add('day.optional-null', () => sp(dayContentSchema, day({ script: null })));
add('day.missing-tone', () => sp(dayContentSchema, day({ tone: undefined })));
add('day.hashtags-string', () => sp(dayContentSchema, day({ hashtags: '#a' })));

// env schema (boot config)
add('env.base-defaults', () => sp(envSchema, ENV_BASE));
add('env.unknown-key-stripped', () => sp(envSchema, { ...ENV_BASE, NOT_IN_SCHEMA: 'x' }));
for (const v of [undefined, '0', '1', 'true', 'false', 'yes', 'TRUE']) {
  add(`env.ENABLE_AUTO_WORKERS.${String(v)}`, () => sp(envSchema, { ...ENV_BASE, ENABLE_AUTO_WORKERS: v }));
}
for (const v of [undefined, 'TRUE', 'FALSE', '0', 'nope']) {
  add(`env.META_DEBUG.${String(v)}`, () => sp(envSchema, { ...ENV_BASE, META_DEBUG: v }));
  add(`env.USE_MOCK_PLATFORMS.${String(v)}`, () => sp(envSchema, { ...ENV_BASE, USE_MOCK_PLATFORMS: v }));
}
for (const [k, v] of Object.entries(URL_VARIANTS)) {
  add(`env.SUPABASE_URL.${k}`, () => sp(envSchema, { ...ENV_BASE, SUPABASE_URL: v }), true);
  add(`env.APP_URL.${k}`, () => sp(envSchema, { ...ENV_BASE, APP_URL: v }), true);
  add(`extension.profile_url.${k}`, () =>
    sp(LinkedinCommentEventDataSchema, {
      thread_id: 't',
      comment_id: 'c',
      comment_text: 'x',
      author: { name: 'n', profile_url: v, profile_id: 'p' },
      created_at: 1,
    }),
  );
}
add('env.SUPABASE_URL.missing', () => sp(envSchema, { ...ENV_BASE, SUPABASE_URL: undefined }));
add('env.NEXT_PUBLIC_APP_URL.bad', () => sp(envSchema, { ...ENV_BASE, NEXT_PUBLIC_APP_URL: 'bad' }), true);
add('env.NEXT_PUBLIC_APP_URL.set', () => sp(envSchema, { ...ENV_BASE, NEXT_PUBLIC_APP_URL: 'https://app.example.com' }));
add('env.ENCRYPTION_KEY.upper', () => sp(envSchema, { ...ENV_BASE, ENCRYPTION_KEY: 'A'.repeat(64) }), true);
add('env.ENCRYPTION_KEY.short', () => sp(envSchema, { ...ENV_BASE, ENCRYPTION_KEY: 'a'.repeat(63) }), true);
add('env.ENCRYPTION_KEY.missing', () => sp(envSchema, { ...ENV_BASE, ENCRYPTION_KEY: undefined }));
add('env.OAUTH_STATE_HMAC_KEY.bad', () => sp(envSchema, { ...ENV_BASE, OAUTH_STATE_HMAC_KEY: 'zz' }), true);
add('env.OAUTH_STATE_HMAC_KEY.ok', () => sp(envSchema, { ...ENV_BASE, OAUTH_STATE_HMAC_KEY: 'b'.repeat(64) }));
add('env.SUPABASE_SECRET_KEY.empty', () => sp(envSchema, { ...ENV_BASE, SUPABASE_SECRET_KEY: '' }), true);
add('env.OPENAI_API_KEY.empty', () => sp(envSchema, { ...ENV_BASE, OPENAI_API_KEY: '' }), true);
add('env.PUBLISHABLE.empty', () => sp(envSchema, { ...ENV_BASE, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }), true);
for (const v of [0, 65536, 6380, 6380.5, NaN]) {
  add(`env.REDIS_PORT.${String(v)}`, () => sp(envSchema, { ...ENV_BASE, REDIS_PORT: v }));
}
for (const v of [Infinity, -Infinity, -1, 0, 2.5, NaN]) {
  add(`env.COST_REQUEST_THRESHOLD_USD.${String(v)}`, () => sp(envSchema, { ...ENV_BASE, COST_REQUEST_THRESHOLD_USD: v }));
}
add('env.OPENAI_TIMEOUT.low', () => sp(envSchema, { ...ENV_BASE, OPENAI_TIMEOUT: 999 }));
add('env.BOLT_WORKER_CONCURRENCY.float', () => sp(envSchema, { ...ENV_BASE, BOLT_WORKER_CONCURRENCY: 1.5 }));
add('env.BOLT_WORKER_CONCURRENCY.int', () => sp(envSchema, { ...ENV_BASE, BOLT_WORKER_CONCURRENCY: 4 }));
add('env.INTERNAL_METRICS_SECRET.empty', () => sp(envSchema, { ...ENV_BASE, INTERNAL_METRICS_SECRET: '' }));
add('env.OMNIVYRA_ENV.bad', () => sp(envSchema, { ...ENV_BASE, OMNIVYRA_ENV: 'qa' }));
add('env.NODE_ENV.test', () => sp(envSchema, { ...ENV_BASE, NODE_ENV: 'test', Mode: 'standalone', OMNIVYRA_AI_MODE: 'hybrid' }));
add('env.REDIS_URL.missing', () => sp(envSchema, { ...ENV_BASE, REDIS_URL: undefined }));
add('env.REDIS_URL.normalized', () => sp(envSchema, { ...ENV_BASE, REDIS_URL: '  rediss://default:pw@host.example.com:6380  ' }));
add('env.REDIS_URL.rejected-by-transform', () => sp(envSchema, { ...ENV_BASE, REDIS_URL: 'http://not-redis' }));
add('env.everything-missing', () => sp(envSchema, {}));
add('env.not-object', () => sp(envSchema, undefined));

// extension validators (schema level)
const event = (over: Record<string, unknown> = {}) => ({
  platform: 'linkedin',
  event_type: 'comment',
  platform_message_id: 'm1',
  data: { a: 1 },
  timestamp: 1700000000000,
  ...over,
});
add('extension.event.valid-strips', () => sp(ExtensionEventRequestSchema, event({ extra: 'x' })));
add('extension.event.data-array', () => sp(ExtensionEventRequestSchema, event({ data: [] })));
add('extension.query.defaults', () => sp(GetCommandsQuerySchema, {}));
add('extension.query.coerce', () => sp(GetCommandsQuerySchema, { limit: '5.5', platform: 'youtube' }));
add('extension.query.bool', () => sp(GetCommandsQuerySchema, { limit: true }));
add('extension.validate.strips', () => sp(ValidateSessionRequestSchema, { token: 'x' }));
add('extension.validate.null', () => sp(ValidateSessionRequestSchema, null));
for (const [k, v] of Object.entries(UUID_VARIANTS)) {
  add(`extension.command_id.${k}`, () =>
    sp(CommandResultRequestSchema, { command_id: v, status: 'success', result: { success: true } }),
  );
}

// extension controller — 400 bodies are client-facing; messages must be identical
const eventBodies: Record<string, unknown> = {
  valid: event(),
  undefined_body: undefined,
  null_body: null,
  string_body: 'x',
  array_body: [],
  empty: {},
  bad_platform: event({ platform: 'tiktok' }),
  platform_number: event({ platform: 1 }),
  missing_event_type: event({ event_type: undefined }),
  bad_event_type: event({ event_type: 'click' }),
  empty_message_id: event({ platform_message_id: '' }),
  message_id_number: event({ platform_message_id: 7 }),
  data_string: event({ data: 'x' }),
  data_null: event({ data: null }),
  data_array: event({ data: [1] }),
  data_missing: event({ data: undefined }),
  ts_string: event({ timestamp: '1700000000000' }),
  ts_zero: event({ timestamp: 0 }),
  ts_negative: event({ timestamp: -5 }),
  ts_float: event({ timestamp: 1.5 }),
  ts_nan: event({ timestamp: NaN }),
  ts_infinity: event({ timestamp: Infinity }),
  ts_bool: event({ timestamp: true }),
  ts_null: event({ timestamp: null }),
  two_errors: event({ platform: 'x', timestamp: 'y' }),
};
for (const [k, body] of Object.entries(eventBodies)) {
  add(`controller.events.${k}`, () => ctl('handlePostEvent', { body }), true);
}
const queries: Record<string, unknown> = {
  empty: {},
  limit_ok: { limit: '50' },
  limit_abc: { limit: 'abc' },
  limit_zero: { limit: '0' },
  limit_blank: { limit: '' },
  limit_101: { limit: '101' },
  limit_array: { limit: ['5', '6'] },
  limit_float: { limit: '0.5' },
  platform_bad: { platform: 'tiktok' },
  platform_array: { platform: ['linkedin'] },
};
for (const [k, query] of Object.entries(queries)) {
  add(`controller.commands.${k}`, () => ctl('handleGetCommands', { query }), true);
}
const resultBodies: Record<string, unknown> = {
  valid: { command_id: U_V4, status: 'success', result: { success: true } },
  nonrfc: { command_id: U_NONRFC, status: 'success', result: { success: true } },
  nil: { command_id: U_NIL, status: 'failed', result: { success: false, error: 'e' } },
  bad_uuid: { command_id: 'abc', status: 'success', result: { success: true } },
  missing_uuid: { status: 'success', result: { success: true } },
  uuid_number: { command_id: 5, status: 'success', result: { success: true } },
  bad_status: { command_id: U_V4, status: 'pending', result: { success: true } },
  missing_result: { command_id: U_V4, status: 'success' },
  result_success_string: { command_id: U_V4, status: 'success', result: { success: 'yes' } },
  platform_response_string: { command_id: U_V4, status: 'success', result: { success: true, platform_response: 'x' } },
  message_number: { command_id: U_V4, status: 'success', result: { success: true, message: 1 } },
  empty: {},
};
for (const [k, body] of Object.entries(resultBodies)) {
  add(`controller.result.${k}`, () => ctl('handleCommandResult', { body }), true);
}

// JEV BJC contract + judge (error message lists path:code)
add('bjc.valid', () => sp(bjcRequestSchema, bjcRequest()));
for (const [k, v] of Object.entries({
  z: '2026-10-01T10:00:00Z',
  millis: '2026-10-01T10:00:00.123Z',
  micros: '2026-10-01T10:00:00.123456Z',
  colon_offset: '2026-10-01T10:00:00+05:30',
  compact_offset: '2026-10-01T10:00:00+0530',
  hour_offset: '2026-10-01T10:00:00+05',
  neg_offset: '2026-10-01T10:00:00-08:00',
  no_seconds: '2026-10-01T10:00Z',
  no_zone: '2026-10-01T10:00:00',
  lower_z: '2026-10-01t10:00:00z',
  feb30: '2026-02-30T10:00:00Z',
  leap: '2024-02-29T10:00:00Z',
  nonleap: '2026-02-29T10:00:00Z',
  hour24: '2026-10-01T24:00:00Z',
  space_sep: '2026-10-01 10:00:00Z',
  date_only: '2026-10-01',
  offset_99: '2026-10-01T10:00:00+99:00',
  padded: ' 2026-10-01T10:00:00Z',
})) {
  add(`bjc.captured_at.${k}`, () => sp(bjcRequestSchema, bjcEvidence({ captured_at: v })));
}
add('bjc.strict-top', () => sp(bjcRequestSchema, { ...bjcRequest(), extra: 1 }));
add('bjc.strict-ac', () =>
  sp(bjcRequestSchema, bjcRequest({ acceptance_criterion: { ...bjcDraft().acceptance_criterion, extra: 1 } })),
);
add('bjc.bad-enum', () => sp(bjcRequestSchema, bjcEvidence({ kind: 'screenshot' })));
add('bjc.bad-regex', () => sp(bjcRequestSchema, bjcEvidence({ id: 'EV-x' })));
add('bjc.too-many-ac-ids', () => sp(bjcRequestSchema, bjcEvidence({ ac_ids: Array.from({ length: 21 }, (_, i) => `AC-${i}`) })));
add('bjc.empty-ac-ids', () => sp(bjcRequestSchema, bjcEvidence({ ac_ids: [] })));
add('bjc.context-pass', () => sp(bjcRequestSchema, bjcEvidence({ kind: 'commit', result: 'PASS' })), true);
add('bjc.objective-no-evidence', () =>
  sp(bjcRequestSchema, bjcRequest({ acceptance_criterion: { id: 'AC-1', statement: 's', kind: 'OBJECTIVE', required_evidence: [] } })),
  true,
);
add('bjc.duplicate-ids', () =>
  sp(bjcRequestSchema, bjcRequest({ invariants: [{ id: 'INV-1', statement: 's', source: 'x' }, { id: 'INV-1', statement: 's', source: 'x' }] })),
  true,
);
const judgeMsg = (req: unknown) => () =>
  call(async () => {
    const r: any = await judge(req, {
      transport: null,
      audit: new MemoryAuditSink(),
      now: () => new Date('2026-10-01T12:00:00Z'),
      newRecordId: () => 'rec-1',
    } as any);
    return { status: r.status, error: r.error };
  });
add('judge.regex-and-enum', judgeMsg(bjcEvidence({ id: 'EV-x', kind: 'screenshot' })), true);
add('judge.datetime', judgeMsg(bjcEvidence({ captured_at: 'yesterday' })), true);
add('judge.strict-and-type', judgeMsg({ ...bjcRequest(), extra: 1, model: 5 }), true);
add('judge.too-big-and-small', judgeMsg(bjcEvidence({ ref: '', ac_ids: [] })), true);
add('judge.literal-like-enum', judgeMsg(bjcRequest({ acceptance_criterion: { id: 'AC-1', statement: 's', kind: 'MAYBE', required_evidence: ['test_run'] } })), true);
add('judge.custom', judgeMsg(bjcEvidence({ kind: 'commit', result: 'PASS' })), true);

// ─── deliberate zod-4 deltas (each with its exact v4 outcome) ────────────────
//
// zod 4's z.number() rejects ±Infinity (zod 3 accepted it unless .finite()).
// This is a strict tightening; see ZOD-MAJOR-UPGRADE.md "Infinity" for why it
// is accepted at these sites. The env COST_REQUEST_THRESHOLD_USD site is the
// exception: it is explicitly preserved, so it is NOT listed here.
const DELIBERATE_V4_DELTAS: Record<string, (o: Outcome) => void> = {
  'action.priority-infinity': (o) => {
    expect(o.success).toBe(false);
    expect(o.issues!.map((i) => i.path)).toEqual(['priority_score']);
  },
  'guard.array.score-infinity': (o) => {
    expect(o).toEqual({ success: false, threw: 'svc returned non-decision output.' });
  },
  'pulse.coerce-infinity': (o) => {
    expect(o).toEqual({ success: false, threw: 'insightViewService.listMarketPulseView returned non-view output.' });
  },
  // JSON.parse('1e999') === Infinity. zod 3 accepted the blueprint as-is; zod 4
  // rejects it and the parser's existing repair path rebuilds the week (the
  // week number itself is not zod-validated on that path).
  'parser.huge-number': (o) => {
    expect(o.success).toBe(true);
    const v = o.value as any;
    expect(v.format).toBe('blueprint');
    expect(v.weeks).toHaveLength(1);
    expect(v.weeks[0].platform_allocation).toEqual({ linkedin: 1 });
  },
};
/** Deltas where zod 3 ACCEPTED and zod 4 rejects (the parser delta stays an acceptance). */
const V4_REJECTS_V3_ACCEPTED = ['action.priority-infinity', 'guard.array.score-infinity', 'pulse.coerce-infinity'];

// ─── run ─────────────────────────────────────────────────────────────────────

describe(`zod characterization (zod ${ZOD_VERSION})`, () => {
  const results: Record<string, Outcome> = {};

  beforeAll(async () => {
    for (const c of cases) results[c.id] = await c.run();
    if (CAPTURE) {
      if (ZOD_MAJOR !== 3) throw new Error('golden capture must run against zod 3');
      fs.writeFileSync(
        GOLDEN,
        JSON.stringify({ zod: ZOD_VERSION, cases: results }, null, 2) + '\n',
        'utf8',
      );
    }
  });

  const golden: { zod: string; cases: Record<string, Outcome> } = fs.existsSync(GOLDEN)
    ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    : { zod: 'missing', cases: {} };

  it('the golden was captured from zod 3.25.76 and covers every case', () => {
    expect(golden.zod).toBe('3.25.76');
    expect(Object.keys(golden.cases).sort()).toEqual(cases.map((c) => c.id).sort());
    expect(cases.length).toBeGreaterThan(250);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s', (id, c) => {
    const got = results[id];
    const want = golden.cases[id];
    expect(want).toBeDefined();
    if (ZOD_MAJOR >= 4 && DELIBERATE_V4_DELTAS[id]) {
      // Recorded v3 outcome was an acceptance (or a different 400 message).
      DELIBERATE_V4_DELTAS[id](got);
      return;
    }
    expect(got.success).toBe(want.success);
    expect(got.threw).toEqual(want.threw);
    expect(got.data).toEqual(want.data);
    expect(got.value).toEqual(want.value);
    expect((got.issues ?? []).map((i) => i.path)).toEqual((want.issues ?? []).map((i) => i.path));
    expect((got.issues ?? []).map((i) => i.custom)).toEqual((want.issues ?? []).map((i) => i.custom));
    // Custom (refinement) messages are always identical.
    expect((got.issues ?? []).filter((i) => i.custom).map((i) => i.message)).toEqual(
      (want.issues ?? []).filter((i) => i.custom).map((i) => i.message),
    );
    if (c.exactMessages) {
      expect((got.issues ?? []).map((i) => i.message)).toEqual((want.issues ?? []).map((i) => i.message));
    }
  });

  it('zod 4 deltas are real deltas against the v3 golden (not silently matching)', () => {
    if (ZOD_MAJOR < 4) return;
    for (const id of Object.keys(DELIBERATE_V4_DELTAS)) {
      expect(golden.cases[id]).toBeDefined();
      expect(results[id]).not.toEqual(golden.cases[id]);
    }
    for (const id of V4_REJECTS_V3_ACCEPTED) {
      expect(golden.cases[id].success).toBe(true);
      expect(results[id].success).toBe(false);
    }
  });

  // zod 4's .int() is a SAFE-integer check; zod 3's was Number.isInteger only, so
  // integers beyond 2^53-1 were accepted. No legitimate value at these sites is
  // that large (and none can be represented exactly). Not in the v3 golden;
  // asserted here as zod 4 behaviour so the tightening stays visible.
  it('zod 4 tightening: .int() rejects unsafe integers', () => {
    if (ZOD_MAJOR < 4) return;
    const huge = 2 ** 60;
    expect(sp(envSchema, { ...ENV_BASE, REDIS_MAX_BYTES: huge }).success).toBe(false);
    expect(sp(ActionPayloadSchema, actionPayload({ timeline_days: huge })).success).toBe(false);
    expect(sp(ExtensionEventRequestSchema, event({ timestamp: huge })).success).toBe(false);
    expect(sp(envSchema, { ...ENV_BASE, REDIS_MAX_BYTES: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    expect(sp(ExtensionEventRequestSchema, event({ timestamp: 1700000000000 })).success).toBe(true);
  });
});
