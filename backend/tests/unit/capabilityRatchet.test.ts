import { evaluateCapabilityRegistry, type CapabilityCategoryDef } from '../../../lib/shared/capabilityRegistry';

type S = { done: boolean };

const registry: CapabilityCategoryDef<S>[] = [
  {
    id: 'cat',
    title: 'Cat',
    weight: 10,
    capability: () => ({ supported: true, enabled: true, available: true, reason: null }),
    factors: () => [
      {
        id: 'cat.factor',
        title: 'Factor',
        description: '',
        weight: 1,
        evaluate: (s) =>
          s.done ? { score: 1 } : { score: 0, missing: ['not done'], recommendation: 'do it', nextAction: { actionId: 'a' } },
      },
    ],
  },
];

describe('capabilityRegistry monotonic ratchet', () => {
  it('floors a factor at its prior max — the score never drops once achieved', () => {
    const dropped = evaluateCapabilityRegistry(registry, { done: false }, { 'cat.factor': 1 });
    expect(dropped.categories[0].factors[0].score).toBe(1);
    expect(dropped.categories[0].factors[0].status).toBe('done');
    expect(dropped.overallPercent).toBe(100);
  });

  it('without a prior, the raw live value is reflected (opt-in ratchet)', () => {
    const raw = evaluateCapabilityRegistry(registry, { done: false });
    expect(raw.categories[0].factors[0].score).toBe(0);
    expect(raw.overallPercent).toBe(0);
  });

  it('a higher live score still rises above the prior max', () => {
    const up = evaluateCapabilityRegistry(registry, { done: true }, { 'cat.factor': 0.5 });
    expect(up.categories[0].factors[0].score).toBe(1);
    expect(up.overallPercent).toBe(100);
  });
});
