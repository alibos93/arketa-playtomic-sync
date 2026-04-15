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
  const selectors = [
    'button:has-text("Skip for now")',
    'button:has-text("Skip")',
    'button:has-text("Close")',
    'button:has-text("Dismiss")',
    '[aria-label="Close"]',
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log(`Dismissing modal: ${sel}`);
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
    console.log('Going to Customers > Imports...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.click('a:has-text("Imports")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // === STEP 1: Select import type ===
    console.log('Starting New Import...');
    await page.click('button:has-text("New Import")');
    await page.waitForTimeout(3000);

    // Select "Customers" card
    console.log('Step 1: Selecting Customers...');
    const customersCard = page.locator('text=Customers >> xpath=ancestor::div[contains(@class,"card") or contains(@class,"option") or @role="button"]').first();
    if (await customersCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await customersCard.click();
    } else {
      // Fallback: click on the Customers text directly
      await page.locator('h2:has-text("Customers"), h3:has-text("Customers"), div:has-text("Customers"):not(:has-text("Wallets"))').first().click();
    }
    await page.waitForTimeout(1000);

    // Click Next
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(3000);
    await screenshot(page, '01-step2');
    console.log(`Step 2 URL: ${page.url()}`);

    // === STEP 2: Upload file ===
    // Log what's on the page
    const step2Buttons = await page.locator('button:visible').allTextContents();
    console.log('Step 2 buttons:', JSON.stringify(step2Buttons.map(b => b.trim()).filter(Boolean)));

    const step2Inputs = await page.locator('input').evaluateAll(els =>
      els.map(el => ({ type: el.type, name: el.name, id: el.id, accept: el.accept }))
    );
    console.log('Step 2 inputs:', JSON.stringify(step2Inputs));

    const step2Text = await page.locator('main, [class*="content"], [class*="step"]').first().textContent().catch(() => '');
    console.log('Step 2 text:', step2Text?.slice(0, 300));

    // Try to find file input
    let fileInput = page.locator('input[type="file"]');
    let fileCount = await fileInput.count();

    if (fileCount === 0) {
      // Maybe need to click a "Choose file" or "Upload" button first
      const uploadTrigger = page.locator('button:has-text("Choose"), button:has-text("Browse"), button:has-text("Upload"), button:has-text("Select file"), label:has-text("Choose"), label:has-text("Browse"), label:has-text("Upload"), [class*="dropzone"], [class*="upload"]').first();
      if (await uploadTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking upload trigger...');
        await uploadTrigger.click();
        await page.waitForTimeout(2000);
        fileCount = await fileInput.count();
      }
    }

    console.log(`File inputs found: ${fileCount}`);

    if (fileCount > 0) {
      console.log('Uploading CSV...');
      await fileInput.first().setInputFiles(tmpPath);
      await page.waitForTimeout(3000);
      await screenshot(page, '02-file-uploaded');

      // Click through remaining steps
      for (let step = 3; step <= 6; step++) {
        const nextBtn = page.locator('button:has-text("Next"), button:has-text("Import"), button:has-text("Continue"), button:has-text("Confirm"), button:has-text("Finish")').first();
        if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          const text = await nextBtn.textContent();
          console.log(`Clicking: "${text.trim()}"`);
          await nextBtn.click();
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(3000);
          await screenshot(page, `0${step}-step`);
        } else {
          console.log(`No next button at step ${step}, done.`);
          break;
        }
      }
      console.log('CSV import completed.');
    } else {
      // Hidden file input — try setting via JavaScript
      const hiddenCount = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length);
      console.log(`Hidden file inputs via JS: ${hiddenCount}`);

      if (hiddenCount > 0) {
        console.log('Found hidden file input, uploading...');
        await page.locator('input[type="file"]').first().setInputFiles(tmpPath, { force: true });
        await page.waitForTimeout(3000);
        await screenshot(page, '02-hidden-upload');
      } else {
        console.log('ERROR: No file input found anywhere.');
        await screenshot(page, '02-error-no-input');
      }
    }

    await screenshot(page, '99-final');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
