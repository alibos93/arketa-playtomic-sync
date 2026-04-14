const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PLAYTOMIC_MANAGER_URL = 'https://manager.playtomic.io';

async function uploadCSVToPlaytomic(csvContent, email, password) {
  const tmpPath = path.join('/tmp', `playtomic-import-${Date.now()}.csv`);
  fs.writeFileSync(tmpPath, csvContent);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    console.log('Logging into Playtomic...');
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/login`);

    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');

    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    console.log('Logged in successfully.');

    await page.goto(`${PLAYTOMIC_MANAGER_URL}/contacts/import`);
    await page.waitForLoadState('networkidle');

    const importLink = page.locator('a[href*="import"], button:has-text("Import")').first();
    if (await importLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await importLink.click();
      await page.waitForLoadState('networkidle');
    }

    console.log('Navigated to import page.');

    const fileOption = page.locator('label:has-text("File"), input[value*="file"], button:has-text("File")').first();
    if (await fileOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileOption.click();
    }

    const nextBtn = page.locator('button:has-text("Next"), button:has-text("Continue")').first();
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForLoadState('networkidle');
    }

    console.log('Uploading CSV file...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.waitFor({ timeout: 10000 });
    await fileInput.setInputFiles(tmpPath);

    const uploadBtn = page.locator(
      'button:has-text("Upload"), button:has-text("Import"), button:has-text("Next"), button:has-text("Continue")'
    ).first();
    await uploadBtn.waitFor({ timeout: 5000 });
    await uploadBtn.click();

    await page.waitForLoadState('networkidle');
    console.log('CSV uploaded successfully.');

    const screenshotPath = '/tmp/playtomic-import-result.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to ${screenshotPath}`);

  } finally {
    await browser.close();
    fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
