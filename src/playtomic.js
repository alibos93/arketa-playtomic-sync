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

    // 2. Wait for sidebar to fully render
    console.log('Waiting for dashboard to load...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await screenshot(page, '01-dashboard-loaded');

    // Log sidebar items to find the right navigation
    const sidebarLinks = await page.locator('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a, [class*="nav"] a').evaluateAll(els =>
      els.map(el => ({ text: el.textContent?.trim(), href: el.getAttribute('href'), ariaLabel: el.getAttribute('aria-label') }))
    );
    console.log('Sidebar links:', JSON.stringify(sidebarLinks));

    // Also get all links on page
    const allLinks = await page.locator('a[href]').evaluateAll(els =>
      els.map(el => ({ text: el.textContent?.trim().slice(0, 50), href: el.getAttribute('href') })).filter(l => l.href && !l.href.startsWith('http'))
    );
    console.log('Internal links:', JSON.stringify(allLinks));

    // Look for "Members", "Contacts", "Customers", "Players" in the sidebar
    const memberLink = page.locator('a:has-text("Member"), a:has-text("Contact"), a:has-text("Customer"), a:has-text("Player"), a:has-text("Client")').first();
    if (await memberLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const linkText = await memberLink.textContent();
      console.log(`Found member-related link: "${linkText}"`);
      await memberLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await screenshot(page, '02-members-page');

      console.log(`URL after clicking: ${page.url()}`);

      // Look for import button on this page
      const importBtn = page.locator('button:has-text("Import"), button:has-text("Upload"), a:has-text("Import"), a:has-text("Upload"), button:has-text("Add")');
      const importCount = await importBtn.count();
      console.log(`Import buttons found: ${importCount}`);

      if (importCount > 0) {
        const btnTexts = await importBtn.allTextContents();
        console.log('Import button texts:', JSON.stringify(btnTexts));
        await importBtn.first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
        await screenshot(page, '03-import-dialog');

        console.log(`URL after import click: ${page.url()}`);

        // Look for file input
        const fileInput = page.locator('input[type="file"]');
        const fileInputCount = await fileInput.count();
        console.log(`File inputs: ${fileInputCount}`);

        if (fileInputCount > 0) {
          console.log('Uploading CSV...');
          await fileInput.setInputFiles(tmpPath);
          await page.waitForTimeout(2000);
          await screenshot(page, '04-file-selected');

          // Click upload/submit/next
          const submitBtn = page.locator('button:has-text("Upload"), button:has-text("Import"), button:has-text("Next"), button:has-text("Continue"), button:has-text("Submit")').first();
          if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await submitBtn.click();
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(3000);
            await screenshot(page, '05-upload-result');
            console.log('CSV uploaded successfully.');
          }
        } else {
          // Maybe there's a drag-drop zone or different upload pattern
          const dropZone = page.locator('[class*="drop"], [class*="upload"], [class*="drag"]');
          const dropCount = await dropZone.count();
          console.log(`Drop zones found: ${dropCount}`);

          // Log all visible elements for debugging
          const visibleButtons = await page.locator('button:visible').allTextContents();
          console.log('Visible buttons:', JSON.stringify(visibleButtons));
        }
      }
    } else {
      console.log('No member/contact link found in sidebar.');

      // Try to get all visible text from sidebar
      const sidebarText = await page.locator('nav, aside, [class*="sidebar"]').first().textContent().catch(() => 'none');
      console.log('Sidebar text:', sidebarText?.slice(0, 500));

      // Get full page text
      const bodyText = await page.locator('body').textContent();
      console.log('Page text:', bodyText?.slice(0, 1000));
    }

    await screenshot(page, '99-final');
    console.log('Debug run complete.');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
