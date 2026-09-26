/**
 * PO-3 Phase 2 — the production {@link AdsTransparencyClient}, backed by the Railway plane's
 * existing Playwright/Chromium runtime.
 *
 * ─── WHY THIS FILE IS THIN ────────────────────────────────────────────────
 * All judgement lives in `adsTransparencyObservation` (orchestration) and
 * `advertiserIdentityResolver` (identity). This file only knows how to drive a page and read
 * fields off it, so the parts that decide what may be said about a customer stay pure and
 * unit-tested while the brittle part stays small.
 *
 * ─── PUBLIC, ANONYMOUS, NO BYPASS ─────────────────────────────────────────
 * Every context is a fresh `browser.newContext()` with NO `storageState`, no cookies and no
 * account. The authenticated `rpaPlaywrightRunner` session model is deliberately NOT reused: it
 * injects a per-organisation session, and an authenticated result can never be Report 1
 * public-domain evidence. Nothing here defeats a CAPTCHA, a robots rule or a rate limit — a
 * challenge surfaces as a thrown error, which the orchestrator maps to an access state.
 *
 * `adstransparency.google.com` served no robots.txt (HTTP 404) when checked on 2026-09-26, so no
 * crawl directive applies; the surface is used anonymously and at report cadence, not at scale.
 */
import type {
  AdsTransparencyClient,
  AdvertiserProfileObservation,
  AdvertiserSuggestion,
  DomainCandidateObservation,
} from './adsTransparencyObservation';

/** The minimum Playwright surface this client uses. Typed structurally so no import is needed. */
export interface AdsBrowserPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
  $(selector: string): Promise<{ fill(value: string): Promise<void> } | null>;
  $$(selector: string): Promise<Array<{ click(): Promise<void> }>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T>(fn: (...args: any[]) => T): Promise<T>;
}

export interface AdsBrowserSession {
  /** Opens a FRESH anonymous page, runs `fn`, and always closes the context. */
  withPage<T>(fn: (page: AdsBrowserPage) => Promise<T>): Promise<T>;
}

const BASE = 'https://adstransparency.google.com';
const SETTLE_SEARCH_MS = 7000;
const SETTLE_PROFILE_MS = 10000;
const SETTLE_CLICK_MS = 9000;
const NAV_TIMEOUT_MS = 30000;
/**
 * How many suggestion rows get their AR id resolved per search.
 *
 * Each resolution costs a repeated search plus a click-navigation, because activating a row
 * navigates away from the suggestion list. Four covers the advertiser rows the provider actually
 * surfaces for a company name while keeping a report to single-digit page loads. Rows beyond it
 * are returned unresolved rather than dropped.
 */
const MAX_RESOLVE_PER_SEARCH = 4;

/**
 * The provider's own ad-count label, verbatim. NEVER parsed into an integer — the provider rounds
 * it (`~14M`), and re-deriving a precise number would invent precision it does not publish.
 *
 * ─── THE FORMAT IS OBSERVED, NOT ASSUMED ──────────────────────────────────
 * Live profile text, 2026-09-26, Railway us-west2:
 *   HubSpot      `~200 ads`
 *   Booking.com  `~14M ads`   ← magnitude suffix is not always K
 *   Wix          `1 ad`       ← singular, and no tilde
 * The first implementation allowed only `K` and required the plural, so it silently returned null
 * for two of the three. Null then renders as no count at all, which is the safe direction — but it
 * was a parsing gap, not a provider limitation, and it is closed here.
 *
 * A digit is REQUIRED so the page's own boilerplate ("Political ads", "show ads with age
 * restricted content", "Ads In anywhere") can never be read as a count.
 */
const AD_COUNT_LABEL = /~?\d[\d,.]*\s*[KMB]?\s+ads?\b/i;

export function adCountLabelFrom(text: string): string | null {
  const m = AD_COUNT_LABEL.exec(String(text ?? ''));
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

/** One suggestion row, e.g. `WIX.COM LTDVerifiedIsrael~1 ads`. */
export function parseSuggestionRow(raw: string): Omit<AdvertiserSuggestion, 'advertiserId'> | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // A bare website row (`wix.com`, `hubspot.de`) is a Websites suggestion, not an advertiser.
  if (/^[\w.-]+\.[a-z]{2,}$/i.test(text)) return null;
  const ambiguityFlagged = /Multiple advertiser accounts have a similar name/i.test(text);
  const verified = /Verified/.test(text);
  const adCountLabel = adCountLabelFrom(text);
  let name = text
    .replace(/Multiple advertiser accounts have a similar name/i, '')
    .replace(/Verified/, '');
  if (adCountLabel) name = name.replace(adCountLabel, '');
  // What remains is `<name><jurisdiction>`. The jurisdiction is not separable from the name by
  // string surgery, so it is left to the profile page, which labels both fields explicitly.
  return { name: name.trim(), basedIn: null, verified, ambiguityFlagged, adCountLabel };
}

export function createAdsTransparencyBrowserClient(session: AdsBrowserSession): AdsTransparencyClient {
  return {
    /**
     * Advertiser-name discovery, including the AR id.
     *
     * ─── WHY THIS COSTS MORE THAN ONE PAGE LOAD ─────────────────────────
     * Suggestion rows carry NO href — verified live. The AR id exists only after a row is
     * activated, at which point the page navigates to `/advertiser/AR…`. So the id is read from
     * the resulting URL, which is deterministic and public: three subjects, three clicks, three
     * exact ids (2026-09-26).
     *
     * Activating a row navigates away, so each additional id needs the search repeated. That is
     * why `maxResolve` is small: this is report-cadence discovery, not enumeration. Rows beyond
     * the cap are still RETURNED, with `advertiserId: null` — an unresolved candidate is a
     * truthful result, and the orchestrator simply cannot open a profile for it.
     *
     * An AR id is never constructed, guessed or inferred. It is read from the URL the provider
     * navigated to, or it is null.
     */
    async searchAdvertisers(name: string): Promise<AdvertiserSuggestion[]> {
      const readRows = async (page: AdsBrowserPage): Promise<string[]> => {
        await page.goto(`${BASE}/?region=anywhere`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(5000);
        const box = await page.$('input');
        if (!box) return [];
        await box.fill(name);
        await page.waitForTimeout(SETTLE_SEARCH_MS);
        return page.evaluate(() =>
          Array.from(document.querySelectorAll('[role="option"]'))
            .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()));
      };

      const rows = await session.withPage(readRows);

      // Advertiser rows only. A bare website row is a Websites suggestion and has no advertiser.
      const advertiserRows: Array<{ index: number; parsed: NonNullable<ReturnType<typeof parseSuggestionRow>> }> = [];
      rows.forEach((text, index) => {
        const parsed = parseSuggestionRow(text);
        if (parsed) advertiserRows.push({ index, parsed });
      });

      const out: AdvertiserSuggestion[] = [];
      for (const [n, row] of advertiserRows.entries()) {
        if (n >= MAX_RESOLVE_PER_SEARCH) {
          out.push({ advertiserId: null, ...row.parsed });
          continue;
        }
        const advertiserId = await session.withPage(async (page) => {
          await readRows(page);
          const options = await page.$$('[role="option"]');
          const target = options[row.index];
          if (!target) return null;
          await target.click();
          await page.waitForTimeout(SETTLE_CLICK_MS);
          return page.url().match(/AR\d+/)?.[0] ?? null;
        }).catch(() => null);
        out.push({ advertiserId, ...row.parsed });
      }
      return out;
    },

    async openAdvertiser(advertiserId: string): Promise<AdvertiserProfileObservation | null> {
      if (!/^AR\d+$/.test(advertiserId)) return null;
      const profileUrl = `${BASE}/advertiser/${advertiserId}?region=anywhere`;
      return session.withPage(async (page) => {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForTimeout(SETTLE_PROFILE_MS);
        const data = await page.evaluate(() => {
          const t = document.body ? document.body.innerText : '';
          const grab = (re: RegExp) => { const m = re.exec(t); return m ? m[1].trim() : null; };
          return {
            legalName: grab(/Legal name:\s*([^\n]+)/),
            basedIn: grab(/Based in:\s*([^\n]+)/),
            verified: /verified their identity/i.test(t),
            ambiguityFlagged: /Multiple advertiser accounts have a similar name/i.test(t),
            adCountText: t,
            creativeIds: Array.from(new Set(
              Array.from(document.querySelectorAll('a[href*="/creative/"]'))
                .map((a) => (a.getAttribute('href') ?? '').match(/CR\d+/)?.[0])
                .filter((v): v is string => Boolean(v)),
            )),
          };
        });
        return {
          advertiserId,
          legalName: data.legalName,
          basedIn: data.basedIn,
          verified: data.verified,
          ambiguityFlagged: data.ambiguityFlagged,
          adCountLabel: adCountLabelFrom(data.adCountText),
          creativeIds: data.creativeIds,
          profileUrl,
        };
      });
    },

    async searchByDomain(domain: string): Promise<DomainCandidateObservation> {
      return session.withPage(async (page) => {
        await page.goto(`${BASE}/?region=anywhere&domain=${encodeURIComponent(domain)}`, {
          waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS,
        });
        await page.waitForTimeout(SETTLE_PROFILE_MS);
        const data = await page.evaluate(() => ({
          text: document.body ? document.body.innerText : '',
          advertiserIds: Array.from(new Set(
            Array.from(document.querySelectorAll('a[href*="/advertiser/"]'))
              .map((a) => (a.getAttribute('href') ?? '').match(/AR\d+/)?.[0])
              .filter((v): v is string => Boolean(v)),
          )),
        }));
        return {
          // Ads pointing AT the domain. The orchestrator carries it as third-party context; it is
          // never any company's ad count.
          domainAdCountLabel: adCountLabelFrom(data.text),
          advertiserIds: data.advertiserIds,
        };
      });
    },
  };
}
