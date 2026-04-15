const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PLAYTOMIC_MANAGER_URL = 'https://manager.playtomic.io';

async function dismissModals(page) {
  for (const sel of ['button:has-text("Skip for now")', 'button:has-text("Skip")', '[aria-label="Close"]']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1000);
    }
  }
}

async function uploadCSVToPlaytomic(csvContent, email, password) {
  const tmpPath = path.join('/tmp', `playtomic-import-${Date.now()}.csv`);
  fs.writeFileSync(tmpPath, csvContent);

  const screenshotPath = '/tmp/playtomic-import-result.png';

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // === LOGIN ===
    console.log('Logging into Playtomic...');
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/login`);
    await page.waitForLoadState('networkidle');
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    console.log('Logged in.');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);

    // === NAVIGATE TO IMPORTS ===
    console.log('Navigating to Customers > Imports...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.click('a:has-text("Imports")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // === STEP 1: Select import type → Customers ===
    console.log('Starting import wizard...');
    await page.click('button:has-text("New Import")');
    await page.waitForTimeout(3000);
    await dismissModals(page);

    await page.waitForSelector('text=Select an object', { timeout: 10000 });
    await page.locator('text=The people you work with').click();
    await page.waitForTimeout(1000);

    // Click Next (wait for it to be enabled)
    const nextBtn1 = page.locator('button:has-text("Next")');
    await nextBtn1.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);
    await nextBtn1.click();
    await page.waitForTimeout(3000);
    console.log('Step 1 done: Selected Customers.');

    // === STEP 2: Data handling consent ===
    await page.locator('#hasDataHandlingPermission').check();
    await page.waitForTimeout(500);
    const nextBtn2 = page.locator('button:has-text("Next")');
    await nextBtn2.click();
    await page.waitForTimeout(3000);
    console.log('Step 2 done: Consent accepted.');

    // === STEP 3: Upload CSV file ===
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(tmpPath);
    await page.waitForTimeout(3000);
    console.log('Step 3: CSV file uploaded.');

    // Click Next to submit the import
    const nextBtn3 = page.locator('button:has-text("Next")');
    await nextBtn3.click();
    await page.waitForTimeout(5000);

    // === STEP 4: Dismiss "processing" confirmation modal ===
    const okBtn = page.locator('button:has-text("Ok, got it"), button:has-text("Ok"), button:has-text("Got it")').first();
    if (await okBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('Import is processing!');
      await okBtn.click();
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('CSV import completed successfully.');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
