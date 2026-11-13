/**
 * Product ruling (via e9, 2026-11-13): a user's MANUAL edit is never overwritten by AI refine or by OLDER approved
 * guidance. D4: approved strategic guidance re-wrote value/positioning edits on every refine. D5: refine re-wrote a
 * user's Market Pulse solution_domains from the AI classification.
 *
 * Unit-level on the pure helpers (backend/services/companyProfile/fieldProvenance.ts) + the REAL
 * applyApprovedStrategicGuidance, plus wiring scans that pin the save path and refine to those helpers.
 */
import fs from 'fs';
import path from 'path';
import {
  valuesDiffer, guidanceMayOverwrite, computeEditStamps, shouldLockMarketPulseDomains, resolveRefinedSolutionDomains,
  MARKET_PULSE_SOLUTION_DOMAINS_LOCK,
} from '../../services/companyProfile/fieldProvenance';
import { applyApprovedStrategicGuidance, normalizeUserGuidedIntelligence } from '../../services/companyProfile/userGuidance';

const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-05T10:00:00.000Z';

describe('valuesDiffer compares by CONTENT (e1 D2 reuses it)', () => {
  it('same content, different reference -> not different (re-saving an unchanged list does not re-stamp)', () => {
    expect(valuesDiffer(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(valuesDiffer({ x: 1, y: [1, 2] }, { y: [1, 2], x: 1 })).toBe(false);
    expect(valuesDiffer('  Acme ', 'Acme')).toBe(false);
  });
  it('all empties are equal; empty vs value differs; a real change differs', () => {
    expect(valuesDiffer(null, '')).toBe(false);
    expect(valuesDiffer([], undefined)).toBe(false);
    expect(valuesDiffer({}, null)).toBe(false);
    expect(valuesDiffer(null, 'x')).toBe(true);
    expect(valuesDiffer(['a'], ['a', 'b'])).toBe(true);
    expect(valuesDiffer(['a', 'b'], ['b', 'a'])).toBe(true); // order is content for lists
  });
  it('05: empty ELEMENTS / empty object values are not content (a blank row added then removed is not an edit)', () => {
    expect(valuesDiffer(['a', ''], ['a'])).toBe(false);
    expect(valuesDiffer(['a', '  '], ['a'])).toBe(false);
    expect(valuesDiffer([undefined], [])).toBe(false);
    expect(valuesDiffer([null, ''], null)).toBe(false);
    expect(valuesDiffer({ a: 1, b: '' }, { a: 1 })).toBe(false);
    expect(valuesDiffer({ a: '' }, null)).toBe(false);
    expect(valuesDiffer(['a', ''], ['a', 'b'])).toBe(true);
  });
});

describe('guidanceMayOverwrite', () => {
  it('unlocked field -> guidance may fill it (empty / AI-sourced)', () => {
    expect(guidanceMayOverwrite('brand_positioning', T0, [], {})).toBe(true);
  });
  it('locked + guidance NEWER than the manual edit -> applies (approval is user intent too)', () => {
    expect(guidanceMayOverwrite('brand_positioning', T1, ['brand_positioning'], { brand_positioning: T0 })).toBe(true);
  });
  it('locked + guidance OLDER than (or same as) the edit -> never overwrites', () => {
    expect(guidanceMayOverwrite('brand_positioning', T0, ['brand_positioning'], { brand_positioning: T1 })).toBe(false);
    expect(guidanceMayOverwrite('brand_positioning', T0, ['brand_positioning'], { brand_positioning: T0 })).toBe(false);
  });
  it('legacy lock with no edit time, or no guidance time -> the manual edit wins', () => {
    expect(guidanceMayOverwrite('brand_positioning', T1, ['brand_positioning'], {})).toBe(false);
    expect(guidanceMayOverwrite('brand_positioning', null, ['brand_positioning'], { brand_positioning: T0 })).toBe(false);
  });
});

describe('computeEditStamps: only a real content change is stamped', () => {
  const prev = { key_messages: 'old', pricing_model: 'sub' } as Record<string, unknown>;
  const next = { key_messages: 'NEW', pricing_model: 'sub' } as Record<string, unknown>;
  it('changed field stamped now; unchanged keeps its earlier stamp; changed=true', () => {
    const r = computeEditStamps({ lockedKeysThisSave: ['key_messages', 'pricing_model'], next: (k) => next[k], prev: (k) => prev[k], prevEditedAt: { pricing_model: T0 }, nowIso: T1 });
    expect(r).toEqual({ editedAt: { key_messages: T1, pricing_model: T0 }, changed: true });
  });
  it('nothing changed -> no stamp written', () => {
    const r = computeEditStamps({ lockedKeysThisSave: ['pricing_model'], next: (k) => prev[k], prev: (k) => prev[k], prevEditedAt: null, nowIso: T1 });
    expect(r.changed).toBe(false);
    expect(r.editedAt).toEqual({});
  });
});

describe('Market Pulse solution_domains (D5)', () => {
  it('a USER save that changes them (emptying included) locks them; AI saves / unchanged do not', () => {
    expect(shouldLockMarketPulseDomains('user', ['Payments'], ['Lending'])).toBe(true);
    expect(shouldLockMarketPulseDomains('ai_refined', ['Payments'], ['Lending'])).toBe(false);
    expect(shouldLockMarketPulseDomains('user', ['Payments'], ['Payments'])).toBe(false);
    expect(shouldLockMarketPulseDomains('user', [], ['Payments'])).toBe(true); // 05: deliberately emptying IS an edit
    expect(shouldLockMarketPulseDomains('user', [], [])).toBe(false);
    expect(shouldLockMarketPulseDomains('user', [], undefined)).toBe(false);
  });
  it('refine keeps a user-locked value (an emptied one too); refreshes an unlocked (AI-sourced) or absent one', () => {
    const locked = new Set([MARKET_PULSE_SOLUTION_DOMAINS_LOCK]);
    expect(resolveRefinedSolutionDomains(locked, ['User domain'], ['AI domain'])).toEqual(['User domain']);
    expect(resolveRefinedSolutionDomains(new Set(), ['Old AI domain'], ['AI domain'])).toEqual(['AI domain']);
    expect(resolveRefinedSolutionDomains(locked, [], ['AI domain'])).toEqual([]); // 05: an emptied, locked list stays empty
    expect(resolveRefinedSolutionDomains(locked, undefined, ['AI domain'])).toEqual(['AI domain']);
    expect(resolveRefinedSolutionDomains(new Set(), [], ['AI domain'])).toEqual(['AI domain']);
  });
});

describe('applyApprovedStrategicGuidance (D4, real function)', () => {
  const profile = (overrides: Record<string, unknown>) => ({
    company_id: 'c1',
    brand_positioning: 'USER positioning',
    user_locked_fields: ['brand_positioning'],
    report_settings: {
      field_edited_at: { brand_positioning: T1 },
      user_guidance: { messaging: { positioning: { status: 'approved', approved_value: 'GUIDANCE positioning', updated_at: T0 } } },
    },
    ...overrides,
  }) as any;

  it('CRITICAL: a manual edit made AFTER the guidance approval survives', () => {
    expect(applyApprovedStrategicGuidance(profile({})).brand_positioning).toBe('USER positioning');
  });
  it('guidance approved AFTER the manual edit applies', () => {
    const p = profile({});
    p.report_settings.user_guidance.messaging.positioning.updated_at = '2026-11-09T00:00:00.000Z';
    expect(applyApprovedStrategicGuidance(p).brand_positioning).toBe('GUIDANCE positioning');
  });
  it('a legacy lock without an edit time keeps the user value', () => {
    const p = profile({});
    p.report_settings.field_edited_at = {};
    expect(applyApprovedStrategicGuidance(p).brand_positioning).toBe('USER positioning');
  });
  it('CONTROL: an unlocked field still receives approved guidance', () => {
    expect(applyApprovedStrategicGuidance(profile({ user_locked_fields: [] })).brand_positioning).toBe('GUIDANCE positioning');
  });
});

describe('guidance updated_at is SERVER-authoritative (05: the precedence clock is load-bearing)', () => {
  const NOW = new Date('2026-11-13T12:00:00.000Z');
  const section = (o: Record<string, unknown>) => ({ messaging: { positioning: { status: 'approved', approved_value: 'P1', ...o } } });
  it('a client-supplied (forward-dated) updated_at is ignored on a new approval', () => {
    const out = normalizeUserGuidedIntelligence(section({ updated_at: '2099-01-01T00:00:00.000Z' }), { previous: null, now: NOW });
    expect(out?.messaging?.positioning?.updated_at).toBe(NOW.toISOString());
  });
  it('an unchanged approval keeps its STORED time, whatever the client sends', () => {
    const previous = section({ updated_at: T0 }) as any;
    const out = normalizeUserGuidedIntelligence(section({ updated_at: '2099-01-01T00:00:00.000Z' }), { previous, now: NOW });
    expect(out?.messaging?.positioning?.updated_at).toBe(T0);
  });
  it('a changed approval (new approved_value) is stamped now; an ai_value-only change is not', () => {
    const previous = section({ updated_at: T0, ai_value: 'A1' }) as any;
    expect(normalizeUserGuidedIntelligence(section({ approved_value: 'P2', updated_at: T0 }), { previous, now: NOW })?.messaging?.positioning?.updated_at).toBe(NOW.toISOString());
    expect(normalizeUserGuidedIntelligence(section({ ai_value: 'A2', updated_at: T0 }), { previous, now: NOW })?.messaging?.positioning?.updated_at).toBe(T0);
  });
});

describe('wiring: the save path and refine use the provenance helpers', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../services', rel), 'utf8');
  it('saveProfile stamps field_edited_at from computeEditStamps and locks domains via shouldLockMarketPulseDomains', () => {
    const src = read('companyProfileServiceRest1Rest2Pulse.ts');
    const block = src.slice(src.indexOf('const lockedSet = new Set<string>(Array.isArray(existing?.user_locked_fields)'), src.indexOf('upsertCompanyProfilePayload(', src.indexOf('const lockedSet')));
    expect(block).toMatch(/shouldLockMarketPulseDomains\(source, nextDomains, prevDomains\)/);
    expect(block).toMatch(/computeEditStamps\(\{/);
    expect(block).toMatch(/field_edited_at: stamps\.editedAt/);
  });
  it('refine writes solution_domains through resolveRefinedSolutionDomains (never the raw AI level_3)', () => {
    const src = read('companyProfileServiceRest1Rest2Competitors.ts');
    expect(src).toMatch(/solution_domains: resolveRefinedSolutionDomains\(\s*locked,/);
    expect(src).not.toMatch(/solution_domains: businessClassification\.business_classification\.level_3,/);
  });
});
