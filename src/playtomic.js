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

    // === STEP 5: Assign benefits to imported members ===
    // Navigate to Rewards & Offers > Benefits
    console.log('\n=== Assigning membership benefits ===');
    await page.click('a[href="/dashboard/rewards"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);

    // Log the benefits listed on the page
    const benefitNames = await page.locator('text=/Royal|Core|Rise|Iconic/i').allTextContents();
    console.log('Benefits found:', JSON.stringify(benefitNames.map(b => b.trim())));

    // Take a screenshot of the benefits page
    await page.screenshot({ path: '/tmp/playtomic-benefits-page.png', fullPage: true });
    console.log('[Screenshot] benefits-page');

    // Click on "Royal" benefit to see member assignment UI
    const royalLink = page.locator('text=Royal').first();
    if (await royalLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Clicking Royal benefit...');
      await royalLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      await dismissModals(page);

      console.log(`URL: ${page.url()}`);

      // Log all buttons and tabs
      const btns = await page.locator('button:visible').allTextContents();
      console.log('Buttons:', JSON.stringify(btns.map(b => b.trim()).filter(Boolean)));

      const tabs = await page.locator('a:visible, [role="tab"]').allTextContents();
      console.log('Tabs/Links:', JSON.stringify(tabs.map(t => t.trim()).filter(Boolean).slice(0, 20)));

      // Look for "Add member", "Assign", etc.
      const addBtns = await page.locator('button:has-text("Add"), button:has-text("Assign"), button:has-text("Member"), a:has-text("Add"), a:has-text("Assign")').allTextContents();
      console.log('Add/Assign buttons:', JSON.stringify(addBtns.map(b => b.trim())));

      await page.screenshot({ path: '/tmp/playtomic-royal-benefit.png', fullPage: true });
      console.log('[Screenshot] royal-benefit');

      // If there's an "Add member" or similar button, click it
      const addMemberBtn = page.locator('button:has-text("Add member"), button:has-text("Assign member"), button:has-text("Add customer")').first();
      if (await addMemberBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking Add member...');
        await addMemberBtn.click();
        await page.waitForTimeout(3000);

        // Log what the add member dialog looks like
        const dialogBtns = await page.locator('button:visible').allTextContents();
        console.log('Dialog buttons:', JSON.stringify(dialogBtns.map(b => b.trim()).filter(Boolean)));

        const dialogInputs = await page.locator('input:visible').evaluateAll(els =>
          els.map(el => ({ type: el.type, placeholder: el.placeholder, name: el.name }))
        );
        console.log('Dialog inputs:', JSON.stringify(dialogInputs));

        await page.screenshot({ path: '/tmp/playtomic-add-member-dialog.png', fullPage: true });
        console.log('[Screenshot] add-member-dialog');
      }

      // Also check if there are sub-tabs like "Members" within the benefit
      const memberTab = page.locator('a:has-text("Members"), [role="tab"]:has-text("Members"), button:has-text("Members")').first();
      if (await memberTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking Members tab...');
        await memberTab.click();
        await page.waitForTimeout(3000);

        const memberBtns = await page.locator('button:visible').allTextContents();
        console.log('Members tab buttons:', JSON.stringify(memberBtns.map(b => b.trim()).filter(Boolean)));

        await page.screenshot({ path: '/tmp/playtomic-royal-members.png', fullPage: true });
        console.log('[Screenshot] royal-members');
      }
    } else {
      console.log('Royal benefit not found on page.');
      const pageText = await page.locator('body').textContent();
      console.log('Page text:', pageText?.slice(0, 500));
    }

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
