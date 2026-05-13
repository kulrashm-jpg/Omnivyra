import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { getAuthToken } from '../utils/getAuthToken';
import { getSupabaseBrowser } from '../lib/supabaseBrowser';
import {
  AUTH_ERROR_CODE,
  getAuthErrorCode,
  shouldForceSignOut,
  type AuthErrorCode,
} from '../utils/authErrors';
import {
  clearAuthScopedAppState,
  getUserScopedLocalStorage,
  setUserScopedLocalStorage,
} from '../utils/authStorage';
import { assertAuthBootstrapProbeSkipped, isAuthBootstrapPath } from '../utils/authIntegrityGuards';
import {
  initialAuthFsm,
  transitionAuthFsm,
  type AuthFsmContext,
  type AuthFsmEvent,
  type AuthFsmState,
} from '../utils/authStateMachine';
import { singleFlight } from '../lib/auth/singleFlightRefresh';

/**
 * Retry-guard configuration for the /api/company-profile?mode=list probe.
 *
 * Why this exists
 * ───────────────
 * The pre-Phase-2.B context treated EVERY 401 as a ghost session, ran
 * `signOut()` synchronously, and let the Next.js router redirect to /login.
 * When /login then validated the persisted Supabase session, it would
 * INSTANTLY redirect back to /command-center — and the cycle repeated until
 * the user closed the tab. Any auth bug that was actually a 401 (schema
 * drift, USER_NOT_FOUND, USER_INVITED) presented as an indistinguishable
 * "log in works, then sends you back to the login page" loop.
 *
 * The retry guard cuts the loop at three places:
 *   1. **Single-flight**: only one company-profile fetch in flight at a
 *      time, via {@link refreshInFlightRef}. (Pre-existing — kept.)
 *   2. **Sign-out gating**: only INVALID_SESSION / ACCOUNT_DELETED /
 *      ACCOUNT_DISABLED responses call signOut(). Everything else
 *      preserves the session and surfaces a visible error in the UI.
 *   3. **Refresh cap**: a hard cap on consecutive non-OK responses before
 *      we stop hammering the endpoint and tell the user.
 */
const REFRESH_FAILURE_CAP = 4;
const REFRESH_FAILURE_COOLDOWN_MS = 30_000;

export interface AuthErrorState {
  /** Canonical code so the UI can render specific copy. */
  code:    AuthErrorCode;
  /** Server-supplied details (already user-safe). */
  details: string | null;
  /** When the error landed — drives the retry-cooldown display. */
  occurredAt: number;
}

type UserContext = {
  userId: string;
  role: 'admin' | 'user';
  companyIds: string[];
  defaultCompanyId: string;
};

type CompanyOption = {
  company_id: string;
  name: string;
};

type PermissionAction =
  | 'CREATE_CAMPAIGN'
  | 'GENERATE_RECOMMENDATIONS'
  | 'APPROVE_CONTENT'
  | 'SCHEDULE_CONTENT'
  | 'CREATE_CONTENT'
  | 'ENGAGE'
  | 'MANAGE_EXTERNAL_APIS'
  | 'VIEW_OMNIVYRA';

const normalizeCompanyRole = (role?: string | null) => {
  if (!role) return null;
  const upper = role.toUpperCase();
  if (upper === 'ADMIN') return 'COMPANY_ADMIN';
  // SUPER_ADMIN in user_company_roles means the row was miscreated during onboarding.
  // Real platform super admins authenticate via the super-admin cookie path
  // (loadContentArchitectContext), not via normal Supabase auth. Downgrade silently.
  if (upper === 'SUPER_ADMIN') return 'COMPANY_ADMIN';
  if (upper === 'CONTENT_MANAGER') return 'CONTENT_CREATOR';
  if (upper === 'CONTENT_PLANNER') return 'CONTENT_CREATOR';
  if (upper === 'CONTENT_ENGAGER') return 'VIEW_ONLY';
  if (upper === 'VIEWER') return 'VIEW_ONLY';
  return upper;
};

const permissionMatrix: Record<PermissionAction, string[]> = {
  CREATE_CAMPAIGN: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR', 'CONTENT_REVIEWER', 'CONTENT_PUBLISHER'],
  GENERATE_RECOMMENDATIONS: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  APPROVE_CONTENT: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_REVIEWER'],
  SCHEDULE_CONTENT: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_PUBLISHER'],
  CREATE_CONTENT: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'CONTENT_CREATOR'],
  ENGAGE: ['SUPER_ADMIN', 'COMPANY_ADMIN', 'VIEW_ONLY'],
  MANAGE_EXTERNAL_APIS: ['SUPER_ADMIN', 'COMPANY_ADMIN'],
  VIEW_OMNIVYRA: ['SUPER_ADMIN'],
};

const hasPermissionForRole = (role: string, action: PermissionAction) => {
  if (!role) return false;
  return permissionMatrix[action].includes(role);
};

type CompanyContextValue = {
  user: UserContext | null;
  userName: string;
  userRole: string | null;
  companies: CompanyOption[];
  selectedCompanyId: string;
  selectedCompanyName: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** true once the Supabase session has been validated against the backend.
   *  Consumers should show a loading/blank state until this is true to prevent
   *  a flash of protected or unauthenticated content. */
  authChecked: boolean;
  /**
   * true once `/api/company-profile?mode=list` has actually completed a fetch
   * for the current auth session (success OR explicit empty). Distinguishes
   * "we haven't asked the server yet" from "we asked and the user has 0
   * companies". Consumers gating onboarding redirects MUST wait for this to
   * avoid the race where `isLoading` flips back to false (e.g., on auth-flow
   * pages) before companies have been resolved.
   */
  companiesResolved: boolean;
  isAdmin: boolean;
  /**
   * Set when /api/company-profile returned a non-OK response that should
   * NOT force a sign-out (USER_NOT_FOUND, USER_INVITED, SCHEMA_MISMATCH,
   * PROFILE_LOAD_FAILED, transient failures). Consumers render a visible
   * error UI keyed on `code`, NEVER redirect-loop.
   */
  authError: AuthErrorState | null;
  /** Auth FSM snapshot — debugging / dev panel surface. */
  authFsm: AuthFsmContext;
  /** Convenient shorthand for FSM state. */
  authFsmState: AuthFsmState;
  /** Clear the auth-error state and trigger a fresh fetch. */
  retryAuthError: () => void;
  setSelectedCompanyId: (companyId: string) => void;
  refreshCompanies: () => Promise<void>;
  hasPermission: (action: PermissionAction) => boolean;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

const resolveStoredCompanyId = (userId?: string | null): string => {
  if (typeof window === 'undefined') return '';
  return (
    getUserScopedLocalStorage('selected_company_id', userId) ||
    getUserScopedLocalStorage('company_id', userId) ||
    ''
  );
};

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [user, setUser] = useState<UserContext | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [rolesByCompany, setRolesByCompany] = useState<Record<string, string>>({});
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdInternal] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  // True once the companies fetch has actually completed for the current
  // auth session. Distinguishes "not yet queried" from "queried and empty".
  // Reset to false on signout (see auth subscription effect below).
  // Also acts as the canonical re-fire gate for the effect that triggers
  // refreshCompanies — we don't have a separate "loaded" ref any more
  // because the ref-based gate could leave the app stuck on a spinner
  // forever if a refresh failed transiently.
  const [companiesResolved, setCompaniesResolved] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorState | null>(null);
  const [authFsm, setAuthFsm] = useState<AuthFsmContext>(() => initialAuthFsm());

  /**
   * Single funnel for FSM transitions. Every state change goes through here
   * so we get structured event logging + illegal-transition detection in
   * one place. Avoids the "five booleans encoding a state" anti-pattern.
   */
  const dispatchAuth = (event: AuthFsmEvent) => {
    setAuthFsm((prev) => {
      const { next, changed, illegal } = transitionAuthFsm(prev, event);
      if (illegal && typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        // Dev-mode only; prod just sees the no-op.
        console.warn('[auth_fsm_illegal_transition]', illegal);
      }
      if (changed) {
        if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
          console.debug('[auth_fsm_transition]', {
            event:  event.type,
            from:   prev.state,
            to:     next.state,
            count:  next.transitionCount,
          });
        }
      }
      return next;
    });
  };

  // Online/offline event listener — drives the FSM's offline decoration so
  // a flaky network blip doesn't trigger destructive sign-outs.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline  = () => dispatchAuth({ type: 'ONLINE' });
    const handleOffline = () => dispatchAuth({ type: 'OFFLINE' });
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // Seed the FSM with the current online state.
    if (!navigator.onLine) dispatchAuth({ type: 'OFFLINE' });
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  // Single-flight guard for refreshCompanies — ensures concurrent effect
  // fires (e.g. pathname + auth-state changing in the same tick) do not
  // launch overlapping fetches. NOT a "loaded" cache — the only authority
  // for "we already fetched" is companiesResolved.
  const refreshInFlightRef = useRef(false);
  const authIdentityRef = useRef<string | null>(null);
  // Retry-guard state. Tracks consecutive non-OK fetches so we can stop
  // hammering /api/company-profile after REFRESH_FAILURE_CAP attempts.
  // Cleared on success or on explicit retryAuthError().
  const consecutiveFailureRef = useRef(0);
  const failureCooldownUntilRef = useRef<number>(0);
  // Counter the effect watches so transient-failure retries (e.g. dev-mode
  // 404 before the API route compiles) re-fire the gating effect with
  // fresh state — avoids the stale-closure pitfall of reading
  // companiesResolved from inside refreshCompanies' setTimeout callback.
  const [transientRetryTick, setTransientRetryTick] = useState(0);

  const selectedCompanyName = useMemo(() => {
    const match = companies.find((company) => company.company_id === selectedCompanyId);
    return match?.name || '';
  }, [companies, selectedCompanyId]);

  const setSelectedCompanyId = (companyId: string) => {
    if (!companyId) return;
    const isAllowedCompany = !!rolesByCompany[companyId];
    const isContentArchitect = user?.userId === 'content_architect' || userRole === 'CONTENT_ARCHITECT';
    if (userRole && userRole !== 'SUPER_ADMIN' && !isContentArchitect && !isAllowedCompany) {
      return;
    }
    setSelectedCompanyIdInternal(companyId);
    setUserRole(rolesByCompany[companyId] || null);
    if (typeof window !== 'undefined') {
      setUserScopedLocalStorage('selected_company_id', user?.userId ?? null, companyId);
      setUserScopedLocalStorage('company_id', user?.userId ?? null, companyId);
      window.localStorage.removeItem('selected_campaign_id');
    }
    if (process.env.NODE_ENV === 'development') {
      const match = companies.find((company) => company.company_id === companyId);
      console.log('SELECTED_COMPANY', { companyId, companyName: match?.name || '' });
    }
  };

  const refreshCompanies = async () => {
    setIsLoading(true);
    // Track whether the fetch reached a resolved state (success OR explicit
    // failure). Distinct from `isLoading=false` which fires regardless.
    // Transient failures (404 / 5xx after retries) should leave this false
    // so consumers don't treat the spinner-state as a real "no companies".
    let resolved = false;
    try {
      if (!isAuthenticated) {
        setUser(null);
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        resolved = true;
        return;
      }

      // getAuthToken may transiently return null when multiple components
      // race for the Supabase auth lock. Retry once with a short delay
      // before treating it as a true "no token" state — otherwise we'd
      // wrongly clear `user` to null and leave the spinner stuck even
      // though a valid session is present.
      let fbToken = await getAuthToken();
      if (!fbToken) {
        await new Promise((r) => setTimeout(r, 250));
        fbToken = await getAuthToken();
      }
      if (!fbToken) {
        // No bearer token — may be content-architect cookie path. Cookie-
        // based Supabase sessions are also handled by the API route via
        // `credentials: 'include'`, but we only reach this branch after
        // two failed token fetches, so try the architect path.
        const asArchitect = await loadContentArchitectContext();
        if (!asArchitect) {
          setUser(null);
          setUserName('');
          setCompanies([]);
          setSelectedCompanyIdInternal('');
          setUserRole(null);
          setRolesByCompany({});
        }
        resolved = true;
        return;
      }

      // Retry up to 3 times on transient errors (404 / 5xx). The 404 case
      // is common in `next dev` when the API route hasn't been compiled
      // yet on the first hit. Each request is bounded by an 8s timeout
      // so the refresh can never hang on a stalled API route. After all
      // retries fail, we leave companiesResolved=false (so the gating
      // effect can re-fire) AND schedule a delayed retry — this prevents
      // the user from being stuck on a buffering spinner if the path
      // never changes.
      const fetchWithTimeout = async (url: string, init: RequestInit, ms: number) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try {
          return await fetch(url, { ...init, signal: ctrl.signal });
        } finally {
          clearTimeout(t);
        }
      };
      // Wrap the actual /api/company-profile fetch in two reliability
      // primitives:
      //   1. singleFlight('company-profile-list') — concurrent callers
      //      (e.g. a route change firing while a retry is mid-flight)
      //      share the same Promise instead of starting parallel fetches.
      //   2. The existing 3-attempt loop — kept as-is for transient 404 /
      //      5xx handling. The retryPolicy module is available for
      //      callers that want exponential backoff; this loop is the
      //      lightweight in-context variant.
      const listRes = await singleFlight<Response | null>(
        'company-profile-list',
        async () => {
          let attemptRes: Response | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              attemptRes = await fetchWithTimeout(
                '/api/company-profile?mode=list',
                {
                  credentials: 'include',
                  headers: { Authorization: `Bearer ${fbToken}` },
                },
                8000,
              );
            } catch {
              attemptRes = null;
            }
            if (attemptRes && attemptRes.status !== 404 && attemptRes.status < 500) break;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
          return attemptRes;
        },
      );
      if (authFsm.state === 'degraded' || authFsm.state === 'blocked') {
        dispatchAuth({ type: 'RETRY' });
      }

      if (!listRes) {
        // All retries exhausted with transient errors (404 / 5xx / abort).
        // Don't clear cached state — the dev server is likely still
        // compiling the API route. Leave companiesResolved=false so the
        // next effect fire (auth state change, pathname change, or the
        // transientRetryTick bump below) re-fires refreshCompanies.
        // Bump the tick after a delay so a user sitting on a static page
        // still recovers without a manual reload — the effect re-runs
        // with fresh state values, avoiding stale-closure issues.
        setTimeout(() => setTransientRetryTick((t) => t + 1), 2000);
        return;
      }

      if (!listRes.ok) {
        let errData: unknown = null;
        try { errData = await listRes.json(); } catch { /* non-JSON — ignore */ }

        // Don't force sign-out while the auth callback / onboarding flow is
        // still in progress — the user row may not have been synced yet.
        const isOnAuthFlow = typeof window !== 'undefined' &&
          (window.location.pathname.startsWith('/auth/') ||
           window.location.pathname.startsWith('/onboarding/'));

        // Sign-out gating — ONLY codes in the SESSION_FATAL set trigger
        // signOut. USER_INVITED, USER_NOT_FOUND, SCHEMA_MISMATCH,
        // PROFILE_LOAD_FAILED, and uncoded 401/403 responses preserve
        // the session and surface a visible error the user can retry.
        if (shouldForceSignOut(listRes, errData)) {
          try { await getSupabaseBrowser().auth.signOut(); } catch { /* ignore */ }
          setIsAuthenticated(false);
          setAuthChecked(true);
          setAuthError(null);
          const fatalCode = getAuthErrorCode(listRes, errData) ?? AUTH_ERROR_CODE.INVALID_SESSION;
          dispatchAuth({ type: 'AUTH_FAIL_FATAL', code: fatalCode });
        } else {
          // Non-fatal failure — preserve session, surface a visible error
          // unless we're inside the auth callback / onboarding flow (those
          // pages drive their own UI and a banner here would be confusing).
          const code = getAuthErrorCode(listRes, errData)
            ?? (listRes.status >= 500
              ? AUTH_ERROR_CODE.PROFILE_LOAD_FAILED
              : AUTH_ERROR_CODE.USER_NOT_FOUND);
          const details = (typeof errData === 'object' && errData !== null && typeof (errData as Record<string, unknown>).details === 'string')
            ? ((errData as Record<string, unknown>).details as string)
            : null;
          if (!isOnAuthFlow) {
            setAuthError({ code, details, occurredAt: Date.now() });
          }
          // Trip the retry guard. After REFRESH_FAILURE_CAP consecutive
          // non-OK responses, refuse further auto-retries for the
          // cooldown window — the user must click "Retry".
          consecutiveFailureRef.current += 1;
          if (consecutiveFailureRef.current >= REFRESH_FAILURE_CAP) {
            failureCooldownUntilRef.current = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
            dispatchAuth({ type: 'RETRY_EXHAUSTED' });
          } else {
            dispatchAuth({ type: 'AUTH_FAIL_RETRYABLE', code, details: details ?? undefined });
          }
        }
        setUser(null);
        setUserName('');
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        resolved = true;
        return;
      }
      // Success — reset retry-guard counters.
      consecutiveFailureRef.current = 0;
      failureCooldownUntilRef.current = 0;
      if (authError) setAuthError(null);
      dispatchAuth({ type: 'AUTH_SUCCESS' });

      const listData = await listRes.json();
      const list: CompanyOption[] = listData?.companies || [];
      type RoleEntry = { company_id: string; role: string };
      const listRoles: RoleEntry[] = listData?.rolesByCompany || [];
      const activeCompanyId = typeof listData?.activeCompanyId === 'string' ? listData.activeCompanyId : '';

      if (list.length === 0) {
        setUser(null);
        setUserName('');
        setCompanies([]);
        setSelectedCompanyIdInternal('');
        setUserRole(null);
        setRolesByCompany({});
        resolved = true;
        return;
      }

      const rolesMap = listRoles.reduce<Record<string, string>>((acc, entry) => {
        const normalizedRole = normalizeCompanyRole(entry?.role);
        if (entry?.company_id && normalizedRole) acc[entry.company_id] = normalizedRole;
        return acc;
      }, {});
      const companyIds = list.map((c) => c.company_id);
      const firstRole = Object.values(rolesMap)[0] || 'COMPANY_ADMIN';

      // Resolve display name from API response or Supabase user
      let resolvedName = listData?.userName || '';
      if (!resolvedName) {
        try {
          const { data: { user } } = await getSupabaseBrowser().auth.getUser();
          resolvedName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
        } catch { resolvedName = 'User'; }
      }
      setUserName(resolvedName);

      const resolvedUserId = listData?.userId || fbToken;
      const nextUser: UserContext = {
        userId: resolvedUserId, // prefer DB id if returned by API
        role: firstRole === 'SUPER_ADMIN' || firstRole === 'COMPANY_ADMIN' ? 'admin' : 'user',
        companyIds,
        defaultCompanyId: companyIds[0] || '',
      };

      setUser(nextUser);
      setCompanies(list);
      setRolesByCompany(rolesMap);

      const stored = resolveStoredCompanyId(resolvedUserId);
      const resolvedId =
        activeCompanyId && list.some((c) => c.company_id === activeCompanyId)
          ? activeCompanyId
          : stored && list.some((c) => c.company_id === stored)
            ? stored
            : companyIds[0] || '';
      setUserRole(rolesMap[resolvedId] || firstRole);
      if (resolvedId) {
        setSelectedCompanyIdInternal(resolvedId);
        if (typeof window !== 'undefined') {
          setUserScopedLocalStorage('selected_company_id', resolvedUserId, resolvedId);
          setUserScopedLocalStorage('company_id', resolvedUserId, resolvedId);
        }
      }
      resolved = true;
    } catch {
      console.warn('Failed to load company context');
    } finally {
      setIsLoading(false);
      // Only mark resolved when the fetch actually reached a definitive
      // outcome (success, empty result, real auth failure, no-token, or
      // unauthenticated). Transient failures (404 / 5xx after retries)
      // leave `resolved=false` so consumers don't treat the empty
      // companies array as a real "no companies" result and prematurely
      // redirect to /onboarding/company.
      if (resolved) setCompaniesResolved(true);
    }
  };

  const loadContentArchitectContext = async () => {
    try {
      const res = await fetch('/api/company-profile?mode=list', { credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      const list = data?.companies || [];
      if (list.length === 0) return false;
      type RoleEntry = { company_id: string; role: string };
      const roles = ((data?.rolesByCompany || []) as RoleEntry[]).reduce<Record<string, string>>(
        (acc, entry) => {
          if (entry?.company_id) acc[entry.company_id] = entry.role || 'CONTENT_ARCHITECT';
          return acc;
        },
        {}
      );
      list.forEach((c: CompanyOption) => {
        if (!roles[c.company_id]) roles[c.company_id] = 'CONTENT_ARCHITECT';
      });
      const companyIds = list.map((c: CompanyOption) => c.company_id);
      const firstRole = Object.values(roles)[0] || 'CONTENT_ARCHITECT';
      const isSuperAdmin = firstRole === 'SUPER_ADMIN';
      setUser({
        userId: isSuperAdmin ? 'legacy_super_admin' : 'content_architect',
        role: 'admin',
        companyIds,
        defaultCompanyId: companyIds[0] || '',
      });
      setUserName(isSuperAdmin ? 'Super Admin' : 'Content Architect');
      setCompanies(list);
      setRolesByCompany(roles);
      setUserRole(isSuperAdmin ? 'SUPER_ADMIN' : 'CONTENT_ARCHITECT');
      const storageUserId = isSuperAdmin ? 'legacy_super_admin' : 'content_architect';
      const stored = resolveStoredCompanyId(storageUserId);
      const fallbackId = companyIds[0] || '';
      const resolvedId = stored && companyIds.includes(stored) ? stored : fallbackId;
      if (resolvedId) {
        setSelectedCompanyIdInternal(resolvedId);
        if (typeof window !== 'undefined') {
          setUserScopedLocalStorage('selected_company_id', storageUserId, resolvedId);
          setUserScopedLocalStorage('company_id', storageUserId, resolvedId);
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let probeInFlight = false; // Prevents race: don't mark authChecked while INITIAL_SESSION probe is pending

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const nextAuthId = session.user?.id ?? null;
        if (authIdentityRef.current && nextAuthId && authIdentityRef.current !== nextAuthId) {
          clearAuthScopedAppState();
          setCompaniesResolved(false);
          setUser(null);
          setUserName('');
          setCompanies([]);
          setSelectedCompanyIdInternal('');
          setUserRole(null);
          setRolesByCompany({});
        }
        authIdentityRef.current = nextAuthId;
        // On INITIAL_SESSION (page load with existing cookie-session) we
        // validate against the backend so ghost / soft-deleted sessions are
        // caught early.  For SIGNED_IN (magic-link, password login) we skip
        // the probe because the callback page hasn't had a chance to call
        // sync-supabase-user yet — probing would race and 401.
        // TOKEN_REFRESHED is also safe to skip.
        const currentPathname = typeof window !== 'undefined' ? window.location.pathname : '';
        const isAuthBootstrapPage = isAuthBootstrapPath(currentPathname);
        assertAuthBootstrapProbeSkipped(currentPathname, isAuthBootstrapPage);

        if (event === 'INITIAL_SESSION' && !isAuthBootstrapPage) {
          probeInFlight = true;
          try {
            const probe = await fetch('/api/auth/post-login-route', {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });
            if (probe.status === 401) {
              await supabase.auth.signOut();
              setIsAuthenticated(false);
              setAuthChecked(true);
              probeInFlight = false;
              return;
            }
          } catch {
            // Network error: optimistically allow; refreshCompanies catches 401 later.
          }
          probeInFlight = false;
        }
        setIsAuthenticated(true);
        setAuthChecked(true);
        return;
      }
      // No session — but if a probe is in flight, skip this event (it's a transient null)
      if (probeInFlight) return;
      authIdentityRef.current = null;
      clearAuthScopedAppState();
      // No session — check for content-architect cookie session
      const asArchitect = await loadContentArchitectContext();
      setIsAuthenticated(asArchitect);
      setAuthChecked(true);
    });

    return () => { subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    if (!isAuthenticated) {
      refreshInFlightRef.current = false;
      setIsLoading(false);
      setCompaniesResolved(false); // reset for next auth session
      setUser(null);
      setUserName('');
      setCompanies([]);
      setSelectedCompanyIdInternal('');
      setUserRole(null);
      setRolesByCompany({});
      return;
    }
    // Don't fetch company data while on auth/onboarding pages.
    // The callback page needs to finish sync-supabase-user before the
    // company-profile API can find the user. Fetching prematurely
    // returns 401 → clears company data → stale context on /dashboard.
    // Instead, delay until the user navigates to a real protected page.
    const p = router.pathname;
    const isAuthFlowPage =
      p.startsWith('/auth/') ||
      p.startsWith('/onboarding/') ||
      p.startsWith('/super-admin/') ||
      p === '/login' ||
      p === '/create-account';
    if (isAuthFlowPage) {
      setIsLoading(false);
      return;
    }
    // Skip if we already have a definitive answer for this auth session.
    // companiesResolved becomes true on success / empty / auth-fail (terminal
    // outcomes only), and stays false on transient failures so this effect
    // — re-firing on pathname / auth-state changes — naturally retries.
    if (companiesResolved) return;
    // Single-flight guard. If a refresh is already in flight, skip.
    if (refreshInFlightRef.current) return;
    // Retry-guard cooldown — after REFRESH_FAILURE_CAP consecutive failures,
    // pause auto-retries until the user clicks "Retry" or the cooldown
    // window expires. Stops auth-error redirect storms before they start.
    if (Date.now() < failureCooldownUntilRef.current) return;
    refreshInFlightRef.current = true;
    refreshCompanies().finally(() => {
      refreshInFlightRef.current = false;
    });
  }, [isAuthenticated, authChecked, router.pathname, companiesResolved, transientRetryTick]);

  const retryAuthError = (): void => {
    consecutiveFailureRef.current = 0;
    failureCooldownUntilRef.current = 0;
    setAuthError(null);
    setCompaniesResolved(false);
    setTransientRetryTick((t) => t + 1);
  };

  const value = useMemo(
    () => ({
      user,
      userName,
      userRole,
      companies,
      selectedCompanyId,
      selectedCompanyName,
      isLoading,
      isAuthenticated,
      authChecked,
      companiesResolved,
      isAdmin: userRole === 'SUPER_ADMIN' || userRole === 'COMPANY_ADMIN',
      authError,
      authFsm,
      authFsmState: authFsm.state,
      retryAuthError,
      setSelectedCompanyId,
      refreshCompanies,
      hasPermission: (action: PermissionAction) => hasPermissionForRole(userRole, action),
    }),
    [user, userName, userRole, companies, selectedCompanyId, selectedCompanyName, isLoading, isAuthenticated, authChecked, companiesResolved, authError, authFsm]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};

export const useCompanyContext = (): CompanyContextValue => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompanyContext must be used within CompanyProvider');
  }
  return context;
};
