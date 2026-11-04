/**
 * SC-7 draft — every legacy label maps somewhere, and nowhere governance.
 *
 * Totality is checked against each producer's OWN source of truth (its exported
 * constant, its exported type's values, or — where nothing is exported — the
 * literals in its source file), so a new legacy label added later fails here.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CLASSIFICATION_CATEGORIES } from '../../services/conversationTriageService';
import { ruleBasedAnalysis } from '../../services/engagementConversationIntelligenceService';
import {
  INTELLIGENCE_INTENTS,
  INTELLIGENCE_INTENT_TO_CANONICAL,
  LEAD_DETECTION_INTENTS,
  LEAD_INTENT_TO_CANONICAL,
  POLICY_INTENT_TO_CANONICAL,
  TRIAGE_CATEGORY_TO_CANONICAL,
  mapLegacyLabel,
  type LegacyMappingEntry,
} from '../../services/engagementClassification/legacyMappings';
import {
  CANONICAL_CLASSIFICATION_CODES,
  CLASSIFICATION_VOCABULARY,
  GOVERNANCE_CLASSIFICATION_CODES,
  isGovernanceClassificationCode,
} from '../../services/engagementClassification/vocabulary';

const ROOT = join(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function assertTotalAndNonGovernance(keys: readonly string[], table: Readonly<Record<string, LegacyMappingEntry>>) {
  expect(keys.length).toBeGreaterThan(0);
  expect(Object.keys(table).sort()).toEqual([...keys].sort());
  for (const k of keys) {
    const e = table[k];
    expect(CANONICAL_CLASSIFICATION_CODES).toContain(e.code);
    expect(isGovernanceClassificationCode(e.code)).toBe(false);
    expect(['exact', 'approximate', 'none']).toContain(e.fit);
    if (e.fit === 'none') expect(e.code).toBe('ambiguous');
  }
}

describe('vocabulary', () => {
  it('has exactly the 16 SC-7 draft codes, each with a description and a governance flag', () => {
    expect([...CANONICAL_CLASSIFICATION_CODES].sort()).toEqual(
      [
        'positive_interest', 'enquiry', 'information_request', 'pricing', 'meeting_request', 'objection',
        'not_interested', 'follow_up', 'complaint', 'support_request', 'unsubscribe', 'stop',
        'wrong_recipient', 'out_of_office', 'spam_suspicious', 'ambiguous',
      ].sort(),
    );
    expect(Object.keys(CLASSIFICATION_VOCABULARY).sort()).toEqual([...CANONICAL_CLASSIFICATION_CODES].sort());
    for (const code of CANONICAL_CLASSIFICATION_CODES) {
      const e = CLASSIFICATION_VOCABULARY[code];
      expect(e.code).toBe(code);
      expect(e.description.length).toBeGreaterThan(10);
      expect(typeof e.governance).toBe('boolean');
    }
  });

  it('governance: true for exactly stop, unsubscribe, complaint', () => {
    const gov = CANONICAL_CLASSIFICATION_CODES.filter((c) => CLASSIFICATION_VOCABULARY[c].governance);
    expect(gov.sort()).toEqual(['complaint', 'stop', 'unsubscribe']);
    expect([...GOVERNANCE_CLASSIFICATION_CODES].sort()).toEqual(gov.sort());
  });
});

describe('mapping tables are total and never target governance', () => {
  it('triage: every CLASSIFICATION_CATEGORIES value', () => {
    assertTotalAndNonGovernance(CLASSIFICATION_CATEGORIES, TRIAGE_CATEGORY_TO_CANONICAL);
  });

  it('response policy: every MessageIntent literal in responsePolicyEngine.ts', () => {
    const typeBlock = /export type MessageIntent =([\s\S]*?);/.exec(src('backend/services/responsePolicyEngine.ts'))?.[1] ?? '';
    const intents = [...typeBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(intents).toHaveLength(11);
    assertTotalAndNonGovernance(intents, POLICY_INTENT_TO_CANONICAL);
  });

  it('conversation intelligence: every intent literal the service can assign', () => {
    const service = src('backend/services/engagementConversationIntelligenceService.ts');
    const assigned = new Set(
      [...service.matchAll(/intent = (?:result\.intent \?\? )?'([a-z_]+)'/g)].map((m) => m[1]),
    );
    expect(assigned.size).toBeGreaterThan(0);
    for (const a of assigned) expect(INTELLIGENCE_INTENTS).toContain(a);
    assertTotalAndNonGovernance(INTELLIGENCE_INTENTS, INTELLIGENCE_INTENT_TO_CANONICAL);
  });

  it('conversation intelligence: ruleBasedAnalysis only ever emits mapped intents', () => {
    const samples = ['interested in a demo', 'how does it work?', 'this is a problem', 'nice post', '', 'meh'];
    for (const s of samples) {
      for (const score of [null, -0.9, 0, 0.9]) {
        expect(INTELLIGENCE_INTENTS).toContain(ruleBasedAnalysis(s, score).intent);
      }
    }
  });

  it('lead detection: every lead_intent literal in leadDetectionService.ts', () => {
    const service = src('backend/services/leadDetectionService.ts');
    const fromPatterns = [...service.matchAll(/intent: '([a-z_]+)'/g)].map((m) => m[1]);
    const validBlock = /VALID_LEAD_INTENTS = new Set\(\[([\s\S]*?)\]\)/.exec(service)?.[1] ?? '';
    const fromValid = [...validBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const produced = new Set([...fromPatterns, ...fromValid, 'lead_interest']);
    expect(produced.size).toBeGreaterThan(5);
    for (const p of produced) expect(LEAD_DETECTION_INTENTS).toContain(p);
    assertTotalAndNonGovernance(LEAD_DETECTION_INTENTS, LEAD_INTENT_TO_CANONICAL);
  });

  it('only a legacy complaint label carries a governance candidate, and it is complaint', () => {
    const tables = [TRIAGE_CATEGORY_TO_CANONICAL, INTELLIGENCE_INTENT_TO_CANONICAL, POLICY_INTENT_TO_CANONICAL, LEAD_INTENT_TO_CANONICAL];
    const withCandidate = tables.flatMap((t) => Object.entries(t).filter(([, e]) => e.governanceCandidate));
    expect(withCandidate.map(([k, e]) => [k, e.governanceCandidate])).toEqual([
      ['complaint', 'complaint'],
      ['complaint', 'complaint'],
    ]);
  });

  it('unknown, empty and governance-looking labels map to ambiguous', () => {
    for (const source of ['triage_category', 'intelligence_intent', 'policy_intent', 'lead_intent'] as const) {
      for (const raw of [null, undefined, '', 'nonsense', 'stop', 'unsubscribe', '__proto__', 'constructor']) {
        expect(mapLegacyLabel(source, raw)).toEqual({ code: 'ambiguous', fit: 'none' });
      }
    }
  });

  it('labels are matched case- and whitespace-insensitively', () => {
    expect(mapLegacyLabel('policy_intent', '  Price_Inquiry ').code).toBe('pricing');
  });
});
