# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: asset-library.spec.ts >> Asset Library >> sign up -> paste URL -> see it in library
- Location: tests/asset-library.spec.ts:4:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 30000ms exceeded.
=========================== logs ===========================
waiting for navigation to "/dashboard/assets" until "load"
  navigated to "http://localhost:3000/signup?error=fetch%20failed"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - button "Open Next.js Dev Tools" [ref=e7] [cursor=pointer]:
    - img [ref=e8]
  - alert [ref=e11]
  - generic [ref=e13]:
    - generic [ref=e14]:
      - generic [ref=e15]: Sign Up
      - generic [ref=e16]: Create your account and organization
    - generic [ref=e17]:
      - generic [ref=e18]:
        - generic [ref=e19]: fetch failed
        - generic [ref=e20]:
          - generic [ref=e21]: Organization Name
          - textbox "Organization Name" [ref=e22]:
            - /placeholder: Acme Corp
        - generic [ref=e23]:
          - generic [ref=e24]: Email
          - textbox "Email" [ref=e25]:
            - /placeholder: m@example.com
        - generic [ref=e26]:
          - generic [ref=e27]: Password
          - textbox "Password" [ref=e28]
        - button "Sign Up" [ref=e29]
      - generic [ref=e30]:
        - text: Already have an account?
        - link "Log in" [ref=e31] [cursor=pointer]:
          - /url: /login
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Asset Library', () => {
  4  |   test('sign up -> paste URL -> see it in library', async ({ page }) => {
  5  |     const timestamp = Date.now();
  6  |     const email = `test.user.${timestamp}@gmail.com`;
  7  |     const password = 'Password123!';
  8  |     const orgName = `Test Org ${timestamp}`;
  9  | 
  10 |     // Go to signup
  11 |     await page.goto('/signup');
  12 |     await page.fill('input[name="orgName"]', orgName);
  13 |     await page.fill('input[name="email"]', email);
  14 |     await page.fill('input[name="password"]', password);
  15 |     await page.click('button[type="submit"]');
  16 | 
  17 |     // Wait for redirect to dashboard
> 18 |     await page.waitForURL('/dashboard/assets');
     |                ^ Error: page.waitForURL: Test timeout of 30000ms exceeded.
  19 |     
  20 |     // Check if we are on the assets page
  21 |     await expect(page.locator('h2')).toContainText('Assets');
  22 | 
  23 |     // Click "Add Asset" button
  24 |     await page.click('button:has-text("Add Asset")');
  25 | 
  26 |     // Paste URL
  27 |     const urlInput = page.locator('input[id="url"]');
  28 |     await urlInput.waitFor({ state: 'visible' });
  29 |     await urlInput.fill('https://example.com');
  30 |     
  31 |     // Save Link
  32 |     await page.click('button:has-text("Save Link")');
  33 | 
  34 |     // Wait for modal to close (or check for text in the page)
  35 |     await expect(page.locator('h3:has-text("No assets")')).not.toBeVisible();
  36 |     await expect(page.locator('.text-sm.font-medium')).toContainText('Example Domain');
  37 |   });
  38 | });
  39 | 
```