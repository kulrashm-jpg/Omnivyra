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
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Transcription failed');
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
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stopStream();
      setError('Could not start recording.');
      return;
    }
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
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
      {error && (
        <span className="text-xs text-red-600 max-w-[140px] text-center leading-tight" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
