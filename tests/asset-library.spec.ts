import { test, expect } from '@playwright/test';

test.describe('Asset Library', () => {
  test('sign up -> paste URL -> see it in library', async ({ page }) => {
    const timestamp = Date.now();
    const email = `test.user.${timestamp}@gmail.com`;
    const password = 'Password123!';
    const orgName = `Test Org ${timestamp}`;

    // Go to signup
    await page.goto('/signup');
    await page.fill('input[name="orgName"]', orgName);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('/dashboard/assets');
    
    // Check if we are on the assets page
    await expect(page.locator('h2')).toContainText('Assets');

    // Click "Add Asset" button
    await page.click('button:has-text("Add Asset")');

    // Paste URL
    const urlInput = page.locator('input[id="url"]');
    await urlInput.waitFor({ state: 'visible' });
    await urlInput.fill('https://example.com');
    
    // Save Link
    await page.click('button:has-text("Save Link")');

    // Wait for modal to close (or check for text in the page)
    await expect(page.locator('h3:has-text("No assets")')).not.toBeVisible();
    await expect(page.locator('.text-sm.font-medium')).toContainText('Example Domain');
  });
});
