/**
 * CanonicalExecutionWeek — a week's worth of canonical execution items.
 * Phase-2 Step-1. Read contract only.
 */

import type { CanonicalExecutionItem } from './CanonicalExecutionItem';

export interface CanonicalExecutionWeek {
  week_number: number;
  week_id: string;            // "wk{n}"
  theme: string;
  objectives: string[];
  /** Reconciled items for this week, in stable visual order. */
  execution_items: CanonicalExecutionItem[];
}
