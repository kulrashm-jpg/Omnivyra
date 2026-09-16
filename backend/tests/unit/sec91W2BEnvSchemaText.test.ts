/**
 * SEC91-W2B-6 (P3) — config/env.schema.ts described OAUTH_STATE_HMAC_KEY as falling back
 * to ENCRYPTION_KEY. Since SEC91-B7 the fallback is a domain-separated key DERIVED from
 * ENCRYPTION_KEY (HMAC-SHA256(ENCRYPTION_KEY, 'omnivyra/oauth-state/v1')); ENCRYPTION_KEY
 * is never used as the HMAC key itself. An operator reading the old text could conclude
 * the two keys are interchangeable. Description text only — no validation change.
 */
import { envSchema } from '../../../config/env.schema';
import * as fs from 'fs';

describe('SEC91-W2B-6 OAUTH_STATE_HMAC_KEY description matches backend/auth/oauthState.ts', () => {
  const description = (envSchema.shape.OAUTH_STATE_HMAC_KEY as { description?: string }).description ?? '';

  it('names the derived fallback and its label', () => {
    expect(description).toMatch(/derived from ENCRYPTION_KEY/);
    expect(description).toContain('omnivyra/oauth-state/v1');
  });

  it('no longer says it falls back to ENCRYPTION_KEY itself', () => {
    expect(description).not.toMatch(/falls back to ENCRYPTION_KEY when unset/);
    const src = fs.readFileSync('config/env.schema.ts', 'utf8');
    expect(src).not.toMatch(/falls back to ENCRYPTION_KEY for backward/);
  });

  it('the label in the description is the one oauthState.ts uses', () => {
    const src = fs.readFileSync('backend/auth/oauthState.ts', 'utf8');
    expect(src).toContain("OAUTH_STATE_KEY_DERIVATION_LABEL = 'omnivyra/oauth-state/v1'");
  });

  it('validation is unchanged: optional, 64 hex characters when set', () => {
    const field = envSchema.shape.OAUTH_STATE_HMAC_KEY;
    expect(field.safeParse(undefined).success).toBe(true);
    expect(field.safeParse('a'.repeat(64)).success).toBe(true);
    expect(field.safeParse('not-hex').success).toBe(false);
  });
});
