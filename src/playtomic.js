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

    // === STEP 5: Assign benefits — explore customer profile approach ===
    console.log('\n=== Exploring benefit assignment via customer profile ===');

    // Go to Customers page and search for the first member
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);

    // Search for Todd Schwartz
    console.log('Searching for Todd Schwartz...');
    const custSearch = page.locator('input[placeholder*="Search"], input[type="search"]').first();
    if (await custSearch.isVisible({ timeout: 5000 }).catch(() => false)) {
      await custSearch.fill('Todd');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/playtomic-customer-search.png', fullPage: true });
      console.log('[Screenshot] customer-search');

      // Log search results
      const results = await page.locator('table tr, [class*="row"], [class*="result"]').allTextContents();
      console.log('Search results:', JSON.stringify(results.map(r => r.trim().slice(0, 80)).filter(Boolean).slice(0, 5)));

      // Click on the first result (Todd Schwartz)
      const toddRow = page.locator('text=Todd Schwartz').first();
      if (await toddRow.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('Clicking Todd Schwartz...');
        await toddRow.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);
        await dismissModals(page);

        console.log(`Customer URL: ${page.url()}`);

        // Log all tabs/sections on the customer profile
        const profileTabs = await page.locator('a, [role="tab"], button').allTextContents();
        const relevantTabs = profileTabs.map(t => t.trim()).filter(t => t && t.length < 30);
        console.log('Profile tabs:', JSON.stringify([...new Set(relevantTabs)].slice(0, 20)));

        // Look for Benefits/Membership section
        const benefitLink = page.locator('a:has-text("Benefit"), a:has-text("Membership"), a:has-text("Reward"), button:has-text("Benefit"), button:has-text("Membership"), [role="tab"]:has-text("Benefit")').first();
        if (await benefitLink.isVisible({ timeout: 3000 }).catch(() => false)) {
          const linkText = await benefitLink.textContent();
          console.log(`Found benefit section: "${linkText.trim()}"`);
          await benefitLink.click();
          await page.waitForTimeout(3000);

          const benefitBtns = await page.locator('button:visible').allTextContents();
          console.log('Benefit section buttons:', JSON.stringify(benefitBtns.map(b => b.trim()).filter(Boolean)));

          await page.screenshot({ path: '/tmp/playtomic-customer-benefits.png', fullPage: true });
          console.log('[Screenshot] customer-benefits');

          // Look for "Add benefit" or "Assign benefit" button
          const addBenBtn = page.locator('button:has-text("Add"), button:has-text("Assign"), button:has-text("Grant")').first();
          if (await addBenBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            const btnText = await addBenBtn.textContent();
            console.log(`Found add benefit button: "${btnText.trim()}"`);
            await addBenBtn.click();
            await page.waitForTimeout(3000);

            // Log the dialog
            const dialogContent = await page.locator('[role="dialog"], [class*="modal"], [class*="dialog"]').first().textContent().catch(() => '');
            console.log('Dialog content:', dialogContent?.slice(0, 500));

            const dialogBtns = await page.locator('button:visible').allTextContents();
            console.log('Dialog buttons:', JSON.stringify(dialogBtns.map(b => b.trim()).filter(Boolean)));

            const dialogInputs = await page.locator('input:visible, select:visible').evaluateAll(els =>
              els.map(el => ({ tag: el.tagName, type: el.type, placeholder: el.placeholder, name: el.name, options: el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.text).slice(0, 10) : undefined }))
            );
            console.log('Dialog inputs:', JSON.stringify(dialogInputs));

            await page.screenshot({ path: '/tmp/playtomic-add-benefit-dialog.png', fullPage: true });
            console.log('[Screenshot] add-benefit-dialog');
          }
        } else {
          console.log('No Benefits tab found on customer profile.');
          await page.screenshot({ path: '/tmp/playtomic-customer-profile.png', fullPage: true });
          console.log('[Screenshot] customer-profile');
        }
      } else {
        console.log('Todd not found in search results.');
      }
    } else {
      console.log('No search input found on customers page.');
    }

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
