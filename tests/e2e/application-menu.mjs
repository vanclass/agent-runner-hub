export const appTrigger = (page, group) => page.locator(`[data-menu-trigger="${group}"]`);
export const appItem = (page, id) => page.locator(`[data-menu-item="${id}"]`);

export async function openAppMenu(page, group) {
  await page.locator('.application-menu').waitFor({ state: 'visible' });
  const compact = appTrigger(page, 'compact');
  if (await compact.isVisible()) {
    if (await compact.getAttribute('aria-expanded') !== 'true') await compact.click();
    else await page.keyboard.press('Escape');
    await appItem(page, group).click();
    return;
  }
  const trigger = appTrigger(page, group);
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function openAppEntry(page, group, item) {
  await openAppMenu(page, group);
  await appItem(page, item).click();
}

export async function chooseAppPreference(page, group, item, value) {
  await openAppEntry(page, group, item);
  await appItem(page, value).click();
}
