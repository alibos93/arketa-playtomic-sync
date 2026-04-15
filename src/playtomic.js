const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PLAYTOMIC_MANAGER_URL = 'https://manager.playtomic.io';
const SCREENSHOT_DIR = '/tmp';

async function screenshot(page, name) {
  const p = path.join(SCREENSHOT_DIR, `playtomic-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`[Screenshot] ${name}`);
}

async function dismissModals(page) {
  const dismissSelectors = [
    'button:has-text("Skip for now")',
    'button:has-text("Skip")',
    'button:has-text("Close")',
    'button:has-text("Dismiss")',
    'button:has-text("Later")',
    'button:has-text("Not now")',
    '[aria-label="Close"]',
  ];

  for (const selector of dismissSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log(`Dismissing modal: ${selector}`);
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
    // 1. Login
    console.log('Logging into Playtomic...');
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/login`);
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]');

    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    console.log('Logged in successfully.');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);

    // 2. Go to Customers > Imports
    console.log('Navigating to Customers > Imports...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click the Imports tab
    await page.click('a:has-text("Imports")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await screenshot(page, '01-imports-tab');

    // 3. Click "New Import"
    console.log('Clicking New Import...');
    await page.click('button:has-text("New Import")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await screenshot(page, '02-new-import');
    console.log(`URL: ${page.url()}`);

    // Debug: log everything visible
    const buttons = await page.locator('button:visible').allTextContents();
    console.log('Buttons:', JSON.stringify(buttons.map(b => b.trim()).filter(Boolean)));

    const inputs = await page.locator('input').evaluateAll(els =>
      els.map(el => ({ type: el.type, name: el.name, id: el.id, accept: el.accept, hidden: el.hidden, style: el.style.display }))
    );
    console.log('Inputs:', JSON.stringify(inputs));

    // Look for file input (may be hidden behind a button)
    const fileInput = page.locator('input[type="file"]');
    const fileInputCount = await fileInput.count();
    console.log(`File inputs: ${fileInputCount}`);

    if (fileInputCount > 0) {
      console.log('Uploading CSV via file input...');
      await fileInput.first().setInputFiles(tmpPath);
      await page.waitForTimeout(3000);
      await screenshot(page, '03-file-selected');

      // Click next/upload/continue
      const nextBtn = page.locator('button:has-text("Upload"), button:has-text("Next"), button:has-text("Import"), button:has-text("Continue"), button:has-text("Confirm")').first();
      if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        const btnText = await nextBtn.textContent();
        console.log(`Clicking: "${btnText.trim()}"`);
        await nextBtn.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);
        await screenshot(page, '04-after-upload');

        // Check for column mapping step
        const mapBtns = await page.locator('button:visible').allTextContents();
        console.log('After upload buttons:', JSON.stringify(mapBtns.map(b => b.trim()).filter(Boolean)));

        // If there's another Next/Confirm step (column mapping)
        const confirmBtn = page.locator('button:has-text("Next"), button:has-text("Import"), button:has-text("Confirm"), button:has-text("Finish")').first();
        if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          const cText = await confirmBtn.textContent();
          console.log(`Clicking: "${cText.trim()}"`);
          await confirmBtn.click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(3000);
          await screenshot(page, '05-final-confirm');

          // One more confirm if needed
          const lastBtn = page.locator('button:has-text("Import"), button:has-text("Confirm"), button:has-text("Finish")').first();
          if (await lastBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            const lText = await lastBtn.textContent();
            console.log(`Clicking: "${lText.trim()}"`);
            await lastBtn.click();
            await page.waitForTimeout(5000);
            await screenshot(page, '06-done');
          }
        }

        console.log('CSV import completed.');
      }
    } else {
      // No file input — look for drag/drop or other UI
      console.log('No file input found. Checking for other upload patterns...');

      // Maybe there's a drop area or "Choose file" text
      const allText = await page.locator('body').textContent();
      console.log('Page text (first 500):', allText?.slice(0, 500));

      // Try looking for hidden file inputs by checking shadow DOM etc
      const hiddenInputs = await page.evaluate(() => {
        return document.querySelectorAll('input[type="file"]').length;
      });
      console.log(`Hidden file inputs (via evaluate): ${hiddenInputs}`);

      await screenshot(page, '03-no-file-input');
    }

    await screenshot(page, '99-final');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
