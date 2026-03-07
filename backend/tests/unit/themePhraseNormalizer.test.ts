/**
 * Unit tests for Theme Phrase Normalizer
 */
import { normalizeThemePhrase } from '../../services/themePhraseNormalizer';

describe('themePhraseNormalizer', () => {
  it('removes "Marketing with AI-Driven Marketing"', () => {
    const input = 'The Future of Marketing with AI-Driven Marketing';
    const output = normalizeThemePhrase(input);
    expect(output).toBe('The Future of AI-Driven Marketing');
  });

  it('removes "Using X in Marketing"', () => {
    const input = 'A Practical Approach to Using AI Marketing in Marketing';
    const output = normalizeThemePhrase(input);
    expect(output).toBe('A Practical Approach to Using AI Marketing');
  });

  it('removes duplicate domain words', () => {
    expect(normalizeThemePhrase('content content strategy')).toBe('content strategy');
    expect(normalizeThemePhrase('The marketing marketing revolution')).toBe('The marketing revolution');
    expect(normalizeThemePhrase('strategy strategy for growth')).toBe('strategy for growth');
  });

  it('leaves normal phrases unchanged', () => {
    const input = 'How AI Marketing Is Transforming Campaign Execution';
    const output = normalizeThemePhrase(input);
    expect(output).toBe(input);
  });

  it('handles empty and invalid input', () => {
    expect(normalizeThemePhrase('')).toBe('');
    expect(normalizeThemePhrase('   ')).toBe('');
  });

  it('is deterministic', () => {
    const input = 'The Future of Marketing with AI-Powered Marketing';
    expect(normalizeThemePhrase(input)).toBe(normalizeThemePhrase(input));
  });
});
