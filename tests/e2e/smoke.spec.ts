import { test, expect } from '@playwright/test';

test('desktop workbench serves its core landmarks', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.brand-lockup strong')).toHaveText('T.A.D.A.S.H.I.');
  await expect(page.getByRole('heading', { name: 'Tell me what to move forward.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Hold to talk/ })).toBeVisible();
});
