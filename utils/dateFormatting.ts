/**
 * Shared date formatting utilities.
 * Consolidates formatDateShort / formatDate patterns scattered across the codebase.
 */

/** Format ISO date string to "Mar 15" style. */
export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format ISO date string to full locale string. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
