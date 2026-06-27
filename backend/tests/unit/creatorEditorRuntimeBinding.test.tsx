/**
 * @jest-environment jsdom
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import { useCreatorEditorRuntime } from '../../../components/creator/useCreatorEditorRuntime';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';
import type { CreatorTemplatePopulation } from '../../../lib/creator-templates/templatePopulation';
import type { AssetAssembly } from '../../../lib/creator-templates/assetAssembly';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  'Get started free today. Sign up now.',
].join('\n');

const field = (key: string, required = false): TemplateField =>
  ({ key, label: key, control: 'text', required, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);
function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true), field('subheadline'), field('cta', true)],
    slides: family === 'carousel' ? { countOptions: [3, 4, 5, 6, 7, 8], defaultCount: 5, fields: [field('title', true), field('body')] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 1, max: 12, sectionLabel: 'Statistic', fields: [field('label', true), field('value')] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 2, formDefinition } as unknown as CreatorTemplate;
}
function build(family: TemplateAssetFamily = 'carousel'): { population: CreatorTemplatePopulation; assembly: AssetAssembly } {
  let p = createPackage('pkg-ui');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
  return { population, assembly };
}

// A minimal editor harness that binds ONLY to editorRuntime (no local content state).
function EditorHarness({ population, assembly }: { population: CreatorTemplatePopulation; assembly: AssetAssembly }) {
  const ed = useCreatorEditorRuntime(population, assembly);
  return (
    <div>
      {ed.fields.map((f) => (
        <div key={f.ref} data-testid={`row-${f.ref}`}>
          <input
            aria-label={f.ref}
            value={f.value}
            placeholder={f.placeholder}
            onChange={(e) => ed.edit(f.ref, e.target.value)}
          />
          <span data-testid={`owner-${f.ref}`}>{f.owner}</span>
          <button data-testid={`reset-${f.ref}`} onClick={() => ed.reset(f.ref)}>reset</button>
        </div>
      ))}
      <button data-testid="regenerate" onClick={() => ed.regenerate()}>regenerate</button>
      {/* Preview + render payload are pure projections of the SAME object. */}
      <div data-testid="preview-headline">{ed.preview.fields.headline ?? ''}</div>
      <div data-testid="render-headline">{ed.renderPayload.fields.headline ?? ''}</div>
      <div data-testid="manual-count">{ed.diagnostics.manualFields}</div>
      <div data-testid="parity">{String(ed.diagnostics.editorPreviewParity && ed.diagnostics.previewRendererParity)}</div>
      <div data-testid="summary-message">{ed.summary.messageFoundation}</div>
    </div>
  );
}

describe('Live editor binding — canonical field binding (CREATOR-026)', () => {
  it('renders canonical populated values, not placeholders', () => {
    const { population, assembly } = build('carousel');
    render(<EditorHarness population={population} assembly={assembly} />);
    const headline = screen.getByLabelText('field:headline') as HTMLInputElement;
    expect(headline.value).toBe('Boost activation by 92%');
    expect(headline.value).not.toBe('Add headline…');
    expect(screen.getByTestId('preview-headline').textContent).toBe('Boost activation by 92%');
    expect(screen.getByTestId('render-headline').textContent).toBe('Boost activation by 92%');
    expect(screen.getByTestId('summary-message').textContent).toBe('Boost activation by 92%');
  });

  it('typing edits editorRuntime → preview + render update with the SAME value (no duplicate state)', () => {
    const { population, assembly } = build('carousel');
    render(<EditorHarness population={population} assembly={assembly} />);
    const headline = screen.getByLabelText('field:headline') as HTMLInputElement;
    fireEvent.change(headline, { target: { value: 'Increase Revenue Using AI' } });
    expect((screen.getByLabelText('field:headline') as HTMLInputElement).value).toBe('Increase Revenue Using AI');
    expect(screen.getByTestId('preview-headline').textContent).toBe('Increase Revenue Using AI');
    expect(screen.getByTestId('render-headline').textContent).toBe('Increase Revenue Using AI');
    expect(screen.getByTestId('owner-field:headline').textContent).toBe('MANUAL');
    expect(screen.getByTestId('manual-count').textContent).toBe('1');
    expect(screen.getByTestId('parity').textContent).toBe('true');
  });

  it('Reset restores the canonical value and AUTO ownership', () => {
    const { population, assembly } = build('carousel');
    render(<EditorHarness population={population} assembly={assembly} />);
    const headline = () => screen.getByLabelText('field:headline') as HTMLInputElement;
    fireEvent.change(headline(), { target: { value: 'Manual headline' } });
    expect(screen.getByTestId('owner-field:headline').textContent).toBe('MANUAL');
    fireEvent.click(screen.getByTestId('reset-field:headline'));
    expect(headline().value).toBe('Boost activation by 92%');
    expect(screen.getByTestId('owner-field:headline').textContent).toBe('AUTO');
  });

  it('Regenerate clears all manual overrides', () => {
    const { population, assembly } = build('carousel');
    render(<EditorHarness population={population} assembly={assembly} />);
    fireEvent.change(screen.getByLabelText('field:headline') as HTMLInputElement, { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('field:cta') as HTMLInputElement, { target: { value: 'Y' } });
    expect(screen.getByTestId('manual-count').textContent).toBe('2');
    fireEvent.click(screen.getByTestId('regenerate'));
    expect(screen.getByTestId('manual-count').textContent).toBe('0');
    expect(screen.getByTestId('owner-field:headline').textContent).toBe('AUTO');
  });

  it('a placeholder is only present when the canonical value is empty', () => {
    const { population, assembly } = build('carousel');
    render(<EditorHarness population={population} assembly={assembly} />);
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    for (const input of inputs) {
      // If the field has a value, it shows the value — never the placeholder string as the value.
      if (input.value.trim().length > 0) expect(input.value).not.toBe(input.getAttribute('placeholder'));
    }
  });

  it('works for image / carousel / infographic editors', () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const { population, assembly } = build(fam);
      const { unmount } = render(<EditorHarness population={population} assembly={assembly} />);
      expect(screen.getByTestId('parity').textContent).toBe('true');
      expect((screen.getByLabelText('field:headline') as HTMLInputElement).value.length).toBeGreaterThan(0);
      unmount();
    }
  });
});
