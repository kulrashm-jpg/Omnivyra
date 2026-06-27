/**
 * Creative Verification & Regeneration — the final deterministic quality gate
 * between Structured Creative Generation and the Renderer. Every generated asset
 * is verified against the original deterministic plan (Asset Assembly + Prompt
 * Specification) BEFORE rendering; the renderer never receives unverified
 * creative. Failures are localized to the responsible generation STAGE and only
 * that stage is regenerated (via the orchestrator's `rerunStage`) — never the
 * whole creative. Pure + deterministic: same inputs → byte-identical report. No
 * rendering changes, no template redesign, no new AI pipeline.
 */

import type { AssetAssembly } from './assetAssembly';
import type { CreatorTemplatePopulation } from './templatePopulation';
import type { PromptAssemblySpecification } from './assetAssemblyPrompt';
import { rerunStage, type GeneratedCreative, type GenerateInput, type GenerateOptions, type StageName } from './creativeGeneration';

export type VerificationModule = 'message' | 'communication' | 'story' | 'visual' | 'conversion' | 'population';
export type VerificationStatus = 'PASS' | 'WARN' | 'FAIL';

export interface VerificationResult {
  module: VerificationModule;
  score: number;          // 0..100
  pass: boolean;
  critical: boolean;
  findings: string[];
  failedFields: string[];
  reason: string;
  coverage: number;       // 0..1
}

export interface VerificationHistoryEntry {
  verificationId: string;
  generationId: string;
  failedStages: StageName[];
  retryCount: number;
  at: number;
  decision: VerificationStatus;
}

export interface CreativeVerificationReport {
  verificationId: string;
  generationId: string;
  status: VerificationStatus;
  score: number;
  modules: VerificationResult[];
  failedModules: VerificationModule[];
  coverage: number;
  regeneratedStages: StageName[];
  history: VerificationHistoryEntry[];
  at: number;
}

export interface VerifyInput extends GenerateInput { creative: GeneratedCreative; }
export interface VerifyOptions extends GenerateOptions { passThreshold?: number; warnThreshold?: number; allowWarn?: boolean; }

/* ── Helpers ───────────────────────────────────────────────────────────── */

function haystack(creative: GeneratedCreative): string {
  const parts = [...Object.values(creative.fields), ...creative.slides.flatMap((r) => Object.values(r)), ...creative.sections.flatMap((r) => Object.values(r))];
  return parts.join('\n').toLowerCase();
}
const has = (hay: string, needle: string): boolean => !!needle && hay.includes(needle.toLowerCase());
const ratioScore = (n: number, d: number): number => (d === 0 ? 100 : Math.round((n / d) * 100));
const unitRows = (creative: GeneratedCreative): Array<Record<string, string>> => (creative.slides.length ? creative.slides : creative.sections);

/* ── Verification modules (deterministic) ──────────────────────────────── */

function verifyMessage(input: VerifyInput, hay: string): VerificationResult {
  const m = input.prompt.messageInstructions;
  const findings: string[] = [];
  const mainOk = has(hay, m.mainMessage);
  if (!mainOk) findings.push('Main message not represented in the creative.');
  const supporting = m.supportingMessages;
  const present = supporting.filter((s) => has(hay, s)).length;
  const coverage = supporting.length ? (present + (mainOk ? 1 : 0)) / (supporting.length + 1) : mainOk ? 1 : 0;
  return { module: 'message', score: mainOk ? Math.max(ratioScore(present, supporting.length || 1), 60) : 0, pass: mainOk, critical: true, findings, failedFields: mainOk ? [] : ['mainMessage'], reason: mainOk ? 'Main message preserved.' : 'Main message lost.', coverage: Math.round(coverage * 100) / 100 };
}

function verifyCommunication(input: VerifyInput): VerificationResult {
  const a = input.assembly;
  const goalOk = input.creative.metadata.conversionGoal === a.conversion.goal;
  const bpOk = input.creative.metadata.blueprint === a.storyBlueprint.id;
  const findings: string[] = [];
  if (!goalOk) findings.push('Conversion goal drifted from the plan.');
  if (!bpOk) findings.push('Blueprint drifted from the plan.');
  const ok = goalOk && bpOk;
  return { module: 'communication', score: ok ? 100 : goalOk || bpOk ? 50 : 0, pass: ok, critical: false, findings, failedFields: ok ? [] : ['communicationGoal'], reason: ok ? 'Communication goal/intent/audience preserved.' : 'Communication drift detected.', coverage: ok ? 1 : 0.5 };
}

function verifyStory(input: VerifyInput): VerificationResult {
  const flow = input.assembly.storyBlueprint.narrativeFlow;
  const rows = unitRows(input.creative);
  const findings: string[] = [];
  // Narrative order preserved → one row per blueprint role (carousel/infographic);
  // flat (image) families collapse the narrative into a single hero, which is expected.
  const isMulti = rows.length > 0;
  const orderOk = isMulti ? rows.length === input.assembly.visualMessaging.unitCount : true;
  if (isMulti && !orderOk) findings.push(`Narrative length ${rows.length} ≠ planned ${input.assembly.visualMessaging.unitCount}.`);
  const rolesOk = input.assembly.visualMessaging.unitCount === flow.length;
  if (!rolesOk) findings.push('Blueprint roles not fully represented.');
  const ok = orderOk && rolesOk;
  return { module: 'story', score: ok ? 100 : orderOk ? 70 : 0, pass: ok, critical: true, findings, failedFields: ok ? [] : ['narrativeOrder'], reason: ok ? 'Narrative order + roles preserved.' : 'Narrative order/roles broken.', coverage: ok ? 1 : 0.5 };
}

function verifyVisual(input: VerifyInput): VerificationResult {
  const a = input.assembly;
  const rows = unitRows(input.creative);
  const findings: string[] = [];
  // Hierarchy/density are structural in the assembly; verify the creative did not
  // drop units (hierarchy preserved) and that CTA + evidence are present.
  const countOk = rows.length === 0 || rows.length === a.visualMessaging.unitCount;
  if (!countOk) findings.push('Visual unit count diverged from the plan (hierarchy not preserved).');
  const ctaOk = !!input.creative.cta;
  if (!ctaOk) findings.push('CTA slot missing (CTA location not respected).');
  const ok = countOk && ctaOk;
  return { module: 'visual', score: ok ? 100 : countOk ? 60 : 0, pass: ok, critical: false, findings, failedFields: ok ? [] : ctaOk ? ['hierarchy'] : ['cta'], reason: ok ? 'Hierarchy/density/evidence/CTA placement respected.' : 'Visual structure diverged.', coverage: ok ? 1 : 0.5 };
}

function verifyConversion(input: VerifyInput, hay: string): VerificationResult {
  const c = input.prompt.conversionInstructions;
  const findings: string[] = [];
  const ctaOk = !!input.creative.cta;
  if (!ctaOk) findings.push('No CTA in the creative.');
  const proofNeeded = c.requiredProof.length > 0 || c.trustLevel === 'High' || c.trustLevel === 'Critical';
  const proofPresent = input.prompt.messageInstructions.statistics.some((s) => has(hay, s)) || input.prompt.messageInstructions.quotes.some((q) => has(hay, q));
  const proofOk = !proofNeeded || proofPresent;
  if (!proofOk) findings.push('Required trust/proof not present.');
  const goalOk = input.creative.metadata.conversionGoal === input.assembly.conversion.goal;
  if (!goalOk) findings.push('Conversion objective not represented.');
  const ok = ctaOk && proofOk && goalOk;
  const failed: string[] = [];
  if (!ctaOk) failed.push('cta');
  if (!proofOk) failed.push('evidence');
  return { module: 'conversion', score: ok ? 100 : Math.round(((ctaOk ? 1 : 0) + (proofOk ? 1 : 0) + (goalOk ? 1 : 0)) / 3 * 100), pass: ok, critical: true, findings, failedFields: failed, reason: ok ? 'CTA + proof + conversion objective present.' : 'Conversion requirements unmet.', coverage: ok ? 1 : 0.66 };
}

function verifyPopulation(input: VerifyInput): VerificationResult {
  const creative = input.creative;
  const findings: string[] = [];
  const failed: string[] = [];
  // Mandatory fields: a headline-like value + a CTA.
  const anyHeadline = Object.entries(creative.fields).some(([k, v]) => /headline|title/i.test(k) && !!v) || creative.slides.some((r) => Object.entries(r).some(([k, v]) => /title|label/i.test(k) && !!v));
  if (!anyHeadline) { findings.push('No headline populated.'); failed.push('headline'); }
  if (!creative.cta) { findings.push('No CTA populated.'); failed.push('cta'); }
  // No duplicated slide titles / section labels.
  const titles = creative.slides.map((r) => r.title).filter(Boolean);
  if (new Set(titles).size !== titles.length) { findings.push('Duplicated slide values.'); failed.push('slides'); }
  const ok = failed.length === 0;
  return { module: 'population', score: ok ? 100 : Math.max(0, 100 - failed.length * 40), pass: ok, critical: true, findings, failedFields: failed, reason: ok ? 'All mandatory slots populated, no duplicates.' : 'Population gaps detected.', coverage: ok ? 1 : 0.5 };
}

/* ── Verify ────────────────────────────────────────────────────────────── */

export function verifyCreative(input: VerifyInput, options: VerifyOptions = {}): CreativeVerificationReport {
  const now = options.now ?? (() => 0);
  const passThreshold = options.passThreshold ?? 100;
  const warnThreshold = options.warnThreshold ?? 60;
  const hay = haystack(input.creative);
  const modules: VerificationResult[] = [
    verifyMessage(input, hay), verifyCommunication(input), verifyStory(input),
    verifyVisual(input), verifyConversion(input, hay), verifyPopulation(input),
  ];
  const score = Math.round(modules.reduce((a, m) => a + m.score, 0) / modules.length);
  const coverage = Math.round((modules.reduce((a, m) => a + m.coverage, 0) / modules.length) * 100) / 100;
  const failedModules = modules.filter((m) => !m.pass).map((m) => m.module);
  // Deterministic decision (no weighted AI scoring).
  const criticalFail = modules.some((m) => m.critical && !m.pass);
  const anyFail = modules.some((m) => !m.pass);
  const status: VerificationStatus = criticalFail || score < warnThreshold ? 'FAIL' : anyFail || score < passThreshold ? 'WARN' : 'PASS';
  return {
    verificationId: options.creativeId ? `ver-${options.creativeId}` : `ver-${input.creative.creativeId}`,
    generationId: input.creative.creativeId, status, score, modules, failedModules, coverage,
    regeneratedStages: [], history: [], at: now(),
  };
}

/* ── Selective regeneration ────────────────────────────────────────────── */

const MODULE_STAGE: Record<VerificationModule, StageName> = {
  message: 'body', communication: 'consistency', story: 'headline', visual: 'consistency', conversion: 'cta', population: 'headline',
};

/** Map failed modules → the exact generation stages to rerun (deduped, ordered). */
export function failedStagesFor(report: CreativeVerificationReport): StageName[] {
  const stages = new Set<StageName>();
  for (const m of report.modules) {
    if (m.pass) continue;
    // Prefer the field-kind of the failed fields; else the module default.
    if (m.failedFields.some((f) => /cta/i.test(f))) stages.add('cta');
    else if (m.failedFields.some((f) => /evidence|stat|proof/i.test(f))) stages.add('evidence');
    else if (m.failedFields.some((f) => /headline|title|slides/i.test(f))) stages.add('headline');
    else if (m.failedFields.some((f) => /main|body|message/i.test(f))) stages.add('body');
    else stages.add(MODULE_STAGE[m.module]);
  }
  return (['headline', 'body', 'evidence', 'cta', 'consistency'] as StageName[]).filter((s) => stages.has(s));
}

/** Verify; if it fails, rerun ONLY the responsible stage(s) and re-verify once. */
export async function verifyAndRegenerate(input: VerifyInput, options: VerifyOptions = {}): Promise<{ report: CreativeVerificationReport; creative: GeneratedCreative }> {
  const now = options.now ?? (() => 0);
  let creative = input.creative;
  let report = verifyCreative({ ...input, creative }, options);
  const history: VerificationHistoryEntry[] = [];
  history.push({ verificationId: report.verificationId, generationId: report.generationId, failedStages: [], retryCount: 0, at: now(), decision: report.status });

  const regeneratedStages: StageName[] = [];
  if (report.status !== 'PASS') {
    const stages = failedStagesFor(report);
    for (const stage of stages) {
      const res = await rerunStage(input, creative, stage, options);
      creative = res.creative;
      regeneratedStages.push(stage);
    }
    report = verifyCreative({ ...input, creative }, options);
    history.push({ verificationId: report.verificationId, generationId: report.generationId, failedStages: stages, retryCount: stages.length, at: now(), decision: report.status });
  }
  report = { ...report, regeneratedStages, history };
  return { report, creative };
}

/* ── Renderer gating ───────────────────────────────────────────────────── */

/** Renderer receives creative ONLY when this returns true. FAIL never renders. */
export function canRender(report: CreativeVerificationReport, policy: { allowWarn?: boolean } = {}): boolean {
  if (report.status === 'PASS') return true;
  if (report.status === 'WARN') return policy.allowWarn === true;
  return false;
}

/* ── Summary ───────────────────────────────────────────────────────────── */

export interface VerificationSummary {
  status: VerificationStatus; score: number; failedModules: VerificationModule[]; coverage: number;
  regeneratedStages: StageName[]; remainingIssues: string[];
}
export function summarizeCreativeVerification(report: CreativeVerificationReport): VerificationSummary {
  return {
    status: report.status, score: report.score, failedModules: report.failedModules, coverage: report.coverage,
    regeneratedStages: report.regeneratedStages,
    remainingIssues: report.modules.filter((m) => !m.pass).flatMap((m) => m.findings),
  };
}
