/**
 * Phase 6G-2 (refined) — Assignment Summary panel.
 *
 * Read-only explainability for Intelligent Mix: shows which (format, platform)
 * pairs are supported / restricted / removed and WHY, from the canonical
 * AssignmentDecision contract. Pure presentation — no behavior, no authority of
 * its own.
 */

import React from 'react';
import type { AssignmentDecision } from '../../lib/shared/intelligence/assignmentExplanation';

export function AssignmentSummary({ decisions }: { decisions: AssignmentDecision[] }) {
  if (!decisions || decisions.length === 0) return null;

  const allowed = decisions.filter((d) => d.action === 'ALLOWED');
  const restricted = decisions.filter((d) => d.action === 'RESTRICTED');
  const removed = decisions.filter((d) => d.action === 'REMOVED');

  const Row = ({ d, accent }: { d: AssignmentDecision; accent: string }) => (
    <li className="flex items-start gap-1.5 text-[11px] leading-snug">
      <span className={`mt-0.5 ${accent}`}>•</span>
      <span className="text-gray-600">
        <span className="font-semibold text-gray-800">{d.format} → {d.platform}</span>
        {' — '}{d.reason}
      </span>
    </li>
  );

  return (
    <div className="space-y-3">
      {(allowed.length > 0 || restricted.length > 0) && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-green-600 mb-1">
            Supported assignments ({allowed.length + restricted.length})
          </p>
          <ul className="space-y-0.5">
            {allowed.map((d, i) => <Row key={`a${i}`} d={d} accent="text-green-500" />)}
            {restricted.map((d, i) => <Row key={`r${i}`} d={d} accent="text-amber-500" />)}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-red-500 mb-1">
            Removed assignments ({removed.length})
          </p>
          <ul className="space-y-0.5">
            {removed.map((d, i) => <Row key={`x${i}`} d={d} accent="text-red-400" />)}
          </ul>
        </div>
      )}
    </div>
  );
}
