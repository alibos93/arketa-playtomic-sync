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

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    // === LOGIN ===
    console.log('Logging into Playtomic...');
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    console.log('Logged in.');
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

    // === STEP 1: Select Customers ===
    console.log('Starting import wizard...');
    await page.click('button:has-text("New Import")');
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await page.waitForSelector('text=Select an object', { timeout: 10000 });
    await page.locator('text=The people you work with').click();
    await page.waitForTimeout(1000);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(3000);
    console.log('Step 1: Selected Customers.');

    // === STEP 2: Consent ===
    await page.locator('#hasDataHandlingPermission').check();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(3000);
    console.log('Step 2: Consent accepted.');

    // === STEP 3: Upload CSV (includes category_name for benefit assignment) ===
    await page.locator('input[type="file"]').setInputFiles(tmpPath);
    await page.waitForTimeout(3000);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(5000);
    console.log('Step 3: CSV uploaded and submitted.');

    // === Dismiss "Ok, got it" confirmation modal ===
    const okBtn = page.locator('button:has-text("Ok, got it")').first();
    if (await okBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await okBtn.click();
      await page.waitForTimeout(2000);
      console.log('Dismissed confirmation modal.');
    }

    // Check import status on the Imports page
    console.log('Checking import status...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.click('a:has-text("Imports")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: '/tmp/playtomic-import-status.png', fullPage: true });
    console.log('[Screenshot] import-status');

    // Log import history
    const importRows = await page.locator('table tr, [class*="row"]').allTextContents();
    console.log('Import history:', JSON.stringify(importRows.map(r => r.trim().slice(0, 150)).filter(Boolean).slice(0, 3)));

    await page.screenshot({ path: '/tmp/playtomic-import-result.png', fullPage: true });
    console.log('Done.');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
