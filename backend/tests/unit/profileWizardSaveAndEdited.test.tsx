/**
 * @jest-environment jsdom
 *
 * UI step 6.5: Save on every step ("Save & continue" when editing) + "Edited by you"
 * from 55's provenance (user_locked_fields, report_settings.field_edited_at).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { editedFieldsForStep } from '../../../components/company/profileWizard/wizardSteps';
import { WizardStepNav, StepEditedNotice } from '../../../components/company/profileWizard/WizardStepper';

describe('editedFieldsForStep', () => {
  const profile = {
    user_locked_fields: ['pricing_model', 'target_audience', 'growth_priorities'],
    report_settings: { field_edited_at: { pricing_model: '2026-11-10T09:00:00Z' } },
  };
  it('lists only this step\'s user-edited fields, with when (if known)', () => {
    expect(editedFieldsForStep('offering', profile)).toEqual([
      { field: 'pricing_model', label: 'Pricing model', editedAt: '2026-11-10T09:00:00Z' },
    ]);
    expect(editedFieldsForStep('audience', profile).map((f) => f.field)).toEqual(['target_audience']);
    expect(editedFieldsForStep('goals', profile).map((f) => f.field)).toEqual(['growth_priorities']);
  });
  it('works before provenance exists (nothing listed)', () => {
    expect(editedFieldsForStep('offering', {})).toEqual([]);
    expect(editedFieldsForStep('review', profile)).toEqual([]);
    expect(editedFieldsForStep('offering', null)).toEqual([]);
  });
});

describe('StepEditedNotice', () => {
  it('names the edited fields and reassures that AI refresh keeps them', () => {
    render(<StepEditedNotice fields={[{ field: 'pricing_model', label: 'Pricing model', editedAt: null }]} />);
    expect(screen.getByTestId('step-edited-notice')).toHaveTextContent('Edited by you: Pricing model. AI refresh keeps your edits.');
  });
  it('renders nothing when no field was edited', () => {
    const { container } = render(<StepEditedNotice fields={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('WizardStepNav: Save & continue', () => {
  it('when editing: saves first, moves on only if the save succeeded', async () => {
    const onSelect = jest.fn();
    const onSave = jest.fn().mockResolvedValue(true);
    render(<WizardStepNav current="offering" onSelect={onSelect} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue: Who you serve' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('audience'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
  it('a failed save keeps the user on the step', async () => {
    const onSelect = jest.fn();
    const onSave = jest.fn().mockResolvedValue(false);
    render(<WizardStepNav current="offering" onSelect={onSelect} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue: Who you serve' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('not editing: plain Next, no save', () => {
    const onSelect = jest.fn();
    render(<WizardStepNav current="offering" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next: Who you serve' }));
    expect(onSelect).toHaveBeenCalledWith('audience');
  });
});
