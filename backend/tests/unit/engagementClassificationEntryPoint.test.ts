/**
 * SC-7 draft — the single entry point. Governance runs first and is authoritative:
 * a classifier may add labels, never remove or replace a governance class.
 */

import {
  classifyMessage,
  ruleBasedIntelligenceClassifier,
  type ExistingClassifier,
} from '../../services/engagementClassification/classifyMessage';
import { GOVERNANCE_CLASSIFICATION_CODES } from '../../services/engagementClassification/vocabulary';

const saysPositive: ExistingClassifier = jest.fn(async () => [{ source: 'canonical' as const, value: 'positive_interest' }]);

describe('AI output cannot override a governance class', () => {
  it('a classifier saying positive_interest on a STOP message keeps stop as the class', async () => {
    const r = await classifyMessage({ text: 'STOP', channel: 'whatsapp' }, { classifiers: [saysPositive] });
    expect(saysPositive).toHaveBeenCalled();
    expect(r.code).toBe('stop');
    expect(r.governance).toEqual(['stop']);
    expect(r.labels).toEqual(['stop', 'positive_interest']);
  });

  it.each([
    ['UNSUBSCRIBE', 'email', 'unsubscribe'],
    ['This is spam. How did you get my email?', 'email', 'complaint'],
    ['stop texting me', 'sms', 'stop'],
  ])('%p (%s): every legacy label at once still cannot displace %s', async (text, channel, code) => {
    const r = await classifyMessage(
      {
        text,
        channel,
        legacy: { leadIntent: 'demo_request', policyIntent: 'lead_interest', intelligenceIntent: 'lead', triageCategory: 'question_request' },
      },
      { classifiers: [saysPositive] },
    );
    expect(r.code).toBe(code);
    expect(r.governance[0]).toBe(code);
    expect(r.labels[0]).toBe(code);
  });

  it('a classifier that suggests a governance class does NOT make it governance (candidate only)', async () => {
    const saysStop: ExistingClassifier = () => [{ source: 'canonical', value: 'stop' }];
    const r = await classifyMessage({ text: 'Sounds great, send me the deck' }, { classifiers: [saysStop] });
    expect(r.governance).toEqual([]);
    expect(r.labels).not.toContain('stop');
    expect(r.governanceCandidates).toEqual(['stop']);
  });

  it('a legacy "complaint" intent is support_request plus a complaint CANDIDATE, never governance', async () => {
    const r = await classifyMessage({ text: 'The export is not working', legacy: { policyIntent: 'complaint' } }, { classifiers: [] });
    expect(r.governance).toEqual([]);
    expect(r.code).toBe('support_request');
    expect(r.governanceCandidates).toEqual(['complaint']);
  });

  it('a candidate already confirmed by the detector is not repeated as a candidate', async () => {
    const r = await classifyMessage({ text: 'This is spam', legacy: { policyIntent: 'complaint' } }, { classifiers: [] });
    expect(r.governance).toEqual(['complaint']);
    expect(r.governanceCandidates).toEqual([]);
  });

  it('a throwing classifier cannot lose a governance class', async () => {
    const boom: ExistingClassifier = () => {
      throw new Error('model down');
    };
    const r = await classifyMessage({ text: 'Remove me from your list' }, { classifiers: [boom] });
    expect(r.code).toBe('unsubscribe');
    expect(r.classifierErrors).toBe(1);
  });

  it('no output of any injected classifier can put a governance code in labels when the detector found none', async () => {
    const all: ExistingClassifier = () =>
      GOVERNANCE_CLASSIFICATION_CODES.flatMap((c) => [
        { source: 'canonical' as const, value: c },
        { source: 'policy_intent' as const, value: c },
        { source: 'intelligence_intent' as const, value: c },
        { source: 'triage_category' as const, value: c },
        { source: 'lead_intent' as const, value: c },
      ]);
    const r = await classifyMessage({ text: 'hello there' }, { classifiers: [all] });
    for (const g of GOVERNANCE_CLASSIFICATION_CODES) expect(r.labels).not.toContain(g);
    expect(r.governance).toEqual([]);
  });
});

describe('non-governance classification through the existing classifiers', () => {
  it('default classifier is the existing rule-based pass (no AI): a pricing question -> positive_interest', async () => {
    const r = await classifyMessage({ text: 'What is your pricing?' });
    expect(r.sources).toEqual([{ source: 'intelligence_intent', value: 'lead', code: 'positive_interest', fit: 'approximate' }]);
    expect(r.code).toBe('positive_interest');
  });

  it('the most specific stored label wins the primary class; the rest are kept as labels', async () => {
    const r = await classifyMessage(
      { text: 'Can we book a demo?', legacy: { leadIntent: 'demo_request', triageCategory: 'question_request' } },
      { classifiers: [ruleBasedIntelligenceClassifier] },
    );
    expect(r.code).toBe('meeting_request');
    expect(r.labels).toEqual(['meeting_request', 'positive_interest', 'information_request']);
  });

  it('nothing determinable -> ambiguous', async () => {
    const r = await classifyMessage({ text: 'ok' });
    expect(r.code).toBe('ambiguous');
    expect(r.labels).toEqual(['ambiguous']);
  });

  it('governance and classifier labels coexist: an opt-out that mentions pricing keeps both, governance first', async () => {
    const r = await classifyMessage({ text: 'Please unsubscribe me, the pricing is too high', channel: 'email' });
    expect(r.labels).toEqual(['unsubscribe', 'positive_interest']);
  });

  it('carries the vocabulary and detector versions', async () => {
    const r = await classifyMessage({ text: 'STOP' });
    expect(r.vocabularyVersion).toBe('sc7-draft-1');
    expect(r.detectorVersion).toBe('sc7-gov-1');
  });
});
