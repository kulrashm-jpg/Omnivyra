/**
 * Extension 1.5.0 contract primitives (EXTENSION-1.5.0-CONTRACT.md §1, §2, §4).
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkExtensionVersion, EXTENSION_MIN_VERSION } from '../../../lib/extension/version';
import { canonical, signEnvelope, verifyEnvelopeSignature, type CommandEnvelope } from '../../../lib/extension/envelope';

const calls: string[] = [];
let client: Record<string, unknown> | null = null;
jest.mock('../../queue/bullmqClient', () => ({ getSharedRedisClient: () => client }));
import { claimSharedRequestNonce, __resetSharedNonceClientForTests } from '../../services/extensionNonceStore';

const VECTORS = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib/extension/envelopeVectors.json'), 'utf8'));

describe('version gate (§1)', () => {
  it.each(['1.5.0', '1.5.1', '1.10.0', '2.0.0', ' 1.5.0 '])('%s passes', (v) => {
    expect(checkExtensionVersion(v)).toMatchObject({ ok: true });
  });
  it.each([undefined, null, '', '1.4.1', '1.4.99', '0.9.0', '1.5', '1.5.0-beta', 'v1.5.0', 150, '1.5.0.1'])('%p is refused with 426', (v) => {
    expect(checkExtensionVersion(v)).toEqual({ ok: false, status: 426, code: 'EXTENSION_UPGRADE_REQUIRED', minimum: EXTENSION_MIN_VERSION });
  });
  it('the minimum is 1.5.0', () => expect(EXTENSION_MIN_VERSION).toBe('1.5.0'));
});

describe('command envelope (§4), pinned to the shared vectors', () => {
  it('canonical() matches the basic vector byte for byte', () => {
    expect(canonical(VECTORS.canonical_basic.input)).toBe(VECTORS.canonical_basic.expected);
  });
  it('canonical() of the envelope and its signature match the vector', () => {
    const { envelope, secret, canonical: c, signature } = VECTORS.envelope;
    expect(canonical(envelope)).toBe(c);
    expect(signEnvelope(envelope, secret)).toBe(signature);
    expect(verifyEnvelopeSignature(envelope, signature, secret)).toBe(true);
  });
  it('key order does not change the signature; undefined keys are omitted', () => {
    const { envelope, secret, signature } = VECTORS.envelope;
    const reordered = Object.fromEntries(Object.entries(envelope).reverse()) as unknown as CommandEnvelope;
    expect(signEnvelope({ ...reordered, approval_id: envelope.approval_id }, secret)).toBe(signature);
    expect(signEnvelope({ ...envelope, extra_undefined: undefined } as never, secret)).toBe(signature);
  });
  it.each([
    ['text hash', (e: CommandEnvelope) => ({ ...e, text_sha256: '0'.repeat(64) })],
    ['acting member', (e: CommandEnvelope) => ({ ...e, acting_member_urn: 'urn:li:fsd_profile:ACoAAOTHER' })],
    ['expiry', (e: CommandEnvelope) => ({ ...e, expires_at: e.expires_at + 1 })],
    ['target', (e: CommandEnvelope) => ({ ...e, target: { ...e.target, post_urn: 'urn:li:activity:1' } })],
    ['action', (e: CommandEnvelope) => ({ ...e, action: 'li.reaction.like' as const })],
  ])('tampering with the %s breaks verification', (_n, mutate) => {
    const { envelope, secret, signature } = VECTORS.envelope;
    expect(verifyEnvelopeSignature(mutate(envelope), signature, secret)).toBe(false);
  });
  it('a different secret, a malformed signature or an empty secret never verifies', () => {
    const { envelope, secret, signature } = VECTORS.envelope;
    expect(verifyEnvelopeSignature(envelope, signature, `${secret}x`)).toBe(false);
    expect(verifyEnvelopeSignature(envelope, 'nothex', secret)).toBe(false);
    expect(() => signEnvelope(envelope, '')).toThrow();
  });
});

describe('shared request-nonce store (§2)', () => {
  const store = new Map<string, string>();
  const fakeRedis = (status: string | undefined) => ({
    ...(status === undefined ? {} : { status }),
    set: async (key: string, val: string, _px: string, _ms: number, nx: string) => {
      calls.push(`set:${key}`);
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
  });
  beforeEach(() => { store.clear(); calls.length = 0; __resetSharedNonceClientForTests(); });

  it('a nonce is claimed once; a replay on ANOTHER instance (same shared store) is refused', async () => {
    client = fakeRedis('ready');
    expect(await claimSharedRequestNonce('user-1', 'n-1')).toBe('claimed');
    __resetSharedNonceClientForTests(); // a second instance resolves its own client to the same Redis
    expect(await claimSharedRequestNonce('user-1', 'n-1')).toBe('replayed');
    expect(await claimSharedRequestNonce('user-2', 'n-1')).toBe('claimed');
  });
  it.each(['connecting', 'reconnecting', 'end'])('status %s: nothing is issued; the caller keeps its local protection', async (status) => {
    client = fakeRedis(status);
    expect(await claimSharedRequestNonce('user-1', 'n-2')).toBe('unavailable');
    expect(calls).toEqual([]);
  });
  it('a store error is "unavailable", never "claimed"', async () => {
    client = { status: 'ready', set: async () => { throw new Error('boom'); } };
    expect(await claimSharedRequestNonce('user-1', 'n-3')).toBe('unavailable');
  });
});
