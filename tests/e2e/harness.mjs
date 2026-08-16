// Minimal, dependency-light e2e harness — no @playwright/test runner, just the
// `playwright` library directly, because pinning a browser binary explicitly
// (see CHROMIUM_PATH below) is more reliable in this environment than trusting
// a specific playwright version's auto-detected/downloaded browser revision.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BASE_URL = process.env.BLUR_STUDIO_URL || 'http://localhost:5178';
export const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Prebuilt chromium already present on this machine from prior Playwright use.
// If missing on a fresh machine, run: npx playwright install chromium
const CHROMIUM_PATH = path.join(
  process.env.HOME,
  '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
);

export async function launch() {
  const executablePath = fs.existsSync(CHROMIUM_PATH) ? CHROMIUM_PATH : undefined;
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('PAGE ERROR: ' + e.message));
  return { browser, page, consoleErrors };
}

export function screenshotPath(name) {
  return path.join(SCREENSHOT_DIR, `${name}.png`);
}

// Simple sequential test runner. Each case: { name, fn(ctx) }. fn throws to fail.
export async function run(cases) {
  const { browser, page, consoleErrors } = await launch();
  const results = [];
  let ctx = { page, consoleErrors };

  for (const c of cases) {
    const startErrCount = consoleErrors.length;
    try {
      await c.fn(ctx);
      const newErrors = consoleErrors.slice(startErrCount);
      results.push({ name: c.name, status: 'PASS', consoleErrors: newErrors });
    } catch (err) {
      const shot = screenshotPath(`FAIL-${c.name.replace(/[^a-z0-9]+/gi, '-')}`);
      await page.screenshot({ path: shot }).catch(() => {});
      results.push({ name: c.name, status: 'FAIL', error: err.message, screenshot: shot });
    }
  }

  await browser.close();
  return results;
}

export function printReport(suiteName, results) {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.length - pass;
  console.log(`\n=== ${suiteName} ===`);
  for (const r of results) {
    const mark = r.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${mark} ${r.name}`);
    if (r.status === 'FAIL') {
      console.log(`      ${r.error}`);
      console.log(`      screenshot: ${r.screenshot}`);
    }
    if (r.consoleErrors?.length) {
      console.log(`      console errors during this test: ${JSON.stringify(r.consoleErrors)}`);
    }
  }
  console.log(`  --- ${pass}/${results.length} passed ---\n`);
  return { pass, fail, total: results.length };
}
