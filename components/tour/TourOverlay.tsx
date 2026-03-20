'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { useTour, TOUR_STEPS } from './TourContext';

const OVERLAY_COLOR = 'rgba(10, 17, 40, 0.72)';
const PAD = 10; // padding around spotlight target in px
const SPOTLIGHT_RADIUS = 14;

type Rect = { top: number; left: number; width: number; height: number };

function useTargetRect(target: string | null, stepIndex: number): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!target) { setRect(null); return; }

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    // Scroll into view first, then measure after animation settles
    const el = document.querySelector<HTMLElement>(`[data-tour-id="${target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t = setTimeout(measure, 350);
      return () => clearTimeout(t);
    }
    measure();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, stepIndex]);

  useEffect(() => {
    if (!target) return;
    const onUpdate = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour-id="${target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener('scroll', onUpdate, { passive: true });
    window.addEventListener('resize', onUpdate, { passive: true });
    return () => {
      window.removeEventListener('scroll', onUpdate);
      window.removeEventListener('resize', onUpdate);
    };
  }, [target]);

  return rect;
}

function TooltipCard({
  step,
  stepIndex,
  totalSteps,
  rect,
  onNext,
  onPrev,
  onSkip,
}: {
  step: (typeof TOUR_STEPS)[0];
  stepIndex: number;
  totalSteps: number;
  rect: Rect | null;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) {
  const router = useRouter();
  const TOOLTIP_W = 380;
  const MARGIN = 16;

  const style = (): React.CSSProperties => {
    if (!rect || step.position === 'center') {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: Math.min(TOOLTIP_W, window.innerWidth - MARGIN * 2),
        zIndex: 10001,
      };
    }

    const vW = window.innerWidth;
    const vH = window.innerHeight;
    const tooltipH = 260;
    const cx = rect.left + rect.width / 2;

    let top: number;
    let left = Math.max(MARGIN, Math.min(cx - TOOLTIP_W / 2, vW - TOOLTIP_W - MARGIN));

    if (step.position === 'bottom') {
      top = rect.top + rect.height + PAD + 16;
      // If it would overflow the bottom, flip to top
      if (top + tooltipH > vH - MARGIN) {
        top = rect.top - PAD - 16 - tooltipH;
      }
    } else {
      // top
      top = rect.top - PAD - 16 - tooltipH;
      if (top < MARGIN) {
        top = rect.top + rect.height + PAD + 16;
      }
    }

    return {
      position: 'fixed',
      top: Math.max(MARGIN, top),
      left,
      width: Math.min(TOOLTIP_W, vW - MARGIN * 2),
      zIndex: 10001,
    };
  };

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const isDashboardStep = step.target !== null;

  const handlePrimary = () => {
    if (step.primaryUrl) {
      router.push(step.primaryUrl);
      onSkip(); // pause tour while navigating
    } else {
      onNext();
    }
  };

  return (
    <div
      style={style()}
      className="bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Progress bar */}
      {isDashboardStep && (
        <div className="h-1 bg-gray-100">
          <div
            className="h-1 bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
            style={{ width: `${((stepIndex) / (totalSteps - 1)) * 100}%` }}
          />
        </div>
      )}

      <div className="px-6 py-5">
        {/* Step counter */}
        {isDashboardStep && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex gap-1">
              {TOUR_STEPS.filter((s) => s.target !== null).map((_, i) => {
                const actualIndex = TOUR_STEPS.findIndex((s) => s.target !== null && i === TOUR_STEPS.filter(x => x.target !== null).indexOf(s));
                return (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i < TOUR_STEPS.filter(x => x.target !== null).indexOf(step)
                        ? 'w-4 bg-indigo-500'
                        : i === TOUR_STEPS.filter(x => x.target !== null).indexOf(step)
                        ? 'w-6 bg-indigo-600'
                        : 'w-4 bg-gray-200'
                    }`}
                  />
                );
              })}
            </div>
            <span className="text-xs text-gray-400 ml-1">
              Step {TOUR_STEPS.filter(x => x.target !== null).indexOf(step) + 1} of {TOUR_STEPS.filter(x => x.target !== null).length}
            </span>
          </div>
        )}

        {/* Title */}
        <h3 className="text-base font-bold text-gray-900 mb-2 leading-tight">{step.title}</h3>

        {/* Description — supports \n as line break */}
        <div className="text-sm text-gray-600 leading-relaxed mb-4 whitespace-pre-line">
          {step.description}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Back */}
          {!isFirst && (
            <button
              onClick={onPrev}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            >
              ← Back
            </button>
          )}

          <div className="flex-1" />

          {/* Skip */}
          {!isLast && (
            <button
              onClick={onSkip}
              className="px-3 py-2 text-sm text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Skip tour
            </button>
          )}

          {/* Primary action */}
          {step.primaryUrl ? (
            <button
              onClick={handlePrimary}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition-colors"
            >
              {step.primaryLabel ?? 'Next →'}
            </button>
          ) : null}

          {/* Next */}
          <button
            onClick={onNext}
            className={`px-4 py-2 text-sm font-semibold rounded-xl shadow-sm transition-colors ${
              isLast
                ? 'text-white bg-emerald-600 hover:bg-emerald-700'
                : 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200'
            }`}
          >
            {isLast ? 'Done ✓' : step.primaryUrl ? 'Next →' : (step.primaryLabel ?? 'Next →')}
          </button>
        </div>
      </div>
    </div>
  );
}

export const TourOverlay: React.FC = () => {
  const { isActive, currentStep, step, totalSteps, nextStep, prevStep, skipTour } = useTour();
  const rect = useTargetRect(step.target, currentStep);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !isActive) return null;

  const hasTarget = !!step.target && !!rect;

  const spotlight = hasTarget && rect ? (
    <>
      {/* 4-piece dark overlay forming a spotlight cutout */}
      {/* Top */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: Math.max(0, rect.top - PAD),
          background: OVERLAY_COLOR,
          zIndex: 9998,
        }}
      />
      {/* Bottom */}
      <div
        style={{
          position: 'fixed',
          top: rect.top + rect.height + PAD,
          left: 0,
          right: 0,
          bottom: 0,
          background: OVERLAY_COLOR,
          zIndex: 9998,
        }}
      />
      {/* Left */}
      <div
        style={{
          position: 'fixed',
          top: rect.top - PAD,
          left: 0,
          width: Math.max(0, rect.left - PAD),
          height: rect.height + PAD * 2,
          background: OVERLAY_COLOR,
          zIndex: 9998,
        }}
      />
      {/* Right */}
      <div
        style={{
          position: 'fixed',
          top: rect.top - PAD,
          left: rect.left + rect.width + PAD,
          right: 0,
          height: rect.height + PAD * 2,
          background: OVERLAY_COLOR,
          zIndex: 9998,
        }}
      />
      {/* Spotlight ring around target */}
      <div
        style={{
          position: 'fixed',
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          borderRadius: SPOTLIGHT_RADIUS,
          boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.7), 0 0 0 6px rgba(99, 102, 241, 0.25)',
          zIndex: 9999,
          pointerEvents: 'none',
          animation: step.pulse ? 'tour-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
    </>
  ) : (
    /* Solid overlay for center (no target) steps */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: OVERLAY_COLOR,
        zIndex: 9998,
      }}
      onClick={skipTour}
    />
  );

  return createPortal(
    <>
      <style>{`
        @keyframes tour-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(99,102,241,0.7), 0 0 0 6px rgba(99,102,241,0.25); }
          50% { box-shadow: 0 0 0 4px rgba(99,102,241,0.9), 0 0 0 12px rgba(99,102,241,0.12); }
        }
      `}</style>

      {spotlight}

      <TooltipCard
        step={step}
        stepIndex={currentStep}
        totalSteps={totalSteps}
        rect={hasTarget ? rect : null}
        onNext={nextStep}
        onPrev={prevStep}
        onSkip={skipTour}
      />
    </>,
    document.body
  );
};
