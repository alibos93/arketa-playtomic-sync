const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PLAYTOMIC_MANAGER_URL = 'https://manager.playtomic.io';

// Map Arketa membership names to Playtomic benefit dropdown values
const BENEFIT_MAP = {
  'royal': 'Royal Membership',
  'iconic': 'Iconic Membership',
  'core': 'Core Membership',
  'rise': 'Rise Membership',
};

function getBenefitName(membershipName) {
  const lower = (membershipName || '').toLowerCase();
  for (const [key, value] of Object.entries(BENEFIT_MAP)) {
    if (lower.includes(key)) return value;
  }
  return null;
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

async function uploadCSVToPlaytomic(csvContent, email, password, members) {
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

    // === IMPORT CUSTOMERS VIA CSV ===
    console.log('\n--- Importing customers via CSV ---');
    await page.click('a[href="/dashboard/customers"]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.click('a:has-text("Imports")');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Step 1: Select Customers
    await page.click('button:has-text("New Import")');
    await page.waitForTimeout(3000);
    await dismissModals(page);
    await page.waitForSelector('text=Select an object', { timeout: 10000 });
    await page.locator('text=The people you work with').click();
    await page.waitForTimeout(1000);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(3000);

    // Step 2: Consent
    await page.locator('#hasDataHandlingPermission').check();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(3000);

    // Step 3: Upload CSV
    await page.locator('input[type="file"]').setInputFiles(tmpPath);
    await page.waitForTimeout(3000);
    await page.locator('button:has-text("Next")').click();
    await page.waitForTimeout(5000);

    // Step 4: Dismiss processing modal
    const okBtn = page.locator('button:has-text("Ok, got it")').first();
    if (await okBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      await okBtn.click();
      await page.waitForTimeout(2000);
    }
    console.log('CSV import completed.');

    // Wait for import to process before assigning benefits
    console.log('Waiting for import to process...');
    await page.waitForTimeout(5000);

    // === ASSIGN BENEFITS TO EACH MEMBER ===
    console.log('\n--- Assigning membership benefits ---');

    for (const member of members) {
      const benefitName = getBenefitName(member.membership_name);
      if (!benefitName) {
        console.log(`[Skip] ${member.first_name} ${member.last_name} — no matching benefit for "${member.membership_name}"`);
        continue;
      }

      const fullName = `${member.first_name} ${member.last_name}`.trim();
      console.log(`\nAssigning "${benefitName}" to ${fullName}...`);

      // Go to Customers and search
      await page.click('a[href="/dashboard/customers"]');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await dismissModals(page);

      // Make sure we're on the Customers tab (not Imports)
      const custTab = page.locator('a:has-text("Customers")').first();
      if (await custTab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await custTab.click();
        await page.waitForTimeout(2000);
      }

      // Search for the member
      const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]').first();
      if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await searchInput.fill(member.last_name || fullName);
        await page.waitForTimeout(3000);

        // Click on the customer row
        const customerRow = page.locator(`text=${fullName}`).first();
        if (await customerRow.isVisible({ timeout: 5000 }).catch(() => false)) {
          await customerRow.click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(2000);
          await dismissModals(page);

          // Click Benefits tab
          const benefitsTab = page.locator('a:has-text("Benefits"), [role="tab"]:has-text("Benefits")').first();
          await benefitsTab.click();
          await page.waitForTimeout(2000);

          // Check if they already have a benefit
          const existingBenefit = page.locator('text=Royal Membership, text=Core Membership, text=Iconic Membership, text=Rise Membership').first();
          if (await existingBenefit.isVisible({ timeout: 2000 }).catch(() => false)) {
            console.log(`  ${fullName} already has a benefit assigned. Skipping.`);
            continue;
          }

          // Click "Add benefit"
          const addBenefitBtn = page.locator('button:has-text("Add benefit")').first();
          if (await addBenefitBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await addBenefitBtn.click();
            await page.waitForTimeout(2000);

            // Select the benefit from dropdown
            const benefitDropdown = page.locator('select, [role="combobox"], [class*="select"]').first();
            if (await benefitDropdown.isVisible({ timeout: 5000 }).catch(() => false)) {
              // Try select element first
              const isSelect = await benefitDropdown.evaluate(el => el.tagName === 'SELECT');
              if (isSelect) {
                await benefitDropdown.selectOption({ label: benefitName });
              } else {
                // Click to open dropdown, then select option
                await benefitDropdown.click();
                await page.waitForTimeout(1000);
                await page.locator(`text="${benefitName}"`).click();
              }
              await page.waitForTimeout(2000);

              // Screenshot to see the state
              await page.screenshot({ path: `/tmp/playtomic-benefit-${member.last_name}.png`, fullPage: true });

              // Scroll down and click Save/Confirm
              const saveBtn = page.locator('button:has-text("Save"), button:has-text("Confirm"), button:has-text("Assign"), button:has-text("Add"), button:has-text("Submit")').last();
              if (await saveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                const saveTxt = await saveBtn.textContent();
                console.log(`  Clicking "${saveTxt.trim()}"...`);
                await saveBtn.click();
                await page.waitForTimeout(3000);
                console.log(`  Benefit "${benefitName}" assigned to ${fullName}.`);
              } else {
                // Maybe need to scroll down
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(1000);

                const saveBtn2 = page.locator('button:has-text("Save"), button:has-text("Confirm"), button:has-text("Assign"), button:has-text("Add")').last();
                if (await saveBtn2.isVisible({ timeout: 3000 }).catch(() => false)) {
                  await saveBtn2.click();
                  await page.waitForTimeout(3000);
                  console.log(`  Benefit "${benefitName}" assigned to ${fullName}.`);
                } else {
                  console.log(`  Could not find Save button. Check screenshot.`);
                }
              }
            } else {
              console.log(`  Could not find benefit dropdown.`);
              // Log what's on the page
              const allBtns = await page.locator('button:visible').allTextContents();
              console.log('  Buttons:', JSON.stringify(allBtns.map(b => b.trim()).filter(Boolean)));
              await page.screenshot({ path: `/tmp/playtomic-no-dropdown-${member.last_name}.png`, fullPage: true });
            }
          } else {
            console.log(`  No "Add benefit" button found for ${fullName}.`);
          }
        } else {
          console.log(`  Customer "${fullName}" not found in search.`);
        }
      }
    }

    await page.screenshot({ path: '/tmp/playtomic-import-result.png', fullPage: true });
    console.log('\nSync complete!');

  } finally {
    await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

module.exports = { uploadCSVToPlaytomic };
