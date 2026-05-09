const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PLAYTOMIC_MANAGER_URL = 'https://manager.playtomic.io';

async function dismissModals(page, { attempts = 4, timeout = 500 } = {}) {
  const buttonTexts = [
    'Skip for now', 'Skip', 'Got it', 'Ok, got it', 'OK, got it',
    'Continue', 'Accept', 'Dismiss', 'Maybe later', 'Not now',
  ];
  for (let i = 0; i < attempts; i++) {
    let dismissed = false;
    for (const text of buttonTexts) {
      const btn = page.locator(`#modal button:has-text("${text}"), button:has-text("${text}")`).first();
      if (await btn.isVisible({ timeout }).catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(800);
        dismissed = true;
        break;
      }
    }
    if (!dismissed) {
      const closeBtn = page.locator('#modal [aria-label="Close"], #modal button[aria-label*="close" i]').first();
      if (await closeBtn.isVisible({ timeout }).catch(() => false)) {
        await closeBtn.click().catch(() => {});
        await page.waitForTimeout(800);
        dismissed = true;
      }
    }
    if (!dismissed) {
      const modal = page.locator('#modal [class*="DialogContainer"]').first();
      if (await modal.isVisible({ timeout }).catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(800);
      } else {
        return;
      }
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

  // Diagnostic: log all network responses related to imports/uploads.
  page.on('response', resp => {
    const url = resp.url();
    if (url.includes('import') || url.includes('upload') || url.includes('customer')) {
      console.log(`[Net] ${resp.status()} ${resp.request().method()} ${url}`);
    }
  });

  try {
    // === LOGIN ===
    console.log('Logging into Playtomic...');
    // Use 'domcontentloaded' instead of 'networkidle' — Playtomic has long-polling that
    // never fully idles, causing flaky 30s timeouts.
    await page.goto(`${PLAYTOMIC_MANAGER_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
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
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await page.click('a:has-text("Imports")');
    await page.waitForTimeout(3000);
    await dismissModals(page);

    // === STEP 1: Confirm permissions (Playtomic redesigned the wizard 2026-05-07: now 2 steps) ===
    console.log('Starting import wizard...');
    await page.locator('button:has-text("New Import"), button:has-text("New customers"), button:has-text("Import")').first().click();
    await page.waitForTimeout(3000);
    await page.getByText(/I confirm that I have the necessary permissions/i).waitFor({ timeout: 15000 });
    await page.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(500);
    // Use .last() — the wizard step header ("2 Import file") is also a button; the real "Next" is the footer button.
    await page.locator('#modal button:has-text("Next")').last().click();
    await page.waitForTimeout(3000);
    console.log('Step 1: Confirmed permissions.');

    // === STEP 2: Upload CSV ===
    // Use the filechooser pattern instead of setInputFiles — clicking the
    // dropzone's "Import file" link triggers Playtomic's full upload+validate
    // event chain, which setInputFiles bypasses (leaves Next functionally dead
    // even though file appears in the UI).
    // Diagnostic: download Playtomic's official CSV sample so we can see the
    // exact column headers and data format they expect.
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
      await page.locator('text=Download CSV sample').click();
      const dl = await downloadPromise;
      const samplePath = await dl.path();
      const sampleContent = require('fs').readFileSync(samplePath, 'utf8');
      console.log('=== Playtomic CSV sample ===');
      console.log(sampleContent.split('\n').slice(0, 4).join('\n'));
      console.log('=== end sample ===');
    } catch (e) {
      console.log(`CSV sample download failed: ${e.message}`);
    }

    let uploaded = false;
    try {
      const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
      await page.locator('#modal').getByText(/^Import file$/i).last().click({ force: true });
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(tmpPath);
      uploaded = true;
      console.log('Step 2: uploaded via filechooser.');
    } catch (e) {
      console.log(`Filechooser path failed (${e.message}); falling back to setInputFiles.`);
      await page.locator('input[type="file"]').setInputFiles(tmpPath);
    }
    // Wait for Playtomic to upload and validate the file server-side before
    // attempting Next. Network roundtrip can take several seconds.
    await page.waitForTimeout(10000);
    const buttonState = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#modal button')).map(b => ({
        text: b.textContent.trim().slice(0, 40),
        disabled: b.disabled,
        ariaDisabled: b.getAttribute('aria-disabled'),
      }));
    });
    console.log('Wizard buttons before Next:', JSON.stringify(buttonState));
    await page.screenshot({ path: '/tmp/playtomic-step2-before-next.png', fullPage: true });
    console.log('[Screenshot] step2-before-next');

    // Submitting Step 2 has been brittle — Playtomic's React handler doesn't
    // always fire from Playwright clicks. Try multiple strategies until the
    // wizard's "Drag and drop" zone disappears (i.e. the wizard moved on).
    const stepStillOpen = async () =>
      await page.getByText(/Drag and drop your file here/i).isVisible({ timeout: 1000 }).catch(() => false);

    const strategies = [
      async () => {
        const btn = page.locator('#modal button:has-text("Next")').last();
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ force: true });
      },
      async () => {
        const btn = page.locator('#modal button:has-text("Next")').last();
        await btn.focus();
        await page.keyboard.press('Enter');
      },
      async () => {
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('#modal button'))
            .find(b => b.textContent.trim() === 'Next');
          if (btn) btn.click();
        });
      },
    ];

    let submitted = false;
    for (let i = 0; i < strategies.length; i++) {
      await strategies[i]();
      console.log(`Step 2: submit attempt ${i + 1}.`);
      await page.waitForTimeout(4000);
      if (!(await stepStillOpen())) {
        submitted = true;
        break;
      }
    }
    if (!submitted) {
      throw new Error('Step 2: wizard did not advance after Next click attempts');
    }
    await page.waitForTimeout(4000);
    await page.screenshot({ path: '/tmp/playtomic-step2-after-next.png', fullPage: true });
    console.log('[Screenshot] step2-after-next');

    const okBtn = page.locator('#modal button:has-text("Ok"), #modal button:has-text("Got it"), #modal button:has-text("Done"), #modal button:has-text("Finish")').first();
    if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await okBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(2000);
      console.log('Dismissed final confirmation.');
    }
    await dismissModals(page);

    // Check import status on the Imports page
    console.log('Checking import status...');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await page.click('a:has-text("Imports")');
    await page.waitForTimeout(4000);

    await page.screenshot({ path: '/tmp/playtomic-import-status.png', fullPage: true });
    console.log('[Screenshot] import-status');

    // Log import history
    const importRows = await page.locator('table tr, [class*="row"]').allTextContents();
    console.log('Import history:', JSON.stringify(importRows.map(r => r.trim().slice(0, 150)).filter(Boolean).slice(0, 3)));

    await page.screenshot({ path: '/tmp/playtomic-import-result.png', fullPage: true });
    console.log('Done.');

  } catch (err) {
    try {
      await page.screenshot({ path: '/tmp/playtomic-failure.png', fullPage: true });
      console.log('[Screenshot] failure captured at /tmp/playtomic-failure.png');
    } catch {}
    throw err;
  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
