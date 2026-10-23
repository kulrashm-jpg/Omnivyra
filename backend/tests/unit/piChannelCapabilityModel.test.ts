/**
 * The outreach CHANNEL capability model.
 *
 * Two halves, deliberately:
 *
 *   DECLARATION   that each channel states its four operations honestly, and
 *                 that the distinctions which matter — routable vs live, not
 *                 built vs not reachable, technical status vs human outcome —
 *                 survive as separate facts rather than collapsing into one
 *                 boolean.
 *   CONSISTENCY   that the declaration matches the REAL transport registry. The
 *                 model deliberately does not derive `routable`, because
 *                 registration is caller-driven and a derived value would
 *                 report whatever the last test did. The cost of declaring it
 *                 is that a drift must fail a build, and that is this suite's
 *                 job.
 *
 * No provider is contacted, no credential is read, no database is touched, and
 * no transport is left registered after the suite.
 */

import {
  CHANNEL_CAPABILITIES,
  CHANNEL_OPERATIONS,
  CAPABILITY_STATUSES,
  NON_ATTEMPTABLE_STATUSES,
  CHANNEL_OPERATIONAL_VERIFICATIONS,
  getChannelCapability,
  getChannelOperation,
  isChannelOperationAttemptable,
  isChannelOperationallyVerified,
  channelsSupporting,
  summarizeChannelCapabilities,
  type ChannelOperation,
} from '../../services/leadOutreachExecution/channelCapabilityModel';
import {
  __clearTransportsForTests,
  supportedChannels,
} from '../../services/leadOutreachExecution/transport';
import { registerDefaultTransports } from '../../services/leadOutreachExecution/transportRegistry';

const MODEL_PATH = 'backend/services/leadOutreachExecution/channelCapabilityModel.ts';

afterEach(() => {
  __clearTransportsForTests();
});

describe('the declaration covers the channels this platform names', () => {
  it('1. declares exactly the five outreach channels plus internal', () => {
    expect(CHANNEL_CAPABILITIES.map((c) => c.channel).sort())
      .toEqual(['email', 'internal', 'sms', 'social', 'voice', 'whatsapp']);
  });

  it('2. every channel states every operation — a missing one is not an absent capability', () => {
    for (const channel of CHANNEL_CAPABILITIES) {
      for (const op of CHANNEL_OPERATIONS) {
        const state = channel.operations[op];
        expect(CAPABILITY_STATUSES).toContain(state.status);
        // A status without evidence is an opinion. Every one carries its basis.
        // The bar is "not empty and not a placeholder", not a word count: `not
        // a voice channel` is complete evidence for a disposition on SMS.
        expect(state.basis.length).toBeGreaterThan(10);
        expect(state.basis).not.toMatch(/^(tbd|todo|n\/a|unknown)$/i);
      }
    }
  });

  it('3. resolves case-insensitively and trims, because channel is free text on the task', () => {
    expect(getChannelCapability('  EMAIL ')?.channel).toBe('email');
    expect(getChannelCapability('')).toBeNull();
    expect(getChannelCapability('telepathy')).toBeNull();
  });
});

describe('ROUTABLE IS NOT LIVE', () => {
  it('4. email is routable and its send is NOT_CONFIGURED, not SUPPORTED', () => {
    const email = getChannelCapability('email');
    expect(email?.routable).toBe(true);
    expect(email?.transportImplemented).toBe(true);
    // The whole point: a registered transport that ships disabled.
    expect(email?.operations.send.status).toBe('NOT_CONFIGURED');
    expect(email?.egressFlag).toBe('LEAD_OUTREACH_EMAIL_ENABLED');
  });

  it('5. a switched-off channel and an unbuilt one are DIFFERENT statuses', () => {
    expect(getChannelOperation('email', 'send').status).toBe('NOT_CONFIGURED');
    expect(getChannelOperation('whatsapp', 'send').status).toBe('NOT_OPERATIONAL');
    // Both refuse an attempt, but a reader can tell which is an operator action
    // and which is an engineering one.
    expect(isChannelOperationAttemptable('email', 'send')).toBe(false);
    expect(isChannelOperationAttemptable('whatsapp', 'send')).toBe(false);
  });

  it('6. an unregistered channel is NOT_OPERATIONAL for send, never UNSUPPORTED', () => {
    // UNSUPPORTED would say the channel cannot do this. The truth is that
    // nothing here implements it, which is a different claim and a reversible
    // one.
    for (const channel of ['whatsapp', 'sms', 'voice']) {
      expect(getChannelOperation(channel, 'send').status).toBe('NOT_OPERATIONAL');
      expect(getChannelCapability(channel)?.routable).toBe(false);
      expect(getChannelCapability(channel)?.transportImplemented).toBe(false);
    }
  });
});

describe('the declaration matches the REAL transport registry', () => {
  it('7. every channel declared routable is actually registered, and no other is', () => {
    __clearTransportsForTests();
    registerDefaultTransports({
      emailProvider: {
        name: 'stub',
        async send() { throw new Error('no provider may be called in this suite'); },
      },
    });

    const registered = supportedChannels();
    const declaredRoutable = CHANNEL_CAPABILITIES.filter((c) => c.routable).map((c) => c.channel).sort();

    expect(declaredRoutable).toEqual([...registered].sort());
  });

  it('8. no channel declared NON-routable has a transport', () => {
    __clearTransportsForTests();
    registerDefaultTransports({
      emailProvider: {
        name: 'stub',
        async send() { throw new Error('no provider may be called in this suite'); },
      },
    });

    const registered = new Set(supportedChannels());
    for (const channel of CHANNEL_CAPABILITIES.filter((c) => !c.routable)) {
      expect(registered.has(channel.channel)).toBe(false);
    }
  });
});

describe('nothing external is operationally verified', () => {
  it('9. no EXTERNAL channel claims a verified operation', () => {
    for (const channel of CHANNEL_CAPABILITIES.filter((c) => c.external)) {
      for (const op of CHANNEL_OPERATIONS) {
        expect(isChannelOperationallyVerified(channel.channel, op)).toBe(false);
      }
    }
  });

  it('10. only internal is verified, and only for what the platform itself performs', () => {
    expect(CHANNEL_OPERATIONAL_VERIFICATIONS.map((v) => `${v.channel}:${v.operation}`).sort())
      .toEqual(['internal:deliveryReceipt', 'internal:send']);
    for (const v of CHANNEL_OPERATIONAL_VERIFICATIONS) {
      expect(v.basis.length).toBeGreaterThan(20);
    }
  });

  it('11. being implemented and registered does NOT make a channel verified', () => {
    const email = getChannelCapability('email');
    expect(email?.transportImplemented).toBe(true);
    expect(email?.routable).toBe(true);
    expect(isChannelOperationallyVerified('email', 'send')).toBe(false);
  });
});

describe('social is not one channel', () => {
  it('12. is network-scoped and claims NO send capability at channel level', () => {
    const social = getChannelCapability('social');
    expect(social?.networkScoped).toBe(true);
    expect(social?.operations.send.status).toBe('UNSUPPORTED');
    expect(social?.operations.send.basis).toMatch(/per network/);
  });

  it('13. claims no inbound or delivery capability either, because they differ per network', () => {
    const social = getChannelCapability('social');
    expect(social?.operations.deliveryReceipt.status).toBe('UNSUPPORTED');
    expect(social?.operations.inboundReply.status).toBe('UNSUPPORTED');
  });

  it('14. is the ONLY network-scoped channel — the others are single targets', () => {
    expect(CHANNEL_CAPABILITIES.filter((c) => c.networkScoped).map((c) => c.channel))
      .toEqual(['social']);
  });
});

describe('voice keeps technical status apart from what a human did', () => {
  it('15. declares callDisposition as its OWN operation, separate from send', () => {
    const voice = getChannelCapability('voice');
    expect(CHANNEL_OPERATIONS).toContain('callDisposition');
    expect(voice?.operations.callDisposition.status).toBe('UNSUPPORTED');
    expect(voice?.operations.callDisposition.basis).toMatch(/SEPARATELY from send/);
  });

  it('16. does not treat a connected call as a delivery receipt', () => {
    expect(getChannelOperation('voice', 'deliveryReceipt').basis)
      .toMatch(/not a delivery receipt/);
  });

  it('17. only a conversational channel has a disposition at all', () => {
    for (const channel of ['internal', 'email', 'whatsapp', 'sms', 'social']) {
      expect(getChannelOperation(channel, 'callDisposition').status).toBe('UNSUPPORTED');
    }
  });
});

describe('the attemptability answer FAILS CLOSED', () => {
  it('18. an unknown channel is UNSUPPORTED, never UNVERIFIED', () => {
    const state = getChannelOperation('carrier-pigeon', 'send');
    expect(state.status).toBe('UNSUPPORTED');
    expect(state.basis).toMatch(/no channel/);
    expect(isChannelOperationAttemptable('carrier-pigeon', 'send')).toBe(false);
  });

  it('19. an unknown OPERATION is refused rather than read off the record', () => {
    expect(isChannelOperationAttemptable('internal', 'teleport' as ChannelOperation)).toBe(false);
  });

  it('20. every non-attemptable status refuses, and the attemptable ones permit', () => {
    for (const status of CAPABILITY_STATUSES) {
      const refuses = NON_ATTEMPTABLE_STATUSES.includes(status);
      expect(refuses).toBe(['NOT_CONFIGURED', 'NOT_OPERATIONAL', 'UNSUPPORTED'].includes(status));
    }
  });

  it('21. only internal may currently be attempted for a send', () => {
    expect(channelsSupporting('send')).toEqual(['internal']);
  });

  it('22. email is the only channel with any inbound path today', () => {
    expect(channelsSupporting('inboundReply')).toEqual(['email']);
  });
});

describe('this module cannot make a channel sendable', () => {
  // CODE, not the words. This module's header names `resolveTransport` and
  // `registerDefaultTransports` precisely to record that it does not reach
  // them, and that prose must not satisfy — or defeat — the assertion.
  const modelCode = (): string => {
    const src: string = require('fs').readFileSync(
      require('path').join(process.cwd(), MODEL_PATH), 'utf8');
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  };

  it('23. is PURE — no network, no database, no clock, no credential', () => {
    const code = modelCode();
    expect(code).not.toMatch(/safeFetch|fetch\(|axios/);
    expect(code).not.toMatch(/ownedDbTable\s*\(|from '[^']*supabase/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/Date\.now|new Date\(/);
  });

  it('24. does not import or re-export the transport registry', () => {
    // Deriving `routable` from the live registry is the tempting shortcut, and
    // it would report whatever the last caller registered. The declaration is
    // the contract; test 7 is what keeps it true.
    const code = modelCode();
    expect(code).not.toMatch(/from '\.\/transport'/);
    expect(code).not.toMatch(/registerTransport\s*\(|resolveTransport\s*\(/);
    // Stronger, and exact: the module imports NOTHING at all.
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it('25. declaring a capability does not register anything', () => {
    __clearTransportsForTests();
    // Reading the whole model must leave the dispatcher with nothing to resolve.
    summarizeChannelCapabilities();
    channelsSupporting('send');
    getChannelOperation('email', 'send');
    expect(supportedChannels()).toEqual([]);
  });
});

describe('the operator summary reads the same every time', () => {
  it('26. one row per channel, carrying routable and the egress flag', () => {
    const rows = summarizeChannelCapabilities();
    expect(rows).toHaveLength(CHANNEL_CAPABILITIES.length);

    const email = rows.find((r) => r.channel === 'email');
    expect(email?.routable).toBe(true);
    expect(email?.egressFlag).toBe('LEAD_OUTREACH_EMAIL_ENABLED');
    expect(email?.operations.send).toBe('NOT_CONFIGURED');
    expect(email?.operationallyVerified).toEqual([]);

    const internal = rows.find((r) => r.channel === 'internal');
    expect(internal?.external).toBe(false);
    expect(internal?.operationallyVerified.sort()).toEqual(['deliveryReceipt', 'send']);
  });

  it('27. reports a status for all four operations on every row', () => {
    for (const row of summarizeChannelCapabilities()) {
      for (const op of CHANNEL_OPERATIONS) {
        expect(CAPABILITY_STATUSES).toContain(row.operations[op]);
      }
    }
  });
});
