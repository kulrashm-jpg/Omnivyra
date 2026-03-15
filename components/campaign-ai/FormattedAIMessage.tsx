/**
 * Renders AI message with proper structure: greeting, objective, theme, formats, reach, question.
 * Extracted from CampaignAIChat for maintainability.
 */

import React from 'react';

export function formatPlanMarkersForDisplay(raw: string): string {
  const t = String(raw ?? '');
  if (!t) return '';
  // Keep backend markers for parsing, but do not show them to the user.
  // Replace the end marker with user-friendly text.
  return t
    .replace(/^\s*BEGIN_12WEEK_PLAN\s*$/gmi, '')
    .replace(/^\s*END_12WEEK_PLAN\s*$/gmi, 'END of your weekly plan')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface FormattedAIMessageProps {
  message: string;
  className?: string;
}

export function FormattedAIMessage({ message, className = '' }: FormattedAIMessageProps) {
  const renderInline = (text: string): React.ReactNode => {
    const segments: React.ReactNode[] = [];
    let s = text;
    while (s) {
      const bi = s.indexOf('**');
      const ii = s.indexOf('*');
      const nextBi = bi >= 0 ? bi : s.length;
      const nextIi = (ii >= 0 && (ii !== 0 || s[1] !== '*')) ? ii : s.length;
      const next = Math.min(nextBi, nextIi);
      if (next < s.length) {
        if (next > 0) segments.push(s.slice(0, next));
        if (s[next] === '*') {
          if (s[next + 1] === '*') {
            const end = s.indexOf('**', next + 2);
            if (end >= 0) {
              segments.push(<strong key={segments.length}>{s.slice(next + 2, end)}</strong>);
              s = s.slice(end + 2);
              continue;
            }
          } else {
            const end = s.indexOf('*', next + 1);
            if (end >= 0 && end !== next + 1) {
              segments.push(<em key={segments.length}>{s.slice(next + 1, end)}</em>);
              s = s.slice(end + 1);
              continue;
            }
          }
        }
      }
      segments.push(s);
      break;
    }
    return <>{segments}</>;
  };
  const displayMessage = formatPlanMarkersForDisplay(message);
  const paragraphs = displayMessage.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={`text-sm space-y-4 leading-relaxed ${className}`}>
      {paragraphs.map((p, i) => {
        const isGreeting = p.startsWith('Hello!') || (i === 0 && p.includes('help you turn'));
        const isTheme = p.startsWith('I see your theme:');
        const isSection = /^\*\*(Target regions|Suggested formats|Estimated reach)/.test(p);
        const isQuestion = /^\*\*(First question|Next question|Question \d+):/i.test(p);
        return (
          <div
            key={i}
            className={
              isGreeting ? 'font-semibold text-gray-900' :
              isTheme ? 'italic text-gray-700 pl-1 border-l-2 border-indigo-200' :
              isSection ? 'text-gray-800' :
              isQuestion ? 'font-semibold text-indigo-800 mt-2 pt-2 border-t border-gray-200' :
              'text-gray-700'
            }
          >
            {renderInline(p)}
          </div>
        );
      })}
    </div>
  );
}
