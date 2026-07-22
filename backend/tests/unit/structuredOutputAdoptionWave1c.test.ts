/**
 * WAVE-1C-001 — structured-output adoption tests. Proves the shared wrapper
 * composes the ONE canonical parser (parseStructured) with graceful failure,
 * typed AiError, and observability — replacing raw JSON.parse(model.output).
 */
import { parseModelOutput, parseModelOutputOr, PARSER_VERSION } from '../../services/ai/safety';

describe('WAVE-1C-001 — structured output adoption', () => {
  it('parses valid JSON', () => {
    const r = parseModelOutput<{ a: number }>('{"a":1}', { surface: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.a).toBe(1);
  });
  it('parses fenced + markdown-wrapped JSON', () => {
    const r = parseModelOutput('prose\n```json\n{"a":2}\n```\nmore', { surface: 't' });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as any).a).toBe(2);
  });
  it('malformed JSON → typed AiError, no throw', () => {
    const r = parseModelOutput('not json at all', { surface: 't' });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error.code).toBe('VALIDATION_BAD_OUTPUT'); expect(r.error.category).toBe('validation'); }
  });
  it('partial/truncated JSON → typed AiError', () => {
    const r = parseModelOutput('{"a":1, "b":', { surface: 't' });
    expect(r.ok).toBe(false);
  });
  it('schema mismatch → VALIDATION_REJECTED', () => {
    const r = parseModelOutput('{"a":1}', { surface: 't', validate: (v): v is { b: number } => typeof (v as any)?.b === 'number' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_REJECTED');
  });
  it('empty output → typed failure (no throw)', () => {
    expect(parseModelOutput('', { surface: 't' }).ok).toBe(false);
    expect(parseModelOutput(null, { surface: 't' }).ok).toBe(false);
  });
  it('parseModelOutputOr degrades to fallback for the gateway-ops pattern', () => {
    expect(parseModelOutputOr('garbage', { fallback: true }, { surface: 't' })).toEqual({ fallback: true });
    expect(parseModelOutputOr<any>('{"x":5}', {}, { surface: 't' }).x).toBe(5);
  });
  it('parser version is exposed for version-aware consumers', () => {
    expect(PARSER_VERSION).toBe('1.0.0');
  });
  it('never throws on any provider formatting difference', () => {
    for (const s of ['', '  ', 'null', '[]', '{}', '```', 'Sure! {"ok":1}', '{bad}', '<xml/>']) {
      expect(() => parseModelOutputOr<any>(s, {}, { surface: 't' })).not.toThrow();
    }
  });
});
