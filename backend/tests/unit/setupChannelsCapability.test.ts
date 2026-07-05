import { SETUP_REGISTRY, type SetupSignals } from '../../../config/setupRegistry';
import { evaluateCapabilityRegistry } from '../../../lib/shared/capabilityRegistry';

const channelsDef = SETUP_REGISTRY.find((c) => c.id === 'channels');
const apisDef = SETUP_REGISTRY.find((c) => c.id === 'external_apis');

function channelsScore(channels: SetupSignals['channels']): number {
  if (!channelsDef) throw new Error('channels category missing from SETUP_REGISTRY');
  // Only the channels category runs, so only s.channels is read.
  const signals = { channels } as unknown as SetupSignals;
  const evaluation = evaluateCapabilityRegistry([channelsDef], signals);
  return evaluation.categories[0].score;
}

function apisScore(externalApis: SetupSignals['externalApis']): number {
  if (!apisDef) throw new Error('external_apis category missing from SETUP_REGISTRY');
  const signals = { externalApis } as unknown as SetupSignals;
  const evaluation = evaluateCapabilityRegistry([apisDef], signals);
  return evaluation.categories[0].score;
}

const PROVIDERS = [
  { id: 'a', name: 'SearchAPI', configured: false },
  { id: 'b', name: 'YouTube Data API', configured: false },
  { id: 'c', name: 'Reddit Search', configured: false },
];

const SUPPORTED = ['LinkedIn', 'X', 'YouTube', 'Instagram'];

describe('Setup › Channels capability scoring', () => {
  it('is fully credited once ONE platform is connected (rest optional, still shown)', () => {
    const score = channelsScore({
      available: true,
      reason: null,
      supported: SUPPORTED,
      connected: ['LinkedIn'],
      everConnected: false,
    });
    expect(score).toBe(1); // connecting one proves the capability → 100%
  });

  it('stays credited when nothing is live now but a channel was connected before (sticky)', () => {
    const score = channelsScore({
      available: true,
      reason: null,
      supported: SUPPORTED,
      connected: [], // all disconnected
      everConnected: true, // latched feature: connected at least once historically
    });
    expect(score).toBe(1); // capability proven historically → credit retained
  });

  it('reads incomplete when the company has never connected any channel', () => {
    const score = channelsScore({
      available: true,
      reason: null,
      supported: SUPPORTED,
      connected: [],
      everConnected: false,
    });
    expect(score).toBe(0);
  });

  it('does not require connecting every platform to reach 100%', () => {
    const score = channelsScore({
      available: true,
      reason: null,
      supported: SUPPORTED,
      connected: ['LinkedIn', 'X'], // 2 of 4
      everConnected: false,
    });
    expect(score).toBe(1);
  });
});

describe('Setup › External APIs capability scoring', () => {
  it('is fully credited once ONE provider is configured (rest optional)', () => {
    const providers = PROVIDERS.map((p, i) => ({ ...p, configured: i === 0 }));
    expect(apisScore({ available: true, reason: null, providers, everConfigured: false })).toBe(1);
  });

  it('stays credited when a provider was configured before but none is live now (sticky)', () => {
    expect(
      apisScore({ available: true, reason: null, providers: PROVIDERS, everConfigured: true }),
    ).toBe(1);
  });

  it('reads incomplete when no provider has ever been configured', () => {
    expect(
      apisScore({ available: true, reason: null, providers: PROVIDERS, everConfigured: false }),
    ).toBe(0);
  });
});
