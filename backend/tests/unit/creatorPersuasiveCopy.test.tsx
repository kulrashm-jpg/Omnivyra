/**
 * @jest-environment jsdom
 */
/**
 * Persuasive, purpose-driven copy + refine it on the confirmation page
 * (owner request 2026-10-25).
 *
 * The live confirmation page showed the brief's INSTRUCTION ("Create an engaging
 * promotion for our AI-Driven Digital Marketing System.") as the headline, and a
 * button cut mid-word ("Discover your marketing clar" — the 31-char viewer action
 * sliced to the template CTA's 28-char limit in seedTemplateFromBrief).
 *
 * SECRETS: none. No network — field-assist runs with an injected fake LLM.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { getTemplateById } from '../../../lib/creator-templates';
import { initTemplateValues, type TemplateFieldValues } from '../../../lib/creator-templates/values';
import {
  goalCtaSuggestions, instructionSubject, isFittingCta, isInstructionLikeCopy, pickFittingCta,
} from '../../../lib/creator-content/creatorCopyPurpose';
import {
  buildBriefOverlayChips, copyEditorEntries, diffTemplateEdits, planCopyRewriteTargets,
  planTemplateFillTargets, seedOverlayFromBrief, seedTemplateFromBrief,
} from '../../../lib/creator-content/creatorContentFill';
import type { CreatorBrief } from '../../../lib/creator-content/creatorBrief';
import { mapBriefToEditorAnswers } from '../../../lib/creator-content/creatorWorkflowModel';
import {
  buildFieldAssistMessages, deterministicTransform, runCreatorFieldAssist, resolveTemplateField,
  type FieldAssistRequest,
} from '../../services/creator/creatorFieldAssistService';
import CreatorCopyEditor, { REWRITE_ALL_COPY_BUSY_KEY } from '../../../components/creator/CreatorCopyEditor';
import CreativeSummaryCard from '../../../components/creator/CreativeSummaryCard';
import type { TemplateAiAssistContext } from '../../../components/creator/TemplateFieldsPanel';

const imageTpl = getTemplateById('sys-image-headline-sub-cta')!; // headline(80) / subheadline(120) / cta(28)
const carouselTpl = getTemplateById('sys-carousel-educational-5')!;
const infographicTpl = getTemplateById('sys-infographic-statistics')!;

const INSTRUCTION = 'Create an engaging promotion for our AI-Driven Digital Marketing System.';
const LONG_CTA = 'Discover your marketing clarity'; // 31 chars > the image CTA's 28

const brief = (over: Partial<CreatorBrief> = {}): CreatorBrief => ({
  mainMessage: INSTRUCTION,
  body: `${INSTRUCTION} Transform marketing chaos into clarity with AI-driven insights.`,
  audience: 'Marketing leads', tone: 'Confident', cta: LONG_CTA, offer: '', objective: 'Promote an Offer',
  source: 'workspace', ...over,
});

describe('instruction-like detection', () => {
  it.each([
    INSTRUCTION,
    'Make a carousel about our onboarding flow',
    'Design an image for the spring sale',
    'Write the post announcing our new planner',
    'Generate 3 posts for the product launch',
    'Promote our new AI planner',
    'I want an image that shows our dashboard',
    'We need a banner for the webinar',
    'Please create a promotional infographic on churn',
  ])('treats "%s" as a TASK', (t) => {
    expect(isInstructionLikeCopy(t)).toBe(true);
  });

  it.each([
    'Plan a month of posts in an hour',
    'Launch your campaign in minutes',
    'Build a better pipeline this quarter',
    'Make the right thing the easy thing',
    'Transform marketing chaos into clarity',
    'Book a demo',
    '',
  ])('treats "%s" as COPY', (t) => {
    expect(isInstructionLikeCopy(t)).toBe(false);
  });

  it('extracts the subject the instruction is about', () => {
    expect(instructionSubject(INSTRUCTION)).toBe('AI-Driven Digital Marketing System');
    expect(instructionSubject('Promote our new AI planner')).toBe('new AI planner');
    expect(instructionSubject('Plan a month in an hour')).toBe('');
  });
});

describe('seeding — an instruction is never copy; a button is never cut', () => {
  it('does not seed the headline from an instruction-like main message, and plans it for the AI fill', () => {
    const values = initTemplateValues(imageTpl);
    const seed = seedTemplateFromBrief({ template: imageTpl, values, brief: brief(), edited: new Set(), imageCopyActive: true });
    expect(seed.values.fields.headline ?? '').not.toContain('Create an engaging');
    expect(String(seed.values.fields.headline ?? '')).toBe('');
    const targets = planTemplateFillTargets({ template: imageTpl, values: seed.values, edited: new Set(), imageCopyActive: true });
    expect(targets.map((t) => t.fieldKey)).toEqual(expect.arrayContaining(['headline', 'subheadline', 'cta']));
  });

  it('a non-instruction main message still seeds the headline (unchanged behaviour)', () => {
    const seed = seedTemplateFromBrief({
      template: imageTpl, values: initTemplateValues(imageTpl), brief: brief({ mainMessage: 'Plan a month of posts in an hour' }),
      edited: new Set(), imageCopyActive: true,
    });
    expect(seed.values.fields.headline).toBe('Plan a month of posts in an hour');
  });

  it('an instruction already sitting in the headline (older draft) is planned for rewrite', () => {
    const values = { ...initTemplateValues(imageTpl), fields: { headline: INSTRUCTION.replace(/\.$/, ''), subheadline: 'x', cta: 'Book a demo' } };
    const targets = planTemplateFillTargets({ template: imageTpl, values, edited: new Set(), imageCopyActive: true });
    expect(targets.map((t) => t.fieldKey)).toContain('headline');
  });

  it('"Discover your marketing clarity" is never cut to "Discover your marketing clar" (the root cause)', () => {
    const seed = seedTemplateFromBrief({
      template: imageTpl, values: initTemplateValues(imageTpl), brief: brief({ mainMessage: 'Plan a month in an hour' }),
      edited: new Set(), imageCopyActive: true,
    });
    // Too long for the 28-char button → not seeded at all (the AI fill writes a fitting one).
    expect(seed.values.fields.cta ?? '').not.toBe('Discover your marketing clar');
    expect(String(seed.values.fields.cta ?? '')).toBe('');
    // A CTA that fits is seeded whole.
    const fits = seedTemplateFromBrief({
      template: imageTpl, values: initTemplateValues(imageTpl), brief: brief({ mainMessage: 'Plan a month in an hour', cta: 'Book a demo' }),
      edited: new Set(), imageCopyActive: true,
    });
    expect(fits.values.fields.cta).toBe('Book a demo');
    // Overlay (42-char limit): fits → whole, never sliced.
    const overlay = seedOverlayFromBrief({ overlay: { hook: '', headline: '', keyInsight: '', cta: '', supportingText: '' } as never, brief: brief(), edited: new Set() });
    expect(overlay.cta).toBe(LONG_CTA);
    expect(overlay.headline).toBe(''); // instruction → no overlay headline seed
  });

  it('mapBriefToEditorAnswers keeps the brief as the key message but never as the headline', () => {
    const answers = mapBriefToEditorAnswers({ goalId: null, freeText: INSTRUCTION } as never, { fields: [{ id: 'keyMessage' }, { id: 'headline' }] } as never);
    expect(answers.keyMessage).toBe(INSTRUCTION);
    expect(answers.headline).toBeUndefined();
  });

  it('overlay chips never offer the instruction as a headline', () => {
    const chips = buildBriefOverlayChips(brief());
    for (const list of Object.values(chips)) for (const c of list) expect(isInstructionLikeCopy(c)).toBe(false);
  });
});

describe('field-assist — purpose-driven prompt and goal-appropriate fallback', () => {
  const ctaField = resolveTemplateField(imageTpl, 'flat', 'cta')!;
  const headlineField = resolveTemplateField(imageTpl, 'flat', 'headline')!;
  const request = (over: Partial<FieldAssistRequest> = {}): FieldAssistRequest => ({
    assetFamily: 'image', templateId: imageTpl.id, action: 'generate',
    targets: [{ scope: 'flat', fieldKey: 'headline' }, { scope: 'flat', fieldKey: 'cta' }],
    context: { objective: 'Generate leads', audience: 'Marketing leads', mainMessage: INSTRUCTION, cta: LONG_CTA, purposeKey: 'promotional-image' },
    ...over,
  });

  it('the prompt carries the persuasion + CTA rules, the goal, and treats the instruction as a brief', () => {
    const req = request();
    const msgs = buildFieldAssistMessages(imageTpl, req, req.targets.map((t) => ({ target: t, field: resolveTemplateField(imageTpl, t.scope, t.fieldKey)! })));
    const all = msgs.map((m) => m.content).join('\n');
    expect(all).toContain('PERSUASIVE, PURPOSE-DRIVEN COPY');
    expect(all).toContain('2–4 words');
    expect(all).toContain('"Book a demo"');
    expect(all).toContain('hook → value → proof → CTA');
    expect(all).toContain('Objective: Generate leads');
    expect(all).toContain('is an INSTRUCTION to you');
    expect(all).toContain('Subject to write about: AI-Driven Digital Marketing System');
    expect(all).not.toContain(`MAIN MESSAGE (the key): ${INSTRUCTION}`);
    expect(all).toContain('Goal-appropriate button ideas: Shop now');
  });

  it('a copy main message keeps the "main message is the key" rule', () => {
    const req = request({ context: { mainMessage: 'Plan a month in an hour', objective: 'Launch a product' } });
    const all = buildFieldAssistMessages(imageTpl, req, [{ target: req.targets[0], field: headlineField }]).map((m) => m.content).join('\n');
    expect(all).toContain('MAIN MESSAGE (the key): Plan a month in an hour');
    expect(all).not.toContain('is an INSTRUCTION to you');
  });

  it('fallback CTA is goal-appropriate, fits whole and is never cut mid-word', () => {
    const fromStrategy = deterministicTransform('generate', ctaField, '', { cta: LONG_CTA, purposeKey: 'promotional-image', assetFamilyHint: 'image' });
    expect(fromStrategy).toBe('Shop now');
    const fromGoal = deterministicTransform('generate', ctaField, '', { cta: LONG_CTA, objective: 'Generate leads' });
    expect(fromGoal).toBe('Book a demo');
    const event = deterministicTransform('generate', ctaField, '', { objective: 'Promote an Event' });
    expect(event).toBe('Reserve your seat');
    const fits = deterministicTransform('generate', ctaField, '', { cta: 'Start free', objective: 'Generate leads' });
    expect(fits).toBe('Start free');
    for (const v of [fromStrategy, fromGoal, event, fits]) {
      expect(v.length).toBeLessThanOrEqual(28);
      expect(isFittingCta(v, 28)).toBe(true);
    }
    // Improving an over-long button writes a fitting one instead of cutting it.
    expect(deterministicTransform('improve', ctaField, LONG_CTA, { objective: 'Generate leads' })).toBe('Book a demo');
  });

  it('fallback headline never echoes the instruction', () => {
    const v = deterministicTransform('generate', headlineField, '', { mainMessage: INSTRUCTION, sourceContent: INSTRUCTION });
    expect(isInstructionLikeCopy(v)).toBe(false);
    expect(v).toBe('AI-Driven Digital Marketing System');
  });

  it('an instruction returned by the LLM is replaced, never shipped as copy', async () => {
    const llm = async () => JSON.stringify({ updates: [
      { scope: 'flat', field_key: 'headline', value: 'Create an engaging promotion for our system' },
      { scope: 'flat', field_key: 'cta', value: 'Book a demo' },
    ] });
    const out = await runCreatorFieldAssist({ template: imageTpl, request: request(), llm });
    const byKey = Object.fromEntries(out.updates.map((u) => [u.fieldKey, u.value]));
    expect(isInstructionLikeCopy(byKey.headline)).toBe(false);
    expect(byKey.cta).toBe('Book a demo');
  });

  it('goal CTA helpers', () => {
    expect(goalCtaSuggestions('Promote an Offer')[0]).toBe('Get the offer');
    expect(goalCtaSuggestions('Launch a product')[0]).toBe('Try it free');
    expect(goalCtaSuggestions('Brand awareness')[0]).toBe('See how it works');
    expect(pickFittingCta([LONG_CTA, 'Have you experienced this?', 'Claim 30% off'], 28)).toBe('Claim 30% off');
  });
});

describe('confirmation page — "Your copy" editor', () => {
  function Harness(props: { template: typeof imageTpl; initial: TemplateFieldValues; onAi: jest.Mock; imageCopyActive?: boolean }) {
    const [values, setValues] = React.useState(props.initial);
    const [edited, setEdited] = React.useState<ReadonlySet<string>>(new Set());
    const onChange = (next: TemplateFieldValues) => {
      setEdited((prev) => new Set([...prev, ...diffTemplateEdits(values, next)]));
      setValues(next);
    };
    return (
      <>
        <CreatorCopyEditor
          template={props.template} values={values} onChange={onChange} onAiAssist={props.onAi}
          aiBusyKey={null} editedKeys={edited} imageCopyActive={props.imageCopyActive ?? true}
        />
        <CreativeSummaryCard
          templateName="T" choices={{ visualDirectionId: null, subject: null, visualInstruction: null }}
          headline={values.fields.headline || null} subheadline={values.fields.subheadline || null} cta={values.fields.cta || null}
        />
        <pre data-testid="payload">{JSON.stringify(values.fields)}</pre>
      </>
    );
  }
  const imageValues = (): TemplateFieldValues => ({
    ...initTemplateValues(imageTpl),
    fields: { headline: 'Turn marketing chaos into clarity', subheadline: 'One AI system for every channel', cta: 'Book a demo' },
  });

  it('shows editable headline, subheadline and button with AI improve; edits reach the summary + payload', () => {
    const onAi = jest.fn();
    render(<Harness template={imageTpl} initial={imageValues()} onAi={onAi} />);
    expect(screen.getByTestId('creator-copy-editor')).toHaveTextContent('Your copy');
    const editor = within(screen.getByTestId('creator-copy-editor'));
    expect(editor.getByText('Headline')).toBeInTheDocument();
    expect(editor.getByText('Subheadline')).toBeInTheDocument();
    expect(editor.getByText('Button text')).toBeInTheDocument();
    const cta = screen.getByTestId('copy-flat--cta') as HTMLInputElement;
    expect(cta.maxLength).toBe(28);
    fireEvent.change(screen.getByTestId('copy-flat--headline'), { target: { value: 'Clarity for every campaign' } });
    fireEvent.change(cta, { target: { value: 'Get the offer' } });
    expect(screen.getByText('“Clarity for every campaign”')).toBeInTheDocument();
    expect(screen.getByText('“Get the offer”')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('payload').textContent || '{}')).toMatchObject({ headline: 'Clarity for every campaign', cta: 'Get the offer' });

    fireEvent.click(screen.getByTestId('copy-flat--subheadline-improve'));
    const call = onAi.mock.calls[0][0] as TemplateAiAssistContext;
    expect(call.action).toBe('improve');
    expect(call.busyKey).toBe('improve:flat::subheadline');
    expect(call.targets).toEqual([{ scope: 'flat', fieldKey: 'subheadline', index: undefined, currentValue: 'One AI system for every channel' }]);
  });

  it('"Rewrite all copy with AI" keeps edited fields unless asked to include them', () => {
    const onAi = jest.fn();
    render(<Harness template={imageTpl} initial={imageValues()} onAi={onAi} />);
    fireEvent.change(screen.getByTestId('copy-flat--headline'), { target: { value: 'My own headline' } });
    fireEvent.click(screen.getByTestId('copy-rewrite-all'));
    const first = onAi.mock.calls[0][0] as TemplateAiAssistContext;
    expect(first.busyKey).toBe(REWRITE_ALL_COPY_BUSY_KEY);
    expect(first.targets.map((t) => t.fieldKey)).toEqual(['subheadline', 'cta']);
    fireEvent.click(screen.getByTestId('copy-rewrite-all-including-edits'));
    const second = onAi.mock.calls[1][0] as TemplateAiAssistContext;
    expect(second.targets.map((t) => t.fieldKey)).toEqual(['headline', 'subheadline', 'cta']);
  });

  it('Post + Image: no on-image copy fields, a plain note instead', () => {
    render(<Harness template={imageTpl} initial={imageValues()} onAi={jest.fn()} imageCopyActive={false} />);
    expect(screen.getByTestId('creator-copy-editor')).toHaveTextContent('Post + Image');
    expect(screen.queryByTestId('copy-flat--headline')).toBeNull();
  });

  it('carousel lists every slide\'s fields; infographic every section\'s', () => {
    const cv = initTemplateValues(carouselTpl);
    const ce = copyEditorEntries(carouselTpl, cv, true);
    expect(ce.filter((e) => e.scope === 'slide').length).toBe((cv.slides?.length ?? 0) * (carouselTpl.formDefinition.slides?.fields.filter((f) => f.aiAssist.generate).length ?? 0));
    expect(ce.filter((e) => e.scope === 'slide').length).toBeGreaterThan(0);
    const iv = initTemplateValues(infographicTpl);
    expect(copyEditorEntries(infographicTpl, iv, true).some((e) => e.scope === 'section')).toBe(true);
    render(<Harness template={carouselTpl} initial={cv} onAi={jest.fn()} />);
    expect(screen.getByText('Slide 1')).toBeInTheDocument();
    const plan = planCopyRewriteTargets({ template: carouselTpl, values: cv, edited: new Set(), imageCopyActive: true });
    expect(plan.every((t) => t.scope !== 'section')).toBe(true);
  });

  it('the confirm view mounts the copy editor above the summary; exactly one TemplateFieldsPanel', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../components/creator/workflow/CreatorFormColumn.tsx'), 'utf8');
    expect(src).toMatch(/confirmMode && effectiveTemplate \? \(\s*<div className="mt-6">\s*<CreatorCopyEditor/);
    expect(src.indexOf('<CreatorCopyEditor')).toBeLessThan(src.indexOf('<CreativeSummaryCard'));
    expect(src.match(/<TemplateFieldsPanel\b/g)?.length).toBe(1);
    expect(src).toContain('onAiAssist={handleTemplateAiAssist}');
  });
});
