import { test, expect } from "@playwright/test";
import { setMockState } from "./helpers";

// ---------------------------------------------------------------------------
// Screenshot-parity test suite
//
// Each of the 12 visual states is captured at desktop (1280x800) and mobile
// (375x812) viewports. The tests use the mock-pool server to control backend
// responses so the Next.js app deterministically renders every state.
//
// The test env defaults to POOL_ENVIRONMENT=staging, so we use dev.convos.org
// links (popup.convos.org is rejected in non-production environments).
// ---------------------------------------------------------------------------

/** A valid invite URL accepted in the staging/dev environment. */
const TEST_INVITE_URL = "https://dev.convos.org/v2?test=1";

/** Wait for web fonts to finish loading before taking screenshots. */
async function waitForFonts(page: import("@playwright/test").Page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Stub the external QR image API so screenshots are deterministic.
 * Replaces api.qrserver.com responses with a 1x1 transparent PNG.
 */
async function stubQrImage(page: import("@playwright/test").Page) {
  // 1x1 transparent PNG as base64
  const TRANSPARENT_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB" +
    "Nl7BcQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/api.qrserver.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: TRANSPARENT_PNG,
    }),
  );
}

// ===== Visual parity: 12 states =============================================

test.describe("Visual parity", () => {
  test.beforeEach(async () => {
    await setMockState("idle");
  });

  // 1. idle
  test("idle state loads and renders paste input", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("idle.png");
  });

  // 2. empty
  test("empty state shows balloon", async ({ page }) => {
    await setMockState("empty");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".empty-state")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);
    await expect(page).toHaveScreenshot("empty.png");
  });

  // 3. joining
  test("joining state shows animation", async ({ page }) => {
    await setMockState("success");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Paste a URL and press Enter to trigger joining state
    await page.locator(".paste-input").fill(TEST_INVITE_URL);
    await page.locator(".paste-input").press("Enter");
    // Capture during animation (500ms into joining)
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("joining.png", {
      // Animation frames may vary slightly
      maxDiffPixelRatio: 0.02,
    });
  });

  // 4. success
  test("success state shows confetti", async ({ page }) => {
    await setMockState("success");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    await page.locator(".paste-input").fill(TEST_INVITE_URL);
    await page.locator(".paste-input").press("Enter");
    // Wait 1000ms for confetti to be visible
    await page.waitForTimeout(1000);
    await expect(page).toHaveScreenshot("success.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  // 5. post-success
  test("post-success state shows toast and skill highlight", async ({ page }) => {
    await setMockState("success");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    await page.locator(".paste-input").fill(TEST_INVITE_URL);
    await page.locator(".paste-input").press("Enter");
    // Wait 2500ms: overlay dismissed, toast visible, skills scrolled into view
    await page.waitForTimeout(2500);
    await expect(page).toHaveScreenshot("post-success.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  // 6. error
  test("error state shows droop and try again", async ({ page }) => {
    await setMockState("error");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    await page.locator(".paste-input").fill(TEST_INVITE_URL);
    await page.locator(".paste-input").press("Enter");
    // Wait 1500ms for error state (droop + "Try again" visible)
    await page.waitForTimeout(1500);
    await expect(page.locator(".joining-dismiss-btn")).toBeVisible();
    await expect(page).toHaveScreenshot("error.png", {
      maxDiffPixelRatio: 0.02,
    });
  });

  // 7. skill-browser-default
  test("skill browser default view", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Scroll to the skill browser
    await page.locator(".prompt-store").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot("skill-browser-default.png");
  });

  // 8. skill-browser-expanded
  test("skill browser expanded view", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Click "Show all" to expand
    await page.locator(".ps-show-more").click();
    await page.waitForTimeout(300);
    await page.locator(".prompt-store").scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("skill-browser-expanded.png");
  });

  // 9. skill-browser-filtered
  test("skill browser filtered by category", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Click the second category pill (first non-"All" pill)
    const pills = page.locator(".ps-filter-pill");
    const pillCount = await pills.count();
    if (pillCount > 1) {
      await pills.nth(1).click();
    }
    await page.waitForTimeout(300);
    await page.locator(".prompt-store").scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("skill-browser-filtered.png");
  });

  // 10. skill-browser-search
  test("skill browser with search query", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Type into search input
    await page.locator(".ps-search").fill("meal");
    await page.waitForTimeout(300);
    await page.locator(".prompt-store").scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("skill-browser-search.png");
  });

  // 11. prompt-modal
  test("prompt modal opens on view click", async ({ page }) => {
    await setMockState("idle");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    // Click "View" on the first skill row that has a View button
    const viewBtn = page.locator(".ps-view-btn").first();
    await viewBtn.click();
    // Wait for the modal to load the prompt
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("prompt-modal.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  // 12. qr-modal
  test("qr modal opens after non-join claim", async ({ page }) => {
    // Stub external QR image API for deterministic screenshots
    await stubQrImage(page);
    await setMockState("qr-modal");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    await page.locator(".paste-input").fill(TEST_INVITE_URL);
    await page.locator(".paste-input").press("Enter");
    // Wait 2000ms for QR modal to open
    await page.waitForTimeout(2000);
    await expect(page).toHaveScreenshot("qr-modal.png", {
      maxDiffPixelRatio: 0.02,
    });
  });
});

// ===== Responsive layout tests (mobile viewport from the "mobile" project) ==

test.describe("Responsive layout", () => {
  test.beforeEach(async () => {
    await setMockState("idle");
  });

  test("mobile: stories stacked in single column", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".paste-input")).toBeVisible({ timeout: 10000 });
    await waitForFonts(page);

    const stories = page.locator(".stories");
    const style = await stories.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
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

// ===== Reduced motion tests ==================================================

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
