'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';

export type ChatVoiceButtonProps = {
  /** Called once with the final transcript when transcription completes. */
  onTranscription: (text: string) => void;
  disabled?: boolean;
  /** Optional transcription context (passed to /api/voice/transcribe). */
  context?: string;
  className?: string;
  title?: string;
};

type Status = 'idle' | 'recording' | 'transcribing';

/**
 * Speech needs far less than the browser's default bitrate (often 128 kbps). At 32 kbps a
 * minute is ~240 KB, so the 5-minute cap stays well inside the transcribe route's 4 MB
 * body limit even as base64. Before this, ~30-60 s of speech exceeded the old 1 MB limit
 * and failed as a bare "Transcription failed" (prod 413s, 2026-10-26).
 */
const AUDIO_BITS_PER_SECOND = 32_000;
export const MAX_RECORDING_MS = 5 * 60 * 1000;

/** A readable message for a failed transcription response. */
export function transcriptionErrorMessage(status: number, serverError?: string | null): string {
  if (status === 413) return 'That recording was too long to send. Keep voice notes under 5 minutes, or split them.';
  if (status === 401) return 'Your session expired — sign in again to use voice.';
  if (status === 429) return serverError || 'Too many voice notes in a short time. Wait a moment and try again.';
  if (serverError) return serverError;
  return status >= 500 ? 'Transcription failed — please try again.' : `Transcription failed (${status}).`;
}

/** Pick a MediaRecorder mime type supported by this browser (cross-browser). */
function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* ignore */ }
  }
  return '';
}

/**
 * Mic button: click to record a voice note, click again to stop. The audio is
 * transcribed by Whisper (via /api/voice/transcribe) and the final text is
 * pushed to onTranscription. Cross-browser (MediaRecorder) and more accurate
 * than on-device dictation; there is no live interim text — the transcript
 * arrives when recording stops.
 */
export default function ChatVoiceButton({
  onTranscription,
  disabled = false,
  context = 'chat',
  className = '',
  title,
}: ChatVoiceButtonProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const onTranscriptionRef = useRef(onTranscription);
  const contextRef = useRef(context);
  onTranscriptionRef.current = onTranscription;
  contextRef.current = context;

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    return () => {
      clearTimer();
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      } catch { /* ignore */ }
      stopStream();
    };
  }, []);

  const transcribe = async (blob: Blob) => {
    setStatus('transcribing');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); // a data: URL
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
      });
      const res = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioFile: dataUrl, provider: 'whisper', context: contextRef.current }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(transcriptionErrorMessage(res.status, typeof json?.error === 'string' ? json.error : null));
      const text = String(json.transcription || '').trim();
      if (text) onTranscriptionRef.current(text);
      else setError('No speech detected.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transcription failed.');
    } finally {
      setStatus('idle');
    }
  };

  const startRecording = async () => {
    setError(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice input is not supported in this browser.');
      return;
    }
    const isSecure =
      window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!isSecure) {
      setError('Microphone requires HTTPS (or localhost).');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const code = String((e as { name?: string })?.name || '').toLowerCase();
      setError(
        code.includes('notallowed') || code.includes('permission')
          ? 'Microphone access denied. Enable mic permission in your browser site settings.'
          : 'Unable to access the microphone. Check device and browser permissions.',
      );
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND } : { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    } catch {
      stopStream();
      setError('Could not start recording.');
      return;
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      clearTimer();
      stopStream();
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      if (blob.size > 0) void transcribe(blob);
      else { setStatus('idle'); setError('No audio captured.'); }
    };
    recorder.start();
    recorderRef.current = recorder;
    setStatus('recording');
    // A visible timer, and an automatic stop at the cap so a recording always fits.
    const startedAt = Date.now();
    setElapsedMs(0);
    clearTimer();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);
      if (elapsed >= MAX_RECORDING_MS && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* ignore */ }
        recorderRef.current = null;
      }
    }, 250);
  };

  const stopRecording = () => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* ignore */ } }
    recorderRef.current = null;
    // status transitions to 'transcribing' inside recorder.onstop
  };

  const handleClick = () => {
    if (disabled || status === 'transcribing') return;
    if (status === 'recording') stopRecording();
    else void startRecording();
  };

  const effectiveTitle =
    title ??
    (status === 'recording'
      ? 'Stop and transcribe'
      : status === 'transcribing'
        ? 'Transcribing…'
        : 'Record a voice note (transcribed by Whisper)');

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || status === 'transcribing'}
        title={error || effectiveTitle}
        className={
          className ||
          `p-2 rounded-lg transition-colors ${
            status === 'recording'
              ? 'bg-red-100 text-red-600 animate-pulse'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`
        }
        aria-label={effectiveTitle}
      >
        {status === 'recording' ? (
          <Square className="h-4 w-4" />
        ) : status === 'transcribing' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>
      {status === 'recording' ? (
        <span className="text-[10px] tabular-nums text-red-600" aria-live="polite">
          {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, '0')}
        </span>
      ) : null}
      {error && (
        <span className="text-xs text-red-600 max-w-[140px] text-center leading-tight" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
