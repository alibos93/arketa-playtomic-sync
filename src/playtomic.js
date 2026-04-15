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
  // Dismiss any blocking modals/popups
  const dismissSelectors = [
    'button:has-text("Skip for now")',
    'button:has-text("Skip")',
    'button:has-text("Close")',
    'button:has-text("Dismiss")',
    'button:has-text("Later")',
    'button:has-text("Not now")',
    '[aria-label="Close"]',
    'button.close',
  ];

  for (const selector of dismissSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
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

    // 2. Wait for dashboard and dismiss any modals
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await screenshot(page, '01-dashboard');

    // 3. Navigate to Customers
    console.log('Navigating to Customers...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await screenshot(page, '02-customers-page');
    console.log(`URL: ${page.url()}`);

    // Log what we see
    const buttons = await page.locator('button:visible').allTextContents();
    console.log('Buttons:', JSON.stringify(buttons.map(b => b.trim()).filter(Boolean)));

    const links = await page.locator('a:visible').allTextContents();
    console.log('Links:', JSON.stringify(links.map(l => l.trim()).filter(Boolean).slice(0, 20)));

    // Look for Import or Add button
    const importBtn = page.locator('button:has-text("Import"), button:has-text("Add"), button:has-text("Upload"), a:has-text("Import")').first();
    if (await importBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      const btnText = await importBtn.textContent();
      console.log(`Found import button: "${btnText.trim()}"`);
      await importBtn.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await screenshot(page, '03-after-import-click');
      console.log(`URL: ${page.url()}`);

      // Check for sub-options (File import, etc.)
      const subButtons = await page.locator('button:visible, a:visible').allTextContents();
      console.log('Sub-options:', JSON.stringify(subButtons.map(b => b.trim()).filter(Boolean)));

      // Look for file-related option
      const fileOption = page.locator('button:has-text("File"), button:has-text("CSV"), a:has-text("File"), a:has-text("CSV"), label:has-text("File")').first();
      if (await fileOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('Clicking file option...');
        await fileOption.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '04-file-option');
      }

      // Look for file input (visible or hidden)
      let fileInput = page.locator('input[type="file"]');
      let fileInputCount = await fileInput.count();
      console.log(`File inputs: ${fileInputCount}`);

      if (fileInputCount > 0) {
        console.log('Uploading CSV...');
        await fileInput.first().setInputFiles(tmpPath);
        await page.waitForTimeout(3000);
        await screenshot(page, '05-file-uploaded');

        // Look for next/upload/confirm button
        const confirmBtn = page.locator('button:has-text("Upload"), button:has-text("Import"), button:has-text("Next"), button:has-text("Continue"), button:has-text("Confirm")').first();
        if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          console.log('Clicking confirm...');
          await confirmBtn.click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(3000);
          await screenshot(page, '06-import-result');
          console.log('CSV import completed.');
        }
      } else {
        // Check for drag-drop zone
        const dropZone = await page.locator('[class*="drop"], [class*="upload"], [class*="drag"], [class*="dropzone"]').count();
        console.log(`Drop zones: ${dropZone}`);

        // Check all inputs
        const inputs = await page.locator('input').evaluateAll(els =>
          els.map(el => ({ type: el.type, name: el.name, id: el.id, accept: el.accept }))
        );
        console.log('All inputs:', JSON.stringify(inputs));
      }
    } else {
      console.log('No import button found. Looking for three-dot menu or other options...');

      // Check for menu/dots buttons
      const menuBtns = await page.locator('button[aria-label*="menu"], button[aria-label*="more"], button:has-text("⋮"), button:has-text("…")').count();
      console.log(`Menu buttons: ${menuBtns}`);

      // Check tabs on the page
      const tabs = await page.locator('[role="tab"], [class*="tab"]').allTextContents();
      console.log('Tabs:', JSON.stringify(tabs.map(t => t.trim()).filter(Boolean)));
    }

    // 4. Now navigate to Rewards & Offers to see the benefit flow
    console.log('\nNavigating to Rewards & Offers...');
    await page.click('a[href="/dashboard/rewards"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await screenshot(page, '07-rewards-page');
    console.log(`URL: ${page.url()}`);

    const rewardButtons = await page.locator('button:visible').allTextContents();
    console.log('Reward buttons:', JSON.stringify(rewardButtons.map(b => b.trim()).filter(Boolean)));

    const rewardLinks = await page.locator('a:visible').allTextContents();
    console.log('Reward links:', JSON.stringify(rewardLinks.map(l => l.trim()).filter(Boolean).slice(0, 20)));

    // Look for membership-related content
    const membershipElements = await page.locator('text=/[Mm]embership|[Bb]enefit|Royal|Core|Iconic/').allTextContents();
    console.log('Membership elements:', JSON.stringify(membershipElements.map(t => t.trim()).slice(0, 10)));

    await screenshot(page, '99-final');
    console.log('Debug run complete.');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
