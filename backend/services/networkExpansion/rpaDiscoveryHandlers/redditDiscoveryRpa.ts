import { chromium, type Browser } from 'playwright';

type RedditRpaDiscoveryInput = {
  tenant_id: string;
  organization_id: string;
  source_url: string;
  limit?: number;
};

type DiscoveredUserStub = {
  external_username: string;
  profile_url: string;
};

const normalizeUsername = (value: string) =>
  value.replace(/^\/?(u|user)\//i, '').replace(/^@/, '').trim();

const extractUsersFromPage = (limit: number) => {
  const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
  const users = new Map<string, DiscoveredUserStub>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href') || '';
    if (!href.includes('/user/') && !href.includes('/u/')) continue;
    const absoluteUrl = href.startsWith('http') ? href : `https://www.reddit.com${href}`;
    const parts = absoluteUrl.split('/').filter(Boolean);
    const userIndex = parts.findIndex((part) => part === 'user' || part === 'u');
    if (userIndex < 0 || !parts[userIndex + 1]) continue;
    const username = normalizeUsername(parts[userIndex + 1]);
    if (!username) continue;
    if (!users.has(username)) {
      users.set(username, {
        external_username: username,
        profile_url: `https://www.reddit.com/user/${username}`,
      });
    }
    if (users.size >= limit) break;
  }

  return Array.from(users.values());
};

export const discoverUsersFromRedditRpa = async (
  input: RedditRpaDiscoveryInput
): Promise<DiscoveredUserStub[]> => {
  let browser: Browser | null = null;
  try {
    const max = typeof input.limit === 'number' && input.limit > 0 ? input.limit : 50;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(input.source_url, { waitUntil: 'networkidle' });
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(500);
    }

    return await page.evaluate(extractUsersFromPage, max);
  } catch {
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
