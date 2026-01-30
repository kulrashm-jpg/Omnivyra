export type OmniVyraContractValidation = {
  valid: boolean;
  errors: string[];
};

export const validateOmniVyraEnvelope = (response: any): OmniVyraContractValidation => {
  const errors: string[] = [];
  if (!response || typeof response !== 'object') {
    return { valid: false, errors: ['response must be an object'] };
  }

  if (!response.decision_id || typeof response.decision_id !== 'string') {
    errors.push('decision_id missing or invalid');
  }

  if (typeof response.confidence !== 'number' || Number.isNaN(response.confidence)) {
    errors.push('confidence missing or invalid');
  } else if (response.confidence < 0 || response.confidence > 1) {
    errors.push('confidence out of range');
  }

  if (!response.contract_version || typeof response.contract_version !== 'string') {
    errors.push('contract_version missing or invalid');
  } else if (!response.contract_version.startsWith('v')) {
    errors.push('contract_version must start with "v"');
  }

  if (!response.explanation || typeof response.explanation !== 'string' || !response.explanation.trim()) {
    errors.push('explanation missing or invalid');
  }

  if (!Array.isArray(response.placeholders)) {
    errors.push('placeholders must be an array');
  }

  if (typeof response.data === 'undefined') {
    errors.push('data missing');
  }

  return { valid: errors.length === 0, errors };
};
