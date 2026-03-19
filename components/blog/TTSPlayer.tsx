'use client';

/**
 * TTSPlayer — Web Speech API text-to-speech player
 *
 * Splits article text into sentences, plays them in sequence.
 * Supports: play/pause, rewind (−3 sentences), fast-forward (+3 sentences),
 * speed control, sentence progress, and article title display.
 *
 * Renders as a sticky bottom bar.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

// ── Icons (inline SVG to avoid extra imports) ─────────────────────────────────

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const RewindIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
  </svg>
);
const ForwardIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);
const SpeakerIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
  </svg>
);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Extract readable text from an HTML string. */
function htmlToText(html: string): string {
  if (typeof document === 'undefined') return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

/** Split plain text into sentences. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
type Speed = typeof SPEEDS[number];

// ── Props ──────────────────────────────────────────────────────────────────────

export interface TTSPlayerProps {
  title: string;
  /** Raw HTML content from the article body */
  contentHtml: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TTSPlayer({ title, contentHtml }: TTSPlayerProps) {
  const [sentences, setSentences] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [dismissed, setDismissed] = useState(false);
  const [supported, setSupported] = useState(false);

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const idxRef = useRef(0); // stays in sync with currentIdx without re-creating callbacks

  // Detect support + parse text
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setSupported(true);
      synthRef.current = window.speechSynthesis;
    }
    if (contentHtml) {
      const text = htmlToText(contentHtml);
      setSentences(splitSentences(text));
    }
  }, [contentHtml]);

  // Keep idxRef in sync
  useEffect(() => { idxRef.current = currentIdx; }, [currentIdx]);

  // Stop everything on unmount
  useEffect(() => () => { synthRef.current?.cancel(); }, []);

  const speakFrom = useCallback((idx: number, spd: Speed) => {
    const synth = synthRef.current;
    if (!synth || sentences.length === 0) return;
    synth.cancel();

    const playFrom = (i: number) => {
      if (i >= sentences.length) {
        setIsPlaying(false);
        setCurrentIdx(0);
        return;
      }
      const utt = new SpeechSynthesisUtterance(sentences[i]);
      utt.rate = spd;
      utt.lang = 'en-US';
      utt.onstart = () => setCurrentIdx(i);
      utt.onend = () => {
        if (idxRef.current === i) playFrom(i + 1);
      };
      utt.onerror = () => setIsPlaying(false);
      utteranceRef.current = utt;
      synth.speak(utt);
    };

    setIsPlaying(true);
    setCurrentIdx(idx);
    playFrom(idx);
  }, [sentences]);

  const handlePlayPause = () => {
    const synth = synthRef.current;
    if (!synth) return;
    if (isPlaying) {
      synth.pause();
      setIsPlaying(false);
    } else {
      if (synth.paused) {
        synth.resume();
        setIsPlaying(true);
      } else {
        speakFrom(currentIdx, speed);
      }
    }
  };

  const handleRewind = () => {
    const next = Math.max(0, currentIdx - 3);
    setCurrentIdx(next);
    if (isPlaying) speakFrom(next, speed);
  };

  const handleForward = () => {
    const next = Math.min(sentences.length - 1, currentIdx + 3);
    setCurrentIdx(next);
    if (isPlaying) speakFrom(next, speed);
  };

  const handleSpeedChange = () => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    if (isPlaying) speakFrom(currentIdx, next);
  };

  const handleDismiss = () => {
    synthRef.current?.cancel();
    setIsPlaying(false);
    setDismissed(true);
  };

  if (!supported || dismissed) return null;

  const progress = sentences.length > 0 ? (currentIdx / (sentences.length - 1)) * 100 : 0;
  const currentSentence = sentences[currentIdx] || '';
  const preview = currentSentence.length > 70
    ? currentSentence.slice(0, 70) + '…'
    : currentSentence;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3 sm:px-6 sm:pb-5">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-[#0A66C2]/20 bg-white/95 shadow-2xl shadow-[#0A1F44]/20 backdrop-blur-md">
        {/* Progress bar */}
        <div className="h-0.5 w-full bg-gray-100">
          <div
            className="h-full bg-gradient-to-r from-[#0A66C2] to-[#3FA9F5] transition-all duration-300"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>

        <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
          {/* Speaker icon + title */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] ${isPlaying ? 'animate-pulse' : ''}`}>
              <span className="text-white"><SpeakerIcon /></span>
            </div>
            <div className="min-w-0 hidden sm:block">
              <p className="truncate text-xs font-semibold text-[#0B1F33] leading-tight">{title}</p>
              {isPlaying && preview && (
                <p className="truncate text-xs text-[#6B7C93] mt-0.5 italic">"{preview}"</p>
              )}
              {!isPlaying && (
                <p className="text-xs text-[#6B7C93] mt-0.5">
                  {currentIdx === 0 ? 'Listen to this article' : `Sentence ${currentIdx + 1} of ${sentences.length}`}
                </p>
              )}
            </div>
            {/* Mobile title only */}
            <p className="truncate text-xs font-semibold text-[#0B1F33] sm:hidden">Listen</p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Rewind */}
            <button
              onClick={handleRewind}
              disabled={currentIdx === 0}
              title="Back 3 sentences"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B7C93] hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <RewindIcon />
            </button>

            {/* Play / Pause */}
            <button
              onClick={handlePlayPause}
              title={isPlaying ? 'Pause' : 'Play'}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#0A66C2] to-[#3FA9F5] text-white shadow-md hover:opacity-90 transition-opacity"
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>

            {/* Fast forward */}
            <button
              onClick={handleForward}
              disabled={currentIdx >= sentences.length - 1}
              title="Forward 3 sentences"
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#6B7C93] hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <ForwardIcon />
            </button>

            {/* Speed */}
            <button
              onClick={handleSpeedChange}
              title="Change speed"
              className="hidden sm:flex h-8 min-w-[3rem] items-center justify-center rounded-full border border-gray-200 px-2 text-xs font-bold text-[#0A66C2] hover:bg-[#0A66C2]/5 transition-colors"
            >
              {speed}×
            </button>

            {/* Dismiss */}
            <button
              onClick={handleDismiss}
              title="Close player"
              className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-1"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
