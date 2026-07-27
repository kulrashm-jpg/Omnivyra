import {
  DEFAULT_STATE_MODEL,
  validateTransition,
  allowedTransitions,
  isTerminalState,
  isKnownState,
  type StateModelConfig,
} from '../../../lib/operations/operationalStateModel';

describe('LC-201 operational state model', () => {
  it('allows any known state as the first transition (no prior state)', () => {
    expect(validateTransition(null, 'new').ok).toBe(true);
    expect(validateTransition(undefined, 'qualified').ok).toBe(true);
    expect(validateTransition('', 'working').ok).toBe(true);
  });

  it('rejects an unknown target state', () => {
    const r = validateTransition('new', 'bogus');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_to');
  });

  it('enforces the transition graph', () => {
    expect(validateTransition('new', 'qualified').ok).toBe(true);
    expect(validateTransition('new', 'proposal').ok).toBe(false); // not adjacent
    expect(validateTransition('proposal', 'won').ok).toBe(true);
    expect(validateTransition('qualified', 'won').ok).toBe(false);
  });

  it('rejects a no-op transition', () => {
    expect(validateTransition('working', 'working').reason).toBe('same_state');
  });

  it('identifies terminal states and their limited exits', () => {
    expect(isTerminalState('won')).toBe(true);
    expect(isTerminalState('working')).toBe(false);
    expect(allowedTransitions('won')).toEqual(['archived']);
    expect(validateTransition('archived', 'working').ok).toBe(true); // re-open allowed
  });

  it('is configurable (no hardcoded business logic)', () => {
    const custom: StateModelConfig = {
      states: ['open', 'closed'],
      initial: 'open',
      terminal: ['closed'],
      transitions: { open: ['closed'], closed: [] },
    };
    expect(isKnownState('working', custom)).toBe(false);
    expect(validateTransition('open', 'closed', custom).ok).toBe(true);
    expect(validateTransition('closed', 'open', custom).ok).toBe(false);
  });
});
