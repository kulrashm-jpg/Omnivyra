/**
 * Voice transcription limits + per-minute credit arithmetic (e9 / e1, 2026-11-13).
 *
 * The product maximum is 5:00. The server cannot learn an upload's duration before the provider call (MediaRecorder
 * WebM carries no Duration header; no decoder dependency), so the limit has two layers:
 *   1. PRE-CALL size bound for the pinned recorder: the client records at a fixed 32 kbps, so 5:00 is ~1.2 MB.
 *      Anything above 5 min x 32 kbps x 1.1 cannot be a <=5:00 recording from the real UI -> 413, no hold, no call.
 *   2. POST-CALL authoritative duration (Whisper verbose_json returns it): > 301 s -> 413, the hold is released,
 *      nothing is charged, the transcript is discarded and an anomaly is logged. The absorbed provider cost is bounded
 *      by the 4 MB body limit and rate-limited by guardAiRequest (accepted by e9).
 */
export const MAX_AUDIO_SECONDS = 300;
/** One second of tolerance over 5:00 for encoder/container rounding: 5:00 passes, 5:01 is refused. */
export const AUDIO_DURATION_TOLERANCE_SECONDS = 1;
export const PINNED_RECORDER_BITS_PER_SECOND = 32_000;
export const MAX_AUDIO_BYTES = Math.ceil(MAX_AUDIO_SECONDS * (PINNED_RECORDER_BITS_PER_SECOND / 8) * 1.1); // 1,320,000

export const AUDIO_TOO_LONG_BODY = {
  error: 'Recordings are limited to 5 minutes.',
  code: 'AUDIO_TOO_LONG',
} as const;

/** Decoded byte length of the uploaded audio (a base64 data: URL or a raw buffer). null = unknown shape. */
export function decodedAudioBytes(audioFile: unknown): number | null {
  if (typeof audioFile === 'string') {
    const comma = audioFile.indexOf(',');
    const b64 = audioFile.startsWith('data:') && comma >= 0 ? audioFile.slice(comma + 1) : audioFile;
    const clean = b64.replace(/\s/g, '');
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  }
  if (audioFile && typeof (audioFile as { byteLength?: unknown }).byteLength === 'number') {
    return (audioFile as { byteLength: number }).byteLength;
  }
  return null;
}

export function exceedsPreCallSizeBound(audioFile: unknown): boolean {
  const bytes = decodedAudioBytes(audioFile);
  return bytes !== null && bytes > MAX_AUDIO_BYTES;
}

export function exceedsDurationLimit(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds > MAX_AUDIO_SECONDS + AUDIO_DURATION_TOLERANCE_SECONDS;
}

/** Credits for an ACTUAL duration (e1): max(1, ceil(seconds x perMinute / 60)). */
export function creditsForSeconds(seconds: number, creditsPerMinute: number): number {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.max(1, Math.ceil((s * creditsPerMinute) / 60));
}

/** Thrown inside the billed executor so the engine RELEASES the hold (no consumable event fired -> nothing kept). */
export class AudioTooLongError extends Error {
  constructor(readonly seconds: number) {
    super(`audio duration ${seconds}s exceeds the ${MAX_AUDIO_SECONDS}s limit`);
    this.name = 'AudioTooLongError';
  }
}

/**
 * VOICE KILL-SWITCH (e9 2026-11-14, BLOCKING - money): voice must not go live free. Transcription runs only when
 * VOICE_TRANSCRIBE_ENABLED === 'true' (default OFF); it is switched on together with the pricing release (049:
 * voice_per_minute at 14 credits/min). The UI shows the mic only when GET /api/voice/status says enabled.
 */
export function isVoiceTranscribeEnabled(): boolean {
  // EXACT match, no normalisation (05/83): for a switch that gates spend, exactly ONE spelling turns it on - the same
  // convention as CREDIT_HOLD_REAP_ENABLED and the settlement gate. 'TRUE', ' true', 'true' + newline are all OFF.
  return process.env.VOICE_TRANSCRIBE_ENABLED === 'true';
}
export const VOICE_UNAVAILABLE_BODY = Object.freeze({
  error: 'Voice input is not available yet.',
  code: 'VOICE_UNAVAILABLE',
});
