/**
 * Root view mode from role. Single source of truth for UI visibility.
 * Default (unknown role) → USER.
 */

export type ViewMode =
  | 'USER'
  | 'CREATOR'
  | 'CMO'
  | 'CONTENT_MANAGER'
  | 'SYSTEM';

export function getViewMode(role?: string): ViewMode {
  switch (role) {
    case 'CREATOR':
      return 'CREATOR';
    case 'CMO':
      return 'CMO';
    case 'CONTENT_MANAGER':
      return 'CONTENT_MANAGER';
    case 'SYSTEM':
      return 'SYSTEM';
    default:
      return 'USER';
  }
}
