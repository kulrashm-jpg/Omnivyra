/**
 * @jest-environment jsdom
 *
 * F3f: the activity workspace is VIEW-ONLY for Viewers / view-only users / Engagers.
 * - The AI suggestions panel is not rendered for them.
 * - The content and creator panels sit in a native <fieldset disabled>, which greys out
 *   every control inside them without editing those (billed-list) components. Master
 *   content shows expanded, since "expand" can't be pressed inside a disabled fieldset.
 * - Campaign discussion stays open for Engagers (server campaign_messages exception) and
 *   is disabled for Viewers.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { insideWriteGate } from '../helpers/writeGateScan';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const B = 'components/activity-workspace/ActivityWorkspaceBriefSection.tsx';
const V = 'components/ActivityWorkspaceView.tsx';
const C = 'components/activity-workspace/ActivityWorkspaceCommunityPanels.tsx';

describe('the mechanism: a control inside <fieldset disabled> cannot be used', () => {
  // Browsers never dispatch user clicks/keys to a disabled form control, and a control
  // inside <fieldset disabled> IS disabled (:disabled). jsdom/React do not emulate the
  // dispatch rule (a synthetic fireEvent still reaches onClick), so assert the guarantee
  // the browser enforces: the controls match :disabled and are not focusable.
  // Only FORM controls are covered: a div/link onClick inside would stay live. None exists
  // in the gated panels (scan with a positive control, see the F3f commit).
  it('buttons and fields inside are :disabled (and so unclickable in a browser)', () => {
    render(
      <fieldset disabled>
        <div><button type="button">Generate</button><textarea aria-label="body" /></div>
      </fieldset>,
    );
    const btn = screen.getByRole('button', { name: 'Generate' });
    expect(btn).toBeDisabled();
    expect(btn.matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('body')).toBeDisabled();
  });
  it('control: the same markup without disabled is enabled', () => {
    render(<fieldset><button type="button">Generate</button></fieldset>);
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });
});

describe('activity workspace wiring (F3f)', () => {
  it.each([B, V, C])('%s parses', (p) => {
    const out = ts.transpileModule(read(p), { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: p });
    expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });
  it('AI suggestions render only for writers', () => {
    expect(insideWriteGate(read(B), '<AISuggestionPanel\n')).toBe(true);
  });
  it('content + creator panels are inside a fieldset disabled for read-only roles', () => {
    const b = read(B);
    expect(b).toMatch(/<fieldset disabled=\{!canWriteThisCampaign\} data-testid="workspace-content-panels"[^>]*>\s*\{\/\*[^]*?\*\/\}\s*<WorkspaceContentPanels d=\{canWriteThisCampaign \? d : \{ \.\.\.d, masterContentExpanded: true \}\} \/>\s*<\/fieldset>/);
    expect(b).toMatch(/<fieldset disabled=\{!canWriteThisCampaign\} data-testid="workspace-creator-panel"[^>]*>\s*<CreatorContentPanel\b/);
    expect(read(V)).toMatch(/<fieldset disabled=\{!canWriteThisCampaign\} data-testid="workspace-creator-orchestrator"[^>]*>\s*<CreatorWorkspaceOrchestrator d=\{d\} \/>\s*<\/fieldset>/);
    expect(b).toMatch(/!canWriteThisCampaign && \(\s*<p data-testid="workspace-read-only-notice"[\s\S]{0,200}View only: \{ROLE_FORBIDDEN_MESSAGE\}/);
  });
  it('discussion: disabled unless the role may post campaign messages (Engagers may)', () => {
    const c = read(C);
    expect(c).toMatch(/const canPostMessages = canPostCampaignMessages\(useCompanyContext\(\)\.userRole\);/);
    expect(c).toMatch(/<fieldset disabled=\{!canPostMessages\} data-testid="workspace-discussion"[^>]*>\s*<ActivityDiscussionTab\b/);
  });
  it.each([B, V])('%s derives the flag from the shared rule and the real role', (p) => {
    expect(read(p)).toMatch(/const canWriteThisCampaign = canWriteCampaign\(useCompanyContext\(\)\.userRole\);/);
  });
});
