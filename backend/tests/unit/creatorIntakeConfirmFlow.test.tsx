/**
 * @jest-environment jsdom
 */
/**
 * PR3 — every input on the intake screen; the editor confirms instead of asking again.
 *
 * Owner decision (2026-10-24): the main message, the layout, text inside vs alongside the
 * image, brand mode/presence and the logo are chosen on the FIRST screen ("Tell us once");
 * the editor opens as "here's what we'll make" with Edit and Generate. A Writer "Add asset"
 * launch keeps its session all the way to the editor (it was dropped by the workspace).
 *
 * SECRETS: none. Session storage and navigation are in-memory; no network.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('../../../components/CompanyContext', () => ({ useCompanyContext: () => ({ selectedCompanyId: 'co-1' }) }));
jest.mock('../../../components/ChatVoiceButton', () => () => null);
jest.mock('../../../components/creator/CreateWithAIChat', () => () => null);
jest.mock('../../../components/creator/CreatorImageAssetPanel', () => (props: { compositionId: string }) => (
  <div data-testid="image-panel" data-composition={props.compositionId} />
));
const SAMPLE = {
  id: 'sys-curated-lifestyle-image', name: 'Lifestyle', category: 'social', description: '',
  metadata: { sourceBlueprintId: 'lifestyle-bp' }, assetSlots: [],
  renderingContract: { attachmentMode: 'embedded_copy', purposeKey: 'promo' },
};
jest.mock('../../../components/creator/SampleGallery', () => ({
  SampleGallery: (props: { onUse: (s: unknown) => void }) => (
    <button type="button" onClick={() => props.onUse(SAMPLE)}>use-sample</button>
  ),
}));
jest.mock('../../../components/creator/GuidedCreativeSteps', () => ({
  VisualDirectionStep: (props: { onContinue: () => void }) => <button type="button" onClick={props.onContinue}>look-continue</button>,
  SubjectStep: () => null,
}));

import { ImageCreationWorkspace } from '../../../components/creator/AssetCreationWorkspace';
import {
  CREATOR_INTAKE_SESSION_KEY, intakeToEditorRestore, readCreatorIntake,
} from '../../../lib/creator-content/creatorIntake';
import { MARKETING_BRIEF_SESSION_KEY, readMarketingBrief } from '../../../lib/content/marketingBriefResolver';
import { resolveCreatorBriefFromWorkspace } from '../../../lib/creator-content/creatorBrief';
import { mapBriefToEditorAnswers } from '../../../lib/creator-content/creatorWorkflowModel';
import { WORKFLOW_CONFIG } from '../../../lib/creator-content/creatorWorkflowConfig';
import { buildCreativeSummaryRows } from '../../../components/creator/CreativeSummaryCard';

const toBrief = async () => {
  fireEvent.click(screen.getByText('My own idea'));
  fireEvent.click(screen.getByText('use-sample'));
  fireEvent.click(screen.getByText('look-continue'));
  await screen.findByTestId('intake-main-message');
};
const query = (url: string) => new URL(url, 'http://x').searchParams;

beforeEach(() => { window.sessionStorage.clear(); });

describe('intake screen — every choice is made here and handed to the editor', () => {
  it('collects main message, text placement, layout and brand, and hands them over', async () => {
    const onNavigate = jest.fn();
    render(<ImageCreationWorkspace onNavigate={onNavigate} />);
    await toBrief();

    fireEvent.change(screen.getByTestId('intake-main-message'), { target: { value: 'Plan a month of posts in an hour' } });
    fireEvent.click(screen.getByTestId('intake-attachment-supporting_visual'));
    fireEvent.click(screen.getByTestId('intake-layout-portrait'));
    fireEvent.click(screen.getByTestId('intake-presence-strong'));
    fireEvent.click(screen.getByTestId('intake-include-logo'));
    // The image panel belongs to the same draft the editor will open.
    const panelDraft = screen.getByTestId('image-panel').getAttribute('data-composition');
    expect(panelDraft).toBeTruthy();

    fireEvent.click(screen.getByText(/Review what we/));
    const url = String(onNavigate.mock.calls[0][0]);
    const q = query(url);
    expect(url.startsWith('/command-center/creator-content/image?')).toBe(true);
    expect(q.get('template_id')).toBe(SAMPLE.id);
    expect(q.get('blueprint')).toBe('lifestyle-bp');
    expect(q.get('from')).toBe('workspace');
    expect(q.get('composition')).toBe(panelDraft);

    const intake = readCreatorIntake(window.sessionStorage.getItem(CREATOR_INTAKE_SESSION_KEY));
    expect(intake).toEqual({
      attachmentMode: 'supporting_visual', brandMode: 'brand-aware', brandPresence: 'strong', includeLogo: false, layout: 'portrait',
    });
    const brief = readMarketingBrief(window.sessionStorage.getItem(MARKETING_BRIEF_SESSION_KEY));
    expect(brief?.mainMessage).toBe('Plan a month of posts in an hour');
  });

  it('defaults "where does the text go" to the chosen design\'s own treatment', async () => {
    render(<ImageCreationWorkspace onNavigate={jest.fn()} />);
    await toBrief();
    expect(screen.getByTestId('intake-attachment-embedded_copy')).toHaveTextContent('Text inside the image');
    fireEvent.click(screen.getByText(/Review what we/));
    expect(readCreatorIntake(window.sessionStorage.getItem(CREATOR_INTAKE_SESSION_KEY))?.attachmentMode).toBe('embedded_copy');
  });

  it('a Writer "Add asset" launch keeps its session through to the editor', () => {
    const onNavigate = jest.fn();
    render(<ImageCreationWorkspace onNavigate={onNavigate} launchQuery={{ source: 'writer', session: 'tok-1', skip_blueprint: '1' }} />);
    fireEvent.click(screen.getByText('My own idea'));
    fireEvent.click(screen.getByText('use-sample'));
    fireEvent.click(screen.getByText('look-continue'));
    const q = query(String(onNavigate.mock.calls[0][0]));
    expect(q.get('source')).toBe('writer');
    expect(q.get('session')).toBe('tok-1');
    expect(q.get('skip_blueprint')).toBe('1');
    // The writer content is the brief: no workspace draft replaces it.
    expect(q.get('from')).toBeNull();
    expect(q.get('composition')).toBeNull();
  });
});

describe('editor restore — the intake becomes the editor\'s starting state', () => {
  const imageConfig = WORKFLOW_CONFIG.image ?? null;

  it('maps a valid intake onto the existing draft slot', () => {
    expect(intakeToEditorRestore({
      attachmentMode: 'embedded_copy', brandMode: 'brand-aware', brandPresence: 'minimal', includeLogo: false, layout: 'landscape',
    }, imageConfig)).toEqual({
      answers: { layout: 'landscape' },
      standaloneAttachmentMode: 'embedded_copy',
      brandMode: 'brand-aware',
      brandPresence: 'minimal',
      brandSelections: expect.objectContaining({ logo: false }),
    });
  });

  it('ignores a layout the asset does not offer, and malformed intake', () => {
    expect(intakeToEditorRestore({ attachmentMode: null, brandMode: null, brandPresence: null, includeLogo: null, layout: 'not-a-layout' }, imageConfig)).toBeNull();
    expect(readCreatorIntake('{not json')).toBeNull();
    expect(readCreatorIntake(JSON.stringify({ attachmentMode: 'bogus', brandMode: 'x' }))).toEqual({
      attachmentMode: null, brandMode: null, brandPresence: null, includeLogo: null, layout: null,
    });
  });

  it('an explicitly stated main message wins over one derived from the brief', () => {
    const brief = { goalId: null, freeText: 'Our planner drafts every post. It also schedules them.', mainMessage: 'Plan a month in an hour' };
    expect(resolveCreatorBriefFromWorkspace(brief)?.mainMessage).toBe('Plan a month in an hour');
    const answers = mapBriefToEditorAnswers(brief, { fields: [{ id: 'keyMessage' }, { id: 'headline' }] } as never);
    expect(answers.keyMessage).toBe('Plan a month in an hour');
  });
});

describe('confirmation summary — states every decision that will be generated', () => {
  it('shows main message, text placement, layout and brand presence', () => {
    const rows = buildCreativeSummaryRows({
      templateName: 'Lifestyle', goalLabel: 'Launch a product', choices: { visualDirectionId: null, subject: null, visualInstruction: null },
      mainMessage: 'Plan a month in an hour', textPlacement: 'alongside', layoutLabel: 'Portrait',
      brandAware: true, brandPresence: 'strong', includeLogo: false,
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel['Main message']).toBe('“Plan a month in an hour”');
    expect(byLabel.Text).toBe('With the post — the image has no words');
    expect(byLabel.Layout).toBe('Portrait');
    expect(byLabel.Brand).toBe('Your brand colours (no logo), strong presence');
  });

  it('says plainly when the brand is not applied', () => {
    const rows = buildCreativeSummaryRows({ templateName: 'X', choices: { visualDirectionId: null, subject: null, visualInstruction: null }, brandAware: false });
    expect(rows.find((r) => r.label === 'Brand')?.value).toBe('Not applied');
  });
});
