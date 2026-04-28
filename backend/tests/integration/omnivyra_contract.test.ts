import { validateOmnivyraEnvelope } from '../../services/omnivyraContractService';

describe('Omnivyra contract validation', () => {
  it('accepts valid envelope', () => {
    const result = validateOmnivyraEnvelope({
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
    const result = validateOmnivyraEnvelope({ decision_id: 'abc' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid confidence range', () => {
    const result = validateOmnivyraEnvelope({
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
    const result = validateOmnivyraEnvelope({
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
