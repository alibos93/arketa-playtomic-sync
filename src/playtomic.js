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
  for (const sel of ['button:has-text("Skip for now")', 'button:has-text("Skip")', '[aria-label="Close"]']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1000);
    }
  }
}

async function clickNext(page) {
  const btn = page.locator('button:has-text("Next")').first();
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  // Wait until the button is enabled (not disabled/greyed out)
  await page.waitForFunction(
    () => !document.querySelector('button')?.disabled,
    { timeout: 5000 }
  ).catch(() => {});
  await btn.click();
  await page.waitForTimeout(3000);
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

    // === GO TO IMPORTS ===
    console.log('Going to Customers > Imports...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.click('a:has-text("Imports")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // === WIZARD STEP 1: Select import type (Customers) ===
    console.log('Step 1: Select Customers...');
    await page.click('button:has-text("New Import")');
    await page.waitForTimeout(3000);

    // Click the Customers card
    const card = page.locator('div:has(h2:has-text("Customers")):not(:has(h2:has-text("Wallet")))').first();
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.click();
    } else {
      // Try clicking just the heading
      await page.locator('h2:has-text("Customers")').first().click();
    }
    await page.waitForTimeout(1000);
    await clickNext(page);
    console.log('Step 1 done.');

    // === WIZARD STEP 2: Data handling consent ===
    console.log('Step 2: Consent checkbox...');
    const checkbox = page.locator('#hasDataHandlingPermission');
    await checkbox.check();
    await page.waitForTimeout(500);
    await clickNext(page);
    console.log('Step 2 done.');
    await screenshot(page, '01-step3');
    console.log(`Step 3 URL: ${page.url()}`);

    // === WIZARD STEP 3: Upload file ===
    // Log what's on the page
    const step3Buttons = await page.locator('button:visible').allTextContents();
    console.log('Step 3 buttons:', JSON.stringify(step3Buttons.map(b => b.trim()).filter(Boolean)));

    const step3Inputs = await page.locator('input').evaluateAll(els =>
      els.map(el => ({ type: el.type, name: el.name, id: el.id, accept: el.accept }))
    );
    console.log('Step 3 inputs:', JSON.stringify(step3Inputs));

    const pageText = await page.locator('body').textContent();
    const relevantText = pageText?.match(/step 3[^]*?(?=step 4|$)/i)?.[0]?.slice(0, 300) || pageText?.slice(0, 500);
    console.log('Page text:', relevantText);

    // Try to find file input
    let fileInput = page.locator('input[type="file"]');
    let fileCount = await fileInput.count();

    // If not visible, check for hidden ones
    if (fileCount === 0) {
      const hiddenCount = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length);
      console.log(`Hidden file inputs: ${hiddenCount}`);
      if (hiddenCount > 0) fileCount = hiddenCount;
    }

    if (fileCount > 0) {
      console.log('Step 3: Uploading CSV...');
      await fileInput.first().setInputFiles(tmpPath);
      await page.waitForTimeout(3000);
      await screenshot(page, '02-file-uploaded');

      // Continue through remaining wizard steps
      for (let step = 4; step <= 7; step++) {
        const nextBtn = page.locator('button:has-text("Next"), button:has-text("Import"), button:has-text("Confirm"), button:has-text("Finish")').first();
        if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          const text = await nextBtn.textContent();
          console.log(`Step ${step}: Clicking "${text.trim()}"...`);
          await nextBtn.click();
          await page.waitForTimeout(3000);
          await screenshot(page, `0${step}-wizard`);

          // Log any column mapping or review steps
          const stepBtns = await page.locator('button:visible').allTextContents();
          console.log(`Step ${step} buttons:`, JSON.stringify(stepBtns.map(b => b.trim()).filter(Boolean)));
        } else {
          console.log(`No more wizard steps at step ${step}.`);
          break;
        }
      }
      console.log('CSV import completed!');
    } else {
      console.log('No file input found. Taking diagnostic screenshot...');
      await screenshot(page, '02-no-file-input');

      // Log all elements for debugging
      const allElements = await page.locator('*:visible').evaluateAll(els =>
        els.slice(0, 50).map(el => ({ tag: el.tagName, text: el.textContent?.trim().slice(0, 40), class: el.className?.toString().slice(0, 30) }))
      );
      console.log('Visible elements:', JSON.stringify(allElements.slice(0, 20)));
    }

    await screenshot(page, '99-final');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
