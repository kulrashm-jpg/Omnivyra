/**
 * G18 — generic structural outline for longform content.
 *
 * Used by the "Start from outline" creation mode in ManagedIntelligencePage.
 * Pure client-side helper: produces an array of ContentBlocks (heading +
 * paragraph pairs) that the editor consumes via the existing PrefillPayload
 * shape. No API call, no DB write, no AI invocation.
 *
 * Format-specific outlines (e.g., insight-letter vs weekly-board) are
 * intentionally NOT implemented here — keeps the picker pilot tight per the
 * G18 strict rule "Don't implement advanced outlining."
 */

import type { ContentBlock } from './blockTypes';

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `outline-${Math.random().toString(36).slice(2, 11)}-${Date.now().toString(36)}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function heading(text: string): ContentBlock {
  return {
    id: makeId(),
    type: 'heading',
    level: 2,
    text,
    anchor: slugify(text),
  } as ContentBlock;
}

function paragraph(hint: string): ContentBlock {
  return {
    id: makeId(),
    type: 'paragraph',
    html: '',
    hint,
  } as ContentBlock;
}

/**
 * Returns a 5-section outline scaffold (hook → 3 body sections → close).
 * `contentLabel` (e.g., 'newsletter', 'article', 'guide') only affects the
 * paragraph hints so the user knows what to write per section.
 */
export function buildOutlineContentBlocks(contentLabel: string = 'piece'): ContentBlock[] {
  const label = contentLabel.trim() || 'piece';
  return [
    heading(`Hook — open with the most important idea`),
    paragraph(`Write the opening line of this ${label}. State the one idea the reader will take away.`),
    heading(`Section 1 — main argument or insight`),
    paragraph(`Develop the first body section. Lead with the core claim and the evidence behind it.`),
    heading(`Section 2 — evidence or example`),
    paragraph(`Reinforce with a concrete example, data point, or short case the reader can recognise.`),
    heading(`Section 3 — implications`),
    paragraph(`Explain what this means for the reader's situation. Connect the insight to a decision they can make.`),
    heading(`Close — takeaway and call to action`),
    paragraph(`Land the close. Restate the takeaway and tell the reader the next step.`),
  ];
}
