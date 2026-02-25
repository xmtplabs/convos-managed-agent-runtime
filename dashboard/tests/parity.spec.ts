import { test, expect } from "@playwright/test";
import { setMockState } from "./helpers";

const NEXT_URL = "http://localhost:3000";

// Screenshot states and the mock state each needs
// More states added as tasks progress — joining, success, post-success, error
// require Playwright page interactions after setMockState

test.describe("Visual parity", () => {
  test.beforeEach(async () => {
    // Reset to idle before each test
    await setMockState("idle");
  });

  test("idle state loads", async ({ page }) => {
    await setMockState("idle");
    await page.goto(NEXT_URL, { waitUntil: "networkidle" });
    // Verify paste input is visible (pool has idle instances)
    await expect(page.locator(".paste-input")).toBeVisible();
  });

  test("empty state shows balloon", async ({ page }) => {
    await setMockState("empty");
    await page.goto(NEXT_URL, { waitUntil: "networkidle" });
    // Verify empty state balloon is visible
    await expect(page.locator(".empty-state")).toBeVisible();
  });
});
