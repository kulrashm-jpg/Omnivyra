export function normalizeCanonicalWebsite(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  try {
    const parsed = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname || !hostname.includes('.')) return null;
    if (/^localhost$|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^0\.0\.0\.0$/.test(hostname)) {
      return null;
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isValidCanonicalWebsite(value: unknown): boolean {
  return Boolean(normalizeCanonicalWebsite(value));
}
