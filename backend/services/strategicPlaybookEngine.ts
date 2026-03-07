/**
 * Strategic Playbook Engine
 * Phase 4: Converts intelligence into playbooks.
 * Types: content_expansion, market_positioning, product_opportunity
 */

import type { MarketPulse } from './marketPulseEngine';
import type { CompetitiveIntelligence } from './competitiveIntelligenceEngine';
import type { StrategicTheme } from './strategicThemesEngine';
import type { Opportunity } from './opportunityDetectionEngine';

export type PlaybookType =
  | 'content_expansion_playbook'
  | 'market_positioning_playbook'
  | 'product_opportunity_playbook'
  | 'competitive_response_playbook';

export type StrategicPlaybook = {
  playbook_type: PlaybookType;
  confidence_score: number;
  action_summary: string;
  supporting_signals: Array<{ signal_id?: string; topic?: string }>;
};

/**
 * Generate playbooks from themes, opportunities, market pulse, and competitive intelligence.
 */
export function generatePlaybooks(
  themes: StrategicTheme[],
  opportunities: Opportunity[],
  marketPulses: MarketPulse[],
  competitiveSignals: CompetitiveIntelligence[]
): StrategicPlaybook[] {
  const playbooks: StrategicPlaybook[] = [];

  for (const theme of themes.slice(0, 5)) {
    if (theme.theme_strength >= 0.3) {
      playbooks.push({
        playbook_type: 'content_expansion_playbook',
        confidence_score: Math.min(1, theme.theme_strength * 1.1),
        action_summary: `Expand content around theme: ${theme.theme_topic}`,
        supporting_signals: theme.supporting_signals.map((s) => ({
          signal_id: s.signal_id,
          topic: s.topic ?? undefined,
        })),
      });
    }
  }

  for (const pulse of marketPulses) {
    if (pulse.pulse_type === 'market_acceleration' && pulse.affected_topics.length > 0) {
      playbooks.push({
        playbook_type: 'market_positioning_playbook',
        confidence_score: pulse.pulse_score,
        action_summary: `Position for market acceleration in: ${pulse.affected_topics.join(', ')}`,
        supporting_signals: pulse.affected_topics.map((t) => ({ topic: t })),
      });
    }
  }

  for (const opp of opportunities) {
    if (opp.opportunity_type === 'market_gap' && opp.opportunity_score >= 0.4) {
      playbooks.push({
        playbook_type: 'product_opportunity_playbook',
        confidence_score: opp.opportunity_score,
        action_summary: opp.summary,
        supporting_signals: opp.supporting_signals.map((s) => ({
          signal_id: s.signal_id,
          topic: s.topic ?? undefined,
        })),
      });
    }
  }

  for (const comp of competitiveSignals) {
    if (comp.signal_type === 'product_launch' || comp.signal_type === 'pricing_shift') {
      playbooks.push({
        playbook_type: 'competitive_response_playbook',
        confidence_score: comp.confidence,
        action_summary: `Competitive response to ${comp.signal_type}: ${comp.summary.slice(0, 80)}`,
        supporting_signals: comp.supporting_signals.map((s) => ({
          signal_id: s.signal_id,
          topic: s.topic,
        })),
      });
    }
  }

  return playbooks
    .sort((a, b) => b.confidence_score - a.confidence_score)
    .slice(0, 12);
}
