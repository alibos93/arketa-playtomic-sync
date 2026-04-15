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
    await page.screenshot({ path: '/tmp/playtomic-step3-after-upload.png', fullPage: true });
    console.log('[Screenshot] step3-after-upload');
    // Log what the page shows after upload (column mapping, preview, errors, etc.)
    const step3Text = await page.locator('main, [role="dialog"], [class*="modal"], [class*="content"]').first().textContent().catch(() => '');
    console.log('Step 3 page text:', step3Text?.slice(0, 800));

    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: '/tmp/playtomic-step3-after-next.png', fullPage: true });
    console.log('[Screenshot] step3-after-next');
    const step3bText = await page.locator('main, [role="dialog"], [class*="modal"], [class*="content"]').first().textContent().catch(() => '');
    console.log('After Step 3 Next:', step3bText?.slice(0, 800));
    console.log('Step 3: CSV uploaded.');

    // === STEP 4: Check for any additional steps (column mapping?) before confirmation ===
    // Look for a mapping step or any unexpected content
    const nextBtn4 = page.locator('button:has-text("Next")').first();
    if (await nextBtn4.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.screenshot({ path: '/tmp/playtomic-step4-extra.png', fullPage: true });
      console.log('[Screenshot] step4-extra — unexpected Next button found');
      const step4Text = await page.locator('main, [role="dialog"], [class*="modal"], [class*="content"]').first().textContent().catch(() => '');
      console.log('Step 4 extra text:', step4Text?.slice(0, 800));
      await nextBtn4.click();
      await page.waitForTimeout(5000);
    }

    // === Dismiss confirmation ===
    const okBtn = page.locator('button:has-text("Ok, got it")').first();
    if (await okBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await okBtn.click();
      await page.waitForTimeout(2000);
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
    console.log('Import history:', JSON.stringify(importRows.map(r => r.trim().slice(0, 150)).filter(Boolean).slice(0, 5)));

    // Try to download the error report from the most recent import
    // Use multiple selector strategies
    const errorLinkSelectors = [
      'text=Download error rows',
      'a:has-text("Download error")',
      'button:has-text("Download error")',
      'a:has-text("error rows")',
      '[href*="error"]',
    ];
    let downloadClicked = false;
    for (const sel of errorLinkSelectors) {
      const link = page.locator(sel).first();
      if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log(`Found error link with selector: ${sel}`);
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
          link.click(),
        ]);
        if (download) {
          const errorPath = '/tmp/playtomic-import-errors.csv';
          await download.saveAs(errorPath);
          const errorContent = fs.readFileSync(errorPath, 'utf-8');
          console.log('=== IMPORT ERROR REPORT ===');
          console.log(errorContent);
          console.log('=== END ERROR REPORT ===');
        } else {
          console.log('Download event not triggered — checking for new page content...');
          await page.waitForTimeout(2000);
          const newText = await page.locator('main, [role="dialog"]').first().textContent().catch(() => '');
          console.log('After click text:', newText?.slice(0, 500));
        }
        downloadClicked = true;
        break;
      }
    }
    if (!downloadClicked) {
      console.log('No error download link found. Dumping all links on page:');
      const allLinks = await page.locator('a, button').allTextContents();
      console.log('Links/buttons:', JSON.stringify(allLinks.filter(t => t.trim()).slice(0, 20)));
    }

    await page.screenshot({ path: '/tmp/playtomic-import-result.png', fullPage: true });
    console.log('Done.');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
