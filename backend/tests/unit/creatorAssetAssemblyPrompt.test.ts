import * as fs from 'fs';
import * as path from 'path';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import {
  buildPromptFromAssembly, validateAssemblyPrompt, summarizeAssemblyPrompt,
} from '../../../lib/creator-templates/assetAssemblyPrompt';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. Sign up now.',
].join('\n');

function specFor(family: 'image' | 'carousel' | 'infographic' = 'carousel') {
  let p = createPackage('pkg-p');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  const asm = packageAssetAssembly(p, family);
  return { asm, spec: buildPromptFromAssembly(asm) };
}

describe('Asset Assembly Prompt — deterministic translation', () => {
  it('same AssetAssembly → byte-identical prompt specification', () => {
    expect(JSON.stringify(specFor().spec)).toBe(JSON.stringify(specFor().spec));
  });

  it('every planner is represented exactly once (one section each)', () => {
    const { spec } = specFor();
    expect(spec.systemInstructions.length).toBeGreaterThan(0);          // Communication + Journey + Conversion
    expect(spec.communicationInstructions.length).toBeGreaterThan(0);   // Communication
    expect(spec.messageInstructions.mainMessage).toBe('Boost activation by 92%'); // Message Foundation
    expect(spec.storyInstructions.sequence.length).toBeGreaterThan(0);  // Story Blueprint × Visual units
    expect(spec.conversionInstructions.goal).toBeTruthy();              // Conversion
    expect(spec.visualInstructions.length).toBe(spec.storyInstructions.sequence.length); // Visual Messaging
    // The section keys are fixed → no duplicate sections.
    expect(Object.keys(spec).sort()).toEqual(['communicationInstructions', 'constraints', 'conversionInstructions', 'coverage', 'messageInstructions', 'outputContract', 'storyInstructions', 'systemInstructions', 'visualInstructions'].sort());
  });

  it('message content comes exactly from the assembly (no regeneration)', () => {
    const { asm, spec } = specFor();
    expect(spec.messageInstructions.mainMessage).toBe('Boost activation by 92%');
    // Every message string must trace back to an assembly field — proof of no regeneration.
    const assemblyText = JSON.stringify(asm.assets) + asm.message.mainMessage + asm.message.summary;
    const all = [...spec.messageInstructions.statistics, ...spec.messageInstructions.quotes, ...spec.messageInstructions.examples, ...spec.messageInstructions.benefits, ...spec.messageInstructions.supportingMessages];
    for (const s of all) expect(assemblyText.includes(s)).toBe(true);
  });

  it('contains NO rendering data (no colors/fonts/coords/pixels/template ids)', () => {
    const blob = JSON.stringify(specFor().spec).toLowerCase();
    for (const f of ['#', 'rgb', 'hex', 'px', 'font', 'pixel', 'coordinate', 'template_id', 'templateid', 'color']) {
      expect(blob.includes(f)).toBe(false);
    }
  });

  it('reads ONLY the AssetAssembly — no upstream planner imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/creator-templates/assetAssemblyPrompt.ts'), 'utf8');
    for (const planner of ['communicationStrategy', 'audienceJourney', 'visualMessagingPlan', 'conversionStrategy', 'contentIntelligence', 'storyBlueprint', 'messageFoundation', 'contentPackage']) {
      expect(src.includes(`from './${planner}'`)).toBe(false);
    }
    expect(src.includes("from './assetAssembly'")).toBe(true);
  });
});

describe('Asset Assembly Prompt — validation, coverage, summary', () => {
  it('validation passes + coverage is complete', () => {
    const { spec } = specFor();
    const v = validateAssemblyPrompt(spec);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(Object.values(spec.coverage).every(Boolean)).toBe(true);
  });

  it('output contract adapts per family', () => {
    expect(buildPromptFromAssembly(specFor('carousel').asm).outputContract.requiredFields).toContain('slides[].title');
    expect(buildPromptFromAssembly(specFor('infographic').asm).outputContract.requiredFields).toContain('sections[].label');
    expect(buildPromptFromAssembly(specFor('image').asm).outputContract.requiredFields).toContain('headline');
  });

  it('summary is deterministic + reports coverage', () => {
    const { spec } = specFor();
    const s = summarizeAssemblyPrompt(spec);
    expect(s.story).toBeTruthy();
    expect(s.conversion).toBeTruthy();
    expect(s.visualPlan.length).toBeGreaterThan(0);
    expect(s.coverageComplete).toBe(true);
    expect(JSON.stringify(summarizeAssemblyPrompt(spec))).toBe(JSON.stringify(s));
  });
});
