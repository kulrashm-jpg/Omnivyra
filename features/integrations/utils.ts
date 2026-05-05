export function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not synced yet';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Not synced yet';
  return timestamp.toLocaleString();
}
