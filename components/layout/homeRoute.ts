/** Owner decision 2026-11-13: "home" is the Command Center — the logo, the header Home icon and the breadcrumb Home icon all go here. */
export const HOME_ROUTE = '/command-center';

/** Home is active only ON the Command Center itself; /command-center/* pages belong to their own sections. */
export function isHomePath(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === HOME_ROUTE;
}
