import { test, expect } from '../../.runner/web-app-testing/fixture.mjs';
import pngjs from 'pngjs';

async function movingBall(canvas, testInfo) {
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCount(1);
  const sample = async () => {
    const screenshot = await canvas.screenshot();
    const image = pngjs.PNG.sync.read(screenshot);
    let count = 0;
    let xSum = 0;
    let ySum = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4;
        const [red, green, blue] = image.data.subarray(offset, offset + 3);
        if (red > 85 && red < 135 && green > 210 && blue > 235) {
          count++;
          xSum += x;
          ySum += y;
        }
      }
    }
    return { count, x: xSum / count, y: ySum / count, screenshot };
  };
  let first;
  await expect.poll(async () => { first = await sample(); return first.count; },
    { message: 'The cyan Phaser ball must actually render in Chromium' }).toBeGreaterThan(100);
  await testInfo.attach('phaser-rendered', { body: first.screenshot, contentType: 'image/png' });
  let next;
  await expect.poll(async () => {
    next = await sample();
    return next.count > 100 ? Math.hypot(next.x - first.x, next.y - first.y) : 0;
  }, { message: 'Rendered ball pixels must move as Phaser updates' }).toBeGreaterThan(8);
  await testInfo.attach('phaser-updated', { body: next.screenshot, contentType: 'image/png' });
}

test('starter is ready, error-free and interactive', async ({ page }, testInfo) => {
  const response = await page.goto('/');
  expect(response?.ok(), 'The owned checkout must respond successfully').toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Web App', exact: true })).toBeVisible();
  const counter = page.locator('#counter');
  await expect(counter).toHaveText('Count: 0');
  await counter.click();
  await counter.click();
  await expect(counter).toHaveText('Count: 2');
  if (process.env.RUNNER_WEB_APP_REACT === 'true') {
    await expect(page.locator('#app')).toContainText('TypeScript + Vite + React');
  }
  if (process.env.RUNNER_WEB_APP_PHASER === 'true') {
    await movingBall(page.locator('#game canvas'), testInfo);
    if (process.env.RUNNER_WEB_APP_REACT === 'true') {
      await page.getByRole('button', { name: 'Hide game' }).click();
      await expect(page.locator('#game canvas')).toHaveCount(0);
      await page.getByRole('button', { name: 'Show game' }).click();
      await movingBall(page.locator('#game canvas'), testInfo);
      await expect(counter).toHaveText('Count: 2');
    }
  } else {
    await expect(page.locator('#game canvas')).toHaveCount(0);
  }
});
