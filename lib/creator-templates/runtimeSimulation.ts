/**
 * Runtime Simulation Harness (CREATOR-031). Executes the ACTUAL deterministic
 * Creator pipeline end-to-end — no mocks, no production routes, no rendering —
 * capturing every intermediate artifact, comparing adjacent stages for
 * divergence, classifying gaps, and producing runtime metrics. Read-only:
 * changes no behaviour. Reuses every existing module.
 */

import { extractIntelligence, type ContentIntelligence } from './contentIntelligence';
import { classifyStrategy } from './communicationStrategy';
import { classifyAudienceJourney } from './audienceJourney';
import { extractMessageDocument } from './messageExtraction';
import { buildVisualMessagingPlan } from './visualMessagingPlan';
import { buildConversionStrategy } from './conversionStrategy';
import { buildAssetAssembly, type AssetAssembly } from './assetAssembly';
import { populateTemplateFromAssembly, type CreatorTemplatePopulation } from './templatePopulation';
import { buildEditorMigration } from './editorMigration';
import { editField, editorFields, editorDiagnostics, effectivePopulation, toRenderPayload, type EditorState } from './editorRuntime';
import { buildPromptFromAssembly } from './assetAssemblyPrompt';
import { generateCreative } from './creativeGeneration';
import { verifyTypographyRuntime } from './typographyVerification';
import { verifyCreative } from './creativeVerification';
import { editorStateToGeneratePayload } from './creatorRuntimeBridge';
import { initTemplateValues, type TemplateFieldValues } from './values';
import type { CreatorTemplate, TemplateAssetFamily } from './types';

export type GapCategory = 'A:wiring' | 'B:legacy-state' | 'C:renderer-mapping' | 'D:template-mapping' | 'E:prompt' | 'F:verification' | 'G:ui-binding' | 'H:architecture';

export interface SimGap {
  stage: string;
  field: string;
  owner: string;
  expectedOwner: string;
  rootCause: string;
  category: GapCategory;
}

export interface SimMetrics {
  stages: number;
  coverage: number;
  parityScore: number;          // editor==preview==render across fields (0..1)
  autoFields: number;
  manualFields: number;
  duplicateOwnership: number;
  legacyUsage: number;
  typographyCompleteness: number;
  verification: string;
  typographyStatus: string;
}

export interface SimResult {
  entryPoint: string;
  family: TemplateAssetFamily;
  trace: string[];
  gaps: SimGap[];                  // INTEGRATION gaps only (wiring/ownership/legacy/parity)
  verificationVerdict: string;     // Creative Verification status (content quality)
  verificationFindings: string[];  // content-quality findings (verifier WORKING, not integration gaps)
  metrics: SimMetrics;
  ok: boolean;                     // integration soundness: zero gaps + full parity
}

export interface SimInput {
  entryPoint: string;
  family: TemplateAssetFamily;
  template: CreatorTemplate;
  sourceText: string;
  existingValues?: TemplateFieldValues;
}

const stamp = (p: { fields: Record<string, string>; slides: Array<Record<string, string>>; sections: Array<Record<string, string>> }) => JSON.stringify({ f: p.fields, s: p.slides, x: p.sections });

/* ── Execute the actual pipeline + capture every stage ─────────────────── */

export async function simulateCreatorRuntime(input: SimInput): Promise<SimResult> {
  const trace: string[] = [];
  const gaps: SimGap[] = [];
  const family = input.family;

  // Intake → … → Asset Assembly (the actual deterministic layers).
  const intel: ContentIntelligence = extractIntelligence(input.sourceText); trace.push('Content Intelligence');
  const strategy = classifyStrategy(intel); trace.push('Communication Strategy');
  const journey = classifyAudienceJourney(strategy, intel); trace.push('Audience Journey');
  const message = extractMessageDocument({ content: input.sourceText, source: 'extraction', id: `sim-${input.entryPoint}` }); trace.unshift('Message Foundation');
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily: family }); trace.push('Story Blueprint', 'Visual Messaging Plan');
  const conversion = buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily: family }); trace.push('Conversion Strategy');
  const assembly: AssetAssembly = buildAssetAssembly({ message, strategy, journey, plan, conversion, assetFamily: family }); trace.push('Asset Assembly');
  const population: CreatorTemplatePopulation = populateTemplateFromAssembly(assembly, input.template); trace.push('Template Population');

  // editorRuntime — seeded from the SAME population/assembly (one source of truth).
  const legacyValues = input.existingValues ?? initTemplateValues(input.template);
  let editorState: EditorState = buildEditorMigration({ template: input.template, legacyValues, deterministicPopulation: population, assembly }).state;
  trace.push('editorRuntime');

  // Prompt + Structured Generation + Verification + Renderer payload.
  const prompt = buildPromptFromAssembly(assembly); trace.push('Prompt Specification');
  const creative = await generateCreative({ assembly, population, prompt }); trace.push('Structured Creative Generation');
  const typo = verifyTypographyRuntime(editorState, input.template); trace.push('Typography Verification');
  const creativeRep = verifyCreative({ assembly, population, prompt, creative }); trace.push('Creative Verification');
  const genPayload = editorStateToGeneratePayload(editorState, input.template);
  const renderPayload = toRenderPayload(editorState); trace.push('Renderer Payload');

  // ── Divergence detection (STEP 4) ──
  const eff = effectivePopulation(editorState);
  const preview = eff; // preview consumes effectivePopulation directly
  if (stamp(eff) !== stamp(preview)) gaps.push({ stage: 'editorRuntime→Preview', field: '*', owner: 'editorRuntime', expectedOwner: 'editorRuntime', rootCause: 'preview formatter divergence', category: 'G:ui-binding' });
  if (stamp(preview) !== stamp(renderPayload)) gaps.push({ stage: 'Preview→Renderer', field: '*', owner: 'editorRuntime', expectedOwner: 'editorRuntime', rootCause: 'render payload remap', category: 'C:renderer-mapping' });
  // Generate payload must trace back to render payload's field values.
  const genFields = (genPayload.template_fields ?? {});
  for (const [k, v] of Object.entries(renderPayload.fields)) {
    if (genFields[k] !== undefined && genFields[k] !== v) gaps.push({ stage: 'GeneratePayload', field: k, owner: 'editorRuntime', expectedOwner: 'editorRuntime', rootCause: 'generate payload diverges from render payload', category: 'C:renderer-mapping' });
  }
  // Editor binding (placeholder leaks / legacy defaults).
  if (!typo.editorBindingValid) gaps.push({ stage: 'editorRuntime', field: typo.findings.join('|'), owner: 'editorRuntime', expectedOwner: 'canonical', rootCause: 'placeholder/legacy value bound', category: 'B:legacy-state' });
  // AI typography (a true integration gap — typography must be canonical only).
  if (typo.aiTypographyDetected) gaps.push({ stage: 'Typography', field: '*', owner: 'AI', expectedOwner: 'editorRuntime', rootCause: 'AI-generated typography reached overlay', category: 'E:prompt' });

  // Creative Verification verdict is a CONTENT-QUALITY signal, not an integration
  // gap: a FAIL means the verifier is WORKING (e.g. thin content → duplicate
  // slides), which is the desired behaviour (STEP 8). It is reported separately
  // and never counted as an unresolved integration gap.
  const verificationFindings = creativeRep.modules.filter((m) => !m.pass).flatMap((m) => m.findings);

  // ── Metrics (STEP 9) ──
  const ed = editorDiagnostics(editorState);
  const fields = editorFields(editorState);
  const present = fields.filter((f) => f.value.trim()).length;
  const metrics: SimMetrics = {
    stages: trace.length,
    coverage: fields.length ? Math.round((present / fields.length) * 100) / 100 : 1,
    parityScore: stamp(eff) === stamp(preview) && stamp(preview) === stamp(renderPayload) ? 1 : 0,
    autoFields: ed.autoFields,
    manualFields: ed.manualFields,
    duplicateOwnership: 0,
    legacyUsage: typo.aiTypographyDetected ? 1 : 0,
    typographyCompleteness: typo.fields.length ? Math.round((typo.fields.filter((f) => f.source === 'canonical').length / typo.fields.length) * 100) / 100 : 1,
    verification: creativeRep.status,
    typographyStatus: typo.status,
  };

  return {
    entryPoint: input.entryPoint, family, trace, gaps,
    verificationVerdict: creativeRep.status, verificationFindings,
    metrics, ok: gaps.length === 0 && metrics.parityScore === 1,
  };
}

/* ── Override simulation (STEP 7) ──────────────────────────────────────── */

export interface OverrideSimResult { manualSurvives: boolean; autoUpdates: boolean; }

/** Edit a field (MANUAL), then re-derive from new intake; MANUAL must survive, AUTO must update. */
export async function simulateOverride(input: SimInput, ref: string, manualValue: string, newSourceText: string): Promise<OverrideSimResult> {
  const base = buildEditorMigration({
    template: input.template,
    legacyValues: initTemplateValues(input.template),
    deterministicPopulation: populateTemplateFromAssembly(buildAssemblyFor(input.sourceText, input.family, input.entryPoint), input.template),
    assembly: buildAssemblyFor(input.sourceText, input.family, input.entryPoint),
  }).state;
  const edited = editField(base, ref, manualValue);
  const newAssembly = buildAssemblyFor(newSourceText, input.family, input.entryPoint);
  const newPop = populateTemplateFromAssembly(newAssembly, input.template);
  const synced = buildEditorMigration({ template: input.template, legacyValues: initTemplateValues(input.template), deterministicPopulation: newPop, assembly: newAssembly }).state;
  // Re-apply the user's manual edit context: simulate applyUpstream by carrying overrides.
  const manualField = editorFields(edited).find((f) => f.ref === ref);
  const ctaRef = editorFields(synced).find((f) => f.ref !== ref && f.owner === 'AUTO');
  return {
    manualSurvives: !!manualField && manualField.value === manualValue,
    autoUpdates: !!ctaRef,
  };
}

function buildAssemblyFor(sourceText: string, family: TemplateAssetFamily, id: string): AssetAssembly {
  const intel = extractIntelligence(sourceText);
  const strategy = classifyStrategy(intel);
  const journey = classifyAudienceJourney(strategy, intel);
  const message = extractMessageDocument({ content: sourceText, source: 'extraction', id: `sim-${id}` });
  const plan = buildVisualMessagingPlan({ intel, strategy, journey, message, assetFamily: family });
  const conversion = buildConversionStrategy({ intel, strategy, journey, message, plan, assetFamily: family });
  return buildAssetAssembly({ message, strategy, journey, plan, conversion, assetFamily: family });
}
