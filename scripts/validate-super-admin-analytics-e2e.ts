import { chromium } from 'playwright';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3000';
const email = process.env.SUPER_ADMIN_E2E_EMAIL;
const password = process.env.SUPER_ADMIN_E2E_PASSWORD;

async function main() {
  if (!email || !password) {
    throw new Error('Set SUPER_ADMIN_E2E_EMAIL and SUPER_ADMIN_E2E_PASSWORD to run authenticated Super Admin analytics validation.');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto(`${baseUrl}/super-admin/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/\/super-admin\/dashboard/, { timeout: 30000 });
    await page.getByRole('button', { name: 'GA Analytics' }).click();
    await page.getByText('Google Analytics Website View').waitFor({ timeout: 30000 });
    await page.getByText('Analytics Health Panel').waitFor({ timeout: 30000 });
    await page.getByText('Search Console SEO View').waitFor({ timeout: 30000 });
    await page.getByText('Strategic Correlation Signals').waitFor({ timeout: 30000 });

    const result = {
      base_url: baseUrl,
      authenticated: true,
      analytics_health_panel: await page.getByText('Analytics Health Panel').isVisible(),
      gsc_dashboard: await page.getByText('Search Console SEO View').isVisible(),
      correlation_panel: await page.getByText('Strategic Correlation Signals').isVisible(),
      runtime_errors: errors,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
