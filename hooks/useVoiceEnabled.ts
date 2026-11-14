/**
 * Is voice (transcription) switched on for this deployment? (e9, 2026-11-14)
 *
 * Voice must not appear until it is charged: billing is enforce-only today, so a visible mic
 * would be free AI. The server owns the switch (55): GET /api/voice/status -> { enabled }.
 *
 * FAILS CLOSED: while loading, on any error, on a 404 (endpoint not shipped yet), or on any
 * response other than `{ enabled: true }`, voice is OFF. So this client is safe to ship
 * before, with or after the server switch. One shared SWR request, not one per button.
 */
import useSWR from 'swr';

export const VOICE_STATUS_URL = '/api/voice/status';

async function fetchVoiceStatus(url: string): Promise<boolean> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return false;
  const body = (await res.json().catch(() => null)) as { enabled?: unknown } | null;
  return body?.enabled === true;
}

export function useVoiceEnabled(): boolean {
  const { data } = useSWR(VOICE_STATUS_URL, fetchVoiceStatus, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
    shouldRetryOnError: false,
  });
  return data === true;
}
