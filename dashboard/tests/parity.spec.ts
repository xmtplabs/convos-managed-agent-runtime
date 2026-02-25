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

// ---------------------------------------------------------------------------
// Responsive layout tests (mobile viewport comes from the "mobile" project)
// ---------------------------------------------------------------------------

test.describe("Responsive layout", () => {
  test.beforeEach(async () => {
    await setMockState("idle");
  });

  test("mobile: stories stacked in single column", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // On mobile (<= 640px), stories grid should be 1 column
    const stories = page.locator(".stories");
    const style = await stories.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // When viewport is 375px (mobile project), should be a single column
    const colCount = style.split(" ").length;
    if (page.viewportSize()!.width <= 640) {
      expect(colCount).toBe(1);
    } else {
      expect(colCount).toBe(2);
    }
  });

  test("mobile: filter pills are horizontally scrollable", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    const filters = page.locator(".ps-filters");
    // Only check scrollable behavior on mobile viewports
    if (page.viewportSize()!.width <= 640) {
      const flexWrap = await filters.evaluate((el) => getComputedStyle(el).flexWrap);
      expect(flexWrap).toBe("nowrap");
      const overflowX = await filters.evaluate((el) => getComputedStyle(el).overflowX);
      expect(overflowX).toBe("auto");
    }
  });

  test("mobile: page title uses smaller font", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".page-title")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    const fontSize = await page.locator(".page-title").evaluate(
      (el) => getComputedStyle(el).fontSize,
    );
    if (page.viewportSize()!.width <= 640) {
      expect(fontSize).toBe("24px");
    } else {
      expect(fontSize).toBe("32px");
    }
  });

  test("mobile: form wrapper has reduced padding", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".form-wrapper")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    if (page.viewportSize()!.width <= 640) {
      // 32px top/bottom, 16px left/right -- assert individual sides
      // to avoid browser differences in shorthand serialization
      const paddingTop = await page.locator(".form-wrapper").evaluate(
        (el) => getComputedStyle(el).paddingTop,
      );
      const paddingRight = await page.locator(".form-wrapper").evaluate(
        (el) => getComputedStyle(el).paddingRight,
      );
      expect(paddingTop).toBe("32px");
      expect(paddingRight).toBe("16px");
    }
  });
});

// ---------------------------------------------------------------------------
// Reduced motion tests
// ---------------------------------------------------------------------------

test.describe("Reduced motion", () => {
  test.beforeEach(async () => {
    await setMockState("idle");
  });

  test("empty-state balloon has no animation with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setMockState("empty");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".empty-state")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // The balloon-droop animation should be suppressed
    const anim = await page.locator(".empty-balloon-group").evaluate(
      (el) => getComputedStyle(el).animationName,
    );
    expect(anim).toBe("none");
  });

  test("idle-state transitions are suppressed with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Paste input transition should be none
    const transition = await page.locator(".paste-input").evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    expect(transition).toBe("0s");
  });

  test("reduced motion screenshot: idle", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("idle-reduced-motion.png");
  });

  test("reduced motion screenshot: empty", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setMockState("empty");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".empty-state")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("empty-reduced-motion.png");
  });
});
