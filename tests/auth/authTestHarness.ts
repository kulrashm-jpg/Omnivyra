import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

export const BASE_URL = process.env.AUTH_E2E_BASE_URL || 'http://127.0.0.1:3000';
export const TEST_PASSWORD = 'CodexTest9!';
const DEFAULT_TIMEOUT_MS = Number(process.env.AUTH_E2E_TIMEOUT_MS ?? 120_000);
const POLL_INTERVAL_MS = 250;

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

assert(supabaseUrl, 'SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required for auth E2E tests');
assert(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required for auth E2E tests');

export const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type BrowserAuthSnapshot = {
  url: string;
  identity: { email: string | null; userId: string | null };
  cookies: string[];
  localStorageKeys: string[];
  sessionStorageKeys: string[];
  orgContext: {
    status: number | null;
    userId: string | null;
    companies: Array<{ company_id: string; name?: string }>;
  };
};

type CookieExpectation = {
  omnivyra: 'present' | 'absent';
  supabase: 'present' | 'absent';
};

export function testEmail(prefix: string): string {
  const safePrefix = prefix.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 10);
  return `${safePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@qa.co`;
}

export async function assertDevServer(): Promise<void> {
  const res = await fetch(BASE_URL);
  assert(res.status < 500, `dev server is not healthy at ${BASE_URL}; status=${res.status}`);
}

export async function warmAuthRoutes(): Promise<void> {
  for (const path of ['/login', '/create-account', '/auth/callback?warmup=1']) {
    await fetch(`${BASE_URL}${path}`).catch(() => undefined);
  }
}

export async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await adminSupabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  assert.ifError(error);
  assert(data.user?.id, 'confirmed test user was not created');
  return data.user.id;
}

export async function createSignupLink(email: string): Promise<string> {
  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: 'signup',
    email,
    password: TEST_PASSWORD,
    options: { redirectTo: `${BASE_URL}/auth/callback` },
  });
  assert.ifError(error);
  assert(data.properties?.action_link, 'Supabase did not return a signup action_link');
  return data.properties.action_link;
}

export async function cleanupUsersByEmail(emails: string[]): Promise<void> {
  for (const email of emails) {
    const { data } = await adminSupabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = data?.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user?.id) await adminSupabase.auth.admin.deleteUser(user.id).catch(() => undefined);
  }
}

export async function withBrowser<T>(
  fn: (browser: Browser, context: BrowserContext, page: Page) => Promise<T>,
): Promise<T> {
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
  const context = await browser.newContext();
  const page = await context.newPage();
  configurePage(page);
  try {
    return await fn(browser, context, page);
  } catch (error) {
    await preserveFailureArtifacts(context).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

export function configurePage(page: Page): void {
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT_MS);
}

export async function gotoApp(page: Page, path: string): Promise<void> {
  const target = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  await page.goto(target, { waitUntil: 'commit', timeout: DEFAULT_TIMEOUT_MS });
}

export async function login(page: Page, email: string): Promise<void> {
  await gotoApp(page, '/login');
  await page.locator('#email').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('form').filter({ has: page.locator('#password') }).locator('button[type="submit"]').click();
  await waitForAuthenticatedUser(page, email, 'password login');
}

export async function openSignupAndWaitForIsolation(page: Page): Promise<void> {
  await gotoApp(page, '/create-account');
  await page.locator('input[placeholder="you@company.com"]').waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  await waitForLoggedOutState(page, 'opening /create-account');
}

export async function logoutInBrowser(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    const client = (window as any).__supabase_browser_client__;
    if (client) await client.auth.signOut().catch(() => undefined);
    localStorage.clear();
    sessionStorage.clear();
  });
  await gotoApp(page, '/login');
  await waitForLoggedOutState(page, 'logout');
}

export async function verifySignupLink(page: Page, actionLink: string, expectedEmail: string): Promise<void> {
  await gotoApp(page, actionLink);
  await waitForAuthCallbackCompletion(page, `valid verification for ${expectedEmail}`);
  await waitForAuthenticatedUser(page, expectedEmail, 'verification callback');
}

export async function replayExpiredLink(page: Page, actionLink: string): Promise<void> {
  await gotoApp(page, actionLink);
  await waitForAuthCallbackCompletion(page, 'expired verification replay');
  await waitForLoggedOutState(page, 'expired verification replay');
}

export async function waitForAuthCallbackCompletion(page: Page, label: string): Promise<void> {
  await poll(
    async () => !new URL(page.url()).pathname.startsWith('/auth/callback'),
    `auth callback did not finish: ${label}; url=${page.url()}`,
    DEFAULT_TIMEOUT_MS,
  );
}

export async function waitForAuthenticatedUser(page: Page, expectedEmail: string, label = 'auth'): Promise<void> {
  let lastState: BrowserAuthSnapshot | null = null;
  await poll(async () => {
    const state = await snapshot(page);
    lastState = state;
    return (
      state.identity.email === expectedEmail &&
      state.cookies.includes('omnivyra_session') &&
      state.cookies.some((name) => name.startsWith('sb-')) &&
      !state.localStorageKeys.includes('selected_company_id') &&
      !state.localStorageKeys.includes('company_id')
    );
  }, () => `expected authenticated user ${expectedEmail} during ${label}. Last state: ${formatSnapshot(lastState)}`, DEFAULT_TIMEOUT_MS);
}

export async function waitForLoggedOutState(page: Page, label = 'logout'): Promise<void> {
  let lastState: BrowserAuthSnapshot | null = null;
  await poll(async () => {
    const state = await snapshot(page);
    lastState = state;
    return (
      state.identity.email === null &&
      !state.cookies.includes('omnivyra_session') &&
      !state.cookies.some((name) => name.startsWith('sb-')) &&
      !state.localStorageKeys.some((key) => key.startsWith('sb-')) &&
      !state.localStorageKeys.includes('selected_company_id') &&
      !state.localStorageKeys.includes('company_id') &&
      state.sessionStorageKeys.length === 0
    );
  }, () => `expected logged-out state during ${label}. Last state: ${formatSnapshot(lastState)}`, DEFAULT_TIMEOUT_MS);
}

export async function waitForCompanyContext(page: Page, label = 'company context'): Promise<void> {
  let lastState: BrowserAuthSnapshot | null = null;
  await poll(async () => {
    const state = await snapshot(page);
    lastState = state;
    return state.identity.email === null || state.orgContext.status === 200;
  }, () => `company context did not stabilize during ${label}. Last state: ${formatSnapshot(lastState)}`, DEFAULT_TIMEOUT_MS);
}

export async function waitForSupabaseClient(page: Page, label = 'Supabase client'): Promise<void> {
  await poll(
    async () => page.evaluate(() => Boolean((window as any).__supabase_browser_client__)).catch(() => false),
    `Supabase browser client did not initialize during ${label}; url=${page.url()}`,
    DEFAULT_TIMEOUT_MS,
  );
}

export async function waitForSupabaseBrowserSession(page: Page, expectedEmail: string, label = 'Supabase session'): Promise<void> {
  let lastState: BrowserAuthSnapshot | null = null;
  await poll(async () => {
    const state = await snapshot(page);
    lastState = state;
    return (
      state.identity.email === expectedEmail &&
      state.localStorageKeys.some((key) => key.startsWith('sb-'))
    );
  }, () => `Supabase browser session did not persist during ${label}. Last state: ${formatSnapshot(lastState)}`, DEFAULT_TIMEOUT_MS);
}

export async function seedLegacyCompanyKeys(page: Page, value: string): Promise<void> {
  await poll(async () => {
    try {
      await page.evaluate((companyId) => {
        localStorage.setItem('selected_company_id', companyId);
        localStorage.setItem('company_id', companyId);
      }, value);
      return true;
    } catch {
      return false;
    }
  }, `could not seed legacy company keys with ${value}`, DEFAULT_TIMEOUT_MS);
}

export async function snapshot(page: Page): Promise<BrowserAuthSnapshot> {
  const [identity, localStorageKeys, sessionStorageKeys, cookies] = await Promise.all([
    readSupabaseIdentity(page),
    page.evaluate(() => Object.keys(localStorage).sort()).catch(() => []),
    page.evaluate(() => Object.keys(sessionStorage).sort()).catch(() => []),
    page.context().cookies(BASE_URL).then((items) => items.map((cookie) => cookie.name).sort()),
  ]);
  const orgContext = await readCompanyContext(page);
  return { url: page.url(), identity, cookies, localStorageKeys, sessionStorageKeys, orgContext };
}

export function assertNoResidualAuth(state: BrowserAuthSnapshot): void {
  assert.equal(state.identity.email, null, 'Supabase identity must be absent');
  assertCookieState(state, { omnivyra: 'absent', supabase: 'absent' });
  assert(!state.localStorageKeys.some((key) => key.startsWith('sb-')), 'Supabase localStorage auth must be absent');
  assertStorageIsolation(state);
}

export function assertCookieState(state: BrowserAuthSnapshot, expected: CookieExpectation): void {
  const hasOmnivyra = state.cookies.includes('omnivyra_session');
  const hasSupabase = state.cookies.some((name) => name.startsWith('sb-'));
  assert.equal(hasOmnivyra, expected.omnivyra === 'present', `omnivyra_session expected ${expected.omnivyra}`);
  assert.equal(hasSupabase, expected.supabase === 'present', `sb-* cookie expected ${expected.supabase}`);
}

export function assertStorageIsolation(state: BrowserAuthSnapshot): void {
  assert(!state.localStorageKeys.includes('selected_company_id'), 'global selected_company_id must not be present');
  assert(!state.localStorageKeys.includes('company_id'), 'global company_id must not be present');
}

export const assertNoGlobalCompanyKeys = assertStorageIsolation;
export const assertUnauthenticated = assertNoResidualAuth;

async function readSupabaseIdentity(page: Page): Promise<{ email: string | null; userId: string | null }> {
  return page.evaluate(async () => {
    const client = (window as any).__supabase_browser_client__;
    if (!client) return { email: null, userId: null };
    const { data } = await client.auth.getSession();
    return {
      email: data?.session?.user?.email ?? null,
      userId: data?.session?.user?.id ?? null,
    };
  }).catch(() => ({ email: null, userId: null }));
}

async function preserveFailureArtifacts(context: BrowserContext): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), 'test-results', 'auth-integrity', stamp);
  await fs.mkdir(dir, { recursive: true });

  const pages = context.pages();
  await Promise.all(pages.map(async (page, index) => {
    const prefix = path.join(dir, `page-${index + 1}`);
    await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => undefined);
    const state = await snapshot(page).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
    await fs.writeFile(`${prefix}.json`, JSON.stringify(state, null, 2), 'utf8').catch(() => undefined);
  }));

  await context.storageState({ path: path.join(dir, 'storage-state.json') }).catch(() => undefined);
}

async function readCompanyContext(page: Page): Promise<BrowserAuthSnapshot['orgContext']> {
  return page.evaluate(async () => {
    const client = (window as any).__supabase_browser_client__;
    const { data } = client ? await client.auth.getSession() : { data: { session: null } };
    if (!data?.session?.access_token) return { status: null, userId: null, companies: [] };
    try {
      const res = await fetch('/api/company-profile?mode=list', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      return {
        status: res.status,
        userId: typeof json.userId === 'string' ? json.userId : null,
        companies: Array.isArray(json.companies) ? json.companies : [],
      };
    } catch {
      return { status: null, userId: null, companies: [] };
    }
  }).catch(() => ({ status: null, userId: null, companies: [] }));
}

async function poll(
  predicate: () => Promise<boolean>,
  failureMessage: string | (() => string),
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  const message = typeof failureMessage === 'function' ? failureMessage() : failureMessage;
  throw new Error(`${message}.${suffix}`);
}

function formatSnapshot(state: BrowserAuthSnapshot | null): string {
  if (!state) return 'unavailable';
  return JSON.stringify({
    url: state.url,
    identity: state.identity,
    cookies: state.cookies,
    localStorageKeys: state.localStorageKeys,
    sessionStorageKeys: state.sessionStorageKeys,
    orgContext: state.orgContext,
  });
}
