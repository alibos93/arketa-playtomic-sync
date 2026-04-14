const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PLAYTOMIC_MANAGER_URL = 'https://manager.playtomic.io';
const SCREENSHOT_DIR = '/tmp';

async function screenshot(page, name) {
  const p = path.join(SCREENSHOT_DIR, `playtomic-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`[Screenshot] ${name} → ${p}`);
}

async function uploadCSVToPlaytomic(csvContent, email, password) {
  const tmpPath = path.join('/tmp', `playtomic-import-${Date.now()}.csv`);
  fs.writeFileSync(tmpPath, csvContent);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // 1. Login
    console.log('Logging into Playtomic...');
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/login`);
    await page.waitForLoadState('networkidle');
    await screenshot(page, '01-login-page');

    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');

    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    console.log('Logged in successfully.');
    await screenshot(page, '02-after-login');

    // 2. Navigate to contacts/import
    console.log('Navigating to import page...');
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/contacts/import`);
    await page.waitForLoadState('networkidle');
    await screenshot(page, '03-import-page');

    // Log the page URL and content for debugging
    console.log(`Current URL: ${page.url()}`);
    const pageContent = await page.content();

    // Find all buttons and links on the page
    const buttons = await page.locator('button').allTextContents();
    console.log('Buttons found:', JSON.stringify(buttons));

    const links = await page.locator('a').allTextContents();
    console.log('Links found:', JSON.stringify(links));

    // Check for file inputs (visible or hidden)
    const fileInputCount = await page.locator('input[type="file"]').count();
    console.log(`File inputs found: ${fileInputCount}`);

    // Check for any input elements
    const allInputs = await page.locator('input').evaluateAll(els =>
      els.map(el => ({ type: el.type, name: el.name, id: el.id, className: el.className, visible: el.offsetParent !== null }))
    );
    console.log('All inputs:', JSON.stringify(allInputs));

    // Look for common import UI patterns
    const importButtons = await page.locator('button:has-text("Import"), button:has-text("Upload"), button:has-text("Add"), button:has-text("File"), button:has-text("CSV"), a:has-text("Import"), a:has-text("Upload")').allTextContents();
    console.log('Import-related buttons:', JSON.stringify(importButtons));

    // Try clicking any import/upload button if found
    const importBtn = page.locator('button:has-text("Import"), button:has-text("Upload"), button:has-text("Add"), a:has-text("Import")').first();
    if (await importBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Clicking import button...');
      await importBtn.click();
      await page.waitForLoadState('networkidle');
      await screenshot(page, '04-after-import-click');

      // Re-check for file input
      const fileInputCount2 = await page.locator('input[type="file"]').count();
      console.log(`File inputs after click: ${fileInputCount2}`);

      const allInputs2 = await page.locator('input').evaluateAll(els =>
        els.map(el => ({ type: el.type, name: el.name, id: el.id, visible: el.offsetParent !== null }))
      );
      console.log('Inputs after click:', JSON.stringify(allInputs2));
    }

    // Try alternate paths
    const altPaths = [
      '/contacts',
      '/contacts/import/file',
      '/members/import',
      '/members',
    ];

    for (const altPath of altPaths) {
      await page.goto(`${PLAYTOMIC_MANAGER_URL}${altPath}`);
      await page.waitForLoadState('networkidle');
      const url = page.url();
      const fileCount = await page.locator('input[type="file"]').count();
      const btns = await page.locator('button').allTextContents();
      console.log(`[Probe] ${altPath} → URL: ${url}, file inputs: ${fileCount}, buttons: ${JSON.stringify(btns.slice(0, 10))}`);
      await screenshot(page, `probe-${altPath.replace(/\//g, '-')}`);
    }

    await screenshot(page, '99-final');
    console.log('Debug run complete — check screenshots for UI state.');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
