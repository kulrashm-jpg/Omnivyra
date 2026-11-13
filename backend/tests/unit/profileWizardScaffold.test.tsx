/**
 * @jest-environment jsdom
 *
 * UI step 6.1: company-profile wizard scaffolding (approved plan: merge the screens,
 * not the columns). Order: Basics → Sources & AI fill → Offering → Audience → Voice →
 * Problem → Goals → Advanced → Review.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { WIZARD_STEPS, nextStepId, previousStepId, stepIndex } from '../../../components/company/profileWizard/wizardSteps';
import { WizardStepper, WizardStepNav } from '../../../components/company/profileWizard/WizardStepper';

describe('wizard step model', () => {
  it('has the approved 9 steps in a logical order', () => {
    expect(WIZARD_STEPS.map((s) => s.id)).toEqual([
      'basics', 'sources', 'offering', 'audience', 'voice', 'problem', 'goals', 'advanced', 'review',
    ]);
    expect(new Set(WIZARD_STEPS.map((s) => s.id)).size).toBe(9);
    for (const s of WIZARD_STEPS) {
      expect(s.title.trim()).not.toBe('');
      expect(s.hint.trim()).not.toBe('');
    }
  });

  it('next / previous walk the order and stop at the ends', () => {
    expect(nextStepId('basics')).toBe('sources');
    expect(previousStepId('sources')).toBe('basics');
    expect(previousStepId('basics')).toBeNull();
    expect(nextStepId('review')).toBeNull();
    expect(stepIndex('goals')).toBe(6);
  });
});

describe('WizardStepper / WizardStepNav', () => {
  it('shows "Step n of 9 · title", marks the current step, and selecting a step calls back', () => {
    const onSelect = jest.fn();
    render(<WizardStepper current="offering" onSelect={onSelect} />);
    expect(screen.getByText('Step 3 of 9 · What you offer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3. What you offer' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '7. Goals' }));
    expect(onSelect).toHaveBeenCalledWith('goals');
  });

  it('Back/Next move one step; Back is hidden on the first step, Next absent on the last', () => {
    const onSelect = jest.fn();
    const { rerender } = render(<WizardStepNav current="audience" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next: Voice & messaging' }));
    expect(onSelect).toHaveBeenLastCalledWith('voice');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSelect).toHaveBeenLastCalledWith('offering');
    rerender(<WizardStepNav current="basics" onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    rerender(<WizardStepNav current="review" onSelect={onSelect} />);
    expect(screen.queryByRole('button', { name: /^Next/ })).not.toBeInTheDocument();
  });
});

describe('wired into the company-profile form', () => {
  const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8') as string;
  it('the controller owns the step state and exposes it', () => {
    const c = read('components/companyProfileFormController.tsx');
    expect(c).toMatch(/const \[wizardStep, setWizardStep\] = React\.useState<WizardStepId>\('basics'\)/);
    expect(c).toMatch(/return \{\s*wizardStep, setWizardStep, isWizardStep,/);
  });
  it('the stepper shows only once the profile exists (onboarding pre-refine unchanged)', () => {
    const m = read('components/companyProfileFormMain.tsx');
    expect(m).toMatch(/\{showOnboardingContinuation && <WizardStepper current=\{wizardStep\} onSelect=\{setWizardStep\} \/>\}/);
  });
});
