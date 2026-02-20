'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';

export type ChatVoiceButtonProps = {
  /** Called with the current transcript on every update (real-time). Replace input with this value. */
  onTranscription: (text: string) => void;
  disabled?: boolean;
  context?: string;
  className?: string;
  title?: string;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

/**
 * Mic button: click to start real-time speech-to-text, click again to stop.
 * Uses the browser Web Speech API; transcript is pushed to onTranscription as you speak.
 */
export default function ChatVoiceButton({
  onTranscription,
  disabled = false,
  className = '',
  title,
}: ChatVoiceButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptionRef = useRef(onTranscription);
  const transcriptRef = useRef('');

  onTranscriptionRef.current = onTranscription;

  const SpeechRecognitionCtor =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  const ensureMicrophonePermission = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;

    const isSecure =
      window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (!isSecure) {
      setError('Microphone requires HTTPS (or localhost).');
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      // Some browsers still support SpeechRecognition but not this API path.
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (err: any) {
      const code = String(err?.name || '').toLowerCase();
      if (code.includes('notallowed') || code.includes('permission')) {
        setError('Microphone access denied. Enable mic permission in browser site settings.');
      } else {
        setError('Unable to access microphone. Check device and browser permissions.');
      }
      return false;
    }
  };

  const startRecording = async () => {
    setError(null);
    transcriptRef.current = '';
    if (!SpeechRecognitionCtor) {
      setError('Voice input not supported in this browser. Try Chrome or Edge.');
      return;
    }
    const hasPermission = await ensureMicrophonePermission();
    if (!hasPermission) return;
    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const parts: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const t = event.results[i][0]?.transcript?.trim();
          if (t) parts.push(t);
        }
        const full = parts.join(' ');
        transcriptRef.current = full;
        onTranscriptionRef.current(full);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'not-allowed') {
          setError('Microphone access denied. Enable mic permission in browser site settings.');
        } else if (event.error !== 'aborted') {
          setError(event.message || `Voice error: ${event.error}`);
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        setIsRecording(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
    } catch (err) {
      console.error('ChatVoiceButton startRecording', err);
      setError('Could not start voice input.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current && isRecording) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
      setIsRecording(false);
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_) {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const handleClick = () => {
    if (disabled) return;
    if (isRecording) stopRecording();
    else void startRecording();
  };

  const effectiveTitle =
    title ??
    (isRecording ? 'Stop voice input' : 'Start voice input (real-time)');

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={error || effectiveTitle}
        className={
          className ||
          `p-2 rounded-lg transition-colors ${
            isRecording
              ? 'bg-red-100 text-red-600 animate-pulse'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`
        }
        aria-label={effectiveTitle}
      >
        {isRecording ? (
          <MicOff className="h-4 w-4" />
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
