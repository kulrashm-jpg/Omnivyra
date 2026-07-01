/**
 * BETA-020 RULE 4/9 — Beta AI render mode produces a deterministic, zero-cost fixture image so
 * the authenticated runtime journey can be tested without spending OpenAI credits. These tests
 * prove: the flag gates the mode; the fixture is a valid 1024x1024 PNG; identical prompts yield
 * byte-identical output; different prompts differ; and no AI/network is involved (sharp only).
 */
import sharp from 'sharp';
import { isBetaAiRenderMode, createBetaMockImage, BETA_MOCK_MODEL } from '../../services/creator/rendering/providers/betaMockRenderProvider';

const withFlag = async <T>(on: boolean | undefined, fn: () => Promise<T> | T): Promise<T> => {
  const prev = process.env.BETA_AI_MODE;
  if (on === undefined) delete process.env.BETA_AI_MODE;
  else process.env.BETA_AI_MODE = on ? '1' : '0';
  try { return await fn(); } finally { if (prev === undefined) delete process.env.BETA_AI_MODE; else process.env.BETA_AI_MODE = prev; }
};

describe('BETA-020 — Beta AI render mode', () => {
  it('is OFF by default and ON only when BETA_AI_MODE is enabled', async () => {
    await withFlag(undefined, () => expect(isBetaAiRenderMode()).toBe(false));
    await withFlag(false, () => expect(isBetaAiRenderMode()).toBe(false));
    await withFlag(true, () => expect(isBetaAiRenderMode()).toBe(true));
    const prev = process.env.BETA_AI_MODE; process.env.BETA_AI_MODE = 'true';
    expect(isBetaAiRenderMode()).toBe(true);
    if (prev === undefined) delete process.env.BETA_AI_MODE; else process.env.BETA_AI_MODE = prev;
  });

  it('produces a valid 1024x1024 PNG fixture (zero OpenAI cost — sharp only)', async () => {
    const buf = await createBetaMockImage('a clean corporate photograph');
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(BETA_MOCK_MODEL).toBe('beta-mock');
  });

  it('is deterministic — identical prompt yields byte-identical output', async () => {
    const a = await createBetaMockImage('same prompt');
    const b = await createBetaMockImage('same prompt');
    expect(a.equals(b)).toBe(true);
  });

  it('varies by prompt — different prompts yield different fixtures', async () => {
    const a = await createBetaMockImage('prompt one');
    const b = await createBetaMockImage('prompt two');
    expect(a.equals(b)).toBe(false);
  });
});
