/**
 * Feature flags. Keep this list small and meaningful.
 *
 * Gating rule: if a flag controls a UI surface that implies runtime coverage
 * the product cannot yet honor, it must default to OFF here and be opt-in
 * via environment variable. Prod should not carry optimistic defaults.
 */

const envRaw = (name: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name] as string;
  }
  return undefined;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
  return fallback;
};

/**
 * Browser-assisted engagement runtime (Chrome extension + content-script
 * driven sends). Not shipped today — keep the scaffolding in the repo but
 * gated off so users don't see surfaces that imply non-existent capability.
 */
export const isBrowserAssistRuntimeEnabled = (): boolean =>
  toBool(envRaw('NEXT_PUBLIC_FEATURE_BROWSER_ASSIST'), false);
