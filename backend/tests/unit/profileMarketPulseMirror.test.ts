/**
 * UI step 6.4a: company-profile ↔ Market Pulse mirror rules (approved plan S3/S6, 05
 * PASS, 55's conditions). Includes 05's must-mirror / must-not-mirror cases and the
 * "no non-empty value dropped" property over the profile stores.
 */
import {
  MARKET_PULSE_AI_CAP,
  dedupe,
  mirrorBlockReason,
  unionOfferings,
  buildMirror,
  mirrorStatusFor,
  growthPrioritiesView,
  mergeMarketPulseForSave,
} from '../../../utils/profileMarketPulseMirror';

describe('shape filter (55 condition 1, 05 point 2)', () => {
  it.each(["Dr. Smith's practice management", 'Series A–C advisory, U.S. only', 'weekends incl. holidays', 'Custom AI model fine-tuning, evaluation and deployment for regulated industries'])(
    'must mirror: %s',
    (item) => expect(mirrorBlockReason(item)).toBeNull(),
  );
  it('a pasted paragraph is never mirrored', () => {
    expect(mirrorBlockReason('We grow clinics. We hire fast. We win.')).toBe('paragraph'); // short but multi-sentence
    expect(mirrorBlockReason('We help clinics grow. Our team has 20 years of experience. We work across the EU.')).not.toBeNull(); // long paragraph
    expect(mirrorBlockReason('Line one\nLine two')).toBe('paragraph');
    expect(mirrorBlockReason('x'.repeat(81))).toBe('too_long');
  });
});

describe('S3 offerings: one list from three stores', () => {
  it('unions profile list, core_offerings and split(text), case-insensitively', () => {
    expect(unionOfferings(['CRM setup', 'Audits'], ['audits', 'Training'], 'CRM setup, Support')).toEqual(['CRM setup', 'Audits', 'Training', 'Support']);
  });
  it('PROPERTY: no non-empty value from any profile store is dropped', () => {
    const list = ['A', 'B'];
    const core = ['C', 'b'];
    const text = 'D; E';
    const union = unionOfferings(list, core, text).map((x) => x.toLowerCase());
    for (const v of [...list, ...core, 'D', 'E']) expect(union).toContain(v.toLowerCase());
  });
});

describe('mirror order and cap (55 condition 2)', () => {
  it('existing Market Pulse entries come FIRST, then new profile items, de-duped', () => {
    const { mirror } = buildMirror(['Existing 1', 'Existing 2'], ['New 1', 'existing 1', 'New 2']);
    expect(mirror).toEqual(['Existing 1', 'Existing 2', 'New 1', 'New 2']);
  });
  it('held-back items are reported, never silently dropped', () => {
    const para = 'Para one here. Second sentence. Third One.';
    const { mirror, heldBack } = buildMirror([], ['Short', para]);
    expect(mirror).toEqual(['Short']);
    expect(heldBack).toEqual([{ item: para, reason: 'paragraph' }]);
  });
  it('status: first 8 are sent to the AI, the rest are used for scoring only', () => {
    const existing = Array.from({ length: 8 }, (_, i) => `MP ${i + 1}`);
    const { mirror } = buildMirror(existing, ['User added']);
    expect(MARKET_PULSE_AI_CAP).toBe(8);
    expect(mirrorStatusFor('MP 1', mirror)).toBe('sent_to_ai');
    expect(mirrorStatusFor('User added', mirror)).toBe('scoring_only');
    expect(mirrorStatusFor('x'.repeat(90), mirror)).toBe('too_long');
  });
});

describe('S6 growth priorities (55 condition 3)', () => {
  it('the text stays a string; Market-Pulse-only items are surfaced, not hidden', () => {
    const v = growthPrioritiesView('EU expansion, Partnerships', ['eu expansion', 'Hiring']);
    expect(typeof v.text).toBe('string');
    expect(v.marketPulseOnly).toEqual(['Hiring']);
  });
});

describe('read-then-merge market_pulse (D6)', () => {
  it('starts from the STORED object (re-read at save) and overlays only the changes; siblings survive', () => {
    const stored = { core_offerings: ['Old'], competitor_details: [{ name: 'X' }], market_alternatives: [{ name: 'Y' }], default_categories: ['a'] };
    const merged = mergeMarketPulseForSave(stored, { core_offerings: ['Old', 'New'] });
    expect(merged).toEqual({ ...stored, core_offerings: ['Old', 'New'] });
    expect(mergeMarketPulseForSave(null, { growth_priorities: ['A'] })).toEqual({ growth_priorities: ['A'] });
  });
});

it('dedupe keeps the first spelling and drops blanks', () => {
  expect(dedupe([' A ', 'a', '', 'B'])).toEqual(['A', 'B']);
});

import { prepareMarketPulseForSave } from '../../../utils/profileMarketPulseMirror';

describe('prepareMarketPulseForSave (6.4b: re-read at save, overlay only user changes)', () => {
  const loaded = { core_offerings: ['Audits'], growth_priorities: ['EU'], default_categories: ['a'], competitor_details: [{ name: 'X' }] };

  it('a value written since load (stored ≠ loaded) is NOT reverted by the stale form copy', () => {
    const stored = { ...loaded, default_categories: ['a', 'b-added-by-refine'], market_alternatives: [{ name: 'New' }] };
    const client = { ...loaded }; // the user didn't touch market_pulse
    const { marketPulse } = prepareMarketPulseForSave({ stored, loaded, client, productsServicesList: ['Audits'], growthPrioritiesText: 'EU' });
    expect(marketPulse.default_categories).toEqual(['a', 'b-added-by-refine']);
    expect(marketPulse.market_alternatives).toEqual([{ name: 'New' }]);
    expect(marketPulse.competitor_details).toEqual([{ name: 'X' }]);
  });

  it("the user's own edits ARE applied", () => {
    const client = { ...loaded, default_categories: ['user-set'] };
    const { marketPulse } = prepareMarketPulseForSave({ stored: loaded, loaded, client, productsServicesList: [], growthPrioritiesText: '' });
    expect(marketPulse.default_categories).toEqual(['user-set']);
  });

  it('mirrors: fresh stored MP entries first, then new profile items; paragraphs held back', () => {
    const stored = { ...loaded, core_offerings: ['Audits', 'Training (added since load)'] };
    const r = prepareMarketPulseForSave({
      stored, loaded, client: loaded,
      productsServicesList: ['Audits', 'CRM setup', 'We grow clinics. We hire fast. We win.'],
      growthPrioritiesText: 'EU, Hiring',
    });
    expect(r.marketPulse.core_offerings).toEqual(['Audits', 'Training (added since load)', 'CRM setup']);
    expect(r.heldBack.coreOfferings.map((h) => h.reason)).toEqual(['paragraph']);
    expect(r.marketPulse.growth_priorities).toEqual(['EU', 'Hiring']);
  });

  it('works with nothing stored yet (first save)', () => {
    const r = prepareMarketPulseForSave({ stored: null, loaded: null, client: null, productsServicesList: ['A'], growthPrioritiesText: 'G' });
    expect(r.marketPulse).toEqual({ core_offerings: ['A'], growth_priorities: ['G'] });
  });
});

describe('saveProfile wiring (6.4b)', () => {
  const hook = require('fs').readFileSync(require('path').join(process.cwd(), 'hooks/useCompanyProfileState.tsx'), 'utf8') as string;
  it('re-reads market_pulse from the server before building the payload', () => {
    const save = hook.slice(hook.indexOf('const saveProfile = async'));
    const reread = save.indexOf("fetchWithAuth(`/api/company-profile?companyId=${encodeURIComponent(companyId)}`)");
    const post = save.indexOf("fetchWithAuth('/api/company-profile', {");
    expect(reread).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(reread);
    expect(save.slice(0, post)).toMatch(/prepareMarketPulseForSave\(\{/);
    expect(save.slice(0, post)).toMatch(/report_settings: \{ \.\.\.\(source\.report_settings \?\? \{\}\), market_pulse: marketPulseForSave \}/);
  });
});
