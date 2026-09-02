/**
 * PARITY GATE — worker boot preflight tests.
 * The render probe runs for real (this env has fonts → ok); the env contract is
 * exercised with stub envs to prove a missing CRITICAL var fails the report and
 * a missing WARN var only warns.
 */
import { runRenderParityPreflight } from '../../workers/renderParityPreflight';

const FULL_ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SECRET_KEY: 'k',
  REDIS_URL: 'rediss://x',
  OPENAI_API_KEY: 'sk-x',
  CREATOR_OCR_ENDPOINT: 'https://ocr',
} as unknown as NodeJS.ProcessEnv;

describe('runRenderParityPreflight', () => {
  it('all env present + fonts available → ok, no critical failures', async () => {
    const r = await runRenderParityPreflight({ env: FULL_ENV });
    expect(r.items.find((i) => i.name === 'render_text_glyphs')?.ok).toBe(true); // this env has fonts
    expect(r.criticalFailures).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('missing a CRITICAL env var fails the report', async () => {
    const env = { ...FULL_ENV, SUPABASE_SECRET_KEY: '' } as NodeJS.ProcessEnv;
    const r = await runRenderParityPreflight({ env });
    expect(r.ok).toBe(false);
    expect(r.criticalFailures).toBeGreaterThanOrEqual(1);
    expect(r.items.find((i) => i.name === 'env:SUPABASE_SECRET_KEY')?.ok).toBe(false);
  });

  // API-key migration: a deploy that still carries only the legacy variable
  // must satisfy the contract, and must still be reported under the canonical
  // name so operators read one thing.
  it('the legacy service-role variable alone still satisfies the server-key contract', async () => {
    const env = {
      ...FULL_ENV,
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy',
    } as NodeJS.ProcessEnv;
    const r = await runRenderParityPreflight({ env });
    expect(r.items.find((i) => i.name === 'env:SUPABASE_SECRET_KEY')?.ok).toBe(true);
    expect(r.criticalFailures).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('neither server-key variable set → critical failure', async () => {
    const env = {
      ...FULL_ENV,
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    } as NodeJS.ProcessEnv;
    const r = await runRenderParityPreflight({ env });
    expect(r.items.find((i) => i.name === 'env:SUPABASE_SECRET_KEY')?.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('missing only a WARN env var (CREATOR_OCR_ENDPOINT) warns but does not fail', async () => {
    const env = { ...FULL_ENV, CREATOR_OCR_ENDPOINT: '' } as NodeJS.ProcessEnv;
    const r = await runRenderParityPreflight({ env });
    expect(r.ok).toBe(true); // critical still satisfied
    expect(r.warnings).toBeGreaterThanOrEqual(1);
    expect(r.items.find((i) => i.name === 'env:CREATOR_OCR_ENDPOINT')?.ok).toBe(false);
  });
});
