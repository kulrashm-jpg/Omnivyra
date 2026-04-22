type RedditRpaTask = {
  tenant_id: string;
  organization_id: string;
  action_type: 'reply' | 'like';
  target_url: string;
  text?: string | null;
  action_id: string;
};

type RedditRpaResult = {
  success: boolean;
  screenshot_path?: string;
  error?: string;
};

async function loadPlaywright(): Promise<any | null> {
  try {
    const importer = new Function('specifier', 'return import(specifier);') as (specifier: string) => Promise<any>;
    return await importer('playwright');
  } catch {
    return null;
  }
}

const ensureSession = async (_page: any) => {
  // Placeholder for session cookie injection.
};

const takeScreenshot = async (page: any, filename: string) => {
  await page.screenshot({ path: filename, fullPage: true });
  return filename;
};

export const executeRedditRpaTask = async (task: RedditRpaTask): Promise<RedditRpaResult> => {
  let browser: any = null;
  try {
    const pw = await loadPlaywright();
    if (!pw?.chromium?.launch) {
      return { success: false, error: 'PLAYWRIGHT_NOT_INSTALLED' };
    }

    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    await ensureSession(page);
    await page.goto(task.target_url, { waitUntil: 'networkidle' });

    if (task.action_type === 'reply') {
      if (!task.text) {
        return { success: false, error: 'TEXT_REQUIRED' };
      }
      await page.click('[data-test-id="comment-button"]');
      await page.fill('textarea', task.text);
      await page.click('[data-test-id="comment-submit-button"]');
    } else if (task.action_type === 'like') {
      await page.click('[aria-label="upvote"]');
    } else {
      return { success: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
    }

    const screenshot_path = await takeScreenshot(page, `/logs/rpa/${task.action_id}.png`);
    return { success: true, screenshot_path };
  } catch (error: any) {
    return { success: false, error: error?.message || 'REDDIT_RPA_FAILED' };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
