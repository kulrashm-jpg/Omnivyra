import { validateOmniVyraEnvelope } from '../../services/omnivyraContractService';

describe('OmniVyra contract validation', () => {
  it('accepts valid envelope', () => {
    const result = validateOmniVyraEnvelope({
      decision_id: 'abc',
      confidence: 0.9,
      placeholders: [],
      explanation: 'ok',
      contract_version: 'v1',
      data: {},
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('rejects missing fields', () => {
    const result = validateOmniVyraEnvelope({ decision_id: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid confidence range', () => {
    const result = validateOmniVyraEnvelope({
      decision_id: 'abc',
      confidence: 2,
      placeholders: [],
      explanation: 'ok',
      contract_version: 'v1',
      data: {},
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('confidence');
  });

  it('rejects version mismatch', () => {
    const result = validateOmniVyraEnvelope({
      decision_id: 'abc',
      confidence: 0.8,
      placeholders: [],
      explanation: 'ok',
      contract_version: '1',
      data: {},
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('contract_version');
  });
});
