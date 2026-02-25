import { test, expect } from "@playwright/test";
import { setMockState } from "./helpers";

// Screenshot states and the mock state each needs.
// More states added as tasks progress -- joining, success, post-success, error
// require Playwright page interactions after setMockState.

/** Wait for web fonts to finish loading before taking screenshots. */
async function waitForFonts(page: import("@playwright/test").Page) {
  await page.evaluate(() => document.fonts.ready);
}

test.describe("Visual parity", () => {
  test.beforeEach(async () => {
    // Reset to idle before each test
    await setMockState("idle");
  });

  test("idle state loads and renders paste input", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for pool counts fetch to resolve and UI to update
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);
    // Capture screenshot for visual regression baseline.
    // Run with --update-snapshots to generate initial baselines.
    await expect(page).toHaveScreenshot("idle.png");
  });

  test("empty state shows balloon", async ({ page }) => {
    await setMockState("empty");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for pool counts fetch to resolve and UI to update
    await expect(page.locator(".empty-state")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);
    // Capture screenshot for visual regression baseline.
    // Run with --update-snapshots to generate initial baselines.
    await expect(page).toHaveScreenshot("empty.png");
  });
});
