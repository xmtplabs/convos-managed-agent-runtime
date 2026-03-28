import { test, expect } from "@playwright/test";
import { setMockState } from "./helpers";

// ---------------------------------------------------------------------------
// Template page tests (/:slug)
//
// Verifies SSR rendering, OG meta tags, 404 handling, and interactive elements
// on the individual skill pages.
// ---------------------------------------------------------------------------

/** A known slug from the fixture catalog. */
const KNOWN_SLUG = "the-racket-club-manager";
const KNOWN_NAME = "The Racket Club Manager";

test.beforeEach(async () => {
  await setMockState("idle");
});

test.describe("Template page SSR", () => {
  test("renders agent name, description, and category", async ({
    page,
  }) => {
    await page.goto(`/${KNOWN_SLUG}`);
    await expect(page.locator("h1")).toContainText(KNOWN_NAME);
    // Category badge
    await expect(page.getByText("Sports")).toBeVisible();
    // Description is rendered
    await expect(page.locator("main p").first()).not.toBeEmpty();
  });

  test("renders skill badges when skills are present", async ({ page }) => {
    await page.goto(`/${KNOWN_SLUG}`);
    // The Racket Club Manager has skills: Search, Browse, Schedule
    await expect(page.getByText("Search")).toBeVisible();
    await expect(page.getByText("Browse")).toBeVisible();
    await expect(page.getByText("Schedule")).toBeVisible();
  });

  test("renders action buttons", async ({ page }) => {
    await page.goto(`/${KNOWN_SLUG}`);
    await expect(
      page.getByRole("button", { name: "Share" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy prompt" }),
    ).toBeVisible();
  });

  test("has correct OG meta tags", async ({ page }) => {
    await page.goto(`/${KNOWN_SLUG}`);
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(ogTitle).toContain(KNOWN_NAME);

    const ogDescription = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    expect(ogDescription).toBeTruthy();

    const ogType = await page
      .locator('meta[property="og:type"]')
      .getAttribute("content");
    expect(ogType).toBe("website");

    const twitterCard = await page
      .locator('meta[name="twitter:card"]')
      .getAttribute("content");
    expect(twitterCard).toBe("summary_large_image");
  });

  test("has Convos branding header with link to homepage", async ({
    page,
  }) => {
    await page.goto(`/${KNOWN_SLUG}`);
    const homeLink = page.locator("header a[href='/']");
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toContainText("Convos");
  });
});

test.describe("Template page 404", () => {
  test("returns 404 for unknown slug", async ({ page }) => {
    const response = await page.goto("/this-agent-does-not-exist-at-all");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Assistant not found")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse all assistants" }),
    ).toBeVisible();
  });
});
