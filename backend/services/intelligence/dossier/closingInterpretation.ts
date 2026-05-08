// Final Strategic Interpretation.
//
// The dossier's closing block. Restrained, calm, memorable — the single
// piece of writing the reader is most likely to quote. Answers four
// executive questions:
//
//   1. What kind of authority system exists today?       — authority_system_today
//   2. What is most limiting its evolution?              — evolution_constraint
//   3. What happens if momentum continues unchanged?     — momentum_implication
//   4. What unlocks the next maturity level?             — next_unlock
//
// This is NOT a recommendation dump, NOT a score recap, NOT a generic
// conclusion. It synthesises the canonical authority shape, the maturity
// evolution narrative, the momentum shape, and the unlock path that the
// rest of the dossier already established — phrased as one final
// executive takeaway.

import type { CanonicalReport } from '../../canonicalReport/canonicalReportTypes';
import type { AuthorityShape } from './authorityShape';
import type { MaturityEvolution } from './maturityEvolution';
import type { MomentumShape } from './momentumShape';

export type ClosingInterpretation = {
  authority_system_today: string;
  evolution_constraint: string;
  momentum_implication: string;
  next_unlock: string;
};

export function composeClosingInterpretation(params: {
  report: CanonicalReport;
  authority_shape: AuthorityShape;
  maturity_evolution: MaturityEvolution | null;
  momentum_shape: MomentumShape;
}): ClosingInterpretation {
  const { report, authority_shape, maturity_evolution, momentum_shape } = params;
  const stageLabel = report.maturity_stage.label;

  const authority_system_today =
    `Today, the brand reads as a ${authority_shape.name.toLowerCase()}. ${authority_shape.what_it_means}`;

  const evolution_constraint = maturity_evolution
    ? maturity_evolution.transition_friction
    : 'The dimension producing maturity transition friction cannot yet be isolated — measurement is still forming. The dossier holds this open until evidence accumulates.';

  const momentum_implication = (() => {
    switch (momentum_shape.kind) {
      case 'compounding':
        return 'If momentum continues unchanged, the supporting pillars will keep reinforcing each other and the lift will become structurally durable. The risk is not failure — it is interrupting the inputs that produced the trajectory by switching focus prematurely.';
      case 'stable':
        return 'If the pillar coherence holds, the system is positioned for the depth work that produces compounding. The risk is mistaking stability for completeness — coherence is a precondition for the next stage, not the destination.';
      case 'fragile':
        return 'If the spread between supporting and unsupported pillars persists, today\'s lift is structurally vulnerable. Fragile gains regress without warning when the pillar carrying them slows.';
      case 'stagnating':
        return 'If stagnation continues, the brand is neither compounding nor declining — but its peer set is. Stillness becomes relative loss measured over enough quarters.';
      case 'declining':
        return 'If the regression source is not identified, every new initiative will be evaluated against a moving baseline and attribution becomes impossible. Diagnosis precedes new work.';
      case 'insufficient_history':
      default:
        return 'Momentum implications cannot yet be read with confidence. Repeated observations will resolve the trajectory; until then, treat the present state as a baseline rather than a trend.';
    }
  })();

  const next_unlock = (() => {
    if (maturity_evolution) {
      const stage = report.maturity_stage.next_stage;
      if (stage) {
        return `Unlocking ${stage} is a function of resolving the friction above before opening a second front. ${maturity_evolution.unlock_path}`;
      }
      return `At ${stageLabel}, the strategic posture inverts. ${maturity_evolution.unlock_path}`;
    }
    return 'Until the maturity layer carries sufficient evidence, the unlock cannot be sequenced. The dossier will sharpen as observation accumulates.';
  })();

  return {
    authority_system_today,
    evolution_constraint,
    momentum_implication,
    next_unlock,
  };
}
