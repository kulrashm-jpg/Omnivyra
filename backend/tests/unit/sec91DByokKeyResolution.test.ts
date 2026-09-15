/**
 * SEC91-D4 — BYOK key resolution must not SILENTLY substitute the platform key.
 *
 * A company that stored its own key but whose ciphertext cannot be decrypted
 * used to fall through to the platform key with `source: 'platform'` and no
 * trace. The result is now flagged `byokUnavailable` (the gateway then applies
 * the platform-key plan/cost gates — see sec91DGatewaySpend) and the event is
 * logged without any key material.
 */
const mockRow: { current: Record<string, unknown> | null } = { current: null };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: mockRow.current, error: null }),
    };
    return chain;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
const mockDecrypt = jest.fn((_c: string) => 'sk-COMPANY-PLAINTEXT');
jest.mock('../../auth/credentialEncryption', () => ({
  decryptCredential: (c: string) => mockDecrypt(c),
  encryptCredential: (p: string) => `enc(${p})`,
}));

import { resolveCompanyApiKey } from '../../services/llmProviderService';

const ORIGINAL = process.env.OPENAI_API_KEY;
beforeAll(() => { process.env.OPENAI_API_KEY = 'sk-PLATFORM-OPENAI'; });
afterAll(() => { if (ORIGINAL === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = ORIGINAL; });
beforeEach(() => { mockDecrypt.mockReset(); mockDecrypt.mockImplementation(() => 'sk-COMPANY-PLAINTEXT'); });

describe('SEC91-D4 resolveCompanyApiKey', () => {
  it('a usable company key → source company (unchanged)', async () => {
    mockRow.current = { api_key_encrypted: 'CIPHERTEXT-1', is_active: true };
    await expect(resolveCompanyApiKey('co', 'openai')).resolves.toEqual({ key: 'sk-COMPANY-PLAINTEXT', source: 'company' });
  });

  it('decryption failure → platform key, flagged byokUnavailable, logged without key material', async () => {
    mockRow.current = { api_key_encrypted: 'CIPHERTEXT-SECRET', is_active: true };
    mockDecrypt.mockImplementation(() => { throw new Error('bad auth tag'); });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const r = await resolveCompanyApiKey('co-x', 'openai');
      expect(r).toEqual({ key: 'sk-PLATFORM-OPENAI', source: 'platform', byokUnavailable: true });
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('byok_key_unusable');
      expect(logged).not.toContain('CIPHERTEXT-SECRET');
      expect(logged).not.toContain('sk-PLATFORM-OPENAI');
    } finally {
      warn.mockRestore();
    }
  });

  it('empty plaintext is treated the same as a decryption failure', async () => {
    mockRow.current = { api_key_encrypted: 'CIPHERTEXT-2', is_active: true };
    mockDecrypt.mockImplementation(() => '');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const r = await resolveCompanyApiKey('co', 'openai');
      expect(r.source).toBe('platform');
      expect(r.byokUnavailable).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('no stored key → plain platform result (no flag, no log)', async () => {
    mockRow.current = { api_key_encrypted: null, is_active: true };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(resolveCompanyApiKey('co', 'openai')).resolves.toEqual({ key: 'sk-PLATFORM-OPENAI', source: 'platform' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
